// Libellés et pastilles des signalements, partagés par « Mes matériels » et
// l'écran de traitement.
import { badge } from './app.js';

export const TYPES_SIGNALEMENT = {
  PANNE: 'Panne', PERTE: 'Perte', RETOUR_SOUHAITE: 'Retour souhaité', AUTRE: 'Autre',
};

const STATUTS = {
  OUVERT: ['Ouvert', 'badge-attente'], PRIS_EN_CHARGE: ['Pris en charge', 'badge-info'], CLOS: ['Clos', 'badge-succes'],
};

export const badgeSignalement = (statut) => badge(...(STATUTS[statut] ?? [statut, 'badge-neutre']));
