// Écran Administration : sites, services, catégories (modifiables), unités (lecture),
// paramètres de l'application.
import { afficherMessage, api, badge, creer, formaterDateHeure, ligneVide, ouvrirFormulaire } from './app.js';
import { initialiserEntete } from './entete.js';

await initialiserEntete();

const element = (id) => document.getElementById(id);
const actif = (oui, feminin = false) => (oui ? badge(feminin ? 'Active' : 'Actif', 'badge-succes') : badge(feminin ? 'Inactive' : 'Inactif', 'badge-neutre'));
const TYPES = { MATERIEL: 'Matériels', ARTICLE: 'Articles' };

let sites = [];

const ONGLETS = {
  sites: {
    titre: 'Sites',
    aide: 'Lieux où se trouvent les biens : siège, dépôt, agences… Un service peut être rattaché à un site.',
    ajout: 'Nouveau site',
    colonnes: ['Code', 'Nom', 'Adresse', 'Matériels', 'État'],
    cellules: (s) => [creer('strong', { textContent: s.code }), s.nom, s.adresse ?? '—', String(s.nb_materiels), actif(s.actif)],
    nom: (s) => s.nom,
    champs: (s) => [
      { nom: 'code', libelle: 'Code', obligatoire: true, max: 20, majuscules: true, aide: '1 à 20 caractères : lettres, chiffres, _ et - (ex. SIEGE, DEPOT).' },
      { nom: 'nom', libelle: 'Nom', obligatoire: true, max: 100 },
      { nom: 'adresse', libelle: 'Adresse', max: 200 },
      s && { nom: 'actif', libelle: 'Site actif', type: 'case', aide: 'Un site inactif n’est plus proposé dans les formulaires.' },
    ],
  },
  services: {
    titre: 'Services',
    aide: 'Services de la société. Le responsable d’un service voit ses biens et reçoit les transferts arrivant au site de son service : rattachez chaque service à son site.',
    ajout: 'Nouveau service',
    colonnes: ['Code', 'Nom', 'Site', 'Employés', 'État'],
    cellules: (s) => [creer('strong', { textContent: s.code }), s.nom, s.site ?? badge('Sans site', 'badge-attente'), String(s.nb_employes), actif(s.actif)],
    nom: (s) => s.nom,
    champs: (s) => [
      { nom: 'code', libelle: 'Code', obligatoire: true, max: 20, majuscules: true, aide: '1 à 20 caractères : lettres, chiffres, _ et - (ex. INFO, ADM).' },
      { nom: 'nom', libelle: 'Nom', obligatoire: true, max: 100 },
      {
        nom: 'site_id', libelle: 'Site', type: 'liste', vide: 'Aucun site',
        options: sites.filter((site) => site.actif || site.id === s?.site_id).map((site) => ({ valeur: site.id, libelle: site.nom })),
      },
      s && { nom: 'actif', libelle: 'Service actif', type: 'case' },
    ],
  },
  categories: {
    titre: 'Catégories',
    aide: 'Familles de matériels (informatique, mobilier…) et d’articles (fournitures, consommables…). Le type ne change plus après la création.',
    ajout: 'Nouvelle catégorie',
    colonnes: ['Nom', 'Pour', 'Description', 'Utilisations', 'État'],
    cellules: (c) => [creer('strong', { textContent: c.nom }), TYPES[c.type], c.description ?? '—', String(c.nb_utilisations), actif(c.actif, true)],
    nom: (c) => c.nom,
    champs: (c) => [
      { nom: 'nom', libelle: 'Nom', obligatoire: true, max: 100 },
      {
        nom: 'type', libelle: 'Pour', type: 'liste', obligatoire: true, desactive: Boolean(c), defaut: 'MATERIEL',
        options: Object.entries(TYPES).map(([valeur, libelle]) => ({ valeur, libelle })),
      },
      { nom: 'description', libelle: 'Description', type: 'zone', max: 300 },
      c && { nom: 'actif', libelle: 'Catégorie active', type: 'case' },
    ],
  },
  unites: {
    titre: 'Unités',
    aide: 'Unités de mesure des articles et décimales permises (2,5 boîtes est refusé). Liste fixe.',
    colonnes: ['Code', 'Libellé', 'Symbole', 'Décimales'],
    cellules: (u) => [creer('strong', { textContent: u.code }), u.libelle, u.symbole, String(u.decimales)],
  },
  parametres: {
    titre: 'Paramètres',
    aide: 'Réglages de l’application. Les préfixes des codes, le fuseau horaire et la devise sont figés : ils entrent dans les codes et les dates déjà enregistrés.',
    // Les réglages modifiables d'abord, les valeurs figées ensuite.
    source: async () => (await api('/parametres')).parametres.sort((a, b) => Number(b.modifiable) - Number(a.modifiable)),
    colonnes: ['Paramètre', 'Valeur', 'Dernière modification'],
    cellules: (p) => [
      creer('div', {}, creer('strong', { textContent: LIBELLES_PARAMETRES[p.cle] ?? p.cle }),
        creer('div', { className: 'secondaire', textContent: p.description })),
      p.cle === 'signalements_actifs'
        ? (p.valeur === 'oui' ? badge('Activés', 'badge-succes') : badge('Désactivés', 'badge-neutre'))
        : p.valeur,
      p.modifie_par ? `${formaterDateHeure(p.modifie_le)} par ${p.modifie_par}` : (p.modifiable ? '—' : badge('Figé', 'badge-neutre')),
    ],
    nom: (p) => LIBELLES_PARAMETRES[p.cle] ?? p.cle,
    modifiable: (p) => p.modifiable,
    valeurs: (p) => ({ valeur: p.valeur }),
    champs: (p) => [p.cle === 'signalements_actifs'
      ? {
        nom: 'valeur', libelle: 'Signalement par les employés', type: 'liste', obligatoire: true,
        options: [{ valeur: 'oui', libelle: 'Activé' }, { valeur: 'non', libelle: 'Désactivé' }],
        aide: 'Activé : chaque employé peut signaler une panne, une perte ou un retour souhaité depuis « Mes matériels ».',
      }
      : {
        nom: 'valeur', libelle: LIBELLES_PARAMETRES[p.cle] ?? p.cle, obligatoire: true, max: 100,
        type: /^(connexion|alerte)_/.test(p.cle) ? 'nombre' : 'texte', entier: true, aide: p.description,
      }],
    enregistrer: (p, valeurs) => api(`/parametres/${p.cle}`, { methode: 'PATCH', corps: valeurs }),
  },
};

