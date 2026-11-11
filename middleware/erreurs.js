// Traduction de toutes les erreurs en réponses JSON lisibles :
//   { "erreur": { "code": "STOCK_INSUFFISANT", "message": "…" } }
// Les messages des règles de la base (GM001…GM013) sont déjà rédigés en
// français pour l'utilisateur ; les erreurs techniques ne sont jamais
// détaillées en production.

export class ErreurApi extends Error {
  // plus : informations ajoutées à la réponse, par exemple { champ: 'email' }
  constructor(statut, code, message, plus = {}) {
    super(message);
    this.statut = statut;
    this.code = code;
    this.plus = plus;
  }
}

// Règles de la base : statut HTTP et code lisible.
const REGLES = {
  GM001: [409, 'STOCK_INSUFFISANT'],
  GM002: [409, 'ENREGISTREMENT_FIGE'],
  GM003: [409, 'SUPPRESSION_INTERDITE'],
  GM004: [422, 'LIGNE_INCOHERENTE'],
  GM005: [422, 'QUANTITE_NON_CONFORME'],
  GM006: [422, 'INFORMATION_MANQUANTE'],
  GM007: [422, 'DATE_NON_VALABLE'],
  GM008: [409, 'INDISPONIBLE'],
  GM010: [409, 'HISTORIQUE_FIGE'],
  GM011: [422, 'MOUVEMENT_SANS_LIGNE'],
  GM012: [409, 'UNITE_FIGEE'],
  GM013: [422, 'AUTORISATION_NON_VALABLE'],
};

// Contraintes de la base : message pour l'utilisateur.
const CONTRAINTES = {
  // Doublons
  sites_code_key: 'Ce code de site est déjà utilisé.',
  sites_nom_uk: 'Un site porte déjà ce nom.',
  services_code_key: 'Ce code de service est déjà utilisé.',
  services_nom_uk: 'Un service porte déjà ce nom.',
  categories_nom_uk: 'Cette catégorie existe déjà.',
  employes_matricule_key: 'Ce matricule est déjà utilisé.',
  utilisateurs_email_uk: 'Cette adresse e-mail est déjà utilisée par un autre compte.',
  utilisateurs_identifiant_uk: 'Cet identifiant est déjà pris.',
  utilisateurs_employe_uk: 'Cet employé a déjà un compte.',
  materiels_code_key: 'Ce code matériel est déjà utilisé.',
  materiels_numero_serie_uk: 'Ce numéro de série est déjà enregistré sur un autre matériel.',
  articles_code_key: 'Ce code article est déjà utilisé.',
  articles_designation_uk: 'Un article porte déjà cette désignation.',
  seuils_articles_sites_pkey: 'Un seuil existe déjà pour cet article sur ce site.',
  lignes_materiel_une_fois_uk: 'Ce matériel figure déjà dans ce mouvement.',
  affectations_une_en_cours_uk: 'Ce matériel a déjà une affectation en cours.',
  // Règles de contrôle
  sites_code_format: 'Code de site : 1 à 20 caractères parmi A-Z, 0-9, _ et -.',
  services_code_format: 'Code de service : 1 à 20 caractères parmi A-Z, 0-9, _ et -.',
  materiels_code_format: 'Code matériel : majuscules, chiffres et . _ / - (40 caractères au plus).',
  articles_code_format: 'Code article : majuscules, chiffres et . _ / - (40 caractères au plus).',
  utilisateurs_email_format: 'Adresse e-mail non valable.',
  utilisateurs_identifiant_format: 'Identifiant : 3 à 40 caractères parmi lettres, chiffres, point, tiret et soulignement.',
  utilisateurs_employe_requis: 'Un compte Employé doit être rattaché à une fiche employé.',
  utilisateurs_service_requis: 'Un compte Responsable de service doit être rattaché à un service.',
  materiels_hors_service_inutilisable: 'Un matériel hors service ne peut être ni disponible ni affecté.',
  materiels_prix_positif: 'Le prix d’achat ne peut pas être négatif.',
  articles_seuil_positif: 'Le seuil minimum ne peut pas être négatif.',
  seuils_sites_positif: 'Le seuil d’un site doit être supérieur à zéro.',
  mouvements_annulation_motivee: 'Le motif d’annulation est obligatoire (3 caractères au moins).',
  lignes_quantite_positive: 'La quantité doit être supérieure à zéro.',
  lignes_quantite_recue: 'La quantité reçue doit être comprise entre 0 et la quantité envoyée.',
  lignes_sites_differents: 'Les sites d’origine et de destination doivent être différents.',
  lignes_un_seul_bien: 'Une ligne porte soit un article, soit un matériel.',
  affectations_prevue_apres_remise: 'La date de retour prévue ne peut pas précéder la date de remise.',
  affectations_retour_apres_remise: 'La date de retour ne peut pas précéder la date de remise.',
  affectations_retour_complet: 'Le retour demande la date, l’état constaté et le mouvement de retour.',
};

