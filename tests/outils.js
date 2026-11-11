// Outils des tests d'API : un « navigateur » qui garde ses cookies, et la
// création directe de comptes dans la base de test.
import { once } from 'node:events';

export class Navigateur {
  constructor(adresse) {
    this.adresse = adresse;
    this.cookies = new Map();
  }

  get connecte() {
    return this.cookies.has('gm.session');
  }

  async requete(chemin, { methode = 'GET', corps, entetes = {} } = {}) {
    const reponse = await fetch(`${this.adresse}${chemin}`, {
      method: methode,
      redirect: 'manual',
      headers: {
        ...(corps === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.cookies.size ? { Cookie: [...this.cookies].map(([nom, valeur]) => `${nom}=${valeur}`).join('; ') } : {}),
        ...entetes,
      },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    for (const ligne of reponse.headers.getSetCookie()) {
      const [paire] = ligne.split(';');
      const separateur = paire.indexOf('=');
      const nom = paire.slice(0, separateur);
      const valeur = paire.slice(separateur + 1);
      if (!valeur || /expires=Thu, 01 Jan 1970/i.test(ligne)) this.cookies.delete(nom);
      else this.cookies.set(nom, valeur);
    }
    const type = reponse.headers.get('content-type') ?? '';
    const donnees = type.includes('json') ? await reponse.json() : await reponse.text();
    return { statut: reponse.status, donnees, entetes: reponse.headers };
  }

  connexion(identifiant, motDePasse) {
    return this.requete('/api/auth/connexion', { methode: 'POST', corps: { identifiant, mot_de_passe: motDePasse } });
  }
}

export async function demarrerServeur(options = {}) {
  const { creerApplication } = await import('../app.js');
  const application = creerApplication({ nettoyageSessions: false, limiteConnexions: 1000, ...options });
  const serveur = application.listen(0, '127.0.0.1');
  await once(serveur, 'listening');
  return {
    adresse: `http://127.0.0.1:${serveur.address().port}`,
    arreter: () => new Promise((resoudre) => {
      application.locals.fermer();
      serveur.close(resoudre);
      serveur.closeAllConnections();
    }),
  };
}

// Compte créé directement en base (mot de passe connu, déjà personnel par défaut).
export async function creerCompte({ nom, email, identifiant = null, role = 'GESTIONNAIRE', motDePasse,
  statut = 'ACTIF', doitChanger = false, employeId = null, serviceId = null }) {
  const { requete } = await import('../database/db.js');
  const { hacherMotDePasse } = await import('../services/mots-de-passe.js');
  const { rows: [{ id }] } = await requete(
    `INSERT INTO utilisateurs (nom, email, identifiant, role_code, mot_de_passe_hash, statut, doit_changer_mot_de_passe, employe_id, service_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [nom, email, identifiant, role, await hacherMotDePasse(motDePasse), statut, doitChanger, employeId, serviceId],
  );
  return id;
}