const LIBELLES_PARAMETRES = {
  nom_societe: 'Nom de la société',
  signalements_actifs: 'Signalements',
  connexion_tentatives_max: 'Tentatives de connexion',
  connexion_verrouillage_minutes: 'Verrouillage (minutes)',
  alerte_transfert_jours: 'Alerte transfert en route (jours)',
  alerte_reparation_jours: 'Alerte réparation (jours)',
  alerte_retour_jours: 'Annonce des retours (jours)',
  fuseau_horaire: 'Fuseau horaire',
  devise: 'Devise',
  prefixe_materiel: 'Préfixe des matériels',
  prefixe_article: 'Préfixe des articles',
  prefixe_mouvement: 'Préfixe des mouvements',
};

let onglet = Object.hasOwn(ONGLETS, window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'sites';

async function charger() {
  const definition = ONGLETS[onglet];
  for (const bouton of document.querySelectorAll('[role="tab"]')) {
    bouton.setAttribute('aria-selected', String(bouton.dataset.onglet === onglet));
  }
  element('titre-panneau').textContent = definition.titre;
  element('aide-panneau').textContent = definition.aide;
  element('ajouter').hidden = !definition.ajout;
  element('ajouter').textContent = definition.ajout ?? '';
  element('entetes').replaceChildren(...[
    ...definition.colonnes.map((titre) => creer('th', { scope: 'col', textContent: titre })),
    definition.champs && creer('th', { scope: 'col' }, creer('span', { className: 'visuellement-cache', textContent: 'Actions' })),
  ].filter(Boolean));

  let elements;
  if (definition.source) {
    elements = await definition.source();
  } else {
    if (onglet === 'services' || sites.length === 0) sites = (await api('/referentiels/sites')).sites;
    elements = onglet === 'sites' ? sites : (await api(`/referentiels/${onglet}`))[onglet];
  }
  const nbColonnes = definition.colonnes.length + (definition.champs ? 1 : 0);
  if (elements.length === 0) {
    element('lignes').replaceChildren(ligneVide(nbColonnes, 'Aucun élément pour l’instant.'));
    return;
  }
  element('lignes').replaceChildren(...elements.map((ligne) => {
    const cellules = definition.cellules(ligne).map((contenu) => creer('td', {}, contenu));
    if (definition.champs && definition.modifiable && !definition.modifiable(ligne)) {
      cellules.push(creer('td'));
    } else if (definition.champs) {
      const modifier = creer('button', { type: 'button', className: 'bouton bouton-petit bouton-secondaire', textContent: 'Modifier' });
      modifier.setAttribute('aria-label', `Modifier : ${definition.nom(ligne)}`);
      modifier.addEventListener('click', () => editer(ligne));
      cellules.push(creer('td', {}, creer('div', { className: 'actions-ligne' }, modifier)));
    }
    return creer('tr', {}, ...cellules);
  }));
}

async function editer(ligne = null) {
  const definition = ONGLETS[onglet];
  const chemin = `/referentiels/${onglet}`;
  const resultat = await ouvrirFormulaire({
    titre: ligne ? `Modifier : ${definition.nom(ligne)}` : definition.ajout,
    champs: definition.champs(ligne).filter(Boolean),
    valeurs: (ligne && definition.valeurs?.(ligne)) ?? ligne ?? {},
    libelle: ligne ? 'Enregistrer' : 'Créer',
    envoyer: (valeurs) => {
      if (definition.enregistrer) return definition.enregistrer(ligne, valeurs);
      return ligne
        ? api(`${chemin}/${ligne.id}`, { methode: 'PATCH', corps: valeurs })
        : api(chemin, { methode: 'POST', corps: valeurs });
    },
  });
  if (!resultat) return;
  afficherMessage(ligne ? 'Modification enregistrée.' : 'Élément créé.', 'succes');
  if (onglet === 'sites') sites = [];
  await charger();
}

for (const bouton of document.querySelectorAll('[role="tab"]')) {
  bouton.addEventListener('click', () => {
    onglet = bouton.dataset.onglet;
    window.history.replaceState(null, '', `#${onglet}`);
    charger().catch((erreur) => afficherMessage(erreur.message));
  });
}
element('ajouter').addEventListener('click', () => editer());
// Le menu « Paramètres » de l'en-tête peut changer d'onglet sans recharger la page (#parametres).
window.addEventListener('hashchange', () => {
  const demande = window.location.hash.slice(1);
  if (!Object.hasOwn(ONGLETS, demande) || demande === onglet) return;
  onglet = demande;
  charger().catch((erreur) => afficherMessage(erreur.message));
});
charger().catch((erreur) => afficherMessage(erreur.message));
