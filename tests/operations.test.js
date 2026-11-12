// Phase 6 : mouvements, réceptions, affectations, signalements, paramètres.
// Recette (cahier des charges § 11) : tests 5 à 11 ; scénarios 4.2 et 4.3.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { raisonSansBase, reinitialiserBaseDeTest } from './environnement.js';
import { Navigateur, creerCompte, demarrerServeur, transfertEnRoute } from './outils.js';

const MDP = 'Essai-operations-2026';
const aujourdhui = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);   // Antananarivo
const decaler = (jours) => new Date(Date.now() + 3 * 3600 * 1000 + jours * 86400000).toISOString().slice(0, 10);

describe('mouvements, réceptions, affectations, signalements', { skip: raisonSansBase }, () => {
  let serveur;
  let db;
  const n = {};       // navigateurs connectés
  const ids = {};
  const nav = () => new Navigateur(serveur.adresse);

  const stock = async (articleId, site) => {
    const { article, sites } = (await n.g1.requete(`/api/articles/${articleId}`)).donnees;
    return site ? (sites.find((s) => s.site_id === site)?.quantite ?? 0) : article.quantite_disponible;
  };
  const mouvement = (navigateur, corps) => navigateur.requete('/api/mouvements', { methode: 'POST', corps });
  const compter = async () => (await db.requete('SELECT count(*)::int AS n FROM mouvements')).rows[0].n;

  before(async () => {
    await reinitialiserBaseDeTest();
    db = await import('../database/db.js');
    serveur = await demarrerServeur();
    await creerCompte({ nom: 'Admin Ops', email: 'admin@test.local', role: 'ADMIN', motDePasse: MDP });
    await creerCompte({ nom: 'Gestionnaire Un', email: 'g1@test.local', role: 'GESTIONNAIRE', motDePasse: MDP });
    await creerCompte({ nom: 'Gestionnaire Deux', email: 'g2@test.local', role: 'GESTIONNAIRE', motDePasse: MDP });
    for (const [cle, email] of [['admin', 'admin@test.local'], ['g1', 'g1@test.local'], ['g2', 'g2@test.local']]) {
      n[cle] = nav();
      await n[cle].connexion(email, MDP);
    }
    const creer = async (chemin, corps) => (await n.admin.requete(chemin, { methode: 'POST', corps })).donnees;
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
    ids.imprimante = await materiel('Imprimante', ids.depot, ids.adm);
    ids.tablette = await materiel('Tablette', ids.siege, ids.info);
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

  test('Recette 5 et 6 — réception de 10 unités, puis sortie de 3', async () => {
    const reception = await mouvement(n.g1, {
      type_code: 'RECEPTION_ACHAT', site_destination_id: ids.siege, origine: 'Papeterie', reference_externe: 'BL-1',
      lignes: [{ article_id: ids.papier, quantite: 10 }], valider: true,
    });
    assert.equal(reception.statut, 201);
    assert.equal(reception.donnees.mouvement.statut, 'VALIDE');
    assert.equal(await stock(ids.papier), 10);

    const sortie = await mouvement(n.g1, {
      type_code: 'CONSOMMATION', site_source_id: ids.siege, service_beneficiaire_id: ids.adm, motif: 'Besoins du mois',
      lignes: [{ article_id: ids.papier, quantite: '3' }], valider: true,
    });
    assert.equal(sortie.statut, 201);
    ids.sortie3 = sortie.donnees.mouvement.id;
    assert.equal(await stock(ids.papier), 7);
  });

  test('Recette 7 — sortie supérieure au stock : refusée, rien d’enregistré', async () => {
    const avant = await compter();
    const refus = await mouvement(n.g1, {
      type_code: 'CONSOMMATION', site_source_id: ids.siege, service_beneficiaire_id: ids.adm, motif: 'Trop',
      lignes: [{ article_id: ids.papier, quantite: 8 }], valider: true,
    });
    assert.equal(refus.statut, 409);
    assert.equal(refus.donnees.erreur.code, 'STOCK_INSUFFISANT');
    assert.match(refus.donnees.erreur.message, /disponible 7, demandé 8/);
    assert.equal(await stock(ids.papier), 7);
    assert.equal(await compter(), avant);
  });

  test('Scénario 4.3 — 20 boîtes, sortie de 5 pour le service administratif : 15', async () => {
    await mouvement(n.g1, { type_code: 'RECEPTION_DON', site_destination_id: ids.siege, lignes: [{ article_id: ids.papier, quantite: 13 }], valider: true });
    assert.equal(await stock(ids.papier), 20);
    const sortie = await mouvement(n.g1, {
      type_code: 'CONSOMMATION', site_source_id: ids.siege, service_beneficiaire_id: ids.adm, motif: 'Dotation',
      lignes: [{ article_id: ids.papier, quantite: 5 }], valider: true,
    });
    const fiche = sortie.donnees.mouvement;
    assert.equal(await stock(ids.papier), 15);
    assert.equal(fiche.service_beneficiaire, 'Administration');
    assert.equal(fiche.motif, 'Dotation');
    assert.equal(fiche.cree_par_nom, 'Gestionnaire Un');
    assert.equal(fiche.date_mouvement, aujourdhui());
    assert.equal(fiche.lignes[0].quantite, 5);
  });

  test('brouillon : enregistré, modifié, puis validé', async () => {
    const brouillon = await mouvement(n.g1, {
      type_code: 'CONSOMMATION', site_source_id: ids.siege, employe_beneficiaire_id: ids.e1, motif: 'Bureau',
      lignes: [{ article_id: ids.papier, quantite: 1 }],
    });
    assert.equal(brouillon.donnees.mouvement.statut, 'BROUILLON');
    assert.equal(await stock(ids.papier), 15, 'un brouillon ne touche pas le stock');
    const id = brouillon.donnees.mouvement.id;
    const modifie = await n.g1.requete(`/api/mouvements/${id}`, {
      methode: 'PUT',
      corps: { site_source_id: ids.siege, employe_beneficiaire_id: ids.e1, motif: 'Bureau', lignes: [{ article_id: ids.papier, quantite: 2 }] },
    });
    assert.equal(modifie.donnees.mouvement.lignes[0].quantite, 2);
    assert.equal(modifie.donnees.mouvement.lignes[0].stock_origine, 15, 'stock disponible affiché pendant la saisie');
    assert.equal((await n.g1.requete(`/api/mouvements/${id}/valider`, { methode: 'POST' })).donnees.mouvement.statut, 'VALIDE');
    assert.equal(await stock(ids.papier), 13);
    assert.equal((await n.g1.requete(`/api/mouvements/${id}`, { methode: 'PUT', corps: {} })).statut, 409, 'validé : plus modifiable');
  });

  test('contrôles de saisie : type réservé, motif, bénéficiaire, sites, lignes, décimales', async () => {
    const base = { type_code: 'CONSOMMATION', site_source_id: ids.siege, service_beneficiaire_id: ids.adm, motif: 'Test', lignes: [{ article_id: ids.papier, quantite: 1 }], valider: true };
    assert.equal((await mouvement(n.g1, { ...base, type_code: 'AFFECTATION' })).donnees.erreur.champ, 'type_code');
    assert.equal((await mouvement(n.g1, { ...base, motif: null })).donnees.erreur.code, 'INFORMATION_MANQUANTE');
    assert.equal((await mouvement(n.g1, { ...base, service_beneficiaire_id: null })).donnees.erreur.code, 'INFORMATION_MANQUANTE');
    assert.equal((await mouvement(n.g1, { ...base, site_source_id: null })).donnees.erreur.champ, 'site_source_id');
    assert.equal((await mouvement(n.g1, { ...base, lignes: [] })).donnees.erreur.champ, 'lignes');
    assert.equal((await mouvement(n.g1, { ...base, lignes: [{ article_id: ids.papier, quantite: '2,5' }] })).donnees.erreur.code, 'QUANTITE_NON_CONFORME');
    assert.equal((await mouvement(n.g1, { type_code: 'TRANSFERT', site_source_id: ids.siege, site_destination_id: ids.siege, motif: 'X', lignes: base.lignes })).donnees.erreur.champ, 'site_destination_id');
    assert.equal((await mouvement(n.respInfo, base)).statut, 403, 'le responsable ne saisit pas');
  });

  test('correction d’inventaire : autorisée seulement en validant par une autre personne', async () => {
    const corps = { type_code: 'CORRECTION_PLUS', site_destination_id: ids.siege, motif: 'Boîtes retrouvées', lignes: [{ article_id: ids.papier, quantite: 2 }] };
    const avant = await compter();
    const parSoi = await mouvement(n.g1, { ...corps, valider: true });
    assert.equal(parSoi.donnees.erreur.code, 'AUTORISATION_NON_VALABLE');
    assert.equal(await compter(), avant, 'rien d’enregistré');

    const brouillon = (await mouvement(n.g1, corps)).donnees.mouvement;
    assert.equal(brouillon.autorisation_requise, true);
    assert.equal((await n.g1.requete(`/api/mouvements/${brouillon.id}/valider`, { methode: 'POST' })).donnees.erreur.code, 'AUTORISATION_NON_VALABLE');
    const aAutoriser = (await n.g2.requete('/api/mouvements?a_autoriser=oui')).donnees.mouvements.map((m) => m.id);
    assert.ok(aAutoriser.includes(brouillon.id), 'visible par l’autre gestionnaire');
    assert.ok(!(await n.g1.requete('/api/mouvements?a_autoriser=oui')).donnees.mouvements.some((m) => m.id === brouillon.id), 'pas par son auteur');
    const valide = (await n.g2.requete(`/api/mouvements/${brouillon.id}/valider`, { methode: 'POST' })).donnees.mouvement;
    assert.equal(valide.autorise_par_nom, 'Gestionnaire Deux');
    assert.equal(await stock(ids.papier), 15);

    const admin = await mouvement(n.admin, { ...corps, valider: true });
    assert.equal(admin.statut, 201, 'l’administrateur peut autoriser sa propre correction');
    assert.equal(await stock(ids.papier), 17);
  });

  test('Recette 11 — annulation tracée ; mouvement inverse autorisé', async () => {
    assert.equal((await n.g1.requete(`/api/mouvements/${ids.sortie3}/annuler`, { methode: 'POST', corps: {} })).donnees.erreur.champ, 'motif');
    assert.equal((await n.respInfo.requete(`/api/mouvements/${ids.sortie3}/annuler`, { methode: 'POST', corps: { motif: 'Erreur' } })).statut, 403);
    const annule = (await n.g1.requete(`/api/mouvements/${ids.sortie3}/annuler`, { methode: 'POST', corps: { motif: 'Service erroné' } })).donnees.mouvement;
    assert.equal(annule.statut, 'ANNULE');
    assert.equal(annule.annule_par_nom, 'Gestionnaire Un');
    assert.equal(await stock(ids.papier), 20);
    assert.equal((await n.g1.requete(`/api/mouvements/${ids.sortie3}/annuler`, { methode: 'POST', corps: { motif: 'Encore' } })).donnees.erreur.code, 'ENREGISTREMENT_FIGE');

    const sortie = (await mouvement(n.g1, {
      type_code: 'CONSOMMATION', site_source_id: ids.siege, service_beneficiaire_id: ids.adm, motif: 'Distribution',
      lignes: [{ article_id: ids.papier, quantite: 4 }], valider: true,
    })).donnees.mouvement;
    const inverse = (await n.g1.requete(`/api/mouvements/${sortie.id}/inverse`, { methode: 'POST', corps: { motif: 'Rendu non utilisé' } })).donnees.mouvement;
    assert.equal(inverse.type_code, 'CORRECTION_PLUS');
    assert.equal(inverse.mouvement_corrige_reference, sortie.reference);
    assert.equal(inverse.lignes[0].site_destination_id, ids.siege);
    assert.equal((await n.g1.requete(`/api/mouvements/${inverse.id}/valider`, { methode: 'POST' })).donnees.erreur.code, 'AUTORISATION_NON_VALABLE');
    await n.g2.requete(`/api/mouvements/${inverse.id}/valider`, { methode: 'POST' });
    assert.equal(await stock(ids.papier), 20);
    assert.equal((await n.g1.requete(`/api/mouvements/${sortie.id}`)).donnees.mouvement.corrections[0].reference, inverse.reference);
  });

  test('transfert en route d’avant le 12/11 : réception par le responsable du site destinataire, manquant motivé', async () => {
    const envoi = await transfertEnRoute(n.g1, {
      type_code: 'TRANSFERT', site_source_id: ids.siege, site_destination_id: ids.depot, motif: 'Réassort',
      lignes: [{ article_id: ids.papier, quantite: 4 }],
    });
    assert.equal(envoi.etat_transfert, 'EN_ROUTE');
    assert.equal(await stock(ids.papier, ids.siege), 16);
    const enRoute = (await n.g1.requete('/api/receptions')).donnees.transferts.find((t) => t.id === envoi.id);
    assert.deepEqual([enRoute.site_origine, enRoute.site_destination, enRoute.lignes[0].quantite], ['Siège', 'Dépôt', 4]);
    assert.ok(!(await n.respInfo.requete('/api/receptions')).donnees.transferts.some((t) => t.id === envoi.id), 'n’arrive pas au site d’Info');
    assert.ok((await n.respAdm.requete('/api/receptions')).donnees.transferts.some((t) => t.id === envoi.id));

    const ligne = envoi.lignes[0].id;
    assert.equal((await n.respInfo.requete(`/api/mouvements/${envoi.id}/receptionner`, { methode: 'POST', corps: {} })).statut, 403);
    const sansMotif = await n.respAdm.requete(`/api/mouvements/${envoi.id}/receptionner`, { methode: 'POST', corps: { quantites: [{ ligne_id: ligne, quantite_recue: 3 }] } });
    assert.equal(sansMotif.donnees.erreur.code, 'INFORMATION_MANQUANTE');
    const recu = (await n.respAdm.requete(`/api/mouvements/${envoi.id}/receptionner`, {
      methode: 'POST', corps: { quantites: [{ ligne_id: ligne, quantite_recue: 3 }], motif_ecart: 'Une boîte mouillée' },
    })).donnees.mouvement;
    assert.equal(recu.etat_transfert, 'RECU');
    assert.equal(recu.recu_par_nom, 'Resp Adm');
    assert.equal(await stock(ids.papier, ids.depot), 3);
    assert.equal((await n.g1.requete(`/api/mouvements/${envoi.id}/receptionner`, { methode: 'POST', corps: {} })).donnees.erreur.code, 'ENREGISTREMENT_FIGE');
  });

  test('transfert d’un matériel : ticket exigé, reçu au dépôt dès l’envoi (décision du 12/11)', async () => {
    const corps = { type_code: 'TRANSFERT', site_source_id: ids.siege, site_destination_id: ids.depot, motif: 'Équipement du dépôt', lignes: [{ materiel_id: ids.ecran }], valider: true };
    assert.equal((await mouvement(n.g1, corps)).donnees.erreur.code, 'INFORMATION_MANQUANTE');
    const envoi = (await mouvement(n.g1, { ...corps, numero_ticket: 'TK-100' })).donnees.mouvement;
    assert.deepEqual([envoi.etat_transfert, envoi.recu_par_nom, envoi.date_reception], ['RECU', 'Gestionnaire Un', envoi.date_mouvement]);
    assert.equal(envoi.lignes[0].quantite_recue, 1);
    const fiche = (await n.g1.requete(`/api/materiels/${ids.ecran}`)).donnees.materiel;
    assert.equal(fiche.statut, 'DISPONIBLE');
    assert.equal(fiche.site_code, 'DEPOT');
    assert.equal((await n.g1.requete(`/api/mouvements/${envoi.id}/receptionner`, { methode: 'POST', corps: {} })).donnees.erreur.code, 'ENREGISTREMENT_FIGE');
  });

  test('transfert d’articles validé depuis un brouillon : reçu aussitôt, stocks des deux sites à jour', async () => {
    const depot = await stock(ids.papier, ids.depot);
    const siege = await stock(ids.papier, ids.siege);
    const brouillon = (await mouvement(n.g1, {
      type_code: 'TRANSFERT', site_source_id: ids.siege, site_destination_id: ids.depot, motif: 'Réassort',
      lignes: [{ article_id: ids.papier, quantite: 2 }],
    })).donnees.mouvement;
    assert.equal(brouillon.statut, 'BROUILLON');
    const valide = (await n.g1.requete(`/api/mouvements/${brouillon.id}/valider`, { methode: 'POST' })).donnees.mouvement;
    assert.equal(valide.etat_transfert, 'RECU');
    assert.deepEqual([await stock(ids.papier, ids.siege), await stock(ids.papier, ids.depot)], [siege - 2, depot + 2]);
    assert.ok(!(await n.g1.requete('/api/receptions')).donnees.transferts.some((t) => t.id === brouillon.id), 'plus rien à réceptionner');
  });

  test('Recette 8 — affectation sous contrat : statut « affecté », bénéficiaire sur la fiche', async () => {
    const corps = { materiel_id: ids.pc, employe_id: ids.e1, numero_contrat: 'CT-001', date_retour_prevue: decaler(30), numero_ticket: 'TK-200' };
    assert.equal((await n.g1.requete('/api/affectations', { methode: 'POST', corps: { ...corps, numero_ticket: null } })).donnees.erreur.champ, 'numero_ticket');
    assert.equal((await n.g1.requete('/api/affectations', { methode: 'POST', corps: { ...corps, date_retour_prevue: decaler(-1) } })).donnees.erreur.code, 'REGLE_NON_RESPECTEE');
    assert.equal((await n.g1.requete(`/api/materiels/${ids.pc}`)).donnees.materiel.statut, 'DISPONIBLE', 'tentatives refusées sans trace');

    const affectation = await n.g1.requete('/api/affectations', { methode: 'POST', corps });
    assert.equal(affectation.statut, 201);
    ids.affPc = affectation.donnees.affectation.id;
    assert.equal(affectation.donnees.affectation.materiel_statut, 'AFFECTE');
    const fiche = (await n.g1.requete(`/api/materiels/${ids.pc}`)).donnees;
    assert.equal(fiche.materiel.responsable, 'RAKOTO Jean');
    assert.equal(fiche.materiel.numero_contrat, 'CT-001');
    assert.equal(fiche.mouvements[0].type, 'Affectation à un employé');
    assert.equal(fiche.mouvements[0].numero_ticket, 'TK-200');

    const double = await n.g1.requete('/api/affectations', { methode: 'POST', corps: { ...corps, employe_id: ids.e2, numero_contrat: 'CT-002' } });
    assert.equal(double.donnees.erreur.code, 'INDISPONIBLE');
    assert.ok((await n.respInfo.requete('/api/affectations')).donnees.affectations.some((a) => a.id === ids.affPc), 'visible du responsable du service');
    assert.equal((await n.respInfo.requete(`/api/affectations/${ids.affPc}`)).donnees.affectation.numero_contrat, 'CT-001');
    assert.equal((await n.respAdm.requete(`/api/affectations/${ids.affPc}`)).statut, 404, 'hors du service du responsable');
    assert.equal((await n.jean.requete(`/api/affectations/${ids.affPc}`)).statut, 403);
  });

  test('prolongation du contrat, motivée et journalisée', async () => {
    const nouvelle = decaler(60);
    const prolonge = await n.g1.requete(`/api/affectations/${ids.affPc}/prolonger`, { methode: 'POST', corps: { date_retour_prevue: nouvelle, motif: 'Mission prolongée' } });
    assert.equal(prolonge.donnees.affectation.date_retour_prevue, nouvelle);
    assert.equal((await n.g1.requete(`/api/affectations/${ids.affPc}/prolonger`, { methode: 'POST', corps: { date_retour_prevue: nouvelle, motif: 'Idem' } })).statut, 422);
    const { rows: [journal] } = await db.requete("SELECT metadonnees FROM historique_actions WHERE action = 'PROLONGATION'");
    assert.equal(journal.metadonnees.motif, 'Mission prolongée');
  });

  test('mes matériels et signalements : désactivés, activés par l’administrateur, traités', async () => {
    const mes = (await n.jean.requete('/api/mes-materiels')).donnees;
    assert.equal(mes.rattache, true);
    assert.deepEqual(mes.materiels.map((m) => m.id), [ids.pc]);
    assert.equal(mes.signalements_actifs, false);
    const signaler = (materiel) => n.jean.requete('/api/signalements', { methode: 'POST', corps: { materiel_id: materiel, type: 'PANNE', description: 'L’écran clignote' } });
    assert.equal((await signaler(ids.pc)).donnees.erreur.code, 'FONCTION_DESACTIVEE');

    assert.equal((await n.g1.requete('/api/parametres/signalements_actifs', { methode: 'PATCH', corps: { valeur: 'oui' } })).statut, 403);
    assert.equal((await n.admin.requete('/api/parametres/signalements_actifs', { methode: 'PATCH', corps: { valeur: 'peut-être' } })).statut, 422);
    assert.equal((await n.admin.requete('/api/parametres/prefixe_materiel', { methode: 'PATCH', corps: { valeur: 'EQP' } })).donnees.erreur.code, 'PARAMETRE_FIGE');
    assert.equal((await n.admin.requete('/api/parametres/signalements_actifs', { methode: 'PATCH', corps: { valeur: 'oui' } })).statut, 200);

    assert.equal((await signaler(ids.imprimante)).statut, 403, 'pas son matériel');
    const cree = await signaler(ids.pc);
    assert.equal(cree.statut, 201);
    const id = cree.donnees.signalement.id;
    assert.equal((await n.g1.requete('/api/signalements?statut=a_traiter')).donnees.total, 1);
    assert.equal((await n.jean.requete('/api/signalements')).statut, 403, 'l’employé ne voit que les siens');
    assert.equal((await n.g1.requete(`/api/signalements/${id}`, { methode: 'PATCH', corps: { statut: 'CLOS' } })).donnees.erreur.champ, 'reponse');
    assert.equal((await n.g1.requete(`/api/signalements/${id}`, { methode: 'PATCH', corps: { statut: 'PRIS_EN_CHARGE' } })).donnees.signalement.traite_par, 'Gestionnaire Un');
    assert.equal((await n.g1.requete(`/api/signalements/${id}`, { methode: 'PATCH', corps: { statut: 'CLOS', reponse: 'Écran remplacé' } })).donnees.signalement.statut, 'CLOS');
    assert.equal((await n.g1.requete(`/api/signalements/${id}`, { methode: 'PATCH', corps: { statut: 'PRIS_EN_CHARGE' } })).donnees.erreur.code, 'ENREGISTREMENT_FIGE');
    assert.equal((await n.jean.requete('/api/mes-materiels')).donnees.signalements[0].reponse, 'Écran remplacé');
  });

  test('Recette 9 — retour : affectation close, statut selon l’état constaté', async () => {
    const endommage = { etat_retour: 'ENDOMMAGE', numero_ticket: 'TK-201' };
    assert.equal((await n.g1.requete(`/api/affectations/${ids.affPc}/retour`, { methode: 'POST', corps: endommage })).donnees.erreur.code, 'INFORMATION_MANQUANTE');
    const retour = await n.g1.requete(`/api/affectations/${ids.affPc}/retour`, {
      methode: 'POST', corps: { ...endommage, observations_retour: 'Charnière cassée', site_retour_id: ids.depot },
    });
    assert.equal(retour.statut, 200);
    assert.ok(retour.donnees.affectation.date_retour);
    const fiche = (await n.g1.requete(`/api/materiels/${ids.pc}`)).donnees.materiel;
    assert.equal(fiche.statut, 'EN_REPARATION');
    assert.equal(fiche.etat, 'ENDOMMAGE');
    assert.equal(fiche.site_code, 'DEPOT');
    assert.equal(fiche.responsable, null);
    assert.equal((await n.g1.requete(`/api/affectations/${ids.affPc}/retour`, { methode: 'POST', corps: endommage })).statut, 409);
    assert.deepEqual((await n.jean.requete('/api/mes-materiels')).donnees.materiels, []);
  });

  test('retards : contrat dépassé signalé', async () => {
    const affectation = (await n.g1.requete('/api/affectations', {
      methode: 'POST',
      corps: { materiel_id: ids.tablette, employe_id: ids.e1, numero_contrat: 'CT-003', date_remise: decaler(-10), date_retour_prevue: decaler(-1), numero_ticket: 'TK-300' },
    })).donnees.affectation;
    assert.equal(affectation.en_retard, true);
    assert.equal(affectation.jours_de_retard, 1);
    const retards = (await n.g1.requete('/api/affectations?retard=oui')).donnees.affectations;
    assert.deepEqual(retards.map((a) => a.id), [affectation.id]);
  });

  test('périmètre du responsable : les mouvements d’un autre service et d’un autre site restent invisibles', async () => {
    const perte = (await mouvement(n.g1, {
      type_code: 'PERTE', site_source_id: ids.depot, motif: 'Introuvable', numero_ticket: 'TK-400',
      lignes: [{ materiel_id: ids.imprimante }], valider: true,
    })).donnees.mouvement;
    assert.equal(perte.lignes[0].materiel_statut, 'PERDU');
    assert.equal((await n.respInfo.requete(`/api/mouvements/${perte.id}`)).statut, 404);
    assert.ok(!(await n.respInfo.requete('/api/mouvements?par_page=100')).donnees.mouvements.some((m) => m.id === perte.id));
    assert.equal((await n.respAdm.requete(`/api/mouvements/${perte.id}`)).statut, 200);
    assert.equal((await n.g1.requete(`/api/mouvements/${perte.id}/inverse`, { methode: 'POST', corps: { motif: 'Retrouvée' } })).donnees.erreur.code, 'INVERSE_IMPOSSIBLE');
    assert.equal((await n.jean.requete('/api/mouvements')).statut, 403);
  });

  test('liste des mouvements : recherche, filtres, résumé des lignes', async () => {
    const tous = (await n.g1.requete('/api/mouvements?par_page=100')).donnees;
    assert.ok(tous.total >= 10);
    const transferts = (await n.g1.requete('/api/mouvements?type_code=TRANSFERT')).donnees.mouvements;
    assert.ok(transferts.every((m) => m.type_code === 'TRANSFERT'));
    const papier = (await n.g1.requete('/api/mouvements?q=Papier')).donnees.mouvements;
    assert.ok(papier.length > 0 && papier.every((m) => m.premiere_ligne === 'Papier A4'));
    assert.equal((await n.g1.requete('/api/mouvements?statut=ANNULE')).donnees.total, 1);
    assert.equal((await n.g1.requete(`/api/mouvements?date_debut=${decaler(1)}`)).donnees.total, 0);
  });

  test('pages : chaque rôle n’ouvre que les écrans de ses droits', async () => {
    const page = async (navigateur, chemin) => {
      const reponse = await navigateur.requete(chemin);
      return reponse.statut === 200 ? 200 : reponse.entetes.get('location');
    };
    for (const chemin of ['/mouvements', '/mouvements/nouveau', '/mouvements/1', '/mouvements/1/modifier', '/affectations', '/signalements']) {
      assert.equal(await page(n.g1, chemin), 200, `gestionnaire : ${chemin}`);
    }
    for (const chemin of ['/mouvements', '/mouvements/1', '/affectations', '/mes-materiels']) {
      assert.equal(await page(n.respInfo, chemin), 200, `responsable : ${chemin}`);
    }
    for (const chemin of ['/mouvements/nouveau', '/mouvements/1/modifier', '/signalements']) {
      assert.equal(await page(n.respInfo, chemin), '/', `responsable refusé : ${chemin}`);
    }
    assert.equal(await page(n.jean, '/mes-materiels'), 200);
    for (const chemin of ['/mouvements', '/affectations', '/signalements']) {
      assert.equal(await page(n.jean, chemin), '/', `employé refusé : ${chemin}`);
    }
    // Décision du 12/11 : plus d'écran Réceptions (un transfert est reçu dès l'envoi).
    assert.equal((await n.g1.requete('/receptions')).statut, 404);
  });

  test('cohérence finale : stock tenu = stock recalculé, statuts cohérents', async () => {
    assert.equal((await db.requete('SELECT count(*)::int AS n FROM v_controle_stocks')).rows[0].n, 0);
    assert.equal((await db.requete('SELECT count(*)::int AS n FROM v_controle_materiels')).rows[0].n, 0);
  });
});
