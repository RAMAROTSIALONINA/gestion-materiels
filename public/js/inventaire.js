// Écran Inventaire : synthèse automatique du parc et des stocks, puis la liste
// des matériels (comptés à l'unité) ou des articles (quantités tenues par les
// mouvements validés, par site ou tous sites). Aucune saisie : les cartes et
// les listes ne font que lire les vues de la base.
import {
  LIBELLES_ETAT, LIBELLES_STATUT, afficherMessage, afficherPagination, api, badge, badgeEtat, badgeStatut, creer,
  differer, ecrireFiltresAdresse, formaterDateCourte, formaterNombre, ligneVide, lireFiltresAdresse,
} from './app.js';
import { aLeDroit, initialiserEntete } from './entete.js';
import { icone } from './icones.js';

const utilisateur = await initialiserEntete();
const element = (id) => document.getElementById(id);
const filtres = element('filtres');
const initiaux = lireFiltresAdresse();
const peutArticles = aLeDroit(utilisateur, 'articles.lire');
const responsable = utilisateur.role === 'RESPONSABLE_SERVICE';
let vue = initiaux.vue === 'articles' && peutArticles ? 'articles' : 'materiels';
let page = Number(initiaux.page) || 1;
let sites = [];
let categories = [];

const nombre = (valeur) => new Intl.NumberFormat('fr-FR').format(valeur ?? 0);
const pluriel = (valeur, mot, motPluriel = `${mot}s`) => `${nombre(valeur)} ${valeur > 1 ? motPluriel : mot}`;

if (responsable) {
  element('champ-site').hidden = true;
  element('presentation').textContent = 'Inventaire automatique de votre service : ses matériels, et les articles suivis '
    + 'sur le site auquel il est rattaché. Les quantités viennent des fiches et des mouvements validés ; rien à saisir ici.';
}
if (!peutArticles) element('onglet-articles').hidden = true;
if (aLeDroit(utilisateur, 'rapports.lire')) element('lien-rapports').hidden = false;

for (const [valeur, libelle] of Object.entries(LIBELLES_STATUT)) {
  filtres.elements.statut.append(creer('option', { value: valeur, textContent: libelle }));
}
for (const [valeur, libelle] of Object.entries(LIBELLES_ETAT)) {
  filtres.elements.etat.append(creer('option', { value: valeur, textContent: libelle }));
}

async function chargerReferentiels() {
  [sites, categories] = await Promise.all([
    api('/referentiels/sites').then((r) => r.sites),
    api('/referentiels/categories').then((r) => r.categories),
  ]);
  for (const site of sites) {
    filtres.elements.site_id.append(creer('option', { value: String(site.id), textContent: site.nom }));
  }
}

// Les catégories proposées suivent l'onglet : matériels ou articles.
function remplirCategories() {
  const type = vue === 'articles' ? 'ARTICLE' : 'MATERIEL';
  const select = filtres.elements.categorie_id;
  const valeur = select.value;
  select.replaceChildren(creer('option', { value: '', textContent: 'Toutes' }),
    ...categories.filter((c) => c.type === type && c.actif)
      .map((c) => creer('option', { value: String(c.id), textContent: c.nom })));
  select.value = [...select.options].some((option) => option.value === valeur) ? valeur : '';
}

function appliquerVue() {
  for (const onglet of element('onglets').querySelectorAll('[role="tab"]')) {
    onglet.setAttribute('aria-selected', String(onglet.dataset.vue === vue));
  }
  element('panneau-materiels').hidden = vue !== 'materiels';
  element('panneau-articles').hidden = vue !== 'articles';
  element('indicateurs-materiels').hidden = vue !== 'materiels';
  element('indicateurs-articles').hidden = vue !== 'articles';
  for (const bloc of filtres.querySelectorAll('[data-vue]')) bloc.hidden = bloc.dataset.vue !== vue;
  element('titre-synthese').textContent = vue === 'materiels'
    ? (responsable ? 'Synthèse du parc de votre service' : 'Synthèse du parc')
    : (responsable ? 'Synthèse des stocks de votre site' : 'Synthèse des stocks');
  remplirCategories();
}

