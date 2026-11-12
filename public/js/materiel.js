// Fiche d'un matériel : identification, localisation, responsable, historique.
import {
  LIBELLES_ETAT, LIBELLES_STATUT, afficherMessage, api, badge, badgeEtat, badgeStatut, creer, definitions,
  formaterDateCourte, formaterDateHeure, formaterMontant, ligneVide, options, ouvrirFormulaire,
} from './app.js';
import { aLeDroit, initialiserEntete } from './entete.js';

const utilisateur = await initialiserEntete();
const gestion = aLeDroit(utilisateur, 'materiels.gerer');
const id = Number(window.location.pathname.split('/').pop());
const element = (nom) => document.getElementById(nom);
const STATUT_MOUVEMENT = { BROUILLON: ['Brouillon', 'badge-neutre'], VALIDE: ['Validé', 'badge-succes'], ANNULE: ['Annulé', 'badge-danger'] };

const carte = (titre, contenu) => creer('section', { className: 'carte' }, creer('h2', { textContent: titre }), contenu);

async function charger() {
  const { materiel: m, historique, mouvements, affectations } = await api(`/materiels/${id}`);
  document.title = `${m.code} — Gestion des matériels`;
  element('titre').textContent = `${m.code} · ${m.designation}`;
  element('pastilles').replaceChildren(...[
    badgeEtat(m.etat), badgeStatut(m.statut),
    m.retour_en_retard && badge('Retour en retard', 'badge-danger'),
    gestion && !m.etiquette_imprimee_le && badge('Sans étiquette', 'badge-attente'),
  ].filter(Boolean));

  const actions = [];
  if (gestion) {
    const etiquette = creer('a', { className: 'bouton bouton-secondaire', href: `/etiquettes?ids=${m.id}`, textContent: 'Imprimer l’étiquette' });
    const modifier = creer('button', { type: 'button', className: 'bouton', textContent: 'Modifier' });
    modifier.addEventListener('click', () => modifierFiche(m));
    actions.push(etiquette, modifier);
    // États (phase 7) : constat d'un nouvel état, départ et retour de réparation.
    const bouton = (texte, preselection) => {
      const b = creer('button', { type: 'button', className: 'bouton bouton-secondaire', textContent: texte });
      b.addEventListener('click', () => changerEtat(m, preselection).catch((erreur) => afficherMessage(erreur.message)));
      return b;
    };
    if (m.statut === 'DISPONIBLE') actions.push(bouton('Envoyer en réparation', { statut: 'EN_REPARATION' }));
    if (m.statut === 'EN_REPARATION') actions.push(bouton('Fin de réparation', { statut: 'DISPONIBLE', etat: m.etat === 'HORS_SERVICE' ? 'BON' : m.etat }));
    if (['DISPONIBLE', 'EN_REPARATION', 'AFFECTE'].includes(m.statut)) actions.push(bouton('Changer l’état', {}));
  }
  // Opérations courantes : elles ouvrent l'écran voulu, déjà prérempli.
  const lien = (texte, href) => creer('a', { className: 'bouton bouton-secondaire', href, textContent: texte });
  if (aLeDroit(utilisateur, 'affectations.gerer')) {
    const enCours = affectations.find((a) => !a.date_retour);
    // La base n'accepte de remettre qu'un matériel disponible en état neuf, bon ou moyen.
    if (m.statut === 'DISPONIBLE' && ['NEUF', 'BON', 'MOYEN'].includes(m.etat)) {
      actions.push(lien('Remettre à un employé', `/affectations?remettre=${m.id}`));
    }
    if (m.statut === 'AFFECTE' && enCours) actions.push(lien('Enregistrer le retour', `/affectations?code=${encodeURIComponent(m.code)}`));
  }
  if (aLeDroit(utilisateur, 'mouvements.saisir') && ['DISPONIBLE', 'EN_REPARATION'].includes(m.statut)) {
    const nouveau = (type) => `/mouvements/nouveau?type=${type}&materiel=${m.id}`;
    actions.push(lien('Transférer', nouveau('TRANSFERT')), lien('Déclarer perdu', nouveau('PERTE')), lien('Mettre au rebut', nouveau('MISE_AU_REBUT')));
  }
  element('actions').replaceChildren(...actions);

  element('fiche').replaceChildren(
    carte('Identification', definitions([
      ['Code', creer('strong', { textContent: m.code })],
      ['Désignation', m.designation],
      ['Catégorie', m.categorie],
      ['Marque', m.marque],
      ['Modèle', m.modele],
      ['N° de série', m.numero_serie],
    ])),
    carte('Localisation', definitions([
      ['Site', m.site],
      ['Service', m.service],
      ['État', badgeEtat(m.etat)],
      ['Statut', badgeStatut(m.statut)],
      ['Observations', m.observations],
    ])),
    carte('Achat et suivi', definitions([
      ['Date d’achat', formaterDateCourte(m.date_achat)],
      ['Prix d’achat', formaterMontant(m.prix_achat)],
      ['Fournisseur', m.fournisseur],
      ['Fiche créée', `${formaterDateHeure(m.cree_le)} par ${m.cree_par_nom ?? '—'}`],
      ['Dernière modification', m.modifie_par_nom ? `${formaterDateHeure(m.modifie_le)} par ${m.modifie_par_nom}` : '—'],
      ['Étiquette imprimée', formaterDateHeure(m.etiquette_imprimee_le)],
    ])),
  );

  element('responsable').replaceChildren(m.responsable
    ? definitions([
      ['Remis à', `${m.responsable}${m.responsable_matricule ? ` (${m.responsable_matricule})` : ''}`],
      ['Contrat', m.numero_contrat],
      ['Remis le', formaterDateCourte(m.date_remise)],
      ['Retour prévu', creer('span', {}, formaterDateCourte(m.date_retour_prevue), ' ',
        m.retour_en_retard ? badge('En retard', 'badge-danger') : null)],
    ])
    : creer('p', { className: 'secondaire', textContent: 'Ce matériel n’est remis à personne actuellement.' }));

  element('historique').replaceChildren(...(historique.length ? historique.map((h) => creer('tr', {},
    creer('td', { textContent: formaterDateHeure(h.date_changement) }),
    creer('td', {}, h.ancien_etat && h.ancien_etat !== h.nouvel_etat ? creer('span', {}, badgeEtat(h.ancien_etat), ' → ') : null, badgeEtat(h.nouvel_etat)),
    creer('td', {}, h.ancien_statut && h.ancien_statut !== h.nouveau_statut ? creer('span', {}, badgeStatut(h.ancien_statut), ' → ') : null, badgeStatut(h.nouveau_statut)),
    creer('td', { textContent: h.commentaire ?? '—' }),
    creer('td', { textContent: h.auteur }),
  )) : [ligneVide(5, 'Aucun changement.')]));

  element('mouvements').replaceChildren(...(mouvements.length ? mouvements.map((mv) => {
    const [libelle, classe] = STATUT_MOUVEMENT[mv.statut];
    return creer('tr', {},
      creer('td', { textContent: formaterDateCourte(mv.date_mouvement) }),
      creer('td', {}, creer('strong', {}, aLeDroit(utilisateur, 'mouvements.lire')
        ? creer('a', { href: `/mouvements/${mv.mouvement_id}`, textContent: mv.reference })
        : mv.reference)),
      creer('td', { textContent: mv.type }),
      creer('td', { textContent: mv.numero_ticket ?? '—' }),
      creer('td', { textContent: [mv.site_origine, mv.site_destination].filter(Boolean).join(' → ') || '—' }),
      creer('td', { textContent: mv.motif ?? '—' }),
      creer('td', {}, badge(libelle, classe), mv.etat_transfert === 'EN_ROUTE' ? badge('En route', 'badge-info') : null));
  }) : [ligneVide(7, 'Aucun mouvement.')]));

  element('affectations').replaceChildren(...(affectations.length ? affectations.map((a) => creer('tr', {},
    creer('td', { textContent: `${a.employe} (${a.matricule})` }),
    creer('td', { textContent: a.numero_contrat }),
    creer('td', { textContent: formaterDateCourte(a.date_remise) }),
    creer('td', { textContent: formaterDateCourte(a.date_retour_prevue) }),
    creer('td', { textContent: a.date_retour ? formaterDateCourte(a.date_retour) : 'En cours' }),
    creer('td', {}, a.etat_retour ? badgeEtat(a.etat_retour) : '—'),
  )) : [ligneVide(6, 'Jamais affecté.')]));
}

