// Affectations : remise d'un matériel à un employé (code scanné), retour selon
// l'état constaté, prolongation du contrat.
import {
  LIBELLES_ETAT, afficherMessage, afficherPagination, api, badge, badgeEtat, creer, differer, ecrireFiltresAdresse,
  formaterDateCourte, ligneVide, lireFiltresAdresse, options, ouvrirFormulaire,
} from './app.js';
import { aLeDroit, initialiserEntete } from './entete.js';
import { aujourdhui } from './reception.js';

const utilisateur = await initialiserEntete();
const gestion = aLeDroit(utilisateur, 'affectations.gerer');
const filtres = document.getElementById('filtres');
const lignes = document.getElementById('lignes');
const initiaux = lireFiltresAdresse();
// Arrivée depuis la fiche d'un matériel : ?remettre=ID ou ?retour=ID d'affectation
// (lu avant que la liste ne réécrive l'adresse).
const demande = { remettre: Number(initiaux.remettre) || null, retour: Number(initiaux.retour) || null };
let page = Number(initiaux.page) || 1;
let employes = null;
let sites = null;

filtres.elements.q.value = initiaux.q ?? '';
filtres.elements.etat.value = ['en_cours', 'rendues', 'toutes'].includes(initiaux.etat) ? initiaux.etat : 'en_cours';
filtres.elements.retard.checked = initiaux.retard === 'oui';

async function listes() {
  if (!employes) {
    const [reponseEmployes, reponseSites] = await Promise.all([api('/referentiels/employes'), api('/referentiels/sites')]);
    employes = reponseEmployes.employes.filter((e) => e.actif);
    sites = reponseSites.sites.filter((s) => s.actif);
  }
}

async function charger() {
  const parametres = ecrireFiltresAdresse({
    q: filtres.elements.q.value.trim(),
    etat: filtres.elements.etat.value === 'en_cours' ? '' : filtres.elements.etat.value,
    retard: filtres.elements.retard.checked ? 'oui' : '',
    page: page > 1 ? page : '',
  });
  if (!parametres.has('etat')) parametres.set('etat', 'en_cours');
  const reponse = await api(`/affectations?${parametres}`);
  lignes.replaceChildren(...(reponse.affectations.length ? reponse.affectations.map(ligne) : [ligneVide(7, 'Aucune affectation ne correspond.')]));
  afficherPagination(document.getElementById('pagination'), reponse, (cible) => {
    page = cible;
    charger().catch((erreur) => afficherMessage(erreur.message));
  });
}

function ligne(a) {
  const actions = [];
  if (gestion && !a.date_retour) {
    const retour = creer('button', { type: 'button', className: 'bouton bouton-petit', textContent: 'Retour' });
    retour.addEventListener('click', () => enregistrerRetour(a).catch((erreur) => afficherMessage(erreur.message)));
    const prolonger = creer('button', { type: 'button', className: 'bouton bouton-petit bouton-secondaire', textContent: 'Prolonger' });
    prolonger.addEventListener('click', () => prolongerContrat(a).catch((erreur) => afficherMessage(erreur.message)));
    actions.push(retour, prolonger);
  }
  const retard = a.en_retard
    ? badge(`En retard de ${a.jours_de_retard} j`, 'badge-danger')
    : null;
  return creer('tr', {},
    creer('td', {}, creer('strong', {}, creer('a', { href: `/materiels/${a.materiel_id}`, textContent: a.code })),
      creer('div', { className: 'secondaire', textContent: a.designation })),
    creer('td', {}, creer('div', { textContent: a.employe }),
      creer('div', { className: 'secondaire', textContent: [a.matricule, a.service].filter(Boolean).join(' · ') })),
    creer('td', { textContent: a.numero_contrat }),
    creer('td', {}, creer('div', { textContent: formaterDateCourte(a.date_remise) }),
      creer('a', { className: 'secondaire', href: `/mouvements?q=${encodeURIComponent(a.reference_remise)}`, textContent: a.reference_remise })),
    creer('td', {}, creer('div', { textContent: formaterDateCourte(a.date_retour_prevue) }), retard),
    creer('td', {}, a.date_retour
      ? creer('div', {}, creer('div', { textContent: formaterDateCourte(a.date_retour) }), badgeEtat(a.etat_retour))
      : '—'),
    creer('td', {}, creer('div', { className: 'actions-ligne' }, ...actions)));
}

