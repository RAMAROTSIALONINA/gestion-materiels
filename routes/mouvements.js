// Mouvements : saisie (brouillon), validation, annulation, mouvement inverse,
// réception des transferts. Cahier des charges § 3.4, 3.5, 4.3, 4.4.
//
// Les règles (stock jamais négatif, ticket des matériels, motif, bénéficiaire,
// autorisation par une autre personne, statut des matériels) sont tenues par la
// base ; cette route prépare les données et applique les droits.
// Une correction d'inventaire ou un mouvement inverse s'autorise en le
// validant : la personne qui valide est notée comme celle qui autorise, et la
// base refuse que ce soit son auteur (sauf administrateur).
import { Router } from 'express';
import { requete, transaction } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { ErreurApi } from '../middleware/erreurs.js';
import { peutReceptionner, perimetre } from '../middleware/permissions.js';
import { journaliser } from '../services/journal.js';
import {
  date, filtreId, identifiantNumerique, motifRecherche, pagination, quantite, texte,
} from '../services/validation.js';

export const routeurMouvements = Router();
const lecture = exigerDroit('mouvements.lire');
const saisie = exigerDroit('mouvements.saisir');
const annulation = exigerDroit('mouvements.annuler');
const reception = exigerDroit('transferts.receptionner');

const refus = (champ, message) => new ErreurApi(422, 'SAISIE_INVALIDE', message, { champ });

async function lireType(code) {
  const { rows: [type] } = await requete('SELECT * FROM types_mouvements WHERE code = $1', [code]);
  if (!type) throw refus('type_code', 'Type de mouvement inconnu.');
  return type;
}

async function siteDuService(serviceId) {
  if (!serviceId) return null;
  const { rows: [service] } = await requete('SELECT site_id FROM services WHERE id = $1', [serviceId]);
  return service?.site_id ?? null;
}

// Périmètre d'un responsable : mouvements de son service (bénéficiaire, matériel
// du service) ou touchant le site de son service.
export async function conditionPerimetre(utilisateur, valeurs) {
  const { serviceId, employeId } = perimetre(utilisateur);
  if (employeId !== undefined) return 'false';
  if (serviceId === undefined) return null;
  if (!serviceId) return 'false';
  valeurs.push(serviceId);
  const service = `$${valeurs.length}`;
  valeurs.push(await siteDuService(serviceId));
  const site = `$${valeurs.length}::bigint`;
  return `(mv.service_beneficiaire_id = ${service}
           OR EXISTS (SELECT 1 FROM employes e2 WHERE e2.id = mv.employe_beneficiaire_id AND e2.service_id = ${service})
           OR EXISTS (SELECT 1 FROM lignes_mouvements l2 LEFT JOIN materiels m2 ON m2.id = l2.materiel_id
                       WHERE l2.mouvement_id = mv.id
                         AND (m2.service_id = ${service} OR l2.site_source_id = ${site} OR l2.site_destination_id = ${site})))`;
}

function lireEntete(corps) {
  return {
    date_mouvement: date(corps.date_mouvement, { champ: 'date_mouvement', libelle: 'Date' }),
    motif: texte(corps.motif, { champ: 'motif', libelle: 'Motif', max: 500 }),
    numero_ticket: texte(corps.numero_ticket, { champ: 'numero_ticket', libelle: 'N° de ticket', max: 60 }),
    reference_externe: texte(corps.reference_externe, { champ: 'reference_externe', libelle: 'Référence (bon, facture)', max: 60 }),
    origine: texte(corps.origine, { champ: 'origine', libelle: 'Fournisseur ou donateur', max: 120 }),
    employe_beneficiaire_id: identifiantNumerique(corps.employe_beneficiaire_id, { champ: 'employe_beneficiaire_id', libelle: 'Employé bénéficiaire' }),
    service_beneficiaire_id: identifiantNumerique(corps.service_beneficiaire_id, { champ: 'service_beneficiaire_id', libelle: 'Service bénéficiaire' }),
  };
}

