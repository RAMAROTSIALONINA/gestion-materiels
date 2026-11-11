// Nettoyage des chaînes de connexion copiées depuis Neon (commande npm run configurer).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normaliserChaine, poserVariable } from '../scripts/chaine-connexion.js';

const NEON = 'postgresql://neondb_owner:npg_Abc123@ep-bold-art-baa8g68i-pooler.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

test('chaîne Neon : SSL vérifié, channel_binding retiré, région et pooling reconnus', () => {
  const resultat = normaliserChaine(NEON);
  assert.equal(resultat.chaine,
    'postgresql://neondb_owner:npg_Abc123@ep-bold-art-baa8g68i-pooler.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full');
  assert.equal(resultat.region, 'eu-central-1');
  assert.equal(resultat.pooling, true);
  assert.equal(resultat.base, 'neondb');
  assert.equal(resultat.point, 'ep-bold-art-baa8g68i-pooler');
});

test('nom de base absent : neondb ajouté', () => {
  const sansBase = NEON.replace('/neondb?', '/?');
  assert.match(normaliserChaine(sansBase).chaine, /neon\.tech\/neondb\?sslmode=verify-full$/);
});

test('chaîne copiée dans une commande psql ou entre guillemets', () => {
  assert.equal(normaliserChaine(`psql '${NEON}'`).base, 'neondb');
  assert.equal(normaliserChaine(` "${NEON}" `).region, 'eu-central-1');
  assert.equal(normaliserChaine(`DATABASE_URL=${NEON}`).pooling, true);
});

test('mot de passe masqué ou absent : message clair', () => {
  assert.throws(() => normaliserChaine(NEON.replace('npg_Abc123', '****************')), /Show password/);
  assert.throws(() => normaliserChaine('postgresql://neondb_owner@hote.neon.tech/neondb'), /Show password/);
});

test('texte sans chaîne : refusé', () => {
  assert.throws(() => normaliserChaine('bonjour'), /postgresql:\/\//);
});

test('PostgreSQL local : chaîne laissée telle quelle (pas de SSL imposé)', () => {
  const locale = normaliserChaine('postgresql://postgres:secret@localhost:5432/gestion_materiels');
  assert.equal(locale.chaine, 'postgresql://postgres:secret@localhost:5432/gestion_materiels');
  assert.equal(locale.neon, false);
});

test('fichier .env : ligne remplacée, ou ajoutée si absente, sans toucher au reste', () => {
  const texte = 'PORT=3000\nDATABASE_URL=ancienne\n';
  assert.equal(poserVariable(texte, 'DATABASE_URL', 'nouvelle$&'), 'PORT=3000\nDATABASE_URL=nouvelle$&\n');
  assert.equal(poserVariable(texte, 'SESSION_SECRET', 'cle'), 'PORT=3000\nDATABASE_URL=ancienne\nSESSION_SECRET=cle\n');
});
