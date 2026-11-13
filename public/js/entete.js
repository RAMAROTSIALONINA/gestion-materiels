// Cadre commun des pages connectées :
// - à gauche, une barre latérale sombre : le menu par rubriques, avec une icône
//   par lien, puis le compte et la déconnexion ;
// - en haut, une barre fixée : message d'accueil, recherche par code (lecteur de
//   code-barres), cloche des alertes et menu du compte.
// Sur tablette et téléphone, la barre latérale se replie et s'ouvre avec le
// bouton « Menu » ; sur téléphone, la recherche passe dans la barre latérale.
import { afficherMessage, api, creer } from './app.js';
import { icone } from './icones.js';

// Menu de la barre latérale, par rubriques. « Paramètres » est ajouté à la fin
// s'il y a au moins une carte à montrer sur la page Paramètres.
const MENU = [
  {
    liens: [
      { adresse: '/', libelle: 'Tableau de bord', icone: 'accueil', saufRole: 'EMPLOYE' },
      { adresse: '/alertes', libelle: 'Alertes', icone: 'alertes', droit: 'alertes.lire', pastille: true },
    ],
  },
  {
    titre: 'Parc et stocks',
    liens: [
      // Décision du 12/11 : un seul écran, une liste déroulante choisit Matériels ou Articles.
      { adresse: '/materiels', libelle: 'Matériels et articles', icone: 'materiels', droit: 'materiels.lire', actifSur: ['/materiels', '/articles'] },
      { adresse: '/mes-materiels', libelle: 'Mes matériels', icone: 'mes-materiels', droit: 'mes_materiels.lire', employe: true },
    ],
  },
  {
    titre: 'Opérations',
    liens: [
      { adresse: '/mouvements', libelle: 'Mouvements', icone: 'mouvements', droit: 'mouvements.lire' },
      { adresse: '/affectations', libelle: 'Remises et retours', icone: 'affectations', droit: 'affectations.lire' },
      { adresse: '/signalements', libelle: 'Signalements', icone: 'signalements', droit: 'signalements.traiter' },
    ],
  },
];

// Cartes de la page Paramètres, dans l'ordre d'affichage. Chacune suit le droit
// de l'écran qu'elle ouvre.
// Rapports et Historique des états y sont rangés depuis le 12/11.
const RUBRIQUES_PARAMETRES = [
  {
    adresse: '/rapports', titre: 'Rapports', icone: 'rapports', teinte: 'bleu', droit: 'rapports.lire',
    texte: 'État du parc, mouvements, remises, retours, stock, anomalies : à l’écran, en CSV ou en PDF.',
  },
  {
    adresse: '/historique', titre: 'Historique des états', icone: 'historique', teinte: 'indigo', droit: 'materiels.lire',
    texte: 'Chaque changement d’état ou de statut des matériels, daté et signé.',
  },
  {
    adresse: '/utilisateurs', titre: 'Utilisateurs et accès', icone: 'utilisateurs', teinte: 'violet', droit: 'utilisateurs.gerer',
    texte: 'Comptes, rôles, mots de passe, suspensions et déblocages.',
  },
  {
    adresse: '/employes', titre: 'Employés', icone: 'employes', teinte: 'bleu', droit: 'employes.gerer',
    texte: 'Fiches des personnes à qui l’on remet du matériel.',
  },
  {
    adresse: '/administration#sites', titre: 'Sites et services', icone: 'sites', teinte: 'indigo', droit: 'referentiels.gerer',
    texte: 'Lieux de la société et services rattachés à chaque site.',
  },
  {
    adresse: '/administration#categories', titre: 'Catégories et unités', icone: 'categories', teinte: 'jaune', droit: 'referentiels.gerer',
    texte: 'Classement des matériels et des articles, unités de mesure.',
  },
  {
    adresse: '/administration#parametres', titre: 'Réglages de l’application', icone: 'reglages', teinte: 'vert', droit: 'parametres.gerer',
    texte: 'Nom de la société, signalements des employés, délais d’alerte, blocage des connexions.',
  },
  {
    adresse: '/journal', titre: 'Journal des opérations', icone: 'journal', teinte: 'gris', droit: 'journal.lire',
    texte: 'Qui a fait quoi, quand, et depuis quel poste.',
  },
  // « Mon mot de passe » n'est plus une carte (13/11) : il reste dans le menu du
  // compte (en haut à droite) et sous le nom, en bas de la barre latérale.
];
// Écrans rangés sous « Paramètres » : le lien reste en surbrillance, et un
// lien de retour vers la page Paramètres s'affiche au-dessus du titre.
const PAGES_PARAMETRES = ['/parametres', '/rapports', '/historique', '/utilisateurs', '/employes', '/administration', '/journal'];

