// Libellés français des codes, pour les exports (CSV et PDF) fabriqués par le
// serveur. L'interface a les mêmes dans public/js/app.js et public/js/journal.js.
export const ETATS = {
  NEUF: 'Neuf', BON: 'Bon', MOYEN: 'Moyen', ENDOMMAGE: 'Endommagé', HORS_SERVICE: 'Hors service',
};
export const STATUTS = {
  DISPONIBLE: 'Disponible', AFFECTE: 'Affecté', EN_REPARATION: 'En réparation',
  EN_TRANSIT: 'En transit', PERDU: 'Perdu', REFORME: 'Réformé',
};
export const STATUTS_MOUVEMENT = { BROUILLON: 'Brouillon', VALIDE: 'Validé', ANNULE: 'Annulé' };
export const ALERTES = { RUPTURE: 'Rupture', SOUS_SEUIL: 'Sous le seuil' };
export const NATURES = {
  PERTE: 'Perte', CASSE: 'Casse', MANQUANT: 'Manquant au transfert',
  REPARATION: 'En réparation', HORS_SERVICE: 'Hors service',
};
export const ACTIONS = {
  CONNEXION: 'Connexion', CONNEXION_ECHEC: 'Échec de connexion', CONNEXION_REFUSEE: 'Connexion refusée', DECONNEXION: 'Déconnexion',
  MOT_DE_PASSE_CHANGE: 'Mot de passe changé', MOT_DE_PASSE_REINITIALISE: 'Mot de passe provisoire', COMPTE_DEBLOQUE: 'Compte débloqué',
  ADMINISTRATEUR_CREE: 'Administrateur créé', UTILISATEUR_CREE: 'Compte créé', UTILISATEUR_MODIFIE: 'Compte modifié',
  REFERENTIEL_CREE: 'Référentiel créé', REFERENTIEL_MODIFIE: 'Référentiel modifié', PARAMETRE_MODIFIE: 'Paramètre modifié',
  EMPLOYE_CREE: 'Employé créé', EMPLOYE_MODIFIE: 'Employé modifié',
  MATERIEL_CREE: 'Matériel créé', MATERIEL_MODIFIE: 'Matériel modifié', MATERIEL_ETAT: 'Changement d’état', IMPRESSION_ETIQUETTE: 'Étiquettes imprimées',
  ARTICLE_CREE: 'Article créé', ARTICLE_MODIFIE: 'Article modifié', SEUIL_SITE_MODIFIE: 'Seuil de site fixé', SEUIL_SITE_RETIRE: 'Seuil de site retiré',
  MOUVEMENT_CREE: 'Mouvement en brouillon', MOUVEMENT_MODIFIE: 'Brouillon modifié', MOUVEMENT_VALIDE: 'Mouvement validé',
  MOUVEMENT_ANNULE: 'Mouvement annulé', MOUVEMENT_INVERSE_CREE: 'Mouvement inverse', TRANSFERT_RECU: 'Transfert reçu',
  MATERIEL_REMIS: 'Matériel remis', MATERIEL_RENDU: 'Matériel rendu', PROLONGATION: 'Contrat prolongé',
  SIGNALEMENT_CREE: 'Signalement', SIGNALEMENT_TRAITE: 'Signalement traité',
  EXPORT_RAPPORT: 'Export de rapport',
};
export const ENTITES = {
  materiels: 'Matériel', articles: 'Article', mouvements: 'Mouvement', affectations: 'Affectation', employes: 'Employé',
  utilisateurs: 'Compte', sites: 'Site', services: 'Service', categories: 'Catégorie', parametres: 'Paramètre',
  signalements: 'Signalement', rapports: 'Rapport',
};

const DICTIONNAIRES = {
  etat: ETATS, statut: STATUTS, statut_mouvement: STATUTS_MOUVEMENT, alerte: ALERTES, nature: NATURES, action: ACTIONS,
};

// Valeur d'une cellule, mise en forme selon le type de sa colonne.
//   pour : 'csv' (nombres bruts à virgule, pour Excel) ou 'pdf' (nombres groupés).
export function formaterCellule(valeur, type, pour) {
  if (valeur === null || valeur === undefined || valeur === '') return '';
  switch (type) {
    case 'date': {
      const [annee, mois, jour] = String(valeur).slice(0, 10).split('-');
      return `${jour}/${mois}/${annee}`;
    }
    case 'dateheure': {
      // Horodatage déjà converti à l'heure de Madagascar par la base : « AAAA-MM-JJTHH:MM ».
      const texte = String(valeur);
      return `${formaterCellule(texte.slice(0, 10), 'date')} ${texte.slice(11, 16)}`;
    }
    case 'nombre': {
      const nombre = Number(valeur);
      if (pour === 'csv') return String(nombre).replace('.', ',');
      return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(nombre).replace(/[  ]/g, ' ');
    }
    case 'retard': return Number(valeur) > 0 ? `${valeur} j` : '';
    default:
      return DICTIONNAIRES[type]?.[valeur] ?? String(valeur);
  }
}
