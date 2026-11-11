-- =====================================================================
--  Contrôle des règles tenues par la base
--  (scénarios de recette 3 à 11 du cahier des charges, et choix validés le
--  11/11/2026 : transfert en deux temps, seuils par site, ticket obligatoire,
--  affectation sous contrat, retour selon l'état, autorisation)
--
--  À lancer sur une base de TEST vide :
--    npm run db:verifier            (met la base de test au niveau, puis contrôle)
--  ou directement :
--    psql "$DATABASE_URL_TEST" -q -v ON_ERROR_STOP=1 -f database/tests/test_regles.sql
--  Tout se passe dans une transaction annulée à la fin : la base reste vide.
--  Chaque contrôle affiche « OK … » ; le premier échec arrête le script.
--  SQL pur, sans commande propre à psql.
-- =====================================================================
SET client_min_messages = notice;

BEGIN;

-- ---------------------------------------------------------------------
-- Outils de contrôle
-- ---------------------------------------------------------------------
CREATE FUNCTION pg_temp.verifier(p_condition boolean, p_libelle text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS TRUE THEN
    RAISE NOTICE 'OK   %', p_libelle;
  ELSE
    RAISE EXCEPTION 'ÉCHEC   %', p_libelle;
  END IF;
END $$;

-- Exécute p_sql et exige qu'il soit refusé avec le code p_code.
CREATE FUNCTION pg_temp.doit_echouer(p_sql text, p_code text, p_libelle text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_code THEN
      RAISE NOTICE 'OK   % → refusé [%] %', p_libelle, SQLSTATE, SQLERRM;
      RETURN;
    END IF;
    RAISE EXCEPTION 'ÉCHEC   % : erreur [%] « % » au lieu de [%]', p_libelle, SQLSTATE, SQLERRM, p_code;
  END;
  RAISE EXCEPTION 'ÉCHEC   % : l''opération est passée alors qu''elle devait être refusée', p_libelle;
END $$;

CREATE FUNCTION pg_temp.stock(p_article text, p_site text DEFAULT NULL) RETURNS numeric
LANGUAGE sql AS $$
  SELECT coalesce(sum(st.quantite), 0)
    FROM stocks_articles st
    JOIN articles a ON a.id = st.article_id
    JOIN sites s ON s.id = st.site_id
   WHERE a.code = p_article AND (p_site IS NULL OR s.code = p_site)
$$;

CREATE FUNCTION pg_temp.site(p_code text) RETURNS bigint
LANGUAGE sql AS $$ SELECT id FROM sites WHERE code = p_code $$;
CREATE FUNCTION pg_temp.article(p_code text) RETURNS bigint
LANGUAGE sql AS $$ SELECT id FROM articles WHERE code = p_code $$;
CREATE FUNCTION pg_temp.materiel(p_serie text) RETURNS bigint
LANGUAGE sql AS $$ SELECT id FROM materiels WHERE numero_serie = p_serie $$;
CREATE FUNCTION pg_temp.employe(p_matricule text) RETURNS bigint
LANGUAGE sql AS $$ SELECT id FROM employes WHERE matricule = p_matricule $$;
CREATE FUNCTION pg_temp.utilisateur(p_email text) RETURNS bigint
LANGUAGE sql AS $$ SELECT id FROM utilisateurs WHERE email = p_email $$;
CREATE FUNCTION pg_temp.statut(p_serie text) RETURNS text
LANGUAGE sql AS $$ SELECT statut FROM materiels WHERE numero_serie = p_serie $$;

-- Mouvement brouillon avec une ligne d'article ; rend son id.
CREATE FUNCTION pg_temp.mvt_article(p_type text, p_article text, p_qte numeric,
                                    p_source text, p_dest text,
                                    p_motif text DEFAULT NULL, p_service text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO mouvements (type_code, motif, service_beneficiaire_id)
  VALUES (p_type, p_motif, (SELECT id FROM services WHERE code = p_service))
  RETURNING id INTO v_id;
  INSERT INTO lignes_mouvements (mouvement_id, article_id, quantite, site_source_id, site_destination_id)
  VALUES (v_id, pg_temp.article(p_article), p_qte, pg_temp.site(p_source), pg_temp.site(p_dest));
  RETURN v_id;
END $$;

-- Mouvement brouillon avec une ligne de matériel ; rend son id.
CREATE FUNCTION pg_temp.mvt_materiel(p_type text, p_serie text, p_source text, p_dest text,
                                     p_motif text DEFAULT NULL, p_ticket text DEFAULT NULL,
                                     p_employe text DEFAULT NULL, p_date date DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO mouvements (type_code, motif, numero_ticket, employe_beneficiaire_id, date_mouvement)
  VALUES (p_type, p_motif, p_ticket, pg_temp.employe(p_employe), coalesce(p_date, aujourdhui()))
  RETURNING id INTO v_id;
  INSERT INTO lignes_mouvements (mouvement_id, materiel_id, quantite, site_source_id, site_destination_id)
  VALUES (v_id, pg_temp.materiel(p_serie), 1, pg_temp.site(p_source), pg_temp.site(p_dest));
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.valider(p_id bigint) RETURNS void
LANGUAGE sql AS $$ UPDATE mouvements SET statut = 'VALIDE' WHERE id = p_id $$;

CREATE FUNCTION pg_temp.annuler(p_id bigint, p_motif text) RETURNS void
LANGUAGE sql AS $$ UPDATE mouvements SET statut = 'ANNULE', motif_annulation = p_motif WHERE id = p_id $$;

CREATE FUNCTION pg_temp.nouveau_materiel(p_designation text, p_serie text, p_site text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO materiels (designation, numero_serie, categorie_id, site_id, etat)
  VALUES (p_designation, p_serie, (SELECT id FROM categories WHERE nom = 'Informatique'), pg_temp.site(p_site), 'BON')
  RETURNING id
$$;

-- ---------------------------------------------------------------------
-- Données de départ
-- ---------------------------------------------------------------------
INSERT INTO sites (code, nom) VALUES ('SIEGE', 'Siège'), ('DEPOT', 'Dépôt central');
INSERT INTO services (code, nom) VALUES ('ADM', 'Service administratif'), ('INFO', 'Service informatique');
INSERT INTO utilisateurs (nom, email, mot_de_passe_hash, role_code, doit_changer_mot_de_passe) VALUES
  ('Gestionnaire de test',   'gestion@test.local',  '$2b$12$' || repeat('a', 53), 'GESTIONNAIRE', false),
  ('Second gestionnaire',    'gestion2@test.local', '$2b$12$' || repeat('c', 53), 'GESTIONNAIRE', false),
  ('Administrateur de test', 'admin@test.local',    '$argon2id$v=19$m=65536,t=3,p=4$' || repeat('b', 40), 'ADMIN', false);
INSERT INTO employes (matricule, nom, prenoms, service_id) VALUES
  ('E001', 'EMPLOYE', 'Premier', (SELECT id FROM services WHERE code = 'INFO')),
  ('E002', 'EMPLOYE', 'Second',  (SELECT id FROM services WHERE code = 'ADM'));

-- ---------------------------------------------------------------------
-- Auteur obligatoire
-- ---------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.doit_echouer(
    $q$SELECT pg_temp.nouveau_materiel('Sans auteur', NULL, 'SIEGE')$q$,
    'GM009', 'Écriture sans utilisateur courant');
END $$;

DO $$
BEGIN
  PERFORM set_config('app.utilisateur_id', (SELECT id FROM utilisateurs WHERE email = 'gestion@test.local')::text, true);
END $$;

-- ---------------------------------------------------------------------
-- Test 3 — création d'un matériel (scénario 4.1 : réception d'un ordinateur)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_mat materiels%ROWTYPE;
  v_mvt bigint;
BEGIN
  INSERT INTO materiels (designation, categorie_id, marque, modele, numero_serie, date_achat, prix_achat, site_id, etat)
  VALUES ('Ordinateur portable', (SELECT id FROM categories WHERE nom = 'Informatique'), 'Marque', 'Modèle 14',
          'SN-0001', current_date - 1, 3500000, pg_temp.site('SIEGE'), 'NEUF')
  RETURNING * INTO v_mat;

  PERFORM pg_temp.verifier(v_mat.code ~ '^MAT-[0-9]{4}-0001$', 'Test 3 — code généré automatiquement : ' || v_mat.code);
  PERFORM pg_temp.verifier(v_mat.statut = 'DISPONIBLE' AND v_mat.etat = 'NEUF' AND v_mat.prix_achat = 3500000,
                           'Test 3 — enregistré disponible, état neuf, prix en Ariary');
  PERFORM pg_temp.verifier((SELECT count(*) = 1 FROM historiques_etats WHERE materiel_id = v_mat.id),
                           'Test 3 — création inscrite à l''historique des états');

  INSERT INTO mouvements (type_code, origine, reference_externe)
  VALUES ('RECEPTION_ACHAT', 'Fournisseur de test', 'BL-123') RETURNING id INTO v_mvt;
  INSERT INTO lignes_mouvements (mouvement_id, materiel_id, quantite, site_destination_id)
  VALUES (v_mvt, v_mat.id, 1, v_mat.site_id);
  PERFORM pg_temp.valider(v_mvt);

  PERFORM pg_temp.verifier((SELECT statut = 'VALIDE' AND reference ~ '^MVT-[0-9]{4}-000001$' AND valide_par IS NOT NULL
                              FROM mouvements WHERE id = v_mvt),
                           'Scénario 4.1 — réception validée sans ticket, référence MVT-…-000001, validateur noté');
  PERFORM pg_temp.verifier(EXISTS (SELECT 1 FROM v_materiels WHERE code = v_mat.code AND site_code = 'SIEGE'),
                           'Test 3 — fiche consultable');

  PERFORM pg_temp.doit_echouer(format($q$SELECT pg_temp.annuler(%s, 'Erreur de fiche')$q$, v_mvt),
                               'GM002', 'Annulation de la réception d''un matériel');
  PERFORM pg_temp.doit_echouer(format(
    $q$INSERT INTO materiels (code, designation, categorie_id, site_id) VALUES (%L, 'Doublon', %s, %s)$q$,
    lower(v_mat.code), v_mat.categorie_id, v_mat.site_id),
    '23505', 'Code matériel déjà pris (saisi en minuscules)');
  PERFORM pg_temp.doit_echouer($q$SELECT pg_temp.nouveau_materiel('Autre', 'sn-0001', 'SIEGE')$q$,
    '23505', 'Numéro de série déjà enregistré');
  PERFORM pg_temp.doit_echouer(format(
    $q$INSERT INTO materiels (designation, categorie_id, site_id) VALUES ('Mauvaise catégorie', %s, %s)$q$,
    (SELECT id FROM categories WHERE nom = 'Fournitures de bureau'), v_mat.site_id),
    '23503', 'Matériel rangé dans une catégorie d''articles');
  PERFORM pg_temp.doit_echouer(format(
    $q$INSERT INTO materiels (designation, categorie_id, site_id, prix_achat) VALUES ('Prix', %s, %s, '1500.5')$q$,
    v_mat.categorie_id, v_mat.site_id),
    '22P02', 'Prix d''achat avec décimales');
  PERFORM pg_temp.doit_echouer(format(
    $q$INSERT INTO materiels (designation, categorie_id, site_id, statut) VALUES ('Déjà affecté', %s, %s, 'AFFECTE')$q$,
    v_mat.categorie_id, v_mat.site_id),
    'GM002', 'Fiche créée directement « affectée »');
  PERFORM pg_temp.doit_echouer(format($q$UPDATE materiels SET code = 'MAT-AUTRE' WHERE id = %s$q$, v_mat.id),
    'GM002', 'Changement du code d''un matériel');
  PERFORM pg_temp.doit_echouer(format($q$UPDATE materiels SET site_id = %s WHERE id = %s$q$, pg_temp.site('DEPOT'), v_mat.id),
    'GM002', 'Changement de site à la main');
  PERFORM pg_temp.doit_echouer(format($q$UPDATE materiels SET statut = 'AFFECTE' WHERE id = %s$q$, v_mat.id),
    'GM002', 'Passage à « affecté » à la main');
END $$;

-- ---------------------------------------------------------------------
-- Test 4 — création d'un article
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_art articles%ROWTYPE;
BEGIN
  INSERT INTO articles (code, designation, categorie_id, unite_code, seuil_minimum, site_stockage_id)
  VALUES ('papier-a4', 'Papier A4 80 g', (SELECT id FROM categories WHERE nom = 'Fournitures de bureau'),
          'BOITE', 5, pg_temp.site('SIEGE'))
  RETURNING * INTO v_art;
  PERFORM pg_temp.verifier(v_art.code = 'PAPIER-A4' AND v_art.unite_code = 'BOITE' AND v_art.seuil_minimum = 5,
                           'Test 4 — article enregistré avec unité et seuil (code mis en majuscules)');

  INSERT INTO articles (designation, categorie_id, unite_code, seuil_minimum)
  VALUES ('Cartouche d''encre noire', (SELECT id FROM categories WHERE nom = 'Consommables informatiques'), 'PIECE', 0)
  RETURNING * INTO v_art;
  PERFORM pg_temp.verifier(v_art.code ~ '^ART-[0-9]{4}-0001$', 'Test 4 — code article généré : ' || v_art.code);

  PERFORM pg_temp.doit_echouer(
    $q$INSERT INTO articles (designation, categorie_id, unite_code)
       VALUES ('Sans seuil', (SELECT id FROM categories WHERE nom = 'Fournitures de bureau'), 'BOITE')$q$,
    '23502', 'Article sans seuil global');
  PERFORM pg_temp.doit_echouer(
    $q$INSERT INTO articles (designation, categorie_id, unite_code, seuil_minimum)
       VALUES ('  papier a4 80 g ', (SELECT id FROM categories WHERE nom = 'Fournitures de bureau'), 'BOITE', 1)$q$,
    '23505', 'Désignation d''article déjà utilisée');
END $$;

-- ---------------------------------------------------------------------
-- Tests 5, 6, 7 — réception de 10, sortie de 3, sortie supérieure au stock
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_mvt bigint;
BEGIN
  PERFORM pg_temp.valider(pg_temp.mvt_article('RECEPTION_ACHAT', 'PAPIER-A4', 10, NULL, 'SIEGE'));
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4') = 10, 'Test 5 — réception de 10 : stock 10');

  PERFORM pg_temp.valider(pg_temp.mvt_article('CONSOMMATION', 'PAPIER-A4', 3, 'SIEGE', NULL, 'Besoins du mois', 'ADM'));
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4') = 7, 'Test 6 — sortie de 3 : stock 7');

  v_mvt := pg_temp.mvt_article('CONSOMMATION', 'PAPIER-A4', 8, 'SIEGE', NULL, 'Trop demandé', 'ADM');
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt), 'GM001', 'Test 7 — sortie de 8 pour un stock de 7');
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4') = 7
                           AND (SELECT statut FROM mouvements WHERE id = v_mvt) = 'BROUILLON',
                           'Test 7 — stock inchangé (7), le mouvement reste en brouillon');
  PERFORM pg_temp.annuler(v_mvt, 'Saisie abandonnée');
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4') = 7, 'Brouillon annulé : aucun effet sur le stock');
END $$;

-- ---------------------------------------------------------------------
-- Scénario 4.3 — sortie de 5 boîtes sur un stock de 20
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_mvt bigint;
BEGIN
  PERFORM pg_temp.valider(pg_temp.mvt_article('RECEPTION_DON', 'PAPIER-A4', 13, NULL, 'SIEGE'));
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4') = 20, 'Scénario 4.3 — stock théorique 20');

  v_mvt := pg_temp.mvt_article('CONSOMMATION', 'PAPIER-A4', 5, 'SIEGE', NULL, 'Dotation trimestrielle', 'ADM');
  PERFORM pg_temp.valider(v_mvt);
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4') = 15, 'Scénario 4.3 — sortie de 5 : stock 15');
  PERFORM pg_temp.verifier(EXISTS (SELECT 1 FROM v_mouvements_lignes
                                    WHERE mouvement_id = v_mvt AND quantite = 5 AND motif = 'Dotation trimestrielle'
                                      AND service_beneficiaire = 'Service administratif'
                                      AND cree_par = 'Gestionnaire de test' AND date_mouvement IS NOT NULL),
                           'Scénario 4.3 — date, quantité, motif, service bénéficiaire et auteur conservés');
END $$;

-- ---------------------------------------------------------------------
-- Transfert d'articles en deux temps : envoi, puis réception
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_mvt   bigint;
  v_ligne bigint;
BEGIN
  v_mvt := pg_temp.mvt_article('TRANSFERT', 'PAPIER-A4', 4, 'SIEGE', 'DEPOT', 'Réassort du dépôt');
  PERFORM pg_temp.valider(v_mvt);   -- pas de ticket : il n'est exigé que pour les matériels
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4', 'SIEGE') = 11 AND pg_temp.stock('PAPIER-A4', 'DEPOT') = 0
                           AND (SELECT quantite_disponible = 11 AND quantite_en_route = 4
                                  FROM v_stock_articles WHERE code = 'PAPIER-A4'),
                           'Envoi de 4 : siège 11, dépôt 0, 4 boîtes en route');
  PERFORM pg_temp.verifier(EXISTS (SELECT 1 FROM v_transferts_en_route WHERE mouvement_id = v_mvt AND quantite = 4)
                           AND (SELECT etat_transfert FROM v_mouvements_lignes WHERE mouvement_id = v_mvt) = 'EN_ROUTE',
                           'Transfert listé « en route »');

  v_ligne := (SELECT id FROM lignes_mouvements WHERE mouvement_id = v_mvt);
  PERFORM pg_temp.doit_echouer(format('SELECT receptionner_transfert(%s, %L::jsonb)', v_mvt,
            jsonb_build_array(jsonb_build_object('ligne_id', v_ligne, 'quantite_recue', 3))),
          'GM006', 'Réception incomplète sans motif');
  PERFORM pg_temp.doit_echouer(format('SELECT receptionner_transfert(%s, %L::jsonb, %L)', v_mvt,
            jsonb_build_array(jsonb_build_object('ligne_id', v_ligne, 'quantite_recue', 5)), 'Trop'),
          '23514', 'Réception de plus que la quantité envoyée');
  PERFORM pg_temp.doit_echouer(format($q$SELECT receptionner_transfert(%s, '[]', NULL, aujourdhui() - 1)$q$, v_mvt),
          'GM007', 'Réception datée avant l''envoi');
  PERFORM pg_temp.doit_echouer(format('UPDATE lignes_mouvements SET quantite_recue = 4 WHERE id = %s', v_ligne),
          'GM002', 'Quantité reçue saisie à la main');

  PERFORM receptionner_transfert(v_mvt);
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4', 'SIEGE') = 11 AND pg_temp.stock('PAPIER-A4', 'DEPOT') = 4
                           AND (SELECT quantite_en_route = 0 FROM v_stock_articles WHERE code = 'PAPIER-A4')
                           AND (SELECT recu_par IS NOT NULL AND date_reception = aujourdhui() FROM mouvements WHERE id = v_mvt),
                           'Réception complète : dépôt 4, stock global 15, réceptionnaire noté');
  PERFORM pg_temp.doit_echouer(format('SELECT receptionner_transfert(%s)', v_mvt), 'GM002', 'Deuxième réception du même transfert');
  PERFORM pg_temp.doit_echouer(format($q$SELECT pg_temp.annuler(%s, 'Erreur')$q$, v_mvt), 'GM002', 'Annulation d''un transfert reçu');

  -- Annulation pendant le trajet : la marchandise revient à l'origine.
  v_mvt := pg_temp.mvt_article('TRANSFERT', 'PAPIER-A4', 3, 'SIEGE', 'DEPOT', 'Réassort');
  PERFORM pg_temp.valider(v_mvt);
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4', 'SIEGE') = 8, 'Envoi de 3 : siège 8');
  PERFORM pg_temp.annuler(v_mvt, 'Camion annulé');
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4', 'SIEGE') = 11 AND pg_temp.stock('PAPIER-A4', 'DEPOT') = 4,
                           'Transfert annulé en route : retour au siège (11)');

  -- Réception avec un manquant motivé.
  v_mvt := pg_temp.mvt_article('TRANSFERT', 'PAPIER-A4', 3, 'SIEGE', 'DEPOT', 'Réassort');
  PERFORM pg_temp.valider(v_mvt);
  PERFORM receptionner_transfert(v_mvt,
            jsonb_build_array(jsonb_build_object('ligne_id', (SELECT id FROM lignes_mouvements WHERE mouvement_id = v_mvt),
                                                 'quantite_recue', 2)),
            'Une boîte arrivée trempée, refusée');
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4', 'SIEGE') = 8 AND pg_temp.stock('PAPIER-A4', 'DEPOT') = 6,
                           'Réception de 2 sur 3 : siège 8, dépôt 6');
  PERFORM pg_temp.verifier((SELECT quantite_manquante = 1 AND motif_ecart = 'Une boîte arrivée trempée, refusée'
                              FROM v_ecarts_transferts WHERE mouvement_id = v_mvt),
                           'Manquant de 1 tracé avec son motif');
