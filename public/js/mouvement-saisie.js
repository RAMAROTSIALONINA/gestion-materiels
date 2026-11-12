// Saisie (ou modification d'un brouillon) d'un mouvement. Depuis le 12/11, on
// y arrive par une opération (Transférer, Réception, Sortie…) : le formulaire
// ne propose que ses types et ses champs. Articles ajoutés par recherche,
// matériels par scan.
import { afficherMessage, api, creer, formaterNombre, ligneVide, montrerErreurFormulaire } from './app.js';
import { initialiserEntete } from './entete.js';
import { OPERATIONS, operationDuType } from './operations.js';

const utilisateur = await initialiserEntete();
const formulaire = document.getElementById('formulaire');
const zoneErreur = document.getElementById('erreur');
const corpsLignes = document.getElementById('lignes');
const champ = (nom) => formulaire.elements.namedItem(nom);
const morceaux = window.location.pathname.split('/');
const idModifie = morceaux[3] === 'modifier' ? Number(morceaux[2]) : null;
const parametres = new URLSearchParams(window.location.search);

let types = [];
let operation = null;            // clé de OPERATIONS (transfert, reception…)
let articles = [];
let lignes = [];                 // { article_id | materiel_id, code, designation, quantite, symbole, decimales, statut }
const stocksParArticle = new Map();
const type = () => types.find((t) => t.code === champ('type_code').value);

function remplirListe(select, elements, libelle, vide) {
  select.replaceChildren(...[
    vide !== undefined && creer('option', { value: '', textContent: vide }),
    ...elements.map((element) => creer('option', { value: String(element.id), textContent: libelle(element) })),
  ].filter(Boolean));
}

async function preparer() {
  const [reponseTypes, sites, services, employes, reponseArticles] = await Promise.all([
    api('/referentiels/types-mouvements'),
    api('/referentiels/sites').then((r) => r.sites.filter((s) => s.actif)),
    api('/referentiels/services').then((r) => r.services.filter((s) => s.actif)),
    api('/referentiels/employes').then((r) => r.employes.filter((e) => e.actif)),
    api('/referentiels/articles'),
  ]);
  types = reponseTypes.types.filter((t) => t.saisie_manuelle);
  articles = reponseArticles.articles.filter((a) => a.actif);
  champ('type_code').replaceChildren(...types.map((t) => creer('option', { value: t.code, textContent: t.libelle })));
  remplirListe(champ('site_source_id'), sites, (s) => s.nom, 'Choisir');
  remplirListe(champ('site_destination_id'), sites, (s) => s.nom, 'Choisir');
  remplirListe(champ('service_beneficiaire_id'), services, (s) => s.nom, 'Aucun');
  remplirListe(champ('employe_beneficiaire_id'), employes, (e) => `${e.nom} ${e.prenoms ?? ''} (${e.matricule})`.replace(/\s+/g, ' '), 'Aucun');
  document.getElementById('liste-articles').replaceChildren(...articles.map((a) => creer('option', { value: `${a.code} — ${a.designation}` })));
}

// N° de bon ou de facture : seulement pour une réception (achat, don). N° de
// ticket : seulement quand un matériel est dans les lignes — la base l'exige
// alors pour les types qui le demandent. Un champ déjà rempli (brouillon
// repris) reste affiché, pour ne jamais effacer une saisie sans la montrer.
const rempli = (nom) => champ(nom).value.trim() !== '';
const montrerBon = () => Boolean(type()?.code.startsWith('RECEPTION_')) || rempli('reference_externe');
const montrerTicket = () => (Boolean(type()?.pour_materiels) && lignes.some((ligne) => ligne.materiel_id)) || rempli('numero_ticket');

function majTicket() {
  const t = type();
  formulaire.querySelector('[data-si="ticket"]').hidden = !montrerTicket();
  document.getElementById('libelle-ticket').textContent = t?.ticket_obligatoire ? 'N° de ticket *' : 'N° de ticket';
}