export const aLeDroit = (utilisateur, droit) => utilisateur.droits.includes(droit);

// Cartes visibles pour ce compte.
export const rubriquesParametres = (utilisateur) => RUBRIQUES_PARAMETRES
  .filter((rubrique) => !rubrique.droit || aLeDroit(utilisateur, rubrique.droit));
// « Paramètres » apparaît dans le menu dès qu'une carte est permise.
const voitParametres = (utilisateur) => rubriquesParametres(utilisateur).length > 0;

// Nombre d'alertes à traiter, affiché sur la cloche et dans le menu. Gardé deux
// minutes dans l'onglet (par utilisateur) pour ne pas interroger le serveur à chaque page.
const CLE_ALERTES = 'gm.alertes';
const DUREE_ALERTES = 2 * 60 * 1000;
let utilisateurCourant = null;

function pastilleAlertes(total) {
  for (const pastille of document.querySelectorAll('.pastille-alertes')) {
    pastille.hidden = !total;
    pastille.textContent = total > 99 ? '99+' : String(total);
  }
  for (const lien of document.querySelectorAll('[data-alertes]')) {
    lien.setAttribute('aria-label', total ? `Alertes : ${total} à traiter` : 'Alertes');
  }
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

function estCourante(adresse) {
  const { pathname } = window.location;
  if (adresse === '/') return pathname === '/';
  if (adresse === '/parametres') return PAGES_PARAMETRES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
  return pathname === adresse || pathname.startsWith(`${adresse}/`);
}

// Initiales du compte, pour la pastille ronde (« Tinasoa RAMA » → « TR »).
const initiales = (nom) => nom.split(/\s+/).filter(Boolean).slice(0, 2).map((mot) => mot[0]).join('').toUpperCase() || '?';

// Un lecteur de code-barres « tape » le code puis Entrée : on ouvre la fiche.
function champRecherche() {
  const formulaire = creer('form', { className: 'recherche-code', role: 'search' });
  const saisie = creer('input', {
    type: 'search', name: 'code', placeholder: 'Scanner ou chercher un code', autocomplete: 'off', maxLength: 100,
  });
  saisie.setAttribute('aria-label', 'Scanner ou chercher un code de matériel');
  formulaire.append(icone('recherche', 'icone recherche-icone'), saisie);
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

async function seDeconnecter() {
  try {
    await api('/auth/deconnexion', { methode: 'POST' });
    window.location.assign('/connexion');
  } catch (erreur) {
    afficherMessage(erreur.message);
  }
}

function lienMenu(lien) {
  const element = creer('a', { href: lien.adresse },
    icone(lien.icone), creer('span', { className: 'lien-texte', textContent: lien.libelle }));
  if (lien.pastille) {
    element.dataset.alertes = '';
    element.append(creer('span', { className: 'pastille-menu pastille-alertes', hidden: true }));
  }
  const courant = lien.actifSur ? lien.actifSur.some(estCourante) : estCourante(lien.adresse);
  if (courant) element.setAttribute('aria-current', 'page');
  return element;
}

// « Matériels et articles » (12/11) : la liste déroulante [data-vue] de ces deux
// écrans passe de l'un à l'autre.
function brancherChoixVue() {
  const choix = document.querySelector('select[data-vue]');
  if (!choix) return;
  choix.value = window.location.pathname;
  choix.addEventListener('change', () => window.location.assign(choix.value));
}

// Menu de la barre latérale ; null s'il n'y a rien à montrer (mot de passe à changer).
function creerMenu(utilisateur) {
  if (utilisateur.doit_changer_mot_de_passe) return null;
  // « Mes matériels » : compte rattaché à une fiche employé (toujours pour le rôle Employé,
  // dont c'est la seule page) ; « Accueil » : pas pour l'employé, renvoyé vers ses matériels.
  const visible = (lien) => (!lien.droit || aLeDroit(utilisateur, lien.droit))
    && (!lien.employe || utilisateur.employe_id || utilisateur.role === 'EMPLOYE')
    && lien.saufRole !== utilisateur.role;
  const rubriques = MENU.map((rubrique) => ({ ...rubrique, liens: rubrique.liens.filter(visible) }));
  if (voitParametres(utilisateur)) {
    rubriques.push({ liens: [{ adresse: '/parametres', libelle: 'Paramètres', icone: 'parametres' }] });
  }
  // Une seule rubrique (l'employé et « Mes matériels ») : pas d'intertitre.
  const remplies = rubriques.filter((rubrique) => rubrique.liens.length > 0);
  const sections = remplies.map((rubrique) => creer('div', { className: 'section-menu' },
    remplies.length > 1 && rubrique.titre && creer('p', { className: 'titre-section', textContent: rubrique.titre }),
    ...rubrique.liens.map(lienMenu)));
  if (sections.length === 0) return null;
  const menu = creer('nav', { className: 'navigation', id: 'menu-principal' }, ...sections);
  menu.setAttribute('aria-label', 'Menu principal');
  return menu;
}

function barreLaterale(utilisateur, menu) {
  const fermer = creer('button', { type: 'button', className: 'bouton-icone fermer-barre' }, icone('fermer'));
  fermer.setAttribute('aria-label', 'Fermer le menu');
  fermer.addEventListener('click', () => basculerBarre(false));

  const deconnexion = creer('button', { type: 'button', className: 'lien-deconnexion' },
    icone('deconnexion'), creer('span', { textContent: 'Déconnexion' }));
  deconnexion.addEventListener('click', seDeconnecter);

  const aside = creer('aside', { className: 'barre-laterale', id: 'barre-laterale' },
    creer('div', { className: 'barre-marque' },
      creer('a', { className: 'marque', href: pageAccueil(utilisateur) },
        creer('img', { src: '/favicon.svg', alt: '', width: 32, height: 32 }),
        creer('span', { textContent: 'Gestion des matériels' })),
      fermer),
    aLeDroit(utilisateur, 'materiels.lire') && champRecherche(),
    menu,
    creer('div', { className: 'barre-pied' },
      creer('a', { className: 'barre-compte', href: '/mot-de-passe', title: 'Mon mot de passe' },
        creer('span', { className: 'avatar avatar-petit', textContent: initiales(utilisateur.nom) }),
        creer('span', { className: 'barre-compte-texte' },
          creer('span', { className: 'barre-compte-nom', textContent: utilisateur.nom }),
          creer('span', { className: 'barre-compte-role', textContent: utilisateur.role_libelle }))),
      deconnexion));
  aside.setAttribute('aria-label', 'Navigation');
  return aside;
}

// Ouvre ou ferme la barre latérale repliée (tablette et téléphone).
function basculerBarre(ouvrir) {
  document.body.classList.toggle('barre-ouverte', ouvrir);
  document.querySelector('.bouton-menu')?.setAttribute('aria-expanded', String(ouvrir));
  if (ouvrir) document.querySelector('#barre-laterale .fermer-barre')?.focus();
}

// Menu déroulant du compte (pastille ronde en haut à droite).
function menuCompte(utilisateur) {
  const bouton = creer('button', { type: 'button', className: 'bouton-compte' },
    creer('span', { className: 'avatar', textContent: initiales(utilisateur.nom) }), icone('chevron', 'icone chevron'));
  bouton.setAttribute('aria-label', `Compte de ${utilisateur.nom}`);
  bouton.setAttribute('aria-expanded', 'false');
  bouton.setAttribute('aria-controls', 'menu-compte');

  const deconnexion = creer('button', { type: 'button' }, icone('deconnexion'), creer('span', { textContent: 'Se déconnecter' }));
  deconnexion.addEventListener('click', seDeconnecter);
  const panneau = creer('div', { className: 'menu-compte', id: 'menu-compte', hidden: true },
    creer('div', { className: 'menu-compte-identite' },
      creer('strong', { textContent: utilisateur.nom }),
      creer('span', { textContent: utilisateur.role_libelle }),
      utilisateur.email && creer('span', { className: 'menu-compte-email', textContent: utilisateur.email })),
    creer('a', { href: '/mot-de-passe' }, icone('mot-de-passe'), creer('span', { textContent: 'Mon mot de passe' })),
    !utilisateur.doit_changer_mot_de_passe && voitParametres(utilisateur)
      && creer('a', { href: '/parametres' }, icone('parametres'), creer('span', { textContent: 'Paramètres' })),
    deconnexion);

  const conteneur = creer('div', { className: 'compte' }, bouton, panneau);
  bouton.addEventListener('click', () => {
    panneau.hidden = !panneau.hidden;
    bouton.setAttribute('aria-expanded', String(!panneau.hidden));
  });
  return conteneur;
}

function fermerMenuCompte() {
  const panneau = document.getElementById('menu-compte');
  if (!panneau || panneau.hidden) return false;
  panneau.hidden = true;
  document.querySelector('.bouton-compte')?.setAttribute('aria-expanded', 'false');
  return true;
}

// Un clic ailleurs ferme le menu du compte ; le choix d'un lien referme la barre
// latérale dépliée. Échap ferme l'un ou l'autre.
document.addEventListener('click', (evenement) => {
  const cible = evenement.target;
  if (!cible.closest?.('.compte')) fermerMenuCompte();
  if (cible.closest?.('.barre-laterale a') || cible.closest?.('.voile')) basculerBarre(false);
});
document.addEventListener('keydown', (evenement) => {
  if (evenement.key !== 'Escape') return;
  if (fermerMenuCompte()) {
    document.querySelector('.bouton-compte')?.focus();
    return;
  }
  if (document.body.classList.contains('barre-ouverte')) {
    basculerBarre(false);
    document.querySelector('.bouton-menu')?.focus();
  }
});

// Hauteur de la barre du haut : les messages et les ancres se placent dessous.
function suivreHauteur(entete) {
  const poser = () => document.documentElement.style.setProperty('--hauteur-entete', `${entete.offsetHeight}px`);
  poser();
  if ('ResizeObserver' in window) new ResizeObserver(poser).observe(entete);
}

// Écrans rangés sous « Paramètres » : lien de retour au-dessus du titre.
function lienRetourParametres(utilisateur) {
  const { pathname } = window.location;
  if (pathname === '/parametres' || !estCourante('/parametres') || !voitParametres(utilisateur)) return;
  const titre = document.querySelector('main h1');
  // Un titre accompagné de boutons (barre de titre) : le lien va au-dessus de toute la barre.
  const cible = titre?.closest('.barre-titre') ?? titre;
  if (!cible || cible.previousElementSibling?.classList.contains('fil')) return;
  cible.before(creer('p', { className: 'fil' }, creer('a', { href: '/parametres', textContent: '‹ Paramètres' })));
}

export async function initialiserEntete() {
  const { utilisateur } = await api('/auth/moi');
  const entete = document.getElementById('entete');
  const menu = creerMenu(utilisateur);
  utilisateurCourant = utilisateur;
  const recherche = !utilisateur.doit_changer_mot_de_passe && aLeDroit(utilisateur, 'materiels.lire');

  // Barre du haut : [Menu] [nom de l'application] [accueil] … [recherche] [cloche] [compte].
  const gauche = creer('div', { className: 'entete-gauche' });
  if (menu) {
    const ouvrir = creer('button', { type: 'button', className: 'bouton-icone bouton-menu' }, icone('menu'));
    ouvrir.setAttribute('aria-label', 'Menu');
    ouvrir.setAttribute('aria-controls', 'barre-laterale');
    ouvrir.setAttribute('aria-expanded', 'false');
    ouvrir.addEventListener('click', () => basculerBarre(!document.body.classList.contains('barre-ouverte')));
    gauche.append(ouvrir);
  }
  const marque = entete.querySelector('.marque') ?? creer('a', { className: 'marque', textContent: 'Gestion des matériels' });
  marque.href = pageAccueil(utilisateur);
  gauche.append(marque);

  const droite = creer('div', { className: 'entete-droite' });
  if (recherche) droite.append(champRecherche());
  if (!utilisateur.doit_changer_mot_de_passe && aLeDroit(utilisateur, 'alertes.lire')) {
    const cloche = creer('a', { className: 'bouton-icone cloche', href: '/alertes', title: 'Alertes' },
      icone('alertes'), creer('span', { className: 'pastille-cloche pastille-alertes', hidden: true }));
    cloche.dataset.alertes = '';
    cloche.setAttribute('aria-label', 'Alertes');
    if (window.location.pathname === '/alertes') cloche.setAttribute('aria-current', 'page');
    droite.append(cloche);
  }
  droite.append(menuCompte(utilisateur));

  entete.replaceChildren(gauche,
    creer('p', { className: 'bienvenue', textContent: `Bienvenue dans l’espace ${utilisateur.role_libelle}` }),
    droite);
  entete.classList.toggle('sans-recherche', !recherche);

  if (menu) {
    document.body.classList.add('avec-barre');
    document.body.prepend(barreLaterale(utilisateur, menu), creer('div', { className: 'voile' }));
  }
  suivreHauteur(entete);
  lienRetourParametres(utilisateur);
  brancherChoixVue();
  // L'écran Alertes met lui-même la pastille à jour après son chargement.
  if (document.querySelector('.pastille-alertes') && window.location.pathname !== '/alertes') rafraichirAlertes();
  return utilisateur;
}
