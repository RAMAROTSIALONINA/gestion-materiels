// Tableau de bord et rapports (phase 8). Cahier des charges § 3.1 (tableau de
// bord), § 10 (rapports filtrables, export CSV prioritaire puis PDF), § 11
// test 12 (« fichier cohérent avec les filtres et les droits »).
// Décisions du 12/11 : sur le tableau de bord, le nombre d'articles sans
// quantités (les unités diffèrent) ; exports en CSV et en vrai fichier PDF.
// Le responsable de service ne voit et n'exporte que son service (décision du
// 11/11) ; chaque export est inscrit au journal des opérations.
import { Router } from 'express';
import { requete } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { ErreurApi } from '../middleware/erreurs.js';
import { aLeDroit, perimetre } from '../middleware/permissions.js';
import { versCsv } from '../services/csv.js';
import { journaliser } from '../services/journal.js';
import {
  ACTIONS, ALERTES, ENTITES, ETATS, NATURES, STATUTS, STATUTS_MOUVEMENT, formaterCellule,
} from '../services/libelles.js';
import { rapportPdf } from '../services/pdf.js';
import { date, filtreId, motifRecherche, pagination } from '../services/validation.js';
import { conditionPerimetre } from './mouvements.js';

export const routeurRapports = Router();

// Au-delà, l'export est refusé : il faut affiner les filtres.
export const LIMITES_EXPORT = { csv: 20000, pdf: 3000 };

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
    et: () => (liste.length ? `AND ${liste.join(' AND ')}` : ''),
  };
}

const periode = (c, colonne, f) => {
  if (f.debut) c.ajouter(`${colonne} >= ?`, f.debut);
  if (f.fin) c.ajouter(`${colonne} <= ?`, f.fin);
};

function lireFiltres(query) {
  const debut = date(query.date_debut, { champ: 'date_debut', libelle: 'Du' });
  const fin = date(query.date_fin, { champ: 'date_fin', libelle: 'Au' });
  if (debut && fin && debut > fin) {
    throw new ErreurApi(422, 'SAISIE_INVALIDE', 'La date « Du » doit précéder la date « Au ».', { champ: 'date_debut' });
  }
  const code = (valeur, motif) => (typeof valeur === 'string' && motif.test(valeur) ? valeur : null);
  return {
    q: motifRecherche(query.q),
    texte: typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '',
    debut,
    fin,
    categorie: filtreId(query.categorie_id),
    site: filtreId(query.site_id),
    service: filtreId(query.service_id),
    employe: filtreId(query.employe_id),
    utilisateur: filtreId(query.utilisateur_id),
    type: code(query.type_code, /^[A-Z_]{2,30}$/),
    action: code(query.action, /^[A-Z_]{2,40}$/),
    etat: Object.hasOwn(ETATS, query.etat ?? '') ? query.etat : null,
    statut: code(query.statut, /^[A-Z_]{2,30}$/),
    nature: Object.hasOwn(NATURES, query.nature ?? '') ? query.nature : null,
    alerte: query.alerte === 'oui',
  };
}

// Périmètre : tout, ou le service du responsable (et le site de ce service).
async function contexte(utilisateur) {
  const { serviceId } = perimetre(utilisateur);
  if (serviceId === undefined) return { utilisateur, responsable: false };
  let site = null;
  if (serviceId) {
    const { rows: [service] } = await requete('SELECT site_id FROM services WHERE id = $1', [serviceId]);
    site = service?.site_id ?? null;
  }
  // 0 ne correspond à aucune ligne : un responsable sans service (ou sans site) ne voit rien.
  return { utilisateur, responsable: true, service: serviceId ?? 0, site: site ?? 0 };
}

const EMPLOYE = "concat_ws(' ', e.nom, e.prenoms) || ' (' || e.matricule || ')'";

