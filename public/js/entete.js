// En-tête commun des pages connectées : menu selon les droits, recherche par
// code (lecteur de code-barres), compte, déconnexion.
import { afficherMessage, api, creer } from './app.js';

const MENU = [
  { adresse: '/', libelle: 'Accueil', saufRole: 'EMPLOYE' },
  { adresse: '/alertes', libelle: 'Alertes', droit: 'alertes.lire', pastille: true },
  { adresse: '/materiels', libelle: 'Matériels', droit: 'materiels.lire' },
  { adresse: '/articles', libelle: 'Articles', droit: 'articles.lire' },
  { adresse: '/mouvements', libelle: 'Mouvements', droit: 'mouvements.lire' },
  { adresse: '/receptions', libelle: 'Réceptions', droit: 'transferts.receptionner' },
  { adresse: '/affectations', libelle: 'Affectations', droit: 'affectations.lire' },
  { adresse: '/mes-materiels', libelle: 'Mes matériels', droit: 'mes_materiels.lire', employe: true },
  { adresse: '/signalements', libelle: 'Signalements', droit: 'signalements.traiter' },
  { adresse: '/employes', libelle: 'Employés', droit: 'employes.gerer' },
  { adresse: '/administration', libelle: 'Administration', droit: 'referentiels.gerer' },
  { adresse: '/utilisateurs', libelle: 'Utilisateurs', droit: 'utilisateurs.gerer' },
  { adresse: '/journal', libelle: 'Journal', droit: 'journal.lire' },
];

// Nombre d'alertes à traiter, affiché dans le menu. Gardé deux minutes dans
// l'onglet (par utilisateur) pour ne pas interroger le serveur à chaque page.
const CLE_ALERTES = 'gm.alertes';
const DUREE_ALERTES = 2 * 60 * 1000;
let utilisateurCourant = null;

function pastilleAlertes(total) {
  const pastille = document.getElementById('pastille-alertes');
  if (!pastille) return;
  pastille.hidden = !total;
  pastille.textContent = String(total);
  pastille.closest('a').setAttribute('aria-label', total ? `Alertes : ${total} à traiter` : 'Alertes');
}

export function memoriserAlertes(total) {
  try {
    sessionStorage.setItem(CLE_ALERTES, JSON.stringify({ total, temps: Date.now(), utilisateur: utilisateurCourant?.id }));
  } catch { /* stockage indisponible : on affiche quand même */ }
  pastilleAlertes(total);
}

function rafraichirAlertes() {
  try {
    const memoire = JSON.parse(sessionStorage.getItem(CLE_ALERTES));
    if (memoire && memoire.utilisateur === utilisateurCourant.id && Date.now() - memoire.temps < DUREE_ALERTES) {
      pastilleAlertes(memoire.total);
      return;
    }
  } catch { /* rien en mémoire */ }
  api('/alertes?resume=oui').then(({ total }) => memoriserAlertes(total)).catch(() => {});
}

// Un employé sans autre droit arrive directement sur ses matériels.
export const pageAccueil = (utilisateur) => (utilisateur.role === 'EMPLOYE' ? '/mes-materiels' : '/');

const estCourante = (adresse) => (adresse === '/'
  ? window.location.pathname === '/'
  : window.location.pathname === adresse || window.location.pathname.startsWith(`${adresse}/`));

// Un lecteur de code-barres « tape » le code puis Entrée : on ouvre la fiche.
function champRecherche() {
  const formulaire = creer('form', { className: 'recherche-code', role: 'search' });
  const saisie = creer('input', {
    type: 'search', name: 'code', placeholder: 'Scanner ou chercher un code', autocomplete: 'off', maxLength: 100,
  });
  saisie.setAttribute('aria-label', 'Scanner ou chercher un code de matériel');
  formulaire.append(saisie);
  formulaire.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const code = saisie.value.trim();
    if (!code) return;
    try {
      const { materiel } = await api(`/materiels/par-code?code=${encodeURIComponent(code)}`);
      window.location.assign(`/materiels/${materiel.id}`);
    } catch (erreur) {
      if (erreur.statut === 404) window.location.assign(`/materiels?q=${encodeURIComponent(code)}`);
      else afficherMessage(erreur.message);
    }
  });
  return formulaire;
}

export async function initialiserEntete() {
  const { utilisateur } = await api('/auth/moi');
  const entete = document.getElementById('entete');

  const menu = creer('nav', { className: 'navigation' });
  menu.setAttribute('aria-label', 'Menu principal');
  if (!utilisateur.doit_changer_mot_de_passe) {
    // « Mes matériels » : compte rattaché à une fiche employé (toujours pour le rôle Employé,
    // dont c'est la seule page) ; « Accueil » : pas pour l'employé, renvoyé vers ses matériels.
    const visible = (entree) => (!entree.droit || utilisateur.droits.includes(entree.droit))
      && (!entree.employe || utilisateur.employe_id || utilisateur.role === 'EMPLOYE')
      && entree.saufRole !== utilisateur.role;
    for (const lien of MENU.filter(visible)) {
      const element = creer('a', { href: lien.adresse, textContent: lien.libelle });
      if (lien.pastille) element.append(creer('span', { className: 'pastille-menu', id: 'pastille-alertes', hidden: true }));
      if (estCourante(lien.adresse)) element.setAttribute('aria-current', 'page');
      menu.append(element);
    }
  }
  utilisateurCourant = utilisateur;

  const deconnexion = creer('button', { type: 'button', className: 'lien-bouton', textContent: 'Se déconnecter' });
  deconnexion.addEventListener('click', async () => {
    try {
      await api('/auth/deconnexion', { methode: 'POST' });
      window.location.assign('/connexion');
    } catch (erreur) {
      afficherMessage(erreur.message);
    }
  });

  const compte = creer('div', { className: 'compte' },
    creer('span', { className: 'compte-nom', textContent: utilisateur.nom }),
    creer('span', { className: 'compte-role', textContent: utilisateur.role_libelle }),
    creer('a', { href: '/mot-de-passe', textContent: 'Mon mot de passe' }),
    deconnexion);

  entete.append(menu);
  if (!utilisateur.doit_changer_mot_de_passe && utilisateur.droits.includes('materiels.lire')) entete.append(champRecherche());
  entete.append(compte);
  // L'écran Alertes met lui-même la pastille à jour après son chargement.
  if (document.getElementById('pastille-alertes') && window.location.pathname !== '/alertes') rafraichirAlertes();
  return utilisateur;
}

export const aLeDroit = (utilisateur, droit) => utilisateur.droits.includes(droit);