END $$;

-- ---------------------------------------------------------------------
-- Seuils : global et par site
-- ---------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO seuils_articles_sites (article_id, site_id, seuil_minimum)
  VALUES (pg_temp.article('PAPIER-A4'), pg_temp.site('DEPOT'), 10);
  PERFORM pg_temp.verifier((SELECT alerte_site AND quantite = 6 AND seuil_site = 10
                              FROM v_stock_articles_sites WHERE code = 'PAPIER-A4' AND site_code = 'DEPOT'),
                           'Seuil du dépôt (10) : alerte, 6 boîtes');
  PERFORM pg_temp.verifier(EXISTS (SELECT 1 FROM v_alertes_stock WHERE portee = 'SITE' AND code = 'PAPIER-A4' AND site_code = 'DEPOT')
                           AND NOT EXISTS (SELECT 1 FROM v_alertes_stock WHERE portee = 'GLOBAL' AND code = 'PAPIER-A4'),
                           'Alerte du dépôt affichée, pas d''alerte globale (14 > 5)');

  INSERT INTO seuils_articles_sites (article_id, site_id, seuil_minimum)
  VALUES ((SELECT id FROM articles WHERE designation LIKE 'Cartouche%'), pg_temp.site('DEPOT'), 2);
  PERFORM pg_temp.verifier(EXISTS (SELECT 1 FROM v_alertes_stock
                                    WHERE portee = 'SITE' AND designation LIKE 'Cartouche%' AND en_rupture),
                           'Seuil posé sur un site sans stock : alerte de rupture');
  PERFORM pg_temp.verifier((SELECT modifie_par = current_setting('app.utilisateur_id')::bigint
                              FROM seuils_articles_sites LIMIT 1),
                           'Auteur du seuil noté');
  PERFORM pg_temp.doit_echouer(format(
    'INSERT INTO seuils_articles_sites (article_id, site_id, seuil_minimum) VALUES (%s, %s, 0)',
    pg_temp.article('PAPIER-A4'), pg_temp.site('SIEGE')),
    '23514', 'Seuil de site à zéro');
