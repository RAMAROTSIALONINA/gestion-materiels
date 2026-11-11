// Écran Utilisateurs (administrateur) : liste, création, modification,
// mot de passe provisoire, déblocage.
import {
  afficherMessage, api, confirmer, creer, formaterDateHeure, montrerErreurFormulaire, ouvrirDialogue,
} from './app.js';
import { initialiserEntete } from './entete.js';

const moi = await initialiserEntete();
const lignes = document.getElementById('lignes');

const STATUTS = {
  ACTIF: ['Actif', 'badge-succes'],
  SUSPENDU: ['Suspendu', 'badge-attente'],
  DESACTIVE: ['Désactivé', 'badge-neutre'],
};

let roles = [];
let services = [];
let employes = [];
let utilisateurs = [];

async function charger() {
  const [reponseRoles, reponseServices, reponseEmployes, reponseUtilisateurs] = await Promise.all([
    api('/referentiels/roles'), api('/referentiels/services'), api('/referentiels/employes'), api('/utilisateurs'),
  ]);
  roles = reponseRoles.roles;
  services = reponseServices.services;
  employes = reponseEmployes.employes;
  utilisateurs = reponseUtilisateurs.utilisateurs;
  afficher();
}

function afficher() {
  if (utilisateurs.length === 0) {
    lignes.replaceChildren(creer('tr', {}, creer('td', { colSpan: 6, className: 'cellule-vide', textContent: 'Aucun compte.' })));
    return;
  }
  lignes.replaceChildren(...utilisateurs.map(ligne));
}

function boutonLigne(libelle, nomCompte, action) {
  const bouton = creer('button', { type: 'button', className: 'bouton bouton-petit bouton-secondaire', textContent: libelle });
  bouton.setAttribute('aria-label', `${libelle} : ${nomCompte}`);
  bouton.addEventListener('click', action);
  return bouton;
}

function ligne(compte) {
  const [libelleStatut, classeStatut] = STATUTS[compte.statut];
  const badges = creer('div', { className: 'badges' },
    creer('span', { className: `badge ${classeStatut}`, textContent: libelleStatut }),
    compte.bloque && creer('span', { className: 'badge badge-danger', textContent: 'Bloqué' }),
    compte.doit_changer_mot_de_passe && creer('span', { className: 'badge badge-info', textContent: 'Mot de passe provisoire' }));

  const actions = creer('div', { className: 'actions-ligne' },
    boutonLigne('Modifier', compte.nom, () => ouvrirFormulaire(compte)),
    compte.id !== moi.id && boutonLigne('Mot de passe provisoire', compte.nom, () => reinitialiser(compte)),
    compte.bloque && boutonLigne('Débloquer', compte.nom, () => debloquer(compte)));

  return creer('tr', {},
    creer('td', {},
      creer('strong', { textContent: compte.nom }),
      compte.id === moi.id && creer('span', { className: 'secondaire', textContent: ' (vous)' })),
    creer('td', {},
      creer('div', { textContent: compte.email }),
      compte.identifiant && creer('div', { className: 'secondaire', textContent: compte.identifiant })),
    creer('td', {},
      creer('div', { textContent: compte.role_libelle }),
      (compte.service || compte.employe) && creer('div', { className: 'secondaire', textContent: compte.service ?? compte.employe })),
    creer('td', {}, badges),
    creer('td', { textContent: formaterDateHeure(compte.derniere_connexion) }),
    creer('td', {}, actions));
}

function champ(libelle, controle, aide) {
  controle.id = `champ-${controle.name}`;
  const bloc = creer('div', { className: 'champ' }, creer('label', { htmlFor: controle.id, textContent: libelle }), controle);
  if (aide) {
    const texteAide = creer('p', { className: 'aide-champ', id: `${controle.id}-aide`, textContent: aide });
    controle.setAttribute('aria-describedby', texteAide.id);
    bloc.append(texteAide);
  }
  return bloc;
}

