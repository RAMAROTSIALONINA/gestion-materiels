// Connexion, sessions, mots de passe et droits (cahier des charges § 8.1 ;
// recette : test 1 « accès selon le rôle », test 2 « message non révélateur »).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { raisonSansBase, reinitialiserBaseDeTest } from './environnement.js';
import { Navigateur, creerCompte, demarrerServeur } from './outils.js';

// Mots de passe propres à la base de test, effacée après les tests.
const MDP = {
  admin: 'Essai-admin-2026',
  gestion: 'Essai-gestion-2026',
  autre: 'Essai-autre-2026',
};

describe('connexion, sessions et droits', { skip: raisonSansBase }, () => {
  let serveur;
  let db;
  const navigateur = () => new Navigateur(serveur.adresse);
  let adminNav;

  before(async () => {
    await reinitialiserBaseDeTest();
    db = await import('../database/db.js');
    await creerCompte({ nom: 'Administrateur Essai', email: 'admin@test.local', identifiant: 'admin.essai', role: 'ADMIN', motDePasse: MDP.admin });
    await creerCompte({ nom: 'Gestionnaire Essai', email: 'gestion@test.local', role: 'GESTIONNAIRE', motDePasse: MDP.gestion });
    await creerCompte({ nom: 'Compte Suspendu', email: 'suspendu@test.local', role: 'GESTIONNAIRE', motDePasse: MDP.autre, statut: 'SUSPENDU' });
    serveur = await demarrerServeur();
    adminNav = navigateur();
    assert.equal((await adminNav.connexion('admin.essai', MDP.admin)).statut, 200);
  });

  after(async () => {
    await serveur?.arreter();
    await reinitialiserBaseDeTest();
    await db?.fermerBase();
  });

  test('Recette 1 — connexion valide : accès selon le rôle (administrateur)', async () => {
    const nav = navigateur();
    const reponse = await nav.connexion('admin.essai', MDP.admin);
    assert.equal(reponse.statut, 200);
    assert.equal(reponse.donnees.utilisateur.role, 'ADMIN');
    assert.ok(reponse.donnees.utilisateur.droits.includes('utilisateurs.gerer'));

    const cookie = reponse.entetes.getSetCookie().find((ligne) => ligne.startsWith('gm.session='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);

    assert.equal((await nav.requete('/api/auth/moi')).statut, 200);
    const comptes = await nav.requete('/api/utilisateurs');
    assert.equal(comptes.statut, 200);
    assert.ok(comptes.donnees.utilisateurs.length >= 3);
    assert.equal((await nav.requete('/utilisateurs')).statut, 200);
  });

  test('connexion par adresse e-mail, sans tenir compte des majuscules', async () => {
    assert.equal((await navigateur().connexion('GESTION@Test.Local', MDP.gestion)).statut, 200);
  });

  test('Recette 2 — mauvais mot de passe : accès refusé, message non révélateur', async () => {
    const nav = navigateur();
    const mauvais = await nav.connexion('gestion@test.local', 'pas-le-bon-mot-de-passe');
    const inconnu = await nav.connexion('personne@test.local', 'pas-le-bon-mot-de-passe');
    assert.equal(mauvais.statut, 401);
    assert.equal(inconnu.statut, 401);
    assert.equal(mauvais.donnees.erreur.code, 'IDENTIFIANTS_INVALIDES');
    assert.equal(mauvais.donnees.erreur.message, inconnu.donnees.erreur.message, 'même message, compte connu ou non');
    assert.equal(nav.connecte, false);
    assert.equal((await nav.requete('/api/auth/moi')).statut, 401);
  });

  test('sans connexion : API refusée (401), pages renvoyées vers la connexion', async () => {
    const nav = navigateur();
    const reponse = await nav.requete('/api/utilisateurs');
    assert.equal(reponse.statut, 401);
    assert.equal(reponse.donnees.erreur.code, 'NON_CONNECTE');
    assert.equal((await nav.requete('/')).statut, 302);
  });

  test('gestionnaire : pas d’accès aux comptes, accès aux listes de référence', async () => {
    const nav = navigateur();
    await nav.connexion('gestion@test.local', MDP.gestion);
    const comptes = await nav.requete('/api/utilisateurs');
    assert.equal(comptes.statut, 403);
    assert.equal(comptes.donnees.erreur.code, 'ACCES_REFUSE');
    const page = await nav.requete('/utilisateurs');
    assert.equal(page.statut, 302);
    assert.equal(page.entetes.get('location'), '/');
    assert.equal((await nav.requete('/api/referentiels/services')).statut, 200);
    assert.equal((await nav.requete('/api/referentiels/employes')).statut, 200, 'le gestionnaire affecte des matériels aux employés');
  });

  test('compte bloqué après 5 échecs, même avec le bon mot de passe, puis débloqué', async () => {
    const id = await creerCompte({ nom: 'Compte Bloqué', email: 'bloque@test.local', motDePasse: MDP.autre });
    const nav = navigateur();
    for (let essai = 1; essai <= 5; essai += 1) {
      assert.equal((await nav.connexion('bloque@test.local', `faux-${essai}`)).statut, 401);
    }
    const { rows: [compte] } = await db.requete('SELECT verrouille_jusqu_a > now() AS bloque FROM utilisateurs WHERE id = $1', [id]);
    assert.equal(compte.bloque, true);

    const pendantBlocage = await nav.connexion('bloque@test.local', MDP.autre);
    assert.equal(pendantBlocage.statut, 401, 'bon mot de passe refusé pendant le blocage');
    assert.equal(pendantBlocage.donnees.erreur.code, 'IDENTIFIANTS_INVALIDES');

    const liste = await adminNav.requete('/api/utilisateurs');
    assert.equal(liste.donnees.utilisateurs.find((u) => u.id === id).bloque, true);
    assert.equal((await adminNav.requete(`/api/utilisateurs/${id}/debloquer`, { methode: 'POST' })).statut, 200);
    assert.equal((await nav.connexion('bloque@test.local', MDP.autre)).statut, 200);
  });

  test('compte suspendu : refusé même avec le bon mot de passe', async () => {
    const bon = await navigateur().connexion('suspendu@test.local', MDP.autre);
    assert.equal(bon.statut, 403);
    assert.equal(bon.donnees.erreur.code, 'COMPTE_INACTIF');
    assert.equal((await navigateur().connexion('suspendu@test.local', 'faux')).statut, 401);
  });

  test('création par l’administrateur : mot de passe obligatoire, plus de provisoire (13/11)', async () => {
    const creer = (corps) => adminNav.requete('/api/utilisateurs', { methode: 'POST', corps });
    const sansMotDePasse = await creer({ nom: 'Agent Nouveau', email: 'Agent.Nouveau@Test.local', role_code: 'GESTIONNAIRE' });
    assert.deepEqual([sansMotDePasse.statut, sansMotDePasse.donnees.erreur.code, sansMotDePasse.donnees.erreur.champ],
      [422, 'MOT_DE_PASSE_REQUIS', 'mot_de_passe']);
    assert.equal((await creer({ nom: 'Agent Nouveau', email: 'agent.nouveau@test.local', role_code: 'GESTIONNAIRE', mot_de_passe: '' }))
      .donnees.erreur.code, 'MOT_DE_PASSE_REQUIS');
    const { rows: [{ nombre }] } = await db.requete("SELECT count(*)::int AS nombre FROM utilisateurs WHERE email = 'agent.nouveau@test.local'");
    assert.equal(nombre, 0, 'aucun compte créé sans mot de passe');

    const creation = await creer({ nom: 'Agent Nouveau', email: 'Agent.Nouveau@Test.local', role_code: 'GESTIONNAIRE', mot_de_passe: MDP.autre });
    assert.equal(creation.statut, 201);
    assert.equal(creation.donnees.utilisateur.email, 'agent.nouveau@test.local');
    assert.equal(creation.donnees.utilisateur.doit_changer_mot_de_passe, false);
    assert.equal('mot_de_passe_provisoire' in creation.donnees, false);

    const doublon = await creer({ nom: 'Doublon', email: 'agent.nouveau@test.local', role_code: 'GESTIONNAIRE', mot_de_passe: MDP.autre });
    assert.equal(doublon.statut, 409);
    assert.equal(doublon.donnees.erreur.message, 'Cette adresse e-mail est déjà utilisée par un autre compte.');
    const invalide = await creer({ nom: 'Invalide', email: 'pas-une-adresse', role_code: 'GESTIONNAIRE', mot_de_passe: MDP.autre });
    assert.equal(invalide.statut, 422);
    assert.equal(invalide.donnees.erreur.champ, 'email');
  });

  test('mot de passe provisoire (premier administrateur) : à changer avant tout', async () => {
    // Seul le script du premier administrateur donne encore un mot de passe provisoire.
    const provisoire = 'Abcd-Efgh-Jkmn';
    await creerCompte({ nom: 'Agent Provisoire', email: 'agent.provisoire@test.local', motDePasse: provisoire, doitChanger: true });
    const nav = navigateur();
    const connexion = await nav.connexion('agent.provisoire@test.local', provisoire);
    assert.equal(connexion.statut, 200);
    assert.equal(connexion.donnees.utilisateur.doit_changer_mot_de_passe, true);
    assert.equal((await nav.requete('/api/referentiels/services')).donnees.erreur.code, 'MOT_DE_PASSE_A_CHANGER');
    assert.equal((await nav.requete('/')).entetes.get('location'), '/mot-de-passe');
    assert.equal((await nav.requete('/mot-de-passe')).statut, 200);

    const changer = (actuel, nouveau) => nav.requete('/api/auth/mot-de-passe', { methode: 'POST', corps: { actuel, nouveau } });
    assert.equal((await changer('faux', 'Nouveau-mot-de-passe-1')).donnees.erreur.code, 'MOT_DE_PASSE_ACTUEL_FAUX');
    assert.equal((await changer(provisoire, 'court')).donnees.erreur.code, 'MOT_DE_PASSE_TROP_FAIBLE');
    assert.equal((await changer(provisoire, 'agent.provisoire-2026')).donnees.erreur.code, 'MOT_DE_PASSE_TROP_FAIBLE');
    const change = await changer(provisoire, 'Une phrase bien a moi');
    assert.equal(change.statut, 200);
    assert.equal(change.donnees.utilisateur.doit_changer_mot_de_passe, false);
    assert.equal((await nav.requete('/api/referentiels/services')).statut, 200);

    assert.equal((await navigateur().connexion('agent.provisoire@test.local', provisoire)).statut, 401, 'le provisoire ne marche plus');
  });

  test('création avec un mot de passe choisi par l’administrateur : définitif (décision du 13/11)', async () => {
    const creer = (corps) => adminNav.requete('/api/utilisateurs', { methode: 'POST', corps });
    const base = { nom: 'Agent Choisi', email: 'agent.choisi@test.local', identifiant: 'agent.choisi', role_code: 'GESTIONNAIRE' };
    const court = await creer({ ...base, mot_de_passe: 'Court-1' });
    assert.deepEqual([court.statut, court.donnees.erreur.code, court.donnees.erreur.champ], [422, 'MOT_DE_PASSE_TROP_FAIBLE', 'mot_de_passe']);
    const avecIdentifiant = await creer({ ...base, mot_de_passe: 'agent.choisi-2026' });
    assert.equal(avecIdentifiant.donnees.erreur.champ, 'mot_de_passe');
    assert.match(avecIdentifiant.donnees.erreur.message, /l’identifiant ni l’adresse e-mail du compte/);

    const MOT = 'Tsara-be-2026!';
    const creation = await creer({ ...base, mot_de_passe: MOT });
    assert.equal(creation.statut, 201);
    assert.equal(creation.donnees.utilisateur.doit_changer_mot_de_passe, false);

    // L'agent se connecte et travaille aussitôt, sans changement imposé.
    const nav = navigateur();
    const connexion = await nav.connexion('agent.choisi', MOT);
    assert.equal(connexion.statut, 200);
    assert.equal(connexion.donnees.utilisateur.doit_changer_mot_de_passe, false);
    assert.equal((await nav.requete('/api/referentiels/services')).statut, 200);
    assert.equal((await nav.requete('/')).statut, 200);

    // Le mot de passe n'est jamais inscrit au journal.
    const { rows: [journal] } = await db.requete(
      "SELECT metadonnees FROM historique_actions WHERE action = 'UTILISATEUR_CREE' AND entite_id = $1", [creation.donnees.utilisateur.id],
    );
    assert.equal(journal.metadonnees.mot_de_passe, 'choisi par l’administrateur');
    assert.ok(!JSON.stringify(journal.metadonnees).includes(MOT));

    // Modification (13/11) : nouveau mot de passe définitif, sessions du compte fermées.
    const id = creation.donnees.utilisateur.id;
    const modifier = (corps) => adminNav.requete(`/api/utilisateurs/${id}`, { methode: 'PATCH', corps });
    assert.equal((await modifier({ mot_de_passe: 'court-1' })).donnees.erreur.champ, 'mot_de_passe');
    const NOUVEAU = 'Vaovao-2026-ok';
    const modif = await modifier({ mot_de_passe: NOUVEAU });
    assert.equal(modif.statut, 200);
    assert.equal(modif.donnees.utilisateur.doit_changer_mot_de_passe, false);
    assert.equal((await nav.requete('/api/auth/moi')).statut, 401, 'la session ouverte est fermée');
    assert.equal((await navigateur().connexion('agent.choisi', MOT)).statut, 401, 'l’ancien ne marche plus');
    assert.equal((await navigateur().connexion('agent.choisi', NOUVEAU)).statut, 200);
    const { rows: [trace] } = await db.requete(
      "SELECT metadonnees FROM historique_actions WHERE action = 'UTILISATEUR_MODIFIE' AND entite_id = $1 ORDER BY id DESC LIMIT 1", [id],
    );
    assert.deepEqual(trace.metadonnees, { mot_de_passe: 'changé par l’administrateur' });
    // Pas pour son propre compte : « Mon mot de passe » demande le mot de passe actuel.
    const { utilisateur: admin } = (await adminNav.requete('/api/auth/moi')).donnees;
    const soi = await adminNav.requete(`/api/utilisateurs/${admin.id}`, { methode: 'PATCH', corps: { mot_de_passe: 'Autre-mot-2026' } });
    assert.deepEqual([soi.statut, soi.donnees.erreur.code], [409, 'MODIFICATION_DE_SOI']);
  });

  test('changement de mot de passe : les autres sessions du compte sont fermées', async () => {
    await creerCompte({ nom: 'Deux Postes', email: 'deux.postes@test.local', motDePasse: MDP.autre });
    const poste1 = navigateur();
    const poste2 = navigateur();
    await poste1.connexion('deux.postes@test.local', MDP.autre);
    await poste2.connexion('deux.postes@test.local', MDP.autre);
    const change = await poste1.requete('/api/auth/mot-de-passe', {
      methode: 'POST', corps: { actuel: MDP.autre, nouveau: 'Autre phrase bien choisie' },
    });
    assert.equal(change.statut, 200);
    assert.equal((await poste1.requete('/api/auth/moi')).statut, 200, 'le poste qui change reste connecté');
    assert.equal((await poste2.requete('/api/auth/moi')).statut, 401, 'l’autre poste est déconnecté');
  });

  test('suspension par l’administrateur : la session ouverte est coupée aussitôt', async () => {
    const id = await creerCompte({ nom: 'A Suspendre', email: 'a.suspendre@test.local', motDePasse: MDP.autre });
    const nav = navigateur();
    await nav.connexion('a.suspendre@test.local', MDP.autre);
    assert.equal((await nav.requete('/api/auth/moi')).statut, 200);
    const modification = await adminNav.requete(`/api/utilisateurs/${id}`, { methode: 'PATCH', corps: { statut: 'SUSPENDU' } });
    assert.equal(modification.statut, 200);
    assert.equal((await nav.requete('/api/auth/moi')).statut, 401);
  });

  test('changement de rôle : les droits suivent dès la requête suivante', async () => {
    const id = await creerCompte({ nom: 'Promu Admin', email: 'promu@test.local', motDePasse: MDP.autre });
    const nav = navigateur();
    await nav.connexion('promu@test.local', MDP.autre);
    assert.equal((await nav.requete('/api/utilisateurs')).statut, 403);
    await adminNav.requete(`/api/utilisateurs/${id}`, { methode: 'PATCH', corps: { role_code: 'ADMIN' } });
    assert.equal((await nav.requete('/api/utilisateurs')).statut, 200);
  });

  test('l’administrateur ne peut ni changer son rôle ni fermer son compte', async () => {
    const moi = (await adminNav.requete('/api/auth/moi')).donnees.utilisateur;
    const role = await adminNav.requete(`/api/utilisateurs/${moi.id}`, { methode: 'PATCH', corps: { role_code: 'GESTIONNAIRE' } });
    assert.equal(role.statut, 409);
    assert.equal(role.donnees.erreur.code, 'MODIFICATION_DE_SOI');
    const statut = await adminNav.requete(`/api/utilisateurs/${moi.id}`, { methode: 'PATCH', corps: { statut: 'DESACTIVE' } });
    assert.equal(statut.donnees.erreur.code, 'MODIFICATION_DE_SOI');
    const nom = await adminNav.requete(`/api/utilisateurs/${moi.id}`, { methode: 'PATCH', corps: { nom: 'Administrateur Essai' } });
    assert.equal(nom.statut, 200, 'son nom reste modifiable');
  });

  test('mot de passe oublié : l’administrateur en tape un nouveau dans « Modifier » ; compte débloqué (13/11)', async () => {
    const id = await creerCompte({ nom: 'Oublieux', email: 'oublieux@test.local', motDePasse: MDP.autre });
    const nav = navigateur();
    await nav.connexion('oublieux@test.local', MDP.autre);
    for (let essai = 1; essai <= 5; essai += 1) await navigateur().connexion('oublieux@test.local', `faux-${essai}`);
    assert.equal((await adminNav.requete('/api/utilisateurs')).donnees.utilisateurs.find((u) => u.id === id).bloque, true);

    // L'ancienne route du mot de passe provisoire n'existe plus.
    assert.equal((await adminNav.requete(`/api/utilisateurs/${id}/mot-de-passe-provisoire`, { methode: 'POST' })).statut, 404);

    const NOUVEAU = 'Nouveau-depart-2026';
    const reponse = await adminNav.requete(`/api/utilisateurs/${id}`, { methode: 'PATCH', corps: { mot_de_passe: NOUVEAU } });
    assert.equal(reponse.statut, 200);
    assert.equal(reponse.donnees.utilisateur.bloque, false, 'le compte est débloqué');
    assert.equal((await nav.requete('/api/auth/moi')).statut, 401, 'la session ouverte est fermée');
    assert.equal((await navigateur().connexion('oublieux@test.local', MDP.autre)).statut, 401);
    const nouvelle = await navigateur().connexion('oublieux@test.local', NOUVEAU);
    assert.equal(nouvelle.statut, 200);
    assert.equal(nouvelle.donnees.utilisateur.doit_changer_mot_de_passe, false);
  });

  test('déconnexion : la session est détruite sur le serveur, pas seulement le cookie', async () => {
    const nav = navigateur();
    await nav.connexion('gestion@test.local', MDP.gestion);
    const copie = new Navigateur(serveur.adresse);
    copie.cookies = new Map(nav.cookies);
    assert.equal((await nav.requete('/api/auth/deconnexion', { methode: 'POST' })).statut, 200);
    assert.equal(nav.connecte, false);
    assert.equal((await copie.requete('/api/auth/moi')).statut, 401, 'l’ancien cookie ne vaut plus rien');
  });

  test('nouvel identifiant de session à chaque connexion', async () => {
    const nav = navigateur();
    await nav.connexion('gestion@test.local', MDP.gestion);
    const premier = nav.cookies.get('gm.session');
    await nav.connexion('gestion@test.local', MDP.gestion);
    assert.notEqual(nav.cookies.get('gm.session'), premier);
    const ancien = new Navigateur(serveur.adresse);
    ancien.cookies.set('gm.session', premier);
    assert.equal((await ancien.requete('/api/auth/moi')).statut, 401);
  });

  test('mots de passe chiffrés en Argon2id, jamais renvoyés par l’API', async () => {
    const { rows } = await db.requete('SELECT mot_de_passe_hash FROM utilisateurs');
    assert.ok(rows.every((ligne) => ligne.mot_de_passe_hash.startsWith('$argon2id$')));
    const texte = JSON.stringify((await adminNav.requete('/api/utilisateurs')).donnees);
    assert.doesNotMatch(texte, /argon2|mot_de_passe_hash/);
  });

  test('journal : connexions, échecs et opérations sur les comptes inscrits', async () => {
    const { rows } = await db.requete('SELECT DISTINCT action FROM historique_actions');
    const actions = rows.map((ligne) => ligne.action);
    // MOT_DE_PASSE_REINITIALISE (mot de passe provisoire) n'est plus produit
    // depuis le 13/11 ; son libellé reste pour les anciennes lignes du journal.
    for (const action of ['CONNEXION', 'CONNEXION_ECHEC', 'CONNEXION_REFUSEE', 'DECONNEXION', 'UTILISATEUR_CREE',
      'UTILISATEUR_MODIFIE', 'MOT_DE_PASSE_CHANGE', 'COMPTE_DEBLOQUE']) {
      assert.ok(actions.includes(action), `action ${action} inscrite`);
    }
    const { rows: [echec] } = await db.requete(
      "SELECT adresse_ip FROM historique_actions WHERE action = 'CONNEXION_ECHEC' LIMIT 1",
    );
    assert.ok(echec.adresse_ip, 'adresse du poste notée');
  });

  test('limite par poste : au-delà du nombre permis, connexion refusée (429)', async () => {
    const limite = await demarrerServeur({ limiteConnexions: 3 });
    try {
      const nav = new Navigateur(limite.adresse);
      for (let essai = 1; essai <= 3; essai += 1) {
        assert.equal((await nav.connexion('personne@test.local', 'faux')).statut, 401);
      }
      const bloque = await nav.connexion('admin.essai', MDP.admin);
      assert.equal(bloque.statut, 429);
      assert.equal(bloque.donnees.erreur.code, 'TROP_DE_TENTATIVES');
    } finally {
      await limite.arreter();
    }
  });
});
