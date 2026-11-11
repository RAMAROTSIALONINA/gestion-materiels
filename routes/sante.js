// GET /api/sante — le serveur répond-il, et la base aussi ?
// Sert de contrôle de bon fonctionnement (Render) et d'écran d'état.
import { Router } from 'express';
import { config } from '../config.js';
import { requete } from '../database/db.js';

export const routeurSante = Router();

const SCHEMA_ABSENT = new Set(['42P01', '42883']);   // table ou fonction inconnue

routeurSante.get('/sante', async (req, res) => {
  const debut = performance.now();
  const etat = {
    application: config.nom,
    version: config.version,
    environnement: config.environnement,
    heure_serveur: new Date().toISOString(),
  };
  try {
    const { rows: [base] } = await requete(
      `SELECT (SELECT max(version) FROM schema_migrations) AS version_schema,
              aujourdhui() AS date_du_jour,
              fuseau_horaire() AS fuseau`,
    );
    res.json({ ...etat, base: { joignable: true, ...base, delai_ms: Math.round(performance.now() - debut) } });
  } catch (erreur) {
    if (SCHEMA_ABSENT.has(erreur.code)) {
      return res.status(503).json({
        ...etat,
        base: { joignable: true, version_schema: null, message: 'Base vide : lancez « npm run db:migrer ».' },
      });
    }
    console.error('[santé] base injoignable :', erreur.message);
    res.status(503).json({
      ...etat,
      base: {
        joignable: false,
        message: 'La base de données ne répond pas. Réessayez dans un instant.',
        ...(config.production ? {} : { detail: erreur.message }),
      },
    });
  }
});
