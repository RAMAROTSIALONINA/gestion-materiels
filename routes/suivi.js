// Suivi du parc et des stocks (phase 7) : historique des états de tous les
// matériels, alertes, journal des opérations. Cahier des charges § 3.1, § 3.7,
// § 7 ; décisions du 11/11 : délais d'alerte 3 / 30 / 7 jours modifiables,
// alertes du responsable limitées à son service, journal consultable par
// l'administrateur.
import { Router } from 'express';
import { requete } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { aLeDroit, perimetre } from '../middleware/permissions.js';
import { date, filtreId, motifRecherche, pagination } from '../services/validation.js';

export const routeurSuivi = Router();

const ETATS = ['NEUF', 'BON', 'MOYEN', 'ENDOMMAGE', 'HORS_SERVICE'];
const STATUTS = ['DISPONIBLE', 'AFFECTE', 'EN_REPARATION', 'EN_TRANSIT', 'PERDU', 'REFORME'];
const LIMITE_ALERTES = 50;
const jours = (n) => `${n} jour${n > 1 ? 's' : ''}`;

// Petite aide pour assembler des conditions paramétrées (« ? » → $n).
function filtres() {
  const valeurs = [];
  const conditions = [];
  return {
    valeurs,
    conditions,
    ajouter(condition, ...parametres) {
      let texte = condition;
      for (const valeur of parametres) {
        valeurs.push(valeur);
        texte = texte.replace('?', `$${valeurs.length}`);
      }
      conditions.push(texte);
    },
    ou: () => (conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''),
  };
}

const siteDuService = async (serviceId) => {
  if (!serviceId) return null;
  const { rows: [service] } = await requete('SELECT site_id FROM services WHERE id = $1', [serviceId]);
  return service?.site_id ?? null;
};

const parametresAlerte = async () => {
  const { rows } = await requete(
    "SELECT cle, valeur FROM parametres WHERE cle IN ('alerte_transfert_jours', 'alerte_reparation_jours', 'alerte_retour_jours')",
  );
  const valeur = (cle, defaut) => Number(rows.find((ligne) => ligne.cle === cle)?.valeur ?? defaut);
  return {
    transfert: valeur('alerte_transfert_jours', 3),
    reparation: valeur('alerte_reparation_jours', 30),
    retour: valeur('alerte_retour_jours', 7),
  };
};

// ---------------------------------------------------------------------------
// Historique des états de tout le parc (le responsable : son service).
// ---------------------------------------------------------------------------
routeurSuivi.get('/historique-etats', exigerDroit('materiels.lire'), async (req, res) => {
  const { page, parPage, decalage } = pagination(req.query, { parDefaut: 50 });
  const f = filtres();
  const { serviceId, employeId } = perimetre(req.utilisateur);
  if (employeId !== undefined) f.conditions.push('false');
  if (serviceId !== undefined) {
    if (serviceId) f.ajouter('m.service_id = ?', serviceId);
    else f.conditions.push('false');
  }
  const motif = motifRecherche(req.query.q);
  if (motif) f.ajouter('(m.code ILIKE ? OR m.designation ILIKE ? OR coalesce(h.commentaire, \'\') ILIKE ?)', motif, motif, motif);
  if (ETATS.includes(req.query.etat)) f.ajouter('h.nouvel_etat = ?', req.query.etat);
  if (STATUTS.includes(req.query.statut)) f.ajouter('h.nouveau_statut = ?', req.query.statut);
  const site = filtreId(req.query.site_id);
  if (site) f.ajouter('m.site_id = ?', site);
  const materiel = filtreId(req.query.materiel_id);
  if (materiel) f.ajouter('m.id = ?', materiel);
  if (req.query.changements === 'oui') f.conditions.push('h.ancien_etat IS NOT NULL');
  const debut = date(req.query.date_debut, { champ: 'date_debut', libelle: 'Du' });
  const fin = date(req.query.date_fin, { champ: 'date_fin', libelle: 'Au' });
  if (debut) f.ajouter('(h.date_changement AT TIME ZONE fuseau_horaire())::date >= ?', debut);
  if (fin) f.ajouter('(h.date_changement AT TIME ZONE fuseau_horaire())::date <= ?', fin);
  const depuis = `FROM historiques_etats h JOIN materiels m ON m.id = h.materiel_id
                  JOIN sites s ON s.id = m.site_id JOIN utilisateurs u ON u.id = h.auteur_id ${f.ou()}`;

  const { rows: [{ total }] } = await requete(`SELECT count(*)::int AS total ${depuis}`, f.valeurs);
  const { rows } = await requete(
    `SELECT h.id, h.date_changement, h.materiel_id, m.code, m.designation, s.nom AS site,
            h.ancien_etat, h.nouvel_etat, h.ancien_statut, h.nouveau_statut, h.commentaire, u.nom AS auteur
       ${depuis}
      ORDER BY h.date_changement DESC, h.id DESC
      LIMIT ${parPage} OFFSET ${decalage}`,
    f.valeurs,
  );
  res.json({ historique: rows, total, page, par_page: parPage });
});

