// Grille des droits (décisions du 11/11/2026), sans base de données.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DROITS, DROITS_PAR_ROLE, aLeDroit, droitsDuRole, peutReceptionner, perimetre } from '../middleware/permissions.js';

test('chaque droit attribué existe dans la liste des droits', () => {
  for (const [role, droits] of Object.entries(DROITS_PAR_ROLE)) {
    for (const droit of droits) assert.ok(DROITS[droit], `${role} : droit inconnu ${droit}`);
  }
});

test('administrateur : tous les droits ; rôle inconnu : aucun', () => {
  assert.deepEqual(droitsDuRole('ADMIN'), Object.keys(DROITS));
  assert.deepEqual(droitsDuRole('INCONNU'), []);
});

test('gestionnaire : gère le parc et les employés, pas les comptes ni les paramètres', () => {
  for (const droit of ['employes.gerer', 'materiels.gerer', 'mouvements.saisir', 'affectations.gerer', 'signalements.traiter', 'alertes.lire', 'rapports.exporter']) {
    assert.ok(aLeDroit('GESTIONNAIRE', droit), droit);
  }
  for (const droit of ['utilisateurs.gerer', 'parametres.gerer', 'referentiels.gerer', 'journal.lire']) {
    assert.equal(aLeDroit('GESTIONNAIRE', droit), false, droit);
  }
});

test('responsable de service : réception et export accordés, aucune saisie', () => {
  for (const droit of ['transferts.receptionner', 'rapports.exporter', 'materiels.lire', 'signalements.creer', 'alertes.lire']) {
    assert.ok(aLeDroit('RESPONSABLE_SERVICE', droit), droit);
  }
  for (const droit of ['mouvements.saisir', 'materiels.gerer', 'affectations.gerer', 'employes.gerer', 'signalements.traiter']) {
    assert.equal(aLeDroit('RESPONSABLE_SERVICE', droit), false, droit);
  }
  assert.deepEqual(perimetre({ role_code: 'RESPONSABLE_SERVICE', service_id: 7 }), { serviceId: 7 });
});

test('employé : ses matériels et le signalement, rien d’autre', () => {
  assert.deepEqual([...droitsDuRole('EMPLOYE')].sort(), ['mes_materiels.lire', 'signalements.creer']);
  assert.deepEqual(perimetre({ role_code: 'EMPLOYE', employe_id: 3 }), { employeId: 3 });
});

test('réception d’un transfert : le responsable seulement au site de son service', () => {
  const responsable = { role_code: 'RESPONSABLE_SERVICE', service_id: 7 };
  assert.equal(peutReceptionner(responsable, 2, 2), true, 'site de son service');
  assert.equal(peutReceptionner(responsable, 3, 2), false, 'autre site');
  assert.equal(peutReceptionner(responsable, 2, null), false, 'service sans site');
  assert.equal(peutReceptionner({ role_code: 'GESTIONNAIRE' }, 3, null), true);
  assert.equal(peutReceptionner({ role_code: 'EMPLOYE' }, 2, 2), false);
});
