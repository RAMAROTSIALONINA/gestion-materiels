// Fiches employés (gestionnaire et administrateur). Données personnelles
// limitées au nécessaire (cahier des charges § 8.3). Une fiche ne se supprime
// pas : elle se désactive (départ), l'historique des affectations restant attaché.
import { Router } from 'express';
import { requete, transaction } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { ErreurApi } from '../middleware/erreurs.js';
import { differences, journaliser, miseAJour } from '../services/journal.js';
import {
  EMAIL, booleen, filtreId, identifiantNumerique, motifRecherche, pagination, texte,
} from '../services/validation.js';

export const routeurEmployes = Router();
const gestion = exigerDroit('employes.gerer');

const SELECTION = `
  SELECT e.id, e.matricule, e.nom, e.prenoms, e.fonction, e.service_id, sv.nom AS service,
         e.site_id, s.nom AS site, e.telephone, e.email, e.actif,
         (SELECT count(*)::int FROM affectations a WHERE a.employe_id = e.id AND a.date_retour IS NULL) AS nb_affectations_en_cours
    FROM employes e
    LEFT JOIN services sv ON sv.id = e.service_id
    LEFT JOIN sites s ON s.id = e.site_id`;

function lireSaisie(corps, partiel) {
  const present = (cle) => !partiel || Object.hasOwn(corps, cle);
  const s = {};
  if (present('matricule')) s.matricule = texte(corps.matricule, { champ: 'matricule', libelle: 'Matricule', obligatoire: true, max: 30, majuscules: true });
  if (present('nom')) s.nom = texte(corps.nom, { champ: 'nom', libelle: 'Nom', obligatoire: true, max: 100 });
  if (present('prenoms')) s.prenoms = texte(corps.prenoms, { champ: 'prenoms', libelle: 'Prénoms', max: 100 });
  if (present('fonction')) s.fonction = texte(corps.fonction, { champ: 'fonction', libelle: 'Fonction', max: 100 });
  if (present('service_id')) s.service_id = identifiantNumerique(corps.service_id, { champ: 'service_id', libelle: 'Service' });
  if (present('site_id')) s.site_id = identifiantNumerique(corps.site_id, { champ: 'site_id', libelle: 'Site' });
  if (present('telephone')) s.telephone = texte(corps.telephone, { champ: 'telephone', libelle: 'Téléphone', max: 30 });
  if (present('email')) {
    s.email = texte(corps.email, { champ: 'email', libelle: 'Adresse e-mail', max: 200, motif: EMAIL, messageMotif: 'Adresse e-mail non valable.' })?.toLowerCase() ?? null;
  }
  if (partiel && present('actif')) s.actif = booleen(corps.actif, { champ: 'actif', libelle: 'Actif' });
  return s;
}

routeurEmployes.get('/employes', gestion, async (req, res) => {
  const { page, parPage, decalage } = pagination(req.query);
  const conditions = [];
  const valeurs = [];
  const ajouter = (condition, valeur) => {
    valeurs.push(valeur);
    conditions.push(condition.replaceAll('?', `$${valeurs.length}`));
  };
  const motif = motifRecherche(req.query.q);
  if (motif) ajouter("(e.matricule ILIKE ? OR e.nom ILIKE ? OR coalesce(e.prenoms, '') ILIKE ? OR coalesce(e.fonction, '') ILIKE ?)", motif);
  const service = filtreId(req.query.service_id);
  if (service) ajouter('e.service_id = ?', service);
  if (req.query.actif === 'oui') conditions.push('e.actif');
  if (req.query.actif === 'non') conditions.push('NOT e.actif');
  const ou = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: [{ total }] } = await requete(`SELECT count(*)::int AS total FROM employes e ${ou}`, valeurs);
  const { rows } = await requete(
    `${SELECTION} ${ou} ORDER BY e.actif DESC, e.nom, e.prenoms LIMIT ${parPage} OFFSET ${decalage}`,
    valeurs,
  );
  res.json({ employes: rows, total, page, par_page: parPage });
});

routeurEmployes.post('/employes', gestion, async (req, res) => {
  const saisie = lireSaisie(req.body ?? {}, false);
  const employe = await transaction(req.utilisateur.id, async (client) => {
    const colonnes = Object.keys(saisie);
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO employes (${colonnes.join(', ')}) VALUES (${colonnes.map((_, rang) => `$${rang + 1}`).join(', ')}) RETURNING id`,
      colonnes.map((colonne) => saisie[colonne]),
    );
    await journaliser({ utilisateurId: req.utilisateur.id, action: 'EMPLOYE_CREE', entite: 'employes', entiteId: id, ip: req.ip }, client);
    return (await client.query(`${SELECTION} WHERE e.id = $1`, [id])).rows[0];
  });
  res.status(201).json({ employe });
});

routeurEmployes.patch('/employes/:id', gestion, async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Employé', obligatoire: true });
  const saisie = lireSaisie(req.body ?? {}, true);
  if (Object.keys(saisie).length === 0) throw new ErreurApi(422, 'SAISIE_VIDE', 'Aucune modification reçue.');
  const employe = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [avant] } = await client.query('SELECT * FROM employes WHERE id = $1 FOR UPDATE', [id]);
    if (!avant) throw new ErreurApi(404, 'INTROUVABLE', 'Fiche employé introuvable.');
    if (saisie.actif === false && avant.actif) {
      const { rows: [{ nombre }] } = await client.query(
        'SELECT count(*)::int AS nombre FROM affectations WHERE employe_id = $1 AND date_retour IS NULL', [id],
      );
      if (nombre > 0) {
        throw new ErreurApi(409, 'AFFECTATIONS_EN_COURS',
          `Cet employé a encore ${nombre} matériel(s) en sa possession : enregistrez leur retour avant de désactiver sa fiche.`);
      }
    }
    const { texte: sql, valeurs } = miseAJour('employes', id, saisie);
    await client.query(sql, valeurs);
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'EMPLOYE_MODIFIE', entite: 'employes', entiteId: id,
      metadonnees: differences(avant, saisie), ip: req.ip,
    }, client);
    return (await client.query(`${SELECTION} WHERE e.id = $1`, [id])).rows[0];
  });
  res.json({ employe });
});