// ---------------------------------------------------------------------------
// Alertes : chaque rubrique rend { code, titre, niveau, nombre, elements }.
// niveau : « danger » (à traiter vite), « attention », « info » (non compté
// dans la pastille du menu).
// ---------------------------------------------------------------------------
async function rubriques(utilisateur) {
  const delais = await parametresAlerte();
  const { serviceId } = perimetre(utilisateur);
  const responsable = serviceId !== undefined;
  const site = responsable ? await siteDuService(serviceId) : null;
  const liste = async (sql, valeurs) => (await requete(sql, valeurs)).rows;
  const resultats = [];
  const ajouter = (code, titre, niveau, elements, total = elements.length) => {
    resultats.push({ code, titre, niveau, nombre: total, elements: elements.slice(0, LIMITE_ALERTES) });
  };
  const limiteService = (colonne, valeurs) => {
    if (!responsable) return 'true';
    valeurs.push(serviceId ?? 0);
    return `${colonne} = $${valeurs.length}`;
  };

  // 1. Stocks sous le seuil (le responsable : seuils du site de son service).
  {
    const valeurs = [];
    let condition = 'true';
    if (responsable) {
      valeurs.push(site ?? 0);
      condition = `a.portee = 'SITE' AND a.site_id = $1`;
    }
    ajouter('stock', 'Stocks sous le seuil', 'danger', await liste(
      `SELECT a.portee, a.article_id, a.code, a.designation, a.quantite, a.seuil, a.en_rupture,
              a.site_id, s.nom AS site, u.symbole, u.decimales
         FROM v_alertes_stock a
         JOIN unites u ON u.code = a.unite_code
         LEFT JOIN sites s ON s.id = a.site_id
        WHERE ${condition}
        ORDER BY a.en_rupture DESC, a.portee, lower(a.designation), s.nom`, valeurs));
  }

  // 2. Retours en retard, 3. retours prévus dans les prochains jours.
  for (const [code, titre, niveau, periode] of [
    ['retours_retard', 'Retours en retard', 'danger', 'af.date_retour_prevue < aujourdhui()'],
    ['retours_proches', delais.retour === 0 ? 'Retours prévus aujourd’hui' : `Retours prévus d’ici ${jours(delais.retour)}`, 'info',
      `af.date_retour_prevue BETWEEN aujourdhui() AND aujourdhui() + ${Number(delais.retour)}`],
  ]) {
    const valeurs = [];
    const perimetreSql = responsable ? `(${limiteService('e.service_id', valeurs)} OR m.service_id = $${valeurs.length})` : 'true';
    ajouter(code, titre, niveau, await liste(
      `SELECT af.id AS affectation_id, af.materiel_id, m.code, m.designation,
              concat_ws(' ', e.nom, e.prenoms) AS employe, e.matricule, sv.nom AS service,
              af.numero_contrat, af.date_retour_prevue, aujourdhui() - af.date_retour_prevue AS jours_de_retard
         FROM affectations af
         JOIN materiels m ON m.id = af.materiel_id
         JOIN employes e ON e.id = af.employe_id
         LEFT JOIN services sv ON sv.id = e.service_id
        WHERE af.date_retour IS NULL AND ${periode} AND ${perimetreSql}
        ORDER BY af.date_retour_prevue, m.code`, valeurs));
  }

  // 4. Transferts en route depuis trop longtemps.
  {
    const valeurs = [delais.transfert];
    let condition = 'true';
    if (responsable) {
      valeurs.push(site ?? 0);
      condition = '(r.site_source_id = $2 OR r.site_destination_id = $2)';
    }
    ajouter('transferts', `Transferts en route depuis ${jours(delais.transfert)} ou plus`, 'attention', await liste(
      `SELECT r.mouvement_id AS id, r.reference, r.date_envoi, r.jours_en_route,
              so.nom AS site_origine, sd.nom AS site_destination, count(*)::int AS nb_lignes,
              min(r.designation) AS premiere_ligne
         FROM v_transferts_en_route r
         JOIN sites so ON so.id = r.site_source_id
         JOIN sites sd ON sd.id = r.site_destination_id
        WHERE r.jours_en_route >= $1 AND ${condition}
        GROUP BY r.mouvement_id, r.reference, r.date_envoi, r.jours_en_route, so.nom, sd.nom
        ORDER BY r.date_envoi, r.mouvement_id`, valeurs));
  }

  // 5. Réparations qui durent.
  {
    const valeurs = [delais.reparation];
    const condition = limiteService('r.service_id', valeurs);
    ajouter('reparations', `En réparation depuis ${jours(delais.reparation)} ou plus`, 'attention', await liste(
      `SELECT r.materiel_id, r.code, r.designation, r.etat, r.site, r.service, r.depuis, r.jours, r.commentaire
         FROM v_reparations_en_cours r
        WHERE coalesce(r.jours, 0) >= $1 AND ${condition}
        ORDER BY r.depuis NULLS FIRST, r.code`, valeurs));
  }

  // 6. Matériels endommagés encore en service (disponibles ou remis).
  {
    const valeurs = [];
    const condition = limiteService('v.service_id', valeurs);
    ajouter('endommages', 'Matériels endommagés encore en service', 'attention', await liste(
      `SELECT v.id AS materiel_id, v.code, v.designation, v.statut, v.site, v.service, v.responsable
         FROM v_materiels v
        WHERE v.etat = 'ENDOMMAGE' AND v.statut IN ('DISPONIBLE', 'AFFECTE') AND ${condition}
        ORDER BY v.code`, valeurs));
  }

  // 7. Signalements à traiter, 8. mouvements à autoriser, 9. étiquettes à imprimer.
  if (aLeDroit(utilisateur.role_code, 'signalements.traiter')) {
    ajouter('signalements', 'Signalements à traiter', 'attention', await liste(
      `SELECT sg.id, sg.type, sg.statut, sg.cree_le, sg.description, m.id AS materiel_id, m.code, m.designation, u.nom AS auteur
         FROM signalements sg JOIN materiels m ON m.id = sg.materiel_id JOIN utilisateurs u ON u.id = sg.auteur_id
        WHERE sg.statut <> 'CLOS'
        ORDER BY sg.cree_le`));
  }
  if (aLeDroit(utilisateur.role_code, 'mouvements.autoriser')) {
    ajouter('a_autoriser', 'Mouvements à autoriser', 'attention', await liste(
      `SELECT mv.id, mv.reference, mv.date_mouvement, t.libelle AS type, mv.motif, uc.nom AS cree_par_nom
         FROM mouvements mv
         JOIN types_mouvements t ON t.code = mv.type_code
         JOIN utilisateurs uc ON uc.id = mv.cree_par
        WHERE mv.statut = 'BROUILLON' AND mv.cree_par <> $1
          AND (t.autorisation_obligatoire OR mv.mouvement_corrige_id IS NOT NULL)
        ORDER BY mv.date_mouvement, mv.id`, [utilisateur.id]));
  }
  if (aLeDroit(utilisateur.role_code, 'materiels.gerer')) {
    const { rows: [{ nombre }] } = await requete(
      "SELECT count(*)::int AS nombre FROM materiels WHERE etiquette_imprimee_le IS NULL AND statut NOT IN ('PERDU', 'REFORME')",
    );
    ajouter('etiquettes', 'Matériels sans étiquette imprimée', 'info', [], nombre);
  }
  return { delais, rubriques: resultats };
}