// Matériels acceptés : selon le type, sauf pour une réception (un nouveau
// matériel se reçoit avec sa fiche, depuis Matériels › Nouveau matériel).
const accepteMateriels = (t) => t.pour_materiels && !OPERATIONS[operation]?.sansMateriels;

// Champs visibles et obligatoires selon le type de mouvement.
function adapter() {
  const t = type();
  if (!t) return;
  const visibles = {
    origine: t.sens !== 'ENTREE',
    destination: t.sens !== 'SORTIE',
    beneficiaire: t.beneficiaire_obligatoire,
    fournisseur: t.code.startsWith('RECEPTION_'),
    bon: montrerBon(),
    ticket: montrerTicket(),
    articles: t.pour_articles,
    materiels: accepteMateriels(t),
  };
  for (const bloc of formulaire.querySelectorAll('[data-si]')) bloc.hidden = !visibles[bloc.dataset.si];
  document.getElementById('libelle-motif').textContent = t.motif_obligatoire ? 'Motif *' : 'Motif';
  const aideSens = {
    ENTREE: 'Entrée : le stock du site de destination augmente.',
    SORTIE: 'Sortie : le stock du site d’origine baisse.',
    TRANSFERT: 'Transfert : le bien quitte le site d’origine et arrive aussitôt au site de destination.',
  }[t.sens];
  document.getElementById('aide-type').textContent = aideSens;
  // Une seule possibilité : pas de liste de types, l'explication passe sous le titre.
  const champType = document.getElementById('champ-type');
  champType.hidden = types.length === 1;
  if (operation) {
    const presentation = document.getElementById('presentation');
    presentation.textContent = [OPERATIONS[operation].texte, champType.hidden ? aideSens : null, OPERATIONS[operation].note]
      .filter(Boolean).join(' ');
    presentation.hidden = false;
  }
  const autorisation = t.autorisation_obligatoire;
  document.getElementById('note-autorisation').hidden = !autorisation;
  const valider = document.getElementById('valider');
  valider.hidden = autorisation && utilisateur.role !== 'ADMIN';
  valider.textContent = OPERATIONS[operation]?.boutons?.[t.code] ?? 'Enregistrer et valider';
  const avant = lignes.length;
  lignes = lignes.filter((ligne) => (ligne.article_id ? t.pour_articles : accepteMateriels(t)));
  if (lignes.length < avant) afficherMessage('Certaines lignes ont été retirées : ce type de mouvement ne les accepte pas.');
  afficherLignes();
}

async function stockOrigine(articleId) {
  const site = Number(champ('site_source_id').value);
  if (!site || type()?.sens === 'ENTREE') return null;
  if (!stocksParArticle.has(articleId)) {
    stocksParArticle.set(articleId, (await api(`/articles/${articleId}`)).sites);
  }
  return stocksParArticle.get(articleId).find((s) => s.site_id === site)?.quantite ?? 0;
}

async function afficherLignes() {
  majTicket();
  if (lignes.length === 0) {
    corpsLignes.replaceChildren(ligneVide(5, 'Aucune ligne pour l’instant.'));
    return;
  }
  const rangees = await Promise.all(lignes.map(async (ligne, rang) => {
    const retirer = creer('button', { type: 'button', className: 'bouton bouton-petit bouton-secondaire', textContent: 'Retirer' });
    retirer.setAttribute('aria-label', `Retirer ${ligne.code}`);
    retirer.addEventListener('click', () => {
      lignes.splice(rang, 1);
      afficherLignes();
    });
    let quantite;
    if (ligne.article_id) {
      const saisie = creer('input', { value: ligne.quantite ?? '', inputMode: 'decimal', className: 'saisie-quantite' });
      saisie.setAttribute('aria-label', `Quantité de ${ligne.designation}`);
      saisie.addEventListener('input', () => { ligne.quantite = saisie.value; });
      quantite = creer('span', { className: 'quantite-ligne' }, saisie, ` ${ligne.symbole}`);
    } else {
      quantite = '1';
    }
    const stock = ligne.article_id ? await stockOrigine(ligne.article_id).catch(() => null) : null;
    return creer('tr', {},
      creer('td', {}, creer('strong', { textContent: ligne.code })),
      creer('td', {}, creer('div', { textContent: ligne.designation }),
        ligne.statut && creer('div', { className: 'secondaire', textContent: `Statut : ${ligne.statut.toLowerCase().replace('_', ' ')}` })),
      creer('td', { className: 'nombre' }, quantite),
      creer('td', { className: 'nombre', textContent: stock === null ? '—' : `${formaterNombre(stock, ligne.decimales)} ${ligne.symbole}` }),
      creer('td', {}, retirer));
  }));
  corpsLignes.replaceChildren(...rangees);
}

