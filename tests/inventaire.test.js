// Phase 5 : référentiels, employés, matériels (réception, recherche, scan,
// périmètre, étiquettes) et articles (seuils, unité figée).
// Cahier des charges § 3.2, 3.3, scénario 4.1, recette tests 3 et 4.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { raisonSansBase, reinitialiserBaseDeTest } from './environnement.js';
import { Navigateur, creerCompte, demarrerServeur } from './outils.js';

const MDP = 'Essai-inventaire-2026';

describe('référentiels, employés, matériels et articles', { skip: raisonSansBase }, () => {
  let serveur;
  let db;
  let admin;
  let gestion;
  let responsable;
  let employe;
  let gestionId;
  const ids = {};
  const nav = () => new Navigateur(serveur.adresse);
  const annee = new Date().getFullYear();

  before(async () => {
    await reinitialiserBaseDeTest();
    db = await import('../database/db.js');
    serveur = await demarrerServeur();
    await creerCompte({ nom: 'Admin Inventaire', email: 'admin@test.local', role: 'ADMIN', motDePasse: MDP });
    gestionId = await creerCompte({ nom: 'Gestion Inventaire', email: 'gestion@test.local', role: 'GESTIONNAIRE', motDePasse: MDP });
    admin = nav();
    gestion = nav();
    await admin.connexion('admin@test.local', MDP);
    await gestion.connexion('gestion@test.local', MDP);
  });

  after(async () => {
    await serveur?.arreter();
    await reinitialiserBaseDeTest();
    await db?.fermerBase();
  });

  test('référentiels : sites et services créés par l’administrateur, codes en majuscules', async () => {
    const siege = await admin.requete('/api/referentiels/sites', { methode: 'POST', corps: { code: 'siege', nom: 'Siège', adresse: 'Antananarivo' } });
    assert.equal(siege.statut, 201);
    assert.equal(siege.donnees.element.code, 'SIEGE');
    ids.siege = siege.donnees.element.id;
    ids.depot = (await admin.requete('/api/referentiels/sites', { methode: 'POST', corps: { code: 'DEPOT', nom: 'Dépôt central' } })).donnees.element.id;
    ids.info = (await admin.requete('/api/referentiels/services', { methode: 'POST', corps: { code: 'info', nom: 'Informatique', site_id: ids.siege } })).donnees.element.id;
    ids.adm = (await admin.requete('/api/referentiels/services', { methode: 'POST', corps: { code: 'ADM', nom: 'Administration', site_id: ids.siege } })).donnees.element.id;

    const doublon = await admin.requete('/api/referentiels/sites', { methode: 'POST', corps: { code: 'SIEGE', nom: 'Autre siège' } });
    assert.equal(doublon.statut, 409);
    assert.equal(doublon.donnees.erreur.message, 'Ce code de site est déjà utilisé.');
    const invalide = await admin.requete('/api/referentiels/sites', { methode: 'POST', corps: { code: 'SIÈGE !', nom: 'X' } });
    assert.equal(invalide.statut, 422);
    assert.equal(invalide.donnees.erreur.champ, 'code');

    const services = (await gestion.requete('/api/referentiels/services')).donnees.services;
    assert.equal(services.find((s) => s.id === ids.info).site, 'Siège');
    assert.equal((await gestion.requete('/api/referentiels/sites', { methode: 'POST', corps: { code: 'X', nom: 'X' } })).statut, 403,
      'le gestionnaire ne gère pas les référentiels');
  });

  test('référentiels : catégories (doublon refusé, type figé), désactivation', async () => {
    const doublon = await admin.requete('/api/referentiels/categories', { methode: 'POST', corps: { nom: 'informatique', type: 'MATERIEL' } });
    assert.equal(doublon.statut, 409, 'catégorie livrée avec le schéma');
    const cree = await admin.requete('/api/referentiels/categories', { methode: 'POST', corps: { nom: 'Climatisation', type: 'MATERIEL' } });
    assert.equal(cree.statut, 201);
    const typeSeul = await admin.requete(`/api/referentiels/categories/${cree.donnees.element.id}`, { methode: 'PATCH', corps: { type: 'ARTICLE' } });
    assert.equal(typeSeul.donnees.erreur.code, 'SAISIE_VIDE', 'le type ne se modifie pas');
    const desactive = await admin.requete(`/api/referentiels/categories/${cree.donnees.element.id}`, { methode: 'PATCH', corps: { actif: false } });
    assert.equal(desactive.donnees.element.actif, false);

    const categories = (await gestion.requete('/api/referentiels/categories')).donnees.categories;
    ids.informatique = categories.find((c) => c.nom === 'Informatique').id;
    ids.fournitures = categories.find((c) => c.nom === 'Fournitures de bureau').id;
    assert.equal((await gestion.requete('/api/referentiels/unites')).donnees.unites.find((u) => u.code === 'BOITE').decimales, 0);
  });

  test('employés : créés par le gestionnaire, matricule unique, recherche', async () => {
    const cree = await gestion.requete('/api/employes', {
      methode: 'POST', corps: { matricule: 'e001', nom: 'RAKOTO', prenoms: 'Jean', fonction: 'Technicien', service_id: ids.info, email: 'Jean.Rakoto@Test.local' },
    });
    assert.equal(cree.statut, 201);
    assert.equal(cree.donnees.employe.matricule, 'E001');
    assert.equal(cree.donnees.employe.email, 'jean.rakoto@test.local');
    ids.employe = cree.donnees.employe.id;
    const doublon = await gestion.requete('/api/employes', { methode: 'POST', corps: { matricule: 'E001', nom: 'Autre' } });
    assert.equal(doublon.donnees.erreur.message, 'Ce matricule est déjà utilisé.');
    const email = await gestion.requete('/api/employes', { methode: 'POST', corps: { matricule: 'E002', nom: 'X', email: 'pas-une-adresse' } });
    assert.equal(email.donnees.erreur.champ, 'email');
    const recherche = await gestion.requete('/api/employes?q=techni');
    assert.equal(recherche.donnees.total, 1);
    const modifie = await gestion.requete(`/api/employes/${ids.employe}`, { methode: 'PATCH', corps: { fonction: 'Chef technicien' } });
    assert.equal(modifie.donnees.employe.fonction, 'Chef technicien');

    await creerCompte({ nom: 'Responsable Info', email: 'resp@test.local', role: 'RESPONSABLE_SERVICE', serviceId: ids.info, motDePasse: MDP });
    await creerCompte({ nom: 'Jean Rakoto', email: 'jean@test.local', role: 'EMPLOYE', employeId: ids.employe, motDePasse: MDP });
    responsable = nav();
    employe = nav();
    await responsable.connexion('resp@test.local', MDP);
    await employe.connexion('jean@test.local', MDP);
    assert.equal((await responsable.requete('/api/employes')).statut, 403);
  });

  test('Recette 3 / scénario 4.1 — création d’un matériel avec sa réception', async () => {
    const reponse = await gestion.requete('/api/materiels', {
      methode: 'POST',
      corps: {
        designation: 'Ordinateur portable', categorie_id: ids.informatique, marque: 'Marque', modele: 'Modèle 14',
        numero_serie: 'SN-1001', date_achat: '2026-11-02', prix_achat: '3 500 000', fournisseur: 'Fournisseur Test',
        site_id: ids.siege, service_id: ids.info, etat: 'NEUF',
        reception: { type: 'RECEPTION_ACHAT', reference_externe: 'BL-001' },
      },
    });
    assert.equal(reponse.statut, 201);
    const m = reponse.donnees.materiel;
    assert.equal(m.code, `MAT-${annee}-0001`);
    assert.equal(m.statut, 'DISPONIBLE');
    assert.equal(m.prix_achat, 3500000);
    ids.portable = m.id;

    const fiche = (await gestion.requete(`/api/materiels/${m.id}`)).donnees;
    assert.equal(fiche.mouvements.length, 1);
    assert.equal(fiche.mouvements[0].statut, 'VALIDE');
    assert.equal(fiche.mouvements[0].type, 'Réception — achat');
    assert.equal(fiche.mouvements[0].site_destination, 'SIEGE');
    assert.equal(fiche.historique.length, 1);
    assert.equal(fiche.materiel.cree_par_nom, 'Gestion Inventaire');

    ids.imprimante = (await gestion.requete('/api/materiels', {
      methode: 'POST',
      corps: { designation: 'Imprimante', categorie_id: ids.informatique, site_id: ids.siege, service_id: ids.adm, reception: { type: 'RECEPTION_DON' } },
    })).donnees.materiel.id;
    ids.ecran = (await gestion.requete('/api/materiels', {
      methode: 'POST',
      corps: { code: 'ecran-24', designation: 'Écran 24 pouces', categorie_id: ids.informatique, site_id: ids.depot, service_id: ids.info, etat: 'BON' },
    })).donnees.materiel.id;
  });

  test('création refusée proprement : saisie invalide, doublon, date future (rien d’enregistré)', async () => {
    const creer = (corps) => gestion.requete('/api/materiels', { methode: 'POST', corps: { designation: 'Essai', categorie_id: ids.informatique, site_id: ids.siege, ...corps } });
    assert.equal((await creer({ prix_achat: '1500,5' })).donnees.erreur.champ, 'prix_achat');
    assert.equal((await creer({ site_id: null })).donnees.erreur.champ, 'site_id');
    assert.equal((await creer({ date_achat: '2026-02-30' })).donnees.erreur.champ, 'date_achat');
    assert.equal((await creer({ categorie_id: ids.fournitures })).donnees.erreur.code, 'REFERENCE_INCONNUE', 'catégorie d’articles refusée');
    const serie = await creer({ numero_serie: 'sn-1001' });
    assert.equal(serie.donnees.erreur.message, 'Ce numéro de série est déjà enregistré sur un autre matériel.');

    const { rows: [avant] } = await db.requete('SELECT count(*)::int AS n FROM materiels');
    const future = await creer({ reception: { date: '2099-01-01' } });
    assert.equal(future.donnees.erreur.code, 'DATE_NON_VALABLE');
    const { rows: [apres] } = await db.requete('SELECT count(*)::int AS n FROM materiels');
    assert.equal(apres.n, avant.n, 'la fiche n’est pas créée si la réception est refusée');
  });

  test('liste : recherche, filtres, pagination, recherche par code (scan)', async () => {
    const tous = (await gestion.requete('/api/materiels')).donnees;
    assert.equal(tous.total, 3);
    assert.equal((await gestion.requete('/api/materiels?q=sn-1001')).donnees.materiels[0].id, ids.portable);
    assert.equal((await gestion.requete(`/api/materiels?site_id=${ids.depot}`)).donnees.total, 1);
    assert.equal((await gestion.requete('/api/materiels?etat=BON')).donnees.total, 1);
    assert.equal((await gestion.requete('/api/materiels?sans_etiquette=oui')).donnees.total, 3);
    const page2 = (await gestion.requete('/api/materiels?par_page=2&page=2')).donnees;
    assert.equal(page2.materiels.length, 1);
    assert.equal(page2.total, 3);

    const scan = await gestion.requete(`/api/materiels/par-code?code=${encodeURIComponent(` mat-${annee}-0001 `)}`);
    assert.equal(scan.donnees.materiel.id, ids.portable);
    assert.equal((await gestion.requete('/api/materiels/par-code?code=ECRAN-24')).donnees.materiel.id, ids.ecran);
    assert.equal((await gestion.requete('/api/materiels/par-code?code=INCONNU')).statut, 404);
  });

  test('modification : champs descriptifs seulement, journalisée', async () => {
    const modifie = await gestion.requete(`/api/materiels/${ids.portable}`, { methode: 'PATCH', corps: { designation: 'Ordinateur portable 14"', observations: 'Sacoche fournie' } });
    assert.equal(modifie.statut, 200);
    assert.equal(modifie.donnees.materiel.modifie_par_nom, 'Gestion Inventaire');
    for (const champ of ['site_id', 'statut', 'code', 'etat']) {
      const refus = await gestion.requete(`/api/materiels/${ids.portable}`, { methode: 'PATCH', corps: { [champ]: 'X' } });
      assert.equal(refus.donnees.erreur.code, 'CHAMP_NON_MODIFIABLE', champ);
    }
    const { rows: [journal] } = await db.requete(
      "SELECT metadonnees FROM historique_actions WHERE action = 'MATERIEL_MODIFIE' ORDER BY id DESC LIMIT 1",
    );
    assert.deepEqual(Object.keys(journal.metadonnees).sort(), ['designation', 'observations']);
  });

  test('périmètre : le responsable ne voit que son service ; l’employé n’a pas accès à la liste', async () => {
    const liste = (await responsable.requete('/api/materiels')).donnees;
    assert.deepEqual(liste.materiels.map((m) => m.id).sort(), [ids.portable, ids.ecran].sort());
    assert.equal((await responsable.requete(`/api/materiels/${ids.imprimante}`)).statut, 404, 'matériel d’un autre service');
    assert.equal((await responsable.requete(`/api/materiels/${ids.portable}`)).statut, 200);
    const codeImprimante = (await gestion.requete(`/api/materiels/${ids.imprimante}`)).donnees.materiel.code;
    assert.equal((await responsable.requete(`/api/materiels/par-code?code=${codeImprimante}`)).statut, 404);
    assert.equal((await responsable.requete('/api/materiels', { methode: 'POST', corps: {} })).statut, 403);
    assert.equal((await employe.requete('/api/materiels')).statut, 403);
  });

  test('étiquettes : données dans l’ordre demandé, impression notée et journalisée', async () => {
    const donnees = (await gestion.requete(`/api/materiels/etiquettes?ids=${ids.ecran},${ids.portable}`)).donnees;
    assert.deepEqual(donnees.etiquettes.map((e) => e.code), ['ECRAN-24', `MAT-${annee}-0001`]);
    assert.equal(donnees.societe, 'À renseigner');
    const imprime = await gestion.requete('/api/materiels/etiquettes', { methode: 'POST', corps: { ids: [ids.ecran, ids.portable] } });
    assert.equal(imprime.donnees.imprimees, 2);
    assert.ok((await gestion.requete(`/api/materiels/${ids.ecran}`)).donnees.materiel.etiquette_imprimee_le);
    assert.equal((await gestion.requete('/api/materiels?sans_etiquette=oui')).donnees.total, 1);
    assert.equal((await gestion.requete('/api/materiels/etiquettes', { methode: 'POST', corps: { ids: [] } })).statut, 422);
    assert.equal((await responsable.requete(`/api/materiels/etiquettes?ids=${ids.portable}`)).statut, 403);
    const { rows } = await db.requete("SELECT metadonnees FROM historique_actions WHERE action = 'IMPRESSION_ETIQUETTE'");
    assert.equal(rows[0].metadonnees.nombre, 2);
  });

  test('Recette 4 — création d’un article avec unité et seuil', async () => {
    const cree = await gestion.requete('/api/articles', {
      methode: 'POST',
      corps: { designation: 'Papier A4 80 g', categorie_id: ids.fournitures, unite_code: 'BOITE', seuil_minimum: '5', site_stockage_id: ids.siege, emplacement: 'Rayon A' },
    });
    assert.equal(cree.statut, 201);
    const a = cree.donnees.article;
    assert.equal(a.code, `ART-${annee}-0001`);
    assert.equal(a.unite, 'Boîte');
    assert.equal(a.seuil_minimum, 5);
    assert.equal(a.quantite_disponible, 0);
    assert.equal(a.en_rupture, true);
    ids.papier = a.id;

    const creer = (corps) => gestion.requete('/api/articles', { methode: 'POST', corps: { designation: 'Stylo', categorie_id: ids.fournitures, unite_code: 'PIECE', seuil_minimum: 0, ...corps } });
    assert.equal((await creer({ seuil_minimum: '2,5' })).donnees.erreur.champ, 'seuil_minimum', 'pas de demi-pièce');
    assert.equal((await creer({ seuil_minimum: null })).donnees.erreur.champ, 'seuil_minimum', 'seuil obligatoire');
    assert.equal((await creer({ designation: 'papier a4 80 g' })).donnees.erreur.message, 'Un article porte déjà cette désignation.');
    assert.equal((await creer({})).statut, 201);
    assert.equal((await responsable.requete('/api/articles')).statut, 200, 'le responsable consulte les articles');
    assert.equal((await responsable.requete('/api/articles', { methode: 'POST', corps: {} })).statut, 403);
  });

  test('articles : liste et alertes, seuils par site', async () => {
    assert.equal((await gestion.requete('/api/articles?alerte=oui')).donnees.articles.map((a) => a.id).includes(ids.papier), true);
    assert.equal((await gestion.requete('/api/articles?q=papier')).donnees.total, 1);

    assert.equal((await gestion.requete(`/api/articles/${ids.papier}/seuils/${ids.depot}`, { methode: 'PUT', corps: { seuil_minimum: 0 } })).statut, 422);
    const pose = await gestion.requete(`/api/articles/${ids.papier}/seuils/${ids.depot}`, { methode: 'PUT', corps: { seuil_minimum: '10' } });
    assert.equal(pose.statut, 200);
    const fiche = (await gestion.requete(`/api/articles/${ids.papier}`)).donnees;
    const depot = fiche.sites.find((s) => s.site_id === ids.depot);
    assert.equal(depot.seuil_site, 10);
    assert.equal(depot.alerte_site, true);
    assert.equal((await gestion.requete(`/api/articles/${ids.papier}/seuils/${ids.depot}`, { methode: 'DELETE' })).statut, 200);
    assert.equal((await gestion.requete(`/api/articles/${ids.papier}/seuils/${ids.depot}`, { methode: 'DELETE' })).statut, 404);
  });

  test('articles : unité figée dès le premier mouvement, stock suivi', async () => {
    assert.equal((await gestion.requete(`/api/articles/${ids.papier}`, { methode: 'PATCH', corps: { unite_code: 'PAQUET' } })).statut, 200, 'libre avant tout mouvement');
    await gestion.requete(`/api/articles/${ids.papier}`, { methode: 'PATCH', corps: { unite_code: 'BOITE' } });
    await db.transaction(gestionId, async (client) => {
      const { rows: [{ id }] } = await client.query("INSERT INTO mouvements (type_code) VALUES ('RECEPTION_ACHAT') RETURNING id");
      await client.query('INSERT INTO lignes_mouvements (mouvement_id, article_id, quantite, site_destination_id) VALUES ($1, $2, 12, $3)', [id, ids.papier, ids.siege]);
      await client.query("UPDATE mouvements SET statut = 'VALIDE' WHERE id = $1", [id]);
    });
    const fiche = (await gestion.requete(`/api/articles/${ids.papier}`)).donnees;
    assert.equal(fiche.article.unite_figee, true);
    assert.equal(fiche.article.quantite_disponible, 12);
    assert.equal(fiche.article.alerte_stock_faible, false);
    assert.equal(fiche.mouvements.length, 1);
    const fige = await gestion.requete(`/api/articles/${ids.papier}`, { methode: 'PATCH', corps: { unite_code: 'PAQUET' } });
    assert.equal(fige.donnees.erreur.code, 'UNITE_FIGEE');
    assert.equal((await gestion.requete(`/api/articles/${ids.papier}`, { methode: 'PATCH', corps: { code: 'AUTRE' } })).donnees.erreur.code, 'CHAMP_NON_MODIFIABLE');
  });

  test('pages : accès selon les droits, bibliothèque de code-barres servie', async () => {
    assert.equal((await gestion.requete('/materiels')).statut, 200);
    assert.equal((await gestion.requete(`/materiels/${ids.portable}`)).statut, 200);
    assert.equal((await gestion.requete(`/articles/${ids.papier}`)).statut, 200);
    assert.equal((await gestion.requete('/employes')).statut, 200);
    assert.equal((await gestion.requete('/etiquettes')).statut, 200);
    assert.equal((await gestion.requete('/administration')).entetes.get('location'), '/');
    assert.equal((await admin.requete('/administration')).statut, 200);
    assert.equal((await responsable.requete('/materiels')).statut, 200);
    assert.equal((await responsable.requete('/employes')).entetes.get('location'), '/');
    assert.equal((await responsable.requete('/etiquettes')).entetes.get('location'), '/');
    assert.equal((await employe.requete('/materiels')).entetes.get('location'), '/');
    const bibliotheque = await fetch(`${serveur.adresse}/vendor/jsbarcode/JsBarcode.all.min.js`);
    assert.equal(bibliotheque.status, 200);
    assert.match(bibliotheque.headers.get('content-type'), /javascript/);
  });

  test('désactivation d’un employé : refusée s’il a encore du matériel', async () => {
    await db.transaction(gestionId, async (client) => {
      const { rows: [{ id }] } = await client.query(
        "INSERT INTO mouvements (type_code, motif, numero_ticket, employe_beneficiaire_id) VALUES ('AFFECTATION', 'Poste', 'TK-1', $1) RETURNING id", [ids.employe],
      );
      await client.query('INSERT INTO lignes_mouvements (mouvement_id, materiel_id, quantite, site_source_id) VALUES ($1, $2, 1, $3)', [id, ids.portable, ids.siege]);
      await client.query("UPDATE mouvements SET statut = 'VALIDE' WHERE id = $1", [id]);
      await client.query(
        "INSERT INTO affectations (materiel_id, employe_id, numero_contrat, date_retour_prevue, etat_remise, mouvement_affectation_id) VALUES ($1, $2, 'CT-1', aujourdhui() + 30, 'NEUF', $3)",
        [ids.portable, ids.employe, id],
      );
    });
    const refus = await gestion.requete(`/api/employes/${ids.employe}`, { methode: 'PATCH', corps: { actif: false } });
    assert.equal(refus.donnees.erreur.code, 'AFFECTATIONS_EN_COURS');
    const fiche = (await gestion.requete(`/api/materiels/${ids.portable}`)).donnees;
    assert.equal(fiche.materiel.statut, 'AFFECTE');
    assert.equal(fiche.materiel.responsable, 'RAKOTO Jean');
    assert.equal(fiche.affectations[0].numero_contrat, 'CT-1');
  });
});
