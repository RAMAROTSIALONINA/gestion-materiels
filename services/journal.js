// Inscription au journal des opérations sensibles (table historique_actions,
// qui ne se modifie ni ne se supprime). Passer le client d'une transaction pour
// que l'inscription soit annulée avec l'opération si celle-ci échoue.
import { requete } from '../database/db.js';

export function journaliser({ utilisateurId = null, action, entite = null, entiteId = null, metadonnees = {}, ip = null }, client) {
  const executant = client ?? { query: requete };
  return executant.query(
    `INSERT INTO historique_actions (utilisateur_id, action, entite, entite_id, metadonnees, adresse_ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [utilisateurId, action, entite, entiteId, JSON.stringify(metadonnees), ip],
  );
}

// Champs réellement modifiés, avant et après : { designation: { avant, apres } }.
export function differences(avant, saisie) {
  return Object.fromEntries(
    Object.keys(saisie)
      .filter((cle) => String(avant[cle] ?? '') !== String(saisie[cle] ?? ''))
      .map((cle) => [cle, { avant: avant[cle] ?? null, apres: saisie[cle] ?? null }]),
  );
}

// UPDATE limité aux colonnes reçues (noms issus d'une liste fermée, jamais de la requête).
export function miseAJour(table, id, saisie) {
  const colonnes = Object.keys(saisie);
  return {
    texte: `UPDATE ${table} SET ${colonnes.map((colonne, rang) => `${colonne} = $${rang + 2}`).join(', ')} WHERE id = $1`,
    valeurs: [id, ...colonnes.map((colonne) => saisie[colonne])],
  };
}
