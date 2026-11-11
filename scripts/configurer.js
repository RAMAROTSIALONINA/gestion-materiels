// npm run configurer
//
// Remplit le fichier .env à partir des deux chaînes de connexion copiées dans
// Neon (branche production, puis branche test), ajoute une clé de session, puis
// essaie les deux connexions. Les chaînes ne sont jamais affichées, ni pendant
// la saisie (écho coupé), ni ensuite : elles contiennent le mot de passe de la base.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import pg from 'pg';
import { normaliserChaine, poserVariable } from './chaine-connexion.js';

const { values: options } = parseArgs({ options: { fichier: { type: 'string' } } });
const fichierEnv = options.fichier ?? fileURLToPath(new URL('../.env', import.meta.url));
const modele = fileURLToPath(new URL('../.env.example', import.meta.url));

// Lecture ligne à ligne : les lignes arrivées d'avance (collage de plusieurs
// lignes) sont gardées en réserve au lieu d'être perdues.
// GM_TERMINAL=1 force le mode terminal (sert aux essais automatiques).
const terminal = Boolean(stdin.isTTY) || process.env.GM_TERMINAL === '1';
const lecteur = createInterface({ input: stdin, output: stdout, terminal });
const lignes = lecteur[Symbol.asyncIterator]();

// En mode terminal, c'est readline qui réaffiche chaque caractère saisi : on
// coupe cet écho pendant la saisie de la chaîne.
let echoCoupe = false;
const ecrireEcho = lecteur._writeToOutput.bind(lecteur);
lecteur._writeToOutput = (texte) => {
  if (!echoCoupe) ecrireEcho(texte);
};
lecteur.on('SIGINT', () => {
  stdout.write('\nAbandon : rien n’a été enregistré.\n');
  lecteur.close();
  process.exit(130);
});

async function lireLigne(invite) {
  lecteur.setPrompt(invite);
  lecteur.prompt();
  echoCoupe = terminal;
  try {
    const { value, done } = await lignes.next();
    if (done) throw new Error('saisie interrompue.');
    return value;
  } finally {
    echoCoupe = false;
    stdout.write(terminal ? '[chaîne reçue — masquée à l’écran]\n' : '\n');
  }
}

function decrire(c) {
  const morceaux = [`base ${c.base}`];
  if (c.region) morceaux.push(`région ${c.region}${c.region === 'eu-central-1' ? ' (Frankfurt)' : ''}`);
  if (c.neon) morceaux.push(c.pooling ? 'pooling activé' : 'pooling NON activé');
  return morceaux.join(', ');
}

async function demanderChaine(titre, consignes, verifier = () => null) {
  for (;;) {
    console.log(`\n${titre}`);
    for (const consigne of consignes) console.log(`  ${consigne}`);
    console.log('Collez la chaîne ici, puis appuyez sur Entrée :');
    const saisie = await lireLigne('> ');
    try {
      const chaine = normaliserChaine(saisie);
      const refus = verifier(chaine);
      if (refus) throw new Error(refus);
      console.log(`  ✓ Chaîne reçue : ${decrire(chaine)}.`);
      if (chaine.neon && !chaine.pooling) {
        console.log('  ! Conseil : activez « Connection pooling » dans la fenêtre Connect de Neon, puis recopiez.');
      }
      if (chaine.region && chaine.region !== 'eu-central-1') {
        console.log(`  ! Attention : cette base est en ${chaine.region}, pas à Frankfurt (eu-central-1).`);
      }
      return chaine;
    } catch (erreur) {
      console.log(`  ✗ ${erreur.message}`);
      console.log('  Recommencez.');
    }
  }
}

// Cause d'un échec de connexion, en clair.
function causeEchec(erreur) {
  const code = erreur.code ?? erreur.errors?.[0]?.code;
  if (code === '28P01') return 'mot de passe refusé : recopiez la chaîne depuis Neon (après un changement de mot de passe, l’ancienne ne marche plus)';
  if (code === '3D000') return 'cette base n’existe pas sur ce serveur';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'adresse du serveur introuvable : vérifiez la connexion Internet et la chaîne';
  if (code === 'ECONNREFUSED') return 'le serveur refuse la connexion';
  if (code === 'ETIMEDOUT' || /timeout/i.test(erreur.message ?? '')) return 'le serveur ne répond pas : réessayez dans un instant';
  return erreur.message || erreur.errors?.[0]?.message || code || 'erreur inconnue';
}

async function essayerConnexion(libelle, chaine) {
  const client = new pg.Client({ connectionString: chaine, connectionTimeoutMillis: 20_000 });
  try {
    await client.connect();
    const { rows: [etat] } = await client.query(
      `SELECT split_part(version(), ' ', 2) AS version,
              to_regclass('public.schema_migrations') IS NOT NULL AS schema`,
    );
    console.log(`  ✓ ${libelle} : connexion réussie (PostgreSQL ${etat.version}, schéma ${etat.schema ? 'déjà créé' : 'pas encore créé'}).`);
    return true;
  } catch (erreur) {
    console.log(`  ✗ ${libelle} : connexion impossible — ${causeEchec(erreur)}.`);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

try {
  console.log('Configuration de la base de données (fichier .env)');
  console.log('Les chaînes contiennent le mot de passe de votre base : ne les envoyez à personne.');

  const travail = await demanderChaine(
    '1/2 — Base de travail (branche « production »)',
    ['Dans Neon : choisissez la branche production → bouton vert « Connect »',
      '→ « Connection pooling » activé → « Show password » → « Copy snippet ».'],
  );
  const test = await demanderChaine(
    '2/2 — Base de test (branche « test »)',
    ['Dans Neon : même fenêtre « Connect », mais choisissez la branche test',
      '→ « Show password » → « Copy snippet ».'],
    (chaine) => (chaine.point === travail.point && chaine.base === travail.base
      ? 'C’est la même branche que la base de travail : dans Neon, choisissez la branche « test ».'
      : null),
  );

  let texte = existsSync(fichierEnv) ? readFileSync(fichierEnv, 'utf8') : readFileSync(modele, 'utf8');
  texte = poserVariable(texte, 'DATABASE_URL', travail.chaine);
  texte = poserVariable(texte, 'DATABASE_URL_TEST', test.chaine);
  const secretActuel = parseEnv(texte).SESSION_SECRET;
  const secretValable = secretActuel && secretActuel !== 'a_remplacer' && secretActuel.length >= 32;
  if (!secretValable) texte = poserVariable(texte, 'SESSION_SECRET', randomBytes(32).toString('hex'));
  writeFileSync(fichierEnv, texte, 'utf8');
  console.log(`\n✓ Fichier enregistré : ${fichierEnv}${secretValable ? '' : ' (clé de session ajoutée)'}.`);

  console.log('\nEssai des connexions (Neon peut mettre quelques secondes à se réveiller)…');
  const ok = (await essayerConnexion('Base de travail', travail.chaine)) & (await essayerConnexion('Base de test', test.chaine));
  if (ok) {
    console.log('\nTout est prêt. Étape suivante :');
    console.log('  npm run db:migrer');
  } else {
    console.log('\nVérifiez la chaîne dans Neon, puis relancez : npm run configurer');
    process.exitCode = 1;
  }
} catch (erreur) {
  console.error(`\nÉchec : ${erreur.message}`);
  process.exitCode = 1;
} finally {
  lecteur.close();
}
