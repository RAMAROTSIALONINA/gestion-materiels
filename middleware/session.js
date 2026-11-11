// Sessions de connexion stockées en base (table « sessions »), dans un cookie
// inaccessible au JavaScript de la page, envoyé seulement en HTTPS en ligne.
import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';

const MagasinPg = connectPgSimple(session);

export const NOM_COOKIE = 'gm.session';
export const DUREE_INACTIVITE_MS = 4 * 60 * 60 * 1000;   // déconnexion après 4 h sans activité

export const OPTIONS_COOKIE = (production) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: production,
  path: '/',
});

export function creerSession({ pool, secret, production, nettoyage = true }) {
  const magasin = new MagasinPg({
    pool,
    tableName: 'sessions',
    createTableIfMissing: false,
    pruneSessionInterval: nettoyage ? 15 * 60 : false,      // sessions expirées effacées toutes les 15 min
  });
  const middleware = session({
    name: NOM_COOKIE,
    store: magasin,
    secret,
    resave: false,
    saveUninitialized: false,     // pas de session ni de cookie avant la connexion
    rolling: true,                // chaque requête repousse l'expiration
    cookie: { ...OPTIONS_COOKIE(production), maxAge: DUREE_INACTIVITE_MS },
  });
  return { middleware, magasin };
}

export function regenererSession(req) {
  return new Promise((resoudre, rejeter) => req.session.regenerate((erreur) => (erreur ? rejeter(erreur) : resoudre())));
}

export function detruireSession(req) {
  if (!req.session) return Promise.resolve();
  return new Promise((resoudre, rejeter) => req.session.destroy((erreur) => (erreur ? rejeter(erreur) : resoudre())));
}
