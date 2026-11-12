// Rapports (phase 8, cahier des charges § 10) : un onglet par rapport, ses
// filtres, un aperçu page par page et l'export en CSV (Excel) ou en PDF.
// L'export reprend les filtres affichés ; le serveur applique les droits
// (le responsable : son service) et inscrit chaque export au journal.
import {
  afficherMessage, afficherPagination, api, badge, badgeEtat, badgeStatut, creer, differer, ecrireFiltresAdresse,
  formaterDateCourte, formaterNombre, ligneVide, lireFiltresAdresse, telecharger,
} from './app.js';
import { initialiserEntete } from './entete.js';

await initialiserEntete();
const element = (id) => document.getElementById(id);
const filtres = element('filtres');
const options = await api('/rapports/options');
const parCode = Object.fromEntries(options.rapports.map((r) => [r.code, r]));
const initiaux = lireFiltresAdresse();
let rapport = parCode[initiaux.rapport] ?? options.rapports[0];
let page = Number(initiaux.page) || 1;

const AIDES_RECHERCHE = {
  parc: 'Code, désignation, n° de série…', mouvements: 'Référence, ticket, article…', affectations: 'Code, employé, contrat…',
  retours: 'Code, employé, observation…', stock: 'Code ou article…', anomalies: 'Code, référence, motif…', journal: 'Référence, code, adresse…',
};

// --- Construction des filtres du rapport choisi -----------------------------
const champ = (libelle, controle, classe = '') => creer('div', { className: `champ ${classe}`.trim() },
  creer('label', { htmlFor: controle.id, textContent: libelle }), controle);
const choix = (valeur, texte) => creer('option', { value: String(valeur), textContent: texte });
const liste = (nom, libelle, valeurs, tous = 'Tous') => champ(libelle,
  creer('select', { id: nom, name: nom }, choix('', tous), ...valeurs.map(([valeur, texte]) => choix(valeur, texte))));
const caseFiltre = (nom, libelle) => creer('label', { className: 'case' },
  creer('input', { type: 'checkbox', name: nom, value: 'oui' }), ` ${libelle}`);

function listeCategories(types) {
  const select = creer('select', { id: 'categorie_id', name: 'categorie_id' }, choix('', 'Toutes'));
  const groupes = types === 'TOUTES' ? [['MATERIEL', 'Matériels'], ['ARTICLE', 'Articles']] : [[types, null]];
  for (const [type, titre] of groupes) {
    const elements = options.categories.filter((c) => c.type === type).map((c) => choix(c.id, c.nom));
    select.append(...(titre ? [creer('optgroup', { label: titre }, ...elements)] : elements));
  }
  return champ('Catégorie', select);
}

const CONSTRUCTEURS = {
  q: (r) => champ('Rechercher', creer('input', {
    type: 'search', id: 'q', name: 'q', placeholder: AIDES_RECHERCHE[r.code] ?? 'Rechercher…', autocomplete: 'off',
  })),
  periode: () => creer('div', { className: 'champ champ-periode' },
    creer('label', { htmlFor: 'date_debut', textContent: 'Du' }), creer('input', { type: 'date', id: 'date_debut', name: 'date_debut' }),
    creer('label', { htmlFor: 'date_fin', textContent: 'au' }), creer('input', { type: 'date', id: 'date_fin', name: 'date_fin' })),
  type: () => liste('type_code', 'Type', options.types.map((t) => [t.code, t.libelle])),
  categorie: (r) => listeCategories(r.categories),
  site: () => liste('site_id', 'Site', options.sites.map((s) => [s.id, s.nom])),
  // Le responsable ne voit que son service : le filtre est inutile.
  service: () => (options.responsable ? null : liste('service_id', 'Service', options.services.map((s) => [s.id, s.nom]))),
  employe: () => liste('employe_id', 'Employé', options.employes.map((e) => [e.id, `${e.nom} (${e.matricule})`])),
  etat: (r) => liste('etat', { retours: 'État au retour', affectations: 'État initial' }[r.code] ?? 'État', Object.entries(options.libelles.etats)),
  statut: () => liste('statut', 'Statut', Object.entries(options.libelles.statuts)),
  statut_mouvement: () => liste('statut', 'Statut', Object.entries(options.libelles.statuts_mouvement)),
  nature: () => liste('nature', 'Nature', Object.entries(options.libelles.natures), 'Toutes'),
  action: () => liste('action', 'Opération', options.actions.map((a) => [a.code, a.libelle]), 'Toutes'),
  utilisateur: () => liste('utilisateur_id', 'Personne', options.utilisateurs.map((u) => [u.id, u.nom]), 'Toutes'),
  alerte: () => caseFiltre('alerte', 'En alerte'),
  retard: () => caseFiltre('alerte', 'En retard'),
};

