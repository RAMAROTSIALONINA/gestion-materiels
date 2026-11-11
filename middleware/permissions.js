// Droits de chaque rôle (cahier des charges § 1.3, décisions du 11/11/2026).
// Ils sont vérifiés par le serveur à chaque requête : le menu affiché à l'écran
// n'en est qu'un reflet. Détail : docs/droits.md.

export const DROITS = {
  'parametres.gerer':        'Modifier les paramètres de l’application',
  'utilisateurs.gerer':      'Créer et gérer les comptes utilisateurs',
  'journal.lire':            'Consulter le journal des opérations',
  'referentiels.gerer':      'Gérer sites, services et catégories',
  'referentiels.lire':       'Consulter sites, services, catégories et unités',
  'employes.gerer':          'Créer et modifier les fiches employés',
  'materiels.lire':          'Consulter les matériels',
  'materiels.gerer':         'Créer et modifier les fiches matériels, imprimer les étiquettes',
  'articles.lire':           'Consulter les articles et les stocks',
  'articles.gerer':          'Créer et modifier les articles et leurs seuils',
  'mouvements.lire':         'Consulter les mouvements',
  'mouvements.saisir':       'Saisir et valider les mouvements',
  'mouvements.annuler':      'Annuler un mouvement validé',
  'mouvements.autoriser':    'Autoriser une correction d’inventaire ou un mouvement inverse',
  'transferts.receptionner': 'Confirmer la réception d’un transfert',
  'affectations.lire':       'Consulter les affectations',
  'affectations.gerer':      'Remettre un matériel, enregistrer son retour, prolonger un contrat',
  'mes_materiels.lire':      'Consulter les matériels qui me sont affectés',
  'signalements.creer':      'Signaler une panne, une perte ou un retour souhaité sur un de mes matériels',
  'signalements.traiter':    'Prendre en charge et clore les signalements',
  'alertes.lire':            'Consulter les alertes (stocks, retours, transferts, réparations)',
  'rapports.lire':           'Consulter les rapports',
  'rapports.exporter':       'Exporter les rapports',
};

const TOUS = Object.keys(DROITS);

export const DROITS_PAR_ROLE = {
  ADMIN: TOUS,
  GESTIONNAIRE: [
    'referentiels.lire', 'employes.gerer',
    'materiels.lire', 'materiels.gerer',
    'articles.lire', 'articles.gerer',
    'mouvements.lire', 'mouvements.saisir', 'mouvements.annuler', 'mouvements.autoriser',
    'transferts.receptionner',
    'affectations.lire', 'affectations.gerer',
    'mes_materiels.lire', 'signalements.creer', 'signalements.traiter',
    'alertes.lire',
    'rapports.lire', 'rapports.exporter',
  ],
  // Limité à son service : lecture, réception des transferts arrivant au site
  // de son service, export de ses rapports (périmètre appliqué par les routes).
  RESPONSABLE_SERVICE: [
    'referentiels.lire',
    'materiels.lire', 'articles.lire', 'mouvements.lire', 'affectations.lire',
    'transferts.receptionner',
    'mes_materiels.lire', 'signalements.creer',
    'alertes.lire',
    'rapports.lire', 'rapports.exporter',
  ],
  // Le signalement n'est ouvert que si l'administrateur active la fonction
  // dans les paramètres (cahier des charges § 1.3 : « si cette fonction est activée »).
  EMPLOYE: ['mes_materiels.lire', 'signalements.creer'],
};

export function droitsDuRole(role) {
  return DROITS_PAR_ROLE[role] ?? [];
}

export function aLeDroit(role, droit) {
  return droitsDuRole(role).includes(droit);
}

// Ce qu'un utilisateur peut voir : tout, son service, ou ses propres matériels.
export function perimetre(utilisateur) {
  if (utilisateur.role_code === 'RESPONSABLE_SERVICE') return { serviceId: utilisateur.service_id };
  if (utilisateur.role_code === 'EMPLOYE') return { employeId: utilisateur.employe_id };
  return { tout: true };
}

// Réception d'un transfert : partout pour l'administrateur et le gestionnaire ;
// pour un responsable, seulement au site auquel son service est rattaché
// (siteDuService = services.site_id ; un service sans site ne reçoit rien).
export function peutReceptionner(utilisateur, siteDestinationId, siteDuService) {
  if (!aLeDroit(utilisateur.role_code, 'transferts.receptionner')) return false;
  if (utilisateur.role_code !== 'RESPONSABLE_SERVICE') return true;
  return siteDuService !== null && siteDuService !== undefined && siteDestinationId === siteDuService;
}