function liste(nom, options, valeur, premiereOption) {
  const select = creer('select', { name: nom });
  if (premiereOption) select.append(creer('option', { value: '', textContent: premiereOption }));
  for (const option of options) {
    select.append(creer('option', {
      value: String(option.valeur), textContent: option.libelle, selected: String(option.valeur) === String(valeur ?? ''),
    }));
  }
  return select;
}

function ouvrirFormulaire(compte = null) {
  const modification = compte !== null;
  const soiMeme = compte?.id === moi.id;
  const formulaire = creer('form', { id: 'formulaire-utilisateur', noValidate: true });
  const zoneErreur = creer('div', { className: 'erreur-formulaire', hidden: true });
  zoneErreur.setAttribute('role', 'alert');

  const nom = creer('input', { name: 'nom', value: compte?.nom ?? '', maxLength: 100, required: true, autocomplete: 'off' });
  const email = creer('input', { name: 'email', type: 'email', value: compte?.email ?? '', maxLength: 200, required: true, autocomplete: 'off' });
  const identifiant = creer('input', { name: 'identifiant', value: compte?.identifiant ?? '', maxLength: 40, autocomplete: 'off' });
  const role = liste('role_code', roles.map((r) => ({ valeur: r.code, libelle: r.libelle })), compte?.role_code ?? 'GESTIONNAIRE');
  const service = liste('service_id',
    services.filter((s) => s.actif || s.id === compte?.service_id).map((s) => ({ valeur: s.id, libelle: s.nom })),
    compte?.service_id, services.length ? 'Choisir un service' : 'Aucun service enregistré');
  const employe = liste('employe_id',
    employes.filter((e) => e.actif || e.id === compte?.employe_id)
      .map((e) => ({ valeur: e.id, libelle: `${e.matricule} — ${e.nom} ${e.prenoms ?? ''}`.trim() })),
    compte?.employe_id, employes.length ? 'Choisir un employé' : 'Aucune fiche employé enregistrée');
  const statut = modification
    ? liste('statut', Object.entries(STATUTS).map(([code, [libelle]]) => ({ valeur: code, libelle })), compte.statut)
    : null;
  if (soiMeme) {
    role.disabled = true;
    statut.disabled = true;
  }

  const blocService = champ('Service', service, 'Le responsable voit les biens de ce service.');
  const blocEmploye = champ('Fiche employé', employe, 'L’employé voit les matériels qui lui sont affectés.');
  const ajusterChamps = () => {
    blocService.hidden = role.value !== 'RESPONSABLE_SERVICE';
    blocEmploye.hidden = role.value !== 'EMPLOYE';
  };
  role.addEventListener('change', ajusterChamps);
  ajusterChamps();

  formulaire.append(...[
    zoneErreur,
    champ('Nom', nom),
    champ('Adresse e-mail', email),
    champ('Identifiant (facultatif)', identifiant, 'Permet de se connecter sans l’adresse e-mail.'),
    champ('Rôle', role, soiMeme ? 'Vous ne pouvez pas changer votre propre rôle.' : null),
    blocService,
    blocEmploye,
    statut && champ('Statut', statut, soiMeme
      ? 'Vous ne pouvez pas fermer votre propre compte.'
      : 'Un compte suspendu ou désactivé ne peut plus se connecter ; ses sessions sont fermées.'),
  ].filter(Boolean));

  const annuler = creer('button', { type: 'button', className: 'bouton bouton-secondaire', textContent: 'Annuler' });
  const valider = creer('button', { type: 'submit', className: 'bouton', textContent: modification ? 'Enregistrer' : 'Créer le compte' });
  valider.setAttribute('form', formulaire.id);
  const { fermer } = ouvrirDialogue({
    titre: modification ? `Modifier le compte : ${compte.nom}` : 'Nouvel utilisateur',
    contenu: formulaire,
    actions: [annuler, valider],
  });
  annuler.addEventListener('click', fermer);
  nom.focus();

  formulaire.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    zoneErreur.hidden = true;
    const corps = {
      nom: nom.value,
      email: email.value,
      identifiant: identifiant.value || null,
      role_code: role.value,
      service_id: role.value === 'RESPONSABLE_SERVICE' ? service.value || null : null,
      employe_id: role.value === 'EMPLOYE' ? employe.value || null : null,
    };
    if (modification) {
      corps.statut = statut.value;
      if (compte.statut === 'ACTIF' && statut.value !== 'ACTIF') {
        const accord = await confirmer({
          titre: 'Fermer ce compte ?',
          message: `${compte.nom} ne pourra plus se connecter, et ses sessions ouvertes seront fermées.`,
          libelle: statut.value === 'SUSPENDU' ? 'Suspendre' : 'Désactiver',
          danger: true,
        });
        if (!accord) return;
      }
    }

    valider.disabled = true;
    try {
      if (modification) {
        await api(`/utilisateurs/${compte.id}`, { methode: 'PATCH', corps });
        fermer();
        afficherMessage('Compte modifié.', 'succes');
      } else {
        const reponse = await api('/utilisateurs', { methode: 'POST', corps });
        fermer();
        montrerMotDePasse(reponse.utilisateur, reponse.mot_de_passe_provisoire, 'Compte créé');
      }
      await charger();
    } catch (erreur) {
      montrerErreurFormulaire(formulaire, zoneErreur, erreur);
    } finally {
      valider.disabled = false;
    }
  });
}

