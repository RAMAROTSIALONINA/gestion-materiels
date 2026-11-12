// Outils communs à toutes les pages : appels à l'API, messages, dialogues.
// Jamais de alert() ni de confirm() : tout passe par des éléments de la page.

export class ErreurServeur extends Error {
  constructor(statut, code, message, donnees) {
    super(message);
    this.statut = statut;
    this.code = code;
    this.donnees = donnees;
    this.champ = donnees?.erreur?.champ ?? null;
  }
}

// Adresse de retour après connexion : seulement un chemin de l'application.
export function retourSur(defaut = '/') {
  const retour = new URLSearchParams(window.location.search).get('retour');
  return retour && retour.startsWith('/') && !retour.startsWith('//') && !retour.startsWith('/\\') ? retour : defaut;
}

// Appel à l'API : renvoie le JSON, ou lève une ErreurServeur avec le message
// rédigé par le serveur. Session expirée → page de connexion.
export async function api(chemin, { methode = 'GET', corps } = {}) {
  let reponse;
  try {
    reponse = await fetch(`/api${chemin}`, {
      method: methode,
      headers: corps === undefined ? {} : { 'Content-Type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      credentials: 'same-origin',
    });
  } catch {
    throw new ErreurServeur(0, 'RESEAU', 'Le serveur ne répond pas. Vérifiez la connexion puis réessayez.');
  }
  const donnees = await reponse.json().catch(() => null);
  if (reponse.ok) return donnees;

  const erreur = donnees?.erreur;
  if (erreur?.code === 'NON_CONNECTE') {
    window.location.assign(`/connexion?retour=${encodeURIComponent(window.location.pathname)}`);
  } else if (erreur?.code === 'MOT_DE_PASSE_A_CHANGER' && window.location.pathname !== '/mot-de-passe') {
    window.location.assign('/mot-de-passe');
  }
  throw new ErreurServeur(reponse.status, erreur?.code ?? 'INCONNUE', erreur?.message ?? `Erreur ${reponse.status}.`, donnees);
}

// Téléchargement d'un fichier (export CSV ou PDF) : une erreur (trop de lignes,
// droit manquant…) s'affiche dans la bannière au lieu d'ouvrir une page brute.
// Rend le nom du fichier enregistré.
export async function telecharger(chemin) {
  let reponse;
  try {
    reponse = await fetch(`/api${chemin}`, { credentials: 'same-origin' });
  } catch {
    throw new ErreurServeur(0, 'RESEAU', 'Le serveur ne répond pas. Vérifiez la connexion puis réessayez.');
  }
  if (!reponse.ok) {
    const donnees = await reponse.json().catch(() => null);
    throw new ErreurServeur(reponse.status, donnees?.erreur?.code ?? 'INCONNUE', donnees?.erreur?.message ?? `Erreur ${reponse.status}.`, donnees);
  }
  const fichier = await reponse.blob();
  const entete = reponse.headers.get('content-disposition') ?? '';
  const nom = decodeURIComponent(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(entete)?.[1] ?? 'export');
  const adresse = URL.createObjectURL(fichier);
  const lien = Object.assign(document.createElement('a'), { href: adresse, download: nom, hidden: true });
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(adresse), 60000);
  return nom;
}

// Bannière en haut à droite ; un succès disparaît seul, une erreur reste
// jusqu'à ce qu'on la ferme.
export function afficherMessage(texte, type = 'erreur') {
  const zone = document.getElementById('messages');
  if (!zone) return;
  const message = document.createElement('div');
  message.className = `message message-${type}`;
  message.setAttribute('role', type === 'erreur' ? 'alert' : 'status');

  const contenu = document.createElement('span');
  contenu.className = 'message-texte';
  contenu.textContent = texte;

  const fermer = document.createElement('button');
  fermer.type = 'button';
  fermer.className = 'message-fermer';
  fermer.setAttribute('aria-label', 'Fermer le message');
  fermer.textContent = '×';
  fermer.addEventListener('click', () => message.remove());

  message.append(contenu, fermer);
  zone.append(message);
  if (type === 'succes') setTimeout(() => message.remove(), 5000);
}

// Création rapide d'un élément : creer('p', { className: 'aide' }, 'texte', autreElement)
export function creer(balise, proprietes = {}, ...enfants) {
  const element = Object.assign(document.createElement(balise), proprietes);
  element.append(...enfants.filter((enfant) => enfant !== null && enfant !== undefined && enfant !== false));
  return element;
}