// Remise : le code est scanné (ou saisi), l'employé choisi, le contrat renseigné.
async function remettre(codeInitial = '') {
  await listes();
  const resultat = await ouvrirFormulaire({
    titre: 'Remettre un matériel',
    large: true,
    valeurs: { code: codeInitial, date_remise: aujourdhui() },
    champs: [
      { nom: 'code', libelle: 'Code du matériel', obligatoire: true, max: 40, aide: 'Scannez l’étiquette ou saisissez le code MAT-…', majuscules: true },
      {
        nom: 'employe_id', libelle: 'Employé', type: 'liste', obligatoire: true, vide: 'Choisir',
        options: employes.map((e) => ({ valeur: e.id, libelle: `${e.nom} ${e.prenoms ?? ''} (${e.matricule})`.replace(/\s+/g, ' ') })),
      },
      { nom: 'numero_contrat', libelle: 'N° de contrat', obligatoire: true, max: 60 },
      { nom: 'numero_ticket', libelle: 'N° de ticket', obligatoire: true, max: 60, aide: 'Justificatif de la remise.' },
      { nom: 'date_remise', libelle: 'Date de remise', type: 'date' },
      { nom: 'date_retour_prevue', libelle: 'Date de retour prévue', type: 'date', obligatoire: true },
      {
        nom: 'etat_remise', libelle: 'État à la remise', type: 'liste', vide: 'État actuel de la fiche',
        options: options({ NEUF: LIBELLES_ETAT.NEUF, BON: LIBELLES_ETAT.BON, MOYEN: LIBELLES_ETAT.MOYEN }),
      },
      { nom: 'observations_remise', libelle: 'Observations', type: 'zone', max: 1000 },
    ],
    libelle: 'Remettre',
    envoyer: async ({ code, ...valeurs }) => {
      let materiel;
      try {
        ({ materiel } = await api(`/materiels/par-code?code=${encodeURIComponent(code ?? '')}`));
      } catch (erreur) {
        erreur.champ = 'code';
        throw erreur;
      }
      return api('/affectations', { methode: 'POST', corps: { ...valeurs, materiel_id: materiel.id } });
    },
  });
  if (!resultat) return;
  const { affectation } = resultat;
  afficherMessage(`${affectation.code} remis à ${affectation.employe} (mouvement ${affectation.reference_remise}).`, 'succes');
  await charger();
}

async function enregistrerRetour(a) {
  await listes();
  const resultat = await ouvrirFormulaire({
    titre: `Retour de ${a.code}`,
    large: true,
    valeurs: { date_retour: aujourdhui() },
    champs: [
      { type: 'titre', libelle: `${a.designation} — rendu par ${a.employe}` },
      {
        nom: 'etat_retour', libelle: 'État constaté', type: 'liste', obligatoire: true, vide: 'Choisir', options: options(LIBELLES_ETAT),
        aide: 'Endommagé : le matériel part en réparation. Hors service : il est réformé. Sinon il redevient disponible.',
      },
      { nom: 'numero_ticket', libelle: 'N° de ticket', obligatoire: true, max: 60 },
      { nom: 'date_retour', libelle: 'Date de retour', type: 'date' },
      {
        nom: 'site_retour_id', libelle: 'Site de retour', type: 'liste', vide: `Son site actuel (${a.site})`,
        options: sites.map((s) => ({ valeur: s.id, libelle: s.nom })),
      },
      { nom: 'observations_retour', libelle: 'Observations', type: 'zone', max: 1000 },
    ],
    libelle: 'Enregistrer le retour',
    envoyer: (valeurs) => api(`/affectations/${a.id}/retour`, { methode: 'POST', corps: valeurs }),
  });
  if (!resultat) return;
  afficherMessage(`Retour de ${a.code} enregistré (mouvement ${resultat.affectation.reference_retour}).`, 'succes');
  await charger();
}

async function prolongerContrat(a) {
  const resultat = await ouvrirFormulaire({
    titre: `Prolonger le contrat ${a.numero_contrat}`,
    valeurs: { date_retour_prevue: a.date_retour_prevue },
    champs: [
      { nom: 'date_retour_prevue', libelle: 'Nouvelle date de retour prévue', type: 'date', obligatoire: true },
      { nom: 'numero_contrat', libelle: 'N° d’avenant ou de nouveau contrat', max: 60, aide: 'Facultatif.' },
      { nom: 'motif', libelle: 'Motif', type: 'zone', obligatoire: true, max: 300 },
    ],
    libelle: 'Prolonger',
    envoyer: (valeurs) => api(`/affectations/${a.id}/prolonger`, { methode: 'POST', corps: valeurs }),
  });
  if (!resultat) return;
  afficherMessage('Contrat prolongé.', 'succes');
  await charger();
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
filtres.elements.etat.addEventListener('change', recharger);
filtres.elements.retard.addEventListener('change', recharger);

if (gestion) {
  const bouton = document.getElementById('remettre');
  bouton.hidden = false;
  bouton.addEventListener('click', () => remettre().catch((erreur) => afficherMessage(erreur.message)));
}

await charger().catch((erreur) => afficherMessage(erreur.message));

if (gestion && demande.remettre) {
  api(`/materiels/${demande.remettre}`)
    .then(({ materiel }) => remettre(materiel.code))
    .catch((erreur) => afficherMessage(erreur.message));
}
if (gestion && demande.retour) {
  api(`/affectations/${demande.retour}`)
    .then(({ affectation }) => (affectation.date_retour
      ? afficherMessage(`Le retour de ${affectation.code} est déjà enregistré.`)
      : enregistrerRetour(affectation)))
    .catch((erreur) => afficherMessage(erreur.message));
}
