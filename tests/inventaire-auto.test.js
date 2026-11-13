// Inventaire automatique : synthèse du parc et des stocks, lignes de stock des
// articles par site, sans aucune saisie. Vérifie aussi le périmètre du
// responsable de service et l'accès à la page.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { raisonSansBase, reinitialiserBaseDeTest } from './environnement.js';
import { Navigateur, creerCompte, demarrerServeur } from './outils.js';

const MDP = 'Essai-inventaire-auto-2026';

describe('inventaire automatique du parc et des stocks', { skip: raisonSansBase }, () => {
  let serveur;
  let db;
  let admin;
  let gestion;
  let responsable;
  let employe;
  let gestionId;
  const ids = {};

  before(async () => {
    await reinitialiserBaseDeTest();
    db = await import('../database/db.js');
    serveur = await demarrerServeur();
    await creerCompte({ nom: 'Admin Inventaire Auto', email: 'admin-auto@test.local', role: 'ADMIN', motDePasse: MDP });
    gestionId = await creerCompte({ nom: 'Gestion Inventaire Auto', email: 'gestion-auto@test.local', role: 'GESTIONNAIRE', motDePasse: MDP });
    admin = new Navigateur(serveur.adresse);
    gestion = new Navigateur(serveur.adresse);
    await admin.connexion('admin-auto@test.local', MDP);
    await gestion.connexion('gestion-auto@test.local', MDP);

    ids.siege = (await admin.requete('/api/referentiels/sites', { methode: 'POST', corps: { code: 'SIEGE', nom: 'Siège' } })).donnees.element.id;
    ids.depot = (await admin.requete('/api/referentiels/sites', { methode: 'POST', corps: { code: 'DEPOT', nom: 'Dépôt central' } })).donnees.element.id;
    ids.info = (await admin.requete('/api/referentiels/services', { methode: 'POST', corps: { code: 'INFO', nom: 'Informatique', site_id: ids.siege } })).donnees.element.id;
    ids.adm = (await admin.requete('/api/referentiels/services', { methode: 'POST', corps: { code: 'ADM', nom: 'Administration', site_id: ids.siege } })).donnees.element.id;

    const categories = (await gestion.requete('/api/referentiels/categories')).donnees.categories;
    ids.informatique = categories.find((c) => c.nom === 'Informatique').id;
    ids.fournitures = categories.find((c) => c.nom === 'Fournitures de bureau').id;

    ids.portable = (await gestion.requete('/api/materiels', {
      methode: 'POST', corps: { designation: 'Ordinateur portable', categorie_id: ids.informatique, site_id: ids.siege, service_id: ids.info },
    })).donnees.materiel.id;
    ids.imprimante = (await gestion.requete('/api/materiels', {
      methode: 'POST', corps: { designation: 'Imprimante', categorie_id: ids.informatique, site_id: ids.siege, service_id: ids.adm },
    })).donnees.materiel.id;
    ids.ecran = (await gestion.requete('/api/materiels', {
      methode: 'POST', corps: { designation: 'Écran 24 pouces', categorie_id: ids.informatique, site_id: ids.depot, service_id: ids.info },
    })).donnees.materiel.id;

    ids.papier = (await gestion.requete('/api/articles', {
      methode: 'POST',
      corps: { designation: 'Papier A4 80 g', categorie_id: ids.fournitures, unite_code: 'BOITE', seuil_minimum: 5, site_stockage_id: ids.siege },
    })).donnees.article.id;
    ids.stylo = (await gestion.requete('/api/articles', {
      methode: 'POST', corps: { designation: 'Stylo bille', categorie_id: ids.fournitures, unite_code: 'PIECE', seuil_minimum: 0 },
    })).donnees.article.id;

    // Entrée de 12 boîtes au siège et 2 au dépôt : les quantités de l'inventaire
    // doivent suivre automatiquement, comme après toute réception validée.
    await db.transaction(gestionId, async (client) => {
      const { rows: [{ id }] } = await client.query("INSERT INTO mouvements (type_code) VALUES ('RECEPTION_ACHAT') RETURNING id");
      await client.query(
        'INSERT INTO lignes_mouvements (mouvement_id, article_id, quantite, site_destination_id) VALUES ($1, $2, 12, $3), ($1, $2, 2, $4)',
        [id, ids.papier, ids.siege, ids.depot],
      );
      await client.query("UPDATE mouvements SET statut = 'VALIDE' WHERE id = $1", [id]);
    });

    await creerCompte({
      nom: 'Responsable Info', email: 'resp-auto@test.local', role: 'RESPONSABLE_SERVICE', serviceId: ids.info, motDePasse: MDP,
    });
    const ficheEmploye = (await gestion.requete('/api/employes', {
      methode: 'POST', corps: { matricule: 'E900', nom: 'Employé', prenoms: 'Inventaire', service_id: ids.info },
    })).donnees.employe.id;
    await creerCompte({
      nom: 'Employé Inventaire', email: 'employe-auto@test.local', role: 'EMPLOYE', employeId: ficheEmploye, motDePasse: MDP,
    });
    responsable = new Navigateur(serveur.adresse);
    employe = new Navigateur(serveur.adresse);
    await responsable.connexion('resp-auto@test.local', MDP);
    await employe.connexion('employe-auto@test.local', MDP);
  });

  after(async () => {
    await serveur?.arreter();
    await reinitialiserBaseDeTest();
    await db?.fermerBase();
  });

  test('synthèse : parc et stocks calculés depuis les fiches et les mouvements', async () => {
    const donnees = (await gestion.requete('/api/inventaire/resume')).donnees;
    assert.equal(donnees.perimetre, 'tout');
    assert.equal(donnees.materiels.total, 3);
    assert.equal(donnees.materiels.disponibles, 3);
    assert.equal(donnees.materiels.sortis, 0);
    assert.equal(donnees.articles.total, 2);
    assert.equal(donnees.articles.en_stock, 1);
    assert.equal(donnees.articles.en_rupture, 1, 'le stylo n’a jamais eu de stock');
    assert.equal(donnees.articles.par_site, false);

    const cible = (await gestion.requete('/api/inventaire/resume?q=papier')).donnees;
    assert.equal(cible.articles.total, 1);
    assert.equal(cible.materiels.total, 0);

    const depot = (await gestion.requete(`/api/inventaire/resume?site_id=${ids.depot}`)).donnees;
    assert.equal(depot.materiels.total, 1);
    assert.equal(depot.articles.par_site, true);
    assert.equal(depot.articles.total, 1);
    assert.equal(depot.articles.en_stock, 1);
  });

  test('lignes de stock : tous sites, par site, quantités et alertes', async () => {
    const global = (await gestion.requete('/api/inventaire/articles')).donnees;
    assert.equal(global.total, 2);
    assert.equal(global.par_site, false);
    const papier = global.articles.find((article) => article.id === ids.papier);
    assert.equal(papier.quantite, 14);
    assert.equal(papier.seuil, 5);
    assert.equal(papier.en_rupture, false);

    const ruptures = (await gestion.requete('/api/inventaire/articles?rupture=oui')).donnees;
    assert.deepEqual(ruptures.articles.map((article) => article.id), [ids.stylo]);

    const site = (await gestion.requete(`/api/inventaire/articles?site_id=${ids.depot}`)).donnees;
    assert.equal(site.par_site, true);
    assert.equal(site.total, 1);
    assert.equal(site.articles[0].site, 'Dépôt central');
    assert.equal(site.articles[0].quantite, 2);
    assert.equal(site.articles[0].alerte, false);

    // Un seuil propre au dépôt (3) met les 2 boîtes sous le seuil.
    await gestion.requete(`/api/articles/${ids.papier}/seuils/${ids.depot}`, { methode: 'PUT', corps: { seuil_minimum: 3 } });
    const alertes = (await gestion.requete(`/api/inventaire/articles?site_id=${ids.depot}&alerte=oui`)).donnees;
    assert.equal(alertes.total, 1);
    assert.equal(alertes.articles[0].alerte, true);
  });

  test('périmètre : le responsable reste sur son service et le site de son service', async () => {
    const synthese = (await responsable.requete('/api/inventaire/resume')).donnees;
    assert.equal(synthese.perimetre, 'service');
    assert.equal(synthese.site, ids.siege);
    assert.equal(synthese.materiels.total, 2, 'portable et écran du service Informatique');
    assert.equal(synthese.articles.par_site, true);
    assert.equal(synthese.articles.total, 1);

    const lignes = (await responsable.requete(`/api/inventaire/articles?site_id=${ids.depot}`)).donnees;
    assert.equal(lignes.par_site, true);
    assert.equal(lignes.articles[0].site_id, ids.siege, 'le site du service est imposé');
    assert.equal(lignes.articles[0].quantite, 12);
  });

  test('page : servie aux rôles qui lisent le parc, refusée aux autres', async () => {
    assert.equal((await gestion.requete('/inventaire')).statut, 200);
    assert.equal((await responsable.requete('/inventaire')).statut, 200);
    assert.equal((await employe.requete('/inventaire')).entetes.get('location'), '/');
  });
});
