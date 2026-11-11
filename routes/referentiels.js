// Référentiels : sites, services, catégories (gérés par l'administrateur),
// unités et rôles (lecture seule), liste simple des employés pour les formulaires.
// Un référentiel ne se supprime pas : il se désactive (il peut être utilisé
// par l'historique).
import { Router } from 'express';
import { requete, transaction } from '../database/db.js';
import { exigerDroit } from '../middleware/authentification.js';
import { ErreurApi } from '../middleware/erreurs.js';
import { differences, journaliser, miseAJour } from '../services/journal.js';
import { CODE_REFERENTIEL, booleen, choix, identifiantNumerique, texte } from '../services/validation.js';

export const routeurReferentiels = Router();

const lecture = exigerDroit('referentiels.lire', 'utilisateurs.gerer', 'referentiels.gerer');
const gestion = exigerDroit('referentiels.gerer');

const codeReferentiel = (valeur, libelle) => texte(valeur, {
  champ: 'code', libelle, obligatoire: true, max: 20, majuscules: true, motif: CODE_REFERENTIEL,
  messageMotif: `${libelle} : 1 à 20 caractères parmi A-Z, 0-9, _ et - (ex. SIEGE, DEPOT-2).`,
});

// Description de chaque référentiel modifiable.
const REFERENTIELS = {
  sites: {
    entite: 'sites',
    liste: `SELECT s.id, s.code, s.nom, s.adresse, s.actif,
                   (SELECT count(*)::int FROM materiels m WHERE m.site_id = s.id) AS nb_materiels,
                   (SELECT count(*)::int FROM services sv WHERE sv.site_id = s.id) AS nb_services
              FROM sites s ORDER BY s.actif DESC, s.nom`,
    une: 'SELECT id, code, nom, adresse, actif FROM sites WHERE id = $1',
    saisie(corps, partiel) {
      const present = (cle) => !partiel || Object.hasOwn(corps, cle);
      const s = {};
      if (present('code')) s.code = codeReferentiel(corps.code, 'Code du site');
      if (present('nom')) s.nom = texte(corps.nom, { champ: 'nom', libelle: 'Nom', obligatoire: true, max: 100 });
      if (present('adresse')) s.adresse = texte(corps.adresse, { champ: 'adresse', libelle: 'Adresse', max: 200 });
      if (partiel && present('actif')) s.actif = booleen(corps.actif, { champ: 'actif', libelle: 'Actif' });
      return s;
    },
  },
  services: {
    entite: 'services',
    liste: `SELECT sv.id, sv.code, sv.nom, sv.site_id, s.nom AS site, sv.actif,
                   (SELECT count(*)::int FROM employes e WHERE e.service_id = sv.id) AS nb_employes
              FROM services sv LEFT JOIN sites s ON s.id = sv.site_id
             ORDER BY sv.actif DESC, sv.nom`,
    une: 'SELECT id, code, nom, site_id, actif FROM services WHERE id = $1',
    saisie(corps, partiel) {
      const present = (cle) => !partiel || Object.hasOwn(corps, cle);
      const s = {};
      if (present('code')) s.code = codeReferentiel(corps.code, 'Code du service');
      if (present('nom')) s.nom = texte(corps.nom, { champ: 'nom', libelle: 'Nom', obligatoire: true, max: 100 });
      if (present('site_id')) s.site_id = identifiantNumerique(corps.site_id, { champ: 'site_id', libelle: 'Site' });
      if (partiel && present('actif')) s.actif = booleen(corps.actif, { champ: 'actif', libelle: 'Actif' });
      return s;
    },
  },
  categories: {
    entite: 'categories',
    liste: `SELECT c.id, c.nom, c.type, c.description, c.actif,
                   (SELECT count(*)::int FROM materiels m WHERE m.categorie_id = c.id)
                 + (SELECT count(*)::int FROM articles a WHERE a.categorie_id = c.id) AS nb_utilisations
              FROM categories c ORDER BY c.type DESC, c.actif DESC, c.nom`,
    une: 'SELECT id, nom, type, description, actif FROM categories WHERE id = $1',
    saisie(corps, partiel) {
      const present = (cle) => !partiel || Object.hasOwn(corps, cle);
      const s = {};
      if (present('nom')) s.nom = texte(corps.nom, { champ: 'nom', libelle: 'Nom', obligatoire: true, max: 100 });
      // Le type ne change plus après la création : matériels et articles s'y rattachent.
      if (!partiel) s.type = choix(corps.type, ['MATERIEL', 'ARTICLE'], { champ: 'type', libelle: 'Type', obligatoire: true });
      if (present('description')) s.description = texte(corps.description, { champ: 'description', libelle: 'Description', max: 300 });
      if (partiel && present('actif')) s.actif = booleen(corps.actif, { champ: 'actif', libelle: 'Active' });
      return s;
    },
  },
};

