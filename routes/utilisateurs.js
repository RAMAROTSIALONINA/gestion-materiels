// Gestion des comptes (administrateur). Un compte ne se supprime jamais : il se
// suspend ou se désactive. Il reste toujours au moins un administrateur actif.
import { Router } from 'express';
import { transaction, requete } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { ErreurApi } from '../middleware/erreurs.js';
import { journaliser } from '../services/journal.js';
import { genererMotDePasseProvisoire, hacherMotDePasse } from '../services/mots-de-passe.js';
import { EMAIL, IDENTIFIANT, choix, identifiantNumerique, texte } from '../services/validation.js';

export const routeurUtilisateurs = Router();
const reserveAdmin = exigerDroit('utilisateurs.gerer');

const ROLES = ['ADMIN', 'GESTIONNAIRE', 'RESPONSABLE_SERVICE', 'EMPLOYE'];
const STATUTS = ['ACTIF', 'SUSPENDU', 'DESACTIVE'];

const SELECTION = `
  SELECT u.id, u.nom, u.email, u.identifiant, u.role_code, r.libelle AS role_libelle, u.statut,
         u.employe_id, CASE WHEN e.id IS NOT NULL THEN concat_ws(' ', e.matricule, '—', e.nom, e.prenoms) END AS employe,
         u.service_id, s.nom AS service,
         u.doit_changer_mot_de_passe, coalesce(u.verrouille_jusqu_a > now(), false) AS bloque,
         u.derniere_connexion, u.cree_le
    FROM utilisateurs u
    JOIN roles r ON r.code = u.role_code
    LEFT JOIN employes e ON e.id = u.employe_id
    LEFT JOIN services s ON s.id = u.service_id`;

async function lireUtilisateur(id, client) {
  const { rows: [ligne] } = await (client ?? { query: requete }).query(`${SELECTION} WHERE u.id = $1`, [id]);
  if (!ligne) throw new ErreurApi(404, 'INTROUVABLE', 'Compte introuvable.');
  return ligne;
}

// Données d'un compte reçues du formulaire ; « partiel » pour une modification.
function lireSaisie(corps = {}, { partiel = false } = {}) {
  const present = (cle) => !partiel || Object.hasOwn(corps, cle);
  const saisie = {};
  if (present('nom')) saisie.nom = texte(corps.nom, { champ: 'nom', libelle: 'Nom', obligatoire: true, max: 100 });
  if (present('email')) {
    saisie.email = texte(corps.email, {
      champ: 'email', libelle: 'Adresse e-mail', obligatoire: true, max: 200, motif: EMAIL,
      messageMotif: 'Adresse e-mail non valable.',
    }).toLowerCase();
  }
  if (present('identifiant')) {
    saisie.identifiant = texte(corps.identifiant, {
      champ: 'identifiant', libelle: 'Identifiant', max: 40, motif: IDENTIFIANT,
      messageMotif: 'Identifiant : 3 à 40 caractères parmi lettres, chiffres, point, tiret et soulignement.',
    });
  }
  if (present('role_code')) saisie.role_code = choix(corps.role_code, ROLES, { champ: 'role_code', libelle: 'Rôle', obligatoire: true });
  if (present('employe_id')) saisie.employe_id = identifiantNumerique(corps.employe_id, { champ: 'employe_id', libelle: 'Employé' });
  if (present('service_id')) saisie.service_id = identifiantNumerique(corps.service_id, { champ: 'service_id', libelle: 'Service' });
  if (partiel && present('statut')) saisie.statut = choix(corps.statut, STATUTS, { champ: 'statut', libelle: 'Statut', obligatoire: true });
  return saisie;
}

const fermerSessions = (client, utilisateurId) =>
  client.query("DELETE FROM sessions WHERE sess->>'utilisateurId' = $1", [String(utilisateurId)]);

routeurUtilisateurs.get('/utilisateurs', reserveAdmin, async (req, res) => {
  const { rows } = await requete(`${SELECTION} ORDER BY u.statut, u.nom`);
  res.json({ utilisateurs: rows });
});

// Création : la base fixe un mot de passe provisoire, montré une seule fois à
// l'administrateur, que l'utilisateur doit changer à sa première connexion.
routeurUtilisateurs.post('/utilisateurs', reserveAdmin, async (req, res) => {
  const saisie = lireSaisie(req.body);
  const provisoire = genererMotDePasseProvisoire();
  const empreinte = await hacherMotDePasse(provisoire);
  const utilisateur = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO utilisateurs (nom, email, identifiant, role_code, employe_id, service_id, mot_de_passe_hash, doit_changer_mot_de_passe)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
      [saisie.nom, saisie.email, saisie.identifiant, saisie.role_code, saisie.employe_id, saisie.service_id, empreinte],
    );
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'UTILISATEUR_CREE', entite: 'utilisateurs', entiteId: id,
      metadonnees: { role: saisie.role_code }, ip: req.ip,
    }, client);
    return lireUtilisateur(id, client);
  });
  res.status(201).json({ utilisateur, mot_de_passe_provisoire: provisoire });
});