function ajouterArticle(article, quantite = '') {
  if (lignes.some((ligne) => ligne.article_id === article.id)) {
    afficherMessage(`${article.designation} est déjà dans la liste : modifiez sa quantité.`);
    return;
  }
  lignes.push({ article_id: article.id, code: article.code, designation: article.designation, quantite, symbole: article.symbole, decimales: article.decimales });
  afficherLignes();
}

async function ajouterMateriel(code) {
  const { materiel } = await api(`/materiels/par-code?code=${encodeURIComponent(code)}`);
  if (lignes.some((ligne) => ligne.materiel_id === materiel.id)) {
    afficherMessage(`${materiel.code} est déjà dans la liste.`);
    return;
  }
  const source = champ('site_source_id');
  if (type()?.sens !== 'ENTREE') {
    if (!source.value) source.value = String(materiel.site_id);
    else if (Number(source.value) !== materiel.site_id) {
      afficherMessage(`${materiel.code} se trouve au site « ${materiel.site} », pas au site d’origine choisi.`);
    }
  }
  lignes.push({ materiel_id: materiel.id, code: materiel.code, designation: materiel.designation, statut: materiel.statut });
  afficherLignes();
}

document.getElementById('ajouter-article').addEventListener('click', () => {
  const saisie = document.getElementById('article').value.trim();
  const article = articles.find((a) => `${a.code} — ${a.designation}` === saisie || a.code === saisie.toUpperCase()
    || a.designation.toLowerCase() === saisie.toLowerCase());
  if (!article) {
    afficherMessage('Article introuvable : choisissez-le dans la liste proposée.');
    return;
  }
  ajouterArticle(article, document.getElementById('quantite').value.trim());
  document.getElementById('article').value = '';
  document.getElementById('quantite').value = '';
  document.getElementById('article').focus();
});

const codeMateriel = document.getElementById('code-materiel');
const ajouterCode = async () => {
  const code = codeMateriel.value.trim();
  if (!code) return;
  try {
    await ajouterMateriel(code);
    codeMateriel.value = '';
  } catch (erreur) {
    afficherMessage(erreur.message);
  }
  codeMateriel.focus();
};
document.getElementById('ajouter-materiel').addEventListener('click', ajouterCode);
// Le lecteur de code-barres termine par Entrée : on ajoute la ligne au lieu d'envoyer le formulaire.
codeMateriel.addEventListener('keydown', (evenement) => {
  if (evenement.key === 'Enter') {
    evenement.preventDefault();
    ajouterCode();
  }
});
champ('type_code').addEventListener('change', adapter);
champ('site_source_id').addEventListener('change', () => afficherLignes());