END $$;

-- ---------------------------------------------------------------------
-- Contrôles de saisie à la validation, autorisation
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_mvt bigint;
BEGIN
  INSERT INTO mouvements (type_code, motif) VALUES ('TRANSFERT', 'Sans destination') RETURNING id INTO v_mvt;
  PERFORM pg_temp.doit_echouer(format(
    $q$INSERT INTO lignes_mouvements (mouvement_id, article_id, quantite, site_source_id) VALUES (%s, %s, 1, %s)$q$,
    v_mvt, pg_temp.article('PAPIER-A4'), pg_temp.site('SIEGE')),
    'GM004', 'Transfert sans site de destination');
  PERFORM pg_temp.doit_echouer(format(
    $q$INSERT INTO lignes_mouvements (mouvement_id, article_id, quantite, site_source_id, site_destination_id)
       VALUES (%s, %s, 2.5, %s, %s)$q$,
    v_mvt, pg_temp.article('PAPIER-A4'), pg_temp.site('SIEGE'), pg_temp.site('DEPOT')),
    'GM005', '2,5 boîtes (unité sans décimale)');
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt), 'GM011', 'Validation d''un mouvement sans ligne');
  PERFORM pg_temp.annuler(v_mvt, 'Essai');

  INSERT INTO mouvements (type_code, motif) VALUES ('AFFECTATION', 'Essai') RETURNING id INTO v_mvt;
  PERFORM pg_temp.doit_echouer(format(
    $q$INSERT INTO lignes_mouvements (mouvement_id, article_id, quantite, site_source_id) VALUES (%s, %s, 1, %s)$q$,
    v_mvt, pg_temp.article('PAPIER-A4'), pg_temp.site('SIEGE')),
    'GM004', 'Article dans un mouvement d''affectation');
  PERFORM pg_temp.annuler(v_mvt, 'Essai');

  v_mvt := pg_temp.mvt_article('CONSOMMATION', 'PAPIER-A4', 1, 'SIEGE', NULL, NULL, 'ADM');
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt), 'GM006', 'Sortie sans motif');
  UPDATE mouvements SET motif = 'Besoin', service_beneficiaire_id = NULL WHERE id = v_mvt;
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt), 'GM006', 'Consommation sans bénéficiaire');
  UPDATE mouvements SET service_beneficiaire_id = (SELECT id FROM services WHERE code = 'ADM'),
                        date_mouvement = aujourdhui() + 1 WHERE id = v_mvt;
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt), 'GM007', 'Mouvement daté de demain');
  UPDATE mouvements SET date_mouvement = aujourdhui() - 400 WHERE id = v_mvt;
  PERFORM pg_temp.valider(v_mvt);
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4', 'SIEGE') = 7, 'Mouvement daté de plus d''un an accepté (pas de limite dans le passé)');
  PERFORM pg_temp.annuler(v_mvt, 'Essai d''antidatage');

  v_mvt := pg_temp.mvt_article('CORRECTION_PLUS', 'PAPIER-A4', 2, NULL, 'SIEGE', 'Boîtes retrouvées à l''inventaire');
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt), 'GM006', 'Correction d''inventaire sans autorisation');
  UPDATE mouvements SET autorise_par = pg_temp.utilisateur('gestion@test.local') WHERE id = v_mvt;
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt), 'GM013', 'Correction autorisée par son propre auteur');
  UPDATE mouvements SET autorise_par = pg_temp.utilisateur('gestion2@test.local') WHERE id = v_mvt;
  PERFORM pg_temp.valider(v_mvt);
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4', 'SIEGE') = 10, 'Correction autorisée par un autre gestionnaire : siège 10');

  PERFORM pg_temp.doit_echouer(
    $q$INSERT INTO mouvements (type_code, statut) VALUES ('RECEPTION_ACHAT', 'VALIDE')$q$,
    'GM002', 'Mouvement créé directement validé');
  PERFORM pg_temp.doit_echouer(format(
    $q$UPDATE stocks_articles SET quantite = 1000 WHERE article_id = %s$q$, pg_temp.article('PAPIER-A4')),
    'GM002', 'Modification directe du stock');
