// Affectations : remise d'un matériel à un employé sous contrat, retour,
// prolongation. Cahier des charges § 3.6 et scénario 4.2 ; décisions du 11/11 :
// n° de ticket obligatoire, contrat avec date de retour prévue, statut au
// retour selon l'état constaté (appliqué par la base).
import { Router } from 'express';
import { requete, transaction } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { ErreurApi } from '../middleware/erreurs.js';
import { perimetre } from '../middleware/permissions.js';
import { journaliser } from '../services/journal.js';
import {
  choix, date, filtreId, identifiantNumerique, motifRecherche, pagination, texte,
} from '../services/validation.js';
import { validerMouvement } from './mouvements.js';

export const routeurAffectations = Router();
const lecture = exigerDroit('affectations.lire');
const gestion = exigerDroit('affectations.gerer');

const ETATS = ['NEUF', 'BON', 'MOYEN', 'ENDOMMAGE', 'HORS_SERVICE'];
const refus = (champ, message) => new ErreurApi(422, 'SAISIE_INVALIDE', message, { champ });

const SELECTION = `
  SELECT af.id, af.materiel_id, m.code, m.designation, m.site_id, s.nom AS site, m.statut AS materiel_statut,
         af.employe_id, e.matricule, concat_ws(' ', e.nom, e.prenoms) AS employe, sv.nom AS service,
         af.numero_contrat, af.date_remise, af.date_retour_prevue, af.date_retour, af.etat_remise, af.etat_retour,
         af.observations_remise, af.observations_retour,
         (af.date_retour IS NULL AND af.date_retour_prevue < aujourdhui()) AS en_retard,
         CASE WHEN af.date_retour IS NULL THEN aujourdhui() - af.date_retour_prevue END AS jours_de_retard,
         mr.reference AS reference_remise, mt.reference AS reference_retour
    FROM affectations af
    JOIN materiels m ON m.id = af.materiel_id
    JOIN sites s ON s.id = m.site_id
    JOIN employes e ON e.id = af.employe_id
    LEFT JOIN services sv ON sv.id = e.service_id
    JOIN mouvements mr ON mr.id = af.mouvement_affectation_id
    LEFT JOIN mouvements mt ON mt.id = af.mouvement_retour_id`;

async function lireAffectation(id, client) {
  const { rows: [affectation] } = await (client ?? { query: requete }).query(`${SELECTION} WHERE af.id = $1`, [id]);
  if (!affectation) throw new ErreurApi(404, 'INTROUVABLE', 'Affectation introuvable.');
  return affectation;
}

const ticket = (valeur) => texte(valeur, { champ: 'numero_ticket', libelle: 'N° de ticket', obligatoire: true, max: 60 });
const idAffectation = (req) => identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Affectation', obligatoire: true });

routeurAffectations.get('/affectations', lecture, async (req, res) => {
  const { page, parPage, decalage } = pagination(req.query);
  const valeurs = [];
  const conditions = [];
  const ajouter = (condition, valeur) => {
    valeurs.push(valeur);
    conditions.push(condition.replaceAll('?', `$${valeurs.length}`));
  };
  const { serviceId, employeId } = perimetre(req.utilisateur);
  if (employeId !== undefined) conditions.push('false');
  if (serviceId !== undefined) {
    if (serviceId) ajouter('(e.service_id = ? OR m.service_id = ?)', serviceId);
    else conditions.push('false');
  }
  const etat = req.query.etat ?? 'en_cours';
  if (etat === 'en_cours') conditions.push('af.date_retour IS NULL');
  if (etat === 'rendues') conditions.push('af.date_retour IS NOT NULL');
  if (req.query.retard === 'oui') conditions.push('af.date_retour IS NULL AND af.date_retour_prevue < aujourdhui()');
  const employe = filtreId(req.query.employe_id);
  if (employe) ajouter('af.employe_id = ?', employe);
  const motif = motifRecherche(req.query.q);
  if (motif) {
    ajouter(`(m.code ILIKE ? OR m.designation ILIKE ? OR e.matricule ILIKE ? OR e.nom ILIKE ?
             OR coalesce(e.prenoms, '') ILIKE ? OR af.numero_contrat ILIKE ?)`, motif);
  }
  const ou = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows: [{ total }] } = await requete(
    `SELECT count(*)::int AS total FROM affectations af JOIN materiels m ON m.id = af.materiel_id
       JOIN employes e ON e.id = af.employe_id ${ou}`, valeurs,
  );
  const { rows } = await requete(
    `${SELECTION} ${ou}
      ORDER BY (af.date_retour IS NULL) DESC, (af.date_retour IS NULL AND af.date_retour_prevue < aujourdhui()) DESC,
               af.date_retour_prevue, af.id DESC
      LIMIT ${parPage} OFFSET ${decalage}`,
    valeurs,
  );
  res.json({ affectations: rows, total, page, par_page: parPage });
});

