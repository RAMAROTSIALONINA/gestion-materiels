// Historique des états de tout le parc (cahier § 3.7) : qui a changé quoi,
// quand, et pourquoi. Le responsable de service voit son service.
import {
  LIBELLES_ETAT, LIBELLES_STATUT, afficherMessage, afficherPagination, api, badgeEtat, badgeStatut, creer, differer,
  ecrireFiltresAdresse, formaterDateHeure, ligneVide, lireFiltresAdresse,
} from './app.js';
import { initialiserEntete } from './entete.js';

const utilisateur = await initialiserEntete();
const filtres = document.getElementById('filtres');
const lignes = document.getElementById('lignes');
const initiaux = lireFiltresAdresse();
let page = Number(initiaux.page) || 1;
// Lien venu d'une fiche : ?materiel_id=… (gardé tel quel, sans champ à l'écran).
const materielId = Number(initiaux.materiel_id) || null;

if (utilisateur.role === 'RESPONSABLE_SERVICE') {
  document.getElementById('aide').textContent = 'Chaque changement d’état ou de statut des matériels de votre service, daté et signé, avec son commentaire.';
}

async function preparer() {
  for (const [valeur, libelle] of Object.entries(LIBELLES_ETAT)) filtres.elements.etat.append(creer('option', { value: valeur, textContent: libelle }));
  for (const [valeur, libelle] of Object.entries(LIBELLES_STATUT)) filtres.elements.statut.append(creer('option', { value: valeur, textContent: libelle }));
  const { sites } = await api('/referentiels/sites');
  for (const site of sites) filtres.elements.site_id.append(creer('option', { value: String(site.id), textContent: site.nom }));
  for (const nom of ['q', 'etat', 'statut', 'site_id', 'date_debut', 'date_fin']) filtres.elements[nom].value = initiaux[nom] ?? '';
  filtres.elements.changements.checked = initiaux.changements === 'oui';
}

// « Neuf → Endommagé » ; une création de fiche n'a pas d'ancienne valeur.
const changement = (ancien, nouveau, pastille) => (ancien && ancien !== nouveau
  ? creer('span', { className: 'changement' }, pastille(ancien), '→', pastille(nouveau))
  : pastille(nouveau));

function ligne(h) {
  return creer('tr', {},
    creer('td', { textContent: formaterDateHeure(h.date_changement) }),
    creer('td', {}, creer('strong', {}, creer('a', { href: `/materiels/${h.materiel_id}`, textContent: h.code })),
      creer('div', { className: 'secondaire', textContent: `${h.designation} · ${h.site}` })),
    creer('td', {}, changement(h.ancien_etat, h.nouvel_etat, badgeEtat)),
    creer('td', {}, changement(h.ancien_statut, h.nouveau_statut, badgeStatut)),
    creer('td', { textContent: h.commentaire ?? '—' }),
    creer('td', { textContent: h.auteur }));
}

async function charger() {
  const parametres = ecrireFiltresAdresse({
    q: filtres.elements.q.value.trim(),
    etat: filtres.elements.etat.value,
    statut: filtres.elements.statut.value,
    site_id: filtres.elements.site_id.value,
    date_debut: filtres.elements.date_debut.value,
    date_fin: filtres.elements.date_fin.value,
    changements: filtres.elements.changements.checked ? 'oui' : '',
    materiel_id: materielId ?? '',
    page: page > 1 ? page : '',
  });
  const reponse = await api(`/historique-etats?${parametres}`);
  lignes.replaceChildren(...(reponse.historique.length ? reponse.historique.map(ligne) : [ligneVide(6, 'Aucun changement ne correspond.')]));
  afficherPagination(document.getElementById('pagination'), reponse, (cible) => {
    page = cible;
    charger().catch((erreur) => afficherMessage(erreur.message));
  });
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
for (const nom of ['etat', 'statut', 'site_id', 'date_debut', 'date_fin', 'changements']) filtres.elements[nom].addEventListener('change', recharger);

await preparer().catch((erreur) => afficherMessage(erreur.message));
charger().catch((erreur) => afficherMessage(erreur.message));
