// Une ligne par requête dans le journal du serveur (visible dans Render) :
// date, méthode, chemin sans paramètres, statut, durée. Jamais le contenu.
export function journalRequetes(req, res, next) {
  const debut = performance.now();
  res.on('finish', () => {
    const duree = Math.round(performance.now() - debut);
    console.log(`${new Date().toISOString()} ${req.method} ${req.baseUrl}${req.path} ${res.statusCode} ${duree} ms`);
  });
  next();
}