// ---------------------------------------------------------------------------
// Les rapports. Chaque colonne : cle, libelle, type (texte par défaut, date,
// dateheure, nombre, retard, etat, statut, statut_mouvement, alerte, nature,
// action), largeur relative dans le PDF, lien éventuel vers une fiche.
// ---------------------------------------------------------------------------
const RAPPORTS = {
  parc: {
    titre: 'État du parc',
    description: 'Les matériels avec leur état, leur statut, leur site et la personne qui les détient.',
    codeBarres: 'code',
    filtres: ['q', 'categorie', 'site', 'service', 'employe', 'etat', 'statut'],
    categories: 'MATERIEL',
    colonnes: [
      { cle: 'code', libelle: 'Code', lien: 'materiel', largeur: 1.15 },
      { cle: 'designation', libelle: 'Désignation', largeur: 2.3 },
      { cle: 'categorie', libelle: 'Catégorie', largeur: 1.1 },
      { cle: 'etat', libelle: 'État', type: 'etat', largeur: 0.85 },
      { cle: 'statut', libelle: 'Statut', type: 'statut', largeur: 0.95 },
      { cle: 'site', libelle: 'Site', largeur: 1.1 },
      { cle: 'service', libelle: 'Service', largeur: 1.3 },
      { cle: 'responsable', libelle: 'Responsable', largeur: 1.7 },
      { cle: 'date_retour_prevue', libelle: 'Retour prévu', type: 'date', largeur: 0.85 },
    ],
    construire(f, ctx) {
      const c = conditions();
      if (ctx.responsable) c.ajouter('v.service_id = ?', ctx.service);
      if (f.q) c.ajouter("(v.code ILIKE ? OR v.designation ILIKE ? OR coalesce(v.numero_serie, '') ILIKE ? OR coalesce(v.marque, '') ILIKE ?)", f.q, f.q, f.q, f.q);
      if (f.categorie) c.ajouter('v.categorie_id = ?', f.categorie);
      if (f.site) c.ajouter('v.site_id = ?', f.site);
      if (f.service) c.ajouter('v.service_id = ?', f.service);
      if (f.employe) c.ajouter('v.responsable_id = ?', f.employe);
      if (f.etat) c.ajouter('v.etat = ?', f.etat);
      if (Object.hasOwn(STATUTS, f.statut ?? '')) c.ajouter('v.statut = ?', f.statut);
      return {
        depuis: `FROM v_materiels v ${c.ou()}`,
        champs: `v.id AS materiel_id, v.code, v.designation, v.categorie, v.etat, v.statut, v.site, v.service,
                 CASE WHEN v.responsable IS NOT NULL THEN v.responsable || coalesce(' (' || v.responsable_matricule || ')', '') END AS responsable,
                 v.date_retour_prevue`,
        ordre: 'v.code',
        valeurs: c.valeurs,
      };
    },
  },

  mouvements: {
    titre: 'Mouvements',
    description: 'Une ligne par article ou matériel déplacé : entrées, sorties et transferts, avec leur auteur.',
    codeBarres: 'code_bien',
    filtres: ['q', 'periode', 'type', 'categorie', 'site', 'service', 'employe', 'statut_mouvement'],
    categories: 'TOUTES',
    colonnes: [
      { cle: 'date_mouvement', libelle: 'Date', type: 'date', largeur: 0.8 },
      { cle: 'type', libelle: 'Type', largeur: 1.25 },
      { cle: 'reference', libelle: 'Référence', lien: 'mouvement', largeur: 1.2 },
      { cle: 'numero_ticket', libelle: 'Ticket', largeur: 0.75 },
      { cle: 'code_bien', libelle: 'Code', lien: 'bien', largeur: 1.1 },
      { cle: 'designation', libelle: 'Article ou matériel', largeur: 1.9 },
      { cle: 'quantite', libelle: 'Quantité', type: 'nombre', largeur: 0.7 },
      { cle: 'unite', libelle: 'Unité', largeur: 0.5 },
      { cle: 'site_origine', libelle: 'Origine', largeur: 1 },
      { cle: 'site_destination', libelle: 'Destination', largeur: 1 },
      { cle: 'beneficiaire', libelle: 'Bénéficiaire', largeur: 1.3 },
      { cle: 'statut', libelle: 'Statut', type: 'statut_mouvement', largeur: 0.7 },
      { cle: 'cree_par', libelle: 'Saisi par', largeur: 1.25 },
    ],
    async construire(f, ctx) {
      const c = conditions();
      const limite = await conditionPerimetre(ctx.utilisateur, c.valeurs);
      if (limite) c.brut(limite);
      if (f.q) {
        c.ajouter("(l.reference ILIKE ? OR coalesce(l.numero_ticket, '') ILIKE ? OR l.code_bien ILIKE ? OR l.designation ILIKE ? OR coalesce(l.motif, '') ILIKE ?)",
          f.q, f.q, f.q, f.q, f.q);
      }
      periode(c, 'l.date_mouvement', f);
      if (f.type) c.ajouter('l.type_code = ?', f.type);
      if (f.categorie) c.ajouter('l.categorie_id = ?', f.categorie);
      if (f.site) c.ajouter('(l.site_source_id = ? OR l.site_destination_id = ?)', f.site, f.site);
      if (f.service) c.ajouter('(mv.service_beneficiaire_id = ? OR eb.service_id = ? OR mat.service_id = ?)', f.service, f.service, f.service);
      if (f.employe) c.ajouter('mv.employe_beneficiaire_id = ?', f.employe);
      if (Object.hasOwn(STATUTS_MOUVEMENT, f.statut ?? '')) c.ajouter('l.statut = ?', f.statut);
      return {
        depuis: `FROM v_mouvements_lignes l
                 JOIN mouvements mv ON mv.id = l.mouvement_id
                 LEFT JOIN employes eb ON eb.id = mv.employe_beneficiaire_id
                 LEFT JOIN materiels mat ON mat.id = l.materiel_id
                 LEFT JOIN unites u ON u.code = l.unite_code
                 LEFT JOIN sites so ON so.id = l.site_source_id
                 LEFT JOIN sites sd ON sd.id = l.site_destination_id
                 ${c.ou()}`,
        champs: `l.mouvement_id, l.materiel_id, l.article_id, l.date_mouvement, l.type, l.reference, l.numero_ticket,
                 l.code_bien, l.designation, l.quantite, u.symbole AS unite, so.nom AS site_origine, sd.nom AS site_destination,
                 coalesce(l.employe_beneficiaire, l.service_beneficiaire) AS beneficiaire, l.statut, l.cree_par`,
        ordre: 'l.date_mouvement DESC, l.mouvement_id DESC, l.ligne_id',
        valeurs: c.valeurs,
      };
    },
  },

  affectations: {
    titre: 'Affectations en cours',
    description: 'Les matériels remis aux employés et pas encore rendus, avec leur date de remise et leur état initial.',
    codeBarres: 'code',
    filtres: ['q', 'periode', 'categorie', 'site', 'service', 'employe', 'etat', 'retard'],
    categories: 'MATERIEL',
    colonnes: [
      { cle: 'code', libelle: 'Code', lien: 'materiel', largeur: 1.1 },
      { cle: 'designation', libelle: 'Matériel', largeur: 2 },
      { cle: 'employe', libelle: 'Employé', largeur: 1.7 },
      { cle: 'service', libelle: 'Service', largeur: 1.25 },
      { cle: 'numero_contrat', libelle: 'Contrat', largeur: 0.9 },
      { cle: 'date_remise', libelle: 'Remis le', type: 'date', largeur: 0.8 },
      { cle: 'etat_remise', libelle: 'État initial', type: 'etat', largeur: 0.8 },
      { cle: 'date_retour_prevue', libelle: 'Retour prévu', type: 'date', largeur: 0.85 },
      { cle: 'jours_de_retard', libelle: 'Retard', type: 'retard', largeur: 0.6 },
    ],
    construire(f, ctx) {
      const c = conditions();
      c.brut('af.date_retour IS NULL');
      if (ctx.responsable) c.ajouter('(e.service_id = ? OR m.service_id = ?)', ctx.service, ctx.service);
      if (f.q) {
        c.ajouter("(m.code ILIKE ? OR m.designation ILIKE ? OR e.matricule ILIKE ? OR e.nom ILIKE ? OR coalesce(e.prenoms, '') ILIKE ? OR af.numero_contrat ILIKE ?)",
          f.q, f.q, f.q, f.q, f.q, f.q);
      }
      periode(c, 'af.date_remise', f);
      if (f.categorie) c.ajouter('m.categorie_id = ?', f.categorie);
      if (f.site) c.ajouter('m.site_id = ?', f.site);
      if (f.service) c.ajouter('(e.service_id = ? OR m.service_id = ?)', f.service, f.service);
      if (f.employe) c.ajouter('af.employe_id = ?', f.employe);
      if (f.etat) c.ajouter('af.etat_remise = ?', f.etat);
      if (f.alerte) c.brut('af.date_retour_prevue < aujourdhui()');
      return {
        depuis: `FROM affectations af
                 JOIN materiels m ON m.id = af.materiel_id
                 JOIN employes e ON e.id = af.employe_id
                 LEFT JOIN services sv ON sv.id = e.service_id
                 ${c.ou()}`,
        champs: `af.materiel_id, m.code, m.designation, ${EMPLOYE} AS employe, sv.nom AS service, af.numero_contrat,
                 af.date_remise, af.etat_remise, af.date_retour_prevue, greatest(aujourdhui() - af.date_retour_prevue, 0) AS jours_de_retard`,
        ordre: 'af.date_retour_prevue, m.code',
        valeurs: c.valeurs,
      };
    },
  },

  retours: {
    titre: 'Retours',
    description: 'Les matériels rendus : date de retour, état constaté et observations.',
    codeBarres: 'code',
    filtres: ['q', 'periode', 'categorie', 'site', 'service', 'employe', 'etat'],
    categories: 'MATERIEL',
    colonnes: [
      { cle: 'date_retour', libelle: 'Rendu le', type: 'date', largeur: 0.8 },
      { cle: 'code', libelle: 'Code', lien: 'materiel', largeur: 1.1 },
      { cle: 'designation', libelle: 'Matériel', largeur: 1.7 },
      { cle: 'employe', libelle: 'Employé', largeur: 1.6 },
      { cle: 'numero_contrat', libelle: 'Contrat', largeur: 0.85 },
      { cle: 'date_retour_prevue', libelle: 'Retour prévu', type: 'date', largeur: 0.85 },
      { cle: 'jours_de_retard', libelle: 'Retard', type: 'retard', largeur: 0.6 },
      { cle: 'etat_retour', libelle: 'État au retour', type: 'etat', largeur: 0.9 },
      { cle: 'observations_retour', libelle: 'Observations', largeur: 2.1 },
      { cle: 'recu_par', libelle: 'Reçu par', largeur: 1.2 },
    ],
    construire(f, ctx) {
      const c = conditions();
      c.brut('af.date_retour IS NOT NULL');
      if (ctx.responsable) c.ajouter('(e.service_id = ? OR m.service_id = ?)', ctx.service, ctx.service);
      if (f.q) {
        c.ajouter("(m.code ILIKE ? OR m.designation ILIKE ? OR e.matricule ILIKE ? OR e.nom ILIKE ? OR af.numero_contrat ILIKE ? OR coalesce(af.observations_retour, '') ILIKE ?)",
          f.q, f.q, f.q, f.q, f.q, f.q);
      }
      periode(c, 'af.date_retour', f);
      if (f.categorie) c.ajouter('m.categorie_id = ?', f.categorie);
      if (f.site) c.ajouter('m.site_id = ?', f.site);
      if (f.service) c.ajouter('(e.service_id = ? OR m.service_id = ?)', f.service, f.service);
      if (f.employe) c.ajouter('af.employe_id = ?', f.employe);
      if (f.etat) c.ajouter('af.etat_retour = ?', f.etat);
      return {
        depuis: `FROM affectations af
                 JOIN materiels m ON m.id = af.materiel_id
                 JOIN employes e ON e.id = af.employe_id
                 LEFT JOIN utilisateurs ur ON ur.id = af.recu_par
                 ${c.ou()}`,
        champs: `af.materiel_id, af.date_retour, m.code, m.designation, ${EMPLOYE} AS employe, af.numero_contrat,
                 af.date_retour_prevue, greatest(af.date_retour - af.date_retour_prevue, 0) AS jours_de_retard,
                 af.etat_retour, af.observations_retour, ur.nom AS recu_par`,
        ordre: 'af.date_retour DESC, m.code',
        valeurs: c.valeurs,
      };
    },
  },

  stock: {
    titre: 'Stock des articles',
    description: 'Quantité disponible de chaque article, seuil minimum et alerte. Avec un site : le stock et le seuil propres à ce site.',
    codeBarres: 'code',
    filtres: ['q', 'categorie', 'site', 'alerte'],
    categories: 'ARTICLE',
    colonnes: [
      { cle: 'code', libelle: 'Code', lien: 'article', largeur: 1.1 },
      { cle: 'designation', libelle: 'Article', largeur: 2.4 },
      { cle: 'categorie', libelle: 'Catégorie', largeur: 1.3 },
      { cle: 'unite', libelle: 'Unité', largeur: 0.8 },
      { cle: 'quantite', libelle: 'Disponible', type: 'nombre', largeur: 0.9 },
      { cle: 'en_route', libelle: 'En route', type: 'nombre', largeur: 0.8 },
      { cle: 'seuil', libelle: 'Seuil minimum', type: 'nombre', largeur: 0.9 },
      { cle: 'alerte', libelle: 'Alerte', type: 'alerte', largeur: 0.9 },
    ],
    construire(f, ctx) {
      const c = conditions();
      // Le responsable voit le stock du site de son service.
      const site = ctx.responsable ? ctx.site : f.site;
      if (site) {
        c.ajouter('k.site_id = ?', site);
        c.brut('a.actif');
        if (f.q) c.ajouter('(a.code ILIKE ? OR a.designation ILIKE ?)', f.q, f.q);
        if (f.categorie) c.ajouter('a.categorie_id = ?', f.categorie);
        if (f.alerte) c.brut('k.alerte_site');
        return {
          depuis: `FROM v_stock_articles_sites k
                   JOIN articles a ON a.id = k.article_id
                   JOIN categories ca ON ca.id = a.categorie_id
                   JOIN unites u ON u.code = a.unite_code
                   ${c.ou()}`,
          champs: `k.article_id, a.code, a.designation, ca.nom AS categorie, u.libelle AS unite, k.quantite,
                   NULL::numeric AS en_route, k.seuil_site AS seuil,
                   CASE WHEN k.alerte_site THEN CASE WHEN k.quantite = 0 THEN 'RUPTURE' ELSE 'SOUS_SEUIL' END END AS alerte`,
          ordre: 'lower(a.designation)',
          valeurs: c.valeurs,
        };
      }
      c.brut('v.actif');
      if (f.q) c.ajouter('(v.code ILIKE ? OR v.designation ILIKE ?)', f.q, f.q);
      if (f.categorie) c.ajouter('v.categorie_id = ?', f.categorie);
      if (f.alerte) c.brut('(v.en_rupture OR v.alerte_stock_faible)');
      return {
        depuis: `FROM v_stock_articles v ${c.ou()}`,
        champs: `v.article_id, v.code, v.designation, v.categorie, v.unite, v.quantite_disponible AS quantite,
                 v.quantite_en_route AS en_route, v.seuil_minimum AS seuil,
                 CASE WHEN v.en_rupture THEN 'RUPTURE' WHEN v.alerte_stock_faible THEN 'SOUS_SEUIL' END AS alerte`,
        ordre: 'lower(v.designation)',
        valeurs: c.valeurs,
      };
    },
  },

  anomalies: {
    titre: 'Anomalies',
    description: 'Pertes, casses, manquants constatés à la réception des transferts, matériels en réparation et hors service.',
    codeBarres: 'code',
    filtres: ['q', 'periode', 'nature', 'categorie', 'site', 'service'],
    categories: 'TOUTES',
    colonnes: [
      { cle: 'date', libelle: 'Date', type: 'date', largeur: 0.8 },
      { cle: 'nature', libelle: 'Nature', type: 'nature', largeur: 1.15 },
      { cle: 'reference', libelle: 'Référence', lien: 'mouvement', largeur: 1.15 },
      { cle: 'code', libelle: 'Code', lien: 'bien', largeur: 1.1 },
      { cle: 'designation', libelle: 'Article ou matériel', largeur: 1.9 },
      { cle: 'quantite', libelle: 'Quantité', type: 'nombre', largeur: 0.7 },
      { cle: 'unite', libelle: 'Unité', largeur: 0.5 },
      { cle: 'site', libelle: 'Site', largeur: 1 },
      { cle: 'detail', libelle: 'Motif ou commentaire', largeur: 2.2 },
      { cle: 'par', libelle: 'Par', largeur: 1.2 },
    ],
    construire(f, ctx) {
      const c = conditions();
      if (ctx.responsable) c.ajouter('(a.service_id = ? OR (a.materiel_id IS NULL AND a.site_id = ?))', ctx.service, ctx.site);
      if (f.q) c.ajouter("(a.code ILIKE ? OR a.designation ILIKE ? OR coalesce(a.reference, '') ILIKE ? OR coalesce(a.detail, '') ILIKE ?)", f.q, f.q, f.q, f.q);
      periode(c, 'a.date', f);
      if (f.nature) c.ajouter('a.nature = ?', f.nature);
      if (f.categorie) c.ajouter('a.categorie_id = ?', f.categorie);
      if (f.site) c.ajouter('a.site_id = ?', f.site);
      if (f.service) c.ajouter('a.service_id = ?', f.service);
      return {
        depuis: `FROM (
                   SELECT CASE l.type_code WHEN 'PERTE' THEN 'PERTE' ELSE 'CASSE' END AS nature, l.date_mouvement AS date,
                          l.reference, l.mouvement_id, l.materiel_id, l.article_id, l.code_bien AS code, l.designation,
                          l.quantite, u.symbole AS unite, coalesce(l.site_source_id, l.site_destination_id) AS site_id,
                          l.motif AS detail, l.cree_par AS par, l.categorie_id, mat.service_id
                     FROM v_mouvements_lignes l
                     LEFT JOIN unites u ON u.code = l.unite_code
                     LEFT JOIN materiels mat ON mat.id = l.materiel_id
                    WHERE l.type_code IN ('PERTE', 'CASSE') AND l.statut = 'VALIDE'
                   UNION ALL
                   SELECT 'MANQUANT', e.date_reception, e.reference, e.mouvement_id, e.materiel_id, e.article_id, e.code_bien,
                          e.designation, e.quantite_manquante, u.symbole, lm.site_destination_id, e.motif_ecart, e.recu_par,
                          coalesce(ar.categorie_id, ma.categorie_id), ma.service_id
                     FROM v_ecarts_transferts e
                     JOIN lignes_mouvements lm ON lm.id = e.ligne_id
                     LEFT JOIN unites u ON u.code = e.unite_code
                     LEFT JOIN articles ar ON ar.id = e.article_id
                     LEFT JOIN materiels ma ON ma.id = e.materiel_id
                   UNION ALL
                   SELECT CASE WHEN m.etat = 'HORS_SERVICE' THEN 'HORS_SERVICE' ELSE 'REPARATION' END,
                          (h.date_changement AT TIME ZONE fuseau_horaire())::date, NULL, NULL, m.id, NULL, m.code, m.designation,
                          1, NULL, m.site_id, h.commentaire, uh.nom, m.categorie_id, m.service_id
                     FROM materiels m
                     LEFT JOIN LATERAL (
                       SELECT he.date_changement, he.commentaire, he.auteur_id FROM historiques_etats he
                        WHERE he.materiel_id = m.id ORDER BY he.date_changement DESC, he.id DESC LIMIT 1
                     ) h ON true
                     LEFT JOIN utilisateurs uh ON uh.id = h.auteur_id
                    WHERE m.statut = 'EN_REPARATION' OR (m.etat = 'HORS_SERVICE' AND m.statut NOT IN ('PERDU', 'REFORME'))
                 ) a
                 LEFT JOIN sites s ON s.id = a.site_id
                 ${c.ou()}`,
        champs: `a.date, a.nature, a.reference, a.mouvement_id, a.materiel_id, a.article_id, a.code, a.designation,
                 a.quantite, a.unite, s.nom AS site, a.detail, a.par`,
        ordre: 'a.date DESC NULLS LAST, a.code',
        valeurs: c.valeurs,
      };
    },
  },

  journal: {
    titre: 'Journal des opérations',
    description: 'Les opérations sensibles, avec leur auteur, leur date, leur adresse et leurs détails.',
    droit: 'journal.lire',
    filtres: ['q', 'periode', 'action', 'utilisateur'],
    colonnes: [
      { cle: 'date_action', libelle: 'Date', type: 'dateheure', largeur: 1 },
      { cle: 'utilisateur', libelle: 'Personne', largeur: 1.4 },
      { cle: 'action', libelle: 'Opération', type: 'action', largeur: 1.3 },
      { cle: 'objet', libelle: 'Objet', largeur: 1.1 },
      { cle: 'details', libelle: 'Détails', largeur: 4 },
      { cle: 'adresse_ip', libelle: 'Adresse', largeur: 0.9 },
    ],
    construire(f) {
      const c = conditions();
      if (f.q) {
        c.ajouter("(coalesce(j.entite, '') ILIKE ? OR j.metadonnees::text ILIKE ? OR coalesce(host(j.adresse_ip), '') ILIKE ?)", f.q, f.q, f.q);
      }
      periode(c, '(j.date_action AT TIME ZONE fuseau_horaire())::date', f);
      if (f.action) c.ajouter('j.action = ?', f.action);
      if (f.utilisateur) c.ajouter('j.utilisateur_id = ?', f.utilisateur);
      return {
        depuis: `FROM historique_actions j LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id ${c.ou()}`,
        champs: `to_char(j.date_action AT TIME ZONE fuseau_horaire(), 'YYYY-MM-DD"T"HH24:MI') AS date_action, u.nom AS utilisateur,
                 j.action, j.entite, j.entite_id, j.metadonnees, host(j.adresse_ip) AS adresse_ip`,
        ordre: 'j.date_action DESC, j.id DESC',
        valeurs: c.valeurs,
      };
    },
    // Objet et détails lisibles (« ancien > nouveau »).
    completer(ligne) {
      const lisible = (valeur) => ETATS[valeur] ?? STATUTS[valeur] ?? valeur ?? '—';
      const details = Object.entries(ligne.metadonnees ?? {}).map(([cle, valeur]) => {
        let texte;
        if (valeur && typeof valeur === 'object' && 'apres' in valeur) texte = `${lisible(valeur.avant)} > ${lisible(valeur.apres)}`;
        else if (valeur && typeof valeur === 'object') texte = JSON.stringify(valeur);
        else texte = String(valeur);
        return `${cle.replaceAll('_', ' ')} : ${texte}`;
      }).join(' · ');
      const { metadonnees, ...reste } = ligne;
      return {
        ...reste,
        objet: ligne.entite ? `${ENTITES[ligne.entite] ?? ligne.entite}${ligne.entite_id ? ` n° ${ligne.entite_id}` : ''}` : '',
        details,
      };
    },
  },
};