formulaire.addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  zoneErreur.hidden = true;
  const valider = evenement.submitter?.value === 'valider';
  const t = type();
  const valeur = (nom) => champ(nom).value.trim() || null;
  const corps = {
    type_code: t.code,
    date_mouvement: valeur('date_mouvement'),
    site_source_id: t.sens !== 'ENTREE' ? valeur('site_source_id') : null,
    site_destination_id: t.sens !== 'SORTIE' ? valeur('site_destination_id') : null,
    motif: valeur('motif'),
    service_beneficiaire_id: t.beneficiaire_obligatoire ? valeur('service_beneficiaire_id') : null,
    employe_beneficiaire_id: t.beneficiaire_obligatoire ? valeur('employe_beneficiaire_id') : null,
    origine: t.code.startsWith('RECEPTION_') ? valeur('origine') : null,
    reference_externe: montrerBon() ? valeur('reference_externe') : null,
    numero_ticket: montrerTicket() ? valeur('numero_ticket') : null,
    lignes: lignes.map((ligne) => (ligne.article_id
      ? { article_id: ligne.article_id, quantite: ligne.quantite }
      : { materiel_id: ligne.materiel_id })),
    valider,
  };
  for (const bouton of formulaire.querySelectorAll('button[type="submit"]')) bouton.disabled = true;
  try {
    const { mouvement } = idModifie
      ? await api(`/mouvements/${idModifie}`, { methode: 'PUT', corps })
      : await api('/mouvements', { methode: 'POST', corps });
    window.location.assign(`/mouvements/${mouvement.id}?${valider ? 'valide' : 'enregistre'}=1`);
  } catch (erreur) {
    montrerErreurFormulaire(formulaire, zoneErreur, erreur);
    zoneErreur.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } finally {
    for (const bouton of formulaire.querySelectorAll('button[type="submit"]')) bouton.disabled = false;
  }
});

// Limite les types proposés à ceux de l'opération.
function choisirOperation(cle) {
  operation = cle;
  // Dans l'ordre de l'opération (Transfert avant Sortie).
  const ordre = OPERATIONS[cle].types;
  types = types.filter((t) => ordre.includes(t.code)).sort((a, b) => ordre.indexOf(a.code) - ordre.indexOf(b.code));
  champ('type_code').replaceChildren(...types.map((t) => creer('option', {
    value: t.code, textContent: OPERATIONS[cle].libelles?.[t.code] ?? t.libelle,
  })));
}

async function initialiser() {
  await preparer();
  if (idModifie) {
    const { mouvement } = await api(`/mouvements/${idModifie}`);
    if (mouvement.statut !== 'BROUILLON') {
      window.location.replace(`/mouvements/${idModifie}`);
      return;
    }
    const cle = operationDuType(mouvement.type_code);
    if (cle) choisirOperation(cle);
    document.getElementById('titre').textContent = `Modifier le brouillon ${mouvement.reference}`;
    document.title = `${mouvement.reference} — Gestion des matériels`;
    champ('type_code').value = mouvement.type_code;
    champ('type_code').disabled = true;
    for (const nom of ['date_mouvement', 'motif', 'origine', 'reference_externe', 'numero_ticket', 'service_beneficiaire_id', 'employe_beneficiaire_id']) {
      champ(nom).value = mouvement[nom] ?? '';
    }
    champ('site_source_id').value = mouvement.lignes[0]?.site_source_id ?? '';
    champ('site_destination_id').value = mouvement.lignes[0]?.site_destination_id ?? '';
    lignes = mouvement.lignes.map((ligne) => ({
      article_id: ligne.article_id, materiel_id: ligne.materiel_id, code: ligne.code, designation: ligne.designation,
      quantite: ligne.article_id ? String(ligne.quantite) : 1, symbole: ligne.symbole, decimales: ligne.decimales, statut: ligne.materiel_statut,
    }));
  } else {
    // Opération déduite du type demandé (lien d'une fiche : ?type=PERTE) ; sinon
    // « Nouveau mouvement » : transfert entre sites ou sortie.
    const typeDemande = parametres.get('type');
    const cle = operationDuType(typeDemande) ?? 'mouvement';
    choisirOperation(cle);
    document.getElementById('titre').textContent = OPERATIONS[cle].titre;
    document.title = `${OPERATIONS[cle].titre} — Gestion des matériels`;
    if (types.some((t) => t.code === typeDemande)) champ('type_code').value = typeDemande;
  }
  adapter();
  if (!idModifie && parametres.get('materiel')) {
    const { materiel } = await api(`/materiels/${Number(parametres.get('materiel'))}`);
    await ajouterMateriel(materiel.code);
  }
  if (!idModifie && parametres.get('article')) {
    const article = articles.find((a) => a.id === Number(parametres.get('article')));
    if (article) ajouterArticle(article);
  }
  if (lignes.length === 0) afficherLignes();
}

initialiser().catch((erreur) => afficherMessage(erreur.message));
