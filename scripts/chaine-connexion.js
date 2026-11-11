// Nettoyage d'une chaîne de connexion PostgreSQL copiée depuis Neon :
// - accepte la chaîne seule, entre guillemets, ou dans une commande « psql '…' » ;
// - ajoute le nom de base s'il manque ;
// - pour Neon : SSL avec vérification du certificat (sslmode=verify-full),
//   option channel_binding retirée (ignorée par la bibliothèque pg).
export function normaliserChaine(saisie, { baseParDefaut = 'neondb' } = {}) {
  const trouve = String(saisie ?? '').match(/postgres(?:ql)?:\/\/[^\s'"]+/);
  if (!trouve) {
    throw new Error('Ce texte ne contient pas de chaîne de connexion (elle commence par postgresql://).');
  }
  let url;
  try {
    url = new URL(trouve[0]);
  } catch {
    throw new Error('Chaîne de connexion illisible : recopiez-la depuis Neon avec « Copy snippet ».');
  }
  if (!url.username || !url.password || /^\*+$/.test(decodeURIComponent(url.password))) {
    throw new Error('Le mot de passe manque : dans Neon, cliquez sur « Show password » puis sur « Copy snippet ».');
  }
  if (!url.hostname) throw new Error('Adresse du serveur absente de la chaîne.');
  if (!url.pathname || url.pathname === '/') url.pathname = `/${baseParDefaut}`;

  const neon = url.hostname.endsWith('.neon.tech');
  if (neon) {
    url.searchParams.delete('channel_binding');
    url.searchParams.set('sslmode', 'verify-full');
  }
  return {
    chaine: url.toString(),
    point: url.hostname.split('.')[0],              // identifiant du point d'accès (une branche = un point)
    base: decodeURIComponent(url.pathname.slice(1)),
    neon,
    pooling: url.hostname.includes('-pooler'),
    region: url.hostname.match(/\.([a-z]{2}-[a-z]+-\d+)\.aws\.neon\.tech$/)?.[1] ?? null,
  };
}

// Pose ou remplace une ligne CLE=valeur dans le texte d'un fichier .env.
export function poserVariable(texte, cle, valeur) {
  const ligne = `${cle}=${valeur}`;
  const motif = new RegExp(`^${cle}=.*$`, 'm');
  return motif.test(texte) ? texte.replace(motif, () => ligne) : `${texte.trimEnd()}\n${ligne}\n`;
}
