// Matériels durables : liste, recherche (y compris par scan du code-barres),
// fiche, création avec réception, modification, étiquettes.
// Cahier des charges § 3.2 et scénario 4.1.
//
// Le site, l'état et le statut ne se modifient pas par PATCH : le site change
// par un transfert, le statut par les mouvements et les affectations (règles
// tenues par la base). L'état, et le passage disponible ⇄ en réparation, se
// changent par POST /materiels/:id/etat, avec un commentaire historisé.
import { Router } from 'express';
import { poserCommentaire, requete, transaction } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { ErreurApi } from '../middleware/erreurs.js';
import { perimetre } from '../middleware/permissions.js';
import { differences, journaliser, miseAJour } from '../services/journal.js';
import {
  CODE_BIEN, choix, date, filtreId, identifiantNumerique, montant, motifRecherche, pagination, texte,
} from '../services/validation.js';

export const routeurMateriels = Router();
const lecture = exigerDroit('materiels.lire');
const gestion = exigerDroit('materiels.gerer');

const ETATS = ['NEUF', 'BON', 'MOYEN', 'ENDOMMAGE', 'HORS_SERVICE'];
const STATUTS = ['DISPONIBLE', 'AFFECTE', 'EN_REPARATION', 'EN_TRANSIT', 'PERDU', 'REFORME'];
const TRIS = { code: 'v.code', designation: 'lower(v.designation), v.code', recent: 'v.cree_le DESC, v.id DESC' };

// Condition SQL du périmètre : un responsable ne voit que les matériels de son service.
function conditionPerimetre(utilisateur, valeurs) {
  const { serviceId, employeId } = perimetre(utilisateur);
  if (serviceId !== undefined) {
    if (!serviceId) return 'false';
    valeurs.push(serviceId);
    return `v.service_id = $${valeurs.length}`;
  }
  if (employeId !== undefined) return 'false';      // l'employé passe par « Mes matériels »
  return null;
}

function lireSaisie(corps, partiel) {
  const present = (cle) => !partiel || Object.hasOwn(corps, cle);
  const s = {};
  if (!partiel) {
    s.code = texte(corps.code, {
      champ: 'code', libelle: 'Code', max: 40, majuscules: true, motif: CODE_BIEN,
      messageMotif: 'Code : majuscules, chiffres et . _ / - (laissez vide pour un code automatique).',
    });
  }
  if (present('designation')) s.designation = texte(corps.designation, { champ: 'designation', libelle: 'Désignation', obligatoire: true, max: 150 });
  if (present('categorie_id')) s.categorie_id = identifiantNumerique(corps.categorie_id, { champ: 'categorie_id', libelle: 'Catégorie', obligatoire: true });
  if (present('marque')) s.marque = texte(corps.marque, { champ: 'marque', libelle: 'Marque', max: 80 });
  if (present('modele')) s.modele = texte(corps.modele, { champ: 'modele', libelle: 'Modèle', max: 80 });
  if (present('numero_serie')) s.numero_serie = texte(corps.numero_serie, { champ: 'numero_serie', libelle: 'Numéro de série', max: 80 });
  if (present('date_achat')) s.date_achat = date(corps.date_achat, { champ: 'date_achat', libelle: 'Date d’achat' });
  if (present('prix_achat')) s.prix_achat = montant(corps.prix_achat, { champ: 'prix_achat', libelle: 'Prix d’achat' });
  if (present('fournisseur')) s.fournisseur = texte(corps.fournisseur, { champ: 'fournisseur', libelle: 'Fournisseur', max: 120 });
  if (present('service_id')) s.service_id = identifiantNumerique(corps.service_id, { champ: 'service_id', libelle: 'Service' });
  if (present('observations')) s.observations = texte(corps.observations, { champ: 'observations', libelle: 'Observations', max: 1000 });
  if (!partiel) {
    s.site_id = identifiantNumerique(corps.site_id, { champ: 'site_id', libelle: 'Site', obligatoire: true });
    s.etat = choix(corps.etat ?? 'NEUF', ETATS, { champ: 'etat', libelle: 'État', obligatoire: true });
    s.statut = choix(corps.statut ?? 'DISPONIBLE', ['DISPONIBLE', 'EN_REPARATION'], { champ: 'statut', libelle: 'Statut', obligatoire: true });
  }
  return s;
}

