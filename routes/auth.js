// Connexion, déconnexion, profil et changement de mot de passe.
// Recette (cahier des charges § 11) : test 1 — accès selon le rôle ;
// test 2 — mauvais mot de passe refusé avec un message non révélateur.
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';
import { requete, transaction } from '../database/db.js';
import { exigerConnexion, lireCompte, profil } from '../middleware/authentification.js';
import { ErreurApi } from '../middleware/erreurs.js';
import { NOM_COOKIE, OPTIONS_COOKIE, detruireSession, regenererSession } from '../middleware/session.js';
import { journaliser } from '../services/journal.js';
import {
  controlerNouveauMotDePasse, doitRecalculer, hacherMotDePasse, verifierMotDePasse,
} from '../services/mots-de-passe.js';

async function lireReglagesConnexion() {
  const { rows } = await requete(
    "SELECT cle, valeur FROM parametres WHERE cle IN ('connexion_tentatives_max', 'connexion_verrouillage_minutes')",
  );
  const valeur = (cle, defaut) => Number(rows.find((ligne) => ligne.cle === cle)?.valeur) || defaut;
  return {
    tentativesMax: valeur('connexion_tentatives_max', 5),
    minutes: valeur('connexion_verrouillage_minutes', 15),
  };
}

// Un seul message pour tous les échecs : compte inconnu, mot de passe faux ou
// compte bloqué. Il ne révèle pas si le compte existe.
const echecConnexion = ({ tentativesMax, minutes }) => new ErreurApi(
  401,
  'IDENTIFIANTS_INVALIDES',
  `Identifiant ou mot de passe incorrect. Après ${tentativesMax} échecs, le compte est bloqué ${minutes} minutes.`,
);

const motDePasseSaisi = (valeur) => (typeof valeur === 'string' && valeur.length <= 200 ? valeur : '');

