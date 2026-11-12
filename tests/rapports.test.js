// Phase 8 : tableau de bord et rapports.
// Recette (cahier des charges § 11) : test 12 (export CSV cohérent avec les
// filtres et les droits). Décisions : le responsable de service ne voit et
// n'exporte que son service (11/11) ; tableau de bord sans quantités d'articles,
// exports CSV et PDF (12/11) ; chaque export est inscrit au journal.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { raisonSansBase, reinitialiserBaseDeTest } from './environnement.js';
import { Navigateur, creerCompte, demarrerServeur } from './outils.js';

const MDP = 'Essai-rapports-2026';
const decaler = (jours) => new Date(Date.now() + 3 * 3600 * 1000 + jours * 86400000).toISOString().slice(0, 10);

describe('tableau de bord et rapports', { skip: raisonSansBase }, () => {
  let serveur;
  let db;
  const n = {};
  const ids = {};
  const nav = () => new Navigateur(serveur.adresse);
  const poster = async (navigateur, chemin, corps) => {
    const reponse = await navigateur.requete(chemin, { methode: 'POST', corps });
    assert.ok(reponse.statut < 300, `${chemin} : ${JSON.stringify(reponse.donnees)}`);
    return reponse.donnees;
  };
  const rapport = async (navigateur, code, parametres = '') => {
    const reponse = await navigateur.requete(`/api/rapports/${code}${parametres ? `?${parametres}` : ''}`);
    assert.equal(reponse.statut, 200, JSON.stringify(reponse.donnees));
    return reponse.donnees;
  };
  const lignesCsv = (texte) => texte.replace(/^﻿/, '').trimEnd().split('\r\n');

  before(async () => {
    await reinitialiserBaseDeTest();
    db = await import('../database/db.js');
    serveur = await demarrerServeur();
    ids.admin = await creerCompte({ nom: 'Admin Rapports', email: 'admin@test.local', role: 'ADMIN', motDePasse: MDP });
    ids.g1 = await creerCompte({ nom: 'Gestionnaire Un', email: 'g1@test.local', role: 'GESTIONNAIRE', motDePasse: MDP });
    for (const cle of ['admin', 'g1']) {
      n[cle] = nav();
      await n[cle].connexion(`${cle}@test.local`, MDP);
    }
    const creer = (chemin, corps) => poster(n.admin, chemin, corps);
    ids.siege = (await creer('/api/referentiels/sites', { code: 'SIEGE', nom: 'Siège' })).element.id;
    ids.depot = (await creer('/api/referentiels/sites', { code: 'DEPOT', nom: 'Dépôt' })).element.id;
    ids.info = (await creer('/api/referentiels/services', { code: 'INFO', nom: 'Informatique', site_id: ids.siege })).element.id;
    ids.adm = (await creer('/api/referentiels/services', { code: 'ADM', nom: 'Administration', site_id: ids.depot })).element.id;
    ids.e1 = (await creer('/api/employes', { matricule: 'E001', nom: 'RAKOTO', prenoms: 'Jean', service_id: ids.info })).employe.id;
    ids.e2 = (await creer('/api/employes', { matricule: 'E002', nom: 'RABE', prenoms: 'Hery', service_id: ids.adm })).employe.id;
    const categories = (await n.admin.requete('/api/referentiels/categories')).donnees.categories;
    ids.informatique = categories.find((c) => c.nom === 'Informatique').id;
    ids.mobilier = categories.find((c) => c.nom === 'Mobilier').id;
    const fournitures = categories.find((c) => c.nom === 'Fournitures de bureau').id;
    const materiel = async (designation, site, service, categorie = ids.informatique) => (await creer('/api/materiels', {
      designation, categorie_id: categorie, site_id: site, service_id: service, etat: 'NEUF',
    })).materiel.id;
    ids.pc = await materiel('Ordinateur portable', ids.siege, ids.info);
    ids.ecran = await materiel('Écran', ids.siege, ids.info);
    ids.chaise = await materiel('Chaise de bureau', ids.siege, ids.info, ids.mobilier);
    ids.imprimante = await materiel('Imprimante', ids.depot, ids.adm);
    ids.scanner = await materiel('Scanner', ids.depot, ids.adm);
    ids.papier = (await creer('/api/articles', { designation: 'Papier A4', categorie_id: fournitures, unite_code: 'BOITE', seuil_minimum: 5 })).article.id;
    ids.toner = (await creer('/api/articles', { designation: 'Toner', categorie_id: fournitures, unite_code: 'PIECE', seuil_minimum: 2 })).article.id;

    // Mouvements : réception, consommation, transfert reçu avec un manquant, perte, casse.
    await creer('/api/mouvements', {
      type_code: 'RECEPTION_ACHAT', date_mouvement: decaler(-20), site_destination_id: ids.siege,
      lignes: [{ article_id: ids.papier, quantite: 10 }], valider: true,
    });
    await creer('/api/mouvements', {
      type_code: 'CONSOMMATION', site_source_id: ids.siege, service_beneficiaire_id: ids.info, motif: 'Impressions',
      lignes: [{ article_id: ids.papier, quantite: 3 }], valider: true,
    });
    const envoi = (await creer('/api/mouvements', {
      type_code: 'TRANSFERT', site_source_id: ids.siege, site_destination_id: ids.depot, motif: 'Réassort',
      lignes: [{ article_id: ids.papier, quantite: 4 }], valider: true,
    })).mouvement;
    await creer(`/api/mouvements/${envoi.id}/receptionner`, {
      quantites: [{ ligne_id: envoi.lignes[0].id, quantite_recue: 3 }], motif_ecart: 'Une boîte mouillée',
    });
    await creer('/api/mouvements', {
      type_code: 'PERTE', site_source_id: ids.depot, motif: 'Volé; plainte déposée', numero_ticket: 'TK-300',
      lignes: [{ materiel_id: ids.scanner }], valider: true,
    });
    await creer('/api/mouvements', {
      type_code: 'CASSE', site_source_id: ids.siege, motif: 'Boîte écrasée', lignes: [{ article_id: ids.papier, quantite: 1 }], valider: true,
    });
    // Affectations : une en retard, une rendue endommagée ; une imprimante hors service.
    await creer('/api/affectations', {
      materiel_id: ids.pc, employe_id: ids.e1, numero_contrat: 'CT-1', date_remise: decaler(-10),
      date_retour_prevue: decaler(-2), numero_ticket: 'TK-1',
    });
    const remise = (await creer('/api/affectations', {
      materiel_id: ids.ecran, employe_id: ids.e1, numero_contrat: 'CT-2', date_remise: decaler(-6),
      date_retour_prevue: decaler(-3), numero_ticket: 'TK-2',
    })).affectation;
    await creer(`/api/affectations/${remise.id}/retour`, {
      etat_retour: 'ENDOMMAGE', observations_retour: '-Écran rayé sur le bord', numero_ticket: 'TK-3',
    });
    await creer(`/api/materiels/${ids.imprimante}/etat`, { statut: 'EN_REPARATION', commentaire: 'Bourrage' });
    await creer(`/api/materiels/${ids.imprimante}/etat`, { etat: 'HORS_SERVICE', commentaire: 'Carte mère grillée' });

    await creerCompte({ nom: 'Resp Info', email: 'resp.info@test.local', role: 'RESPONSABLE_SERVICE', serviceId: ids.info, motDePasse: MDP });
    await creerCompte({ nom: 'Resp Adm', email: 'resp.adm@test.local', role: 'RESPONSABLE_SERVICE', serviceId: ids.adm, motDePasse: MDP });
    await creerCompte({ nom: 'Jean Rakoto', email: 'jean@test.local', role: 'EMPLOYE', employeId: ids.e1, motDePasse: MDP });
    for (const [cle, email] of [['respInfo', 'resp.info@test.local'], ['respAdm', 'resp.adm@test.local'], ['jean', 'jean@test.local']]) {
      n[cle] = nav();
      await n[cle].connexion(email, MDP);
    }
  });

  after(async () => {
    await serveur?.arreter();
    await reinitialiserBaseDeTest();
    await db?.fermerBase();
  });

  test('tableau de bord : indicateurs, filtres et périmètre', async () => {
    const tout = (await n.admin.requete('/api/tableau-de-bord')).donnees;
    assert.deepEqual(tout.periode, { debut: decaler(-29), fin: decaler(0) });
    assert.deepEqual(
      [tout.materiels.total, tout.materiels.disponibles, tout.materiels.affectes, tout.materiels.en_reparation,
        tout.materiels.hors_service, tout.materiels.endommages, tout.materiels.sortis, tout.materiels.retours_en_retard],
      [4, 1, 1, 2, 1, 1, 1, 1],
    );
    // Décision du 12/11 : le nombre d'articles, sans quantités.
    assert.deepEqual(tout.articles, { total: 2, en_stock: 1, sous_seuil: 1, en_rupture: 1 });
    assert.equal(tout.alertes_stock.total, 2);
    assert.deepEqual(tout.alertes_stock.elements.map((a) => a.article_id), [ids.toner, ids.papier], 'ruptures d’abord');
    // 5 réceptions de matériels + 1 d'articles + 1 retour ; 2 remises, consommation, perte, casse ; 1 transfert.
    assert.deepEqual(tout.mouvements, { entrees: 7, sorties: 5, transferts: 1 });
    assert.equal(tout.recents.length, 8);

    const depot = (await n.admin.requete(`/api/tableau-de-bord?site_id=${ids.depot}`)).donnees;
    assert.deepEqual([depot.materiels.total, depot.materiels.hors_service, depot.materiels.sortis], [1, 1, 1]);
    assert.deepEqual(depot.articles, { total: 1, en_stock: 1, sous_seuil: 0, en_rupture: 0 });
    assert.equal((await n.admin.requete(`/api/tableau-de-bord?categorie_id=${ids.mobilier}`)).donnees.materiels.total, 1);
    const futur = (await n.admin.requete(`/api/tableau-de-bord?date_debut=${decaler(1)}&date_fin=${decaler(2)}`)).donnees;
    assert.deepEqual(futur.mouvements, { entrees: 0, sorties: 0, transferts: 0 });
    assert.equal(futur.recents.length, 0);
    const inverse = await n.admin.requete(`/api/tableau-de-bord?date_debut=${decaler(0)}&date_fin=${decaler(-1)}`);
    assert.equal(inverse.statut, 422);
    assert.equal(inverse.donnees.erreur.champ, 'date_debut');

    // Le responsable : son service seulement (et le site de son service pour les articles).
    const adm = (await n.respAdm.requete('/api/tableau-de-bord')).donnees;
    assert.equal(adm.perimetre, 'service');
    assert.deepEqual([adm.materiels.total, adm.materiels.en_reparation, adm.materiels.sortis, adm.materiels.disponibles], [1, 1, 1, 0]);
    assert.deepEqual(adm.articles, { total: 1, en_stock: 1, sous_seuil: 0, en_rupture: 0 });
    const info = (await n.respInfo.requete('/api/tableau-de-bord')).donnees;
    assert.deepEqual([info.materiels.total, info.materiels.affectes, info.materiels.retours_en_retard], [3, 1, 1]);
    assert.equal((await n.jean.requete('/api/tableau-de-bord')).statut, 403);
  });

  test('rapports : liste selon les droits, filtres, périmètre du responsable', async () => {
    const options = (await n.admin.requete('/api/rapports/options')).donnees;
    assert.deepEqual(options.rapports.map((r) => r.code), ['parc', 'mouvements', 'affectations', 'retours', 'stock', 'anomalies', 'journal']);
    assert.equal(options.exporter, true);
    assert.ok(!(await n.g1.requete('/api/rapports/options')).donnees.rapports.some((r) => r.code === 'journal'));
    const optionsInfo = (await n.respInfo.requete('/api/rapports/options')).donnees;
    assert.equal(optionsInfo.responsable, true);
    assert.deepEqual(optionsInfo.services.map((s) => s.id), [ids.info]);
    assert.deepEqual(optionsInfo.employes.map((e) => e.id), [ids.e1]);
    assert.equal((await n.jean.requete('/api/rapports/options')).statut, 403);

    // État du parc
    assert.equal((await rapport(n.admin, 'parc')).total, 5);
    assert.deepEqual((await rapport(n.admin, 'parc', 'statut=PERDU')).lignes.map((l) => l.materiel_id), [ids.scanner]);
    assert.equal((await rapport(n.admin, 'parc', `site_id=${ids.siege}&etat=ENDOMMAGE`)).lignes[0].materiel_id, ids.ecran);
    const pc = (await rapport(n.admin, 'parc', `employe_id=${ids.e1}`)).lignes;
    assert.deepEqual([pc.length, pc[0].responsable], [1, 'RAKOTO Jean (E001)']);
    assert.deepEqual((await rapport(n.respAdm, 'parc')).lignes.map((l) => l.materiel_id).sort(), [ids.imprimante, ids.scanner].sort());

    // Mouvements : une ligne par bien ; le responsable ne voit pas ce qui ne touche pas son service ni son site.
    const pertes = (await rapport(n.admin, 'mouvements', 'type_code=PERTE')).lignes;
    assert.deepEqual([pertes.length, pertes[0].materiel_id, pertes[0].site_origine, pertes[0].numero_ticket], [1, ids.scanner, 'Dépôt', 'TK-300']);
    assert.equal((await rapport(n.respInfo, 'mouvements', 'type_code=PERTE')).total, 0);
    assert.equal((await rapport(n.respAdm, 'mouvements', 'type_code=PERTE')).total, 1);
    assert.equal((await rapport(n.admin, 'mouvements', `date_debut=${decaler(1)}`)).total, 0);
    assert.equal((await rapport(n.admin, 'mouvements', `employe_id=${ids.e1}`)).total, 3, 'deux remises et un retour');

    // Affectations en cours et retours
    const encours = (await rapport(n.admin, 'affectations')).lignes;
    assert.deepEqual([encours.length, encours[0].materiel_id, encours[0].etat_remise, encours[0].jours_de_retard], [1, ids.pc, 'NEUF', 2]);
    assert.equal((await rapport(n.admin, 'affectations', 'alerte=oui')).total, 1);
    assert.equal((await rapport(n.respAdm, 'affectations')).total, 0);
    const retours = (await rapport(n.admin, 'retours')).lignes;
    assert.deepEqual([retours.length, retours[0].etat_retour, retours[0].observations_retour, retours[0].jours_de_retard],
      [1, 'ENDOMMAGE', '-Écran rayé sur le bord', 3]);

    // Stock : global, par site, alertes ; le responsable voit le site de son service.
    const stock = (await rapport(n.admin, 'stock')).lignes;
    assert.deepEqual(stock.map((l) => [l.article_id, l.quantite, l.alerte]), [[ids.papier, 5, 'SOUS_SEUIL'], [ids.toner, 0, 'RUPTURE']]);
    assert.deepEqual((await rapport(n.admin, 'stock', `site_id=${ids.depot}`)).lignes.map((l) => [l.article_id, l.quantite, l.alerte]),
      [[ids.papier, 3, null]]);
    assert.deepEqual((await rapport(n.respInfo, 'stock', `site_id=${ids.depot}`)).lignes.map((l) => [l.article_id, l.quantite]),
      [[ids.papier, 2]], 'forcé au site du service (siège)');

    // Anomalies : perte, casse, manquant au transfert, réparation, hors service.
    const anomalies = (await rapport(n.admin, 'anomalies')).lignes;
    assert.deepEqual(anomalies.map((a) => a.nature).sort(), ['CASSE', 'HORS_SERVICE', 'MANQUANT', 'PERTE', 'REPARATION']);
    const manquant = anomalies.find((a) => a.nature === 'MANQUANT');
    assert.deepEqual([manquant.quantite, manquant.detail, manquant.site], [1, 'Une boîte mouillée', 'Dépôt']);
    assert.equal(anomalies.find((a) => a.nature === 'HORS_SERVICE').detail, 'Carte mère grillée');
    assert.equal((await rapport(n.admin, 'anomalies', 'nature=PERTE')).total, 1);
    assert.deepEqual((await rapport(n.respAdm, 'anomalies')).lignes.map((a) => a.nature).sort(), ['HORS_SERVICE', 'MANQUANT', 'PERTE']);
    assert.deepEqual((await rapport(n.respInfo, 'anomalies')).lignes.map((a) => a.nature).sort(), ['CASSE', 'REPARATION']);

    // Journal : administrateur seulement ; rapport inconnu ; employé.
    assert.ok((await rapport(n.admin, 'journal', 'action=MATERIEL_ETAT')).lignes.every((j) => j.action === 'MATERIEL_ETAT' && j.objet.startsWith('Matériel n°')));
    assert.equal((await n.g1.requete('/api/rapports/journal')).statut, 403);
    assert.equal((await n.admin.requete('/api/rapports/inconnu')).statut, 404);
    assert.equal((await n.jean.requete('/api/rapports/parc')).statut, 403);
  });

  test('Recette 12 — export CSV cohérent avec les filtres et les droits', async () => {
    const apercu = await rapport(n.admin, 'parc', 'statut=EN_REPARATION');
    const reponse = await n.admin.requete('/api/rapports/parc/export/csv?statut=EN_REPARATION');
    assert.equal(reponse.statut, 200);
    assert.match(reponse.entetes.get('content-type'), /^text\/csv; charset=utf-8/);
    assert.match(reponse.entetes.get('content-disposition'), new RegExp(`^attachment; filename="?rapport-parc-${decaler(0)}\\.csv"?$`));
    // fetch retire le BOM en lisant le texte : il se voit aux 3 octets de plus annoncés par le serveur.
    assert.equal(Number(reponse.entetes.get('content-length')), Buffer.byteLength(reponse.donnees, 'utf8') + 3, 'BOM pour Excel');
    const lignes = lignesCsv(reponse.donnees);
    assert.equal(lignes[0], 'Code;Désignation;Catégorie;État;Statut;Site;Service;Responsable;Retour prévu');
    assert.equal(lignes.length - 1, apercu.total);
    assert.ok(lignes.slice(1).every((ligne) => ligne.split(';')[4] === 'En réparation'));
    assert.ok(lignes.some((ligne) => ligne.includes(';Hors service;')));

    // Le responsable n'exporte que son service, même sans filtre.
    const adm = lignesCsv((await n.respAdm.requete('/api/rapports/parc/export/csv')).donnees);
    assert.deepEqual(adm.slice(1).map((ligne) => ligne.split(';')[1]).sort(), ['Imprimante', 'Scanner']);
    assert.equal((await n.jean.requete('/api/rapports/parc/export/csv')).statut, 403);
    assert.equal((await n.g1.requete('/api/rapports/journal/export/csv')).statut, 403);

    // Cellules protégées : point-virgule entre guillemets, jamais de formule pour Excel.
    const anomalies = (await n.admin.requete('/api/rapports/anomalies/export/csv')).donnees;
    assert.ok(anomalies.includes('"Volé; plainte déposée"'));
    const retours = (await n.admin.requete('/api/rapports/retours/export/csv')).donnees;
    assert.ok(retours.includes(";'-Écran rayé sur le bord;"));
    assert.ok(retours.includes(';Endommagé;'));

    // Chaque export est inscrit au journal, avec les filtres appliqués.
    const { rows } = await db.requete(
      "SELECT utilisateur_id, metadonnees FROM historique_actions WHERE action = 'EXPORT_RAPPORT' ORDER BY id",
    );
    const premier = rows[0];
    assert.equal(premier.utilisateur_id, ids.admin);
    assert.deepEqual([premier.metadonnees.rapport, premier.metadonnees.format, premier.metadonnees.lignes, premier.metadonnees.filtres],
      ['État du parc', 'CSV', apercu.total, 'Statut : En réparation']);
    assert.match(rows[1].metadonnees.filtres, /Périmètre : votre service/);
    assert.equal(rows.length, 4, 'les exports refusés ne sont pas inscrits');
  });

  test('export PDF : fichier mis en page, limites, journal', async () => {
    const reponse = await n.admin.requete(`/api/rapports/anomalies/export/pdf?date_debut=${decaler(-30)}&site_id=${ids.depot}`);
    assert.equal(reponse.statut, 200);
    assert.equal(reponse.entetes.get('content-type'), 'application/pdf');
    assert.ok(reponse.donnees.startsWith('%PDF-'));
    assert.match(reponse.entetes.get('content-disposition'), /rapport-anomalies-.*\.pdf/);
    const { rows: [dernier] } = await db.requete(
      "SELECT metadonnees FROM historique_actions WHERE action = 'EXPORT_RAPPORT' ORDER BY id DESC LIMIT 1",
    );
    assert.equal(dernier.metadonnees.format, 'PDF');
    assert.match(dernier.metadonnees.filtres, /Depuis le .* · Site : Dépôt/);
    assert.equal((await n.respInfo.requete('/api/rapports/parc/export/pdf')).statut, 200);
    assert.equal((await n.admin.requete('/api/rapports/parc/export/xls')).statut, 404);

    // Au-delà de la limite, l'export est refusé avec un message clair.
    const { LIMITES_EXPORT } = await import('../routes/rapports.js');
    const limite = LIMITES_EXPORT.pdf;
    LIMITES_EXPORT.pdf = 2;
    try {
      const trop = await n.admin.requete('/api/rapports/anomalies/export/pdf');
      assert.equal(trop.statut, 422);
      assert.equal(trop.donnees.erreur.code, 'TROP_DE_LIGNES');
      assert.match(trop.donnees.erreur.message, /^5 lignes .* exportez en CSV/);
    } finally {
      LIMITES_EXPORT.pdf = limite;
    }
  });

  test('pages : tableau de bord et rapports selon les droits', async () => {
    const page = async (navigateur, chemin) => {
      const reponse = await navigateur.requete(chemin);
      return reponse.statut === 200 ? 200 : reponse.entetes.get('location');
    };
    for (const cle of ['admin', 'g1', 'respInfo']) assert.equal(await page(n[cle], '/rapports'), 200);
    assert.equal(await page(n.jean, '/rapports'), '/');
  });
});
