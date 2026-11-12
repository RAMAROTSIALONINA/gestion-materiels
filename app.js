// Application Express : pages du dossier public/ et API sous /api.
import { join } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { config, secretSession } from './config.js';
import { obtenirPool } from './database/db.js';
import { chargerUtilisateur } from './middleware/authentification.js';
import { ErreurApi, gestionnaireErreurs } from './middleware/erreurs.js';
import { journalRequetes } from './middleware/journal.js';
import { controleOrigine } from './middleware/origine.js';
import { aLeDroit } from './middleware/permissions.js';
import { creerSession } from './middleware/session.js';
import { creerRouteurApi } from './routes/index.js';

// Pages de l'application et accès demandé :
//   public       — ouverte à tous (connexion)
//   connecte     — toute personne connectée ayant choisi son mot de passe
//   mot-de-passe — toute personne connectée, même avec un mot de passe provisoire
//   <droit>      — personne connectée ayant ce droit
const PAGES = [
  { chemin: '/',               fichier: 'index.html',          acces: 'connecte' },
  { chemin: '/connexion',      fichier: 'connexion.html',      acces: 'public' },
  { chemin: '/mot-de-passe',   fichier: 'mot-de-passe.html',   acces: 'mot-de-passe' },
  { chemin: '/utilisateurs',   fichier: 'utilisateurs.html',   acces: 'utilisateurs.gerer' },
  { chemin: '/administration', fichier: 'administration.html', acces: 'referentiels.gerer' },
  { chemin: '/employes',       fichier: 'employes.html',       acces: 'employes.gerer' },
  { chemin: '/materiels',      fichier: 'materiels.html',      acces: 'materiels.lire' },
  { chemin: '/materiels/:id',  fichier: 'materiel.html',       acces: 'materiels.lire' },
  { chemin: '/articles',       fichier: 'articles.html',       acces: 'articles.lire' },
  { chemin: '/articles/:id',   fichier: 'article.html',        acces: 'articles.lire' },
  { chemin: '/etiquettes',     fichier: 'etiquettes.html',     acces: 'materiels.gerer' },
  // L'ordre compte : « /mouvements/nouveau » avant « /mouvements/:id ».
  { chemin: '/mouvements',              fichier: 'mouvements.html',       acces: 'mouvements.lire' },
  { chemin: '/mouvements/nouveau',      fichier: 'mouvement-saisie.html', acces: 'mouvements.saisir' },
  { chemin: '/mouvements/:id/modifier', fichier: 'mouvement-saisie.html', acces: 'mouvements.saisir' },
  { chemin: '/mouvements/:id',          fichier: 'mouvement.html',        acces: 'mouvements.lire' },
  { chemin: '/receptions',              fichier: 'receptions.html',       acces: 'transferts.receptionner' },
  { chemin: '/affectations',            fichier: 'affectations.html',     acces: 'affectations.lire' },
  { chemin: '/mes-materiels',           fichier: 'mes-materiels.html',    acces: 'mes_materiels.lire' },
  { chemin: '/signalements',            fichier: 'signalements.html',     acces: 'signalements.traiter' },
  // Phase 7 : suivi du parc et des stocks.
  { chemin: '/alertes',                 fichier: 'alertes.html',          acces: 'alertes.lire' },
  { chemin: '/historique',              fichier: 'historique.html',       acces: 'materiels.lire' },
  { chemin: '/journal',                 fichier: 'journal.html',          acces: 'journal.lire' },
  // Page Paramètres : une carte par écran de réglage permis (au moins « Mon mot de passe »).
  { chemin: '/parametres',              fichier: 'parametres.html',       acces: 'connecte' },
  // Phase 8 : rapports (le tableau de bord est la page d'accueil « / »).
  { chemin: '/rapports',                fichier: 'rapports.html',         acces: 'rapports.lire' },
];

export function creerApplication({ limiteConnexions = 20, nettoyageSessions = true } = {}) {
  const app = express();
  const dossierPublic = join(config.racine, 'public');

  app.disable('x-powered-by');
  app.set('trust proxy', 1);       // derrière le proxy HTTPS de Render : vraie adresse et vrai protocole

  // En-têtes de sécurité. HTTPS forcé seulement en ligne : en local, le site
  // tourne en http://localhost.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: config.production ? [] : null },
    },
    strictTransportSecurity: config.production,
  }));

  if (config.environnement !== 'test') app.use(journalRequetes);

  // Feuilles de style, scripts, icône : servis directement, sans session.
  // Les pages HTML, elles, passent par le contrôle d'accès plus bas.
  const statique = express.static(dossierPublic, { index: false, maxAge: config.production ? '1h' : 0 });
  app.use((req, res, next) => (req.path.endsWith('.html') ? next() : statique(req, res, next)));
  // Bibliothèque de code-barres (étiquettes), servie depuis l'application elle-même.
  app.use('/vendor/jsbarcode', express.static(join(config.racine, 'node_modules', 'jsbarcode', 'dist'), {
    index: false, maxAge: config.production ? '7d' : 0,
  }));

  const { middleware: session, magasin } = creerSession({
    pool: obtenirPool(),
    secret: secretSession(),
    production: config.production,
    nettoyage: nettoyageSessions,
  });
  app.use(session, chargerUtilisateur);

  app.use('/api', controleOrigine(config.originesAutorisees), express.json({ limit: '100kb' }), creerRouteurApi({ limiteConnexions }));
  app.use('/api', (req, res, next) => next(new ErreurApi(404, 'INTROUVABLE', 'Adresse d’API inconnue.')));

  for (const page of PAGES) {
    app.get(page.chemin, (req, res) => {
      const utilisateur = req.utilisateur;
      const servir = () => res.set('Cache-Control', 'no-store').sendFile(join(dossierPublic, page.fichier));

      if (page.acces === 'public') {
        if (utilisateur) return res.redirect(utilisateur.doit_changer_mot_de_passe ? '/mot-de-passe' : '/');
        return servir();
      }
      if (!utilisateur) return res.redirect(`/connexion?retour=${encodeURIComponent(req.originalUrl)}`);
      if (utilisateur.doit_changer_mot_de_passe && page.acces !== 'mot-de-passe') return res.redirect('/mot-de-passe');
      if (!['connecte', 'mot-de-passe'].includes(page.acces) && !aLeDroit(utilisateur.role_code, page.acces)) {
        return res.redirect('/');
      }
      return servir();
    });
  }

  app.use((req, res) => res.status(404).sendFile(join(dossierPublic, '404.html')));
  app.use(gestionnaireErreurs({ production: config.production }));

  // Arrêt propre : stoppe le nettoyage périodique des sessions.
  app.locals.fermer = () => magasin.close();
  return app;
}