// Le mot de passe provisoire n'est montré qu'une fois.
function montrerMotDePasse(compte, motDePasse, titre) {
  const code = creer('code', { className: 'code-provisoire', textContent: motDePasse });
  const copier = creer('button', { type: 'button', className: 'bouton bouton-secondaire bouton-petit', textContent: 'Copier' });
  copier.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(motDePasse);
      copier.textContent = 'Copié';
    } catch {
      getSelection().selectAllChildren(code);
      afficherMessage('Copie automatique impossible : le mot de passe est sélectionné, copiez-le avec Ctrl+C.');
    }
  });
  const termine = creer('button', { type: 'button', className: 'bouton', textContent: 'J’ai noté le mot de passe' });
  const { fermer } = ouvrirDialogue({
    titre,
    contenu: creer('div', {},
      creer('p', { textContent: `Mot de passe provisoire pour ${compte.nom} :` }),
      creer('div', { className: 'ligne-code' }, code, copier),
      creer('p', {
        className: 'avertissement',
        textContent: `Transmettez-le en main propre. Il ne sera plus affiché ; ${compte.nom} devra le changer à sa première connexion.`,
      })),
    actions: [termine],
  });
  termine.addEventListener('click', fermer);
  termine.focus();
}

async function reinitialiser(compte) {
  const accord = await confirmer({
    titre: 'Nouveau mot de passe provisoire ?',
    message: `L’ancien mot de passe de ${compte.nom} ne fonctionnera plus, et ses sessions ouvertes seront fermées.`,
    libelle: 'Générer',
    danger: true,
  });
  if (!accord) return;
  try {
    const reponse = await api(`/utilisateurs/${compte.id}/mot-de-passe-provisoire`, { methode: 'POST' });
    montrerMotDePasse(reponse.utilisateur, reponse.mot_de_passe_provisoire, 'Mot de passe provisoire');
    await charger();
  } catch (erreur) {
    afficherMessage(erreur.message);
  }
}

async function debloquer(compte) {
  try {
    await api(`/utilisateurs/${compte.id}/debloquer`, { methode: 'POST' });
    afficherMessage(`Compte de ${compte.nom} débloqué.`, 'succes');
    await charger();
  } catch (erreur) {
    afficherMessage(erreur.message);
  }
}

document.getElementById('nouveau').addEventListener('click', () => ouvrirFormulaire());
charger().catch((erreur) => afficherMessage(erreur.message));
