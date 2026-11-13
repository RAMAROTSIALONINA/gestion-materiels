// Codage Code 128 B pour les codes-barres dessinés dans le rapport PDF.
// La table des motifs est celle du lecteur de la page de scan (module pur) :
// une seule source pour écrire et relire, donc aucun risque de divergence.
import { MOTIFS_CODE128 } from '../public/js/lecteur-code128.js';

const DEPART_B = 104;
const ARRET = 106;

// Suite de modules (chiffres 1 à 4, une barre d'abord) ou null si le texte
// sort du jeu B (codes ASCII 32 à 126 : lettres, chiffres, « - », « / »…).
export function modulesCode128(valeur) {
  const texte = String(valeur ?? '');
  if (texte.length === 0) return null;
  const valeurs = [];
  for (const caractere of texte) {
    const code = caractere.codePointAt(0);
    if (code < 32 || code > 126) return null;
    valeurs.push(code - 32);
  }
  let controle = DEPART_B;
  valeurs.forEach((valeur, rang) => { controle += valeur * (rang + 1); });
  return [DEPART_B, ...valeurs, controle % 103, ARRET]
    .map((valeur) => MOTIFS_CODE128[valeur].join(''))
    .join('');
}