for (const [chemin, ref] of Object.entries(REFERENTIELS)) {
  routeurReferentiels.get(`/referentiels/${chemin}`, lecture, async (req, res) => {
    const { rows } = await requete(ref.liste);
    res.json({ [chemin]: rows });
  });

  routeurReferentiels.post(`/referentiels/${chemin}`, gestion, async (req, res) => {
    const saisie = ref.saisie(req.body ?? {}, false);
    const cree = await transaction(req.utilisateur.id, async (client) => {
      const colonnes = Object.keys(saisie);
      const { rows: [{ id }] } = await client.query(
        `INSERT INTO ${ref.entite} (${colonnes.join(', ')}) VALUES (${colonnes.map((_, rang) => `$${rang + 1}`).join(', ')}) RETURNING id`,
        colonnes.map((colonne) => saisie[colonne]),
      );
      await journaliser({
        utilisateurId: req.utilisateur.id, action: 'REFERENTIEL_CREE', entite: ref.entite, entiteId: id,
        metadonnees: saisie, ip: req.ip,
      }, client);
      return (await client.query(ref.une, [id])).rows[0];
    });
    res.status(201).json({ element: cree });
  });

  routeurReferentiels.patch(`/referentiels/${chemin}/:id`, gestion, async (req, res) => {
    const id = identifiantNumerique(req.params.id, { champ: 'id', libelle: 'Élément', obligatoire: true });
    const saisie = ref.saisie(req.body ?? {}, true);
    if (Object.keys(saisie).length === 0) throw new ErreurApi(422, 'SAISIE_VIDE', 'Aucune modification reçue.');
    const modifie = await transaction(req.utilisateur.id, async (client) => {
      const { rows: [avant] } = await client.query(`${ref.une} FOR UPDATE`, [id]);
      if (!avant) throw new ErreurApi(404, 'INTROUVABLE', 'Élément introuvable.');
      const { texte: sql, valeurs } = miseAJour(ref.entite, id, saisie);
      await client.query(sql, valeurs);
      await journaliser({
        utilisateurId: req.utilisateur.id, action: 'REFERENTIEL_MODIFIE', entite: ref.entite, entiteId: id,
        metadonnees: differences(avant, saisie), ip: req.ip,
      }, client);
      return (await client.query(ref.une, [id])).rows[0];
    });
    res.json({ element: modifie });
  });
}

routeurReferentiels.get('/referentiels/roles', exigerDroit('utilisateurs.gerer'), async (req, res) => {
  const { rows } = await requete('SELECT code, libelle, description FROM roles ORDER BY libelle');
  res.json({ roles: rows });
});

routeurReferentiels.get('/referentiels/types-mouvements', exigerDroit('mouvements.lire'), async (req, res) => {
  const { rows } = await requete('SELECT * FROM types_mouvements ORDER BY ordre');
  res.json({ types: rows });
});

// Liste légère des articles pour la saisie des mouvements.
routeurReferentiels.get('/referentiels/articles', exigerDroit('articles.lire'), async (req, res) => {
  const { rows } = await requete(
    `SELECT a.id, a.code, a.designation, a.unite_code, u.symbole, u.decimales, a.actif
       FROM articles a JOIN unites u ON u.code = a.unite_code
      ORDER BY lower(a.designation)`,
  );
  res.json({ articles: rows });
});

routeurReferentiels.get('/referentiels/unites', lecture, async (req, res) => {
  const { rows } = await requete('SELECT code, libelle, symbole, decimales FROM unites ORDER BY libelle');
  res.json({ unites: rows });
});

// Liste simple des employés pour les listes déroulantes (comptes, affectations).
// Données personnelles : réservée à qui en a besoin.
routeurReferentiels.get('/referentiels/employes', exigerDroit('utilisateurs.gerer', 'affectations.gerer', 'employes.gerer'), async (req, res) => {
  const { rows } = await requete(
    `SELECT e.id, e.matricule, e.nom, e.prenoms, e.service_id, s.nom AS service, e.actif
       FROM employes e LEFT JOIN services s ON s.id = e.service_id
      ORDER BY e.nom, e.prenoms`,
  );
  res.json({ employes: rows });
});