routeurUtilisateurs.patch('/utilisateurs/:id', reserveAdmin, async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Compte', obligatoire: true });
  const saisie = lireSaisie(req.body, { partiel: true });
  if (Object.keys(saisie).length === 0) throw new ErreurApi(422, 'SAISIE_VIDE', 'Aucune modification reçue.');

  const utilisateur = await transaction(req.utilisateur.id, async (client) => {
    // Verrou sur les administrateurs actifs : deux retraits simultanés ne
    // peuvent pas laisser l'application sans administrateur.
    const { rows: admins } = await client.query(
      "SELECT id FROM utilisateurs WHERE role_code = 'ADMIN' AND statut = 'ACTIF' FOR UPDATE",
    );
    const avant = await lireUtilisateur(id, client);
    const apres = { ...avant, ...saisie };

    const changeRoleOuStatut = apres.role_code !== avant.role_code || apres.statut !== avant.statut;
    if (id === req.utilisateur.id && changeRoleOuStatut) {
      throw new ErreurApi(409, 'MODIFICATION_DE_SOI', 'Vous ne pouvez pas changer votre propre rôle ni fermer votre propre compte.');
    }
    const resteAdmin = apres.role_code === 'ADMIN' && apres.statut === 'ACTIF';
    if (admins.some((admin) => admin.id === id) && !resteAdmin && admins.length <= 1) {
      throw new ErreurApi(409, 'DERNIER_ADMINISTRATEUR', 'Il doit rester au moins un administrateur actif.');
    }

    const colonnes = Object.keys(saisie);
    await client.query(
      `UPDATE utilisateurs SET ${colonnes.map((colonne, rang) => `${colonne} = $${rang + 2}`).join(', ')} WHERE id = $1`,
      [id, ...colonnes.map((colonne) => saisie[colonne])],
    );
    if (apres.statut !== 'ACTIF') await fermerSessions(client, id);

    const modifie = Object.fromEntries(
      colonnes.filter((colonne) => avant[colonne] !== saisie[colonne])
        .map((colonne) => [colonne, { avant: avant[colonne], apres: saisie[colonne] }]),
    );
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'UTILISATEUR_MODIFIE', entite: 'utilisateurs', entiteId: id,
      metadonnees: modifie, ip: req.ip,
    }, client);
    return lireUtilisateur(id, client);
  });
  res.json({ utilisateur });
});

// Nouveau mot de passe provisoire (oubli) : débloque le compte et ferme ses sessions.
routeurUtilisateurs.post('/utilisateurs/:id/mot-de-passe-provisoire', reserveAdmin, async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Compte', obligatoire: true });
  if (id === req.utilisateur.id) {
    throw new ErreurApi(409, 'MODIFICATION_DE_SOI', 'Pour votre propre compte, utilisez « Mon mot de passe ».');
  }
  const provisoire = genererMotDePasseProvisoire();
  const empreinte = await hacherMotDePasse(provisoire);
  const utilisateur = await transaction(req.utilisateur.id, async (client) => {
    await lireUtilisateur(id, client);
    await client.query(
      `UPDATE utilisateurs
          SET mot_de_passe_hash = $2, doit_changer_mot_de_passe = true,
              tentatives_echouees = 0, verrouille_jusqu_a = NULL
        WHERE id = $1`,
      [id, empreinte],
    );
    await fermerSessions(client, id);
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'MOT_DE_PASSE_REINITIALISE', entite: 'utilisateurs', entiteId: id, ip: req.ip,
    }, client);
    return lireUtilisateur(id, client);
  });
  res.json({ utilisateur, mot_de_passe_provisoire: provisoire });
});

routeurUtilisateurs.post('/utilisateurs/:id/debloquer', reserveAdmin, async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Compte', obligatoire: true });
  const utilisateur = await transaction(req.utilisateur.id, async (client) => {
    await lireUtilisateur(id, client);
    await client.query('UPDATE utilisateurs SET tentatives_echouees = 0, verrouille_jusqu_a = NULL WHERE id = $1', [id]);
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'COMPTE_DEBLOQUE', entite: 'utilisateurs', entiteId: id, ip: req.ip,
    }, client);
    return lireUtilisateur(id, client);
  });
  res.json({ utilisateur });
});
