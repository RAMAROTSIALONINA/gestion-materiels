// Chargement du fichier .env (travail en local). Une variable déjà présente dans
// l'environnement n'est jamais écrasée : en ligne, ce sont les variables de
// Render qui comptent ; le fichier .env n'est jamais versionné.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export function chargerFichierEnv(fichier = fileURLToPath(new URL('./.env', import.meta.url))) {
  if (!existsSync(fichier)) return false;
  for (const [cle, valeur] of Object.entries(parseEnv(readFileSync(fichier, 'utf8')))) {
    if (process.env[cle] === undefined) process.env[cle] = valeur;
  }
  return true;
}
