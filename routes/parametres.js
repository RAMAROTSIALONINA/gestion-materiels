// Paramètres modifiables par l'administrateur. Les préfixes de codes, le
// fuseau et la devise restent figés (ils entrent dans les codes et les dates
// déjà enregistrés) : on les consulte seulement.
import { Router } from 'express';
import { requete, transaction } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { ErreurApi } from '../middleware/erreurs.js';
import { journaliser } from '../services/journal.js';
import { texte } from '../services/validation.js';

export const routeurParametres = Router();
const gestion = exigerDroit('parametres.gerer');

const MODIFIABLES = [
  'nom_societe', 'signalements_actifs', 'connexion_tentatives_max', 'connexion_verrouillage_minutes',
  'alerte_transfert_jours', 'alerte_reparation_jours', 'alerte_retour_jours',
];

routeurParametres.get('/parametres', gestion, async (req, res) => {
  const { rows } = await requete(
    `SELECT p.cle, p.valeur, p.description, p.modifie_le, u.nom AS modifie_par
       FROM parametres p LEFT JOIN utilisateurs u ON u.id = p.modifie_par ORDER BY p.cle`,
  );
  res.json({ parametres: rows.map((ligne) => ({ ...ligne, modifiable: MODIFIABLES.includes(ligne.cle) })) });
});

routeurParametres.patch('/parametres/:cle', gestion, async (req, res) => {
  const cle = req.params.cle;
  if (!MODIFIABLES.includes(cle)) throw new ErreurApi(403, 'PARAMETRE_FIGE', 'Ce paramètre ne se modifie pas depuis l’application.');
  const valeur = texte(req.body?.valeur, { champ: 'valeur', libelle: 'Valeur', obligatoire: true, max: 100 });
  const parametre = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [avant] } = await client.query('SELECT valeur FROM parametres WHERE cle = $1 FOR UPDATE', [cle]);
    if (!avant) throw new ErreurApi(404, 'INTROUVABLE', 'Paramètre introuvable.');
    await client.query('UPDATE parametres SET valeur = $2, modifie_par = $3 WHERE cle = $1', [cle, valeur, req.utilisateur.id]);
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'PARAMETRE_MODIFIE', entite: 'parametres',
      metadonnees: { cle, avant: avant.valeur, apres: valeur }, ip: req.ip,
    }, client);
    return (await client.query('SELECT cle, valeur, description, modifie_le FROM parametres WHERE cle = $1', [cle])).rows[0];
  });
  res.json({ parametre });
});
