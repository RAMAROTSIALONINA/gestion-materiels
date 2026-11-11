// Met une base au niveau du code : crée le schéma si la base est vide, puis
// applique dans l'ordre les migrations database/migrations/NNNN_nom.sql pas
// encore inscrites dans schema_migrations. Chaque migration s'exécute dans une
// transaction : en cas d'erreur, rien n'est appliqué.
import { readFile, readdir } from 'node:fs/promises';

const VERROU = 4_731_202;                       // une seule mise à niveau à la fois
const FICHIER_MIGRATION = /^(\d{4})_([\w-]+)\.sql$/;

export async function mettreANiveau(client, journal = console.log) {
  await client.query('SELECT pg_advisory_lock($1)', [VERROU]);
  try {
    const { rows: [{ existe }] } = await client.query(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS existe",
    );
    if (!existe) {
      journal('Base vide : création du schéma (version 0001)…');
      const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
      try {
        await client.query(schema);              // le fichier gère lui-même sa transaction
      } catch (erreur) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Création du schéma refusée : ${erreur.message}`);
      }
    }

    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const appliquees = new Set(rows.map((ligne) => ligne.version));
    const fichiers = (await readdir(new URL('./migrations/', import.meta.url)))
      .filter((fichier) => FICHIER_MIGRATION.test(fichier))
      .sort();

    let nombre = 0;
    for (const fichier of fichiers) {
      const [, version, nom] = fichier.match(FICHIER_MIGRATION);
      if (appliquees.has(version)) continue;
      journal(`Migration ${fichier}…`);
      const sql = await readFile(new URL(`./migrations/${fichier}`, import.meta.url), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, description) VALUES ($1, $2)',
          [version, nom.replaceAll('_', ' ')],
        );
        await client.query('COMMIT');
      } catch (erreur) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${fichier} refusée, rien n'a été appliqué : ${erreur.message}`);
      }
      nombre += 1;
    }

    const { rows: [{ version }] } = await client.query('SELECT max(version) AS version FROM schema_migrations');
    journal(`Base à jour : version ${version}${nombre ? ` (${nombre} migration(s) appliquée(s))` : ''}.`);
    return version;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [VERROU]).catch(() => {});
  }
}