END $$;

-- ---------------------------------------------------------------------
-- Test 11 — annulation d'un mouvement, mouvement inverse
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_sortie    bigint;
  v_reception bigint;
  v_inverse   bigint;
  v_cartouche text := (SELECT code FROM articles WHERE designation LIKE 'Cartouche%');
BEGIN
  v_sortie := pg_temp.mvt_article('CONSOMMATION', 'PAPIER-A4', 3, 'SIEGE', NULL, 'Erreur de saisie à annuler', 'ADM');
  PERFORM pg_temp.valider(v_sortie);
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4', 'SIEGE') = 7, 'Sortie de 3 : siège 7');

  PERFORM pg_temp.doit_echouer(format($q$UPDATE mouvements SET motif = 'Autre motif' WHERE id = %s$q$, v_sortie),
                               'GM002', 'Modification d''un mouvement validé');
  PERFORM pg_temp.doit_echouer(format($q$DELETE FROM lignes_mouvements WHERE mouvement_id = %s$q$, v_sortie),
                               'GM002', 'Suppression d''une ligne d''un mouvement validé');
  PERFORM pg_temp.doit_echouer(format($q$UPDATE mouvements SET statut = 'ANNULE' WHERE id = %s$q$, v_sortie),
                               '23514', 'Annulation sans motif');

  PERFORM pg_temp.annuler(v_sortie, 'Service bénéficiaire erroné');
  PERFORM pg_temp.verifier(pg_temp.stock('PAPIER-A4', 'SIEGE') = 10, 'Test 11 — annulation : siège revenu à 10');
  PERFORM pg_temp.verifier((SELECT statut = 'ANNULE' AND annule_par IS NOT NULL AND annule_le IS NOT NULL
                              FROM mouvements WHERE id = v_sortie),
                           'Test 11 — annulation tracée (auteur, date, motif), mouvement conservé');
  PERFORM pg_temp.doit_echouer(format($q$UPDATE mouvements SET motif_annulation = 'Autre' WHERE id = %s$q$, v_sortie),
                               'GM002', 'Modification d''un mouvement annulé');
  PERFORM pg_temp.doit_echouer(format($q$DELETE FROM mouvements WHERE id = %s$q$, v_sortie),
                               'GM003', 'Suppression d''un mouvement');
  PERFORM pg_temp.doit_echouer('TRUNCATE mouvements CASCADE', 'GM003', 'Vidage de la table des mouvements');

  -- Annuler une réception dont la marchandise est déjà sortie : refusé.
  v_reception := pg_temp.mvt_article('RECEPTION_ACHAT', v_cartouche, 5, NULL, 'SIEGE');
  PERFORM pg_temp.valider(v_reception);
  PERFORM pg_temp.valider(pg_temp.mvt_article('CONSOMMATION', v_cartouche, 4, 'SIEGE', NULL, 'Imprimantes du service', 'ADM'));
  PERFORM pg_temp.doit_echouer(format($q$SELECT pg_temp.annuler(%s, 'Livraison refusée')$q$, v_reception),
                               'GM001', 'Annulation d''une réception déjà consommée');

  -- Mouvement inverse autorisé : rend 2 des 4 cartouches sorties.
  INSERT INTO mouvements (type_code, motif, mouvement_corrige_id)
  VALUES ('CORRECTION_PLUS', 'Deux cartouches rendues, non utilisées',
          (SELECT max(id) FROM mouvements WHERE type_code = 'CONSOMMATION' AND statut = 'VALIDE'))
  RETURNING id INTO v_inverse;
  INSERT INTO lignes_mouvements (mouvement_id, article_id, quantite, site_destination_id)
  VALUES (v_inverse, pg_temp.article(v_cartouche), 2, pg_temp.site('SIEGE'));
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_inverse), 'GM006', 'Mouvement inverse sans autorisation');
  UPDATE mouvements SET autorise_par = pg_temp.utilisateur('admin@test.local') WHERE id = v_inverse;
  PERFORM pg_temp.valider(v_inverse);
  PERFORM pg_temp.verifier(pg_temp.stock(v_cartouche) = 3, 'Mouvement inverse autorisé par l''administrateur : 1 + 2 = 3 cartouches');

  PERFORM pg_temp.doit_echouer($q$UPDATE articles SET unite_code = 'PAQUET' WHERE code = 'PAPIER-A4'$q$,
                               'GM012', 'Changement d''unité d''un article déjà mouvementé');
