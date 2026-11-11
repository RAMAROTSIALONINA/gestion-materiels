// Articles consommables : liste avec stock et alertes, fiche (stock par site,
// seuils par site, derniers mouvements), création, modification.
// Cahier des charges § 3.3 ; décision du 11/11 : seuil global obligatoire et
// seuil par site facultatif. Le stock ne bouge que par les mouvements (phase 6).
import { Router } from 'express';
import { requete, transaction } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { ErreurApi } from '../middleware/erreurs.js';
import { differences, journaliser, miseAJour } from '../services/journal.js';
import {
  CODE_BIEN, booleen, filtreId, identifiantNumerique, motifRecherche, pagination, quantite, texte,
} from '../services/validation.js';

export const routeurArticles = Router();
const lecture = exigerDroit('articles.lire');
const gestion = exigerDroit('articles.gerer');

function lireSaisie(corps, partiel) {
  const present = (cle) => !partiel || Object.hasOwn(corps, cle);
  const s = {};
  if (!partiel) {
    s.code = texte(corps.code, {
      champ: 'code', libelle: 'Code', max: 40, majuscules: true, motif: CODE_BIEN,
      messageMotif: 'Code : majuscules, chiffres et . _ / - (laissez vide pour un code automatique).',
    });
  }
  if (present('designation')) s.designation = texte(corps.designation, { champ: 'designation', libelle: 'Désignation', obligatoire: true, max: 150 });
  if (present('categorie_id')) s.categorie_id = identifiantNumerique(corps.categorie_id, { champ: 'categorie_id', libelle: 'Catégorie', obligatoire: true });
  if (present('unite_code')) s.unite_code = texte(corps.unite_code, { champ: 'unite_code', libelle: 'Unité', obligatoire: true, max: 12 });
  if (present('seuil_minimum')) s.seuil_minimum = quantite(corps.seuil_minimum, { champ: 'seuil_minimum', libelle: 'Seuil minimum', obligatoire: true });
  if (present('site_stockage_id')) s.site_stockage_id = identifiantNumerique(corps.site_stockage_id, { champ: 'site_stockage_id', libelle: 'Magasin habituel' });
  if (present('emplacement')) s.emplacement = texte(corps.emplacement, { champ: 'emplacement', libelle: 'Emplacement', max: 80 });
  if (present('observations')) s.observations = texte(corps.observations, { champ: 'observations', libelle: 'Observations', max: 1000 });
  if (partiel && present('actif')) s.actif = booleen(corps.actif, { champ: 'actif', libelle: 'Actif' });
  return s;
}

// Un seuil ne peut pas avoir plus de décimales que son unité (pas de 2,5 boîtes).
async function controlerDecimales(client, uniteCode, valeur, champ) {
  if (valeur === null || valeur === undefined) return;
  const { rows: [unite] } = await client.query('SELECT libelle, decimales FROM unites WHERE code = $1', [uniteCode]);
  if (!unite) throw new ErreurApi(422, 'SAISIE_INVALIDE', 'Unité inconnue.', { champ: 'unite_code' });
  if (Number(valeur.toFixed(unite.decimales)) !== valeur) {
    throw new ErreurApi(422, 'SAISIE_INVALIDE',
      `Seuil : ${unite.decimales} décimale(s) au plus pour l’unité « ${unite.libelle} ».`, { champ });
  }
}

async function lireArticle(id, client) {
  const executant = client ?? { query: requete };
  const { rows: [article] } = await executant.query(
    `SELECT a.id, a.code, a.designation, a.categorie_id, c.nom AS categorie, a.unite_code, u.libelle AS unite,
            u.symbole, u.decimales, a.seuil_minimum, a.site_stockage_id, s.nom AS site_stockage, a.emplacement,
            a.actif, a.observations, a.cree_le, uc.nom AS cree_par_nom, a.modifie_le, um.nom AS modifie_par_nom,
            v.quantite_disponible, v.quantite_en_route, v.en_rupture, v.alerte_stock_faible,
            EXISTS (SELECT 1 FROM lignes_mouvements l WHERE l.article_id = a.id) AS unite_figee
       FROM articles a
       JOIN categories c ON c.id = a.categorie_id
       JOIN unites u ON u.code = a.unite_code
       JOIN v_stock_articles v ON v.article_id = a.id
       LEFT JOIN sites s ON s.id = a.site_stockage_id
       LEFT JOIN utilisateurs uc ON uc.id = a.cree_par
       LEFT JOIN utilisateurs um ON um.id = a.modifie_par
      WHERE a.id = $1`,
    [id],
  );
  return article ?? null;
}

