// Fichier CSV pour Excel (réglages français) : point-virgule entre les colonnes,
// virgule décimale, UTF-8 avec BOM (sinon Excel lit mal les accents), fins de
// ligne CRLF. Une cellule de texte qui commencerait par = + - @ est précédée
// d'une apostrophe : Excel ne doit jamais l'exécuter comme une formule.
import { formaterCellule } from './libelles.js';

const TYPES_NUMERIQUES = new Set(['nombre']);

function cellule(texte, numerique) {
  let valeur = texte;
  if (!numerique && /^[=+\-@\t\r]/.test(valeur)) valeur = `'${valeur}`;
  if (/[";\r\n]/.test(valeur)) valeur = `"${valeur.replaceAll('"', '""')}"`;
  return valeur;
}

export function versCsv(colonnes, lignes) {
  const entete = colonnes.map((colonne) => cellule(colonne.libelle, false)).join(';');
  const corps = lignes.map((ligne) => colonnes.map((colonne) => cellule(
    formaterCellule(ligne[colonne.cle], colonne.type, 'csv'), TYPES_NUMERIQUES.has(colonne.type),
  )).join(';'));
  return `﻿${[entete, ...corps].join('\r\n')}\r\n`;
}
