// Lecteur de code-barres de la caméra (13/11) : public/js/lecteur-code128.js.
// Les codes-barres de l'essai sont fabriqués par JsBarcode, la bibliothèque
// qui imprime les étiquettes, puis « photographiés » : pixels partiellement
// couverts, flou, bruit, éclairage inégal, étiquette à l'envers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import { MOTIFS_CODE128, lireImage, lireLigne } from '../public/js/lecteur-code128.js';

const require = createRequire(import.meta.url);
const { BARS } = require('jsbarcode/bin/barcodes/CODE128/constants.js');
const { default: CODE128_AUTO } = require('jsbarcode/bin/barcodes/CODE128/CODE128_AUTO.js');
const { default: CODE128A } = require('jsbarcode/bin/barcodes/CODE128/CODE128A.js');
const { default: CODE128C } = require('jsbarcode/bin/barcodes/CODE128/CODE128C.js');

const modulesDe = (code, Format = CODE128_AUTO) => new Format(code, {}).encode().data;

// Générateur pseudo-aléatoire reproductible.
function hasard(graine) {
  let etat = graine >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Une ligne de l'image d'un code-barres, telle que la verrait la caméra.
function photographier(modules, {
  pxParModule = 3, marge = 10, decalage = 0.37, flou = 0, bruit = 0, pente = 0, clair = 225, sombre = 35, graine = 1,
} = {}) {
  const motif = '0'.repeat(marge) + modules + '0'.repeat(marge);
  const n = Math.ceil(motif.length * pxParModule);
  let lum = new Float32Array(n);
  for (let x = 0; x < n; x += 1) {
    const a = (x + decalage) / pxParModule;
    const b = (x + 1 + decalage) / pxParModule;
    let couvert = 0;
    for (let m = Math.floor(a); m < Math.ceil(b); m += 1) {
      if (motif[m] === '1') couvert += Math.min(b, m + 1) - Math.max(a, m);
    }
    lum[x] = clair - (couvert / (b - a)) * (clair - sombre);
  }
  if (flou > 0) {
    const rayon = Math.ceil(flou * 3);
    const noyau = Array.from({ length: 2 * rayon + 1 }, (_, k) => Math.exp(-((k - rayon) ** 2) / (2 * flou * flou)));
    const totalNoyau = noyau.reduce((s, v) => s + v, 0);
    const floue = new Float32Array(n);
    for (let x = 0; x < n; x += 1) {
      let somme = 0;
      for (let k = -rayon; k <= rayon; k += 1) somme += lum[Math.min(n - 1, Math.max(0, x + k))] * noyau[k + rayon];
      floue[x] = somme / totalNoyau;
    }
    lum = floue;
  }
  const aleatoire = hasard(graine);
  for (let x = 0; x < n; x += 1) {
    const eclairage = 1 - pente * (x / n);
    lum[x] = Math.max(0, Math.min(255, lum[x] * eclairage + (aleatoire() * 2 - 1) * bruit));
  }
  return lum;
}

describe('lecteur de code-barres Code 128 (caméra)', () => {
  test('les 107 motifs sont ceux de JsBarcode, qui imprime les étiquettes', () => {
    assert.equal(MOTIFS_CODE128.length, BARS.length);
    BARS.forEach((barres, valeur) => {
      const largeurs = String(barres).match(/1+|0+/g).map((suite) => suite.length);
      assert.deepEqual(MOTIFS_CODE128[valeur], largeurs, `motif ${valeur}`);
    });
  });

  test('lit les codes des étiquettes, quel que soit le jeu de caractères', () => {
    for (const code of ['MAT-2026-0001', 'MAT-2026-0420', 'MAT-2027-12345', 'mat-2026-0001', 'A', 'PC portable 14"']) {
      assert.equal(lireLigne(photographier(modulesDe(code))), code, code);
    }
    assert.equal(lireLigne(photographier(modulesDe('MAT-2026-0001', CODE128A))), 'MAT-2026-0001');
    assert.equal(lireLigne(photographier(modulesDe('20260001', CODE128C))), '20260001');
  });

  test('photo réaliste : petite taille, flou, bruit, éclairage inégal, à l’envers', () => {
    const modules = modulesDe('MAT-2026-0001');
    const cas = [
      { pxParModule: 2.2 },
      { pxParModule: 2.5, flou: 0.7 },
      { pxParModule: 3.4, flou: 1.1, bruit: 10 },
      { pxParModule: 4.6, flou: 1.6, bruit: 12, pente: 0.45 },
      { pxParModule: 6, flou: 2, bruit: 15, pente: 0.3, clair: 170, sombre: 60 },
      // Flou d'un demi-module : les bords sont repérés par la pente de la luminance.
      { pxParModule: 3, flou: 1.5 },
      { pxParModule: 6, flou: 3, bruit: 5, pente: 0.3 },
      { pxParModule: 9, flou: 4.5, bruit: 5 },
    ];
    for (const [indice, options] of cas.entries()) {
      const ligne = photographier(modules, { ...options, graine: indice + 7 });
      assert.equal(lireLigne(ligne), 'MAT-2026-0001', JSON.stringify(options));
      assert.equal(lireLigne(Float32Array.from(ligne).reverse()), 'MAT-2026-0001', `à l’envers ${JSON.stringify(options)}`);
    }
  });

  test('ne lit rien de faux : bruit, ligne unie, code abîmé', () => {
    const aleatoire = hasard(42);
    for (let essai = 0; essai < 50; essai += 1) {
      const bruit = Float32Array.from({ length: 900 }, () => aleatoire() * 255);
      assert.equal(lireLigne(bruit), null);
    }
    // Barres au hasard (texte, motifs, bords d'objets) : jamais de lecture.
    for (let essai = 0; essai < 500; essai += 1) {
      let teinte = 128;
      const barres = Float32Array.from({ length: 600 + Math.floor(aleatoire() * 800) }, () => {
        if (aleatoire() < 0.3) teinte = aleatoire() < 0.5 ? 30 : 220;
        return teinte + (aleatoire() - 0.5) * 20;
      });
      assert.equal(lireLigne(barres), null);
    }
    assert.equal(lireLigne(new Float32Array(500).fill(200)), null);
    // Une barre effacée au milieu : la clé ne correspond plus, rien n'est lu.
    const modules = modulesDe('MAT-2026-0001');
    const milieu = modules.indexOf('1', Math.floor(modules.length / 2));
    const abime = modules.slice(0, milieu) + '0' + modules.slice(milieu + 1);
    assert.notEqual(lireLigne(photographier(abime)), 'MAT-2026-0001');
    assert.equal([null, 'MAT-2026-0001'].includes(lireLigne(photographier(abime))), true, 'jamais un autre code');
  });

  test('image entière : le code est lu sur plusieurs lignes', () => {
    const ligne = photographier(modulesDe('MAT-2026-0007'), { pxParModule: 3, flou: 0.8, bruit: 6 });
    const largeur = ligne.length;
    const hauteur = 240;
    const data = new Uint8ClampedArray(largeur * hauteur * 4).fill(255);
    for (let y = 60; y < 180; y += 1) {
      for (let x = 0; x < largeur; x += 1) {
        const i = (y * largeur + x) * 4;
        data[i] = ligne[x];
        data[i + 1] = ligne[x];
        data[i + 2] = ligne[x];
      }
    }
    const resultat = lireImage({ width: largeur, height: hauteur, data });
    assert.equal(resultat.texte, 'MAT-2026-0007');
    assert.ok(resultat.lectures >= 2, `${resultat.lectures} lignes lues`);
    assert.equal(lireImage({ width: 320, height: 240, data: new Uint8ClampedArray(320 * 240 * 4).fill(128) }), null);
  });
});
