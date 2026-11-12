// Formulaires de saisie des mouvements (décisions du 12/11).
// - « Nouveau mouvement » (écran Mouvements) : une seule liste déroulante,
//   Transfert entre sites ou Sortie / consommation.
// - Les opérations rares ne sont plus dans Mouvements mais sur les fiches :
//   Entrée de stock, Perte ou casse et Correction sur la fiche d'un article ;
//   Déclarer perdu et Mettre au rebut sur la fiche d'un matériel.
// - Les remises et les retours de matériel se font dans « Remises et retours ».
export const OPERATIONS = {
  mouvement: {
    titre: 'Nouveau mouvement',
    texte: 'Transfert vers un autre site, ou sortie d’articles consommés ou distribués.',
    types: ['TRANSFERT', 'CONSOMMATION'],
    libelles: { TRANSFERT: 'Transfert entre sites', CONSOMMATION: 'Sortie / consommation' },
    boutons: { TRANSFERT: 'Envoyer le transfert', CONSOMMATION: 'Enregistrer la sortie' },
  },
  entree: {
    titre: 'Entrée de stock',
    texte: 'Articles achetés ou reçus en don.',
    types: ['RECEPTION_ACHAT', 'RECEPTION_DON'],
    boutons: { RECEPTION_ACHAT: 'Enregistrer l’entrée', RECEPTION_DON: 'Enregistrer l’entrée' },
    // Un nouveau matériel se reçoit avec sa fiche (Matériels › Nouveau matériel).
    sansMateriels: true,
    note: 'Pour un nouveau matériel, passez par Matériels › Nouveau matériel : la fiche et sa réception s’enregistrent ensemble.',
  },
  perte: {
    titre: 'Perte, casse ou rebut',
    texte: 'Un bien perdu, cassé ou mis au rebut.',
    types: ['PERTE', 'CASSE', 'MISE_AU_REBUT'],
  },
  correction: {
    titre: 'Correction d’inventaire',
    texte: 'Écart constaté au comptage ; autorisé ensuite par une autre personne.',
    types: ['CORRECTION_PLUS', 'CORRECTION_MOINS'],
  },
};

// Opération d'un type de mouvement (lien venu d'une fiche : ?type=PERTE…).
export const operationDuType = (code) => Object.keys(OPERATIONS).find((cle) => OPERATIONS[cle].types.includes(code)) ?? null;