routeurArticles.get('/articles', lecture, async (req, res) => {
  const { page, parPage, decalage } = pagination(req.query);
  const valeurs = [];
  const conditions = [];
  const ajouter = (condition, valeur) => {
    valeurs.push(valeur);
    conditions.push(condition.replaceAll('?', `$${valeurs.length}`));
  };
  const motif = motifRecherche(req.query.q);
  if (motif) ajouter('(v.code ILIKE ? OR v.designation ILIKE ?)', motif);
  const categorie = filtreId(req.query.categorie_id);
  if (categorie) ajouter('v.categorie_id = ?', categorie);
  if (req.query.alerte === 'oui') {
    conditions.push(`(v.alerte_stock_faible OR EXISTS (SELECT 1 FROM v_stock_articles_sites ss
                                                      WHERE ss.article_id = v.article_id AND ss.alerte_site))`);
  }
  if (req.query.rupture === 'oui') conditions.push('v.en_rupture');
  if (req.query.actif !== 'tous') conditions.push(req.query.actif === 'non' ? 'NOT v.actif' : 'v.actif');
  const ou = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: [{ total }] } = await requete(`SELECT count(*)::int AS total FROM v_stock_articles v ${ou}`, valeurs);
  const { rows } = await requete(
    `SELECT v.article_id AS id, v.code, v.designation, v.categorie, v.unite, v.symbole, v.seuil_minimum,
            v.quantite_disponible, v.quantite_en_route, v.en_rupture, v.alerte_stock_faible, v.actif,
            EXISTS (SELECT 1 FROM v_stock_articles_sites ss WHERE ss.article_id = v.article_id AND ss.alerte_site) AS alerte_site,
            s.nom AS site_stockage, v.emplacement
       FROM v_stock_articles v LEFT JOIN sites s ON s.id = v.site_stockage_id
       ${ou}
      ORDER BY lower(v.designation), v.code
      LIMIT ${parPage} OFFSET ${decalage}`,
    valeurs,
  );
  res.json({ articles: rows, total, page, par_page: parPage });
});

routeurArticles.get('/articles/:id', lecture, async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Article', obligatoire: true });
  const article = await lireArticle(id);
  if (!article) throw new ErreurApi(404, 'INTROUVABLE', 'Article introuvable.');
  const [sites, mouvements] = await Promise.all([
    requete(
      `SELECT site_id, site_code, site, quantite, seuil_site, alerte_site
         FROM v_stock_articles_sites WHERE article_id = $1 ORDER BY site`, [id]),
    requete(
      `SELECT mouvement_id, reference, date_mouvement, type, sens, statut, etat_transfert, quantite, quantite_recue,
              site_origine, site_destination, service_beneficiaire, employe_beneficiaire, motif, cree_par
         FROM v_mouvements_lignes WHERE article_id = $1
        ORDER BY date_mouvement DESC, mouvement_id DESC LIMIT 100`, [id]),
  ]);
  res.json({ article, sites: sites.rows, mouvements: mouvements.rows });
});

routeurArticles.post('/articles', gestion, async (req, res) => {
  const saisie = lireSaisie(req.body ?? {}, false);
  const article = await transaction(req.utilisateur.id, async (client) => {
    await controlerDecimales(client, saisie.unite_code, saisie.seuil_minimum, 'seuil_minimum');
    const colonnes = Object.keys(saisie).filter((colonne) => saisie[colonne] !== null || colonne === 'code');
    const { rows: [{ id, code }] } = await client.query(
      `INSERT INTO articles (${colonnes.join(', ')}) VALUES (${colonnes.map((_, rang) => `$${rang + 1}`).join(', ')}) RETURNING id, code`,
      colonnes.map((colonne) => saisie[colonne]),
    );
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'ARTICLE_CREE', entite: 'articles', entiteId: id,
      metadonnees: { code }, ip: req.ip,
    }, client);
    return lireArticle(id, client);
  });
  res.status(201).json({ article });
});