async function lireFiche(id, client) {
  const executant = client ?? { query: requete };
  const { rows: [materiel] } = await executant.query(
    `SELECT v.*, m.cree_par, uc.nom AS cree_par_nom, um.nom AS modifie_par_nom
       FROM v_materiels v
       JOIN materiels m ON m.id = v.id
       LEFT JOIN utilisateurs uc ON uc.id = m.cree_par
       LEFT JOIN utilisateurs um ON um.id = m.modifie_par
      WHERE v.id = $1`,
    [id],
  );
  return materiel ?? null;
}

function idsDemandes(source) {
  const brut = Array.isArray(source) ? source : String(source ?? '').split(',');
  const ids = [...new Set(brut.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) throw new ErreurApi(422, 'SAISIE_VIDE', 'Choisissez au moins un matériel.');
  if (ids.length > 200) throw new ErreurApi(422, 'TROP_D_ELEMENTS', '200 étiquettes au plus à la fois.');
  return ids;
}

routeurMateriels.get('/materiels', lecture, async (req, res) => {
  const { page, parPage, decalage } = pagination(req.query);
  const valeurs = [];
  const conditions = [];
  const ajouter = (condition, valeur) => {
    valeurs.push(valeur);
    conditions.push(condition.replaceAll('?', `$${valeurs.length}`));
  };
  const limite = conditionPerimetre(req.utilisateur, valeurs);
  if (limite) conditions.push(limite);

  const motif = motifRecherche(req.query.q);
  if (motif) {
    ajouter(`(v.code ILIKE ? OR v.designation ILIKE ? OR coalesce(v.numero_serie, '') ILIKE ?
             OR coalesce(v.marque, '') ILIKE ? OR coalesce(v.modele, '') ILIKE ? OR coalesce(v.responsable, '') ILIKE ?)`, motif);
  }
  if (STATUTS.includes(req.query.statut)) ajouter('v.statut = ?', req.query.statut);
  if (ETATS.includes(req.query.etat)) ajouter('v.etat = ?', req.query.etat);
  for (const cle of ['site_id', 'service_id', 'categorie_id']) {
    const valeur = filtreId(req.query[cle]);
    if (valeur) ajouter(`v.${cle} = ?`, valeur);
  }
  if (req.query.retard === 'oui') conditions.push('v.retour_en_retard');
  if (req.query.sans_etiquette === 'oui') conditions.push('v.etiquette_imprimee_le IS NULL');
  const ou = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const tri = TRIS[req.query.tri] ?? TRIS.code;

  const { rows: [{ total }] } = await requete(`SELECT count(*)::int AS total FROM v_materiels v ${ou}`, valeurs);
  const { rows } = await requete(
    `SELECT v.id, v.code, v.designation, v.categorie, v.marque, v.modele, v.numero_serie,
            v.site_code, v.site, v.service, v.etat, v.statut, v.responsable, v.date_retour_prevue,
            v.retour_en_retard, v.etiquette_imprimee_le
       FROM v_materiels v ${ou}
      ORDER BY ${tri}
      LIMIT ${parPage} OFFSET ${decalage}`,
    valeurs,
  );
  res.json({ materiels: rows, total, page, par_page: parPage });
});

// Recherche exacte par code : c'est ce que tape un lecteur de code-barres.
routeurMateriels.get('/materiels/par-code', lecture, async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code.trim().toUpperCase() : '';
  if (!code) throw new ErreurApi(422, 'SAISIE_VIDE', 'Code à rechercher absent.');
  const valeurs = [code];
  const limite = conditionPerimetre(req.utilisateur, valeurs);
  const { rows: [trouve] } = await requete(
    `SELECT v.id, v.code, v.designation, v.site_id, v.site, v.etat, v.statut, v.responsable, v.affectation_id
       FROM v_materiels v WHERE v.code = $1 ${limite ? `AND ${limite}` : ''}`,
    valeurs,
  );
  if (!trouve) throw new ErreurApi(404, 'INTROUVABLE', `Aucun matériel avec le code ${code}.`);
  res.json({ materiel: trouve });
});