routeurAffectations.get('/affectations/:id', lecture, async (req, res) => {
  const id = idAffectation(req);
  const affectation = await lireAffectation(id);
  const { serviceId, employeId } = perimetre(req.utilisateur);
  if (serviceId !== undefined || employeId !== undefined) {
    const { rows } = await requete(
      `SELECT 1 FROM affectations af JOIN materiels m ON m.id = af.materiel_id JOIN employes e ON e.id = af.employe_id
        WHERE af.id = $1 AND (e.service_id = $2 OR m.service_id = $2)`, [id, serviceId ?? null],
    );
    if (rows.length === 0) throw new ErreurApi(404, 'INTROUVABLE', 'Affectation introuvable.');
  }
  res.json({ affectation });
});

// Remise (scénario 4.2) : mouvement « Affectation » validé puis affectation ;
// la base passe le matériel au statut « affecté ».
routeurAffectations.post('/affectations', gestion, async (req, res) => {
  const corps = req.body ?? {};
  const materielId = identifiantNumerique(corps.materiel_id, { champ: 'materiel_id', libelle: 'Matériel', obligatoire: true });
  const employeId = identifiantNumerique(corps.employe_id, { champ: 'employe_id', libelle: 'Employé', obligatoire: true });
  const contrat = texte(corps.numero_contrat, { champ: 'numero_contrat', libelle: 'N° de contrat', obligatoire: true, max: 60 });
  const dateRemise = date(corps.date_remise, { champ: 'date_remise', libelle: 'Date de remise' });
  const retourPrevu = date(corps.date_retour_prevue, { champ: 'date_retour_prevue', libelle: 'Date de retour prévue', obligatoire: true });
  const etatRemise = choix(corps.etat_remise, ['NEUF', 'BON', 'MOYEN'], { champ: 'etat_remise', libelle: 'État à la remise' });
  const numeroTicket = ticket(corps.numero_ticket);
  const observations = texte(corps.observations_remise, { champ: 'observations_remise', libelle: 'Observations', max: 1000 });

  const affectation = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [materiel] } = await client.query('SELECT id, code, site_id, etat FROM materiels WHERE id = $1', [materielId]);
    if (!materiel) throw refus('materiel_id', 'Matériel introuvable.');
    const { rows: [employe] } = await client.query("SELECT concat_ws(' ', nom, prenoms) AS nom FROM employes WHERE id = $1", [employeId]);
    if (!employe) throw refus('employe_id', 'Employé introuvable.');

    const { rows: [mouvement] } = await client.query(
      `INSERT INTO mouvements (type_code, date_mouvement, motif, numero_ticket, employe_beneficiaire_id)
       VALUES ('AFFECTATION', coalesce($1::date, aujourdhui()), $2, $3, $4) RETURNING id, reference`,
      [dateRemise, `Remise à ${employe.nom} — contrat ${contrat}`, numeroTicket, employeId],
    );
    await client.query(
      'INSERT INTO lignes_mouvements (mouvement_id, materiel_id, quantite, site_source_id) VALUES ($1, $2, 1, $3)',
      [mouvement.id, materielId, materiel.site_id],
    );
    await validerMouvement(client, mouvement.id, req.utilisateur);
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO affectations (materiel_id, employe_id, numero_contrat, date_remise, date_retour_prevue, etat_remise,
                                 observations_remise, mouvement_affectation_id)
       VALUES ($1, $2, $3, coalesce($4::date, aujourdhui()), $5, $6, $7, $8) RETURNING id`,
      [materielId, employeId, contrat, dateRemise, retourPrevu, etatRemise ?? materiel.etat, observations, mouvement.id],
    );
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'MATERIEL_REMIS', entite: 'affectations', entiteId: id,
      metadonnees: { materiel: materiel.code, mouvement: mouvement.reference, contrat }, ip: req.ip,
    }, client);
    return lireAffectation(id, client);
  });
  res.status(201).json({ affectation });
});

// Retour : mouvement « Retour d'affectation » validé, puis clôture ; la base
// fixe l'état, le statut (selon l'état) et le site du matériel.
routeurAffectations.post('/affectations/:id/retour', gestion, async (req, res) => {
  const id = idAffectation(req);
  const corps = req.body ?? {};
  const dateRetour = date(corps.date_retour, { champ: 'date_retour', libelle: 'Date de retour' });
  const etatRetour = choix(corps.etat_retour, ETATS, { champ: 'etat_retour', libelle: 'État au retour', obligatoire: true });
  const observations = texte(corps.observations_retour, { champ: 'observations_retour', libelle: 'Observations', max: 1000 });
  const numeroTicket = ticket(corps.numero_ticket);
  const siteRetour = identifiantNumerique(corps.site_retour_id, { champ: 'site_retour_id', libelle: 'Site de retour' });

  const affectation = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [actuelle] } = await client.query(
      `SELECT af.id, af.materiel_id, af.employe_id, af.date_retour, m.code, m.site_id
         FROM affectations af JOIN materiels m ON m.id = af.materiel_id WHERE af.id = $1 FOR UPDATE OF af`, [id],
    );
    if (!actuelle) throw new ErreurApi(404, 'INTROUVABLE', 'Affectation introuvable.');
    if (actuelle.date_retour) throw new ErreurApi(409, 'ENREGISTREMENT_FIGE', 'Le retour de ce matériel est déjà enregistré.');
    const { rows: [mouvement] } = await client.query(
      `INSERT INTO mouvements (type_code, date_mouvement, motif, numero_ticket, employe_beneficiaire_id)
       VALUES ('RETOUR_AFFECTATION', coalesce($1::date, aujourdhui()), $2, $3, $4) RETURNING id, reference`,
      [dateRetour, `Retour de ${actuelle.code}`, numeroTicket, actuelle.employe_id],
    );
    await client.query(
      'INSERT INTO lignes_mouvements (mouvement_id, materiel_id, quantite, site_destination_id) VALUES ($1, $2, 1, $3)',
      [mouvement.id, actuelle.materiel_id, siteRetour ?? actuelle.site_id],
    );
    await validerMouvement(client, mouvement.id, req.utilisateur);
    await client.query(
      `UPDATE affectations SET date_retour = coalesce($2::date, aujourdhui()), etat_retour = $3,
              observations_retour = $4, mouvement_retour_id = $5
        WHERE id = $1`,
      [id, dateRetour, etatRetour, observations, mouvement.id],
    );
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'MATERIEL_RENDU', entite: 'affectations', entiteId: id,
      metadonnees: { materiel: actuelle.code, mouvement: mouvement.reference, etat: etatRetour }, ip: req.ip,
    }, client);
    return lireAffectation(id, client);
  });
  res.json({ affectation });
});

// Prolongation du contrat : nouvelle date de retour prévue, motivée et journalisée.
routeurAffectations.post('/affectations/:id/prolonger', gestion, async (req, res) => {
  const id = idAffectation(req);
  const corps = req.body ?? {};
  const nouvelleDate = date(corps.date_retour_prevue, { champ: 'date_retour_prevue', libelle: 'Nouvelle date de retour prévue', obligatoire: true });
  const contrat = texte(corps.numero_contrat, { champ: 'numero_contrat', libelle: 'N° de contrat (avenant)', max: 60 });
  const motif = texte(corps.motif, { champ: 'motif', libelle: 'Motif', obligatoire: true, max: 300 });
  if (motif.length < 3) throw refus('motif', 'Motif : 3 caractères au moins.');

  const affectation = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [avant] } = await client.query('SELECT date_retour_prevue, numero_contrat, date_retour FROM affectations WHERE id = $1 FOR UPDATE', [id]);
    if (!avant) throw new ErreurApi(404, 'INTROUVABLE', 'Affectation introuvable.');
    if (avant.date_retour) throw new ErreurApi(409, 'ENREGISTREMENT_FIGE', 'Ce matériel est déjà rendu.');
    if (nouvelleDate === avant.date_retour_prevue) throw refus('date_retour_prevue', 'La date de retour prévue est inchangée.');
    await client.query(
      'UPDATE affectations SET date_retour_prevue = $2, numero_contrat = coalesce($3, numero_contrat) WHERE id = $1',
      [id, nouvelleDate, contrat],
    );
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'PROLONGATION', entite: 'affectations', entiteId: id,
      metadonnees: {
        motif,
        date_retour_prevue: { avant: avant.date_retour_prevue, apres: nouvelleDate },
        ...(contrat && contrat !== avant.numero_contrat ? { numero_contrat: { avant: avant.numero_contrat, apres: contrat } } : {}),
      },
      ip: req.ip,
    }, client);
    return lireAffectation(id, client);
  });
  res.json({ affectation });
});