END $$;

-- ---------------------------------------------------------------------
-- Tests 8 et 9 — affectation sous contrat, puis retour selon l'état
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_mat  bigint := pg_temp.materiel('SN-0001');
  v_emp1 bigint := pg_temp.employe('E001');
  v_emp2 bigint := pg_temp.employe('E002');
  v_mvt  bigint;
  v_mvt2 bigint;
  v_aff  bigint;
  v_ret  bigint;
  h      historiques_etats%ROWTYPE;
BEGIN
  -- Scénario 4.2 : mouvement « Affectation » avec ticket, puis affectation sous contrat.
  v_mvt := pg_temp.mvt_materiel('AFFECTATION', 'SN-0001', 'SIEGE', NULL, 'Poste de travail', NULL, 'E001');
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt), 'GM006', 'Affectation sans n° de ticket');
  UPDATE mouvements SET numero_ticket = 'TK-1001' WHERE id = v_mvt;
  PERFORM pg_temp.valider(v_mvt);

  PERFORM pg_temp.doit_echouer(format(
    $q$INSERT INTO affectations (materiel_id, employe_id, date_retour_prevue, etat_remise, mouvement_affectation_id)
       VALUES (%s, %s, aujourdhui() + 180, 'NEUF', %s)$q$, v_mat, v_emp1, v_mvt),
    '23502', 'Affectation sans n° de contrat');
  PERFORM pg_temp.doit_echouer(format(
    $q$INSERT INTO affectations (materiel_id, employe_id, numero_contrat, date_retour_prevue, etat_remise, mouvement_affectation_id)
       VALUES (%s, %s, 'CT-2026-015', aujourdhui() - 1, 'NEUF', %s)$q$, v_mat, v_emp1, v_mvt),
    '23514', 'Retour prévu avant la remise');

  INSERT INTO affectations (materiel_id, employe_id, numero_contrat, date_retour_prevue, etat_remise, mouvement_affectation_id)
  VALUES (v_mat, v_emp1, 'CT-2026-015', aujourdhui() + 180, 'NEUF', v_mvt) RETURNING id INTO v_aff;

  PERFORM pg_temp.verifier((SELECT statut = 'AFFECTE' AND responsable = 'EMPLOYE Premier' AND date_remise = aujourdhui()
                                   AND numero_contrat = 'CT-2026-015' AND NOT retour_en_retard
                              FROM v_materiels WHERE id = v_mat),
                           'Test 8 — statut « affecté » posé par la base, bénéficiaire, date et contrat sur la fiche');
  PERFORM pg_temp.verifier((SELECT remis_par IS NOT NULL FROM affectations WHERE id = v_aff), 'Test 8 — auteur de la remise noté');

  -- Deuxième affectation : refusée dès la validation du mouvement.
  v_mvt2 := pg_temp.mvt_materiel('AFFECTATION', 'SN-0001', 'SIEGE', NULL, 'Double affectation', 'TK-1003', 'E002');
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt2), 'GM008', 'Affectation d''un matériel déjà affecté');
  -- Filet de sécurité : même avec un statut faussé, l'index unique bloque.
  PERFORM drapeau('gm.maj_materiel', 'oui');
  UPDATE materiels SET statut = 'DISPONIBLE' WHERE id = v_mat;
  PERFORM drapeau('gm.maj_materiel', 'non');
  PERFORM pg_temp.valider(v_mvt2);
  PERFORM pg_temp.doit_echouer(format(
    $q$INSERT INTO affectations (materiel_id, employe_id, numero_contrat, date_retour_prevue, etat_remise, mouvement_affectation_id)
       VALUES (%s, %s, 'CT-X', aujourdhui() + 10, 'BON', %s)$q$, v_mat, v_emp2, v_mvt2),
    '23505', 'Deux affectations en cours pour un même matériel');
  PERFORM pg_temp.verifier((SELECT count(*) = 1 FROM v_controle_materiels WHERE materiel_id = v_mat),
                           'Le contrôle des matériels signale l''incohérence volontaire');
  PERFORM drapeau('gm.maj_materiel', 'oui');
  UPDATE materiels SET statut = 'AFFECTE' WHERE id = v_mat;
  PERFORM drapeau('gm.maj_materiel', 'non');
  PERFORM pg_temp.annuler(v_mvt2, 'Double affectation refusée');

  UPDATE affectations SET date_retour_prevue = date_retour_prevue + 30 WHERE id = v_aff;
  PERFORM pg_temp.verifier((SELECT date_retour_prevue = aujourdhui() + 210 FROM affectations WHERE id = v_aff),
                           'Prolongation du contrat acceptée');
  PERFORM pg_temp.doit_echouer(format('UPDATE affectations SET employe_id = %s WHERE id = %s', v_emp2, v_aff),
                               'GM002', 'Changement du bénéficiaire d''une affectation');
  PERFORM pg_temp.doit_echouer(format($q$SELECT pg_temp.annuler(%s, 'Erreur')$q$, v_mvt),
                               'GM002', 'Annulation du mouvement qui porte une affectation');

  v_mvt2 := pg_temp.mvt_materiel('PERTE', 'SN-0001', 'SIEGE', NULL, 'Déclaré perdu', 'TK-1004');
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt2), 'GM008', 'Perte d''un matériel encore affecté');
  PERFORM pg_temp.annuler(v_mvt2, 'Retour à enregistrer d''abord');

  -- Test 9 : retour au dépôt, en état endommagé.
  v_ret := pg_temp.mvt_materiel('RETOUR_AFFECTATION', 'SN-0001', NULL, 'DEPOT', NULL, 'TK-1002', 'E001');
  PERFORM pg_temp.valider(v_ret);
  PERFORM pg_temp.doit_echouer(format(
    $q$UPDATE affectations SET date_retour = aujourdhui(), etat_retour = 'ENDOMMAGE', mouvement_retour_id = %s WHERE id = %s$q$,
    v_ret, v_aff),
    'GM006', 'Retour endommagé sans observations');
  UPDATE affectations
     SET date_retour = aujourdhui(), etat_retour = 'ENDOMMAGE', observations_retour = 'Écran fissuré', mouvement_retour_id = v_ret
   WHERE id = v_aff;

  PERFORM pg_temp.verifier((SELECT date_retour IS NOT NULL AND recu_par IS NOT NULL FROM affectations WHERE id = v_aff)
                           AND (SELECT etat = 'ENDOMMAGE' AND statut = 'EN_REPARATION' AND site_code = 'DEPOT' AND responsable IS NULL
                                  FROM v_materiels WHERE id = v_mat),
                           'Test 9 — affectation clôturée ; endommagé → en réparation, au dépôt (site du retour)');
  SELECT * INTO h FROM historiques_etats WHERE materiel_id = v_mat ORDER BY id DESC LIMIT 1;
  PERFORM pg_temp.verifier(h.nouveau_statut = 'EN_REPARATION' AND h.commentaire = 'Écran fissuré',
                           'Observations du retour reprises dans l''historique');
  PERFORM pg_temp.doit_echouer(format($q$UPDATE affectations SET observations_retour = 'Modifié' WHERE id = %s$q$, v_aff),
                               'GM002', 'Modification d''une affectation close');
  PERFORM pg_temp.doit_echouer(format($q$DELETE FROM affectations WHERE id = %s$q$, v_aff),
                               'GM003', 'Suppression d''une affectation');
  PERFORM pg_temp.doit_echouer(format($q$SELECT pg_temp.annuler(%s, 'Erreur')$q$, v_ret),
                               'GM002', 'Annulation d''un retour enregistré');
