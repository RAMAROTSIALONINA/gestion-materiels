// Alertes (phase 7) : stocks sous le seuil, retours en retard ou proches,
// transferts et réparations qui durent, matériels endommagés en service,
// signalements et mouvements en attente. Le responsable de service ne voit
// que son service ; chaque ligne mène à l'écran où l'on agit.
import {
  afficherMessage, api, badge, badgeEtat, badgeStatut, creer, formaterDateCourte, formaterDateHeure, formaterNombre,
} from './app.js';
import { aLeDroit, initialiserEntete, memoriserAlertes } from './entete.js';
import { TYPES_SIGNALEMENT } from './signalements-communs.js';

const utilisateur = await initialiserEntete();
const peut = (droit) => aLeDroit(utilisateur, droit);
const lien = (texte, href) => creer('a', { href, textContent: texte });
const petitLien = (texte, href) => creer('a', { className: 'bouton bouton-petit bouton-secondaire', href, textContent: texte });
const bien = (code, designation, href) => creer('div', {}, creer('strong', {}, lien(code, href)),
  creer('div', { className: 'secondaire', textContent: designation }));
const jours = (n) => `${n} jour${Math.abs(n) > 1 ? 's' : ''}`;
const quantite = (valeur, ligne) => `${formaterNombre(valeur, ligne.decimales)} ${ligne.symbole}`;

// Présentation de chaque rubrique : en-têtes du tableau et cellules d'une ligne.
const RUBRIQUES = {
  stock: {
    aide: 'Quantité disponible inférieure ou égale au seuil (global, ou propre à un site).',
    colonnes: ['Article', 'Où', 'Disponible', 'Seuil', ''],
    cellules: (s) => [
      bien(s.code, s.designation, `/articles/${s.article_id}`),
      s.portee === 'GLOBAL' ? 'Tous les sites' : s.site,
      creer('span', {}, quantite(s.quantite, s), ' ', s.en_rupture ? badge('Rupture', 'badge-danger') : badge('Sous le seuil', 'badge-attente')),
      quantite(s.seuil, s),
      peut('mouvements.saisir') && petitLien('Entrée', `/mouvements/nouveau?type=RECEPTION_ACHAT&article=${s.article_id}`),
    ],
  },
  retours_retard: {
    aide: 'Date de retour prévue dépassée : relancez l’employé, enregistrez le retour ou prolongez le contrat.',
    colonnes: ['Matériel', 'Employé', 'Contrat', 'Retour prévu', ''],
    cellules: (a) => [
      bien(a.code, a.designation, `/materiels/${a.materiel_id}`),
      creer('div', {}, creer('div', { textContent: a.employe }), creer('div', { className: 'secondaire', textContent: [a.matricule, a.service].filter(Boolean).join(' · ') })),
      a.numero_contrat,
      creer('span', {}, formaterDateCourte(a.date_retour_prevue), ' ', badge(`${jours(a.jours_de_retard)} de retard`, 'badge-danger')),
      peut('affectations.gerer') && petitLien('Enregistrer le retour', `/affectations?code=${encodeURIComponent(a.code)}`),
    ],
  },
  retours_proches: {
    aide: 'Retours attendus prochainement : prévenez l’employé.',
    colonnes: ['Matériel', 'Employé', 'Contrat', 'Retour prévu', ''],
    cellules: (a) => [
      bien(a.code, a.designation, `/materiels/${a.materiel_id}`),
      creer('div', {}, creer('div', { textContent: a.employe }), creer('div', { className: 'secondaire', textContent: [a.matricule, a.service].filter(Boolean).join(' · ') })),
      a.numero_contrat,
      creer('span', {}, formaterDateCourte(a.date_retour_prevue), ' ',
        badge(a.jours_de_retard === 0 ? 'aujourd’hui' : `dans ${jours(-a.jours_de_retard)}`, 'badge-info')),
      '',
    ],
  },
  transferts: {
    aide: 'Envoyés avant le 12/11 (réception en deux temps) et pas encore réceptionnés : ouvrez-les pour confirmer leur arrivée. Depuis, un transfert arrive dès l’envoi.',
    colonnes: ['Transfert', 'Origine → destination', 'Envoyé le', 'Contenu', ''],
    cellules: (t) => [
      creer('strong', {}, lien(t.reference, `/mouvements/${t.id}`)),
      `${t.site_origine} → ${t.site_destination}`,
      creer('span', {}, formaterDateCourte(t.date_envoi), ' ', badge(`en route depuis ${jours(t.jours_en_route)}`, 'badge-attente')),
      `${t.premiere_ligne}${t.nb_lignes > 1 ? ` + ${t.nb_lignes - 1}` : ''}`,
      peut('transferts.receptionner') && petitLien('Réceptionner', `/mouvements/${t.id}`),
    ],
  },
  reparations: {
    aide: 'Matériels en réparation depuis longtemps : relancez le réparateur, ou décidez d’une mise au rebut.',
    colonnes: ['Matériel', 'État', 'Site', 'En réparation depuis', 'Motif'],
    cellules: (r) => [
      bien(r.code, r.designation, `/materiels/${r.materiel_id}`),
      badgeEtat(r.etat),
      [r.site, r.service].filter(Boolean).join(' · '),
      r.depuis ? `${formaterDateHeure(r.depuis).slice(0, 10)} (${jours(r.jours)})` : '—',
      r.commentaire ?? '—',
    ],
  },
  endommages: {
    aide: 'Endommagés mais encore disponibles ou chez un employé : envoyez-les en réparation ou changez leur état.',
    colonnes: ['Matériel', 'Statut', 'Site', 'Chez', ''],
    cellules: (m) => [
      bien(m.code, m.designation, `/materiels/${m.materiel_id}`),
      badgeStatut(m.statut),
      [m.site, m.service].filter(Boolean).join(' · '),
      m.responsable ?? '—',
      peut('materiels.gerer') && petitLien('Ouvrir la fiche', `/materiels/${m.materiel_id}`),
    ],
  },
  signalements: {
    aide: 'Signalés par les employés depuis « Mes matériels ».',
    colonnes: ['Date', 'Matériel', 'Objet', 'Par', ''],
    cellules: (s) => [
      formaterDateHeure(s.cree_le),
      bien(s.code, s.designation, `/materiels/${s.materiel_id}`),
      creer('div', {}, creer('div', { textContent: TYPES_SIGNALEMENT[s.type] ?? s.type }), creer('div', { className: 'secondaire', textContent: s.description })),
      s.auteur,
      petitLien('Traiter', '/signalements'),
    ],
  },
  a_autoriser: {
    aide: 'Corrections d’inventaire et mouvements inverses saisis par une autre personne : à valider par vous.',
    colonnes: ['Mouvement', 'Type', 'Date', 'Motif', 'Saisi par'],
    cellules: (m) => [
      creer('strong', {}, lien(m.reference, `/mouvements/${m.id}`)),
      m.type, formaterDateCourte(m.date_mouvement), m.motif ?? '—', m.cree_par_nom,
    ],
  },
};

