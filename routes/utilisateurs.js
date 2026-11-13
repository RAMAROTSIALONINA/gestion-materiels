// Gestion des comptes (administrateur). Un compte ne se supprime jamais : il se
// suspend ou se désactive. Il reste toujours au moins un administrateur actif.
import { Router } from 'express';
import { transaction, requete } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { ErreurApi } from '../middleware/erreurs.js';
import { journaliser } from '../services/journal.js';
import { controlerNouveauMotDePasse, hacherMotDePasse } from '../services/mots-de-passe.js';
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

// Création. Décisions du 13/11 : l'administrateur tape le mot de passe (champ
// sous le rôle) ; il est obligatoire, définitif, sans changement imposé, et
// suit les règles d'un mot de passe personnel. Plus de mot de passe
// provisoire. Le mot de passe n'est jamais inscrit au journal.
routeurUtilisateurs.post('/utilisateurs', reserveAdmin, async (req, res) => {
  const saisie = lireSaisie(req.body);
  const choisi = typeof req.body?.mot_de_passe === 'string' ? req.body.mot_de_passe : '';
  if (choisi === '') {
    throw new ErreurApi(422, 'MOT_DE_PASSE_REQUIS', 'Tapez le mot de passe du compte.', { champ: 'mot_de_passe' });
  }
  const probleme = controlerNouveauMotDePasse(choisi, { email: saisie.email, identifiant: saisie.identifiant });
  if (probleme) {
    throw new ErreurApi(422, 'MOT_DE_PASSE_TROP_FAIBLE',
      probleme.replace('votre identifiant ni votre adresse e-mail', 'l’identifiant ni l’adresse e-mail du compte'), { champ: 'mot_de_passe' });
  }
  const empreinte = await hacherMotDePasse(choisi);
  const utilisateur = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO utilisateurs (nom, email, identifiant, role_code, employe_id, service_id, mot_de_passe_hash, doit_changer_mot_de_passe)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false) RETURNING id`,
      [saisie.nom, saisie.email, saisie.identifiant, saisie.role_code, saisie.employe_id, saisie.service_id, empreinte],
    );
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'UTILISATEUR_CREE', entite: 'utilisateurs', entiteId: id,
      metadonnees: { role: saisie.role_code, mot_de_passe: 'choisi par l’administrateur' }, ip: req.ip,
    }, client);
    return lireUtilisateur(id, client);
  });
  res.status(201).json({ utilisateur });
});

// Modification. Décision du 13/11 : l'administrateur peut aussi y taper un
// nouveau mot de passe (définitif, mêmes règles qu'à la création) ; le compte
// est alors débloqué et ses sessions ouvertes sont fermées. Pas pour son propre
// compte : « Mon mot de passe » demande le mot de passe actuel.
routeurUtilisateurs.patch('/utilisateurs/:id', reserveAdmin, async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Compte', obligatoire: true });
  const saisie = lireSaisie(req.body, { partiel: true });
  const choisi = typeof req.body?.mot_de_passe === 'string' && req.body.mot_de_passe !== '' ? req.body.mot_de_passe : null;
  if (Object.keys(saisie).length === 0 && choisi === null) throw new ErreurApi(422, 'SAISIE_VIDE', 'Aucune modification reçue.');
  if (choisi !== null && id === req.utilisateur.id) {
    throw new ErreurApi(409, 'MODIFICATION_DE_SOI', 'Pour votre propre compte, utilisez « Mon mot de passe ».', { champ: 'mot_de_passe' });
  }

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

    if (choisi !== null) {
      const probleme = controlerNouveauMotDePasse(choisi, { email: apres.email, identifiant: apres.identifiant });
      if (probleme) {
        throw new ErreurApi(422, 'MOT_DE_PASSE_TROP_FAIBLE',
          probleme.replace('votre identifiant ni votre adresse e-mail', 'l’identifiant ni l’adresse e-mail du compte'), { champ: 'mot_de_passe' });
      }
    }

    const colonnes = Object.keys(saisie);
    if (colonnes.length) {
      await client.query(
        `UPDATE utilisateurs SET ${colonnes.map((colonne, rang) => `${colonne} = $${rang + 2}`).join(', ')} WHERE id = $1`,
        [id, ...colonnes.map((colonne) => saisie[colonne])],
      );
    }
    if (choisi !== null) {
      await client.query(
        `UPDATE utilisateurs
            SET mot_de_passe_hash = $2, doit_changer_mot_de_passe = false, tentatives_echouees = 0, verrouille_jusqu_a = NULL
          WHERE id = $1`,
        [id, await hacherMotDePasse(choisi)],
      );
    }
    if (apres.statut !== 'ACTIF' || choisi !== null) await fermerSessions(client, id);

    const modifie = Object.fromEntries(
      colonnes.filter((colonne) => avant[colonne] !== saisie[colonne])
        .map((colonne) => [colonne, { avant: avant[colonne], apres: saisie[colonne] }]),
    );
    // Le mot de passe lui-même n'est jamais inscrit au journal.
    if (choisi !== null) modifie.mot_de_passe = 'changé par l’administrateur';
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'UTILISATEUR_MODIFIE', entite: 'utilisateurs', entiteId: id,
      metadonnees: modifie, ip: req.ip,
    }, client);
    return lireUtilisateur(id, client);
  });
  res.json({ utilisateur });
});

// Décision du 13/11 : plus de « mot de passe provisoire » pour un oubli ;
// l'administrateur tape un nouveau mot de passe dans « Modifier » (PATCH
// ci-dessus), ce qui débloque aussi le compte et ferme ses sessions.

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
