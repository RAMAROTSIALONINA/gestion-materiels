// En-tête commun des pages connectées, fixé en haut de l'écran, en deux
// bandes : en haut le nom de l'application, la recherche par code (lecteur de
// code-barres) et le compte ; dessous le menu, classé en sous-menus selon les
// droits. Sur téléphone, tout se déplie avec le bouton « Menu ».
import { afficherMessage, api, creer } from './app.js';

// Entrées directes, puis sous-menus. Un sous-menu qui n'a qu'un lien visible
// pour ce compte s'affiche comme un lien simple.
const MENU = [
  { adresse: '/', libelle: 'Accueil', saufRole: 'EMPLOYE' },
  { adresse: '/alertes', libelle: 'Alertes', droit: 'alertes.lire', pastille: true },
  {
    groupe: 'Parc et stocks',
    liens: [
      { adresse: '/materiels', libelle: 'Matériels', droit: 'materiels.lire' },
      { adresse: '/historique', libelle: 'Historique des états', droit: 'materiels.lire' },
      { adresse: '/articles', libelle: 'Articles', droit: 'articles.lire' },
      { adresse: '/mes-materiels', libelle: 'Mes matériels', droit: 'mes_materiels.lire', employe: true },
    ],
  },
  {
    groupe: 'Opérations',
    liens: [
      { adresse: '/mouvements', libelle: 'Mouvements', droit: 'mouvements.lire' },
      { adresse: '/receptions', libelle: 'Réceptions', droit: 'transferts.receptionner' },
      { adresse: '/affectations', libelle: 'Affectations', droit: 'affectations.lire' },
      { adresse: '/signalements', libelle: 'Signalements', droit: 'signalements.traiter' },
    ],
  },
  {
    groupe: 'Paramètres',
    liens: [
      { adresse: '/employes', libelle: 'Employés', droit: 'employes.gerer' },
      { adresse: '/administration', libelle: 'Sites, services et catégories', droit: 'referentiels.gerer' },
      { adresse: '/administration#parametres', libelle: 'Réglages de l’application', droit: 'parametres.gerer' },
      { adresse: '/utilisateurs', libelle: 'Utilisateurs', droit: 'utilisateurs.gerer' },
      { adresse: '/journal', libelle: 'Journal des opérations', droit: 'journal.lire' },
    ],
  },
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

// Page courante ; « /administration#parametres » se distingue de « /administration ».
function estCourante(adresse) {
  const { pathname, hash } = window.location;
  if (adresse.includes('#')) return `${pathname}${hash}` === adresse;
  if (adresse === '/') return pathname === '/';
  if (adresse === '/administration' && hash === '#parametres') return false;
  return pathname === adresse || pathname.startsWith(`${adresse}/`);
}

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

function lienMenu(lien) {
  const element = creer('a', { href: lien.adresse, textContent: lien.libelle });
  if (lien.pastille) element.append(creer('span', { className: 'pastille-menu', id: 'pastille-alertes', hidden: true }));
  if (estCourante(lien.adresse)) element.setAttribute('aria-current', 'page');
  return element;
}

// Ferme tous les sous-menus ouverts (sauf celui qu'on garde).
function fermerSousMenus(garde = null) {
  for (const groupe of document.querySelectorAll('.groupe-menu.ouvert')) {
    if (groupe === garde) continue;
    groupe.classList.remove('ouvert');
    groupe.querySelector('.titre-groupe').setAttribute('aria-expanded', 'false');
  }
}

function sousMenu(titre, liens, rang) {
  const panneau = creer('div', { className: 'sous-menu', id: `sous-menu-${rang}` }, ...liens.map(lienMenu));
  const bouton = creer('button', { type: 'button', className: 'titre-groupe', textContent: titre });
  bouton.setAttribute('aria-expanded', 'false');
  bouton.setAttribute('aria-controls', panneau.id);
  const groupe = creer('div', { className: 'groupe-menu' }, bouton, panneau);
  if (liens.some((lien) => estCourante(lien.adresse))) groupe.classList.add('contient-courante');
  bouton.addEventListener('click', () => {
    fermerSousMenus(groupe);
    const ouvert = groupe.classList.toggle('ouvert');
    bouton.setAttribute('aria-expanded', String(ouvert));
    if (ouvert) panneau.querySelector('a')?.focus();
  });
  return groupe;
}

// Menu ; null s'il n'y a rien à montrer (mot de passe à changer).
function creerMenu(utilisateur) {
  if (utilisateur.doit_changer_mot_de_passe) return null;
  // « Mes matériels » : compte rattaché à une fiche employé (toujours pour le rôle Employé,
  // dont c'est la seule page) ; « Accueil » : pas pour l'employé, renvoyé vers ses matériels.
  const visible = (entree) => (!entree.droit || utilisateur.droits.includes(entree.droit))
    && (!entree.employe || utilisateur.employe_id || utilisateur.role === 'EMPLOYE')
    && entree.saufRole !== utilisateur.role;
  const elements = [];
  MENU.forEach((entree, rang) => {
    if (!entree.groupe) {
      if (visible(entree)) elements.push(lienMenu(entree));
      return;
    }
    const liens = entree.liens.filter(visible);
    if (liens.length === 1) elements.push(lienMenu(liens[0]));
    else if (liens.length > 1) elements.push(sousMenu(entree.groupe, liens, rang));
  });
  if (elements.length === 0) return null;
  const menu = creer('nav', { className: 'navigation', id: 'menu-principal' }, ...elements);
  menu.setAttribute('aria-label', 'Menu principal');
  return menu;
}

// Un clic ailleurs ou la touche Échap referment les sous-menus.
document.addEventListener('click', (evenement) => {
  if (!evenement.target.closest?.('.groupe-menu')) fermerSousMenus();
});
document.addEventListener('keydown', (evenement) => {
  if (evenement.key !== 'Escape') return;
  const ouvert = document.querySelector('.groupe-menu.ouvert');
  if (!ouvert) return;
  fermerSousMenus();
  ouvert.querySelector('.titre-groupe').focus();
});

// Hauteur de l'en-tête fixé : les messages et les ancres se placent dessous.
function suivreHauteur(entete) {
  const poser = () => document.documentElement.style.setProperty('--hauteur-entete', `${entete.offsetHeight}px`);
  poser();
  if ('ResizeObserver' in window) new ResizeObserver(poser).observe(entete);
}

export async function initialiserEntete() {
  const { utilisateur } = await api('/auth/moi');
  const entete = document.getElementById('entete');
  const menu = creerMenu(utilisateur);
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
    creer('div', { className: 'compte-identite' },
      creer('span', { className: 'compte-nom', textContent: utilisateur.nom }),
      creer('span', { className: 'compte-role', textContent: utilisateur.role_libelle })),
    creer('div', { className: 'compte-liens' },
      creer('a', { href: '/mot-de-passe', textContent: 'Mon mot de passe' }),
      deconnexion));

  // Bande du haut : nom de l'application, recherche, compte (et bouton « Menu » sur téléphone).
  const haut = creer('div', { className: 'entete-haut' });
  const marque = entete.querySelector('.marque');
  if (marque) haut.append(marque);
  if (menu) {
    const ouvrir = creer('button', { type: 'button', className: 'bouton-menu', textContent: 'Menu' });
    ouvrir.setAttribute('aria-controls', menu.id);
    ouvrir.setAttribute('aria-expanded', 'false');
    ouvrir.addEventListener('click', () => {
      const ouvert = entete.classList.toggle('menu-ouvert');
      ouvrir.setAttribute('aria-expanded', String(ouvert));
    });
    haut.append(ouvrir);
  }
  if (!utilisateur.doit_changer_mot_de_passe && utilisateur.droits.includes('materiels.lire')) haut.append(champRecherche());
  haut.append(compte);
  entete.replaceChildren(...[haut, menu].filter(Boolean));
  // Sur téléphone, la recherche et le compte rejoignent le menu replié (s'il existe).
  entete.classList.toggle('avec-menu', Boolean(menu));
  suivreHauteur(entete);
  // L'écran Alertes met lui-même la pastille à jour après son chargement.
  if (document.getElementById('pastille-alertes') && window.location.pathname !== '/alertes') rafraichirAlertes();
  return utilisateur;
}

export const aLeDroit = (utilisateur, droit) => utilisateur.droits.includes(droit);
