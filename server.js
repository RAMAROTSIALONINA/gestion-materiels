// Point d'entrée : npm start (ou npm run dev en local, rechargé à chaque modification).
import { creerApplication } from './app.js';
import { config, verifierConfig } from './config.js';
import { fermerBase } from './database/db.js';

try {
  verifierConfig();
} catch (erreur) {
  console.error(`Configuration incomplète : ${erreur.message}`);
  process.exit(1);
}

const application = creerApplication();
const serveur = application.listen(config.port, () => {
  console.log(`Gestion des matériels ${config.version} (${config.environnement}) — http://localhost:${config.port}`);
});

// Render arrête le service par SIGTERM : on finit les requêtes en cours,
// puis on ferme les connexions à la base.
function arreter(signal) {
  console.log(`${signal} reçu : arrêt du serveur…`);
  serveur.close(async () => {
    application.locals.fermer();
    await fermerBase().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', arreter);
process.on('SIGINT', arreter);