// Changement d'état (cahier § 3.7, recette 10) : la base l'inscrit dans
// l'historique avec l'auteur, la date et le commentaire.
async function changerEtat(m, preselection) {
  const statutModifiable = ['DISPONIBLE', 'EN_REPARATION'].includes(m.statut);
  const titre = { EN_REPARATION: 'Envoyer en réparation', DISPONIBLE: 'Fin de réparation' }[preselection.statut] ?? 'Changer l’état';
  const resultat = await ouvrirFormulaire({
    titre: `${titre} — ${m.code}`,
    valeurs: { etat: preselection.etat ?? m.etat, statut: preselection.statut ?? m.statut },
    champs: [
      {
        nom: 'etat', libelle: 'État constaté', type: 'liste', obligatoire: true, options: options(LIBELLES_ETAT),
        aide: m.statut === 'AFFECTE'
          ? 'Le matériel reste chez l’employé. S’il est hors service, enregistrez plutôt son retour.'
          : 'Hors service : le matériel doit rester en réparation en attendant la décision, ou être mis au rebut.',
      },
      statutModifiable && {
        nom: 'statut', libelle: 'Statut', type: 'liste', obligatoire: true,
        options: [{ valeur: 'DISPONIBLE', libelle: LIBELLES_STATUT.DISPONIBLE }, { valeur: 'EN_REPARATION', libelle: LIBELLES_STATUT.EN_REPARATION }],
      },
      {
        nom: 'commentaire', libelle: 'Commentaire', type: 'zone', max: 500,
        aide: 'Obligatoire pour un matériel endommagé, hors service ou envoyé en réparation. Il reste dans l’historique.',
      },
    ].filter(Boolean),
    libelle: 'Enregistrer',
    envoyer: (valeurs) => api(`/materiels/${m.id}/etat`, { methode: 'POST', corps: valeurs }),
  });
  if (!resultat) return;
  afficherMessage('Changement enregistré dans l’historique.', 'succes');
  await charger();
}

