// npm run db:verifier — contrôle les règles de la base sur la base de TEST
// (DATABASE_URL_TEST), jamais sur la base de travail. La base de test est mise
// au niveau si besoin ; elle doit être vide (aucun site, matériel, article ni
// compte). Le script de contrôle annule tout à la fin.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { config, verifierConfig } from '../config.js';
import { mettreANiveau } from './mise-a-niveau.js';

let client;
try {
  verifierConfig({ base: 'DATABASE_URL_TEST' });
  client = new pg.Client({ connectionString: config.baseTestUrl, application_name: `${config.nom}-verification` });
  await client.connect();
  await mettreANiveau(client);

  const { rows: [{ lignes }] } = await client.query(
    `SELECT (SELECT count(*) FROM sites) + (SELECT count(*) FROM materiels)
          + (SELECT count(*) FROM articles) + (SELECT count(*) FROM utilisateurs) AS lignes`,
  );
  if (Number(lignes) > 0) {
    throw new Error('La base de test contient des données : utilisez une base (ou une branche Neon) vide.');
  }

  let reussis = 0;
  client.on('notice', (avis) => {
    if (avis.message.startsWith('OK')) reussis += 1;
    console.log(avis.message);
  });
  const script = await readFile(new URL('./tests/test_regles.sql', import.meta.url), 'utf8');
  await client.query(script);
  console.log(`\n${reussis} contrôles réussis.`);
} catch (erreur) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error(`\nÉchec : ${erreur.message}`);
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
}