routeurArticles.patch('/articles/:id', gestion, async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Article', obligatoire: true });
  if (Object.hasOwn(req.body ?? {}, 'code')) {
    throw new ErreurApi(422, 'CHAMP_NON_MODIFIABLE', 'Le code d’un article ne change pas.', { champ: 'code' });
  }
  const saisie = lireSaisie(req.body ?? {}, true);
  if (Object.keys(saisie).length === 0) throw new ErreurApi(422, 'SAISIE_VIDE', 'Aucune modification reçue.');
  const article = await transaction(req.utilisateur.id, async (client) => {
    const { rows: [avant] } = await client.query('SELECT * FROM articles WHERE id = $1 FOR UPDATE', [id]);
    if (!avant) throw new ErreurApi(404, 'INTROUVABLE', 'Article introuvable.');
    await controlerDecimales(client, saisie.unite_code ?? avant.unite_code, saisie.seuil_minimum, 'seuil_minimum');
    const { texte: sql, valeurs } = miseAJour('articles', id, saisie);
    await client.query(sql, valeurs);
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'ARTICLE_MODIFIE', entite: 'articles', entiteId: id,
      metadonnees: differences(avant, saisie), ip: req.ip,
    }, client);
    return lireArticle(id, client);
  });
  res.json({ article });
});

// Seuil propre à un site (facultatif) : posé, modifié ou retiré.
routeurArticles.put('/articles/:id/seuils/:siteId', gestion, async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Article', obligatoire: true });
  const siteId = identifiantNumerique(req.params.siteId, { champ: 'site_id', libelle: 'Site', obligatoire: true });
  const seuil = quantite(req.body?.seuil_minimum, { champ: 'seuil_minimum', libelle: 'Seuil du site', obligatoire: true });
  if (seuil <= 0) {
    throw new ErreurApi(422, 'SAISIE_INVALIDE', 'Seuil du site : supérieur à zéro (pour ne plus suivre ce site, retirez son seuil).', { champ: 'seuil_minimum' });
  }
  await transaction(req.utilisateur.id, async (client) => {
    const { rows: [article] } = await client.query('SELECT unite_code FROM articles WHERE id = $1', [id]);
    if (!article) throw new ErreurApi(404, 'INTROUVABLE', 'Article introuvable.');
    await controlerDecimales(client, article.unite_code, seuil, 'seuil_minimum');
    await client.query(
      `INSERT INTO seuils_articles_sites (article_id, site_id, seuil_minimum) VALUES ($1, $2, $3)
       ON CONFLICT (article_id, site_id) DO UPDATE SET seuil_minimum = EXCLUDED.seuil_minimum`,
      [id, siteId, seuil],
    );
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'SEUIL_SITE_MODIFIE', entite: 'articles', entiteId: id,
      metadonnees: { site_id: siteId, seuil }, ip: req.ip,
    }, client);
  });
  res.json({ article: await lireArticle(id) });
});

routeurArticles.delete('/articles/:id/seuils/:siteId', gestion, async (req, res) => {
  const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Article', obligatoire: true });
  const siteId = identifiantNumerique(req.params.siteId, { champ: 'site_id', libelle: 'Site', obligatoire: true });
  await transaction(req.utilisateur.id, async (client) => {
    const { rowCount } = await client.query('DELETE FROM seuils_articles_sites WHERE article_id = $1 AND site_id = $2', [id, siteId]);
    if (rowCount === 0) throw new ErreurApi(404, 'INTROUVABLE', 'Aucun seuil pour ce site.');
    await journaliser({
      utilisateurId: req.utilisateur.id, action: 'SEUIL_SITE_RETIRE', entite: 'articles', entiteId: id,
      metadonnees: { site_id: siteId }, ip: req.ip,
    }, client);
  });
  res.json({ retire: true });
});
