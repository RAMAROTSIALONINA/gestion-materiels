// Code-barres du rapport PDF : le code écrit doit se relire avec le lecteur
// de la page de scan (même table de motifs, Code 128 B).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modulesCode128 } from '../services/code-barres.js';
import { lireTraits } from '../public/js/lecteur-code128.js';

const relire = (texte) => {
  const modules = modulesCode128(texte);
  // Fenêtre claire de 10 modules avant le départ, comme sur les étiquettes.
  return modules && lireTraits([10, ...modules.split('').map(Number)]);
};

test('code-barres Code 128 B : les codes du parc se relisent', () => {
  for (const texte of ['MAT-2026-0001', 'MAT-2025-1234', 'ART-2026-0007', 'A', 'Code 128']) {
    assert.equal(relire(texte), texte, texte);
  }
});

test('hors du jeu B, aucun code-barres n’est produit', () => {
  assert.equal(modulesCode128('MAT-é'), null);
  assert.equal(modulesCode128('MAT\n2026'), null);
  assert.equal(modulesCode128(''), null);
  assert.equal(modulesCode128(null), null);
});