const droitDu = (rapport) => rapport.droit ?? 'rapports.lire';

function rapportDemande(req) {
  const rapport = Object.hasOwn(RAPPORTS, req.params.code) ? RAPPORTS[req.params.code] : null;
  if (!rapport) throw new ErreurApi(404, 'INTROUVABLE', 'Rapport inconnu.');
  if (!aLeDroit(req.utilisateur.role_code, droitDu(rapport))) {
    throw new ErreurApi(403, 'ACCES_REFUSE', 'Ce rapport ne vous est pas ouvert.');
  }
  return rapport;
}

async function executer(rapport, f, ctx, { limite, decalage = 0 }) {
  const { depuis, champs, ordre, valeurs } = await rapport.construire(f, ctx);
  const { rows: [{ total }] } = await requete(`SELECT count(*)::int AS total ${depuis}`, valeurs);
  if (limite === 0) return { total, lignes: [] };
  const { rows } = await requete(
    `SELECT ${champs} ${depuis} ORDER BY ${ordre} LIMIT ${Number(limite)} OFFSET ${Number(decalage)}`, valeurs,
  );
  return { total, lignes: rapport.completer ? rows.map(rapport.completer) : rows };
}

// ---------------------------------------------------------------------------
// Liste des rapports ouverts à ce compte, et de quoi remplir les filtres.
// ---------------------------------------------------------------------------
routeurRapports.get('/rapports/options', exigerDroit('rapports.lire'), async (req, res) => {
  const role = req.utilisateur.role_code;
  const ctx = await contexte(req.utilisateur);
  const employes = ctx.responsable
    ? await requete(`SELECT id, matricule, concat_ws(' ', nom, prenoms) AS nom FROM employes WHERE service_id = $1 ORDER BY nom, prenoms`, [ctx.service])
    : await requete("SELECT id, matricule, concat_ws(' ', nom, prenoms) AS nom FROM employes ORDER BY nom, prenoms");
  const [sites, services, categories, types] = await Promise.all([
    requete('SELECT id, nom FROM sites ORDER BY nom'),
    requete('SELECT id, nom, site_id FROM services ORDER BY nom'),
    requete('SELECT id, nom, type FROM categories ORDER BY type, nom'),
    requete('SELECT code, libelle FROM types_mouvements ORDER BY ordre'),
  ]);
  const journal = aLeDroit(role, 'journal.lire');
  const [utilisateurs, actions] = journal
    ? await Promise.all([
      requete('SELECT id, nom FROM utilisateurs ORDER BY nom'),
      requete('SELECT DISTINCT action FROM historique_actions ORDER BY action'),
    ])
    : [{ rows: [] }, { rows: [] }];
  res.json({
    rapports: Object.entries(RAPPORTS)
      .filter(([, rapport]) => aLeDroit(role, droitDu(rapport)))
      .map(([code, { titre, description, filtres, categories: typesCategories, colonnes }]) => ({
        code, titre, description, filtres, categories: typesCategories ?? null, colonnes,
      })),
    exporter: aLeDroit(role, 'rapports.exporter'),
    responsable: ctx.responsable,
    limites: LIMITES_EXPORT,
    sites: sites.rows,
    services: ctx.responsable ? services.rows.filter((service) => service.id === ctx.service) : services.rows,
    categories: categories.rows,
    employes: employes.rows,
    types: types.rows,
    utilisateurs: utilisateurs.rows,
    actions: actions.rows.map((ligne) => ({ code: ligne.action, libelle: ACTIONS[ligne.action] ?? ligne.action })),
    libelles: { etats: ETATS, statuts: STATUTS, statuts_mouvement: STATUTS_MOUVEMENT, alertes: ALERTES, natures: NATURES, actions: ACTIONS },
  });
});