END $$;

-- ---------------------------------------------------------------------
-- Retour en retard sur le contrat, retour hors service → réformé
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_mat bigint := pg_temp.nouveau_materiel('Imprimante', 'SN-0002', 'SIEGE');
  v_mvt bigint;
  v_aff bigint;
BEGIN
  v_mvt := pg_temp.mvt_materiel('AFFECTATION', 'SN-0002', 'SIEGE', NULL, 'Imprimante de service', 'TK-2001', 'E002',
                                aujourdhui() - 10);
  PERFORM pg_temp.valider(v_mvt);
  INSERT INTO affectations (materiel_id, employe_id, numero_contrat, date_remise, date_retour_prevue, etat_remise, mouvement_affectation_id)
  VALUES (v_mat, pg_temp.employe('E002'), 'CT-2026-020', aujourdhui() - 10, aujourdhui() - 1, 'BON', v_mvt)
  RETURNING id INTO v_aff;
  PERFORM pg_temp.verifier((SELECT jours_de_retard = 1 AND numero_contrat = 'CT-2026-020'
                              FROM v_affectations_en_retard WHERE affectation_id = v_aff)
                           AND (SELECT retour_en_retard FROM v_materiels WHERE id = v_mat),
                           'Retour prévu hier : affectation signalée en retard (1 jour)');

  v_mvt := pg_temp.mvt_materiel('RETOUR_AFFECTATION', 'SN-0002', NULL, 'SIEGE', NULL, 'TK-2002', 'E002');
  PERFORM pg_temp.valider(v_mvt);
  UPDATE affectations
     SET date_retour = aujourdhui(), etat_retour = 'HORS_SERVICE', observations_retour = 'Carte mère grillée', mouvement_retour_id = v_mvt
   WHERE id = v_aff;
  PERFORM pg_temp.verifier((SELECT etat = 'HORS_SERVICE' AND statut = 'REFORME' FROM materiels WHERE id = v_mat)
                           AND NOT EXISTS (SELECT 1 FROM v_affectations_en_retard WHERE affectation_id = v_aff),
                           'Retour hors service → réformé ; plus de retard affiché');