export function creerRouteurAuth({ limiteConnexions = 20 } = {}) {
  const routeur = Router();

  // Limite par poste, en plus du blocage par compte.
  const limiteur = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: limiteConnexions,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, next) => next(new ErreurApi(
      429, 'TROP_DE_TENTATIVES', 'Trop de tentatives depuis ce poste. Réessayez dans 15 minutes.',
    )),
  });

  routeur.post('/auth/connexion', limiteur, async (req, res) => {
    const identifiant = typeof req.body?.identifiant === 'string' ? req.body.identifiant.trim().slice(0, 200) : '';
    const motDePasse = motDePasseSaisi(req.body?.mot_de_passe);
    if (!identifiant || !motDePasse) {
      throw new ErreurApi(422, 'SAISIE_INCOMPLETE', 'Saisissez votre identifiant (ou adresse e-mail) et votre mot de passe.');
    }

    const reglages = await lireReglagesConnexion();
    const { rows: [compte] } = await requete(
      `SELECT id, mot_de_passe_hash, statut, verrouille_jusqu_a > now() AS bloque
         FROM utilisateurs
        WHERE lower(email) = lower($1) OR lower(identifiant) = lower($1)
        LIMIT 1`,
      [identifiant],
    );

    if (!compte || compte.bloque) {
      await verifierMotDePasse(null, motDePasse);      // même durée de réponse
      await journaliser({
        utilisateurId: compte?.id ?? null,
        action: 'CONNEXION_ECHEC',
        entite: compte ? 'utilisateurs' : null,
        entiteId: compte?.id ?? null,
        metadonnees: { motif: compte ? 'compte_bloque' : 'compte_inconnu' },
        ip: req.ip,
      });
      throw echecConnexion(reglages);
    }

    if (!(await verifierMotDePasse(compte.mot_de_passe_hash, motDePasse))) {
      // Au dernier échec permis, le compte est bloqué et le compteur repart de zéro.
      const { rows: [apres] } = await requete(
        `UPDATE utilisateurs
            SET tentatives_echouees = CASE WHEN tentatives_echouees + 1 >= $2 THEN 0 ELSE tentatives_echouees + 1 END,
                verrouille_jusqu_a  = CASE WHEN tentatives_echouees + 1 >= $2
                                           THEN now() + make_interval(mins => $3) ELSE verrouille_jusqu_a END
          WHERE id = $1
        RETURNING verrouille_jusqu_a > now() AS bloque`,
        [compte.id, reglages.tentativesMax, reglages.minutes],
      );
      await journaliser({
        utilisateurId: compte.id,
        action: 'CONNEXION_ECHEC',
        entite: 'utilisateurs',
        entiteId: compte.id,
        metadonnees: { motif: 'mot_de_passe', compte_bloque: apres.bloque },
        ip: req.ip,
      });
      throw echecConnexion(reglages);
    }

    // Bon mot de passe : on peut dire que le compte est fermé.
    if (compte.statut !== 'ACTIF') {
      await journaliser({
        utilisateurId: compte.id, action: 'CONNEXION_REFUSEE', entite: 'utilisateurs', entiteId: compte.id,
        metadonnees: { statut: compte.statut }, ip: req.ip,
      });
      throw new ErreurApi(403, 'COMPTE_INACTIF', 'Ce compte est fermé. Adressez-vous à l’administrateur.');
    }

    const nouvelleEmpreinte = doitRecalculer(compte.mot_de_passe_hash) ? await hacherMotDePasse(motDePasse) : null;
    await requete(
      `UPDATE utilisateurs
          SET tentatives_echouees = 0, verrouille_jusqu_a = NULL, derniere_connexion = now(),
              mot_de_passe_hash = coalesce($2, mot_de_passe_hash)
        WHERE id = $1`,
      [compte.id, nouvelleEmpreinte],
    );

    await regenererSession(req);           // nouvel identifiant de session à chaque connexion
    req.session.utilisateurId = compte.id;
    req.session.connecteLe = new Date().toISOString();
    await journaliser({ utilisateurId: compte.id, action: 'CONNEXION', entite: 'utilisateurs', entiteId: compte.id, ip: req.ip });

    res.json({ utilisateur: profil(await lireCompte(compte.id)) });
  });

  routeur.post('/auth/deconnexion', async (req, res) => {
    if (req.utilisateur) {
      await journaliser({ utilisateurId: req.utilisateur.id, action: 'DECONNEXION', ip: req.ip });
    }
    await detruireSession(req);
    res.clearCookie(NOM_COOKIE, OPTIONS_COOKIE(config.production));
    res.json({ deconnecte: true });
  });

  routeur.get('/auth/moi', exigerConnexion({ motDePasseAChanger: true }), (req, res) => {
    res.json({ utilisateur: profil(req.utilisateur) });
  });

  routeur.post('/auth/mot-de-passe', limiteur, exigerConnexion({ motDePasseAChanger: true }), async (req, res) => {
    const actuel = motDePasseSaisi(req.body?.actuel);
    const nouveau = motDePasseSaisi(req.body?.nouveau);
    const { rows: [compte] } = await requete(
      'SELECT mot_de_passe_hash, email, identifiant FROM utilisateurs WHERE id = $1',
      [req.utilisateur.id],
    );
    if (!(await verifierMotDePasse(compte.mot_de_passe_hash, actuel))) {
      throw new ErreurApi(422, 'MOT_DE_PASSE_ACTUEL_FAUX', 'Le mot de passe actuel est incorrect.', { champ: 'actuel' });
    }
    const probleme = controlerNouveauMotDePasse(nouveau, compte);
    if (probleme) throw new ErreurApi(422, 'MOT_DE_PASSE_TROP_FAIBLE', probleme, { champ: 'nouveau' });
    if (nouveau === actuel) {
      throw new ErreurApi(422, 'MOT_DE_PASSE_INCHANGE', 'Choisissez un mot de passe différent de l’actuel.', { champ: 'nouveau' });
    }

    const empreinte = await hacherMotDePasse(nouveau);
    await transaction(req.utilisateur.id, async (client) => {
      await client.query(
        `UPDATE utilisateurs
            SET mot_de_passe_hash = $2, doit_changer_mot_de_passe = false, mot_de_passe_change_le = now()
          WHERE id = $1`,
        [req.utilisateur.id, empreinte],
      );
      // Les autres sessions ouvertes avec l'ancien mot de passe sont fermées.
      await client.query("DELETE FROM sessions WHERE sess->>'utilisateurId' = $1 AND sid <> $2",
        [String(req.utilisateur.id), req.sessionID]);
      await journaliser({ utilisateurId: req.utilisateur.id, action: 'MOT_DE_PASSE_CHANGE', ip: req.ip }, client);
    });
    res.json({ utilisateur: profil(await lireCompte(req.utilisateur.id)) });
  });

  return routeur;
}
