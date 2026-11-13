// Lecture d'un code-barres Code 128 — le format des étiquettes imprimées par
// l'application (JsBarcode, format CODE128) — dans une image de la caméra.
// Sans bibliothèque extérieure (13/11) : on parcourt quelques lignes et
// colonnes de l'image, on mesure la largeur des barres et des espaces, puis
// on reconnaît les motifs et on contrôle la clé du code-barres.
// Module pur (aucun accès à la page) : il est testé tel quel par Node.

// Largeurs (en modules) des 107 motifs du Code 128 : barre, espace, barre…
// Valeurs 0 à 102, départs A, B, C (103 à 105), arrêt (106, 7 éléments).
const MOTIFS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212',
  '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321',
  '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
].map((motif) => [...motif].map(Number));

export const MOTIFS_CODE128 = MOTIFS;
const DEPARTS = { 103: 'A', 104: 'B', 105: 'C' };
const ARRET = 106;
const ECART_MOYEN_MAX = 0.25;      // écart moyen toléré entre la mesure et le motif
const ECART_TRAIT_MAX = 0.7;       // écart toléré sur une seule barre ou un seul espace (en modules)

// Écart entre les largeurs mesurées traits[debut…] (une barre d'abord) et un
// motif, rapporté à la largeur totale (0 = parfait). Infinity si une largeur
// est trop éloignée. Le flou et l'encre élargissent (ou amincissent) toutes
// les barres d'un même caractère d'une même quantité, prise sur les espaces :
// on l'estime et on la retire avant de comparer.
function ecart(traits, debut, motif) {
  let total = 0;
  let modules = 0;
  for (let j = 0; j < motif.length; j += 1) {
    total += traits[debut + j];
    modules += motif[j];
  }
  const unite = total / modules;
  let etalement = 0;
  for (let j = 0; j < motif.length; j += 1) {
    etalement += (j % 2 === 0 ? 1 : -1) * (traits[debut + j] - motif[j] * unite);
  }
  etalement = Math.max(-0.4 * unite, Math.min(0.4 * unite, etalement / motif.length));
  let somme = 0;
  for (let j = 0; j < motif.length; j += 1) {
    const difference = Math.abs(traits[debut + j] - motif[j] * unite - (j % 2 === 0 ? etalement : -etalement));
    if (difference > ECART_TRAIT_MAX * unite) return Infinity;
    somme += difference;
  }
  return somme / total;
}

function largeur(traits, debut, nombre) {
  let total = 0;
  for (let j = 0; j < nombre; j += 1) total += traits[debut + j];
  return total;
}

// Valeurs lues (départ, données…, clé) → texte, ou null si la clé est fausse.
function texteDesValeurs(valeurs) {
  if (valeurs.length < 3) return null;
  const cle = valeurs.at(-1);
  let somme = valeurs[0];
  for (let k = 1; k < valeurs.length - 1; k += 1) somme += k * valeurs[k];
  if (somme % 103 !== cle) return null;

  let jeu = DEPARTS[valeurs[0]];
  let decalage = false;
  let texte = '';
  for (let k = 1; k < valeurs.length - 1; k += 1) {
    const v = valeurs[k];
    const jeuCourant = decalage ? (jeu === 'A' ? 'B' : 'A') : jeu;
    decalage = false;
    if (v > 102) return null;
    if (jeuCourant === 'C') {
      if (v < 100) texte += String(v).padStart(2, '0');
      else if (v === 100) jeu = 'B';
      else if (v === 101) jeu = 'A';
      // 102 = FNC1 : ignoré
    } else if (v < 96) {
      texte += String.fromCharCode(jeuCourant === 'A' ? (v < 64 ? v + 32 : v - 64) : v + 32);
    } else if (v === 98) {
      decalage = true;
    } else if (v === 99) {
      jeu = 'C';
    } else if (v === 100 && jeuCourant === 'A') {
      jeu = 'B';
    } else if (v === 101 && jeuCourant === 'B') {
      jeu = 'A';
    }
    // 96, 97, 102 (FNC1 à 3) et FNC4 : ignorés
  }
  return texte && /^[\x20-\x7e]+$/.test(texte) ? texte : null;
}