routeurSuivi.get('/alertes', exigerDroit('alertes.lire'), async (req, res) => {
  const { delais, rubriques: liste } = await rubriques(req.utilisateur);
  const total = liste.filter((r) => r.niveau !== 'info').reduce((somme, r) => somme + r.nombre, 0);
  if (req.query.resume === 'oui') {
    return res.json({ total, rubriques: liste.map(({ code, niveau, nombre }) => ({ code, niveau, nombre })) });
  }
  res.json({ total, delais, rubriques: liste });
});

// ---------------------------------------------------------------------------
// Journal des opérations (administrateur).
// ---------------------------------------------------------------------------
routeurSuivi.get('/journal', exigerDroit('journal.lire'), async (req, res) => {
  const { page, parPage, decalage } = pagination(req.query, { parDefaut: 50 });
  const f = filtres();
  if (typeof req.query.action === 'string' && /^[A-Z_]{2,40}$/.test(req.query.action)) f.ajouter('j.action = ?', req.query.action);
  const auteur = filtreId(req.query.utilisateur_id);
  if (auteur) f.ajouter('j.utilisateur_id = ?', auteur);
  const motif = motifRecherche(req.query.q);
  if (motif) {
    f.ajouter(`(coalesce(j.entite, '') ILIKE ? OR j.metadonnees::text ILIKE ? OR coalesce(host(j.adresse_ip), '') ILIKE ?)`,
      motif, motif, motif);
  }
  const debut = date(req.query.date_debut, { champ: 'date_debut', libelle: 'Du' });
  const fin = date(req.query.date_fin, { champ: 'date_fin', libelle: 'Au' });
  if (debut) f.ajouter('(j.date_action AT TIME ZONE fuseau_horaire())::date >= ?', debut);
  if (fin) f.ajouter('(j.date_action AT TIME ZONE fuseau_horaire())::date <= ?', fin);

  const { rows: [{ total }] } = await requete(`SELECT count(*)::int AS total FROM historique_actions j ${f.ou()}`, f.valeurs);
  const [lignes, actions, utilisateurs] = await Promise.all([
    requete(
      `SELECT j.id, j.date_action, j.utilisateur_id, u.nom AS utilisateur, j.action, j.entite, j.entite_id,
              j.metadonnees, host(j.adresse_ip) AS adresse_ip
         FROM historique_actions j LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id
         ${f.ou()}
        ORDER BY j.date_action DESC, j.id DESC
        LIMIT ${parPage} OFFSET ${decalage}`,
      f.valeurs,
    ),
    requete('SELECT DISTINCT action FROM historique_actions ORDER BY action'),
    requete('SELECT id, nom FROM utilisateurs ORDER BY nom'),
  ]);
  res.json({
    journal: lignes.rows, total, page, par_page: parPage,
    actions: actions.rows.map((ligne) => ligne.action), utilisateurs: utilisateurs.rows,
  });
});
