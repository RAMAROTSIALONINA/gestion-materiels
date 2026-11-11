// npm run db:migrer — met la base DATABASE_URL au niveau du code.
import { verifierConfig } from '../config.js';
import { fermerBase, obtenirPool } from './db.js';
import { mettreANiveau } from './mise-a-niveau.js';

try {
  verifierConfig();
  const client = await obtenirPool().connect();
  try {
    await mettreANiveau(client);
  } finally {
    client.release();
  }
  await fermerBase();
} catch (erreur) {
  console.error(`Échec : ${erreur.message}`);
  await fermerBase().catch(() => {});
  process.exitCode = 1;
}
