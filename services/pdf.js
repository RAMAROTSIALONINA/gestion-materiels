// Rapport PDF (A4 paysage), dans le style des documents remis à la Direction :
// une seule couleur (bleu nuit) avec du noir et des gris, en-tête centré, pas
// de traits — un bandeau gris pour l'en-tête du tableau, une ligne sur deux
// légèrement teintée. Pied de page : nom de la société, titre, « Page n / N ».
// Polices standard (Helvetica, codage WinAnsi) : les rares caractères hors de
// ce codage sont remplacés (flèches, espaces fines…).
import PDFDocument from 'pdfkit';
import { modulesCode128 } from './code-barres.js';
import { formaterCellule } from './libelles.js';

const BLEU_NUIT = '#1b3354';
const TEXTE = '#1f2328';
const GRIS = '#5f6672';
const BANDEAU = '#ededed';
const RAYURE = '#f8f8f8';
const TAILLE = 7.6;
const LIGNES_MAX = 3;          // une cellule trop longue est coupée après 3 lignes (…)
const MARGE_CELLULE = 4;
const NOIR = '#000000';
const LARGEUR_CODE_BARRES = 104;
const HAUTEUR_CODE_BARRES = 18;
const COLONNE_CODE_BARRES = { cle: '__code_barres', libelle: 'Code-barres', type: 'code-barres', largeur: 0 };

// Caractères que le codage WinAnsi des polices standard sait écrire.
const WINANSI_EN_PLUS = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
const REMPLACEMENTS = { '→': '>', '←': '<', '−': '-', '≤': '<=', '≥': '>=', ' ': ' ', ' ': ' ', ' ': ' ' };
export function texteWinAnsi(valeur) {
  return [...String(valeur ?? '')].map((caractere) => {
    const code = caractere.codePointAt(0);
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WINANSI_EN_PLUS.has(caractere)) return caractere;
    if (caractere === '\n' || caractere === '\t') return ' ';
    return REMPLACEMENTS[caractere] ?? '?';
  }).join('');
}