function appliquerFiltresInitiaux() {
  for (const nom of ['q', 'site_id']) filtres.elements[nom].value = initiaux[nom] ?? '';
  filtres.elements.categorie_id.value = initiaux.categorie_id ?? '';
  if (vue === 'materiels') {
    filtres.elements.statut.value = initiaux.statut ?? '';
    filtres.elements.etat.value = initiaux.etat ?? '';
  } else {
    filtres.elements.alerte.checked = initiaux.alerte === 'oui';
    filtres.elements.rupture.checked = initiaux.rupture === 'oui';
  }
}

function valeursFiltres() {
  const valeur = (nom) => filtres.elements[nom].value.trim();
  return {
    q: valeur('q'),
    site_id: responsable ? '' : valeur('site_id'),
    categorie_id: valeur('categorie_id'),
    statut: vue === 'materiels' ? valeur('statut') : '',
    etat: vue === 'materiels' ? valeur('etat') : '',
    alerte: vue === 'articles' && filtres.elements.alerte.checked ? 'oui' : '',
    rupture: vue === 'articles' && filtres.elements.rupture.checked ? 'oui' : '',
  };
}

const parametres = (valeurs) => {
  const recherche = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(valeurs)) {
    if (valeur !== '' && valeur !== null && valeur !== undefined) recherche.set(cle, valeur);
  }
  return recherche;
};

// Lien vers l'inventaire avec des filtres (cartes de synthèse).
function lien(base, extra = {}) {
  const recherche = parametres({ ...base, ...extra });
  return `/inventaire${recherche.size ? `?${recherche}` : ''}`;
}

// Carte de synthèse : icône teintée, chiffre, libellé. Avec une adresse, elle
// ouvre la liste filtrée ; sinon elle reste une information.
function carte({ titre, valeur, nomIcone, teinte, adresse, detail }) {
  return creer(adresse ? 'a' : 'div', { className: `indicateur teinte-${teinte}`, ...(adresse ? { href: adresse } : {}) },
    creer('span', { className: 'indicateur-icone' }, icone(nomIcone)),
    creer('span', { className: 'indicateur-texte' },
      creer('span', { className: 'indicateur-valeur', textContent: nombre(valeur) }),
      creer('span', { className: 'indicateur-titre', textContent: titre }),
      detail && creer('span', { className: 'indicateur-detail', textContent: detail })));
}