// Largeurs alternées (espace de tête, barre, espace, barre…) → texte ou null.
// Les barres sont aux indices impairs.
export function lireTraits(traits) {
  for (let i = 1; i + 6 <= traits.length; i += 2) {
    const largeurDepart = largeur(traits, i, 6);
    // Une marge claire avant le départ (souple : les étiquettes n'ont que le bord de la planche).
    if (traits[i - 1] < largeurDepart * 0.2) continue;
    let depart = null;
    for (const code of [103, 104, 105]) {
      if (ecart(traits, i, MOTIFS[code]) < ECART_MOYEN_MAX) depart = code;
    }
    if (depart === null) continue;
    const texte = lireSymboles(traits, i, depart, largeurDepart);
    if (texte) return texte;
  }
  return null;
}

function lireSymboles(traits, i, depart, largeurDepart) {
  const valeurs = [depart];
  let position = i + 6;
  let largeurSymbole = largeurDepart;
  while (valeurs.length < 80) {
    // Motif d'arrêt (7 éléments, 13 modules) ?
    if (position + 7 <= traits.length) {
      const largeurArret = largeur(traits, position, 7);
      const attendue = largeurSymbole * 13 / 11;
      if (largeurArret > attendue * 0.7 && largeurArret < attendue * 1.3 && ecart(traits, position, MOTIFS[ARRET]) < ECART_MOYEN_MAX) {
        const texte = texteDesValeurs(valeurs);
        if (texte) return texte;
      }
    }
    if (position + 6 > traits.length) return null;
    const largeurCourante = largeur(traits, position, 6);
    if (largeurCourante < largeurSymbole * 0.7 || largeurCourante > largeurSymbole * 1.3) return null;
    let meilleure = -1;
    let meilleurEcart = ECART_MOYEN_MAX;
    for (let v = 0; v < 106; v += 1) {
      const e = ecart(traits, position, MOTIFS[v]);
      if (e < meilleurEcart) {
        meilleurEcart = e;
        meilleure = v;
      }
    }
    if (meilleure < 0 || meilleure > 102) return null;
    valeurs.push(meilleure);
    position += 6;
    largeurSymbole = largeurCourante;    // suit la perspective le long du code
  }
  return null;
}