// Un mouvement a un site d'origine et/ou de destination selon son sens ; ils
// s'appliquent à toutes ses lignes.
function lireSites(corps, type) {
  const source = type.sens === 'ENTREE' ? null
    : identifiantNumerique(corps.site_source_id, { champ: 'site_source_id', libelle: 'Site d’origine', obligatoire: true });
  const destination = type.sens === 'SORTIE' ? null
    : identifiantNumerique(corps.site_destination_id, { champ: 'site_destination_id', libelle: 'Site de destination', obligatoire: true });
  if (source && source === destination) throw refus('site_destination_id', 'Les sites d’origine et de destination doivent être différents.');
  return { source, destination };
}

function lireLignes(corps, sites) {
  const lignes = Array.isArray(corps.lignes) ? corps.lignes : [];
  if (lignes.length === 0) throw refus('lignes', 'Ajoutez au moins une ligne : un article ou un matériel.');
  if (lignes.length > 200) throw refus('lignes', '200 lignes au plus par mouvement.');
  return lignes.map((ligne, rang) => {
    const libelle = `Ligne ${rang + 1}`;
    const articleId = identifiantNumerique(ligne?.article_id, { champ: 'lignes', libelle });
    const materielId = identifiantNumerique(ligne?.materiel_id, { champ: 'lignes', libelle });
    if (Boolean(articleId) === Boolean(materielId)) throw refus('lignes', `${libelle} : choisissez un article ou un matériel.`);
    const nombre = materielId ? 1 : quantite(ligne.quantite, { champ: 'lignes', libelle: `${libelle} — quantité`, obligatoire: true });
    if (nombre <= 0) throw refus('lignes', `${libelle} : la quantité doit être supérieure à zéro.`);
    return {
      article_id: articleId,
      materiel_id: materielId,
      quantite: nombre,
      site_source_id: sites.source,
      site_destination_id: sites.destination,
      observations: texte(ligne.observations, { champ: 'lignes', libelle: `${libelle} — observations`, max: 300 }),
    };
  });
}

