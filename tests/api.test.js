// Serveur HTTP : santé, pages, sécurité, erreurs.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { raisonSansBase, reinitialiserBaseDeTest } from './environnement.js';
import { demarrerServeur } from './outils.js';

describe('API et pages', { skip: raisonSansBase }, () => {
  let serveur;
  let adresse;

  before(async () => {
    await reinitialiserBaseDeTest();
    serveur = await demarrerServeur();
    adresse = serveur.adresse;
  });

  after(async () => {
    await serveur?.arreter();
    await reinitialiserBaseDeTest();
    const { fermerBase } = await import('../database/db.js');
    await fermerBase();
  });

  test('GET /api/sante : serveur et base opérationnels, sans connexion', async () => {
    const reponse = await fetch(`${adresse}/api/sante`);
    assert.equal(reponse.status, 200);
    const etat = await reponse.json();
    assert.equal(etat.application, 'gestion-materiels');
    assert.equal(etat.base.joignable, true);
    const versionAttendue = readdirSync(new URL('../database/migrations/', import.meta.url))
      .map((fichier) => fichier.match(/^(\d{4})_[\w-]+\.sql$/)?.[1])
      .filter(Boolean)
      .reduce((plusHaute, version) => (version > plusHaute ? version : plusHaute), '0001');
    assert.equal(etat.base.version_schema, versionAttendue);
    assert.equal(etat.base.fuseau, 'Indian/Antananarivo');
    assert.match(etat.base.date_du_jour, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('en-têtes de sécurité présents, serveur non dévoilé', async () => {
    const reponse = await fetch(`${adresse}/api/sante`);
    assert.equal(reponse.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(reponse.headers.get('content-security-policy'));
    assert.equal(reponse.headers.get('x-powered-by'), null);
    assert.equal(reponse.headers.get('access-control-allow-origin'), null);
  });

  test('adresse d’API inconnue : 404 en JSON', async () => {
    const reponse = await fetch(`${adresse}/api/inconnue`);
    assert.equal(reponse.status, 404);
    assert.equal((await reponse.json()).erreur.code, 'INTROUVABLE');
  });

  test('écriture envoyée par un autre site : 403', async () => {
    const reponse = await fetch(`${adresse}/api/auth/connexion`, {
      method: 'POST',
      headers: { Origin: 'https://site-malveillant.example', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(reponse.status, 403);
    assert.equal((await reponse.json()).erreur.code, 'ORIGINE_REFUSEE');
  });

  test('données illisibles : 400 avec message clair', async () => {
    const reponse = await fetch(`${adresse}/api/auth/connexion`, {
      method: 'POST',
      headers: { Origin: adresse, 'Content-Type': 'application/json' },
      body: '{pas du json',
    });
    assert.equal(reponse.status, 400);
    assert.equal((await reponse.json()).erreur.code, 'JSON_ILLISIBLE');
  });

  test('pages : connexion ouverte, les autres renvoient vers la connexion', async () => {
    const connexion = await fetch(`${adresse}/connexion`);
    assert.equal(connexion.status, 200);
    assert.match(await connexion.text(), /Identifiant ou adresse e-mail/);
    assert.equal(connexion.headers.get('cache-control'), 'no-store');

    for (const page of ['/', '/utilisateurs', '/mot-de-passe']) {
      const reponse = await fetch(`${adresse}${page}`, { redirect: 'manual' });
      assert.equal(reponse.status, 302, page);
      assert.equal(reponse.headers.get('location'), `/connexion?retour=${encodeURIComponent(page)}`);
    }
  });

  test('fichiers HTML jamais servis directement, styles et icône servis sans session', async () => {
    assert.equal((await fetch(`${adresse}/utilisateurs.html`)).status, 404);
    assert.equal((await fetch(`${adresse}/index.html`)).status, 404);
    const style = await fetch(`${adresse}/css/style.css`);
    assert.equal(style.status, 200);
    assert.equal(style.headers.get('set-cookie'), null);
    const icone = await fetch(`${adresse}/favicon.svg`);
    assert.match(icone.headers.get('content-type'), /image\/svg\+xml/);
    const introuvable = await fetch(`${adresse}/page-inexistante`);
    assert.equal(introuvable.status, 404);
    assert.match(await introuvable.text(), /Page introuvable/);
  });
});