// Ligne de luminances (0 = noir, 255 = blanc) → largeurs des traits, avec
// des bords placés au dixième de pixel près (interpolation). Le seuil suit la
// moyenne locale (éclairage inégal). Une zone unie est comptée comme claire :
// dans un code-barres, la fenêtre (≈ 9 modules au moins) contient toujours
// barres et espaces ; une zone unie est donc hors du code (marges, fond).
export function traitsDeLaLigne(lum) {
  const n = lum.length;
  let min = 255;
  let max = 0;
  for (let x = 0; x < n; x += 1) {
    if (lum[x] < min) min = lum[x];
    if (lum[x] > max) max = lum[x];
  }
  if (max - min < 40) return null;
  const demiFenetre = Math.max(8, Math.round(n / 40));
  const cumul = new Float64Array(n + 1);
  const cumulCarres = new Float64Array(n + 1);
  for (let x = 0; x < n; x += 1) {
    cumul[x + 1] = cumul[x] + lum[x];
    cumulCarres[x + 1] = cumulCarres[x] + lum[x] * lum[x];
  }
  const ecartUni = 0.1 * (max - min);
  const difference = new Float32Array(n);   // luminance − seuil : négatif = sombre
  const marge = new Float32Array(n);        // hystérésis, selon le contraste local
  for (let x = 0; x < n; x += 1) {
    const a = Math.max(0, x - demiFenetre);
    const b = Math.min(n, x + demiFenetre + 1);
    const moyenne = (cumul[b] - cumul[a]) / (b - a);
    const ecartType = Math.sqrt(Math.max(0, (cumulCarres[b] - cumulCarres[a]) / (b - a) - moyenne * moyenne));
    marge[x] = Math.max(2, 0.12 * ecartType);
    difference[x] = ecartType < ecartUni ? 2 * marge[x] : lum[x] - moyenne;
  }
  // Hystérésis : on ne change de couleur que si le signal dépasse nettement le
  // seuil, pour que le grain de l'image ne crée pas de faux bords ; le bord
  // est placé au dernier passage par le seuil.
  const bords = [];
  const debutSombre = difference[0] < -marge[0];
  let sombre = debutSombre;
  let passage = null;
  for (let x = 0; x + 1 < n; x += 1) {
    const d0 = difference[x];
    const d1 = difference[x + 1];
    if ((d0 < 0) !== (d1 < 0)) passage = x + 0.5 + d0 / (d0 - d1);
    if (sombre ? d1 > marge[x + 1] : d1 < -marge[x + 1]) {
      bords.push(passage ?? x + 1);
      sombre = !sombre;
      passage = null;
    }
  }
  // Commencer par le clair : si la ligne débute dans le sombre, espace de tête nul.
  const traits = [];
  let precedent = 0;
  if (debutSombre) traits.push(0);
  for (const bord of bords) {
    traits.push(bord - precedent);
    precedent = bord;
  }
  traits.push(n - precedent);
  return traits;
}

// Seconde méthode, pour une image floue : les bords sont les pics de la pente
// de luminance (descente = début de barre, montée = fin de barre), placés au
// dixième de pixel près. Une barre fine trop pâle pour franchir un seuil
// garde ses deux pics de pente.
export function traitsParLesBords(lum) {
  const n = lum.length;
  if (n < 20) return null;
  let min = 255;
  let max = 0;
  for (let x = 0; x < n; x += 1) {
    if (lum[x] < min) min = lum[x];
    if (lum[x] > max) max = lum[x];
  }
  if (max - min < 40) return null;
  // Pente lissée (1-2-1) entre x et x + 1.
  const brute = new Float32Array(n - 1);
  for (let x = 0; x + 1 < n; x += 1) brute[x] = lum[x + 1] - lum[x];
  const pente = new Float32Array(n - 1);
  for (let x = 0; x < n - 1; x += 1) {
    pente[x] = (brute[Math.max(0, x - 1)] + 2 * brute[x] + brute[Math.min(n - 2, x + 1)]) / 4;
  }
  // Seuil : un cinquième de la plus forte pente voisine, et au moins le grain de l'image.
  const demiFenetre = Math.max(8, Math.round(n / 40));
  const plancher = 0.04 * (max - min);
  const bords = [];          // { position, descente, force }
  let x = 0;
  while (x < n - 1) {
    const signe = Math.sign(pente[x]);
    if (signe === 0) { x += 1; continue; }
    let pic = x;
    while (x < n - 1 && Math.sign(pente[x]) === signe) {
      if (Math.abs(pente[x]) > Math.abs(pente[pic])) pic = x;
      x += 1;
    }
    const force = Math.abs(pente[pic]);
    let voisine = 0;
    for (let k = Math.max(0, pic - demiFenetre); k < Math.min(n - 1, pic + demiFenetre + 1); k += 1) {
      voisine = Math.max(voisine, Math.abs(pente[k]));
    }
    if (force < plancher || force < 0.2 * voisine) continue;
    // Sommet du pic par une parabole sur les trois points.
    const g0 = Math.abs(pente[Math.max(0, pic - 1)]);
    const g2 = Math.abs(pente[Math.min(n - 2, pic + 1)]);
    const courbure = g0 - 2 * force + g2;
    const decalage = courbure < 0 ? Math.max(-0.5, Math.min(0.5, (g0 - g2) / (2 * courbure))) : 0;
    const bord = { position: pic + 0.5 + decalage, descente: signe < 0, force };
    const dernier = bords.at(-1);
    if (dernier && dernier.descente === bord.descente) {
      if (bord.force > dernier.force) bords[bords.length - 1] = bord;   // deux bords de même sens : le plus net
    } else {
      bords.push(bord);
    }
  }
  if (bords.length < 10) return null;
  const traits = [];
  let precedent = 0;
  if (!bords[0].descente) traits.push(0);    // la ligne commence dans une barre
  for (const bord of bords) {
    traits.push(bord.position - precedent);
    precedent = bord.position;
  }
  traits.push(n - precedent);
  return traits;
}

