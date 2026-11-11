// Écran Articles : liste avec stock et alertes, recherche, filtres, création.
import {
  afficherMessage, afficherPagination, api, badge, creer, differer, ecrireFiltresAdresse, formaterNombre,
  ligneVide, lireFiltresAdresse, ouvrirFormulaire,
} from './app.js';
import { aLeDroit, initialiserEntete } from './entete.js';

const utilisateur = await initialiserEntete();
const gestion = aLeDroit(utilisateur, 'articles.gerer');
const filtres = document.getElementById('filtres');
const lignes = document.getElementById('lignes');
let page = 1;
let categories = [];
let unites = [];
let sites = [];

if (gestion) document.getElementById('nouveau').hidden = false;
const initiaux = lireFiltresAdresse();
page = Number(initiaux.page) || 1;

async function chargerReferentiels() {
  [categories, unites, sites] = await Promise.all([
    api('/referentiels/categories').then((r) => r.categories.filter((c) => c.type === 'ARTICLE')),
    api('/referentiels/unites').then((r) => r.unites),
    api('/referentiels/sites').then((r) => r.sites),
  ]);
  for (const categorie of categories) filtres.elements.categorie_id.append(creer('option', { value: String(categorie.id), textContent: categorie.nom }));
  filtres.elements.q.value = initiaux.q ?? '';
  filtres.elements.categorie_id.value = initiaux.categorie_id ?? '';
  filtres.elements.actif.value = initiaux.actif ?? '';
  filtres.elements.alerte.checked = initiaux.alerte === 'oui';
  filtres.elements.rupture.checked = initiaux.rupture === 'oui';
}

async function charger() {
  const parametres = ecrireFiltresAdresse({
    q: filtres.elements.q.value.trim(),
    categorie_id: filtres.elements.categorie_id.value,
    actif: filtres.elements.actif.value,
    alerte: filtres.elements.alerte.checked ? 'oui' : '',
    rupture: filtres.elements.rupture.checked ? 'oui' : '',
    page: page > 1 ? page : '',
  });
  const reponse = await api(`/articles?${parametres}`);
  lignes.replaceChildren(...(reponse.articles.length ? reponse.articles.map(ligne) : [ligneVide(8, 'Aucun article ne correspond.')]));
  afficherPagination(document.getElementById('pagination'), reponse, (cible) => {
    page = cible;
    charger().catch((erreur) => afficherMessage(erreur.message));
  });
}

function ligne(article) {
  const quantite = (valeur) => `${formaterNombre(valeur)} ${article.symbole}`;
  const alertes = creer('div', { className: 'badges' },
    article.en_rupture ? badge('Rupture', 'badge-danger') : null,
    !article.en_rupture && article.alerte_stock_faible ? badge('Stock faible', 'badge-attente') : null,
    article.alerte_site ? badge('Seuil d’un site', 'badge-attente') : null,
    !article.actif ? badge('Inactif', 'badge-neutre') : null);
  return creer('tr', {},
    creer('td', {}, creer('strong', {}, creer('a', { href: `/articles/${article.id}`, textContent: article.code }))),
    creer('td', { textContent: article.designation }),
    creer('td', { textContent: article.categorie }),
    creer('td', { className: 'nombre', textContent: quantite(article.quantite_disponible) }),
    creer('td', { className: 'nombre', textContent: article.quantite_en_route ? quantite(article.quantite_en_route) : '—' }),
    creer('td', { className: 'nombre', textContent: article.seuil_minimum > 0 ? quantite(article.seuil_minimum) : '—' }),
    creer('td', {}, alertes),
    creer('td', { textContent: [article.site_stockage, article.emplacement].filter(Boolean).join(' · ') || '—' }));
}

async function creerArticle() {
  if (categories.filter((c) => c.actif).length === 0) {
    afficherMessage('Créez d’abord une catégorie d’articles dans Administration.');
    return;
  }
  const resultat = await ouvrirFormulaire({
    titre: 'Nouvel article',
    libelle: 'Créer l’article',
    champs: [
      { nom: 'designation', libelle: 'Désignation', obligatoire: true, max: 150, aide: 'Unique. Exemple : Papier A4 80 g.' },
      { nom: 'code', libelle: 'Code', max: 40, majuscules: true, aide: 'Laissez vide : le code ART-AAAA-NNNN est attribué.' },
      { nom: 'categorie_id', libelle: 'Catégorie', type: 'liste', obligatoire: true, vide: 'Choisir', options: categories.filter((c) => c.actif).map((c) => ({ valeur: c.id, libelle: c.nom })) },
      {
        nom: 'unite_code', libelle: 'Unité', type: 'liste', obligatoire: true, vide: 'Choisir',
        options: unites.map((u) => ({ valeur: u.code, libelle: `${u.libelle} (${u.symbole})` })),
        aide: 'Elle ne pourra plus changer après le premier mouvement.',
      },
      {
        nom: 'seuil_minimum', libelle: 'Seuil minimum (tous sites)', type: 'nombre', obligatoire: true, max: 15,
        aide: 'Alerte quand le stock total descend à ce niveau. 0 = pas de seuil suivi.',
      },
      { nom: 'site_stockage_id', libelle: 'Magasin habituel', type: 'liste', vide: 'Aucun', options: sites.filter((s) => s.actif).map((s) => ({ valeur: s.id, libelle: s.nom })) },
      { nom: 'emplacement', libelle: 'Emplacement', max: 80, aide: 'Rayon, étagère…' },
      { nom: 'observations', libelle: 'Observations', type: 'zone', max: 1000 },
    ],
    envoyer: (valeurs) => api('/articles', { methode: 'POST', corps: valeurs }),
  });
  if (resultat?.article) window.location.assign(`/articles/${resultat.article.id}`);
}

const recharger = () => {
  page = 1;
  charger().catch((erreur) => afficherMessage(erreur.message));
};
filtres.addEventListener('submit', (evenement) => {
  evenement.preventDefault();
  recharger();
});
filtres.elements.q.addEventListener('input', differer(recharger));
for (const nom of ['categorie_id', 'actif', 'alerte', 'rupture']) filtres.elements[nom].addEventListener('change', recharger);
document.getElementById('nouveau').addEventListener('click', () => creerArticle().catch((erreur) => afficherMessage(erreur.message)));

await chargerReferentiels().catch((erreur) => afficherMessage(erreur.message));
charger().catch((erreur) => afficherMessage(erreur.message));