routeurMateriels.get('/materiels/etiquettes', gestion, async (req, res) => {
  const ids = idsDemandes(req.query.ids);
  const { rows } = await requete(
    `SELECT v.id, v.code, v.designation, v.site_code, v.etiquette_imprimee_le
       FROM v_materiels v WHERE v.id = ANY($1::bigint[])`,
    [ids],
  );
  const { rows: [{ societe }] } = await requete("SELECT parametre('nom_societe') AS societe");
  const parId = new Map(rows.map((ligne) => [ligne.id, ligne]));
  res.json({ societe, etiquettes: ids.map((id) => parId.get(id)).filter(Boolean) });
});

routeurMateriels.post('/materiels/etiquettes', gestion, async (req, res) => {
  const ids = idsDemandes(req.body?.ids);
  const nombre = await transaction(req.utilisateur.id, async (client) => {
    const { rowCount } = await client.query(
      'UPDATE materiels SET etiquette_imprimee_le = now() WHERE id = ANY($1::bigint[])', [ids],
    );
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'IMPRESSION_ETIQUETTE', entite: 'materiels',
      metadonnees: { ids, nombre: rowCount }, ip: req.ip,
    }, client);
    return rowCount;
  });
  res.json({ imprimees: nombre });
});

routeurMateriels.get('/materiels/:id', lecture, async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Matériel', obligatoire: true });
  const materiel = await lireFiche(id);
  const { serviceId, employeId } = perimetre(req.utilisateur);
  const horsPerimetre = (serviceId !== undefined && (!serviceId || materiel?.service_id !== serviceId))
    || employeId !== undefined;
  if (!materiel || horsPerimetre) throw new ErreurApi(404, 'INTROUVABLE', 'Matériel introuvable.');

  const [historique, mouvements, affectations] = await Promise.all([
    requete(
      `SELECT h.id, h.date_changement, h.ancien_etat, h.nouvel_etat, h.ancien_statut, h.nouveau_statut,
              h.commentaire, u.nom AS auteur
         FROM historiques_etats h JOIN utilisateurs u ON u.id = h.auteur_id
        WHERE h.materiel_id = $1
        ORDER BY h.date_changement DESC, h.id DESC LIMIT 100`, [id]),
    requete(
      `SELECT mouvement_id, reference, date_mouvement, type, sens, statut, etat_transfert, numero_ticket,
              site_origine, site_destination, employe_beneficiaire, motif, cree_par, motif_annulation
         FROM v_mouvements_lignes
        WHERE materiel_id = $1
        ORDER BY date_mouvement DESC, mouvement_id DESC LIMIT 100`, [id]),
    requete(
      `SELECT a.id, a.numero_contrat, a.date_remise, a.date_retour_prevue, a.date_retour,
              a.etat_remise, a.etat_retour, a.observations_retour,
              e.matricule, concat_ws(' ', e.nom, e.prenoms) AS employe
         FROM affectations a JOIN employes e ON e.id = a.employe_id
        WHERE a.materiel_id = $1
        ORDER BY a.date_remise DESC, a.id DESC`, [id]),
  ]);
  res.json({ materiel, historique: historique.rows, mouvements: mouvements.rows, affectations: affectations.rows });
});

