// npm run admin:creer -- --nom "Prénom NOM" --email adresse@societe.mg [--identifiant jdupont]
//
// Crée un compte administrateur sur la base DATABASE_URL, avec un mot de passe
// provisoire affiché une seule fois ici, à changer à la première connexion.
// Sert surtout à créer le tout premier compte ; les suivants se créent depuis
// l'écran Utilisateurs.
import { parseArgs } from 'node:util';
import { verifierConfig } from '../config.js';
import { fermerBase, obtenirPool } from '../database/db.js';
import { journaliser } from '../services/journal.js';
import { genererMotDePasseProvisoire, hacherMotDePasse } from '../services/mots-de-passe.js';
import { EMAIL, IDENTIFIANT } from '../services/validation.js';

const USAGE = 'Usage : npm run admin:creer -- --nom "Prénom NOM" --email adresse@societe.mg [--identifiant jdupont]';

try {
  const { values } = parseArgs({
    options: { nom: { type: 'string' }, email: { type: 'string' }, identifiant: { type: 'string' } },
    strict: true,
  });
  const nom = values.nom?.trim();
  const email = values.email?.trim().toLowerCase();
  const identifiant = values.identifiant?.trim() || null;
  if (!nom || !email) throw new Error(`le nom et l'adresse e-mail sont obligatoires.\n${USAGE}`);
  if (!EMAIL.test(email)) throw new Error('adresse e-mail non valable.');
  if (identifiant && !IDENTIFIANT.test(identifiant)) {
    throw new Error('identifiant : 3 à 40 caractères parmi lettres, chiffres, point, tiret et soulignement.');
  }

  verifierConfig();
  const provisoire = genererMotDePasseProvisoire();
  const empreinte = await hacherMotDePasse(provisoire);
  const client = await obtenirPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO utilisateurs (nom, email, identifiant, role_code, mot_de_passe_hash, doit_changer_mot_de_passe)
       VALUES ($1, $2, $3, 'ADMIN', $4, true) RETURNING id`,
      [nom, email, identifiant, empreinte],
    );
    await journaliser({
      action: 'ADMINISTRATEUR_CREE', entite: 'utilisateurs', entiteId: id, metadonnees: { origine: 'ligne de commande' },
    }, client);
    await client.query('COMMIT');
  } catch (erreur) {
    await client.query('ROLLBACK').catch(() => {});
    if (erreur.code === '23505') throw new Error('cette adresse e-mail ou cet identifiant est déjà utilisé.');
    throw erreur;
  } finally {
    client.release();
  }

  console.log(`Compte administrateur créé pour ${nom} <${email}>.`);
  console.log(`Mot de passe provisoire : ${provisoire}`);
  console.log('Il ne sera plus affiché. Il devra être changé à la première connexion.');
} catch (erreur) {
  console.error(`Échec : ${erreur.message}`);
  process.exitCode = 1;
} finally {
  await fermerBase().catch(() => {});
}
