// Traduction des erreurs en réponses pour l'utilisateur (sans base de données).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ErreurApi, traduireErreur } from '../middleware/erreurs.js';

const erreurBase = (code, plus = {}) => Object.assign(new Error(plus.message ?? 'message de la base'), { code, ...plus });

test('règle de la base (GM001) : 409, message de la base repris tel quel', () => {
  const message = 'Stock insuffisant pour PAPIER-A4 — Papier A4 80 g sur le site SIEGE : disponible 7, demandé 8';
  const { statut, corps } = traduireErreur(erreurBase('GM001', { message }));
  assert.equal(statut, 409);
  assert.deepEqual(corps, { erreur: { code: 'STOCK_INSUFFISANT', message } });
});

test('information manquante (GM006) et autorisation (GM013) : 422', () => {
  assert.equal(traduireErreur(erreurBase('GM006')).statut, 422);
  assert.equal(traduireErreur(erreurBase('GM013')).corps.erreur.code, 'AUTORISATION_NON_VALABLE');
});

test('doublon connu : message clair', () => {
  const { statut, corps } = traduireErreur(erreurBase('23505', { constraint: 'materiels_numero_serie_uk' }));
  assert.equal(statut, 409);
  assert.equal(corps.erreur.message, 'Ce numéro de série est déjà enregistré sur un autre matériel.');
  assert.equal(corps.erreur.champ, 'numero_serie', 'champ mis en évidence dans le formulaire');
});

test('règle de contrôle inconnue : message générique', () => {
  const { statut, corps } = traduireErreur(erreurBase('23514', { constraint: 'contrainte_future' }));
  assert.equal(statut, 422);
  assert.equal(corps.erreur.code, 'REGLE_NON_RESPECTEE');
});

test('champ obligatoire : nom lisible du champ', () => {
  const { corps } = traduireErreur(erreurBase('23502', { column: 'numero_contrat' }));
  assert.equal(corps.erreur.message, 'Information obligatoire manquante : le n° de contrat.');
});

test('référence utilisée : suppression refusée, conseil de désactiver', () => {
  const { statut, corps } = traduireErreur(erreurBase('23503'), { methode: 'DELETE' });
  assert.equal(statut, 409);
  assert.equal(corps.erreur.code, 'ELEMENT_UTILISE');
});

test('base injoignable : 503', () => {
  assert.equal(traduireErreur(erreurBase('ECONNREFUSED')).statut, 503);
  assert.equal(traduireErreur(new Error('Connection terminated unexpectedly')).corps.erreur.code, 'BASE_INDISPONIBLE');
});

test('erreur imprévue en production : 500 sans aucun détail technique', () => {
  const { statut, corps } = traduireErreur(new Error('mot de passe de la base : secret'), { production: true });
  assert.equal(statut, 500);
  assert.deepEqual(corps, { erreur: { code: 'ERREUR_INTERNE', message: 'Erreur interne du serveur.' } });
});

test('auteur absent (GM009) : faute du serveur, 500', () => {
  assert.equal(traduireErreur(erreurBase('GM009'), { production: true }).statut, 500);
});

test('erreur de l’application : statut et code conservés', () => {
  const { statut, corps } = traduireErreur(new ErreurApi(403, 'ORIGINE_REFUSEE', 'Refusé.'));
  assert.equal(statut, 403);
  assert.equal(corps.erreur.code, 'ORIGINE_REFUSEE');
});
