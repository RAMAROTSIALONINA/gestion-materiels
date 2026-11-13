// Inventaire automatique du parc et des stocks. Rien ne se saisit ici : les
// matériels sont comptés à l'unité depuis leur fiche, les articles depuis les
// quantités tenues par les mouvements validés (vues de la base). Le responsable
// de service reste limité à son service et au site de ce service.
import { Router } from 'express';
import { requete } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { aLeDroit, perimetre } from '../middleware/permissions.js';
import { filtreId, motifRecherche, pagination } from '../services/validation.js';

export const routeurInventaire = Router();

// Conditions SQL paramétrées : « ? » devient $n dans l'ordre des valeurs.
function conditions() {
  const valeurs = [];
  const liste = [];
  return {
    valeurs,
    ajouter(condition, ...parametres) {
      let texte = condition;
      for (const valeur of parametres) {
        valeurs.push(valeur);
        texte = texte.replace('?', `$${valeurs.length}`);
      }
      liste.push(texte);
    },
    brut: (condition) => liste.push(condition),
    ou: () => (liste.length ? `WHERE ${liste.join(' AND ')}` : ''),
  };
}

// Périmètre : tout, ou le service du responsable et le site de ce service.
// Un service sans site (ou absent) est ramené à 0 : aucune ligne ne correspond.
async function contexte(utilisateur) {
  const { serviceId } = perimetre(utilisateur);
  if (serviceId === undefined) return { responsable: false, service: null, site: null };
  let site = null;
  if (serviceId) {
    const { rows: [service] } = await requete('SELECT site_id FROM services WHERE id = $1', [serviceId]);
    site = service?.site_id ?? null;
  }
  return { responsable: true, service: serviceId ?? 0, site: site ?? 0 };
}

const SYNTHESE_MATERIELS = `SELECT count(*) FILTER (WHERE v.statut NOT IN ('PERDU', 'REFORME'))::int AS total,
       count(*) FILTER (WHERE v.statut = 'DISPONIBLE')::int AS disponibles,
       count(*) FILTER (WHERE v.statut = 'AFFECTE')::int AS affectes,
       count(*) FILTER (WHERE v.statut = 'EN_REPARATION')::int AS en_reparation,
       count(*) FILTER (WHERE v.statut = 'EN_TRANSIT')::int AS en_transit,
       count(*) FILTER (WHERE v.etat = 'HORS_SERVICE' AND v.statut NOT IN ('PERDU', 'REFORME'))::int AS hors_service,
       count(*) FILTER (WHERE v.etat = 'ENDOMMAGE' AND v.statut NOT IN ('PERDU', 'REFORME'))::int AS endommages,
       count(*) FILTER (WHERE v.statut IN ('PERDU', 'REFORME'))::int AS sortis,
       count(*) FILTER (WHERE v.retour_en_retard)::int AS retours_en_retard
  FROM v_materiels v`;

// ---------------------------------------------------------------------------
// Synthèse des deux onglets, avec les filtres communs (recherche, site,
// catégorie). Elle suit les mêmes périmètres que les listes.
// ---------------------------------------------------------------------------
routeurInventaire.get('/inventaire/resume', exigerDroit('materiels.lire'), async (req, res) => {
  const ctx = await contexte(req.utilisateur);
  const q = motifRecherche(req.query.q);
  const categorie = filtreId(req.query.categorie_id);
  const siteDemande = filtreId(req.query.site_id);

  const fm = conditions();
  if (ctx.responsable) fm.ajouter('v.service_id = ?', ctx.service);
  if (siteDemande) fm.ajouter('v.site_id = ?', siteDemande);
  if (categorie) fm.ajouter('v.categorie_id = ?', categorie);
  if (q) {
    fm.ajouter(`(v.code ILIKE ? OR v.designation ILIKE ? OR coalesce(v.numero_serie, '') ILIKE ?
                 OR coalesce(v.marque, '') ILIKE ? OR coalesce(v.modele, '') ILIKE ?)`, q, q, q, q, q);
  }
  const { rows: [materiels] } = await requete(`${SYNTHESE_MATERIELS} ${fm.ou()}`, fm.valeurs);

  // Le site du responsable est imposé ; ailleurs, le filtre de site bascule la
  // synthèse sur les articles suivis à cet endroit.
  const site = ctx.responsable ? ctx.site : siteDemande;
  const parSite = site !== null && site !== undefined;
  let articles = null;
  if (aLeDroit(req.utilisateur.role_code, 'articles.lire')) {
    const fa = conditions();
    if (parSite) {
      fa.ajouter('k.site_id = ?', site);
      fa.brut('k.actif');
      if (categorie) fa.ajouter('a.categorie_id = ?', categorie);
      if (q) fa.ajouter('(k.code ILIKE ? OR k.designation ILIKE ?)', q, q);
      articles = (await requete(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE k.quantite > 0)::int AS en_stock,
                count(*) FILTER (WHERE k.alerte_site AND k.quantite > 0)::int AS sous_seuil,
                count(*) FILTER (WHERE k.quantite = 0)::int AS en_rupture
           FROM v_stock_articles_sites k JOIN articles a ON a.id = k.article_id ${fa.ou()}`, fa.valeurs,
      )).rows[0];
    } else {
      fa.brut('v.actif');
      if (categorie) fa.ajouter('v.categorie_id = ?', categorie);
      if (q) fa.ajouter('(v.code ILIKE ? OR v.designation ILIKE ?)', q, q);
      articles = (await requete(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE v.quantite_disponible > 0)::int AS en_stock,
                count(*) FILTER (WHERE v.alerte_stock_faible AND NOT v.en_rupture)::int AS sous_seuil,
                count(*) FILTER (WHERE v.en_rupture)::int AS en_rupture
           FROM v_stock_articles v ${fa.ou()}`, fa.valeurs,
      )).rows[0];
    }
    articles.par_site = parSite;
  }

  res.json({
    perimetre: ctx.responsable ? 'service' : 'tout',
    site: ctx.responsable ? ctx.site : null,
    materiels,
    articles,
  });
});

