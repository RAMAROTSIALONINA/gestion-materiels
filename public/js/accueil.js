// Page d'accueil : salutation, puis état du serveur et de la base (/api/sante).
import { afficherMessage, api, formaterDate } from './app.js';
import { initialiserEntete, pageAccueil } from './entete.js';

const element = (id) => document.getElementById(id);

function afficherPastille(texte, classe) {
  const pastille = element('pastille');
  pastille.textContent = texte;
  pastille.className = `pastille ${classe}`;
}

function remplir(etat) {
  element('etat-application').textContent = `${etat.application} ${etat.version} (${etat.environnement})`;
  const base = etat.base ?? {};
  element('etat-base').textContent = base.joignable ? 'Joignable' : 'Injoignable';
  element('etat-schema').textContent = base.version_schema ?? (base.joignable ? 'Aucun : base vide' : '—');
  element('etat-date').textContent = base.date_du_jour
    ? `${formaterDate(base.date_du_jour)} (${base.fuseau})`
    : '—';
  element('etat-delai').textContent = base.delai_ms === undefined ? '—' : `${base.delai_ms} ms`;
}

async function verifier() {
  const bouton = element('actualiser');
  bouton.disabled = true;
  afficherPastille('Vérification…', 'pastille-attente');
  try {
    remplir(await api('/sante'));
    afficherPastille('Opérationnel', 'pastille-ok');
  } catch (erreur) {
    if (erreur.donnees) remplir(erreur.donnees);
    afficherPastille('Problème', 'pastille-ko');
    afficherMessage(erreur.donnees?.base?.message ?? erreur.message);
  } finally {
    bouton.disabled = false;
  }
}

const utilisateur = await initialiserEntete();
// L'employé n'a que ses matériels : il y va directement.
if (pageAccueil(utilisateur) !== '/') {
  window.location.replace(pageAccueil(utilisateur));
} else {
  element('bonjour').textContent = `Bonjour, ${utilisateur.nom}`;
  element('actualiser').addEventListener('click', verifier);
  verifier();
}