async function ecrireLignes(client, mouvementId, lignes) {
  for (const ligne of lignes) {
    await client.query(
      `INSERT INTO lignes_mouvements (mouvement_id, article_id, materiel_id, quantite, site_source_id, site_destination_id, observations)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [mouvementId, ligne.article_id, ligne.materiel_id, ligne.quantite, ligne.site_source_id, ligne.site_destination_id, ligne.observations],
    );
  }
}

// Validation : la base contrôle tout et applique les effets ; si le mouvement
// demande une autorisation, celle ou celui qui valide l'autorise.
// Décision du 12/11 (plus d'écran Réceptions) : un transfert est reçu en entier
// au site de destination dès sa validation, par la personne qui l'envoie, à la
// date du mouvement. Les transferts restés « en route » d'avant cette décision
// se réceptionnent encore depuis leur fiche.
export async function validerMouvement(client, mouvementId, utilisateur) {
  const { rows: [mouvement] } = await client.query(
    `SELECT mv.statut, mv.type_code, mv.date_mouvement,
            (t.autorisation_obligatoire OR mv.mouvement_corrige_id IS NOT NULL) AS autorisation
       FROM mouvements mv JOIN types_mouvements t ON t.code = mv.type_code WHERE mv.id = $1 FOR UPDATE OF mv`,
    [mouvementId],
  );
  if (!mouvement) throw new ErreurApi(404, 'INTROUVABLE', 'Mouvement introuvable.');
  if (mouvement.statut !== 'BROUILLON') throw new ErreurApi(409, 'ENREGISTREMENT_FIGE', 'Ce mouvement n’est plus en brouillon.');
  await client.query(
    "UPDATE mouvements SET statut = 'VALIDE', autorise_par = CASE WHEN $2 THEN $3::bigint ELSE autorise_par END WHERE id = $1",
    [mouvementId, mouvement.autorisation, utilisateur.id],
  );
  if (mouvement.type_code === 'TRANSFERT') {
    await client.query("SELECT receptionner_transfert($1, '[]'::jsonb, NULL, $2::date)", [mouvementId, mouvement.date_mouvement]);
  }
}

async function lireMouvement(id, client) {
  const executant = client ?? { query: requete };
  const { rows: [mouvement] } = await executant.query(
    `SELECT mv.id, mv.reference, mv.type_code, t.libelle AS type, t.sens, t.pour_articles, t.pour_materiels,
            t.motif_obligatoire, t.beneficiaire_obligatoire, t.autorisation_obligatoire, t.ticket_obligatoire, t.saisie_manuelle,
            mv.date_mouvement, mv.statut, mv.motif, mv.numero_ticket, mv.reference_externe, mv.origine,
            mv.employe_beneficiaire_id, CASE WHEN e.id IS NOT NULL THEN concat_ws(' ', e.nom, e.prenoms) END AS employe_beneficiaire,
            e.matricule AS employe_matricule, mv.service_beneficiaire_id, sv.nom AS service_beneficiaire,
            mv.mouvement_corrige_id, mc.reference AS mouvement_corrige_reference,
            (t.autorisation_obligatoire OR mv.mouvement_corrige_id IS NOT NULL) AS autorisation_requise,
            CASE WHEN t.sens = 'TRANSFERT' AND mv.statut = 'VALIDE'
                 THEN CASE WHEN mv.recu_le IS NULL THEN 'EN_ROUTE' ELSE 'RECU' END END AS etat_transfert,
            mv.cree_par, uc.nom AS cree_par_nom, mv.cree_le,
            uv.nom AS valide_par_nom, mv.valide_le, uz.nom AS autorise_par_nom,
            mv.date_reception, ur.nom AS recu_par_nom, mv.recu_le, mv.motif_ecart,
            ua.nom AS annule_par_nom, mv.annule_le, mv.motif_annulation,
            EXISTS (SELECT 1 FROM affectations af WHERE af.mouvement_affectation_id = mv.id OR af.mouvement_retour_id = mv.id) AS lie_a_une_affectation,
            (SELECT json_agg(json_build_object('id', i.id, 'reference', i.reference, 'statut', i.statut) ORDER BY i.id)
               FROM mouvements i WHERE i.mouvement_corrige_id = mv.id) AS corrections
       FROM mouvements mv
       JOIN types_mouvements t ON t.code = mv.type_code
       LEFT JOIN employes e ON e.id = mv.employe_beneficiaire_id
       LEFT JOIN services sv ON sv.id = mv.service_beneficiaire_id
       LEFT JOIN mouvements mc ON mc.id = mv.mouvement_corrige_id
       JOIN utilisateurs uc ON uc.id = mv.cree_par
       LEFT JOIN utilisateurs uv ON uv.id = mv.valide_par
       LEFT JOIN utilisateurs uz ON uz.id = mv.autorise_par
       LEFT JOIN utilisateurs ur ON ur.id = mv.recu_par
       LEFT JOIN utilisateurs ua ON ua.id = mv.annule_par
      WHERE mv.id = $1`,
    [id],
  );
  if (!mouvement) return null;
  const { rows: lignes } = await executant.query(
    `SELECT l.id, l.article_id, l.materiel_id, l.quantite, l.quantite_recue, l.observations,
            coalesce(a.code, m.code) AS code, coalesce(a.designation, m.designation) AS designation,
            u.symbole, u.decimales, l.site_source_id, so.nom AS site_origine, l.site_destination_id, sd.nom AS site_destination,
            m.statut AS materiel_statut,
            (SELECT st.quantite FROM stocks_articles st WHERE st.article_id = l.article_id AND st.site_id = l.site_source_id) AS stock_origine
       FROM lignes_mouvements l
       LEFT JOIN articles a ON a.id = l.article_id
       LEFT JOIN unites u ON u.code = a.unite_code
       LEFT JOIN materiels m ON m.id = l.materiel_id
       LEFT JOIN sites so ON so.id = l.site_source_id
       LEFT JOIN sites sd ON sd.id = l.site_destination_id
      WHERE l.mouvement_id = $1 ORDER BY l.id`,
    [id],
  );
  return { ...mouvement, lignes };
}

async function verifierPerimetre(utilisateur, id) {
  const valeurs = [id];
  const condition = await conditionPerimetre(utilisateur, valeurs);
  if (!condition) return;
  const { rows } = await requete(`SELECT 1 FROM mouvements mv WHERE mv.id = $1 AND ${condition}`, valeurs);
  if (rows.length === 0) throw new ErreurApi(404, 'INTROUVABLE', 'Mouvement introuvable.');
}

const idMouvement = (req) => identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Mouvement', obligatoire: true });

// ---------------------------------------------------------------------------

routeurMouvements.get('/mouvements', lecture, async (req, res) => {
  const { page, parPage, decalage } = pagination(req.query);
  const valeurs = [];
  const conditions = [];
  const ajouter = (condition, valeur) => {
    valeurs.push(valeur);
    conditions.push(condition.replaceAll('?', `$${valeurs.length}`));
  };
  const limite = await conditionPerimetre(req.utilisateur, valeurs);
  if (limite) conditions.push(limite);
  const motif = motifRecherche(req.query.q);
  if (motif) {
    ajouter(`(mv.reference ILIKE ? OR coalesce(mv.numero_ticket, '') ILIKE ? OR coalesce(mv.motif, '') ILIKE ?
             OR coalesce(mv.reference_externe, '') ILIKE ?
             OR EXISTS (SELECT 1 FROM lignes_mouvements lq LEFT JOIN articles aq ON aq.id = lq.article_id
                          LEFT JOIN materiels mq ON mq.id = lq.materiel_id
                         WHERE lq.mouvement_id = mv.id AND (coalesce(aq.code, mq.code) ILIKE ? OR coalesce(aq.designation, mq.designation) ILIKE ?)))`, motif);
  }
  if (typeof req.query.type_code === 'string' && /^[A-Z_]{3,30}$/.test(req.query.type_code)) ajouter('mv.type_code = ?', req.query.type_code);
  if (['BROUILLON', 'VALIDE', 'ANNULE'].includes(req.query.statut)) ajouter('mv.statut = ?', req.query.statut);
  if (req.query.en_route === 'oui') conditions.push("mv.type_code = 'TRANSFERT' AND mv.statut = 'VALIDE' AND mv.recu_le IS NULL");
  if (req.query.a_autoriser === 'oui') {
    ajouter(`mv.statut = 'BROUILLON' AND mv.cree_par <> ?
             AND (mv.mouvement_corrige_id IS NOT NULL OR EXISTS (SELECT 1 FROM types_mouvements ta WHERE ta.code = mv.type_code AND ta.autorisation_obligatoire))`,
    req.utilisateur.id);
  }
  const debut = date(req.query.date_debut, { champ: 'date_debut', libelle: 'Du' });
  const fin = date(req.query.date_fin, { champ: 'date_fin', libelle: 'Au' });
  if (debut) ajouter('mv.date_mouvement >= ?', debut);
  if (fin) ajouter('mv.date_mouvement <= ?', fin);
  const site = filtreId(req.query.site_id);
  if (site) ajouter('EXISTS (SELECT 1 FROM lignes_mouvements ls WHERE ls.mouvement_id = mv.id AND (ls.site_source_id = ? OR ls.site_destination_id = ?))', site);
  const ou = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: [{ total }] } = await requete(`SELECT count(*)::int AS total FROM mouvements mv ${ou}`, valeurs);
  const { rows } = await requete(
    `SELECT mv.id, mv.reference, mv.date_mouvement, mv.type_code, t.libelle AS type, t.sens, mv.statut,
            CASE WHEN t.sens = 'TRANSFERT' AND mv.statut = 'VALIDE'
                 THEN CASE WHEN mv.recu_le IS NULL THEN 'EN_ROUTE' ELSE 'RECU' END END AS etat_transfert,
            mv.numero_ticket, mv.motif, uc.nom AS cree_par_nom, mv.cree_par,
            (t.autorisation_obligatoire OR mv.mouvement_corrige_id IS NOT NULL) AS autorisation_requise,
            CASE WHEN e.id IS NOT NULL THEN concat_ws(' ', e.nom, e.prenoms) ELSE sv.nom END AS beneficiaire,
            r.nb_lignes, r.premiere_ligne, r.site_origine, r.site_destination
       FROM mouvements mv
       JOIN types_mouvements t ON t.code = mv.type_code
       JOIN utilisateurs uc ON uc.id = mv.cree_par
       LEFT JOIN employes e ON e.id = mv.employe_beneficiaire_id
       LEFT JOIN services sv ON sv.id = mv.service_beneficiaire_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS nb_lignes,
                min(coalesce(a.designation, m.designation)) AS premiere_ligne,
                min(so.nom) AS site_origine, min(sd.nom) AS site_destination
           FROM lignes_mouvements l
           LEFT JOIN articles a ON a.id = l.article_id
           LEFT JOIN materiels m ON m.id = l.materiel_id
           LEFT JOIN sites so ON so.id = l.site_source_id
           LEFT JOIN sites sd ON sd.id = l.site_destination_id
          WHERE l.mouvement_id = mv.id) r ON true
       ${ou}
      ORDER BY mv.date_mouvement DESC, mv.id DESC
      LIMIT ${parPage} OFFSET ${decalage}`,
    valeurs,
  );
  res.json({ mouvements: rows, total, page, par_page: parPage });
});

// Transferts en route, à réceptionner (le responsable : ceux qui arrivent au site de son service).
routeurMouvements.get('/receptions', reception, async (req, res) => {
  const valeurs = [];
  let condition = '';
  const { serviceId } = perimetre(req.utilisateur);
  if (serviceId !== undefined) {
    valeurs.push(await siteDuService(serviceId));
    condition = 'WHERE r.site_destination_id = $1::bigint';
  }
  const { rows } = await requete(
    `SELECT r.mouvement_id AS id, r.reference, r.numero_ticket, r.date_envoi, r.jours_en_route,
            so.nom AS site_origine, sd.nom AS site_destination, r.site_destination_id, r.envoye_par, r.motif,
            json_agg(json_build_object('ligne_id', r.ligne_id, 'nature', r.nature, 'code', r.code_bien,
                                       'designation', r.designation, 'quantite', r.quantite, 'symbole', u.symbole,
                                       'decimales', coalesce(u.decimales, 0)) ORDER BY r.ligne_id) AS lignes
       FROM v_transferts_en_route r
       LEFT JOIN unites u ON u.code = r.unite_code
       JOIN sites so ON so.id = r.site_source_id
       JOIN sites sd ON sd.id = r.site_destination_id
       ${condition}
      GROUP BY r.mouvement_id, r.reference, r.numero_ticket, r.date_envoi, r.jours_en_route,
               so.nom, sd.nom, r.site_destination_id, r.envoye_par, r.motif
      ORDER BY r.date_envoi, r.mouvement_id`,
    valeurs,
  );
  res.json({ transferts: rows });
});

routeurMouvements.get('/mouvements/:id', lecture, async (req, res) => {
  const id = idMouvement(req);
  await verifierPerimetre(req.utilisateur, id);
  const mouvement = await lireMouvement(id);
  if (!mouvement) throw new ErreurApi(404, 'INTROUVABLE', 'Mouvement introuvable.');
  res.json({ mouvement });
});

// Création, en brouillon ou validée tout de suite (« valider »: true).
routeurMouvements.post('/mouvements', saisie, async (req, res) => {
  const corps = req.body ?? {};
  const type = await lireType(texte(corps.type_code, { champ: 'type_code', libelle: 'Type de mouvement', obligatoire: true, max: 30 }));
  if (!type.saisie_manuelle) {
    throw refus('type_code', 'Les affectations et les retours s’enregistrent depuis l’écran Affectations.');
  }
  const entete = lireEntete(corps);
  const lignes = lireLignes(corps, lireSites(corps, type));
  const mouvement = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [{ id, reference }] } = await client.query(
      `INSERT INTO mouvements (type_code, date_mouvement, motif, numero_ticket, reference_externe, origine,
                               employe_beneficiaire_id, service_beneficiaire_id)
       VALUES ($1, coalesce($2::date, aujourdhui()), $3, $4, $5, $6, $7, $8) RETURNING id, reference`,
      [type.code, entete.date_mouvement, entete.motif, entete.numero_ticket, entete.reference_externe, entete.origine,
        entete.employe_beneficiaire_id, entete.service_beneficiaire_id],
    );
    await ecrireLignes(client, id, lignes);
    if (corps.valider === true) await validerMouvement(client, id, req.utilisateur);
    await journaliser({
      utilisateurId: req.utilisateur.id, action: corps.valider === true ? 'MOUVEMENT_VALIDE' : 'MOUVEMENT_CREE',
      entite: 'mouvements', entiteId: id, metadonnees: { reference, type: type.code, lignes: lignes.length }, ip: req.ip,
    }, client);
    return lireMouvement(id, client);
  });
  res.status(201).json({ mouvement });
});

// Modification d'un brouillon : en-tête et lignes remplacés.
routeurMouvements.put('/mouvements/:id', saisie, async (req, res) => {
  const id = idMouvement(req);
  const corps = req.body ?? {};
  const { rows: [actuel] } = await requete('SELECT type_code, statut FROM mouvements WHERE id = $1', [id]);
  if (!actuel) throw new ErreurApi(404, 'INTROUVABLE', 'Mouvement introuvable.');
  if (actuel.statut !== 'BROUILLON') throw new ErreurApi(409, 'ENREGISTREMENT_FIGE', 'Seul un brouillon se modifie.');
  const type = await lireType(actuel.type_code);
  const entete = lireEntete(corps);
  const lignes = lireLignes(corps, lireSites(corps, type));
  const mouvement = await transaction(req.utilisateur.id, async (client) => {
    await client.query(
      `UPDATE mouvements
          SET date_mouvement = coalesce($2::date, aujourdhui()), motif = $3, numero_ticket = $4, reference_externe = $5,
              origine = $6, employe_beneficiaire_id = $7, service_beneficiaire_id = $8
        WHERE id = $1`,
      [id, entete.date_mouvement, entete.motif, entete.numero_ticket, entete.reference_externe, entete.origine,
        entete.employe_beneficiaire_id, entete.service_beneficiaire_id],
    );
    await client.query('DELETE FROM lignes_mouvements WHERE mouvement_id = $1', [id]);
    await ecrireLignes(client, id, lignes);
    if (corps.valider === true) await validerMouvement(client, id, req.utilisateur);
    await journaliser({
      utilisateurId: req.utilisateur.id, action: corps.valider === true ? 'MOUVEMENT_VALIDE' : 'MOUVEMENT_MODIFIE',
      entite: 'mouvements', entiteId: id, metadonnees: { lignes: lignes.length }, ip: req.ip,
    }, client);
    return lireMouvement(id, client);
  });
  res.json({ mouvement });
});

routeurMouvements.post('/mouvements/:id/valider', saisie, async (req, res) => {
  const id = idMouvement(req);
  const mouvement = await transaction(req.utilisateur.id, async (client) => {
    await validerMouvement(client, id, req.utilisateur);
    await journaliser({ utilisateurId: req.utilisateur.id, action: 'MOUVEMENT_VALIDE', entite: 'mouvements', entiteId: id, ip: req.ip }, client);
    return lireMouvement(id, client);
  });
  res.json({ mouvement });
});

routeurMouvements.post('/mouvements/:id/annuler', annulation, async (req, res) => {
  const id = idMouvement(req);
  const motif = texte(req.body?.motif, { champ: 'motif', libelle: 'Motif d’annulation', obligatoire: true, max: 500 });
  if (motif.length < 3) throw refus('motif', 'Motif d’annulation : 3 caractères au moins.');
  const mouvement = await transaction(req.utilisateur.id, async (client) => {
    const { rowCount } = await client.query(
      "UPDATE mouvements SET statut = 'ANNULE', motif_annulation = $2 WHERE id = $1", [id, motif],
    );
    if (rowCount === 0) throw new ErreurApi(404, 'INTROUVABLE', 'Mouvement introuvable.');
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'MOUVEMENT_ANNULE', entite: 'mouvements', entiteId: id,
      metadonnees: { motif }, ip: req.ip,
    }, client);
    return lireMouvement(id, client);
  });
  res.json({ mouvement });
});

// Mouvement inverse (articles) : brouillon qui défait un mouvement validé,
// à faire valider par une autre personne. Pour un matériel, on annule.
routeurMouvements.post('/mouvements/:id/inverse', saisie, async (req, res) => {
  const id = idMouvement(req);
  const motif = texte(req.body?.motif, { champ: 'motif', libelle: 'Motif', obligatoire: true, max: 400 });
  if (motif.length < 3) throw refus('motif', 'Motif : 3 caractères au moins.');
  const original = await lireMouvement(id);
  if (!original) throw new ErreurApi(404, 'INTROUVABLE', 'Mouvement introuvable.');
  if (original.statut !== 'VALIDE') throw new ErreurApi(409, 'INVERSE_IMPOSSIBLE', 'Seul un mouvement validé se corrige par un mouvement inverse.');
  if (original.lignes.some((ligne) => ligne.materiel_id)) {
    throw new ErreurApi(409, 'INVERSE_IMPOSSIBLE', 'Pour un matériel, annulez le mouvement ou passez l’opération inverse (retour, transfert…).');
  }
  if (original.etat_transfert === 'EN_ROUTE') throw new ErreurApi(409, 'INVERSE_IMPOSSIBLE', 'Ce transfert est encore en route : annulez-le plutôt.');
  const typeInverse = { ENTREE: 'CORRECTION_MOINS', SORTIE: 'CORRECTION_PLUS', TRANSFERT: 'TRANSFERT' }[original.sens];
  const lignes = original.lignes
    .map((ligne) => ({
      article_id: ligne.article_id,
      quantite: original.sens === 'TRANSFERT' ? ligne.quantite_recue : ligne.quantite,
      site_source_id: ligne.site_destination_id,
      site_destination_id: ligne.site_source_id,
    }))
    .filter((ligne) => ligne.quantite > 0);
  if (lignes.length === 0) throw new ErreurApi(409, 'INVERSE_IMPOSSIBLE', 'Rien à inverser : aucune quantité n’est arrivée.');

  const inverse = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [{ id: nouvelId }] } = await client.query(
      `INSERT INTO mouvements (type_code, motif, mouvement_corrige_id) VALUES ($1, $2, $3) RETURNING id`,
      [typeInverse, `Inverse de ${original.reference} : ${motif}`, id],
    );
    await ecrireLignes(client, nouvelId, lignes.map((ligne) => ({ ...ligne, materiel_id: null, observations: null })));
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'MOUVEMENT_INVERSE_CREE', entite: 'mouvements', entiteId: nouvelId,
      metadonnees: { corrige: original.reference, motif }, ip: req.ip,
    }, client);
    return lireMouvement(nouvelId, client);
  });
  res.status(201).json({ mouvement: inverse });
});

// Réception d'un transfert par le site de destination.
routeurMouvements.post('/mouvements/:id/receptionner', reception, async (req, res) => {
  const id = idMouvement(req);
  const corps = req.body ?? {};
  const { rows: lignes } = await requete('SELECT id, site_destination_id FROM lignes_mouvements WHERE mouvement_id = $1', [id]);
  if (lignes.length === 0) throw new ErreurApi(404, 'INTROUVABLE', 'Transfert introuvable.');
  const site = await siteDuService(req.utilisateur.service_id);
  if (!lignes.every((ligne) => peutReceptionner(req.utilisateur, ligne.site_destination_id, site))) {
    throw new ErreurApi(403, 'ACCES_REFUSE', 'Ce transfert n’arrive pas au site de votre service.');
  }
  const idsLignes = new Set(lignes.map((ligne) => ligne.id));
  const quantites = (Array.isArray(corps.quantites) ? corps.quantites : []).map((entree, rang) => {
    const ligneId = identifiantNumerique(entree?.ligne_id, { champ: 'quantites', libelle: `Ligne ${rang + 1}`, obligatoire: true });
    if (!idsLignes.has(ligneId)) throw refus('quantites', `La ligne ${ligneId} n’appartient pas à ce transfert.`);
    return { ligne_id: ligneId, quantite_recue: quantite(entree.quantite_recue, { champ: 'quantites', libelle: 'Quantité reçue', obligatoire: true }) };
  });
  const motifEcart = texte(corps.motif_ecart, { champ: 'motif_ecart', libelle: 'Motif du manquant', max: 500 });
  const dateReception = date(corps.date_reception, { champ: 'date_reception', libelle: 'Date de réception' });

  const mouvement = await transaction(req.utilisateur.id, async (client) => {
    await client.query('SELECT receptionner_transfert($1, $2::jsonb, $3, $4::date)', [id, JSON.stringify(quantites), motifEcart, dateReception]);
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'TRANSFERT_RECU', entite: 'mouvements', entiteId: id,
      metadonnees: { ecart: Boolean(motifEcart) }, ip: req.ip,
    }, client);
    return lireMouvement(id, client);
  });
  res.json({ mouvement });
});