function rubrique(r) {
  const definition = RUBRIQUES[r.code];
  const classe = r.nombre === 0 ? 'badge-succes' : { danger: 'badge-danger', attention: 'badge-attente', info: 'badge-info' }[r.niveau];
  const entete = creer('div', { className: 'carte-titre' },
    creer('h2', { id: `titre-${r.code}` }, r.titre, ' ', badge(String(r.nombre), classe)));
  const section = creer('section', { className: 'carte', id: `rubrique-${r.code}` }, entete);
  section.setAttribute('aria-labelledby', `titre-${r.code}`);

  if (r.code === 'etiquettes') {
    section.append(r.nombre === 0
      ? creer('p', { className: 'secondaire', textContent: 'Toutes les étiquettes sont imprimées.' })
      : creer('p', {}, `${r.nombre} matériel${r.nombre > 1 ? 's' : ''} n’${r.nombre > 1 ? 'ont' : 'a'} pas encore d’étiquette code-barres. `,
        lien('Les voir et imprimer les étiquettes', '/materiels?sans_etiquette=oui')));
    return section;
  }
  if (r.nombre === 0) {
    section.append(creer('p', { className: 'secondaire', textContent: 'Rien à signaler.' }));
    return section;
  }
  // La dernière colonne (bouton d'action) disparaît quand ce rôle n'a aucune action à faire.
  let colonnes = definition.colonnes;
  let rangees = r.elements.map(definition.cellules);
  if (colonnes.at(-1) === '' && rangees.every((cellules) => !cellules.at(-1))) {
    colonnes = colonnes.slice(0, -1);
    rangees = rangees.map((cellules) => cellules.slice(0, -1));
  }
  section.append(...[
    creer('p', { className: 'secondaire', textContent: definition.aide }),
    creer('div', { className: 'tableau-conteneur' }, creer('table', { className: 'tableau' },
      creer('thead', {}, creer('tr', {}, ...colonnes.map((titre) => creer('th', { scope: 'col' },
        titre || creer('span', { className: 'visuellement-cache', textContent: 'Action' }))))),
      creer('tbody', {}, ...rangees.map((cellules) => creer('tr', {},
        ...cellules.map((cellule) => creer('td', {}, cellule || ''))))))),
    r.nombre > r.elements.length
      && creer('p', { className: 'secondaire', textContent: `${r.elements.length} premières lignes sur ${r.nombre}.` }),
  ].filter(Boolean));
  return section;
}

async function charger() {
  const { total, delais, rubriques } = await api('/alertes');
  memoriserAlertes(total);
  const portee = utilisateur.role === 'RESPONSABLE_SERVICE' ? ' Vous voyez votre service et le site de votre service.' : '';
  document.getElementById('aide').textContent = `Ce qui demande une action. Délais d’alerte : transferts en route depuis ${jours(delais.transfert)}, `
    + `réparations depuis ${jours(delais.reparation)}, retours prévus d’ici ${jours(delais.retour)}`
    + `${peut('parametres.gerer') ? ' (modifiables dans Paramètres › Réglages de l’application)' : ''}.${portee}`;
  // Les rubriques à traiter d'abord ; celles qui sont vides à la fin.
  const triees = [...rubriques].sort((a, b) => Number(b.nombre > 0) - Number(a.nombre > 0));
  document.getElementById('sommaire').replaceChildren(...triees.filter((r) => r.nombre > 0).map((r) => creer('a', {
    href: `#rubrique-${r.code}`, className: `badge ${r.niveau === 'danger' ? 'badge-danger' : r.niveau === 'info' ? 'badge-info' : 'badge-attente'}`,
    textContent: `${r.titre} : ${r.nombre}`,
  })));
  document.getElementById('rubriques').replaceChildren(...triees.map(rubrique));
}

document.getElementById('actualiser').addEventListener('click', () => charger()
  .then(() => afficherMessage('Alertes à jour.', 'succes'))
  .catch((erreur) => afficherMessage(erreur.message)));
charger().catch((erreur) => {
  afficherMessage(erreur.message);
  document.getElementById('rubriques').replaceChildren(creer('p', { className: 'secondaire', textContent: 'Chargement impossible.' }));
});
