// Écran Matériels : liste, recherche et scan, filtres, création avec réception,
// choix des matériels pour l'impression des étiquettes.
import {
  LIBELLES_ETAT, LIBELLES_STATUT, afficherMessage, afficherPagination, api, badge, badgeEtat, badgeStatut, creer,
  differer, ecrireFiltresAdresse, formaterDateCourte, ligneVide, lireFiltresAdresse, options, ouvrirFormulaire,
} from './app.js';
import { aLeDroit, initialiserEntete } from './entete.js';

const utilisateur = await initialiserEntete();
const gestion = aLeDroit(utilisateur, 'materiels.gerer');

const filtres = document.getElementById('filtres');
const lignes = document.getElementById('lignes');
const boutonEtiquettes = document.getElementById('etiquettes');
const choisis = new Set();
let page = 1;
let sites = [];
let services = [];
let categories = [];

if (gestion) {
  document.getElementById('nouveau').hidden = false;
  boutonEtiquettes.hidden = false;
  document.getElementById('entete-choix').hidden = false;
}
if (utilisateur.role === 'RESPONSABLE_SERVICE') {
  document.getElementById('presentation').textContent = 'Les matériels de votre service.';
}
for (const [valeur, libelle] of Object.entries(LIBELLES_STATUT)) filtres.elements.statut.append(creer('option', { value: valeur, textContent: libelle }));
for (const [valeur, libelle] of Object.entries(LIBELLES_ETAT)) filtres.elements.etat.append(creer('option', { value: valeur, textContent: libelle }));

const initiaux = lireFiltresAdresse();
page = Number(initiaux.page) || 1;

async function chargerReferentiels() {
  [sites, services, categories] = await Promise.all([
    api('/referentiels/sites').then((r) => r.sites),
    api('/referentiels/services').then((r) => r.services),
    api('/referentiels/categories').then((r) => r.categories.filter((c) => c.type === 'MATERIEL')),
  ]);
  for (const site of sites) filtres.elements.site_id.append(creer('option', { value: String(site.id), textContent: site.nom }));
  for (const categorie of categories) filtres.elements.categorie_id.append(creer('option', { value: String(categorie.id), textContent: categorie.nom }));
}

function appliquerFiltresInitiaux() {
  for (const nom of ['q', 'statut', 'etat', 'site_id', 'categorie_id']) filtres.elements[nom].value = initiaux[nom] ?? '';
  filtres.elements.retard.checked = initiaux.retard === 'oui';
  filtres.elements.sans_etiquette.checked = initiaux.sans_etiquette === 'oui';
}

function valeursFiltres() {
  return {
    q: filtres.elements.q.value.trim(),
    statut: filtres.elements.statut.value,
    etat: filtres.elements.etat.value,
    site_id: filtres.elements.site_id.value,
    categorie_id: filtres.elements.categorie_id.value,
    retard: filtres.elements.retard.checked ? 'oui' : '',
    sans_etiquette: filtres.elements.sans_etiquette.checked ? 'oui' : '',
    page: page > 1 ? page : '',
  };
}

function majBoutonEtiquettes() {
  boutonEtiquettes.disabled = choisis.size === 0;
  boutonEtiquettes.textContent = choisis.size ? `Imprimer les étiquettes (${choisis.size})` : 'Imprimer les étiquettes';
}

async function charger() {
  const parametres = ecrireFiltresAdresse(valeursFiltres());
  const reponse = await api(`/materiels?${parametres}`);
  const colonnes = gestion ? 8 : 7;
  lignes.replaceChildren(...(reponse.materiels.length
    ? reponse.materiels.map(ligne)
    : [ligneVide(colonnes, 'Aucun matériel ne correspond.')]));
  document.getElementById('tout-choisir').checked = reponse.materiels.length > 0 && reponse.materiels.every((m) => choisis.has(m.id));
  afficherPagination(document.getElementById('pagination'), reponse, (cible) => {
    page = cible;
    charger().catch((erreur) => afficherMessage(erreur.message));
  });
}

function ligne(materiel) {
  const lien = creer('a', { href: `/materiels/${materiel.id}`, textContent: materiel.code });
  const designation = creer('td', {},
    creer('div', { textContent: materiel.designation }),
    (materiel.marque || materiel.modele) && creer('div', { className: 'secondaire', textContent: [materiel.marque, materiel.modele].filter(Boolean).join(' ') }));
  const responsable = creer('td', {},
    materiel.responsable ?? '—',
    materiel.retour_en_retard && creer('div', {}, badge(`Retour prévu le ${formaterDateCourte(materiel.date_retour_prevue)}`, 'badge-danger')));
  const cellules = [
    creer('td', {}, creer('strong', {}, lien), !materiel.etiquette_imprimee_le && gestion && creer('div', {}, badge('Sans étiquette', 'badge-attente'))),
    designation,
    creer('td', { textContent: materiel.categorie }),
    creer('td', {}, creer('div', { textContent: materiel.site }), materiel.service && creer('div', { className: 'secondaire', textContent: materiel.service })),
    responsable,
    creer('td', {}, badgeEtat(materiel.etat)),
    creer('td', {}, badgeStatut(materiel.statut)),
  ];
  if (gestion) {
    const caseChoix = creer('input', { type: 'checkbox', checked: choisis.has(materiel.id) });
    caseChoix.dataset.id = String(materiel.id);
    caseChoix.setAttribute('aria-label', `Choisir ${materiel.code} pour l’impression d’étiquettes`);
    caseChoix.addEventListener('change', () => {
      if (caseChoix.checked) choisis.add(materiel.id);
      else choisis.delete(materiel.id);
      majBoutonEtiquettes();
    });
    cellules.unshift(creer('td', { className: 'colonne-choix' }, caseChoix));
  }
  return creer('tr', {}, ...cellules);
}

