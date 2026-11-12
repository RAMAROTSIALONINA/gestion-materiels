// Liste des mouvements : recherche, filtres, brouillons à autoriser.
import {
  afficherMessage, afficherPagination, api, badgesMouvement, creer, differer, ecrireFiltresAdresse,
  formaterDateCourte, ligneVide, lireFiltresAdresse,
} from './app.js';
import { aLeDroit, initialiserEntete } from './entete.js';

const utilisateur = await initialiserEntete();
const filtres = document.getElementById('filtres');
const lignes = document.getElementById('lignes');
const initiaux = lireFiltresAdresse();
let page = Number(initiaux.page) || 1;

if (aLeDroit(utilisateur, 'mouvements.saisir')) {
  document.getElementById('nouveau').hidden = false;
  document.getElementById('case-autoriser').hidden = false;
}

async function preparer() {
  const { types } = await api('/referentiels/types-mouvements');
  for (const type of types) filtres.elements.type_code.append(creer('option', { value: type.code, textContent: type.libelle }));
  for (const nom of ['q', 'type_code', 'statut', 'date_debut', 'date_fin']) filtres.elements[nom].value = initiaux[nom] ?? '';
  filtres.elements.en_route.checked = initiaux.en_route === 'oui';
  filtres.elements.a_autoriser.checked = initiaux.a_autoriser === 'oui';
}

async function charger() {
  const parametres = ecrireFiltresAdresse({
    q: filtres.elements.q.value.trim(),
    type_code: filtres.elements.type_code.value,
    statut: filtres.elements.statut.value,
    date_debut: filtres.elements.date_debut.value,
    date_fin: filtres.elements.date_fin.value,
    en_route: filtres.elements.en_route.checked ? 'oui' : '',
    a_autoriser: filtres.elements.a_autoriser.checked ? 'oui' : '',
    page: page > 1 ? page : '',
  });
  const reponse = await api(`/mouvements?${parametres}`);
  lignes.replaceChildren(...(reponse.mouvements.length ? reponse.mouvements.map(ligne) : [ligneVide(6, 'Aucun mouvement ne correspond.')]));
  afficherPagination(document.getElementById('pagination'), reponse, (cible) => {
    page = cible;
    charger().catch((erreur) => afficherMessage(erreur.message));
  });
}

// Six colonnes : la référence porte sa date et son ticket, les lieux portent le bénéficiaire.
function ligne(m) {
  const autres = m.nb_lignes > 1 ? ` + ${m.nb_lignes - 1} autre${m.nb_lignes > 2 ? 's' : ''}` : '';
  const lieux = [m.site_origine, m.site_destination].filter(Boolean).join(' → ');
  return creer('tr', {},
    creer('td', {}, creer('strong', {}, creer('a', { href: `/mouvements/${m.id}`, textContent: m.reference })),
      creer('div', { className: 'secondaire', textContent: [formaterDateCourte(m.date_mouvement), m.numero_ticket && `Ticket ${m.numero_ticket}`].filter(Boolean).join(' · ') })),
    creer('td', { textContent: m.type }),
    creer('td', { className: 'cellule-principale' }, creer('div', { textContent: `${m.premiere_ligne ?? '—'}${autres}` }),
      m.motif && creer('div', { className: 'secondaire', textContent: m.motif })),
    creer('td', {}, creer('div', { textContent: lieux || '—' }),
      m.beneficiaire && creer('div', { className: 'secondaire', textContent: `Pour ${m.beneficiaire}` })),
    creer('td', {}, badgesMouvement(m)),
    creer('td', { className: 'secondaire', textContent: m.cree_par_nom }));
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
for (const nom of ['type_code', 'statut', 'date_debut', 'date_fin', 'en_route', 'a_autoriser']) {
  filtres.elements[nom].addEventListener('change', recharger);
}

await preparer().catch((erreur) => afficherMessage(erreur.message));
charger().catch((erreur) => afficherMessage(erreur.message));
