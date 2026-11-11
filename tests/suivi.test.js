// Phase 7 : états, historiques, alertes, journal.
// Recette (cahier des charges § 11) : test 10 (changement d'état).
// Décisions du 11/11 : retour de réparation au choix du gestionnaire, délais
// d'alerte 3 / 30 / 7 jours modifiables, alertes du responsable limitées à
// son service, journal consultable par l'administrateur.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { raisonSansBase, reinitialiserBaseDeTest } from './environnement.js';
import { Navigateur, creerCompte, demarrerServeur } from './outils.js';

const MDP = 'Essai-suivi-2026';
const decaler = (jours) => new Date(Date.now() + 3 * 3600 * 1000 + jours * 86400000).toISOString().slice(0, 10);

describe('états, historiques, alertes, journal', { skip: raisonSansBase }, () => {
  let serveur;
  let db;
  const n = {};
  const ids = {};
  const nav = () => new Navigateur(serveur.adresse);
  const etat = (navigateur, materielId, corps) => navigateur.requete(`/api/materiels/${materielId}/etat`, { methode: 'POST', corps });
  const poster = async (navigateur, chemin, corps) => {
    const reponse = await navigateur.requete(chemin, { methode: 'POST', corps });
    assert.ok(reponse.statut < 300, `${chemin} : ${JSON.stringify(reponse.donnees)}`);
    return reponse.donnees;
  };
  const alertes = async (navigateur) => {
    const { rubriques } = (await navigateur.requete('/api/alertes')).donnees;
    return Object.fromEntries(rubriques.map((r) => [r.code, r]));
  };

  before(async () => {
    await reinitialiserBaseDeTest();
    db = await import('../database/db.js');
    serveur = await demarrerServeur();
    ids.admin = await creerCompte({ nom: 'Admin Suivi', email: 'admin@test.local', role: 'ADMIN', motDePasse: MDP });
    ids.g1 = await creerCompte({ nom: 'Gestionnaire Un', email: 'g1@test.local', role: 'GESTIONNAIRE', motDePasse: MDP });
    ids.g2 = await creerCompte({ nom: 'Gestionnaire Deux', email: 'g2@test.local', role: 'GESTIONNAIRE', motDePasse: MDP });
    for (const cle of ['admin', 'g1', 'g2']) {
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
    const informatique = categories.find((c) => c.nom === 'Informatique').id;
    const fournitures = categories.find((c) => c.nom === 'Fournitures de bureau').id;
    const materiel = async (designation, site, service) => (await creer('/api/materiels', {
      designation, categorie_id: informatique, site_id: site, service_id: service, etat: 'NEUF',
    })).materiel.id;
    ids.pc = await materiel('Ordinateur portable', ids.siege, ids.info);
    ids.ecran = await materiel('Écran', ids.siege, ids.info);
    ids.telephone = await materiel('Téléphone', ids.siege, ids.info);
    ids.imprimante = await materiel('Imprimante', ids.depot, ids.adm);
    ids.scanner = await materiel('Scanner', ids.depot, ids.adm);
    ids.papier = (await creer('/api/articles', { designation: 'Papier A4', categorie_id: fournitures, unite_code: 'BOITE', seuil_minimum: 5 })).article.id;

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

  test('Recette 10 — changement d’état : daté, signé, commenté et historisé', async () => {
    const sansCommentaire = await etat(n.g1, ids.pc, { etat: 'ENDOMMAGE' });
    assert.equal(sansCommentaire.statut, 422);
    assert.equal(sansCommentaire.donnees.erreur.champ, 'commentaire');

    const endommage = await etat(n.g1, ids.pc, { etat: 'ENDOMMAGE', commentaire: 'Écran fissuré' });
    assert.equal(endommage.statut, 200);
    assert.deepEqual([endommage.donnees.materiel.etat, endommage.donnees.materiel.statut], ['ENDOMMAGE', 'DISPONIBLE']);
    const [dernier] = (await n.g1.requete(`/api/materiels/${ids.pc}`)).donnees.historique;
    assert.deepEqual(
      [dernier.ancien_etat, dernier.nouvel_etat, dernier.ancien_statut, dernier.nouveau_statut, dernier.commentaire, dernier.auteur],
      ['NEUF', 'ENDOMMAGE', 'DISPONIBLE', 'DISPONIBLE', 'Écran fissuré', 'Gestionnaire Un'],
    );
    assert.ok(dernier.date_changement);

    assert.equal((await etat(n.g1, ids.pc, { statut: 'EN_REPARATION' })).donnees.erreur.champ, 'commentaire');
    assert.equal((await etat(n.g1, ids.pc, { statut: 'EN_REPARATION', commentaire: 'Chez le réparateur' })).donnees.materiel.statut, 'EN_REPARATION');
    assert.equal((await etat(n.g1, ids.pc, { etat: 'HORS_SERVICE', commentaire: 'Carte mère grillée' })).donnees.materiel.etat, 'HORS_SERVICE');
    const horsServiceDisponible = await etat(n.g1, ids.pc, { statut: 'DISPONIBLE', commentaire: 'Essai' });
    assert.equal(horsServiceDisponible.statut, 422);
    assert.equal(horsServiceDisponible.donnees.erreur.champ, 'etat');
    // Décision du 11/11 : au retour de réparation, l'état est au choix (il peut rester endommagé).
    const retour = (await etat(n.g1, ids.pc, { etat: 'ENDOMMAGE', statut: 'DISPONIBLE', commentaire: 'Réparé en partie' })).donnees.materiel;
    assert.deepEqual([retour.etat, retour.statut], ['ENDOMMAGE', 'DISPONIBLE']);
    assert.equal((await etat(n.g1, ids.pc, { etat: 'ENDOMMAGE' })).donnees.erreur.code, 'SAISIE_VIDE');
    assert.equal((await etat(n.g1, ids.pc, {})).statut, 422);

    assert.equal((await etat(n.respInfo, ids.pc, { etat: 'BON' })).statut, 403);
    assert.equal((await etat(n.jean, ids.pc, { etat: 'BON' })).statut, 403);
    const journal = await db.requete("SELECT count(*)::int AS n FROM historique_actions WHERE action = 'MATERIEL_ETAT' AND entite_id = $1", [ids.pc]);
    assert.equal(journal.rows[0].n, 4);
  });

  test('changement d’état : matériel remis à un employé, perdu', async () => {
    const affectation = (await poster(n.g1, '/api/affectations', {
      materiel_id: ids.ecran, employe_id: ids.e1, numero_contrat: 'CT-100', date_retour_prevue: decaler(3), numero_ticket: 'TK-100',
    })).affectation;
    ids.affEcran = affectation.id;
    const constat = (await etat(n.g1, ids.ecran, { etat: 'MOYEN', commentaire: 'Rayures constatées' })).donnees.materiel;
    assert.deepEqual([constat.etat, constat.statut], ['MOYEN', 'AFFECTE']);
    assert.equal((await etat(n.g1, ids.ecran, { statut: 'EN_REPARATION', commentaire: 'Panne' })).statut, 409);
    assert.equal((await etat(n.g1, ids.ecran, { etat: 'HORS_SERVICE', commentaire: 'Panne' })).donnees.erreur.champ, 'etat');

    await poster(n.g1, '/api/mouvements', {
      type_code: 'PERTE', site_source_id: ids.siege, motif: 'Introuvable', numero_ticket: 'TK-101',
      lignes: [{ materiel_id: ids.telephone }], valider: true,
    });
    const perdu = await etat(n.g1, ids.telephone, { etat: 'BON' });
    assert.equal(perdu.statut, 409);
    assert.match(perdu.donnees.erreur.message, /perdu/);
  });

  test('historique des états : tout le parc, filtres, périmètre du responsable', async () => {
    const tout = (await n.g1.requete('/api/historique-etats')).donnees;
    assert.ok(tout.total >= 10);
    assert.equal(tout.historique[0].code.startsWith('MAT-'), true);
    const datesDecroissantes = tout.historique.map((h) => h.date_changement);
    assert.deepEqual([...datesDecroissantes].sort().reverse(), datesDecroissantes);

    const pc = (await n.g1.requete(`/api/historique-etats?materiel_id=${ids.pc}&changements=oui`)).donnees;
    assert.equal(pc.total, 4);
    assert.ok(pc.historique.every((h) => h.auteur === 'Gestionnaire Un'));
    assert.equal((await n.g1.requete('/api/historique-etats?etat=HORS_SERVICE')).donnees.historique[0].materiel_id, ids.pc);
    assert.equal((await n.g1.requete('/api/historique-etats?q=Carte%20m%C3%A8re')).donnees.total, 1);
    assert.equal((await n.g1.requete(`/api/historique-etats?date_debut=${decaler(1)}`)).donnees.total, 0);

    assert.ok((await n.respInfo.requete('/api/historique-etats')).donnees.historique.some((h) => h.materiel_id === ids.pc));
    const adm = (await n.respAdm.requete('/api/historique-etats')).donnees.historique;
    assert.ok(adm.length > 0 && adm.every((h) => [ids.imprimante, ids.scanner].includes(h.materiel_id)), 'seulement son service');
    assert.equal((await n.jean.requete('/api/historique-etats')).statut, 403);
  });

  test('alertes : stocks, retours, transferts, réparations, endommagés, à autoriser', async () => {
    await poster(n.g1, '/api/mouvements', {
      type_code: 'RECEPTION_ACHAT', date_mouvement: decaler(-10), site_destination_id: ids.siege,
      lignes: [{ article_id: ids.papier, quantite: 4 }], valider: true,
    });
    const ancien = (await poster(n.g1, '/api/mouvements', {
      type_code: 'TRANSFERT', date_mouvement: decaler(-5), site_source_id: ids.siege, site_destination_id: ids.depot,
      motif: 'Réassort', lignes: [{ article_id: ids.papier, quantite: 1 }], valider: true,
    })).mouvement;
    const recent = (await poster(n.g1, '/api/mouvements', {
      type_code: 'TRANSFERT', site_source_id: ids.siege, site_destination_id: ids.depot,
      motif: 'Réassort', lignes: [{ article_id: ids.papier, quantite: 1 }], valider: true,
    })).mouvement;
    assert.equal((await n.g1.requete(`/api/articles/${ids.papier}/seuils/${ids.depot}`, { methode: 'PUT', corps: { seuil_minimum: 2 } })).statut, 200);
    const retard = (await poster(n.g1, '/api/affectations', {
      materiel_id: ids.imprimante, employe_id: ids.e2, numero_contrat: 'CT-200', date_remise: decaler(-10),
      date_retour_prevue: decaler(-2), numero_ticket: 'TK-200',
    })).affectation;
    await etat(n.g1, ids.scanner, { statut: 'EN_REPARATION', commentaire: 'Rouleau coincé' });
    const brouillon = (await poster(n.g2, '/api/mouvements', {
      type_code: 'CORRECTION_PLUS', site_destination_id: ids.siege, motif: 'Inventaire', lignes: [{ article_id: ids.papier, quantite: 1 }],
    })).mouvement;

    const g1 = await alertes(n.g1);
    const stock = g1.stock.elements;
    assert.ok(stock.some((s) => s.portee === 'GLOBAL' && s.article_id === ids.papier && s.quantite === 2 && s.seuil === 5));
    assert.ok(stock.some((s) => s.portee === 'SITE' && s.site_id === ids.depot && s.quantite === 0 && s.en_rupture));
    assert.deepEqual(g1.retours_retard.elements.map((a) => a.affectation_id), [retard.id]);
    assert.equal(g1.retours_retard.elements[0].jours_de_retard, 2);
    assert.deepEqual(g1.retours_proches.elements.map((a) => a.affectation_id), [ids.affEcran]);
    assert.deepEqual(g1.transferts.elements.map((t) => t.id), [ancien.id], 'le transfert du jour n’est pas en retard');
    assert.ok(!g1.transferts.elements.some((t) => t.id === recent.id));
    assert.equal(g1.reparations.nombre, 0, 'réparation de moins de 30 jours');
    assert.deepEqual(g1.endommages.elements.map((m) => m.materiel_id), [ids.pc]);
    assert.deepEqual(g1.a_autoriser.elements.map((m) => m.id), [brouillon.id]);
    assert.equal((await alertes(n.g2)).a_autoriser.nombre, 0, 'pas son propre brouillon');
    assert.equal(g1.signalements.nombre, 0);
    assert.ok(g1.etiquettes.nombre >= 4);

    const resume = (await n.g1.requete('/api/alertes?resume=oui')).donnees;
    const attendu = Object.values(g1).filter((r) => r.niveau !== 'info').reduce((somme, r) => somme + r.nombre, 0);
    assert.equal(resume.total, attendu);
    assert.ok(resume.rubriques.every((r) => r.elements === undefined));

    // Délai de réparation ramené à 0 jour par l'administrateur.
    assert.equal((await n.admin.requete('/api/parametres/alerte_reparation_jours', { methode: 'PATCH', corps: { valeur: '0' } })).statut, 200);
    const reparations = (await alertes(n.g1)).reparations;
    assert.deepEqual(reparations.elements.map((r) => [r.materiel_id, r.jours, r.commentaire]), [[ids.scanner, 0, 'Rouleau coincé']]);
    assert.equal(reparations.titre, 'En réparation depuis 0 jour ou plus');

    // Responsable : son service et le site de son service seulement.
    const adm = await alertes(n.respAdm);
    assert.ok(adm.stock.elements.length > 0 && adm.stock.elements.every((s) => s.portee === 'SITE' && s.site_id === ids.depot));
    assert.deepEqual(adm.retours_retard.elements.map((a) => a.affectation_id), [retard.id]);
    assert.deepEqual(adm.retours_proches.elements, []);
    assert.deepEqual(adm.transferts.elements.map((t) => t.id), [ancien.id], 'transfert vers le site de son service');
    assert.deepEqual(adm.reparations.elements.map((r) => r.materiel_id), [ids.scanner]);
    assert.deepEqual(adm.endommages.elements, []);
    for (const code of ['signalements', 'a_autoriser', 'etiquettes']) assert.equal(adm[code], undefined, code);
    const info = await alertes(n.respInfo);
    assert.deepEqual(info.stock.elements, [], 'aucun seuil propre au site du siège');
    assert.deepEqual(info.retours_retard.elements, []);
    assert.deepEqual(info.retours_proches.elements.map((a) => a.affectation_id), [ids.affEcran]);
    assert.deepEqual(info.reparations.elements, []);
    assert.deepEqual(info.endommages.elements.map((m) => m.materiel_id), [ids.pc]);
    assert.equal((await n.jean.requete('/api/alertes')).statut, 403);
    await n.admin.requete('/api/parametres/alerte_reparation_jours', { methode: 'PATCH', corps: { valeur: '30' } });
  });

  test('paramètres : délais d’alerte modifiables par l’administrateur seulement', async () => {
    const { parametres } = (await n.admin.requete('/api/parametres')).donnees;
    const delais = parametres.filter((p) => p.cle.startsWith('alerte_'));
    assert.deepEqual(delais.map((p) => [p.cle, p.valeur, p.modifiable]), [
      ['alerte_reparation_jours', '30', true], ['alerte_retour_jours', '7', true], ['alerte_transfert_jours', '3', true],
    ]);
    const changer = (navigateur, valeur) => navigateur.requete('/api/parametres/alerte_transfert_jours', { methode: 'PATCH', corps: { valeur } });
    assert.equal((await changer(n.admin, '400')).statut, 422);
    assert.equal((await changer(n.admin, 'trois')).statut, 422);
    assert.equal((await changer(n.g1, '5')).statut, 403);
    assert.equal((await changer(n.admin, '5')).donnees.parametre.valeur, '5');
    assert.match((await alertes(n.g1)).transferts.titre, /5 jours/);
    assert.equal((await alertes(n.g1)).transferts.nombre, 1, 'en route depuis 5 jours');
    await changer(n.admin, '3');
  });

  test('journal des opérations : réservé à l’administrateur, filtres', async () => {
    const tout = (await n.admin.requete('/api/journal')).donnees;
    assert.ok(tout.total > 10);
    for (const action of ['CONNEXION', 'MATERIEL_ETAT', 'MOUVEMENT_VALIDE', 'MATERIEL_REMIS']) assert.ok(tout.actions.includes(action), action);
    assert.ok(tout.utilisateurs.some((u) => u.nom === 'Gestionnaire Un'));
    const etats = (await n.admin.requete('/api/journal?action=MATERIEL_ETAT')).donnees;
    assert.ok(etats.journal.length >= 5 && etats.journal.every((j) => j.action === 'MATERIEL_ETAT'));
    assert.ok(etats.journal.every((j) => j.utilisateur === 'Gestionnaire Un'));
    const carte = (await n.admin.requete(`/api/journal?q=${encodeURIComponent('Carte mère')}`)).donnees.journal;
    assert.equal(carte.length, 1);
    assert.equal(carte[0].metadonnees.etat.apres, 'HORS_SERVICE');
    assert.equal((await n.admin.requete(`/api/journal?utilisateur_id=${ids.g2}&action=MATERIEL_ETAT`)).donnees.total, 0);
    assert.equal((await n.admin.requete(`/api/journal?date_debut=${decaler(1)}`)).donnees.total, 0);
    assert.equal((await n.g1.requete('/api/journal')).statut, 403);
    assert.equal((await n.respInfo.requete('/api/journal')).statut, 403);
  });

  test('pages : alertes, historique et journal selon les droits', async () => {
    const page = async (navigateur, chemin) => {
      const reponse = await navigateur.requete(chemin);
      return reponse.statut === 200 ? 200 : reponse.entetes.get('location');
    };
    assert.equal(await page(n.g1, '/alertes'), 200);
    assert.equal(await page(n.g1, '/historique'), 200);
    assert.equal(await page(n.g1, '/journal'), '/');
    assert.equal(await page(n.admin, '/journal'), 200);
    assert.equal(await page(n.respInfo, '/alertes'), 200);
    assert.equal(await page(n.respInfo, '/historique'), 200);
    assert.equal(await page(n.jean, '/alertes'), '/');
    assert.equal(await page(n.jean, '/historique'), '/');
  });

  test('cohérence finale : stock tenu = stock recalculé, statuts cohérents', async () => {
    assert.equal((await db.requete('SELECT count(*)::int AS n FROM v_controle_stocks')).rows[0].n, 0);
    assert.equal((await db.requete('SELECT count(*)::int AS n FROM v_controle_materiels')).rows[0].n, 0);
  });
});