// Aperçu à l'écran, page par page.
routeurRapports.get('/rapports/:code', exigerDroit('rapports.lire'), async (req, res) => {
  const rapport = rapportDemande(req);
  const f = lireFiltres(req.query);
  const { page, parPage, decalage } = pagination(req.query, { parDefaut: 50 });
  const { total, lignes } = await executer(rapport, f, await contexte(req.utilisateur), { limite: parPage, decalage });
  res.json({ code: req.params.code, titre: rapport.titre, colonnes: rapport.colonnes, lignes, total, page, par_page: parPage });
});

// Résumé des filtres, écrit en tête du PDF et dans le journal.
async function resumeFiltres(rapport, f) {
  const nom = async (table, id, colonne = 'nom') => {
    if (!id) return null;
    const { rows: [ligne] } = await requete(`SELECT ${colonne} AS nom FROM ${table} WHERE id = $1`, [id]);
    return ligne?.nom ?? null;
  };
  const morceaux = [];
  const jour = (valeur) => formaterCellule(valeur, 'date');
  if (f.debut && f.fin) morceaux.push(`Du ${jour(f.debut)} au ${jour(f.fin)}`);
  else if (f.debut) morceaux.push(`Depuis le ${jour(f.debut)}`);
  else if (f.fin) morceaux.push(`Jusqu’au ${jour(f.fin)}`);
  const ajouter = (libelle, valeur) => { if (valeur) morceaux.push(`${libelle} : ${valeur}`); };
  const utilise = (filtre) => rapport.filtres.includes(filtre);
  if (utilise('type') && f.type) ajouter('Type', (await requete('SELECT libelle FROM types_mouvements WHERE code = $1', [f.type])).rows[0]?.libelle);
  if (utilise('categorie')) ajouter('Catégorie', await nom('categories', f.categorie));
  if (utilise('site')) ajouter('Site', await nom('sites', f.site));
  if (utilise('service')) ajouter('Service', await nom('services', f.service));
  if (utilise('employe')) ajouter('Employé', await nom('employes', f.employe, "concat_ws(' ', nom, prenoms)"));
  if (utilise('utilisateur')) ajouter('Personne', await nom('utilisateurs', f.utilisateur));
  if (utilise('action') && f.action) ajouter('Opération', ACTIONS[f.action] ?? f.action);
  if (utilise('etat') && f.etat) ajouter('État', ETATS[f.etat]);
  if (utilise('statut') && f.statut) ajouter('Statut', STATUTS[f.statut]);
  if (utilise('statut_mouvement') && f.statut) ajouter('Statut', STATUTS_MOUVEMENT[f.statut]);
  if (utilise('nature') && f.nature) ajouter('Nature', NATURES[f.nature]);
  if (utilise('alerte') && f.alerte) morceaux.push('Articles en alerte seulement');
  if (utilise('retard') && f.alerte) morceaux.push('En retard seulement');
  if (utilise('q') && f.texte) morceaux.push(`Recherche : « ${f.texte} »`);
  return morceaux;
}