function construireFiltres(valeurs = {}) {
  const champs = [];
  const cases = [];
  for (const nom of rapport.filtres) {
    const controle = CONSTRUCTEURS[nom]?.(rapport);
    if (controle) (controle.classList.contains('case') ? cases : champs).push(controle);
  }
  if (cases.length) champs.push(creer('div', { className: 'champ champ-cases' }, ...cases));
  filtres.replaceChildren(...champs);
  for (const controle of filtres.elements) {
    if (!controle.name) continue;
    if (controle.type === 'checkbox') controle.checked = valeurs[controle.name] === 'oui';
    else if (valeurs[controle.name] !== undefined) controle.value = valeurs[controle.name];
    if (controle.type === 'search') controle.addEventListener('input', differer(recharger));
    else controle.addEventListener('change', controle.type === 'date' ? differer(recharger, 400) : recharger);
  }
}

function valeursFiltres() {
  const valeurs = {};
  for (const controle of filtres.elements) {
    if (!controle.name) continue;
    if (controle.type === 'checkbox') {
      if (controle.checked) valeurs[controle.name] = 'oui';
    } else if (controle.value.trim()) {
      valeurs[controle.name] = controle.value.trim();
    }
  }
  return valeurs;
}

// --- Aperçu -------------------------------------------------------------------
const LIENS = {
  materiel: (l) => l.materiel_id && `/materiels/${l.materiel_id}`,
  article: (l) => l.article_id && `/articles/${l.article_id}`,
  mouvement: (l) => l.mouvement_id && `/mouvements/${l.mouvement_id}`,
  bien: (l) => (l.materiel_id ? `/materiels/${l.materiel_id}` : l.article_id && `/articles/${l.article_id}`),
};
const CLASSES = {
  statut_mouvement: { VALIDE: 'badge-succes', BROUILLON: 'badge-attente', ANNULE: 'badge-neutre' },
  alerte: { RUPTURE: 'badge-danger', SOUS_SEUIL: 'badge-attente' },
  nature: { PERTE: 'badge-danger', CASSE: 'badge-danger', MANQUANT: 'badge-attente', REPARATION: 'badge-attente', HORS_SERVICE: 'badge-neutre' },
};
const DICTIONNAIRES = {
  statut_mouvement: options.libelles.statuts_mouvement, alerte: options.libelles.alertes, nature: options.libelles.natures,
};
const aDroite = (colonne) => colonne.type === 'nombre' || colonne.type === 'retard';

function cellule(colonne, ligne) {
  const valeur = ligne[colonne.cle];
  if (valeur === null || valeur === undefined || valeur === '') return colonne.type === 'retard' ? '' : '—';
  const adresse = colonne.lien && LIENS[colonne.lien](ligne);
  if (adresse) return creer('strong', {}, creer('a', { href: adresse, textContent: valeur }));
  switch (colonne.type) {
    case 'date': return formaterDateCourte(valeur);
    case 'dateheure': return `${formaterDateCourte(valeur.slice(0, 10))} ${valeur.slice(11, 16)}`;
    case 'nombre': return formaterNombre(valeur);
    case 'retard': return valeur > 0 ? badge(`${valeur} j`, 'badge-danger') : '';
    case 'etat': return badgeEtat(valeur);
    case 'statut': return badgeStatut(valeur);
    case 'action': return options.libelles.actions[valeur] ?? valeur;
    case 'statut_mouvement':
    case 'alerte':
    case 'nature': return badge(DICTIONNAIRES[colonne.type][valeur] ?? valeur, CLASSES[colonne.type][valeur]);
    default: return String(valeur);
  }
}