// Rend le fichier PDF (Buffer). Un code-barres Code 128 est ajouté pour chaque
// ligne quand `codeBarres` désigne la colonne qui porte le code du bien.
export function rapportPdf({ titre, societe, resume, edition, colonnes, lignes, codeBarres = null }) {
  return new Promise((resoudre, rejeter) => {
    const doc = new PDFDocument({
      size: 'A4', layout: 'landscape', bufferPages: true,
      margins: { top: 34, bottom: 42, left: 32, right: 32 },
      info: { Title: titre, Author: societe || 'Gestion des matériels', Creator: 'Gestion des matériels' },
    });
    const morceaux = [];
    doc.on('data', (morceau) => morceaux.push(morceau));
    doc.on('end', () => resoudre(Buffer.concat(morceaux)));
    doc.on('error', rejeter);

    const gauche = doc.page.margins.left;
    const largeur = doc.page.width - gauche - doc.page.margins.right;
    const bas = () => doc.page.height - doc.page.margins.bottom;
    const ecrire = (texte, x, y, options) => doc.text(texteWinAnsi(texte), x, y, { lineBreak: true, ...options });

    // En-tête du document (première page seulement), centré.
    let y = doc.page.margins.top;
    if (societe) {
      doc.font('Helvetica').fontSize(8).fillColor(GRIS);
      ecrire(societe.toUpperCase(), gauche, y, { width: largeur, align: 'center', characterSpacing: 1 });
      y = doc.y + 4;
    }
    doc.font('Helvetica-Bold').fontSize(16).fillColor(BLEU_NUIT);
    ecrire(titre, gauche, y, { width: largeur, align: 'center' });
    y = doc.y + 4;
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIS);
    if (resume) {
      ecrire(resume, gauche, y, { width: largeur, align: 'center' });
      y = doc.y + 2;
    }
    ecrire(edition, gauche, y, { width: largeur, align: 'center' });
    y = doc.y + 14;

    // Largeurs des colonnes : chacune vise sa part selon sa « largeur » relative,
    // sans descendre sous la place de son mot le plus long (un code, une
    // référence, un nom ne se coupent pas en deux ; plafond : un quart de page).
    // Ce qui manque est pris aux colonnes qui ont de la marge, à proportion.
    // Le code-barres a une largeur fixe, prise avant de répartir le reste.
    const rangSource = codeBarres ? colonnes.findIndex((colonne) => colonne.cle === codeBarres) : -1;
    const colonnesPdf = rangSource >= 0
      ? [...colonnes.slice(0, rangSource + 1), COLONNE_CODE_BARRES, ...colonnes.slice(rangSource + 1)]
      : colonnes;
    const rangCodeBarres = rangSource >= 0 ? rangSource + 1 : -1;
    const largeurTexte = largeur - (rangCodeBarres >= 0 ? LARGEUR_CODE_BARRES : 0);
    const textes = lignes.map((ligne) => colonnesPdf.map((colonne) => formaterCellule(ligne[colonne.cle], colonne.type, 'pdf')));
    const motLePlusLong = (texte, police) => {
      doc.font(police).fontSize(TAILLE);
      return Math.max(0, ...texteWinAnsi(texte).split(/\s+/).map((mot) => doc.widthOfString(mot)));
    };
    const minimums = colonnesPdf.map((colonne, rang) => (rang === rangCodeBarres ? LARGEUR_CODE_BARRES : Math.min(largeurTexte / 4, 2 * MARGE_CELLULE + 3 + Math.max(
      motLePlusLong(colonne.libelle, 'Helvetica-Bold'), ...textes.map((cellules) => motLePlusLong(cellules[rang], 'Helvetica')),
    ))));
    const somme = (valeurs) => valeurs.reduce((total, valeur) => total + valeur, 0);
    const poids = colonnesPdf.map((colonne, rang) => (rang === rangCodeBarres ? 0 : colonne.largeur ?? 1));
    const sommePoids = somme(poids) || 1;
    let largeurs = colonnesPdf.map((colonne, rang) => (rang === rangCodeBarres
      ? LARGEUR_CODE_BARRES
      : Math.max((largeurTexte * poids[rang]) / sommePoids, minimums[rang])));
    const exces = somme(largeurs) - largeur;
    if (exces > 0) {
      const marges = largeurs.map((valeur, rang) => (rang === rangCodeBarres ? 0 : valeur - minimums[rang]));
      const minimumsTexte = somme(minimums.filter((_, rang) => rang !== rangCodeBarres));
      largeurs = somme(marges) >= exces
        ? largeurs.map((valeur, rang) => (rang === rangCodeBarres ? valeur : valeur - (exces * marges[rang]) / somme(marges)))
        : minimums.map((minimum, rang) => (rang === rangCodeBarres ? minimum : (minimum * largeurTexte) / minimumsTexte));
    }
    const aDroite = (colonne) => colonne.type === 'nombre' || colonne.type === 'retard';

    // Barres noires du Code 128, avec une fenêtre claire de 10 modules de chaque
    // côté (indispensable à la lecture). Silencieux si le code sort du jeu B.
    function dessinerCodeBarres(valeur, x, y, largeurCellule, hauteur) {
      const modules = modulesCode128(valeur);
      if (!modules) return;
      // Chaque chiffre est une largeur en modules : le total donne l'unité.
      const totalModules = 20 + [...modules].reduce((total, chiffre) => total + Number(chiffre), 0);
      const module = largeurCellule / totalModules;
      const bas = y + hauteur;
      let position = x + 10 * module;
      doc.save();
      for (let rang = 0; rang < modules.length; rang += 1) {
        const largeurBarre = Number(modules[rang]) * module;
        if (rang % 2 === 0) doc.rect(position, y, largeurBarre, bas - y);
        position += largeurBarre;
      }
      doc.fillColor(NOIR).fill();
      doc.restore();
    }

    doc.font('Helvetica').fontSize(TAILLE);
    const hauteurLigne = doc.heightOfString('Ag', { width: 1000 });
    const hauteurMax = hauteurLigne * LIGNES_MAX;

    function rangee(textes, { gras = false, fond = null, ligne = null } = {}) {
      doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(TAILLE);
      const hauteurs = textes.map((texte, rang) => (rang === rangCodeBarres && ligne
        ? HAUTEUR_CODE_BARRES + 7
        : Math.min(doc.heightOfString(texteWinAnsi(texte) || ' ', { width: largeurs[rang] - 2 * MARGE_CELLULE }), hauteurMax)));
      const hauteur = Math.max(hauteurLigne, ...hauteurs) + 7;
      return {
        hauteur,
        dessiner(haut) {
          if (fond) doc.rect(gauche, haut, largeur, hauteur).fill(fond);
          doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(TAILLE).fillColor(gras ? BLEU_NUIT : TEXTE);
          let x = gauche;
          textes.forEach((texte, rang) => {
            if (rang === rangCodeBarres && ligne) {
              dessinerCodeBarres(ligne[codeBarres], x + MARGE_CELLULE, haut + 3.5, largeurs[rang] - 2 * MARGE_CELLULE, HAUTEUR_CODE_BARRES);
            } else {
              ecrire(texte, x + MARGE_CELLULE, haut + 3.5, {
                width: largeurs[rang] - 2 * MARGE_CELLULE, height: hauteurMax, ellipsis: true,
                align: aDroite(colonnesPdf[rang]) ? 'right' : 'left',
              });
            }
            x += largeurs[rang];
          });
        },
      };
    }

    const entete = () => {
      const ligneEntete = rangee(colonnesPdf.map((colonne) => colonne.libelle), { gras: true, fond: BANDEAU });
      ligneEntete.dessiner(y);
      y += ligneEntete.hauteur;
    };
    entete();

    if (lignes.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor(GRIS);
      ecrire('Aucune ligne ne correspond aux filtres choisis.', gauche, y + 14, { width: largeur, align: 'center' });
    }
    textes.forEach((cellules, rang) => {
      const rangeePdf = rangee(cellules, { fond: rang % 2 === 1 ? RAYURE : null, ligne: lignes[rang] });
      if (y + rangeePdf.hauteur > bas()) {
        doc.addPage();
        y = doc.page.margins.top;
        entete();
      }
      rangeePdf.dessiner(y);
      y += rangeePdf.hauteur;
    });

    // Pied de page de chaque feuille (marge basse levée le temps d'écrire dedans).
    const { start, count } = doc.bufferedPageRange();
    for (let rang = start; rang < start + count; rang += 1) {
      doc.switchToPage(rang);
      const margeBasse = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const hauteurPied = doc.page.height - 26;
      doc.font('Helvetica').fontSize(7.5).fillColor(GRIS);
      ecrire([societe, titre].filter(Boolean).join(' — '), gauche, hauteurPied, { width: largeur * 0.7, lineBreak: false });
      ecrire(`Page ${rang - start + 1} / ${count}`, gauche, hauteurPied, { width: largeur, align: 'right', lineBreak: false });
      doc.page.margins.bottom = margeBasse;
    }
    doc.end();
  });
}
