// Accès à la base : transactions, auteur courant, conversion des types.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { raisonSansBase, reinitialiserBaseDeTest } from './environnement.js';

describe('base de données', { skip: raisonSansBase }, () => {
  let db;

  before(async () => {
    await reinitialiserBaseDeTest();
    db = await import('../database/db.js');
  });

  after(async () => {
    await reinitialiserBaseDeTest();
    await db?.fermerBase();
  });

  test('une transaction connaît son auteur, qui disparaît ensuite', async () => {
    const dedans = await db.transaction(42, async (client) => {
      const { rows } = await client.query("SELECT current_setting('app.utilisateur_id') AS auteur");
      return rows[0].auteur;
    });
    assert.equal(dedans, '42');
    const { rows } = await db.requete("SELECT coalesce(current_setting('app.utilisateur_id', true), '') AS auteur");
    assert.equal(rows[0].auteur, '');
  });

  test('une erreur annule toute la transaction', async () => {
    await assert.rejects(
      db.transaction(42, async (client) => {
        await client.query("INSERT INTO sites (code, nom) VALUES ('ZZ-ESSAI', 'Essai de transaction')");
        throw new Error('arrêt volontaire');
      }),
      /arrêt volontaire/,
    );
    const { rows } = await db.requete("SELECT count(*)::int AS nombre FROM sites WHERE code = 'ZZ-ESSAI'");
    assert.equal(rows[0].nombre, 0);
  });

  test('écriture d’un matériel hors transaction avec auteur : refusée (GM009)', async () => {
    await assert.rejects(
      db.requete("INSERT INTO materiels (designation, categorie_id, site_id) VALUES ('Essai', 1, 1)"),
      (erreur) => erreur.code === 'GM009',
    );
  });

  test('identifiant d’auteur invalide : refusé avant d’aller en base', async () => {
    await assert.rejects(db.transaction(0, async () => {}), TypeError);
    await assert.rejects(db.transaction('12', async () => {}), TypeError);
  });

  test('types : date en texte AAAA-MM-JJ, entiers et quantités en nombres', async () => {
    const { rows: [ligne] } = await db.requete('SELECT aujourdhui() AS jour, 42::bigint AS id, 2.5::numeric AS quantite');
    assert.match(ligne.jour, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(ligne.id, 42);
    assert.equal(ligne.quantite, 2.5);
  });
});
