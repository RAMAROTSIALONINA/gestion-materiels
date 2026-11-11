// Qui fait la requête ? Le compte est relu en base à chaque requête : un compte
// suspendu ou désactivé perd l'accès immédiatement, même avec une session ouverte.
import { requete } from '../database/db.js';
import { ErreurApi } from './erreurs.js';
import { aLeDroit, droitsDuRole } from './permissions.js';
import { detruireSession } from './session.js';

export async function lireCompte(id) {
  const { rows: [compte] } = await requete(
    `SELECT u.id, u.nom, u.email, u.identifiant, u.role_code, r.libelle AS role_libelle, u.statut,
            u.employe_id, u.service_id, u.doit_changer_mot_de_passe
       FROM utilisateurs u JOIN roles r ON r.code = u.role_code
      WHERE u.id = $1`,
    [id],
  );
  return compte ?? null;
}

// Ce que l'interface reçoit sur l'utilisateur connecté (jamais l'empreinte du mot de passe).
export function profil(compte) {
  return {
    id: compte.id,
    nom: compte.nom,
    email: compte.email,
    identifiant: compte.identifiant,
    role: compte.role_code,
    role_libelle: compte.role_libelle,
    employe_id: compte.employe_id,
    service_id: compte.service_id,
    doit_changer_mot_de_passe: compte.doit_changer_mot_de_passe,
    droits: droitsDuRole(compte.role_code),
  };
}

export async function chargerUtilisateur(req, res, next) {
  req.utilisateur = null;
  const id = req.session?.utilisateurId;
  if (!id) return next();
  const compte = await lireCompte(id);
  if (!compte || compte.statut !== 'ACTIF') {
    await detruireSession(req);
    return next();
  }
  req.utilisateur = compte;
  next();
}

// Connexion exigée. Tant que le mot de passe provisoire n'est pas changé, seules
// les routes qui le permettent explicitement sont ouvertes.
export function exigerConnexion({ motDePasseAChanger = false } = {}) {
  return (req, res, next) => {
    if (!req.utilisateur) {
      return next(new ErreurApi(401, 'NON_CONNECTE', 'Session expirée ou absente : reconnectez-vous.'));
    }
    if (req.utilisateur.doit_changer_mot_de_passe && !motDePasseAChanger) {
      return next(new ErreurApi(403, 'MOT_DE_PASSE_A_CHANGER', 'Choisissez d’abord votre mot de passe personnel.'));
    }
    next();
  };
}

// Connexion exigée, et au moins un des droits demandés.
export function exigerDroit(...droits) {
  return [
    exigerConnexion(),
    (req, res, next) => {
      if (droits.some((droit) => aLeDroit(req.utilisateur.role_code, droit))) return next();
      next(new ErreurApi(403, 'ACCES_REFUSE', 'Vous n’avez pas le droit de faire cette opération.'));
    },
  ];
}