END $$;

-- ---------------------------------------------------------------------
-- Transfert de matériels en deux temps, perte, mise au rebut
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_mvt bigint;
BEGIN
  -- SN-0001 est au dépôt, en réparation : on le renvoie au siège.
  v_mvt := pg_temp.mvt_materiel('TRANSFERT', 'SN-0001', 'DEPOT', 'SIEGE', 'Retour au siège pour réparation');
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt), 'GM006', 'Transfert de matériel sans n° de ticket');
  UPDATE mouvements SET numero_ticket = 'TK-3001' WHERE id = v_mvt;
  PERFORM pg_temp.valider(v_mvt);
  PERFORM pg_temp.verifier(pg_temp.statut('SN-0001') = 'EN_TRANSIT'
                           AND (SELECT site_code = 'DEPOT' FROM v_materiels WHERE numero_serie = 'SN-0001')
                           AND EXISTS (SELECT 1 FROM v_transferts_en_route WHERE mouvement_id = v_mvt),
                           'Envoi : matériel « en transit », encore rattaché au dépôt');
  PERFORM pg_temp.doit_echouer(format($q$UPDATE materiels SET statut = 'DISPONIBLE' WHERE id = %s$q$, pg_temp.materiel('SN-0001')),
                               'GM002', 'Matériel en transit remis disponible à la main');
  PERFORM receptionner_transfert(v_mvt);
  PERFORM pg_temp.verifier((SELECT statut = 'EN_REPARATION' AND site_code = 'SIEGE' FROM v_materiels WHERE numero_serie = 'SN-0001'),
                           'Réception : au siège, statut d''avant le transfert (en réparation) rétabli');

  v_mvt := pg_temp.mvt_materiel('TRANSFERT', 'SN-0001', 'DEPOT', 'SIEGE', 'Mauvais site', 'TK-3002');
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt), 'GM004', 'Transfert depuis un site où le matériel n''est pas');
  PERFORM pg_temp.annuler(v_mvt, 'Erreur de site');

  -- Matériel jamais arrivé : perdu.
  PERFORM pg_temp.nouveau_materiel('Écran 24 pouces', 'SN-0003', 'SIEGE');
  v_mvt := pg_temp.mvt_materiel('TRANSFERT', 'SN-0003', 'SIEGE', 'DEPOT', 'Équipement du dépôt', 'TK-3003');
  PERFORM pg_temp.valider(v_mvt);
  PERFORM receptionner_transfert(v_mvt,
            jsonb_build_array(jsonb_build_object('ligne_id', (SELECT id FROM lignes_mouvements WHERE mouvement_id = v_mvt),
                                                 'quantite_recue', 0)),
            'Absent du camion à l''arrivée');
  PERFORM pg_temp.verifier(pg_temp.statut('SN-0003') = 'PERDU'
                           AND EXISTS (SELECT 1 FROM v_ecarts_transferts WHERE mouvement_id = v_mvt AND quantite_manquante = 1),
                           'Matériel non reçu : statut « perdu », écart tracé');

  -- Réparé, puis perdu, perte annulée, puis mis au rebut.
  PERFORM set_config('app.commentaire', 'Écran remplacé', true);
  UPDATE materiels SET etat = 'BON', statut = 'DISPONIBLE' WHERE numero_serie = 'SN-0001';
  PERFORM set_config('app.commentaire', '', true);
  v_mvt := pg_temp.mvt_materiel('PERTE', 'SN-0001', 'SIEGE', NULL, 'Introuvable après déménagement', 'TK-3004');
  PERFORM pg_temp.valider(v_mvt);
  PERFORM pg_temp.verifier(pg_temp.statut('SN-0001') = 'PERDU', 'Perte validée : statut « perdu »');
  PERFORM pg_temp.annuler(v_mvt, 'Retrouvé dans la réserve');
  PERFORM pg_temp.verifier(pg_temp.statut('SN-0001') = 'DISPONIBLE', 'Perte annulée : statut d''avant rétabli');
  PERFORM pg_temp.valider(pg_temp.mvt_materiel('MISE_AU_REBUT', 'SN-0001', 'SIEGE', NULL, 'Obsolète, réformé', 'TK-3005'));
  PERFORM pg_temp.verifier(pg_temp.statut('SN-0001') = 'REFORME', 'Mise au rebut : statut « réformé »');
END $$;

-- ---------------------------------------------------------------------
-- Test 10 — changement d'état à la main
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_mat bigint := pg_temp.nouveau_materiel('Téléphone', 'SN-0004', 'SIEGE');
  v_mvt bigint;
  h     historiques_etats%ROWTYPE;