// Export CSV ou PDF : mêmes filtres et même périmètre que l'aperçu ; inscrit au journal.
routeurRapports.get('/rapports/:code/export/:format', exigerDroit('rapports.exporter'), async (req, res) => {
  const rapport = rapportDemande(req);
  const format = req.params.format;
  if (!Object.hasOwn(LIMITES_EXPORT, format)) throw new ErreurApi(404, 'INTROUVABLE', 'Format d’export inconnu (csv ou pdf).');
  const f = lireFiltres(req.query);
  const ctx = await contexte(req.utilisateur);
  const limite = LIMITES_EXPORT[format];
  const { total: compte } = await executer(rapport, f, ctx, { limite: 0 });
  if (compte > limite) {
    throw new ErreurApi(422, 'TROP_DE_LIGNES',
      `${compte} lignes : l’export ${format.toUpperCase()} est limité à ${limite.toLocaleString('fr-FR')} lignes. Affinez les filtres (période, site…)${format === 'pdf' ? ' ou exportez en CSV' : ''}.`);
  }
  const { lignes } = await executer(rapport, f, ctx, { limite });
  const morceaux = await resumeFiltres(rapport, f);
  if (ctx.responsable) morceaux.unshift('Périmètre : votre service');
  const { rows: [moment] } = await requete(
    `SELECT aujourdhui()::text AS jour, to_char(now() AT TIME ZONE fuseau_horaire(), 'DD/MM/YYYY à HH24:MI') AS maintenant,
            parametre('nom_societe') AS societe`,
  );
  await journaliser({
    utilisateurId: req.utilisateur.id, action: 'EXPORT_RAPPORT', entite: 'rapports',
    metadonnees: { rapport: rapport.titre, format: format.toUpperCase(), lignes: lignes.length, filtres: morceaux.join(' · ') || 'aucun' },
    ip: req.ip,
  });

  const nomFichier = `rapport-${req.params.code}-${moment.jour}.${format}`;
  res.set('Cache-Control', 'no-store');
  res.attachment(nomFichier);
  if (format === 'csv') {
    res.type('text/csv; charset=utf-8').send(versCsv(rapport.colonnes, lignes));
    return;
  }
  const pdf = await rapportPdf({
    titre: rapport.titre,
    // « À renseigner » (valeur d'installation) n'est pas un nom de société : rien n'est écrit.
    societe: moment.societe && moment.societe !== 'À renseigner' ? moment.societe : null,
    resume: [...morceaux, `${lignes.length} ligne${lignes.length > 1 ? 's' : ''}`].join(' · '),
    edition: `Édité le ${moment.maintenant} par ${req.utilisateur.nom}`,
    colonnes: rapport.colonnes,
    lignes,
    codeBarres: rapport.codeBarres ?? null,
  });
  res.type('application/pdf').send(pdf);
});

