// Configuration de l'application, lue dans les variables d'environnement.
// Aucune valeur secrète n'est écrite dans le code : voir .env.example.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chargerFichierEnv } from './env.js';

chargerFichierEnv();

const paquet = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const texte = (nom) => process.env[nom]?.trim() || null;

export const config = Object.freeze({
  nom: paquet.name,
  version: paquet.version,
  environnement: texte('NODE_ENV') ?? 'development',
  production: texte('NODE_ENV') === 'production',
  port: Number(texte('PORT')) || 3000,
  baseUrl: texte('DATABASE_URL'),
  baseTestUrl: texte('DATABASE_URL_TEST'),
  secretSession: texte('SESSION_SECRET'),
  // Sites autorisés à envoyer des écritures, en plus de l'application elle-même.
  originesAutorisees: (texte('CORS_ORIGIN') ?? '')
    .split(',')
    .map((origine) => origine.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  racine: fileURLToPath(new URL('.', import.meta.url)),
});

const URL_POSTGRES = /^postgres(ql)?:\/\/.+/;

// Contrôle au démarrage : arrête tout de suite avec un message clair plutôt que
// d'échouer plus tard, à la première requête.
export function verifierConfig({ base = 'DATABASE_URL' } = {}) {
  const valeur = base === 'DATABASE_URL' ? config.baseUrl : config.baseTestUrl;
  if (!valeur) {
    throw new Error(`${base} absente : copiez .env.example en .env et renseignez-la (voir docs/installation.md).`);
  }
  if (!URL_POSTGRES.test(valeur)) {
    throw new Error(`${base} doit être une chaîne de connexion PostgreSQL (postgresql://…).`);
  }
  if (base === 'DATABASE_URL_TEST' && valeur === config.baseUrl) {
    throw new Error('DATABASE_URL_TEST doit désigner une autre base que DATABASE_URL : les contrôles écrivent dans la base de test.');
  }
  if (base === 'DATABASE_URL' && config.production && !secretValable()) {
    throw new Error('SESSION_SECRET absente ou trop courte (32 caractères au moins) : obligatoire en ligne.');
  }
}

const secretValable = () => Boolean(config.secretSession && config.secretSession !== 'a_remplacer' && config.secretSession.length >= 32);

// Clé de signature des cookies de session. En local, sans SESSION_SECRET, une
// clé provisoire est tirée au hasard : les sessions sont perdues au redémarrage.
let secretProvisoire;
export function secretSession() {
  if (secretValable()) return config.secretSession;
  if (config.production) throw new Error('SESSION_SECRET absente ou trop courte.');
  if (!secretProvisoire) {
    secretProvisoire = randomBytes(32).toString('hex');
    if (config.environnement !== 'test') {
      console.warn('SESSION_SECRET absente : clé provisoire, les connexions seront perdues au redémarrage du serveur.');
    }
  }
  return secretProvisoire;
}
