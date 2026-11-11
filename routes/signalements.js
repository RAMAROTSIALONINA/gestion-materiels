// « Mes matériels » (employé) et signalements : un employé signale une panne,
// une perte ou un retour souhaité sur un matériel qui lui est affecté ; le
// gestionnaire le prend en charge puis le clôt. La fonction s'active dans les
// paramètres (cahier des charges § 1.3).
import { Router } from 'express';
import { requete, transaction } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { ErreurApi } from '../middleware/erreurs.js';
import { journaliser } from '../services/journal.js';
import { choix, identifiantNumerique, pagination, texte } from '../services/validation.js';

export const routeurSignalements = Router();

const TYPES = ['PANNE', 'PERTE', 'RETOUR_SOUHAITE', 'AUTRE'];

async function signalementsActifs() {
  const { rows: [ligne] } = await requete("SELECT parametre('signalements_actifs') AS valeur");
  return ligne?.valeur === 'oui';
}

const SELECTION = `
  SELECT sg.id, sg.type, sg.description, sg.statut, sg.cree_le, sg.reponse, sg.traite_le,
         sg.materiel_id, m.code, m.designation, ua.nom AS auteur, ut.nom AS traite_par,
         CASE WHEN e.id IS NOT NULL THEN concat_ws(' ', e.nom, e.prenoms) END AS employe
    FROM signalements sg
    JOIN materiels m ON m.id = sg.materiel_id
    JOIN utilisateurs ua ON ua.id = sg.auteur_id
    LEFT JOIN utilisateurs ut ON ut.id = sg.traite_par
    LEFT JOIN affectations af ON af.id = sg.affectation_id
    LEFT JOIN employes e ON e.id = af.employe_id`;

routeurSignalements.get('/mes-materiels', exigerDroit('mes_materiels.lire'), async (req, res) => {
  const actifs = await signalementsActifs();
  if (!req.utilisateur.employe_id) {
    return res.json({ rattache: false, signalements_actifs: actifs, materiels: [], signalements: [] });
  }
  const [materiels, signalements] = await Promise.all([
    requete(
      `SELECT af.id AS affectation_id, m.id, m.code, m.designation, m.marque, m.modele, m.numero_serie, m.etat,
              af.numero_contrat, af.date_remise, af.date_retour_prevue,
              af.date_retour_prevue < aujourdhui() AS en_retard
         FROM affectations af JOIN materiels m ON m.id = af.materiel_id
        WHERE af.employe_id = $1 AND af.date_retour IS NULL
        ORDER BY af.date_retour_prevue`, [req.utilisateur.employe_id]),
    requete(`${SELECTION} WHERE sg.auteur_id = $1 ORDER BY sg.cree_le DESC LIMIT 50`, [req.utilisateur.id]),
  ]);
  res.json({ rattache: true, signalements_actifs: actifs, materiels: materiels.rows, signalements: signalements.rows });
});

routeurSignalements.post('/signalements', exigerDroit('signalements.creer'), async (req, res) => {
  if (!(await signalementsActifs())) {
    throw new ErreurApi(403, 'FONCTION_DESACTIVEE', 'Le signalement n’est pas activé : adressez-vous au gestionnaire.');
  }
  const corps = req.body ?? {};
  const materielId = identifiantNumerique(corps.materiel_id, { champ: 'materiel_id', libelle: 'Matériel', obligatoire: true });
  const type = choix(corps.type, TYPES, { champ: 'type', libelle: 'Objet', obligatoire: true });
  const description = texte(corps.description, { champ: 'description', libelle: 'Description', obligatoire: true, max: 2000 });
  if (description.length < 5) throw new ErreurApi(422, 'SAISIE_INVALIDE', 'Décrivez le problème en quelques mots (5 caractères au moins).', { champ: 'description' });

  const { rows: [affectation] } = await requete(
    'SELECT id FROM affectations WHERE materiel_id = $1 AND employe_id = $2 AND date_retour IS NULL',
    [materielId, req.utilisateur.employe_id ?? 0],
  );
  if (!affectation) throw new ErreurApi(403, 'ACCES_REFUSE', 'Vous ne pouvez signaler que les matériels qui vous sont affectés.');

  const signalement = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [{ id }] } = await client.query(
      'INSERT INTO signalements (materiel_id, affectation_id, type, description) VALUES ($1, $2, $3, $4) RETURNING id',
      [materielId, affectation.id, type, description],
    );
    await journaliser({ utilisateurId: req.utilisateur.id, action: 'SIGNALEMENT_CREE', entite: 'signalements', entiteId: id, ip: req.ip }, client);
    return (await client.query(`${SELECTION} WHERE sg.id = $1`, [id])).rows[0];
  });
  res.status(201).json({ signalement });
});

routeurSignalements.get('/signalements', exigerDroit('signalements.traiter'), async (req, res) => {
  const { page, parPage, decalage } = pagination(req.query);
  const statut = ['OUVERT', 'PRIS_EN_CHARGE', 'CLOS'].includes(req.query.statut) ? req.query.statut : null;
  const ouverts = req.query.statut === 'a_traiter';
  const condition = statut ? 'WHERE sg.statut = $1' : ouverts ? "WHERE sg.statut <> 'CLOS'" : '';
  const valeurs = statut ? [statut] : [];
  const { rows: [{ total }] } = await requete(`SELECT count(*)::int AS total FROM signalements sg ${condition}`, valeurs);
  const { rows } = await requete(
    `${SELECTION} ${condition}
      ORDER BY CASE sg.statut WHEN 'OUVERT' THEN 0 WHEN 'PRIS_EN_CHARGE' THEN 1 ELSE 2 END, sg.cree_le DESC
      LIMIT ${parPage} OFFSET ${decalage}`, valeurs,
  );
  res.json({ signalements: rows, total, page, par_page: parPage, actifs: await signalementsActifs() });
});

routeurSignalements.patch('/signalements/:id', exigerDroit('signalements.traiter'), async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Signalement', obligatoire: true });
  const statut = choix(req.body?.statut, ['PRIS_EN_CHARGE', 'CLOS'], { champ: 'statut', libelle: 'Statut', obligatoire: true });
  const reponse = texte(req.body?.reponse, { champ: 'reponse', libelle: 'Réponse', max: 2000 });
  if (statut === 'CLOS' && (!reponse || reponse.length < 3)) {
    throw new ErreurApi(422, 'SAISIE_INVALIDE', 'Pour clore, indiquez la suite donnée (3 caractères au moins).', { champ: 'reponse' });
  }
  const signalement = await transaction(req.utilisateur.id, async (client) => {
    const { rowCount } = await client.query(
      'UPDATE signalements SET statut = $2, reponse = coalesce($3, reponse) WHERE id = $1', [id, statut, reponse],
    );
    if (rowCount === 0) throw new ErreurApi(404, 'INTROUVABLE', 'Signalement introuvable.');
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'SIGNALEMENT_TRAITE', entite: 'signalements', entiteId: id,
      metadonnees: { statut }, ip: req.ip,
    }, client);
    return (await client.query(`${SELECTION} WHERE sg.id = $1`, [id])).rows[0];
  });
  res.json({ signalement });
});