async function creerMateriel() {
  const actifs = (liste) => liste.filter((e) => e.actif).map((e) => ({ valeur: e.id, libelle: e.nom }));
  if (sites.filter((s) => s.actif).length === 0 || categories.filter((c) => c.actif).length === 0) {
    afficherMessage('Créez d’abord au moins un site et une catégorie de matériels dans Administration.');
    return;
  }
  const resultat = await ouvrirFormulaire({
    titre: 'Nouveau matériel',
    large: true,
    libelle: 'Enregistrer la réception',
    champs: [
      { nom: 'designation', libelle: 'Désignation', obligatoire: true, max: 150, aide: 'Exemple : Ordinateur portable 14 pouces.' },
      { nom: 'categorie_id', libelle: 'Catégorie', type: 'liste', obligatoire: true, vide: 'Choisir', options: actifs(categories) },
      { nom: 'code', libelle: 'Code', max: 40, majuscules: true, aide: 'Laissez vide : le code MAT-AAAA-NNNN est attribué et imprimé sur l’étiquette.' },
      { nom: 'marque', libelle: 'Marque', max: 80 },
      { nom: 'modele', libelle: 'Modèle', max: 80 },
      { nom: 'numero_serie', libelle: 'Numéro de série', max: 80 },
      { nom: 'site_id', libelle: 'Site', type: 'liste', obligatoire: true, vide: 'Choisir', options: actifs(sites) },
      { nom: 'service_id', libelle: 'Service utilisateur', type: 'liste', vide: 'Aucun', options: actifs(services) },
      { nom: 'etat', libelle: 'État', type: 'liste', obligatoire: true, defaut: 'NEUF', options: options(LIBELLES_ETAT) },
      {
        nom: 'statut', libelle: 'Statut', type: 'liste', obligatoire: true, defaut: 'DISPONIBLE',
        options: [{ valeur: 'DISPONIBLE', libelle: 'Disponible' }, { valeur: 'EN_REPARATION', libelle: 'En réparation' }],
        aide: 'Un matériel hors service s’enregistre « en réparation » en attendant sa réforme.',
      },
      { type: 'titre', libelle: 'Achat et réception' },
      {
        nom: 'reception.type', libelle: 'Provenance', type: 'liste', defaut: 'RECEPTION_ACHAT',
        options: [{ valeur: 'RECEPTION_ACHAT', libelle: 'Achat' }, { valeur: 'RECEPTION_DON', libelle: 'Don' }],
      },
      { nom: 'reception.date', libelle: 'Date de réception', type: 'date', aide: 'Vide : aujourd’hui.' },
      { nom: 'fournisseur', libelle: 'Fournisseur ou donateur', max: 120 },
      { nom: 'reception.reference_externe', libelle: 'N° de bon de livraison ou de facture', max: 60 },
      { nom: 'date_achat', libelle: 'Date d’achat', type: 'date' },
      { nom: 'prix_achat', libelle: 'Prix d’achat (Ariary)', type: 'nombre', entier: true, max: 18 },
      { nom: 'observations', libelle: 'Observations', type: 'zone', max: 1000 },
    ],
    envoyer: (valeurs) => {
      const corps = {};
      const reception = {};
      for (const [cle, valeur] of Object.entries(valeurs)) {
        if (cle.startsWith('reception.')) reception[cle.slice('reception.'.length)] = valeur;
        else corps[cle] = valeur;
      }
      return api('/materiels', { methode: 'POST', corps: { ...corps, reception } });
    },
  });
  if (resultat?.materiel) window.location.assign(`/materiels/${resultat.materiel.id}?cree=1`);
}

const recharger = () => {
  page = 1;
  charger().catch((erreur) => afficherMessage(erreur.message));
};

// Lecteur de code-barres : il tape le code puis Entrée. Si le code existe, on
// ouvre directement la fiche ; sinon on garde la recherche.
filtres.addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  const code = filtres.elements.q.value.trim();
  if (!code) return;
  try {
    const { materiel } = await api(`/materiels/par-code?code=${encodeURIComponent(code)}`);
    window.location.assign(`/materiels/${materiel.id}`);
  } catch (erreur) {
    if (erreur.statut !== 404) afficherMessage(erreur.message);
    recharger();
  }
});
filtres.elements.q.addEventListener('input', differer(recharger));
for (const nom of ['statut', 'etat', 'site_id', 'categorie_id', 'retard', 'sans_etiquette']) {
  filtres.elements[nom].addEventListener('change', recharger);
}
document.getElementById('nouveau').addEventListener('click', () => creerMateriel().catch((erreur) => afficherMessage(erreur.message)));
document.getElementById('tout-choisir').addEventListener('change', (evenement) => {
  for (const caseChoix of lignes.querySelectorAll('input[type="checkbox"][data-id]')) {
    caseChoix.checked = evenement.target.checked;
    if (caseChoix.checked) choisis.add(Number(caseChoix.dataset.id));
    else choisis.delete(Number(caseChoix.dataset.id));
  }
  majBoutonEtiquettes();
});
boutonEtiquettes.addEventListener('click', () => {
  window.location.assign(`/etiquettes?ids=${[...choisis].join(',')}`);
});

await chargerReferentiels().catch((erreur) => afficherMessage(erreur.message));
appliquerFiltresInitiaux();
charger().catch((erreur) => afficherMessage(erreur.message));
