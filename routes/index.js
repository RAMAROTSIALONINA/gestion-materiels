// Toutes les routes de l'API, montées sous /api.
// Phase 8 : rapports.
import { Router } from 'express';
import { routeurAffectations } from './affectations.js';
import { routeurArticles } from './articles.js';
import { creerRouteurAuth } from './auth.js';
import { routeurEmployes } from './employes.js';
import { routeurMateriels } from './materiels.js';
import { routeurMouvements } from './mouvements.js';
import { routeurParametres } from './parametres.js';
import { routeurReferentiels } from './referentiels.js';
import { routeurSante } from './sante.js';
import { routeurSignalements } from './signalements.js';
import { routeurSuivi } from './suivi.js';
import { routeurUtilisateurs } from './utilisateurs.js';

export function creerRouteurApi(options = {}) {
  const routeur = Router();
  routeur.use(routeurSante);
  routeur.use(creerRouteurAuth(options));
  routeur.use(routeurUtilisateurs);
  routeur.use(routeurReferentiels);
  routeur.use(routeurParametres);
  routeur.use(routeurEmployes);
  routeur.use(routeurMateriels);
  routeur.use(routeurArticles);
  routeur.use(routeurMouvements);
  routeur.use(routeurAffectations);
  routeur.use(routeurSignalements);
  routeur.use(routeurSuivi);
  return routeur;
}