// ---------------------------------------------------------------------------
// Tableau de bord (§ 3.1) : cartes de synthèse, alertes de stock, mouvements
// récents, avec filtres de période, site, service et catégorie.
// ---------------------------------------------------------------------------
routeurRapports.get('/tableau-de-bord', exigerDroit('rapports.lire'), async (req, res) => {
  const f = lireFiltres(req.query);
  const ctx = await contexte(req.utilisateur);
  // Période par défaut : les 30 derniers jours.
  const { rows: [bornes] } = await requete(
    'SELECT coalesce($1::date, aujourdhui())::text AS fin, coalesce($2::date, coalesce($1::date, aujourdhui()) - 29)::text AS debut',
    [f.fin, f.debut],
  );
  if (bornes.debut > bornes.fin) {
    throw new ErreurApi(422, 'SAISIE_INVALIDE', 'La date « Du » doit précéder la date « Au ».', { champ: 'date_debut' });
  }
  // Périmètre des mouvements, calculé avant de lancer les requêtes en parallèle.
  const cv = conditions();
  cv.brut("mv.statut = 'VALIDE'");
  const limite = await conditionPerimetre(req.utilisateur, cv.valeurs);
  if (limite) cv.brut(limite);

  // Matériels.
  const cm = conditions();
  if (ctx.responsable) cm.ajouter('v.service_id = ?', ctx.service);
  if (f.site) cm.ajouter('v.site_id = ?', f.site);
  if (f.service) cm.ajouter('v.service_id = ?', f.service);
  if (f.categorie) cm.ajouter('v.categorie_id = ?', f.categorie);
  const materiels = requete(
    `SELECT count(*) FILTER (WHERE v.statut NOT IN ('PERDU', 'REFORME'))::int AS total,
            count(*) FILTER (WHERE v.statut = 'DISPONIBLE')::int AS disponibles,
            count(*) FILTER (WHERE v.statut = 'AFFECTE')::int AS affectes,
            count(*) FILTER (WHERE v.statut = 'EN_REPARATION')::int AS en_reparation,
            count(*) FILTER (WHERE v.statut = 'EN_TRANSIT')::int AS en_transit,
            count(*) FILTER (WHERE v.etat = 'HORS_SERVICE' AND v.statut NOT IN ('PERDU', 'REFORME'))::int AS hors_service,
            count(*) FILTER (WHERE v.etat = 'ENDOMMAGE' AND v.statut NOT IN ('PERDU', 'REFORME'))::int AS endommages,
            count(*) FILTER (WHERE v.statut IN ('PERDU', 'REFORME'))::int AS sortis,
            count(*) FILTER (WHERE v.retour_en_retard)::int AS retours_en_retard
       FROM v_materiels v ${cm.ou()}`, cm.valeurs);
  // Répartition par statut, pour le graphique du parc (mêmes filtres que les cartes).
  const repartition = requete(
    `SELECT v.statut, count(*)::int AS nombre FROM v_materiels v ${cm.ou()} GROUP BY v.statut`, cm.valeurs);

  // Articles : leur nombre seulement (décision du 12/11) ; avec un site, ceux suivis sur ce site.
  const site = ctx.responsable ? ctx.site : f.site;
  const ca = conditions();
  let articles;
  let alertes;
  if (site) {
    ca.ajouter('k.site_id = ?', site);
    ca.brut('k.actif');
    if (f.categorie) ca.ajouter('a.categorie_id = ?', f.categorie);
    articles = requete(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE k.quantite > 0)::int AS en_stock,
              count(*) FILTER (WHERE k.alerte_site AND k.quantite > 0)::int AS sous_seuil,
              count(*) FILTER (WHERE k.quantite = 0)::int AS en_rupture
         FROM v_stock_articles_sites k JOIN articles a ON a.id = k.article_id ${ca.ou()}`, ca.valeurs);
  } else {
    ca.brut('v.actif');
    if (f.categorie) ca.ajouter('v.categorie_id = ?', f.categorie);
    articles = requete(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE v.quantite_disponible > 0)::int AS en_stock,
              count(*) FILTER (WHERE v.alerte_stock_faible AND NOT v.en_rupture)::int AS sous_seuil,
              count(*) FILTER (WHERE v.en_rupture)::int AS en_rupture
         FROM v_stock_articles v ${ca.ou()}`, ca.valeurs);
  }
  {
    const cs = conditions();
    if (site) cs.ajouter("al.portee = 'SITE' AND al.site_id = ?", site);
    else cs.brut("al.portee = 'GLOBAL'");
    if (f.categorie) cs.ajouter('ar.categorie_id = ?', f.categorie);
    alertes = requete(
      `SELECT al.article_id, al.code, al.designation, al.quantite, al.seuil, al.en_rupture, s.nom AS site, u.symbole, u.decimales,
              count(*) OVER ()::int AS total
         FROM v_alertes_stock al
         JOIN articles ar ON ar.id = al.article_id
         JOIN unites u ON u.code = al.unite_code
         LEFT JOIN sites s ON s.id = al.site_id
         ${cs.ou()}
        ORDER BY al.en_rupture DESC, lower(al.designation)
        LIMIT 6`, cs.valeurs);
  }

  // Mouvements validés de la période : nombre par sens, et les plus récents.
  cv.ajouter('mv.date_mouvement BETWEEN ? AND ?', bornes.debut, bornes.fin);
  if (f.site) {
    cv.ajouter('EXISTS (SELECT 1 FROM lignes_mouvements lx WHERE lx.mouvement_id = mv.id AND (lx.site_source_id = ? OR lx.site_destination_id = ?))', f.site, f.site);
  }
  if (f.categorie) {
    cv.ajouter(`EXISTS (SELECT 1 FROM lignes_mouvements lx LEFT JOIN articles ax ON ax.id = lx.article_id
                 LEFT JOIN materiels mx ON mx.id = lx.materiel_id
                 WHERE lx.mouvement_id = mv.id AND coalesce(ax.categorie_id, mx.categorie_id) = ?)`, f.categorie);
  }
  if (f.service) {
    cv.ajouter(`(mv.service_beneficiaire_id = ?
                 OR EXISTS (SELECT 1 FROM employes ex WHERE ex.id = mv.employe_beneficiaire_id AND ex.service_id = ?)
                 OR EXISTS (SELECT 1 FROM lignes_mouvements lx JOIN materiels mx ON mx.id = lx.materiel_id
                             WHERE lx.mouvement_id = mv.id AND mx.service_id = ?))`, f.service, f.service, f.service);
  }
  const depuisMouvements = `FROM mouvements mv JOIN types_mouvements t ON t.code = mv.type_code ${cv.ou()}`;
  const mouvements = requete(
    `SELECT count(*) FILTER (WHERE t.sens = 'ENTREE')::int AS entrees,
            count(*) FILTER (WHERE t.sens = 'SORTIE')::int AS sorties,
            count(*) FILTER (WHERE t.sens = 'TRANSFERT')::int AS transferts
       ${depuisMouvements}`, cv.valeurs);
  const recents = requete(
    `SELECT mv.id, mv.reference, mv.date_mouvement, t.libelle AS type, t.sens, mv.statut, mv.recu_le IS NULL AND t.sens = 'TRANSFERT' AS en_route,
            (SELECT coalesce(ax.designation, mx.designation) FROM lignes_mouvements lx
               LEFT JOIN articles ax ON ax.id = lx.article_id LEFT JOIN materiels mx ON mx.id = lx.materiel_id
              WHERE lx.mouvement_id = mv.id ORDER BY lx.id LIMIT 1) AS premiere_ligne,
            (SELECT count(*)::int FROM lignes_mouvements lx WHERE lx.mouvement_id = mv.id) AS nb_lignes,
            (SELECT sx.nom FROM lignes_mouvements lx JOIN sites sx ON sx.id = lx.site_source_id WHERE lx.mouvement_id = mv.id LIMIT 1) AS site_origine,
            (SELECT sx.nom FROM lignes_mouvements lx JOIN sites sx ON sx.id = lx.site_destination_id WHERE lx.mouvement_id = mv.id LIMIT 1) AS site_destination
       ${depuisMouvements}
      ORDER BY mv.date_mouvement DESC, mv.id DESC
      LIMIT 8`, cv.valeurs);
  // Série quotidienne (jours sans mouvement absents), pour le graphique de la période.
  const serie = requete(
    `SELECT mv.date_mouvement::text AS jour,
            count(*) FILTER (WHERE t.sens = 'ENTREE')::int AS entrees,
            count(*) FILTER (WHERE t.sens = 'SORTIE')::int AS sorties,
            count(*) FILTER (WHERE t.sens = 'TRANSFERT')::int AS transferts
       ${depuisMouvements}
      GROUP BY mv.date_mouvement
      ORDER BY mv.date_mouvement`, cv.valeurs);

  const [m, a, al, mvt, rec, st, ser] = await Promise.all([materiels, articles, alertes, mouvements, recents, repartition, serie]);
  const statuts = Object.fromEntries(Object.keys(STATUTS).map((code) => [code, 0]));
  for (const ligne of st.rows) if (Object.hasOwn(statuts, ligne.statut)) statuts[ligne.statut] = ligne.nombre;
  res.json({
    periode: { debut: bornes.debut, fin: bornes.fin },
    perimetre: ctx.responsable ? 'service' : 'tout',
    materiels: { ...m.rows[0], statuts },
    articles: a.rows[0],
    alertes_stock: { total: al.rows[0]?.total ?? 0, elements: al.rows.map(({ total, ...reste }) => reste) },
    mouvements: mvt.rows[0],
    serie_mouvements: ser.rows,
    recents: rec.rows,
  });
});
