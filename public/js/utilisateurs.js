// Écran Utilisateurs (administrateur) : liste, création, modification
// (mot de passe tapé par l'administrateur), déblocage.
import {
  afficherMessage, api, confirmer, creer, formaterDateHeure, montrerErreurFormulaire, ouvrirDialogue,
} from './app.js';
import { initialiserEntete } from './entete.js';
import { icone } from './icones.js';

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
    compte.doit_changer_mot_de_passe && creer('span', { className: 'badge badge-info', textContent: 'Mot de passe à changer' }));

  // Décision du 13/11 : plus de bouton « Mot de passe provisoire » ; un mot de
  // passe oublié se remplace dans « Modifier ».
  const actions = creer('div', { className: 'actions-ligne' },
    boutonLigne('Modifier', compte.nom, () => ouvrirFormulaire(compte)),
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

  // Décision du 13/11 : sous le rôle, l'administrateur tape le mot de passe ;
  // il est définitif. Obligatoire à la création (plus de mot de passe
  // provisoire) ; laissé vide à la modification, il reste inchangé. Pas pour
  // son propre compte (« Mon mot de passe » demande le mot de passe actuel).
  // Un œil dans le champ l'affiche ou le masque.
  let blocMotDePasse = null;
  const motDePasse = soiMeme ? null
    : creer('input', { name: 'mot_de_passe', type: 'password', maxLength: 200, autocomplete: 'new-password', required: !modification });
  if (motDePasse) {
    blocMotDePasse = champ(modification ? 'Nouveau mot de passe' : 'Mot de passe', motDePasse, modification
      ? '10 caractères au moins, sans l’identifiant ni l’adresse e-mail. La personne le gardera ; ses sessions ouvertes '
        + 'seront fermées. Laissez vide pour garder le mot de passe actuel.'
      : '10 caractères au moins, sans l’identifiant ni l’adresse e-mail. La personne le gardera.');
    const oeil = creer('button', { type: 'button', className: 'bouton-oeil' });
    oeil.setAttribute('aria-controls', motDePasse.id);
    const montrer = (visible) => {
      motDePasse.type = visible ? 'text' : 'password';
      oeil.replaceChildren(icone(visible ? 'oeil-barre' : 'oeil'));
      oeil.setAttribute('aria-pressed', String(visible));
      oeil.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      oeil.title = visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe';
    };
    montrer(false);
    oeil.addEventListener('click', () => montrer(motDePasse.type === 'password'));
    const ligne = creer('div', { className: 'saisie-mot-de-passe' });
    motDePasse.replaceWith(ligne);
    ligne.append(motDePasse, oeil);
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
    blocMotDePasse,
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
    if (motDePasse?.value) corps.mot_de_passe = motDePasse.value;
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
        afficherMessage(corps.mot_de_passe ? 'Compte modifié, avec le nouveau mot de passe.' : 'Compte modifié.', 'succes');
      } else {
        const reponse = await api('/utilisateurs', { methode: 'POST', corps });
        fermer();
        afficherMessage(`Compte créé pour ${reponse.utilisateur.nom}, avec le mot de passe que vous avez choisi.`, 'succes');
      }
      await charger();
    } catch (erreur) {
      montrerErreurFormulaire(formulaire, zoneErreur, erreur);
    } finally {
      valider.disabled = false;
    }
  });
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
