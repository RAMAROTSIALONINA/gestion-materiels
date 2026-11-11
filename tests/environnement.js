// Prépare les tests : ils travaillent sur DATABASE_URL_TEST, jamais sur la
// base de travail. À importer avant tout module de l'application.
import { chargerFichierEnv } from '../env.js';

chargerFichierEnv();

export const urlTest = process.env.DATABASE_URL_TEST?.trim() || null;
export const raisonSansBase = urlTest ? false : 'DATABASE_URL_TEST absente : tests de base et d’API ignorés';

if (urlTest && urlTest === process.env.DATABASE_URL?.trim()) {
  throw new Error('DATABASE_URL_TEST doit désigner une autre base que DATABASE_URL.');
}
process.env.NODE_ENV = 'test';
if (urlTest) process.env.DATABASE_URL = urlTest;

// Remet la base de test à zéro : schéma recréé, aucune donnée. Les tests
// créent de vrais comptes et de vraies sessions ; on repart propre avant et
// après, pour que « npm run db:verifier » trouve toujours une base vide.
//
// Sécurité : la base n'est effacée que si elle porte la marque « base_de_test »
// (posée par ce même outil) ou si elle ne contient encore aucune donnée.
export async function reinitialiserBaseDeTest() {
  const { obtenirPool } = await import('../database/db.js');
  const { mettreANiveau } = await import('../database/mise-a-niveau.js');
  const client = await obtenirPool().connect();
  try {
    const { rows: [etat] } = await client.query(
      `SELECT to_regclass('public.base_de_test') IS NOT NULL AS marquee,
              to_regclass('public.utilisateurs') IS NOT NULL AS schema`,
    );
    if (!etat.marquee && etat.schema) {
      const { rows: [{ lignes }] } = await client.query(
        `SELECT (SELECT count(*) FROM utilisateurs) + (SELECT count(*) FROM materiels)
              + (SELECT count(*) FROM articles) + (SELECT count(*) FROM mouvements) AS lignes`,
      );
      if (Number(lignes) > 0) {
        throw new Error('Refus d’effacer : la base DATABASE_URL_TEST contient des données et n’est pas marquée comme base de test.');
      }
    }
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await mettreANiveau(client, () => {});
    await client.query('CREATE TABLE base_de_test (marquee_le timestamptz NOT NULL DEFAULT now()); INSERT INTO base_de_test DEFAULT VALUES;');
  } finally {
    client.release();
  }
}
