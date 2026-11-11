// « Mes matériels » : ce qui m'est affecté, et le signalement d'un problème
// quand l'administrateur a activé la fonction.
import {
  afficherMessage, api, badge, badgeEtat, creer, formaterDateCourte, formaterDateHeure, ligneVide, options, ouvrirFormulaire,
} from './app.js';
import { aLeDroit, initialiserEntete } from './entete.js';
import { TYPES_SIGNALEMENT, badgeSignalement } from './signalements-communs.js';

const utilisateur = await initialiserEntete();
const element = (nom) => document.getElementById(nom);

async function charger() {
  const donnees = await api('/mes-materiels');
  const signaler = donnees.signalements_actifs && aLeDroit(utilisateur, 'signalements.creer');
  element('non-rattache').hidden = donnees.rattache;
  if (signaler) {
    element('aide').textContent = 'Les matériels qui vous sont remis, avec la date à laquelle vous devez les rendre. '
      + 'Une panne, une perte ? Utilisez « Signaler » : le gestionnaire est prévenu.';
  }

  element('materiels').replaceChildren(...(donnees.materiels.length
    ? donnees.materiels.map((m) => {
      let action = '';
      if (signaler) {
        action = creer('button', { type: 'button', className: 'bouton bouton-petit bouton-secondaire', textContent: 'Signaler' });
        action.setAttribute('aria-label', `Signaler un problème sur ${m.code}`);
        action.addEventListener('click', () => signalerProbleme(m).catch((erreur) => afficherMessage(erreur.message)));
      }
      return creer('tr', {},
        creer('td', {}, creer('strong', { textContent: m.code }), creer('div', { textContent: m.designation }),
          m.numero_serie && creer('div', { className: 'secondaire', textContent: `N° de série ${m.numero_serie}` })),
        creer('td', { textContent: [m.marque, m.modele].filter(Boolean).join(' ') || '—' }),
        creer('td', { textContent: m.numero_contrat }),
        creer('td', {}, creer('div', { textContent: formaterDateCourte(m.date_remise) }), badgeEtat(m.etat)),
        creer('td', {}, creer('div', { textContent: formaterDateCourte(m.date_retour_prevue) }),
          m.en_retard && badge('Date dépassée', 'badge-danger')),
        creer('td', {}, action));
    })
    : [ligneVide(6, donnees.rattache ? 'Aucun matériel ne vous est affecté.' : '—')]));

  const section = element('section-signalements');
  section.hidden = !signaler && donnees.signalements.length === 0;
  element('signalements').replaceChildren(...(donnees.signalements.length
    ? donnees.signalements.map((s) => creer('tr', {},
      creer('td', { textContent: formaterDateHeure(s.cree_le) }),
      creer('td', {}, creer('strong', { textContent: s.code }), creer('div', { className: 'secondaire', textContent: s.designation })),
      creer('td', {}, creer('div', { textContent: TYPES_SIGNALEMENT[s.type] ?? s.type }),
        creer('div', { className: 'secondaire', textContent: s.description })),
      creer('td', {}, badgeSignalement(s.statut)),
      creer('td', { textContent: s.reponse ?? '—' })))
    : [ligneVide(5, 'Aucun signalement.')]));
}

async function signalerProbleme(m) {
  const resultat = await ouvrirFormulaire({
    titre: `Signaler un problème sur ${m.code}`,
    champs: [
      { nom: 'type', libelle: 'Objet', type: 'liste', obligatoire: true, vide: 'Choisir', options: options(TYPES_SIGNALEMENT) },
      { nom: 'description', libelle: 'Description', type: 'zone', obligatoire: true, max: 2000, aide: 'Ce qui se passe, depuis quand, où se trouve le matériel.' },
    ],
    libelle: 'Envoyer',
    envoyer: (valeurs) => api('/signalements', { methode: 'POST', corps: { ...valeurs, materiel_id: m.id } }),
  });
  if (!resultat) return;
  afficherMessage('Signalement envoyé au gestionnaire.', 'succes');
  await charger();
}

charger().catch((erreur) => {
  afficherMessage(erreur.message);
  element('materiels').replaceChildren(ligneVide(6, 'Chargement impossible.'));
});
