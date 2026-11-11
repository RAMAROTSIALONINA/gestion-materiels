// Mots de passe : chiffrement Argon2id, règles de choix, mots de passe provisoires.
import { randomInt } from 'node:crypto';
import argon2 from 'argon2';

// Réglages minimaux recommandés par l'OWASP pour Argon2id : sûrs, et sobres en
// mémoire pour l'offre gratuite de Render.
const REGLAGES = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const LONGUEUR_MINIMALE = 10;
const LONGUEUR_MAXIMALE = 128;

export function hacherMotDePasse(motDePasse) {
  return argon2.hash(motDePasse, REGLAGES);
}

let empreinteFactice;

// Vérifie un mot de passe. Pour un compte inconnu ou bloqué, fait quand même un
// calcul de même durée : le temps de réponse ne révèle rien.
export async function verifierMotDePasse(empreinte, motDePasse) {
  if (!empreinte) {
    empreinteFactice ??= await hacherMotDePasse('compte-inexistant');
    await argon2.verify(empreinteFactice, String(motDePasse)).catch(() => false);
    return false;
  }
  try {
    return await argon2.verify(empreinte, String(motDePasse));
  } catch {
    return false;
  }
}

// Vrai si l'empreinte a été calculée avec d'anciens réglages : on la refait à
// la prochaine connexion réussie.
export function doitRecalculer(empreinte) {
  try {
    return argon2.needsRehash(empreinte, REGLAGES);
  } catch {
    return false;
  }
}

// Règles de choix d'un mot de passe personnel. Rend le problème, ou null.
export function controlerNouveauMotDePasse(motDePasse, { email, identifiant } = {}) {
  if (typeof motDePasse !== 'string' || motDePasse.length < LONGUEUR_MINIMALE) {
    return `Le mot de passe doit compter au moins ${LONGUEUR_MINIMALE} caractères.`;
  }
  if (motDePasse.length > LONGUEUR_MAXIMALE) {
    return `Le mot de passe ne doit pas dépasser ${LONGUEUR_MAXIMALE} caractères.`;
  }
  if (/^(.)\1+$/u.test(motDePasse)) {
    return 'Le mot de passe ne peut pas répéter un seul caractère.';
  }
  const enMinuscules = motDePasse.toLowerCase();
  const interdits = [email, email?.split('@')[0], identifiant].filter((mot) => mot && mot.length >= 3);
  if (interdits.some((mot) => enMinuscules.includes(mot.toLowerCase()))) {
    return 'Le mot de passe ne doit pas contenir votre identifiant ni votre adresse e-mail.';
  }
  return null;
}

// Mot de passe provisoire facile à dicter : 3 groupes de 4 caractères sans
// lettres ni chiffres ambigus (0/O, 1/l/I), soit environ 69 bits de hasard.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function genererMotDePasseProvisoire() {
  const groupe = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${groupe()}-${groupe()}-${groupe()}`;
}