function afficherSynthese(donnees, communs) {
  const m = donnees.materiels;
  const baseM = { vue: 'materiels', q: communs.q, site_id: communs.site_id, categorie_id: communs.categorie_id };
  element('indicateurs-materiels').replaceChildren(
    carte({
      titre: 'Matériels au parc', valeur: m.total, nomIcone: 'materiels', teinte: 'bleu', adresse: lien(baseM),
      detail: m.sortis ? `+ ${pluriel(m.sortis, 'sorti', 'sortis')} du parc` : null,
    }),
    carte({ titre: 'Disponibles', valeur: m.disponibles, nomIcone: 'disponible', teinte: 'vert', adresse: lien(baseM, { statut: 'DISPONIBLE' }) }),
    carte({ titre: 'Affectés', valeur: m.affectes, nomIcone: 'affectations', teinte: 'indigo', adresse: lien(baseM, { statut: 'AFFECTE' }) }),
    carte({
      titre: 'En réparation', valeur: m.en_reparation, nomIcone: 'reparation', teinte: 'jaune',
      adresse: lien(baseM, { statut: 'EN_REPARATION' }),
      detail: m.endommages ? `${pluriel(m.endommages, 'endommagé')} au total` : null,
    }),
    carte({ titre: 'En transit', valeur: m.en_transit, nomIcone: 'mouvements', teinte: 'indigo', adresse: lien(baseM, { statut: 'EN_TRANSIT' }) }),
    carte({ titre: 'Hors service', valeur: m.hors_service, nomIcone: 'hors-service', teinte: 'gris', adresse: lien(baseM, { etat: 'HORS_SERVICE' }) }),
    carte({ titre: 'Sortis du parc', valeur: m.sortis, nomIcone: 'sortie', teinte: 'gris', detail: 'perdus ou réformés' }),
    carte({
      titre: 'Retours en retard', valeur: m.retours_en_retard, nomIcone: 'retard',
      teinte: m.retours_en_retard ? 'rouge' : 'gris', adresse: '/materiels?retard=oui',
    }),
  );

  const a = donnees.articles;
  if (!a || !peutArticles) return;
  const baseA = { vue: 'articles', q: communs.q, site_id: communs.site_id, categorie_id: communs.categorie_id };
  element('indicateurs-articles').replaceChildren(
    carte({
      titre: a.par_site ? 'Articles suivis sur le site' : 'Articles suivis', valeur: a.total,
      nomIcone: 'articles', teinte: 'bleu', adresse: lien(baseA),
    }),
    carte({ titre: 'En stock', valeur: a.en_stock, nomIcone: 'disponible', teinte: 'vert', adresse: lien(baseA) }),
    carte({
      titre: 'Sous le seuil', valeur: a.sous_seuil, nomIcone: 'attention', teinte: a.sous_seuil ? 'orange' : 'gris',
      adresse: lien(baseA, { alerte: 'oui' }),
    }),
    carte({
      titre: 'En rupture', valeur: a.en_rupture, nomIcone: 'rupture', teinte: a.en_rupture ? 'rouge' : 'gris',
      adresse: lien(baseA, { rupture: 'oui' }),
    }),
  );
}

async function chargerSynthese(communs) {
  const reponse = await api(`/inventaire/resume?${parametres({
    q: communs.q, site_id: communs.site_id, categorie_id: communs.categorie_id,
  })}`);
  afficherSynthese(reponse, communs);
}

function ligneMateriel(materiel) {
  return creer('tr', {},
    creer('td', {}, creer('strong', {}, creer('a', { href: `/materiels/${materiel.id}`, textContent: materiel.code }))),
    creer('td', {},
      creer('div', { textContent: materiel.designation }),
      (materiel.marque || materiel.modele)
        && creer('div', { className: 'secondaire', textContent: [materiel.marque, materiel.modele].filter(Boolean).join(' ') })),
    creer('td', { textContent: materiel.categorie }),
    creer('td', {},
      creer('div', { textContent: materiel.site }),
      materiel.service && creer('div', { className: 'secondaire', textContent: materiel.service })),
    creer('td', {},
      materiel.responsable ?? '—',
      materiel.retour_en_retard
        && creer('div', {}, badge(`Retour prévu le ${formaterDateCourte(materiel.date_retour_prevue)}`, 'badge-danger'))),
    creer('td', {}, badgeEtat(materiel.etat)),
    creer('td', {}, badgeStatut(materiel.statut)));
}

async function chargerMateriels(communs) {
  const reponse = await api(`/materiels?${parametres({ ...communs, page: page > 1 ? page : '' })}`);
  element('lignes-materiels').replaceChildren(...(reponse.materiels.length
    ? reponse.materiels.map(ligneMateriel)
    : [ligneVide(7, 'Aucun matériel ne correspond.')]));
  afficherPagination(element('pagination-materiels'), reponse, (cible) => {
    page = cible;
    recharger().catch((erreur) => afficherMessage(erreur.message));
  });
}

const COLONNES_ARTICLES = (parSite) => (parSite
  ? [
    { libelle: 'Code' }, { libelle: 'Désignation' }, { libelle: 'Stock', nombre: true },
    { libelle: 'En route', nombre: true }, { libelle: 'Seuil du site', nombre: true }, { libelle: 'Alertes' },
  ]
  : [
    { libelle: 'Code' }, { libelle: 'Désignation' }, { libelle: 'Catégorie' }, { libelle: 'Stock', nombre: true },
    { libelle: 'En route', nombre: true }, { libelle: 'Seuil', nombre: true }, { libelle: 'Alertes' },
  ]);