// Dialogue modal de l'application. Rend { dialogue, fermer }.
export function ouvrirDialogue({ titre, contenu, actions = [], large = false }) {
  const dialogue = creer('dialog', { className: `dialogue${large ? ' dialogue-large' : ''}` });
  const idTitre = `titre-${Math.random().toString(36).slice(2)}`;
  dialogue.setAttribute('aria-labelledby', idTitre);
  const pied = creer('div', { className: 'dialogue-actions' }, ...actions);
  dialogue.append(creer('h2', { id: idTitre }, titre), contenu, pied);
  document.body.append(dialogue);
  const fermer = () => {
    dialogue.close();
    dialogue.remove();
  };
  dialogue.addEventListener('cancel', (evenement) => {
    evenement.preventDefault();
    fermer();
  });
  dialogue.showModal();
  return { dialogue, fermer };
}

// Confirmation avant une opération sensible. Rend true si l'on confirme.
export function confirmer({ titre, message, libelle = 'Confirmer', danger = false }) {
  return new Promise((resoudre) => {
    const annuler = creer('button', { type: 'button', className: 'bouton bouton-secondaire', textContent: 'Annuler' });
    const valider = creer('button', { type: 'button', className: `bouton${danger ? ' bouton-danger' : ''}`, textContent: libelle });
    const { dialogue, fermer } = ouvrirDialogue({ titre, contenu: creer('p', {}, message), actions: [annuler, valider] });
    const terminer = (reponse) => {
      fermer();
      resoudre(reponse);
    };
    annuler.addEventListener('click', () => terminer(false));
    valider.addEventListener('click', () => terminer(true));
    dialogue.addEventListener('cancel', () => resoudre(false));
    valider.focus();
  });
}

// Erreur de formulaire : message dans la zone prévue et champ en cause signalé.
export function montrerErreurFormulaire(formulaire, zone, erreur) {
  formulaire.querySelectorAll('[aria-invalid="true"]').forEach((champ) => champ.removeAttribute('aria-invalid'));
  zone.textContent = erreur.message;
  zone.hidden = false;
  const champ = erreur.champ ? formulaire.elements.namedItem(erreur.champ) : null;
  if (champ) {
    champ.setAttribute('aria-invalid', 'true');
    champ.focus();
  }
}