// Création : fiche + mouvement de réception validé, dans une seule transaction
// (scénario 4.1 : « une entrée ou un mouvement de réception est conservé »).
routeurMateriels.post('/materiels', gestion, async (req, res) => {
  const corps = req.body ?? {};
  const saisie = lireSaisie(corps, false);
  const reception = corps.reception ?? {};
  const typeReception = choix(reception.type ?? 'RECEPTION_ACHAT', ['RECEPTION_ACHAT', 'RECEPTION_DON'], {
    champ: 'reception.type', libelle: 'Type de réception', obligatoire: true,
  });
  const dateReception = date(reception.date, { champ: 'reception.date', libelle: 'Date de réception' });
  const origine = texte(reception.origine, { champ: 'reception.origine', libelle: 'Fournisseur ou donateur', max: 120 }) ?? saisie.fournisseur;
  const referenceExterne = texte(reception.reference_externe, { champ: 'reception.reference_externe', libelle: 'N° de bon de livraison', max: 60 });

  const materiel = await transaction(req.utilisateur.id, async (client) => {
    const colonnes = Object.keys(saisie).filter((colonne) => saisie[colonne] !== null || colonne === 'code');
    const { rows: [cree] } = await client.query(
      `INSERT INTO materiels (${colonnes.join(', ')}) VALUES (${colonnes.map((_, rang) => `$${rang + 1}`).join(', ')})
       RETURNING id, code`,
      colonnes.map((colonne) => saisie[colonne]),
    );
    const { rows: [mouvement] } = await client.query(
      `INSERT INTO mouvements (type_code, date_mouvement, motif, origine, reference_externe)
       VALUES ($1, coalesce($2::date, aujourdhui()), $3, $4, $5) RETURNING id, reference`,
      [typeReception, dateReception, `Réception du matériel ${cree.code}`, origine, referenceExterne],
    );
    await client.query(
      'INSERT INTO lignes_mouvements (mouvement_id, materiel_id, quantite, site_destination_id) VALUES ($1, $2, 1, $3)',
      [mouvement.id, cree.id, saisie.site_id],
    );
    await client.query("UPDATE mouvements SET statut = 'VALIDE' WHERE id = $1", [mouvement.id]);
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'MATERIEL_CREE', entite: 'materiels', entiteId: cree.id,
      metadonnees: { code: cree.code, reception: mouvement.reference }, ip: req.ip,
    }, client);
    return lireFiche(cree.id, client);
  });
  res.status(201).json({ materiel });
});

