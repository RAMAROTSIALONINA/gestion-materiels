// Tableau de bord (phase 8, cahier des charges § 3.1) : cartes de synthèse du
// parc, des articles et des mouvements de la période, alertes de stock,
// mouvements récents ; filtres de période, site, service et catégorie.
// Décision du 12/11 : le nombre d'articles seulement (les unités diffèrent).
// L'administrateur voit aussi l'état du serveur et de la base, en bas.
import {
  afficherMessage, api, badge, creer, differer, ecrireFiltresAdresse, formaterDateCourte, formaterNombre, lireFiltresAdresse,
} from './app.js';
import { aLeDroit, initialiserEntete, pageAccueil } from './entete.js';
import { icone } from './icones.js';

const element = (id) => document.getElementById(id);
const filtres = element('filtres');
const nombre = (n) => new Intl.NumberFormat('fr-FR').format(n ?? 0);
const pluriel = (n, mot, motPluriel = `${mot}s`) => `${nombre(n)} ${n > 1 ? motPluriel : mot}`;

// Carte de synthèse : icône teintée, chiffre, libellé ; elle ouvre la liste filtrée.
function indicateur({ titre, valeur, icone: nomIcone, teinte, adresse, detail }) {
  return creer(adresse ? 'a' : 'div', { className: `indicateur teinte-${teinte}`, ...(adresse ? { href: adresse } : {}) },
    creer('span', { className: 'indicateur-icone' }, icone(nomIcone)),
    creer('span', { className: 'indicateur-texte' },
      creer('span', { className: 'indicateur-valeur', textContent: nombre(valeur) }),
      creer('span', { className: 'indicateur-titre', textContent: titre }),
      detail && creer('span', { className: 'indicateur-detail', textContent: detail })));
}

// Adresse d'une liste, avec les filtres du tableau de bord qu'elle sait appliquer.
function liste(chemin, parametres) {
  const recherche = new URLSearchParams(Object.entries(parametres).filter(([, valeur]) => valeur));
  return `${chemin}${recherche.size ? `?${recherche}` : ''}`;
}

