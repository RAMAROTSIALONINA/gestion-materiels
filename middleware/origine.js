// Refuse les écritures envoyées par un autre site (protection contre la
// falsification de requête). L'application et son API ont la même adresse :
// aucun en-tête CORS n'est émis, donc un autre site ne peut pas non plus lire
// les réponses. CORS_ORIGIN permet d'autoriser explicitement une autre adresse.
import { ErreurApi } from './erreurs.js';

const LECTURES = new Set(['GET', 'HEAD', 'OPTIONS']);

export function controleOrigine(originesAutorisees = []) {
  return (req, res, next) => {
    if (LECTURES.has(req.method)) return next();
    const origine = req.get('origin');
    if (!origine) return next();                 // client hors navigateur
    const propre = `${req.protocol}://${req.get('host')}`;
    if (origine === propre || originesAutorisees.includes(origine)) return next();
    next(new ErreurApi(403, 'ORIGINE_REFUSEE', 'Requête refusée : elle ne vient pas de l’application.'));
  };
}