async function modifierFiche(m) {
  const [categories, services] = await Promise.all([
    api('/referentiels/categories').then((r) => r.categories.filter((c) => c.type === 'MATERIEL')),
    api('/referentiels/services').then((r) => r.services),
  ]);
  const actifs = (liste, courant) => liste.filter((e) => e.actif || e.id === courant).map((e) => ({ valeur: e.id, libelle: e.nom }));
  const resultat = await ouvrirFormulaire({
    titre: `Modifier ${m.code}`,
    large: true,
    valeurs: m,
    champs: [
      { nom: 'designation', libelle: 'Désignation', obligatoire: true, max: 150 },
      { nom: 'categorie_id', libelle: 'Catégorie', type: 'liste', obligatoire: true, options: actifs(categories, m.categorie_id) },
      { nom: 'marque', libelle: 'Marque', max: 80 },
      { nom: 'modele', libelle: 'Modèle', max: 80 },
      { nom: 'numero_serie', libelle: 'Numéro de série', max: 80 },
      { nom: 'service_id', libelle: 'Service utilisateur', type: 'liste', vide: 'Aucun', options: actifs(services, m.service_id) },
      { nom: 'date_achat', libelle: 'Date d’achat', type: 'date' },
      { nom: 'prix_achat', libelle: 'Prix d’achat (Ariary)', type: 'nombre', entier: true, max: 18 },
      { nom: 'fournisseur', libelle: 'Fournisseur', max: 120 },
      { nom: 'observations', libelle: 'Observations', type: 'zone', max: 1000 },
    ],
    envoyer: (valeurs) => api(`/materiels/${m.id}`, { methode: 'PATCH', corps: valeurs }),
  });
  if (!resultat) return;
  afficherMessage('Fiche modifiée.', 'succes');
  await charger();
}

if (new URLSearchParams(window.location.search).get('cree') === '1') {
  afficherMessage('Matériel enregistré, avec son mouvement de réception. Pensez à imprimer son étiquette.', 'succes');
  window.history.replaceState(null, '', window.location.pathname);
}
charger().catch((erreur) => {
  element('titre').textContent = 'Matériel introuvable';
  afficherMessage(erreur.message);
});