function afficher(donnees, choix) {
  const m = donnees.materiels;
  const communs = { site_id: choix.site_id, categorie_id: choix.categorie_id };
  element('indicateurs-parc').replaceChildren(
    indicateur({
      titre: 'Matériels au parc', valeur: m.total, icone: 'materiels', teinte: 'bleu', adresse: liste('/materiels', communs),
      detail: m.sortis ? `+ ${nombre(m.sortis)} perdu${m.sortis > 1 ? 's' : ''} ou réformé${m.sortis > 1 ? 's' : ''}` : null,
    }),
    indicateur({ titre: 'Disponibles', valeur: m.disponibles, icone: 'disponible', teinte: 'vert', adresse: liste('/materiels', { ...communs, statut: 'DISPONIBLE' }) }),
    indicateur({ titre: 'Affectés', valeur: m.affectes, icone: 'affectations', teinte: 'indigo', adresse: liste('/materiels', { ...communs, statut: 'AFFECTE' }) }),
    indicateur({
      titre: 'En réparation', valeur: m.en_reparation, icone: 'reparation', teinte: 'jaune', adresse: liste('/materiels', { ...communs, statut: 'EN_REPARATION' }),
      detail: m.endommages ? `${pluriel(m.endommages, 'endommagé')} au total` : null,
    }),
    indicateur({ titre: 'Hors service', valeur: m.hors_service, icone: 'hors-service', teinte: 'gris', adresse: liste('/materiels', { ...communs, etat: 'HORS_SERVICE' }) }),
    indicateur({
      titre: 'Retours en retard', valeur: m.retours_en_retard, icone: 'retard', teinte: m.retours_en_retard ? 'rouge' : 'gris',
      adresse: liste('/materiels', { ...communs, retard: 'oui' }),
    }),
  );

  const a = donnees.articles;
  const articles = { categorie_id: choix.categorie_id };
  const surSite = donnees.perimetre === 'service' || choix.site_id;
  element('indicateurs-articles').replaceChildren(
    indicateur({ titre: surSite ? 'Articles suivis sur le site' : 'Articles suivis', valeur: a.total, icone: 'articles', teinte: 'bleu', adresse: liste('/articles', articles) }),
    indicateur({ titre: 'En stock', valeur: a.en_stock, icone: 'disponible', teinte: 'vert', adresse: liste('/articles', articles) }),
    indicateur({ titre: 'Sous le seuil', valeur: a.sous_seuil, icone: 'attention', teinte: a.sous_seuil ? 'orange' : 'gris', adresse: liste('/articles', { ...articles, alerte: 'oui' }) }),
    indicateur({ titre: 'En rupture', valeur: a.en_rupture, icone: 'rupture', teinte: a.en_rupture ? 'rouge' : 'gris', adresse: liste('/articles', { ...articles, rupture: 'oui' }) }),
  );

  const mv = donnees.mouvements;
  const periode = { date_debut: donnees.periode.debut, date_fin: donnees.periode.fin, statut: 'VALIDE' };
  element('titre-mouvements').textContent = `Mouvements du ${formaterDateCourte(donnees.periode.debut)} au ${formaterDateCourte(donnees.periode.fin)}`;
  element('indicateurs-mouvements').replaceChildren(
    indicateur({ titre: 'Entrées', valeur: mv.entrees, icone: 'entree', teinte: 'vert', adresse: liste('/mouvements', periode), detail: 'réceptions, retours, corrections (+)' }),
    indicateur({ titre: 'Sorties', valeur: mv.sorties, icone: 'sortie', teinte: 'orange', adresse: liste('/mouvements', periode), detail: 'remises, consommations, pertes, casses' }),
    indicateur({ titre: 'Transferts', valeur: mv.transferts, icone: 'mouvements', teinte: 'indigo', adresse: liste('/mouvements', { ...periode, type_code: 'TRANSFERT' }), detail: 'entre sites' }),
  );

  // Alertes de stock (ruptures d'abord).
  const alertes = donnees.alertes_stock;
  element('alertes-stock').replaceChildren(...(alertes.elements.length
    ? [
      ...alertes.elements.map((al) => creer('li', {},
        creer('div', { className: 'alerte-article' },
          creer('a', { href: `/articles/${al.article_id}`, textContent: al.designation }),
          creer('span', { className: 'secondaire', textContent: [al.code, al.site].filter(Boolean).join(' · ') })),
        creer('div', { className: 'alerte-quantite' },
          creer('span', { textContent: `${formaterNombre(al.quantite, al.decimales)} / ${formaterNombre(al.seuil, al.decimales)} ${al.symbole}` }),
          al.en_rupture ? badge('Rupture', 'badge-danger') : badge('Sous le seuil', 'badge-attente')))),
      alertes.total > alertes.elements.length
        && creer('li', { className: 'secondaire' }, `Et ${pluriel(alertes.total - alertes.elements.length, 'autre')} : `,
          creer('a', { href: '/articles?alerte=oui', textContent: 'voir les articles en alerte' })),
    ].filter(Boolean)
    : [creer('li', { className: 'secondaire', textContent: 'Aucun article sous le seuil.' })]));

  // Mouvements récents.
  element('recents').replaceChildren(...(donnees.recents.length
    ? donnees.recents.map((r) => creer('tr', {},
      creer('td', {}, creer('strong', {}, creer('a', { href: `/mouvements/${r.id}`, textContent: r.reference })),
        creer('div', { className: 'secondaire', textContent: formaterDateCourte(r.date_mouvement) })),
      creer('td', { className: 'cellule-principale' },
        creer('div', { textContent: `${r.premiere_ligne ?? '—'}${r.nb_lignes > 1 ? ` + ${r.nb_lignes - 1}` : ''}` }),
        creer('div', { className: 'secondaire' }, r.type, r.en_route ? ' ' : null, r.en_route ? badge('En route', 'badge-attente') : null)),
      creer('td', { textContent: [r.site_origine, r.site_destination].filter(Boolean).join(' → ') || '—' })))
    : [creer('tr', {}, creer('td', { colSpan: 3, className: 'cellule-vide', textContent: 'Aucun mouvement sur la période.' }))]));
}