// Date de gestion « AAAA-MM-JJ » → « mercredi 11 novembre 2026 ».
export function formaterDate(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`));
}

// Horodatage → « 11/11/2026 10:42 ».
export function formaterDateHeure(horodatage) {
  if (!horodatage) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(horodatage));
}

// Date de gestion « AAAA-MM-JJ » → « 11/11/2026 ».
export function formaterDateCourte(date) {
  if (!date) return '—';
  const [annee, mois, jour] = String(date).split('-');
  return `${jour}/${mois}/${annee}`;
}

export function formaterNombre(valeur, decimales = 3) {
  if (valeur === null || valeur === undefined) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimales }).format(valeur);
}

export function formaterMontant(valeur) {
  if (valeur === null || valeur === undefined) return '—';
  return `${new Intl.NumberFormat('fr-FR').format(valeur)} Ar`;
}

// ---------------------------------------------------------------------------
// États et statuts des matériels
// ---------------------------------------------------------------------------
export const LIBELLES_ETAT = {
  NEUF: 'Neuf', BON: 'Bon', MOYEN: 'Moyen', ENDOMMAGE: 'Endommagé', HORS_SERVICE: 'Hors service',
};
export const LIBELLES_STATUT = {
  DISPONIBLE: 'Disponible', AFFECTE: 'Affecté', EN_REPARATION: 'En réparation',
  EN_TRANSIT: 'En transit', PERDU: 'Perdu', REFORME: 'Réformé',
};
const CLASSES_ETAT = {
  NEUF: 'badge-succes', BON: 'badge-succes', MOYEN: 'badge-neutre', ENDOMMAGE: 'badge-attente', HORS_SERVICE: 'badge-danger',
};
const CLASSES_STATUT = {
  DISPONIBLE: 'badge-succes', AFFECTE: 'badge-info', EN_REPARATION: 'badge-attente',
  EN_TRANSIT: 'badge-info', PERDU: 'badge-danger', REFORME: 'badge-neutre',
};

export const badge = (texte, classe = 'badge-neutre') => creer('span', { className: `badge ${classe}`, textContent: texte });

// Statut d'un mouvement, avec l'état du transfert et l'autorisation attendue.
export function badgesMouvement({ statut, etat_transfert: transfert, autorisation_requise: autorisation }) {
  const principal = { BROUILLON: ['Brouillon', 'badge-neutre'], VALIDE: ['Validé', 'badge-succes'], ANNULE: ['Annulé', 'badge-danger'] }[statut];
  return creer('div', { className: 'badges' },
    badge(...principal),
    transfert === 'EN_ROUTE' && badge('En route', 'badge-info'),
    transfert === 'RECU' && badge('Reçu', 'badge-succes'),
    statut === 'BROUILLON' && autorisation && badge('À autoriser', 'badge-attente'));
}
export const badgeEtat = (etat) => (etat ? badge(LIBELLES_ETAT[etat] ?? etat, CLASSES_ETAT[etat]) : '—');
export const badgeStatut = (statut) => (statut ? badge(LIBELLES_STATUT[statut] ?? statut, CLASSES_STATUT[statut]) : '—');
export const options = (objet) => Object.entries(objet).map(([valeur, libelle]) => ({ valeur, libelle }));

// ---------------------------------------------------------------------------
// Formulaires
// ---------------------------------------------------------------------------
let compteur = 0;

export function champ(libelle, controle, aide) {
  controle.id ||= `champ-${controle.name.replace(/\W/g, '-')}-${++compteur}`;
  const bloc = creer('div', { className: 'champ' }, creer('label', { htmlFor: controle.id, textContent: libelle }), controle);
  if (aide) {
    const texteAide = creer('p', { className: 'aide-champ', id: `${controle.id}-aide`, textContent: aide });
    controle.setAttribute('aria-describedby', texteAide.id);
    bloc.append(texteAide);
  }
  return bloc;
}

export function liste(nom, choix, valeur, premiereOption) {
  const select = creer('select', { name: nom });
  if (premiereOption !== undefined) select.append(creer('option', { value: '', textContent: premiereOption }));
  for (const option of choix) {
    select.append(creer('option', {
      value: String(option.valeur), textContent: option.libelle, selected: String(option.valeur) === String(valeur ?? ''),
    }));
  }
  return select;
}

function creerControle(definition, valeur) {
  const initiale = valeur ?? definition.defaut ?? '';
  let controle;
  switch (definition.type) {
    case 'liste':
      controle = liste(definition.nom, definition.options ?? [], initiale, definition.vide);
      break;
    case 'zone':
      controle = creer('textarea', { name: definition.nom, rows: 3, value: initiale, maxLength: definition.max ?? 1000 });
      break;
    case 'case':
      controle = creer('input', { type: 'checkbox', name: definition.nom, checked: Boolean(valeur ?? definition.defaut) });
      break;
    case 'date':
      controle = creer('input', { type: 'date', name: definition.nom, value: initiale });
      break;
    default:
      controle = creer('input', {
        type: definition.type === 'email' ? 'email' : 'text',
        name: definition.nom,
        value: String(initiale),
        maxLength: definition.max ?? 200,
        autocomplete: 'off',
      });
      if (definition.type === 'nombre') controle.inputMode = definition.entier ? 'numeric' : 'decimal';
  }
  if (definition.desactive) controle.disabled = true;
  if (definition.majuscules) {
    controle.classList.add('majuscules');
    controle.addEventListener('input', () => { controle.value = controle.value.toUpperCase(); });
  }
  return controle;
}

// Formulaire dans un dialogue. champs : [{ nom, libelle, type, options, vide,
// obligatoire, aide, max, defaut, desactive, majuscules, visible(valeurs) }],
// ou { type: 'titre', libelle } pour un intertitre. « envoyer » reçoit les
// valeurs saisies ; une erreur du serveur s'affiche dans le formulaire.
// Rend le résultat de « envoyer », ou null si l'on annule.
export function ouvrirFormulaire({ titre, champs, valeurs = {}, libelle = 'Enregistrer', envoyer, large = false }) {
  return new Promise((resoudre) => {
    const formulaire = creer('form', { id: `formulaire-${++compteur}`, noValidate: true });
    const zoneErreur = creer('div', { className: 'erreur-formulaire', hidden: true });
    zoneErreur.setAttribute('role', 'alert');
    formulaire.append(zoneErreur);

    const elements = champs.map((definition) => {
      if (definition.type === 'titre') {
        const intertitre = creer('h3', { className: 'sous-titre', textContent: definition.libelle });
        formulaire.append(intertitre);
        return { definition, bloc: intertitre };
      }
      const controle = creerControle(definition, valeurs[definition.nom]);
      const bloc = definition.type === 'case'
        ? creer('div', { className: 'champ' },
          creer('label', { className: 'case' }, controle, ` ${definition.libelle}`),
          definition.aide && creer('p', { className: 'aide-champ', textContent: definition.aide }))
        : champ(`${definition.libelle}${definition.obligatoire ? ' *' : ''}`, controle, definition.aide);
      formulaire.append(bloc);
      return { definition, bloc, controle };
    });

    const lire = ({ visiblesSeulement }) => Object.fromEntries(elements
      .filter(({ controle, bloc }) => controle && !(visiblesSeulement && bloc.hidden))
      .map(({ definition, controle }) => [definition.nom,
        definition.type === 'case' ? controle.checked : (controle.value.trim() === '' ? null : controle.value.trim())]));
    const ajuster = () => {
      const courantes = lire({ visiblesSeulement: false });
      for (const { definition, bloc } of elements) {
        if (definition.visible) bloc.hidden = !definition.visible(courantes);
      }
    };
    formulaire.addEventListener('change', ajuster);
    ajuster();

    const annuler = creer('button', { type: 'button', className: 'bouton bouton-secondaire', textContent: 'Annuler' });
    const valider = creer('button', { type: 'submit', className: 'bouton', textContent: libelle });
    valider.setAttribute('form', formulaire.id);
    const { dialogue, fermer } = ouvrirDialogue({ titre, contenu: formulaire, actions: [annuler, valider], large });
    let termine = false;
    const finir = (resultat) => {
      if (termine) return;
      termine = true;
      fermer();
      resoudre(resultat);
    };
    annuler.addEventListener('click', () => finir(null));
    dialogue.addEventListener('cancel', () => finir(null));

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      zoneErreur.hidden = true;
      valider.disabled = true;
      try {
        finir((await envoyer(lire({ visiblesSeulement: true }))) ?? true);
      } catch (erreur) {
        montrerErreurFormulaire(formulaire, zoneErreur, erreur);
      } finally {
        valider.disabled = false;
      }
    });
    elements.find(({ controle }) => controle && !controle.disabled)?.controle.focus();
  });
}

// ---------------------------------------------------------------------------
// Listes : pagination, recherche, filtres gardés dans l'adresse
// ---------------------------------------------------------------------------
export function afficherPagination(conteneur, { page, par_page: parPage, total }, aller) {
  const debut = total === 0 ? 0 : (page - 1) * parPage + 1;
  const fin = Math.min(total, page * parPage);
  const bouton = (texte, cible, actif) => {
    const element = creer('button', { type: 'button', className: 'bouton bouton-secondaire bouton-petit', textContent: texte, disabled: !actif });
    element.addEventListener('click', () => aller(cible));
    return element;
  };
  conteneur.replaceChildren(
    creer('span', { className: 'secondaire', textContent: total ? `${debut}–${fin} sur ${total}` : 'Aucun résultat' }),
    creer('div', { className: 'pagination-boutons' },
      bouton('‹ Précédent', page - 1, page > 1),
      bouton('Suivant ›', page + 1, fin < total)),
  );
}

export function differer(fonction, delai = 300) {
  let minuterie;
  return (...parametres) => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => fonction(...parametres), delai);
  };
}

export function lireFiltresAdresse() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

export function ecrireFiltresAdresse(filtres) {
  const parametres = new URLSearchParams(Object.entries(filtres).filter(([, valeur]) => valeur !== '' && valeur !== null && valeur !== undefined));
  const adresse = `${window.location.pathname}${parametres.size ? `?${parametres}` : ''}`;
  window.history.replaceState(null, '', adresse);
  return parametres;
}

// Ligne vide d'un tableau (« Aucun matériel. »).
export function ligneVide(colonnes, texte) {
  return creer('tr', {}, creer('td', { colSpan: colonnes, className: 'cellule-vide', textContent: texte }));
}

// Liste de définitions (fiche) : [[libellé, valeur ou élément], …]
export function definitions(paires) {
  const liste_ = creer('dl', { className: 'liste-etat' });
  for (const [libelleDef, valeur] of paires) {
    liste_.append(creer('dt', { textContent: libelleDef }),
      creer('dd', {}, valeur === null || valeur === undefined || valeur === '' ? '—' : valeur));
  }
  return liste_;
}