// ---------------------------------------------------------------------------
// Lignes de stock des articles : par site quand un site est demandé (ou imposé
// au responsable), tous sites sinon. Quantité, quantités en route vers ce site,
// seuil applicable et alertes.
// ---------------------------------------------------------------------------
routeurInventaire.get('/inventaire/articles', exigerDroit('articles.lire'), async (req, res) => {
  const ctx = await contexte(req.utilisateur);
  const { page, parPage, decalage } = pagination(req.query);
  const site = ctx.responsable ? ctx.site : filtreId(req.query.site_id);
  const parSite = site !== null && site !== undefined;
  const categorie = filtreId(req.query.categorie_id);
  const q = motifRecherche(req.query.q);
  const alerte = req.query.alerte === 'oui';
  const rupture = req.query.rupture === 'oui';

  const f = conditions();
  let depuis;
  let champs;
  let source;
  if (parSite) {
    source = 'k';
    f.ajouter('k.site_id = ?', site);
    f.brut('k.actif');
    if (categorie) f.ajouter('a.categorie_id = ?', categorie);
    if (q) f.ajouter('(k.code ILIKE ? OR k.designation ILIKE ?)', q, q);
    if (rupture) f.brut('k.quantite = 0');
    else if (alerte) f.brut('k.alerte_site AND k.quantite > 0');
    depuis = `FROM v_stock_articles_sites k
              JOIN articles a ON a.id = k.article_id
              JOIN categories c ON c.id = a.categorie_id
              JOIN unites u ON u.code = k.unite_code`;
    champs = `k.article_id AS id, k.code, k.designation, c.nom AS categorie,
              k.site_id, k.site_code, k.site, k.quantite, k.seuil_site AS seuil,
              k.alerte_site AS alerte, k.quantite = 0 AS en_rupture, u.symbole, u.decimales,
              (SELECT coalesce(sum(t.quantite), 0) FROM v_transferts_en_route t
                WHERE t.article_id = k.article_id AND t.site_destination_id = k.site_id) AS quantite_en_route`;
  } else {
    source = 'v';
    f.brut('v.actif');
    if (categorie) f.ajouter('v.categorie_id = ?', categorie);
    if (q) f.ajouter('(v.code ILIKE ? OR v.designation ILIKE ?)', q, q);
    if (rupture) f.brut('v.en_rupture');
    else if (alerte) f.brut('(v.alerte_stock_faible AND NOT v.en_rupture)');
    depuis = `FROM v_stock_articles v JOIN unites u ON u.code = v.unite_code`;
    champs = `v.article_id AS id, v.code, v.designation, v.categorie,
              NULL::bigint AS site_id, NULL::text AS site_code, NULL::text AS site,
              v.quantite_disponible AS quantite, v.seuil_minimum AS seuil,
              v.alerte_stock_faible AS alerte, v.en_rupture, v.quantite_en_route,
              u.symbole, u.decimales`;
  }
  const ou = f.ou();
  const { rows: [{ total }] } = await requete(`SELECT count(*)::int AS total ${depuis} ${ou}`, f.valeurs);
  const { rows } = await requete(
    `SELECT ${champs} ${depuis} ${ou}
      ORDER BY lower(${source}.designation), ${source}.code
      LIMIT ${parPage} OFFSET ${decalage}`,
    f.valeurs,
  );
  res.json({ articles: rows, total, page, par_page: parPage, par_site: parSite });
});