// Onglets : libellés courts (le titre complet est dans la description et les exports).
const ONGLETS = { affectations: 'Affectations', stock: 'Stock', journal: 'Journal' };

function afficherOnglets() {
  element('onglets').replaceChildren(...options.rapports.map((r) => {
    const bouton = creer('button', { type: 'button', textContent: ONGLETS[r.code] ?? r.titre, title: r.titre });
    bouton.setAttribute('role', 'tab');
    bouton.setAttribute('aria-selected', String(r.code === rapport.code));
    bouton.addEventListener('click', () => {
      if (r.code === rapport.code) return;
      rapport = r;
      page = 1;
      afficherOnglets();
      construireFiltres();
      recharger();
    });
    return bouton;
  }));
  element('description').replaceChildren(creer('strong', { textContent: `${rapport.titre}. ` }), rapport.description);
  element('entetes').replaceChildren(...rapport.colonnes.map((colonne) => creer('th', {
    scope: 'col', textContent: colonne.libelle, className: aDroite(colonne) ? 'nombre' : '',
  })));
}

async function charger() {
  const valeurs = valeursFiltres();
  ecrireFiltresAdresse({ rapport: rapport.code, ...valeurs, page: page > 1 ? page : '' });
  const parametres = new URLSearchParams({ ...valeurs, ...(page > 1 ? { page } : {}) });
  const code = rapport.code;
  const reponse = await api(`/rapports/${code}?${parametres}`);
  if (code !== rapport.code) return;          // un autre onglet a été choisi entre-temps
  element('lignes').replaceChildren(...(reponse.lignes.length
    ? reponse.lignes.map((ligne) => creer('tr', {}, ...rapport.colonnes.map((colonne) => creer('td', {
      className: aDroite(colonne) ? 'nombre' : (colonne.largeur ?? 1) >= 2 ? 'cellule-principale' : '',
    }, cellule(colonne, ligne)))))
    : [ligneVide(rapport.colonnes.length, 'Aucune ligne ne correspond aux filtres.')]));
  afficherPagination(element('pagination'), reponse, (cible) => {
    page = cible;
    charger().catch((erreur) => afficherMessage(erreur.message));
  });
}

function recharger() {
  page = 1;
  charger().catch((erreur) => afficherMessage(erreur.message));
}

// --- Exports --------------------------------------------------------------------
async function exporter(format, bouton) {
  const parametres = new URLSearchParams(valeursFiltres());
  const libelle = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = 'Préparation…';
  try {
    const nom = await telecharger(`/rapports/${rapport.code}/export/${format}${parametres.size ? `?${parametres}` : ''}`);
    afficherMessage(`Fichier enregistré : ${nom}`, 'succes');
  } catch (erreur) {
    afficherMessage(erreur.message);
  } finally {
    bouton.disabled = false;
    bouton.textContent = libelle;
  }
}

if (options.exporter) {
  element('exports').hidden = false;
  element('export-csv').addEventListener('click', (evenement) => exporter('csv', evenement.currentTarget));
  element('export-pdf').addEventListener('click', (evenement) => exporter('pdf', evenement.currentTarget));
}
if (options.responsable) {
  element('aide').textContent = 'Les rapports de votre service. Un export reprend exactement les filtres affichés ; il est inscrit au journal des opérations.';
}
filtres.addEventListener('submit', (evenement) => evenement.preventDefault());
afficherOnglets();
construireFiltres(initiaux.rapport === rapport.code ? initiaux : {});
charger().catch((erreur) => {
  afficherMessage(erreur.message);
  element('lignes').replaceChildren(ligneVide(rapport.colonnes.length, 'Chargement impossible.'));
});