BEGIN
  PERFORM pg_temp.doit_echouer(format($q$UPDATE materiels SET etat = 'ENDOMMAGE' WHERE id = %s$q$, v_mat),
                               'GM006', 'Passage à « endommagé » sans commentaire');

  PERFORM set_config('app.commentaire', 'Écran fissuré, envoi au réparateur', true);
  UPDATE materiels SET etat = 'ENDOMMAGE', statut = 'EN_REPARATION' WHERE id = v_mat;
  PERFORM set_config('app.commentaire', '', true);

  SELECT * INTO h FROM historiques_etats WHERE materiel_id = v_mat ORDER BY id DESC LIMIT 1;
  PERFORM pg_temp.verifier(h.ancien_etat = 'BON' AND h.nouvel_etat = 'ENDOMMAGE'
                           AND h.ancien_statut = 'DISPONIBLE' AND h.nouveau_statut = 'EN_REPARATION'
                           AND h.auteur_id = current_setting('app.utilisateur_id')::bigint
                           AND h.commentaire = 'Écran fissuré, envoi au réparateur'
                           AND h.date_changement IS NOT NULL,
                           'Test 10 — historique conservé avec ancien/nouvel état, auteur, date et commentaire');
  PERFORM pg_temp.verifier((SELECT modifie_par IS NOT NULL FROM materiels WHERE id = v_mat), 'Auteur de la modification noté sur la fiche');

  PERFORM pg_temp.doit_echouer(format($q$UPDATE historiques_etats SET commentaire = 'x' WHERE id = %s$q$, h.id),
                               'GM010', 'Modification de l''historique des états');
  PERFORM pg_temp.doit_echouer(format($q$DELETE FROM historiques_etats WHERE id = %s$q$, h.id),
                               'GM010', 'Suppression dans l''historique des états');
  PERFORM pg_temp.doit_echouer(format($q$UPDATE materiels SET etat = 'HORS_SERVICE', statut = 'DISPONIBLE' WHERE id = %s$q$, v_mat),
                               '23514', 'Matériel hors service déclaré disponible');

  v_mvt := pg_temp.mvt_materiel('AFFECTATION', 'SN-0004', 'SIEGE', NULL, 'Essai', 'TK-4001', 'E002');
  PERFORM pg_temp.doit_echouer(format('SELECT pg_temp.valider(%s)', v_mvt), 'GM008', 'Affectation d''un matériel en réparation');
  PERFORM pg_temp.annuler(v_mvt, 'Matériel en réparation');
END $$;

-- ---------------------------------------------------------------------
-- Comptes, journal et paramètres
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_id bigint;
BEGIN
  PERFORM pg_temp.doit_echouer(
    $q$INSERT INTO utilisateurs (nom, email, mot_de_passe_hash, role_code) VALUES ('X', 'x@test.local', 'motdepasse', 'ADMIN')$q$,
    '23514', 'Mot de passe enregistré en clair');
  PERFORM pg_temp.doit_echouer(
    $q$INSERT INTO utilisateurs (nom, email, mot_de_passe_hash, role_code) VALUES ('X', 'GESTION@test.local', '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'ADMIN')$q$,
    '23505', 'E-mail déjà utilisé (casse différente)');
  PERFORM pg_temp.doit_echouer(
    $q$INSERT INTO utilisateurs (nom, email, mot_de_passe_hash, role_code) VALUES ('X', 'y@test.local', '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'EMPLOYE')$q$,
    '23514', 'Compte employé sans fiche employé');

  INSERT INTO historique_actions (utilisateur_id, action, entite, entite_id, metadonnees)
  VALUES (current_setting('app.utilisateur_id')::bigint, 'IMPRESSION_ETIQUETTE', 'materiels', pg_temp.materiel('SN-0004'),
          '{"format": "code 128"}')
  RETURNING id INTO v_id;
  UPDATE materiels SET etiquette_imprimee_le = now() WHERE numero_serie = 'SN-0004';
  PERFORM pg_temp.verifier((SELECT etiquette_imprimee_le IS NOT NULL FROM v_materiels WHERE numero_serie = 'SN-0004'),
                           'Impression de l''étiquette code-barres notée');
  PERFORM pg_temp.doit_echouer(format($q$UPDATE historique_actions SET action = 'AUTRE' WHERE id = %s$q$, v_id),
                               'GM010', 'Modification du journal des actions');
  PERFORM pg_temp.doit_echouer('TRUNCATE historique_actions', 'GM010', 'Vidage du journal des actions');

  PERFORM pg_temp.doit_echouer($q$UPDATE parametres SET valeur = 'Afrique/Nulle_Part' WHERE cle = 'fuseau_horaire'$q$,
                               '22023', 'Fuseau horaire inconnu');
  PERFORM pg_temp.doit_echouer($q$UPDATE parametres SET valeur = 'mat' WHERE cle = 'prefixe_materiel'$q$,
                               'GM006', 'Préfixe de code en minuscules');

  -- Phase 7 (migration 0003) : délais d'alerte et réparations en cours.
  PERFORM pg_temp.verifier((SELECT array_agg(valeur ORDER BY cle) FROM parametres WHERE cle LIKE 'alerte\_%')
                           = ARRAY['30', '7', '3'], 'Délais d''alerte livrés : réparation 30 j, retour 7 j, transfert 3 j');
  PERFORM pg_temp.doit_echouer($q$UPDATE parametres SET valeur = '366' WHERE cle = 'alerte_reparation_jours'$q$,
                               'GM006', 'Délai d''alerte supérieur à 365 jours');
  PERFORM pg_temp.doit_echouer($q$UPDATE parametres SET valeur = 'trois' WHERE cle = 'alerte_transfert_jours'$q$,
                               'GM006', 'Délai d''alerte non numérique');
  UPDATE parametres SET valeur = '0' WHERE cle = 'alerte_retour_jours';
  PERFORM pg_temp.verifier(parametre('alerte_retour_jours') = '0', 'Délai d''alerte à 0 accepté (alerte immédiate)');
  PERFORM pg_temp.verifier((SELECT jours = 0 AND commentaire = 'Écran fissuré, envoi au réparateur' AND depuis IS NOT NULL
                              FROM v_reparations_en_cours WHERE materiel_id = pg_temp.materiel('SN-0004')),
                           'Réparation en cours : date de départ et commentaire lus dans l''historique');
  PERFORM pg_temp.verifier(NOT EXISTS (SELECT 1 FROM v_reparations_en_cours r JOIN materiels m ON m.id = r.materiel_id
                                        WHERE m.statut <> 'EN_REPARATION'),
                           'Réparations en cours : seulement les matériels au statut « en réparation »');
END $$;

-- ---------------------------------------------------------------------
-- Contrôles de cohérence finaux
-- ---------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.verifier(NOT EXISTS (SELECT 1 FROM v_controle_stocks),
                           'Stock tenu = stock recalculé à partir des mouvements validés et des réceptions');
  PERFORM pg_temp.verifier(NOT EXISTS (SELECT 1 FROM v_controle_materiels),
                           'Statuts des matériels cohérents avec les affectations et les transferts en route');
  RAISE NOTICE '----------------------------------------------------------------';
  RAISE NOTICE 'Tous les contrôles sont passés.';
END $$;

ROLLBACK;
