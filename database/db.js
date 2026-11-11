// Accès à la base PostgreSQL (Neon en ligne). Le navigateur ne s'y connecte
// jamais : toutes les requêtes passent par ce module.
import pg from 'pg';
import { config } from '../config.js';

// Conversion des types :
// - identifiants et montants (int8) → nombres JavaScript (texte s'ils dépassaient 2^53) ;
// - quantités (numeric) → nombres ;
// - dates de gestion (date) → texte AAAA-MM-JJ, pour éviter tout décalage de fuseau.
pg.types.setTypeParser(20, (valeur) => {
  const nombre = Number(valeur);
  return Number.isSafeInteger(nombre) ? nombre : valeur;
});
pg.types.setTypeParser(1700, (valeur) => Number(valeur));
pg.types.setTypeParser(1082, (valeur) => valeur);

let pool = null;

export function obtenirPool() {
  if (!pool) {
    if (!config.baseUrl) throw new Error('DATABASE_URL absente : la base de données n’est pas configurée.');
    pool = new pg.Pool({
      connectionString: config.baseUrl,
      max: Number(process.env.PG_POOL_MAX) || 5,     // offre gratuite Neon : rester sobre
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,                // Neon peut mettre quelques secondes à se réveiller
      application_name: config.nom,
    });
    pool.on('error', (erreur) => console.error('[base] connexion inactive perdue :', erreur.message));
  }
  return pool;
}

// Lecture simple (une requête, hors transaction).
export function requete(texte, valeurs) {
  return obtenirPool().query(texte, valeurs);
}

// Toute écriture passe par ici : une transaction dont l'auteur est connu.
// La base refuse les écritures sensibles sans auteur (erreur GM009).
// Réglages locaux à la transaction : compatible avec le pooler de Neon.
export async function transaction(utilisateurId, travail) {
  if (!Number.isSafeInteger(utilisateurId) || utilisateurId <= 0) {
    throw new TypeError('transaction() : identifiant d’utilisateur invalide');
  }
  const client = await obtenirPool().connect();
  let connexionCassee;
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.utilisateur_id', $1, true), set_config('statement_timeout', '15s', true)",
      [String(utilisateurId)],
    );
    const resultat = await travail(client);
    await client.query('COMMIT');
    return resultat;
  } catch (erreur) {
    try {
      await client.query('ROLLBACK');
    } catch (echec) {
      connexionCassee = echec;   // la connexion ne sera pas réutilisée
    }
    throw erreur;
  } finally {
    client.release(connexionCassee);
  }
}

// Commentaire repris dans l'historique pour un changement d'état ou de statut
// fait à la main (obligatoire vers « endommagé », « en réparation »…).
export function poserCommentaire(client, commentaire) {
  return client.query("SELECT set_config('app.commentaire', $1, true)", [commentaire ?? '']);
}

export async function fermerBase() {
  if (pool) {
    const ancien = pool;
    pool = null;
    await ancien.end();
  }
}