// Champ du formulaire en cause pour chaque doublon (mis en évidence à l'écran).
const CHAMPS_DOUBLONS = {
  sites_code_key: 'code', sites_nom_uk: 'nom', services_code_key: 'code', services_nom_uk: 'nom',
  categories_nom_uk: 'nom', employes_matricule_key: 'matricule',
  utilisateurs_email_uk: 'email', utilisateurs_identifiant_uk: 'identifiant', utilisateurs_employe_uk: 'employe_id',
  materiels_code_key: 'code', materiels_numero_serie_uk: 'numero_serie',
  articles_code_key: 'code', articles_designation_uk: 'designation',
};

// Colonnes obligatoires : nom lisible.
const COLONNES = {
  code: 'le code',
  nom: 'le nom',
  designation: 'la désignation',
  categorie_id: 'la catégorie',
  site_id: 'le site',
  unite_code: 'l’unité',
  seuil_minimum: 'le seuil minimum',
  matricule: 'le matricule',
  email: 'l’adresse e-mail',
  role_code: 'le rôle',
  type_code: 'le type de mouvement',
  quantite: 'la quantité',
  materiel_id: 'le matériel',
  employe_id: 'l’employé',
  numero_contrat: 'le n° de contrat',
  date_retour_prevue: 'la date de retour prévue',
  etat_remise: 'l’état à la remise',
  mouvement_affectation_id: 'le mouvement d’affectation',
};

const ERREURS_CONNEXION = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', '57P01', '57P03', '08000', '08001', '08006']);

const reponse = (statut, code, message, plus = {}) => ({ statut, corps: { erreur: { code, message, ...plus } } });

export function traduireErreur(erreur, { production = true, methode = 'GET' } = {}) {
  if (erreur instanceof ErreurApi) return reponse(erreur.statut, erreur.code, erreur.message, erreur.plus);

  // Corps de requête illisible ou trop gros (express.json)
  if (erreur?.type === 'entity.parse.failed') return reponse(400, 'JSON_ILLISIBLE', 'Données envoyées illisibles.');
  if (erreur?.type === 'entity.too.large') return reponse(413, 'TROP_VOLUMINEUX', 'Données envoyées trop volumineuses.');

  const code = erreur?.code;
  if (REGLES[code]) {
    const [statut, libelle] = REGLES[code];
    return reponse(statut, libelle, erreur.message);
  }

  switch (code) {
    case '23505':
      return reponse(409, 'DOUBLON', CONTRAINTES[erreur.constraint] ?? 'Cette valeur est déjà utilisée.', {
        contrainte: erreur.constraint,
        ...(CHAMPS_DOUBLONS[erreur.constraint] ? { champ: CHAMPS_DOUBLONS[erreur.constraint] } : {}),
      });
    case '23514':
      return reponse(422, 'REGLE_NON_RESPECTEE', CONTRAINTES[erreur.constraint] ?? 'Donnée refusée par une règle de contrôle.', { contrainte: erreur.constraint });
    case '23502':
      return reponse(422, 'CHAMP_OBLIGATOIRE', `Information obligatoire manquante : ${COLONNES[erreur.column] ?? erreur.column}.`, { champ: erreur.column });
    case '23503':
      return methode === 'DELETE'
        ? reponse(409, 'ELEMENT_UTILISE', 'Cet élément est utilisé ailleurs : il ne peut pas être supprimé. Désactivez-le plutôt.')
        : reponse(422, 'REFERENCE_INCONNUE', 'Élément lié introuvable ou d’un autre type (catégorie, site, employé…).');
    case '22P02':
    case '22003':
    case '22007':
    case '22008':
      return reponse(400, 'VALEUR_MAL_FORMEE', 'Valeur mal formée : vérifiez les nombres et les dates saisis.');
    case '57014':
      return reponse(503, 'DELAI_DEPASSE', 'L’opération a pris trop de temps. Réessayez dans un instant.');
  }

  if (ERREURS_CONNEXION.has(code) || /Connection terminated|timeout exceeded when trying to connect/i.test(erreur?.message ?? '')) {
    return reponse(503, 'BASE_INDISPONIBLE', 'La base de données ne répond pas. Réessayez dans un instant.');
  }

  // GM009 (auteur absent) et toute erreur imprévue : faute du serveur.
  return reponse(500, 'ERREUR_INTERNE', 'Erreur interne du serveur.', production ? {} : { detail: erreur?.message });
}

export function gestionnaireErreurs({ production }) {
  // eslint-disable-next-line no-unused-vars
  return (erreur, req, res, next) => {
    const { statut, corps } = traduireErreur(erreur, { production, methode: req.method });
    if (statut >= 500) console.error(`[erreur] ${req.method} ${req.originalUrl} :`, erreur);
    res.status(statut).json(corps);
  };
}