// Changement d'état à la main (cahier § 3.7, recette 10) : nouvel état et/ou
// passage disponible ⇄ en réparation. La base historise le changement avec
// son auteur, sa date et le commentaire, exigé pour « endommagé », « hors
// service » et « en réparation ». Décision du 11/11 : au retour de réparation,
// le gestionnaire choisit librement l'état (il peut rester endommagé).
routeurMateriels.post('/materiels/:id/etat', gestion, async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Matériel', obligatoire: true });
  const corps = req.body ?? {};
  const etat = choix(corps.etat, ETATS, { champ: 'etat', libelle: 'État' });
  const statut = choix(corps.statut, ['DISPONIBLE', 'EN_REPARATION'], { champ: 'statut', libelle: 'Statut' });
  const commentaire = texte(corps.commentaire, { champ: 'commentaire', libelle: 'Commentaire', max: 500 });
  if (!etat && !statut) throw new ErreurApi(422, 'SAISIE_VIDE', 'Choisissez un nouvel état ou un nouveau statut.');

  const materiel = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [avant] } = await client.query('SELECT code, etat, statut FROM materiels WHERE id = $1 FOR UPDATE', [id]);
    if (!avant) throw new ErreurApi(404, 'INTROUVABLE', 'Matériel introuvable.');
    if (!['DISPONIBLE', 'EN_REPARATION', 'AFFECTE'].includes(avant.statut)) {
      throw new ErreurApi(409, 'ENREGISTREMENT_FIGE', {
        EN_TRANSIT: 'Ce matériel est en route : son état se constate à la réception du transfert.',
        PERDU: 'Ce matériel est déclaré perdu : son état ne se change plus.',
        REFORME: 'Ce matériel est réformé : son état ne se change plus.',
      }[avant.statut]);
    }
    if (statut && statut !== avant.statut && avant.statut === 'AFFECTE') {
      throw new ErreurApi(409, 'ENREGISTREMENT_FIGE',
        'Ce matériel est remis à un employé : enregistrez d’abord son retour (en état « endommagé », il part en réparation).', { champ: 'statut' });
    }
    const nouvelEtat = etat ?? avant.etat;
    const nouveauStatut = statut ?? avant.statut;
    if (nouvelEtat === avant.etat && nouveauStatut === avant.statut) {
      throw new ErreurApi(422, 'SAISIE_VIDE', 'Ni l’état ni le statut ne changent.');
    }
    if (nouvelEtat === 'HORS_SERVICE' && nouveauStatut !== 'EN_REPARATION') {
      throw new ErreurApi(422, 'REGLE_NON_RESPECTEE', avant.statut === 'AFFECTE'
        ? 'Un matériel hors service ne peut pas rester chez l’employé : enregistrez son retour en état « hors service ».'
        : 'Un matériel hors service ne peut pas rester disponible : passez-le « en réparation » (en attente de décision) ou mettez-le au rebut.',
      { champ: 'etat' });
    }
    const signaleUnProbleme = (nouvelEtat !== avant.etat && ['ENDOMMAGE', 'HORS_SERVICE'].includes(nouvelEtat))
      || (nouveauStatut !== avant.statut && nouveauStatut === 'EN_REPARATION');
    if (signaleUnProbleme && (!commentaire || commentaire.length < 3)) {
      throw new ErreurApi(422, 'INFORMATION_MANQUANTE',
        'Commentaire obligatoire pour un matériel endommagé, hors service ou envoyé en réparation : décrivez le problème.', { champ: 'commentaire' });
    }
    await poserCommentaire(client, commentaire);
    await client.query('UPDATE materiels SET etat = $2, statut = $3 WHERE id = $1', [id, nouvelEtat, nouveauStatut]);
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'MATERIEL_ETAT', entite: 'materiels', entiteId: id,
      metadonnees: {
        ...(nouvelEtat !== avant.etat ? { etat: { avant: avant.etat, apres: nouvelEtat } } : {}),
        ...(nouveauStatut !== avant.statut ? { statut: { avant: avant.statut, apres: nouveauStatut } } : {}),
        ...(commentaire ? { commentaire } : {}),
      },
      ip: req.ip,
    }, client);
    return lireFiche(id, client);
  });
  res.json({ materiel });
});

routeurMateriels.patch('/materiels/:id', gestion, async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Matériel', obligatoire: true });
  const corps = req.body ?? {};
  for (const interdit of ['code', 'site_id', 'etat', 'statut']) {
    if (Object.hasOwn(corps, interdit)) {
      throw new ErreurApi(422, 'CHAMP_NON_MODIFIABLE', {
        code: 'Le code d’un matériel ne change pas : il est imprimé sur son étiquette.',
        site_id: 'Le site change par un transfert (envoi puis réception).',
        etat: 'L’état se change depuis l’écran des états, avec un commentaire.',
        statut: 'Le statut change par les mouvements et les affectations.',
      }[interdit], { champ: interdit });
    }
  }
  const saisie = lireSaisie(corps, true);
  if (Object.keys(saisie).length === 0) throw new ErreurApi(422, 'SAISIE_VIDE', 'Aucune modification reçue.');
  const materiel = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [avant] } = await client.query('SELECT * FROM materiels WHERE id = $1 FOR UPDATE', [id]);
    if (!avant) throw new ErreurApi(404, 'INTROUVABLE', 'Matériel introuvable.');
    const { texte: sql, valeurs } = miseAJour('materiels', id, saisie);
    await client.query(sql, valeurs);
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'MATERIEL_MODIFIE', entite: 'materiels', entiteId: id,
      metadonnees: differences(avant, saisie), ip: req.ip,
    }, client);
    return lireFiche(id, client);
  });
  res.json({ materiel });
});