// Moyenne glissante sur « largeur » pixels (atténue le grain d'une grande image).
function lisser(lum, largeur) {
  const n = lum.length;
  const demi = Math.floor(largeur / 2);
  const cumul = new Float64Array(n + 1);
  for (let x = 0; x < n; x += 1) cumul[x + 1] = cumul[x] + lum[x];
  const lisse = new Float32Array(n);
  for (let x = 0; x < n; x += 1) {
    const a = Math.max(0, x - demi);
    const b = Math.min(n, x + demi + 1);
    lisse[x] = (cumul[b] - cumul[a]) / (b - a);
  }
  return lisse;
}

function lireDansUnSens(lum) {
  for (const methode of [traitsDeLaLigne, traitsParLesBords]) {
    const traits = methode(lum);
    const texte = traits && lireTraits(traits);
    if (texte) return texte;
  }
  const traits = traitsParLesBords(lisser(lum, Math.max(3, Math.round(lum.length / 250))));
  return traits && lireTraits(traits);
}

// Une ligne de luminances → texte, dans les deux sens (étiquette à l'envers).
export function lireLigne(lum) {
  return lireDansUnSens(lum) ?? lireDansUnSens(Float32Array.from(lum).reverse());
}

const LIGNES = [0.5, 0.46, 0.54, 0.42, 0.58, 0.38, 0.62, 0.34, 0.66, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8];
const COLONNES = [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68];

// Image (comme ImageData : width, height, data RVBA) → { texte, lectures } ou
// null. « lectures » = nombre de lignes qui ont donné ce texte. Chaque ligne
// lue est la moyenne de 5 lignes voisines (le long des barres), contre le grain.
export function lireImage({ width, height, data }) {
  const comptes = new Map();
  const noter = (texte) => { if (texte) comptes.set(texte, (comptes.get(texte) ?? 0) + 1); };
  const luminance = (indice) => (data[indice] * 299 + data[indice + 1] * 587 + data[indice + 2] * 114) / 1000;
  const EPAISSEUR = 2;
  for (const part of LIGNES) {
    const centre = Math.min(height - 1 - EPAISSEUR, Math.max(EPAISSEUR, Math.round(part * height)));
    const lum = new Float32Array(width);
    for (let y = centre - EPAISSEUR; y <= centre + EPAISSEUR; y += 1) {
      for (let x = 0; x < width; x += 1) lum[x] += luminance((y * width + x) * 4) / (2 * EPAISSEUR + 1);
    }
    noter(lireLigne(lum));
  }
  for (const part of COLONNES) {
    const centre = Math.min(width - 1 - EPAISSEUR, Math.max(EPAISSEUR, Math.round(part * width)));
    const lum = new Float32Array(height);
    for (let x = centre - EPAISSEUR; x <= centre + EPAISSEUR; x += 1) {
      for (let y = 0; y < height; y += 1) lum[y] += luminance((y * width + x) * 4) / (2 * EPAISSEUR + 1);
    }
    noter(lireLigne(lum));
  }
  let meilleur = null;
  for (const [texte, lectures] of comptes) {
    if (!meilleur || lectures > meilleur.lectures) meilleur = { texte, lectures };
  }
  return meilleur;
}