function ligneArticle(article, parSite) {
  const quantite = (valeur) => `${formaterNombre(valeur, article.decimales)} ${article.symbole}`;
  const alerte = article.alerte;
  const cellules = [
    creer('td', {}, creer('strong', {}, creer('a', { href: `/articles/${article.id}`, textContent: article.code }))),
    creer('td', { textContent: article.designation }),
  ];
  if (!parSite) cellules.push(creer('td', { textContent: article.categorie }));
  cellules.push(
    creer('td', { className: 'nombre', textContent: quantite(article.quantite) }),
    creer('td', { className: 'nombre', textContent: article.quantite_en_route ? quantite(article.quantite_en_route) : '—' }),
    creer('td', { className: 'nombre', textContent: article.seuil > 0 ? quantite(article.seuil) : '—' }),
    creer('td', {}, creer('div', { className: 'badges' },
      article.en_rupture ? badge('Rupture', 'badge-danger') : null,
      !article.en_rupture && alerte ? badge('Sous le seuil', 'badge-attente') : null)),
  );
  return creer('tr', {}, ...cellules);
}

async function chargerArticles(communs) {
  const reponse = await api(`/inventaire/articles?${parametres({ ...communs, page: page > 1 ? page : '' })}`);
  const colonnes = COLONNES_ARTICLES(reponse.par_site);
  element('entetes-articles').replaceChildren(...colonnes.map((colonne) => creer('th', {
    scope: 'col', textContent: colonne.libelle, className: colonne.nombre ? 'nombre' : '',
  })));
  element('lignes-articles').replaceChildren(...(reponse.articles.length
    ? reponse.articles.map((article) => ligneArticle(article, reponse.par_site))
    : [ligneVide(colonnes.length, 'Aucun article ne correspond.')]));
  afficherPagination(element('pagination-articles'), reponse, (cible) => {
    page = cible;
    recharger().catch((erreur) => afficherMessage(erreur.message));
  });
}

async function recharger() {
  const communs = valeursFiltres();
  ecrireFiltresAdresse({ vue, ...communs, page: page > 1 ? page : '' });
  await Promise.all([
    chargerSynthese(communs),
    vue === 'materiels' ? chargerMateriels(communs) : chargerArticles(communs),
  ]);
}

function changerVue(nouvelleVue) {
  if (nouvelleVue === vue) return;
  vue = nouvelleVue;
  page = 1;
  // Les filtres propres à l'autre onglet ne s'appliquent pas ici.
  if (vue === 'materiels') {
    filtres.elements.alerte.checked = false;
    filtres.elements.rupture.checked = false;
  } else {
    filtres.elements.statut.value = '';
    filtres.elements.etat.value = '';
  }
  filtres.elements.categorie_id.value = '';
  appliquerVue();
  recharger().catch((erreur) => afficherMessage(erreur.message));
}

element('onglets').addEventListener('click', (evenement) => {
  const onglet = evenement.target.closest('[role="tab"]');
  if (onglet && !onglet.hidden) changerVue(onglet.dataset.vue);
});
filtres.addEventListener('submit', (evenement) => evenement.preventDefault());
const premierePage = () => {
  page = 1;
  recharger().catch((erreur) => afficherMessage(erreur.message));
};
filtres.elements.q.addEventListener('input', differer(premierePage));
for (const nom of ['site_id', 'categorie_id', 'statut', 'etat']) {
  filtres.elements[nom].addEventListener('change', premierePage);
}
// « Sous le seuil » et « En rupture » ne se cumulent pas : une rupture n'est
// pas une simple alerte.
for (const [nom, autre] of [['alerte', 'rupture'], ['rupture', 'alerte']]) {
  filtres.elements[nom].addEventListener('change', () => {
    if (filtres.elements[nom].checked) filtres.elements[autre].checked = false;
    premierePage();
  });
}

await chargerReferentiels().catch((erreur) => afficherMessage(erreur.message));
appliquerVue();
appliquerFiltresInitiaux();
recharger().catch((erreur) => afficherMessage(erreur.message));
