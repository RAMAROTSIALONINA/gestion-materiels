// Contrôle des données reçues par l'API. Chaque fonction rend la valeur
// nettoyée, ou lève une erreur 422 qui nomme le champ en cause.
import { ErreurApi } from '../middleware/erreurs.js';

const refus = (champ, message) => new ErreurApi(422, 'SAISIE_INVALIDE', message, { champ });

export function texte(valeur, { champ, libelle, obligatoire = false, max = 200, motif, messageMotif, majuscules = false } = {}) {
  if (typeof valeur === 'string' && majuscules) valeur = valeur.toUpperCase();
  if (valeur === undefined || valeur === null || (typeof valeur === 'string' && valeur.trim() === '')) {
    if (obligatoire) throw refus(champ, `${libelle} : information obligatoire.`);
    return null;
  }
  if (typeof valeur !== 'string') throw refus(champ, `${libelle} : texte attendu.`);
  const propre = valeur.trim();
  if (propre.length > max) throw refus(champ, `${libelle} : ${max} caractères au plus.`);
  if (motif && !motif.test(propre)) throw refus(champ, messageMotif ?? `${libelle} : format non valable.`);
  return propre;
}

export function identifiantNumerique(valeur, { champ, libelle, obligatoire = false } = {}) {
  if (valeur === undefined || valeur === null || valeur === '') {
    if (obligatoire) throw refus(champ, `${libelle} : information obligatoire.`);
    return null;
  }
  const nombre = Number(valeur);
  if (!Number.isSafeInteger(nombre) || nombre <= 0) throw refus(champ, `${libelle} : valeur non valable.`);
  return nombre;
}

export function choix(valeur, valeursPermises, { champ, libelle, obligatoire = false } = {}) {
  if (valeur === undefined || valeur === null || valeur === '') {
    if (obligatoire) throw refus(champ, `${libelle} : information obligatoire.`);
    return null;
  }
  if (!valeursPermises.includes(valeur)) throw refus(champ, `${libelle} : valeur non valable.`);
  return valeur;
}

const vide = (valeur) => valeur === undefined || valeur === null || (typeof valeur === 'string' && valeur.trim() === '');

// Date de gestion AAAA-MM-JJ (date réelle du calendrier).
export function date(valeur, { champ, libelle, obligatoire = false } = {}) {
  if (vide(valeur)) {
    if (obligatoire) throw refus(champ, `${libelle} : information obligatoire.`);
    return null;
  }
  const texteDate = String(valeur).trim();
  const [annee, mois, jour] = texteDate.split('-').map(Number);
  const reelle = new Date(Date.UTC(annee, mois - 1, jour));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texteDate) || reelle.getUTCMonth() !== mois - 1 || reelle.getUTCDate() !== jour) {
    throw refus(champ, `${libelle} : date non valable (format AAAA-MM-JJ).`);
  }
  return texteDate;
}

// Montant en Ariary : entier positif ou nul.
export function montant(valeur, { champ, libelle, obligatoire = false } = {}) {
  if (vide(valeur)) {
    if (obligatoire) throw refus(champ, `${libelle} : information obligatoire.`);
    return null;
  }
  const texteMontant = String(valeur).replace(/[\s  ]/g, '');
  if (!/^\d{1,15}$/.test(texteMontant)) throw refus(champ, `${libelle} : montant en Ariary, sans décimale.`);
  return Number(texteMontant);
}

// Quantité ou seuil : nombre positif ou nul, 3 décimales au plus (virgule acceptée).
export function quantite(valeur, { champ, libelle, obligatoire = false } = {}) {
  if (vide(valeur)) {
    if (obligatoire) throw refus(champ, `${libelle} : information obligatoire.`);
    return null;
  }
  const texteQuantite = String(valeur).replace(',', '.').replace(/[\s  ]/g, '');
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(texteQuantite)) {
    throw refus(champ, `${libelle} : nombre positif, 3 décimales au plus.`);
  }
  return Number(texteQuantite);
}

export function booleen(valeur, { champ, libelle } = {}) {
  if (typeof valeur === 'boolean') return valeur;
  throw refus(champ, `${libelle} : oui ou non attendu.`);
}

// Pagination des listes : ?page=2&par_page=25 (100 lignes au plus par page).
export function pagination(requete, { parDefaut = 25, maximum = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(requete.page, 10) || 1);
  const parPage = Math.min(maximum, Math.max(1, Number.parseInt(requete.par_page, 10) || parDefaut));
  return { page, parPage, decalage: (page - 1) * parPage };
}

// Texte recherché, prêt pour ILIKE (les caractères spéciaux sont neutralisés).
export function motifRecherche(valeur) {
  if (typeof valeur !== 'string' || valeur.trim() === '') return null;
  return `%${valeur.trim().slice(0, 100).replace(/[\\%_]/g, (caractere) => `\\${caractere}`)}%`;
}

// Filtre numérique facultatif d'une liste (?site_id=3).
export function filtreId(valeur) {
  const nombre = Number(valeur);
  return Number.isSafeInteger(nombre) && nombre > 0 ? nombre : null;
}

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const IDENTIFIANT = /^[a-zA-Z0-9._-]{3,40}$/;
export const CODE_REFERENTIEL = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
export const CODE_BIEN = /^[A-Z0-9][A-Z0-9._/-]{1,39}$/;
