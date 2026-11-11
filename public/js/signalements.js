// Traitement des signalements : prise en charge, puis clôture avec la suite donnée.
import {
  afficherMessage, afficherPagination, api, creer, ecrireFiltresAdresse, formaterDateHeure, ligneVide, lireFiltresAdresse,
  ouvrirFormulaire,
} from './app.js';
import { aLeDroit, initialiserEntete } from './entete.js';
import { TYPES_SIGNALEMENT, badgeSignalement } from './signalements-communs.js';

const utilisateur = await initialiserEntete();
const filtres = document.getElementById('filtres');
const lignes = document.getElementById('lignes');
const initiaux = lireFiltresAdresse();
let page = Number(initiaux.page) || 1;
// Dans l'adresse : rien = à traiter, « tous » = tous les statuts.
const STATUTS = ['a_traiter', 'OUVERT', 'PRIS_EN_CHARGE', 'CLOS'];
filtres.elements.statut.value = initiaux.statut === 'tous' ? '' : STATUTS.includes(initiaux.statut) ? initiaux.statut : 'a_traiter';
document.getElementById('lien-parametres').hidden = !aLeDroit(utilisateur, 'parametres.gerer');

async function charger() {
  const statut = filtres.elements.statut.value;
  ecrireFiltresAdresse({ statut: statut === 'a_traiter' ? '' : statut || 'tous', page: page > 1 ? page : '' });
  const parametres = new URLSearchParams(Object.entries({ statut, page: page > 1 ? page : '' }).filter(([, valeur]) => valeur !== ''));
  const reponse = await api(`/signalements?${parametres}`);
  document.getElementById('desactive').hidden = reponse.actifs;
  lignes.replaceChildren(...(reponse.signalements.length ? reponse.signalements.map(ligne) : [ligneVide(7, 'Aucun signalement.')]));
  afficherPagination(document.getElementById('pagination'), reponse, (cible) => {
    page = cible;
    charger().catch((erreur) => afficherMessage(erreur.message));
  });
}

function ligne(s) {
  const actions = [];
  if (s.statut === 'OUVERT') {
    const prendre = creer('button', { type: 'button', className: 'bouton bouton-petit bouton-secondaire', textContent: 'Prendre en charge' });
    prendre.addEventListener('click', () => traiter(s, 'PRIS_EN_CHARGE').catch((erreur) => afficherMessage(erreur.message)));
    actions.push(prendre);
  }
  if (s.statut !== 'CLOS') {
    const clore = creer('button', { type: 'button', className: 'bouton bouton-petit', textContent: 'Clore' });
    clore.addEventListener('click', () => traiter(s, 'CLOS').catch((erreur) => afficherMessage(erreur.message)));
    actions.push(clore);
  }
  return creer('tr', {},
    creer('td', { textContent: formaterDateHeure(s.cree_le) }),
    creer('td', {}, creer('strong', {}, creer('a', { href: `/materiels/${s.materiel_id}`, textContent: s.code })),
      creer('div', { className: 'secondaire', textContent: s.designation })),
    creer('td', { textContent: s.employe ?? s.auteur }),
    creer('td', {}, creer('div', { textContent: TYPES_SIGNALEMENT[s.type] ?? s.type }),
      creer('div', { className: 'secondaire', textContent: s.description })),
    creer('td', {}, badgeSignalement(s.statut),
      s.traite_par && creer('div', { className: 'secondaire', textContent: `${s.traite_par}, ${formaterDateHeure(s.traite_le)}` })),
    creer('td', { textContent: s.reponse ?? '—' }),
    creer('td', {}, creer('div', { className: 'actions-ligne' }, ...actions)));
}

async function traiter(s, statut) {
  const clore = statut === 'CLOS';
  const resultat = await ouvrirFormulaire({
    titre: clore ? `Clore le signalement sur ${s.code}` : `Prendre en charge le signalement sur ${s.code}`,
    valeurs: { reponse: s.reponse ?? '' },
    champs: [{
      nom: 'reponse', libelle: clore ? 'Suite donnée' : 'Réponse à l’employé', type: 'zone', obligatoire: clore, max: 2000,
      aide: clore
        ? 'Par exemple : matériel réparé, remplacé, perte déclarée (mouvement MV-…). L’employé la voit dans « Mes matériels ».'
        : 'Facultatif. L’employé la voit dans « Mes matériels ».',
    }],
    libelle: clore ? 'Clore' : 'Prendre en charge',
    envoyer: (valeurs) => api(`/signalements/${s.id}`, { methode: 'PATCH', corps: { statut, reponse: valeurs.reponse } }),
  });
  if (!resultat) return;
  afficherMessage(clore ? 'Signalement clos.' : 'Signalement pris en charge.', 'succes');
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
filtres.elements.statut.addEventListener('change', recharger);

charger().catch((erreur) => afficherMessage(erreur.message));