async function charger() {
  const choix = Object.fromEntries(['date_debut', 'date_fin', 'site_id', 'service_id', 'categorie_id']
    .map((nom) => [nom, filtres.elements[nom].value]));
  const parametres = ecrireFiltresAdresse(choix);
  afficher(await api(`/tableau-de-bord?${parametres}`), choix);
}

// État du serveur et de la base (administrateur), en une ligne.
async function verifierServeur() {
  const pastille = element('pastille');
  const texte = element('etat-texte');
  pastille.className = 'pastille pastille-attente';
  pastille.textContent = 'Vérification…';
  try {
    const etat = await api('/sante');
    pastille.className = 'pastille pastille-ok';
    pastille.textContent = 'Serveur opérationnel';
    texte.textContent = `Version ${etat.version} · base ${etat.base?.version_schema ?? '—'} · ${etat.base?.delai_ms ?? '—'} ms`;
  } catch (erreur) {
    pastille.className = 'pastille pastille-ko';
    pastille.textContent = 'Problème';
    texte.textContent = erreur.donnees?.base?.message ?? erreur.message;
  }
}

const utilisateur = await initialiserEntete();
if (pageAccueil(utilisateur) !== '/' || !aLeDroit(utilisateur, 'rapports.lire')) {
  // L'employé n'a que ses matériels : il y va directement.
  window.location.replace(aLeDroit(utilisateur, 'mes_materiels.lire') ? '/mes-materiels' : '/parametres');
} else {
  element('lien-rapports').hidden = false;
  element('lien-inventaire').hidden = !aLeDroit(utilisateur, 'materiels.lire');
  const { sites, services, categories, responsable } = await api('/rapports/options');
  for (const site of sites) filtres.elements.site_id.append(creer('option', { value: String(site.id), textContent: site.nom }));
  for (const service of services) filtres.elements.service_id.append(creer('option', { value: String(service.id), textContent: service.nom }));
  for (const [type, libelle] of [['MATERIEL', 'Matériels'], ['ARTICLE', 'Articles']]) {
    filtres.elements.categorie_id.append(creer('optgroup', { label: libelle },
      ...categories.filter((c) => c.type === type).map((c) => creer('option', { value: String(c.id), textContent: c.nom }))));
  }
  // Le responsable ne voit que son service : le filtre de service est inutile.
  element('champ-service').hidden = responsable;
  if (responsable) {
    element('presentation').textContent = 'Vue d’ensemble de votre service : ses matériels, et les articles du site de votre service. '
      + 'Les mouvements sont comptés sur la période choisie (les 30 derniers jours si vous n’en choisissez pas).';
  }
  const initiaux = lireFiltresAdresse();
  for (const nom of ['date_debut', 'date_fin', 'site_id', 'service_id', 'categorie_id']) filtres.elements[nom].value = initiaux[nom] ?? '';
  const recharger = () => charger().catch((erreur) => afficherMessage(erreur.message));
  for (const nom of ['site_id', 'service_id', 'categorie_id']) filtres.elements[nom].addEventListener('change', recharger);
  for (const nom of ['date_debut', 'date_fin']) filtres.elements[nom].addEventListener('change', differer(recharger, 400));
  filtres.addEventListener('submit', (evenement) => evenement.preventDefault());
  recharger();

  if (utilisateur.role === 'ADMIN') {
    element('etat-serveur').hidden = false;
    element('actualiser').addEventListener('click', verifierServeur);
    verifierServeur();
  }
}
