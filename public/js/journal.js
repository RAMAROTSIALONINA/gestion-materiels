// Journal des opérations (administrateur) : lecture seule, filtres par date,
// personne, opération et texte des détails.
import {
  LIBELLES_ETAT, LIBELLES_STATUT, afficherMessage, afficherPagination, api, creer, differer, ecrireFiltresAdresse,
  formaterDateHeure, ligneVide, lireFiltresAdresse,
} from './app.js';
import { initialiserEntete } from './entete.js';

await initialiserEntete();
const filtres = document.getElementById('filtres');
const lignes = document.getElementById('lignes');
const initiaux = lireFiltresAdresse();
let page = Number(initiaux.page) || 1;
let listesPretes = false;

const ACTIONS = {
  CONNEXION: 'Connexion', CONNEXION_ECHEC: 'Échec de connexion', CONNEXION_REFUSEE: 'Connexion refusée', DECONNEXION: 'Déconnexion',
  MOT_DE_PASSE_CHANGE: 'Mot de passe changé', MOT_DE_PASSE_REINITIALISE: 'Mot de passe provisoire', COMPTE_DEBLOQUE: 'Compte débloqué',
  ADMINISTRATEUR_CREE: 'Administrateur créé', UTILISATEUR_CREE: 'Compte créé', UTILISATEUR_MODIFIE: 'Compte modifié',
  REFERENTIEL_CREE: 'Référentiel créé', REFERENTIEL_MODIFIE: 'Référentiel modifié', PARAMETRE_MODIFIE: 'Paramètre modifié',
  EMPLOYE_CREE: 'Employé créé', EMPLOYE_MODIFIE: 'Employé modifié',
  MATERIEL_CREE: 'Matériel créé', MATERIEL_MODIFIE: 'Matériel modifié', MATERIEL_ETAT: 'Changement d’état', IMPRESSION_ETIQUETTE: 'Étiquettes imprimées',
  ARTICLE_CREE: 'Article créé', ARTICLE_MODIFIE: 'Article modifié', SEUIL_SITE_MODIFIE: 'Seuil de site fixé', SEUIL_SITE_RETIRE: 'Seuil de site retiré',
  MOUVEMENT_CREE: 'Mouvement en brouillon', MOUVEMENT_MODIFIE: 'Brouillon modifié', MOUVEMENT_VALIDE: 'Mouvement validé',
  MOUVEMENT_ANNULE: 'Mouvement annulé', MOUVEMENT_INVERSE_CREE: 'Mouvement inverse', TRANSFERT_RECU: 'Transfert reçu',
  MATERIEL_REMIS: 'Matériel remis', MATERIEL_RENDU: 'Matériel rendu', PROLONGATION: 'Contrat prolongé',
  SIGNALEMENT_CREE: 'Signalement', SIGNALEMENT_TRAITE: 'Signalement traité',
};
// Lien vers l'élément concerné, quand un écran l'affiche.
const PAGES = { materiels: '/materiels/', articles: '/articles/', mouvements: '/mouvements/' };
const ENTITES = {
  materiels: 'Matériel', articles: 'Article', mouvements: 'Mouvement', affectations: 'Affectation', employes: 'Employé',
  utilisateurs: 'Compte', sites: 'Site', services: 'Service', categories: 'Catégorie', parametres: 'Paramètre', signalements: 'Signalement',
};

// Détails : « clé : valeur » lisibles ; un changement { avant, apres } devient « avant → après ».
const lisible = (valeur) => LIBELLES_ETAT[valeur] ?? LIBELLES_STATUT[valeur] ?? valeur ?? '—';
function details(metadonnees) {
  const morceaux = Object.entries(metadonnees ?? {}).map(([cle, valeur]) => {
    let texte;
    if (valeur && typeof valeur === 'object' && 'apres' in valeur) texte = `${lisible(valeur.avant)} → ${lisible(valeur.apres)}`;
    else if (valeur && typeof valeur === 'object') texte = JSON.stringify(valeur);
    else texte = String(valeur);
    return `${cle.replaceAll('_', ' ')} : ${texte}`;
  });
  return morceaux.join(' · ') || '—';
}

function ligne(j) {
  const entite = j.entite ? `${ENTITES[j.entite] ?? j.entite}${j.entite_id ? ` n° ${j.entite_id}` : ''}` : '—';
  return creer('tr', {},
    creer('td', { textContent: formaterDateHeure(j.date_action) }),
    creer('td', { textContent: j.utilisateur ?? '—' }),
    creer('td', {}, creer('strong', { textContent: ACTIONS[j.action] ?? j.action })),
    creer('td', {}, PAGES[j.entite] && j.entite_id ? creer('a', { href: `${PAGES[j.entite]}${j.entite_id}`, textContent: entite }) : entite),
    creer('td', {}, creer('div', { className: 'details-journal', textContent: details(j.metadonnees) })),
    creer('td', { className: 'secondaire', textContent: j.adresse_ip ?? '—' }));
}

async function charger() {
  const parametres = ecrireFiltresAdresse({
    q: filtres.elements.q.value.trim(),
    action: filtres.elements.action.value || (listesPretes ? '' : initiaux.action ?? ''),
    utilisateur_id: filtres.elements.utilisateur_id.value || (listesPretes ? '' : initiaux.utilisateur_id ?? ''),
    date_debut: filtres.elements.date_debut.value,
    date_fin: filtres.elements.date_fin.value,
    page: page > 1 ? page : '',
  });
  const reponse = await api(`/journal?${parametres}`);
  if (!listesPretes) {
    // Listes des filtres remplies au premier chargement, avec les valeurs de l'adresse.
    for (const action of reponse.actions) filtres.elements.action.append(creer('option', { value: action, textContent: ACTIONS[action] ?? action }));
    for (const personne of reponse.utilisateurs) filtres.elements.utilisateur_id.append(creer('option', { value: String(personne.id), textContent: personne.nom }));
    filtres.elements.action.value = initiaux.action ?? '';
    filtres.elements.utilisateur_id.value = initiaux.utilisateur_id ?? '';
    listesPretes = true;
  }
  lignes.replaceChildren(...(reponse.journal.length ? reponse.journal.map(ligne) : [ligneVide(6, 'Aucune opération ne correspond.')]));
  afficherPagination(document.getElementById('pagination'), reponse, (cible) => {
    page = cible;
    charger().catch((erreur) => afficherMessage(erreur.message));
  });
}

for (const nom of ['q', 'date_debut', 'date_fin']) filtres.elements[nom].value = initiaux[nom] ?? '';
const recharger = () => {
  page = 1;
  charger().catch((erreur) => afficherMessage(erreur.message));
};
filtres.addEventListener('submit', (evenement) => {
  evenement.preventDefault();
  recharger();
});
filtres.elements.q.addEventListener('input', differer(recharger));
for (const nom of ['action', 'utilisateur_id', 'date_debut', 'date_fin']) filtres.elements[nom].addEventListener('change', recharger);

charger().catch((erreur) => afficherMessage(erreur.message));
