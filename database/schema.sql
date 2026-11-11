-- =====================================================================
--  Gestion des matériels et des articles — schéma de la base
--  Version 0001 du 10/11/2026, révisée le 11/11/2026 après validation
--  des choix de gestion. PostgreSQL 16 ou plus (Neon), sans extension.
--
--  À exécuter une seule fois, sur une base vide :
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
--  Les évolutions suivantes iront dans database/migrations/0002_xxx.sql, …
--
--  Principe : la base garde elle-même les règles qui ne doivent jamais être
--  enfreintes : codes uniques, stock jamais négatif, mouvement validé
--  intouchable, une seule affectation en cours par matériel, statut et site
--  des matériels tenus par les mouvements et les affectations, historique des
--  états. Le serveur Express ajoute les droits et les contrôles de saisie,
--  mais ne peut pas contourner ces règles.
--
--  Le serveur doit, au début de chaque transaction qui écrit :
--    SELECT set_config('app.utilisateur_id', '<id de l''utilisateur>', true);
--  et, avant de changer à la main l'état ou le statut d'un matériel :
--    SELECT set_config('app.commentaire', '<commentaire>', true);
--  Les réglages « gm.* » sont réservés aux fonctions de la base : le serveur
--  ne doit jamais les poser.
--
--  Codes d'erreur propres à l'application (err.code côté Node) :
--    GM001 stock insuffisant                  GM008 matériel ou employé indisponible
--    GM002 enregistrement figé                GM009 utilisateur courant non renseigné
--    GM003 suppression interdite              GM010 historique non modifiable
--    GM004 ligne incohérente                  GM011 mouvement sans ligne
--    GM005 quantité non conforme à l'unité    GM012 unité figée (article déjà mouvementé)
--    GM006 information obligatoire absente    GM013 autorisation non valable
--    GM007 date non valable
-- =====================================================================

BEGIN;

SET client_min_messages = warning;

-- =====================================================================
-- 1. Versions, paramètres et fonctions communes
-- =====================================================================

CREATE TABLE schema_migrations (
  version      text PRIMARY KEY,
  description  text NOT NULL,
  appliquee_le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE parametres (
  cle         text PRIMARY KEY,
  valeur      text NOT NULL,
  description text NOT NULL,
  modifie_par bigint,                       -- clé étrangère ajoutée après « utilisateurs »
  modifie_le  timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION parametre(p_cle text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT valeur FROM parametres WHERE cle = p_cle
$$;

CREATE FUNCTION fuseau_horaire() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT valeur FROM parametres WHERE cle = 'fuseau_horaire'), 'UTC')
$$;

-- Date du jour dans le fuseau de la société (et non celui du serveur).
CREATE FUNCTION aujourdhui() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE fuseau_horaire())::date
$$;

CREATE FUNCTION trg_parametres_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cle = 'fuseau_horaire' THEN
    PERFORM now() AT TIME ZONE NEW.valeur;          -- erreur si le fuseau n'existe pas
  ELSIF NEW.cle IN ('prefixe_materiel', 'prefixe_article', 'prefixe_mouvement')
        AND NEW.valeur !~ '^[A-Z]{2,6}$' THEN
    RAISE EXCEPTION 'Préfixe invalide pour % : 2 à 6 lettres majuscules', NEW.cle
      USING ERRCODE = 'GM006';
  ELSIF NEW.cle IN ('connexion_tentatives_max', 'connexion_verrouillage_minutes')
        AND NEW.valeur !~ '^[1-9][0-9]{0,3}$' THEN
    RAISE EXCEPTION 'Nombre entier attendu pour %', NEW.cle USING ERRCODE = 'GM006';
  END IF;
  NEW.modifie_le := now();
  RETURN NEW;
END $$;

CREATE TRIGGER parametres_controle BEFORE INSERT OR UPDATE ON parametres
  FOR EACH ROW EXECUTE FUNCTION trg_parametres_controle();

INSERT INTO parametres (cle, valeur, description) VALUES
  ('nom_societe',                    'À renseigner',        'Nom affiché dans l''en-tête, sur les exports et sur les étiquettes'),
  ('fuseau_horaire',                 'Indian/Antananarivo', 'Fuseau horaire de la date du jour et de l''affichage'),
  ('devise',                         'MGA',                 'Devise des prix d''achat (montants entiers, sans décimale)'),
  ('prefixe_materiel',               'MAT',                 'Préfixe des codes matériels générés : MAT-2026-0001 (imprimé en code-barres)'),
  ('prefixe_article',                'ART',                 'Préfixe des codes articles générés : ART-2026-0001'),
  ('prefixe_mouvement',              'MVT',                 'Préfixe des références de mouvement : MVT-2026-000001'),
  ('connexion_tentatives_max',       '5',                   'Échecs de connexion avant verrouillage temporaire du compte'),
  ('connexion_verrouillage_minutes', '15',                  'Durée du verrouillage après trop d''échecs');

-- Auteur de l'opération en cours, posé par le serveur dans la transaction.
CREATE FUNCTION utilisateur_courant() RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v text := current_setting('app.utilisateur_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'Utilisateur courant non renseigné'
      USING ERRCODE = 'GM009',
            HINT = 'Le serveur doit exécuter set_config(''app.utilisateur_id'', <id>, true) au début de la transaction.';
  END IF;
  RETURN v::bigint;
END $$;

CREATE FUNCTION commentaire_courant() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(btrim(current_setting('app.commentaire', true)), '')
$$;

-- Réglage interne à la transaction : pose une valeur et rend l'ancienne,
-- pour la remettre ensuite (les fonctions peuvent s'appeler entre elles).
CREATE FUNCTION drapeau(p_nom text, p_valeur text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_precedent text := coalesce(current_setting(p_nom, true), '');
BEGIN
  PERFORM set_config(p_nom, p_valeur, true);
  RETURN v_precedent;
END $$;

CREATE FUNCTION drapeau_leve(p_nom text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting(p_nom, true), '') = 'oui'
$$;

CREATE FUNCTION trg_modifie_le() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.modifie_le := now();
  RETURN NEW;
END $$;

-- Tables d'historique : on ajoute, on ne modifie pas, on ne supprime pas.
CREATE FUNCTION trg_historique_fige() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La table % est un historique : ni modification, ni suppression, ni vidage', TG_TABLE_NAME
    USING ERRCODE = 'GM010';
END $$;

-- Tables de traçabilité : jamais vidées d'un coup.
CREATE FUNCTION trg_interdire_vidage() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La table % ne se vide pas (TRUNCATE interdit)', TG_TABLE_NAME
    USING ERRCODE = 'GM003';
END $$;

-- =====================================================================
-- 2. Référentiels
-- =====================================================================

CREATE TABLE roles (
  code        text PRIMARY KEY,
  libelle     text NOT NULL,
  description text NOT NULL
);

INSERT INTO roles (code, libelle, description) VALUES
  ('ADMIN',               'Administrateur',            'Paramétrage, comptes utilisateurs, droits et accès complet'),
  ('GESTIONNAIRE',        'Gestionnaire de matériels', 'Création des fiches, saisie et validation des mouvements, affectations et inventaires'),
  ('RESPONSABLE_SERVICE', 'Responsable de service',    'Consultation des biens de son service et validation selon les droits accordés'),
  ('EMPLOYE',             'Employé',                   'Consultation de ses matériels affectés, signalement d''un retour ou d''un problème');

CREATE TABLE sites (
  id      bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  code    text NOT NULL UNIQUE CONSTRAINT sites_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  nom     text NOT NULL CONSTRAINT sites_nom_non_vide CHECK (btrim(nom) <> ''),
  adresse text,
  actif   boolean NOT NULL DEFAULT true,
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sites_nom_uk ON sites (lower(btrim(nom)));

CREATE TABLE services (
  id      bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  code    text NOT NULL UNIQUE CONSTRAINT services_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  nom     text NOT NULL CONSTRAINT services_nom_non_vide CHECK (btrim(nom) <> ''),
  site_id bigint REFERENCES sites (id),
  actif   boolean NOT NULL DEFAULT true,
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX services_nom_uk ON services (lower(btrim(nom)));
CREATE INDEX services_site_idx ON services (site_id);

CREATE TABLE categories (
  id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  nom         text NOT NULL CONSTRAINT categories_nom_non_vide CHECK (btrim(nom) <> ''),
  type        text NOT NULL CONSTRAINT categories_type_valide CHECK (type IN ('MATERIEL', 'ARTICLE')),
  description text,
  actif       boolean NOT NULL DEFAULT true,
  cree_le     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_id_type_uk UNIQUE (id, type)   -- cible des clés étrangères (id, type)
);
CREATE UNIQUE INDEX categories_nom_uk ON categories (type, lower(btrim(nom)));

INSERT INTO categories (nom, type) VALUES
  ('Informatique',               'MATERIEL'),
  ('Téléphonie',                 'MATERIEL'),
  ('Mobilier',                   'MATERIEL'),
  ('Véhicule',                   'MATERIEL'),
  ('Équipement technique',       'MATERIEL'),
  ('Fournitures de bureau',      'ARTICLE'),
  ('Consommables informatiques', 'ARTICLE'),
  ('Produits d''entretien',      'ARTICLE');

CREATE TABLE unites (
  code      text PRIMARY KEY CONSTRAINT unites_code_format CHECK (code ~ '^[A-Z_]{1,12}$'),
  libelle   text NOT NULL,
  symbole   text NOT NULL,
  decimales smallint NOT NULL CONSTRAINT unites_decimales CHECK (decimales BETWEEN 0 AND 3)
);

INSERT INTO unites (code, libelle, symbole, decimales) VALUES
  ('PIECE',   'Pièce',      'pce',  0),
  ('BOITE',   'Boîte',      'bte',  0),
  ('PAQUET',  'Paquet',     'pqt',  0),
  ('RAME',    'Rame',       'rame', 0),
  ('CARTON',  'Carton',     'ctn',  0),
  ('ROULEAU', 'Rouleau',    'rlx',  0),
  ('LITRE',   'Litre',      'L',    3),
  ('KG',      'Kilogramme', 'kg',   3),
  ('METRE',   'Mètre',      'm',    2);

-- sens : ENTREE = une destination, pas d'origine ; SORTIE = une origine, pas de
-- destination ; TRANSFERT = les deux, en deux temps : l'envoi retire le bien du
-- site d'origine, la réception l'ajoute au site de destination.
CREATE TABLE types_mouvements (
  code                     text PRIMARY KEY,
  libelle                  text NOT NULL,
  sens                     text NOT NULL CONSTRAINT types_mouvements_sens CHECK (sens IN ('ENTREE', 'SORTIE', 'TRANSFERT')),
  pour_articles            boolean NOT NULL,
  pour_materiels           boolean NOT NULL,
  motif_obligatoire        boolean NOT NULL,
  beneficiaire_obligatoire boolean NOT NULL,   -- employé ou service bénéficiaire
  autorisation_obligatoire boolean NOT NULL,   -- « autorise_par » exigé
  ticket_obligatoire       boolean NOT NULL,   -- n° de ticket exigé dès qu'un matériel est concerné
  saisie_manuelle          boolean NOT NULL,   -- false : créé seulement par l'écran Affectations
  ordre                    smallint NOT NULL
);

INSERT INTO types_mouvements VALUES
  -- code                 libellé                          sens         art.   mat.   motif  bénéf. autor. ticket manuel ordre
  ('RECEPTION_ACHAT',    'Réception — achat',             'ENTREE',    true,  true,  false, false, false, false, true,  10),
  ('RECEPTION_DON',      'Réception — don',               'ENTREE',    true,  true,  false, false, false, false, true,  20),
  ('RETOUR_AFFECTATION', 'Retour d''affectation',         'ENTREE',    false, true,  false, true,  false, true,  false, 30),
  ('CORRECTION_PLUS',    'Correction d''inventaire (+)',  'ENTREE',    true,  false, true,  false, true,  false, true,  40),
  ('CONSOMMATION',       'Consommation / distribution',   'SORTIE',    true,  false, true,  true,  false, false, true,  50),
  ('AFFECTATION',        'Affectation à un employé',      'SORTIE',    false, true,  true,  true,  false, true,  false, 60),
  ('PERTE',              'Perte',                         'SORTIE',    true,  true,  true,  false, false, true,  true,  70),
  ('CASSE',              'Casse',                         'SORTIE',    true,  false, true,  false, false, false, true,  80),
  ('MISE_AU_REBUT',      'Mise au rebut',                 'SORTIE',    true,  true,  true,  false, false, true,  true,  90),
  ('CORRECTION_MOINS',   'Correction d''inventaire (−)',  'SORTIE',    true,  false, true,  false, true,  false, true,  100),
  ('TRANSFERT',          'Transfert entre sites',         'TRANSFERT', true,  true,  true,  false, false, true,  true,  110);

-- =====================================================================
-- 3. Personnes : employés et utilisateurs
-- =====================================================================

CREATE TABLE employes (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  matricule  text NOT NULL UNIQUE CONSTRAINT employes_matricule_non_vide CHECK (btrim(matricule) <> ''),
  nom        text NOT NULL CONSTRAINT employes_nom_non_vide CHECK (btrim(nom) <> ''),
  prenoms    text,
  fonction   text,
  service_id bigint REFERENCES services (id),
  site_id    bigint REFERENCES sites (id),
  telephone  text,
  email      text,
  actif      boolean NOT NULL DEFAULT true,
  cree_le    timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employes_service_idx ON employes (service_id);
CREATE INDEX employes_site_idx ON employes (site_id);
CREATE INDEX employes_nom_idx ON employes (lower(nom));
CREATE TRIGGER employes_modifie_le BEFORE UPDATE ON employes
  FOR EACH ROW EXECUTE FUNCTION trg_modifie_le();

CREATE TABLE utilisateurs (
  id                     bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  nom                    text NOT NULL CONSTRAINT utilisateurs_nom_non_vide CHECK (btrim(nom) <> ''),
  email                  text NOT NULL CONSTRAINT utilisateurs_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  identifiant            text CONSTRAINT utilisateurs_identifiant_format CHECK (identifiant ~ '^[a-zA-Z0-9._-]{3,40}$'),
  -- Jamais de mot de passe en clair : seul un hash bcrypt ou Argon2 est accepté.
  mot_de_passe_hash      text NOT NULL CONSTRAINT utilisateurs_hash_robuste
                           CHECK (mot_de_passe_hash ~ '^\$(2[aby]|argon2(id|i|d))\$'),
  role_code              text NOT NULL REFERENCES roles (code),
  statut                 text NOT NULL DEFAULT 'ACTIF'
                           CONSTRAINT utilisateurs_statut CHECK (statut IN ('ACTIF', 'SUSPENDU', 'DESACTIVE')),
  employe_id             bigint REFERENCES employes (id),   -- obligatoire pour le rôle Employé
  service_id             bigint REFERENCES services (id),   -- périmètre d'un responsable de service
  doit_changer_mot_de_passe boolean NOT NULL DEFAULT true,
  tentatives_echouees    smallint NOT NULL DEFAULT 0 CONSTRAINT utilisateurs_tentatives CHECK (tentatives_echouees >= 0),
  verrouille_jusqu_a     timestamptz,
  derniere_connexion     timestamptz,
  mot_de_passe_change_le timestamptz,
  cree_le                timestamptz NOT NULL DEFAULT now(),
  modifie_le             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT utilisateurs_employe_requis CHECK (role_code <> 'EMPLOYE' OR employe_id IS NOT NULL),
  CONSTRAINT utilisateurs_service_requis CHECK (role_code <> 'RESPONSABLE_SERVICE' OR service_id IS NOT NULL)
);
CREATE UNIQUE INDEX utilisateurs_email_uk ON utilisateurs (lower(email));
CREATE UNIQUE INDEX utilisateurs_identifiant_uk ON utilisateurs (lower(identifiant)) WHERE identifiant IS NOT NULL;
CREATE UNIQUE INDEX utilisateurs_employe_uk ON utilisateurs (employe_id) WHERE employe_id IS NOT NULL;
CREATE TRIGGER utilisateurs_modifie_le BEFORE UPDATE ON utilisateurs
  FOR EACH ROW EXECUTE FUNCTION trg_modifie_le();

ALTER TABLE parametres
  ADD CONSTRAINT parametres_modifie_par_fk FOREIGN KEY (modifie_par) REFERENCES utilisateurs (id);

-- =====================================================================
-- 4. Codes automatiques : MAT-2026-0001, ART-2026-0001, MVT-2026-000001
-- =====================================================================

CREATE TABLE compteurs (
  prefixe        text     NOT NULL,
  annee          smallint NOT NULL,
  dernier_numero integer  NOT NULL CONSTRAINT compteurs_positif CHECK (dernier_numero > 0),
  PRIMARY KEY (prefixe, annee)
);

-- Numéro suivant, sans doublon même si deux personnes enregistrent en même temps.
CREATE FUNCTION prochain_code(p_prefixe text, p_largeur integer) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_annee  smallint := extract(year FROM aujourdhui())::smallint;
  v_numero integer;
BEGIN
  INSERT INTO compteurs AS c (prefixe, annee, dernier_numero)
  VALUES (p_prefixe, v_annee, 1)
  ON CONFLICT (prefixe, annee) DO UPDATE SET dernier_numero = c.dernier_numero + 1
  RETURNING c.dernier_numero INTO v_numero;

  RETURN p_prefixe || '-' || v_annee || '-' ||
         CASE WHEN length(v_numero::text) >= p_largeur THEN v_numero::text
              ELSE lpad(v_numero::text, p_largeur, '0') END;
END $$;

-- Code laissé vide → généré ; code saisi → mis en majuscules, unicité par la contrainte.
-- TG_ARGV[0] = clé du paramètre qui donne le préfixe.
CREATE FUNCTION trg_attribuer_code() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_prefixe text := parametre(TG_ARGV[0]);
  v_existe  boolean;
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
    LOOP   -- saute un numéro déjà pris par un code saisi à la main
      NEW.code := prochain_code(v_prefixe, 4);
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE code = $1)', TG_TABLE_NAME)
        INTO v_existe USING NEW.code;
      EXIT WHEN NOT v_existe;
    END LOOP;
  ELSE
    NEW.code := upper(btrim(NEW.code));
  END IF;
  RETURN NEW;
END $$;

-- =====================================================================
-- 5. Matériels durables
-- =====================================================================
--  Statut tenu par la base :
--    DISPONIBLE ⇄ EN_REPARATION       à la main (avec commentaire vers « en réparation »)
--    → AFFECTE                        par une affectation
--    → selon l'état constaté          par le retour d'affectation
--    → EN_TRANSIT → (site d'arrivée)  par l'envoi puis la réception d'un transfert
--    → PERDU / REFORME                par un mouvement de perte / de mise au rebut
--  Le site ne change que par la réception d'un transfert ou un retour d'affectation.

CREATE TABLE materiels (
  id                     bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  code                   text NOT NULL UNIQUE CONSTRAINT materiels_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{1,39}$'),
  designation            text NOT NULL CONSTRAINT materiels_designation_non_vide CHECK (btrim(designation) <> ''),
  categorie_id           bigint NOT NULL,
  categorie_type         text NOT NULL DEFAULT 'MATERIEL' CONSTRAINT materiels_categorie_type CHECK (categorie_type = 'MATERIEL'),
  marque                 text,
  modele                 text,
  numero_serie           text CONSTRAINT materiels_serie_non_vide CHECK (btrim(numero_serie) <> ''),
  date_achat             date,
  prix_achat             bigint CONSTRAINT materiels_prix_positif CHECK (prix_achat >= 0),   -- Ariary, sans décimale
  fournisseur            text,
  site_id                bigint NOT NULL REFERENCES sites (id),
  service_id             bigint REFERENCES services (id),
  etat                   text NOT NULL DEFAULT 'BON'
                           CONSTRAINT materiels_etat CHECK (etat IN ('NEUF', 'BON', 'MOYEN', 'ENDOMMAGE', 'HORS_SERVICE')),
  statut                 text NOT NULL DEFAULT 'DISPONIBLE'
                           CONSTRAINT materiels_statut CHECK (statut IN ('DISPONIBLE', 'AFFECTE', 'EN_REPARATION',
                                                                         'EN_TRANSIT', 'PERDU', 'REFORME')),
  etiquette_imprimee_le  timestamptz,      -- dernière impression de l'étiquette code-barres
  photo_url              text,             -- stockage externe ; jamais le disque de Render
  observations           text,
  cree_par               bigint NOT NULL REFERENCES utilisateurs (id),
  cree_le                timestamptz NOT NULL DEFAULT now(),
  modifie_par            bigint REFERENCES utilisateurs (id),
  modifie_le             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT materiels_categorie_fk FOREIGN KEY (categorie_id, categorie_type) REFERENCES categories (id, type),
  -- Un matériel hors service ne peut être ni disponible ni affecté.
  CONSTRAINT materiels_hors_service_inutilisable CHECK (NOT (etat = 'HORS_SERVICE' AND statut IN ('DISPONIBLE', 'AFFECTE')))
);
CREATE UNIQUE INDEX materiels_numero_serie_uk ON materiels (upper(btrim(numero_serie))) WHERE numero_serie IS NOT NULL;
CREATE INDEX materiels_statut_idx ON materiels (statut);
CREATE INDEX materiels_site_idx ON materiels (site_id);
CREATE INDEX materiels_service_idx ON materiels (service_id);
CREATE INDEX materiels_categorie_idx ON materiels (categorie_id);
CREATE INDEX materiels_designation_idx ON materiels (lower(designation));

CREATE FUNCTION trg_materiels_avant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.statut NOT IN ('DISPONIBLE', 'EN_REPARATION') THEN
      RAISE EXCEPTION 'Une fiche matériel se crée disponible ou en réparation ; les autres statuts viennent des mouvements'
        USING ERRCODE = 'GM002';
    END IF;
    NEW.cree_par    := coalesce(NEW.cree_par, utilisateur_courant());
    NEW.cree_le     := now();
    NEW.modifie_par := NULL;
  ELSE
    IF NEW.code IS DISTINCT FROM OLD.code
       OR NEW.cree_par IS DISTINCT FROM OLD.cree_par
       OR NEW.cree_le IS DISTINCT FROM OLD.cree_le THEN
      RAISE EXCEPTION 'Le code et l''auteur de la fiche % ne se modifient pas', OLD.code
        USING ERRCODE = 'GM002';
    END IF;
    IF NOT drapeau_leve('gm.maj_materiel') THEN
      IF NEW.site_id IS DISTINCT FROM OLD.site_id THEN
        RAISE EXCEPTION 'Le matériel % change de site par un transfert (envoi puis réception), pas à la main', OLD.code
          USING ERRCODE = 'GM002';
      END IF;
      IF NEW.statut IS DISTINCT FROM OLD.statut
         AND NOT (OLD.statut IN ('DISPONIBLE', 'EN_REPARATION') AND NEW.statut IN ('DISPONIBLE', 'EN_REPARATION')) THEN
        RAISE EXCEPTION 'Le matériel % passe de % à % par un mouvement ou une affectation, pas à la main',
          OLD.code, OLD.statut, NEW.statut
          USING ERRCODE = 'GM002';
      END IF;
    END IF;
    NEW.modifie_par := utilisateur_courant();
  END IF;
  NEW.modifie_le := now();
  RETURN NEW;
END $$;

-- Chaque création et chaque changement d'état ou de statut est inscrit dans
-- historiques_etats, avec son auteur et sa date. Commentaire exigé pour les
-- changements qui signalent un problème.
CREATE FUNCTION trg_materiels_historique() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_commentaire text := commentaire_courant();
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.etat IS NOT DISTINCT FROM OLD.etat
     AND NEW.statut IS NOT DISTINCT FROM OLD.statut THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND v_commentaire IS NULL AND (
       (NEW.etat IS DISTINCT FROM OLD.etat AND NEW.etat IN ('ENDOMMAGE', 'HORS_SERVICE'))
    OR (NEW.statut IS DISTINCT FROM OLD.statut AND NEW.statut IN ('EN_REPARATION', 'PERDU', 'REFORME'))) THEN
    RAISE EXCEPTION 'Commentaire obligatoire pour passer le matériel % à l''état % / au statut %',
      NEW.code, NEW.etat, NEW.statut
      USING ERRCODE = 'GM006';
  END IF;

  INSERT INTO historiques_etats (materiel_id, ancien_etat, nouvel_etat, ancien_statut, nouveau_statut,
                                 auteur_id, commentaire)
  VALUES (NEW.id,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD.etat END, NEW.etat,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD.statut END, NEW.statut,
          utilisateur_courant(),
          coalesce(v_commentaire, CASE WHEN TG_OP = 'INSERT' THEN 'Création de la fiche' END));
  RETURN NULL;
END $$;

CREATE TRIGGER materiels_10_code BEFORE INSERT ON materiels
  FOR EACH ROW EXECUTE FUNCTION trg_attribuer_code('prefixe_materiel');
CREATE TRIGGER materiels_20_avant BEFORE INSERT OR UPDATE ON materiels
  FOR EACH ROW EXECUTE FUNCTION trg_materiels_avant();
CREATE TRIGGER materiels_30_historique AFTER INSERT OR UPDATE OF etat, statut ON materiels
  FOR EACH ROW EXECUTE FUNCTION trg_materiels_historique();

-- =====================================================================
-- 6. Articles consommables, seuils et stock par site
-- =====================================================================

CREATE TABLE articles (
  id               bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  code             text NOT NULL UNIQUE CONSTRAINT articles_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{1,39}$'),
  designation      text NOT NULL CONSTRAINT articles_designation_non_vide CHECK (btrim(designation) <> ''),
  categorie_id     bigint NOT NULL,
  categorie_type   text NOT NULL DEFAULT 'ARTICLE' CONSTRAINT articles_categorie_type CHECK (categorie_type = 'ARTICLE'),
  unite_code       text NOT NULL REFERENCES unites (code),
  -- Seuil global, à saisir pour chaque article (0 = choix explicite de ne pas suivre de seuil).
  seuil_minimum    numeric(14, 3) NOT NULL CONSTRAINT articles_seuil_positif CHECK (seuil_minimum >= 0),
  site_stockage_id bigint REFERENCES sites (id),     -- magasin habituel
  emplacement      text,                             -- rayon, étagère…
  actif            boolean NOT NULL DEFAULT true,
  observations     text,
  cree_par         bigint NOT NULL REFERENCES utilisateurs (id),
  cree_le          timestamptz NOT NULL DEFAULT now(),
  modifie_par      bigint REFERENCES utilisateurs (id),
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT articles_categorie_fk FOREIGN KEY (categorie_id, categorie_type) REFERENCES categories (id, type)
);
CREATE UNIQUE INDEX articles_designation_uk ON articles (lower(btrim(designation)));
CREATE INDEX articles_categorie_idx ON articles (categorie_id);
CREATE INDEX articles_site_stockage_idx ON articles (site_stockage_id);

CREATE FUNCTION trg_articles_avant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.cree_par    := coalesce(NEW.cree_par, utilisateur_courant());
    NEW.cree_le     := now();
    NEW.modifie_par := NULL;
  ELSE
    IF NEW.code IS DISTINCT FROM OLD.code
       OR NEW.cree_par IS DISTINCT FROM OLD.cree_par
       OR NEW.cree_le IS DISTINCT FROM OLD.cree_le THEN
      RAISE EXCEPTION 'Le code et l''auteur de l''article % ne se modifient pas', OLD.code
        USING ERRCODE = 'GM002';
    END IF;
    IF NEW.unite_code IS DISTINCT FROM OLD.unite_code
       AND EXISTS (SELECT 1 FROM lignes_mouvements WHERE article_id = OLD.id) THEN
      RAISE EXCEPTION 'L''unité de l''article % est figée : il a déjà des mouvements', OLD.code
        USING ERRCODE = 'GM012';
    END IF;
    NEW.modifie_par := utilisateur_courant();
  END IF;
  NEW.modifie_le := now();
  RETURN NEW;
END $$;

CREATE TRIGGER articles_10_code BEFORE INSERT ON articles
  FOR EACH ROW EXECUTE FUNCTION trg_attribuer_code('prefixe_article');
CREATE TRIGGER articles_20_avant BEFORE INSERT OR UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION trg_articles_avant();

-- Seuil propre à un site, facultatif, en plus du seuil global de l'article.
CREATE TABLE seuils_articles_sites (
  article_id    bigint NOT NULL REFERENCES articles (id),
  site_id       bigint NOT NULL REFERENCES sites (id),
  seuil_minimum numeric(14, 3) NOT NULL CONSTRAINT seuils_sites_positif CHECK (seuil_minimum > 0),
  modifie_par   bigint NOT NULL REFERENCES utilisateurs (id),
  modifie_le    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, site_id)
);
CREATE INDEX seuils_articles_sites_site_idx ON seuils_articles_sites (site_id);

CREATE FUNCTION trg_seuils_sites_avant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.modifie_par := utilisateur_courant();
  NEW.modifie_le  := now();
  RETURN NEW;
END $$;

CREATE TRIGGER seuils_articles_sites_avant BEFORE INSERT OR UPDATE ON seuils_articles_sites
  FOR EACH ROW EXECUTE FUNCTION trg_seuils_sites_avant();

-- Stock tenu par la base : modifié seulement par les mouvements (validation,
-- annulation, réception d'un transfert). La contrainte de positivité est le
-- dernier rempart.
CREATE TABLE stocks_articles (
  article_id bigint NOT NULL REFERENCES articles (id),
  site_id    bigint NOT NULL REFERENCES sites (id),
  quantite   numeric(14, 3) NOT NULL DEFAULT 0 CONSTRAINT stocks_articles_jamais_negatif CHECK (quantite >= 0),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, site_id)
);
CREATE INDEX stocks_articles_site_idx ON stocks_articles (site_id);

CREATE FUNCTION trg_stocks_garde() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT drapeau_leve('gm.maj_stock') THEN
    RAISE EXCEPTION 'Le stock ne se modifie que par les mouvements (validation, annulation, réception)'
      USING ERRCODE = 'GM002';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  NEW.modifie_le := now();
  RETURN NEW;
END $$;

CREATE TRIGGER stocks_articles_garde BEFORE INSERT OR UPDATE OR DELETE ON stocks_articles
  FOR EACH ROW EXECUTE FUNCTION trg_stocks_garde();
CREATE TRIGGER stocks_articles_pas_de_vidage BEFORE TRUNCATE ON stocks_articles
  FOR EACH STATEMENT EXECUTE FUNCTION trg_interdire_vidage();

-- =====================================================================
-- 7. Mouvements (en-tête) et lignes de mouvement
-- =====================================================================
--  Cycle de vie : BROUILLON → VALIDE → ANNULE   (ou BROUILLON → ANNULE)
--  - Un mouvement se crée toujours en brouillon ; ses lignes se modifient librement.
--  - La validation contrôle le mouvement puis applique son effet (stock des
--    articles, statut des matériels).
--  - Un transfert validé est « en route » : il a quitté l'origine. Le site de
--    destination confirme ensuite la réception (receptionner_transfert), avec
--    un motif si une quantité manque. Un transfert reçu est définitif.
--  - Un mouvement validé est figé : on l'annule (effet inverse, tracé) ou on
--    passe un mouvement inverse autorisé qui le référence.
--  - Aucun mouvement n'est jamais supprimé, même en brouillon (il s'annule).

CREATE TABLE mouvements (
  id                      bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  reference               text NOT NULL UNIQUE,              -- MVT-2026-000001, attribuée par la base
  type_code               text NOT NULL REFERENCES types_mouvements (code),
  date_mouvement          date NOT NULL DEFAULT aujourdhui(), -- pour un transfert : date d'envoi
  statut                  text NOT NULL DEFAULT 'BROUILLON'
                            CONSTRAINT mouvements_statut CHECK (statut IN ('BROUILLON', 'VALIDE', 'ANNULE')),
  motif                   text,
  numero_ticket           text CONSTRAINT mouvements_ticket_non_vide CHECK (btrim(numero_ticket) <> ''),
  reference_externe       text,       -- n° de bon de livraison, de facture, de bon de sortie…
  origine                 text,       -- fournisseur ou donateur (entrées)
  employe_beneficiaire_id bigint REFERENCES employes (id),
  service_beneficiaire_id bigint REFERENCES services (id),
  justificatif_url        text,       -- pièce jointe sur un stockage externe
  mouvement_corrige_id    bigint REFERENCES mouvements (id),  -- mouvement inverse : celui qu'il corrige
  autorise_par            bigint REFERENCES utilisateurs (id),
  cree_par                bigint NOT NULL REFERENCES utilisateurs (id),
  cree_le                 timestamptz NOT NULL DEFAULT now(),
  modifie_le              timestamptz NOT NULL DEFAULT now(),
  valide_par              bigint REFERENCES utilisateurs (id),
  valide_le               timestamptz,
  date_reception          date,       -- transfert : date de réception au site de destination
  recu_par                bigint REFERENCES utilisateurs (id),
  recu_le                 timestamptz,
  motif_ecart             text,       -- transfert reçu avec une quantité manquante
  annule_par              bigint REFERENCES utilisateurs (id),
  annule_le               timestamptz,
  motif_annulation        text,
  CONSTRAINT mouvements_brouillon_non_valide CHECK (statut <> 'BROUILLON' OR (valide_par IS NULL AND valide_le IS NULL)),
  CONSTRAINT mouvements_valide_signe         CHECK (statut <> 'VALIDE' OR (valide_par IS NOT NULL AND valide_le IS NOT NULL)),
  CONSTRAINT mouvements_annulation_motivee   CHECK (statut <> 'ANNULE' OR (annule_par IS NOT NULL AND annule_le IS NOT NULL
                                                    AND length(btrim(coalesce(motif_annulation, ''))) >= 3)),
  CONSTRAINT mouvements_annulation_vide      CHECK (statut = 'ANNULE' OR (annule_par IS NULL AND annule_le IS NULL
                                                    AND motif_annulation IS NULL)),
  CONSTRAINT mouvements_reception_complete   CHECK ((date_reception IS NULL AND recu_par IS NULL AND recu_le IS NULL)
                                                    OR (date_reception IS NOT NULL AND recu_par IS NOT NULL AND recu_le IS NOT NULL
                                                        AND statut = 'VALIDE')),
  CONSTRAINT mouvements_pas_auto_correction  CHECK (mouvement_corrige_id IS NULL OR mouvement_corrige_id <> id)
);
CREATE INDEX mouvements_date_idx ON mouvements (date_mouvement DESC);
CREATE INDEX mouvements_statut_idx ON mouvements (statut);
CREATE INDEX mouvements_type_idx ON mouvements (type_code);
CREATE INDEX mouvements_employe_idx ON mouvements (employe_beneficiaire_id);
CREATE INDEX mouvements_service_idx ON mouvements (service_beneficiaire_id);
CREATE INDEX mouvements_corrige_idx ON mouvements (mouvement_corrige_id);
CREATE INDEX mouvements_ticket_idx ON mouvements (numero_ticket) WHERE numero_ticket IS NOT NULL;
CREATE INDEX mouvements_en_route_idx ON mouvements (date_mouvement)
  WHERE type_code = 'TRANSFERT' AND statut = 'VALIDE' AND recu_le IS NULL;

CREATE TABLE lignes_mouvements (
  id                    bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  mouvement_id          bigint NOT NULL REFERENCES mouvements (id),
  article_id            bigint REFERENCES articles (id),
  materiel_id           bigint REFERENCES materiels (id),
  quantite              numeric(14, 3) NOT NULL CONSTRAINT lignes_quantite_positive CHECK (quantite > 0),
  site_source_id        bigint REFERENCES sites (id),
  site_destination_id   bigint REFERENCES sites (id),
  observations          text,
  -- Rempli par la base :
  quantite_recue        numeric(14, 3),   -- transfert : quantité arrivée à destination
  materiel_statut_avant text,             -- statut du matériel avant l'effet du mouvement
  cree_le               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lignes_un_seul_bien        CHECK (num_nonnulls(article_id, materiel_id) = 1),
  CONSTRAINT lignes_materiel_unitaire   CHECK (materiel_id IS NULL OR quantite = 1),
  CONSTRAINT lignes_au_moins_un_site    CHECK (num_nonnulls(site_source_id, site_destination_id) >= 1),
  CONSTRAINT lignes_sites_differents    CHECK (site_source_id IS DISTINCT FROM site_destination_id),
  CONSTRAINT lignes_quantite_recue      CHECK (quantite_recue IS NULL OR (quantite_recue >= 0 AND quantite_recue <= quantite)),
  CONSTRAINT lignes_statut_avant        CHECK (materiel_statut_avant IN ('DISPONIBLE', 'EN_REPARATION'))
);
CREATE INDEX lignes_mouvement_idx ON lignes_mouvements (mouvement_id);
CREATE INDEX lignes_article_idx ON lignes_mouvements (article_id) WHERE article_id IS NOT NULL;
CREATE INDEX lignes_materiel_idx ON lignes_mouvements (materiel_id) WHERE materiel_id IS NOT NULL;
CREATE INDEX lignes_source_idx ON lignes_mouvements (site_source_id);
CREATE INDEX lignes_destination_idx ON lignes_mouvements (site_destination_id);
CREATE UNIQUE INDEX lignes_materiel_une_fois_uk ON lignes_mouvements (mouvement_id, materiel_id) WHERE materiel_id IS NOT NULL;

-- Une ligne est-elle cohérente avec le type du mouvement ?
CREATE FUNCTION controler_ligne(l lignes_mouvements, t types_mouvements) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_decimales smallint;
  v_code      text;
BEGIN
  IF l.article_id IS NOT NULL AND NOT t.pour_articles THEN
    RAISE EXCEPTION 'Un mouvement « % » ne porte pas sur des articles', t.libelle USING ERRCODE = 'GM004';
  END IF;
  IF l.materiel_id IS NOT NULL AND NOT t.pour_materiels THEN
    RAISE EXCEPTION 'Un mouvement « % » ne porte pas sur des matériels', t.libelle USING ERRCODE = 'GM004';
  END IF;

  IF t.sens = 'ENTREE' AND (l.site_source_id IS NOT NULL OR l.site_destination_id IS NULL) THEN
    RAISE EXCEPTION 'Une entrée (« % ») a un site de destination et pas de site d''origine', t.libelle
      USING ERRCODE = 'GM004';
  ELSIF t.sens = 'SORTIE' AND (l.site_source_id IS NULL OR l.site_destination_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Une sortie (« % ») a un site d''origine et pas de site de destination', t.libelle
      USING ERRCODE = 'GM004';
  ELSIF t.sens = 'TRANSFERT' AND (l.site_source_id IS NULL OR l.site_destination_id IS NULL) THEN
    RAISE EXCEPTION 'Un transfert a un site d''origine et un site de destination'
      USING ERRCODE = 'GM004';
  END IF;

  IF l.article_id IS NOT NULL THEN
    SELECT u.decimales, a.code INTO v_decimales, v_code
      FROM articles a JOIN unites u ON u.code = a.unite_code
     WHERE a.id = l.article_id;
    IF l.quantite <> round(l.quantite, v_decimales) THEN
      RAISE EXCEPTION 'Quantité % refusée pour l''article % : % décimale(s) au plus dans son unité',
        trim_scale(l.quantite), v_code, v_decimales
        USING ERRCODE = 'GM005';
    END IF;
  END IF;
END $$;

-- Contrôles faits au moment de la validation.
CREATE FUNCTION controler_mouvement(m mouvements) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t                types_mouvements%ROWTYPE;
  l                lignes_mouvements%ROWTYPE;
  v_nb_lignes      integer := 0;
  v_avec_materiel  boolean := false;
  v_statut_corrige text;
  v_role           text;
  v_statut_compte  text;
BEGIN
  SELECT * INTO t FROM types_mouvements WHERE code = m.type_code;

  IF m.date_mouvement > aujourdhui() THEN
    RAISE EXCEPTION 'La date du mouvement (%) est dans le futur', to_char(m.date_mouvement, 'DD/MM/YYYY')
      USING ERRCODE = 'GM007';
  END IF;
  IF t.motif_obligatoire AND length(btrim(coalesce(m.motif, ''))) < 3 THEN
    RAISE EXCEPTION 'Motif obligatoire pour un mouvement « % »', t.libelle USING ERRCODE = 'GM006';
  END IF;
  IF t.beneficiaire_obligatoire AND m.employe_beneficiaire_id IS NULL AND m.service_beneficiaire_id IS NULL THEN
    RAISE EXCEPTION 'Bénéficiaire (employé ou service) obligatoire pour un mouvement « % »', t.libelle
      USING ERRCODE = 'GM006';
  END IF;

  -- Autorisation : un administrateur, ou un gestionnaire autre que l'auteur.
  IF t.autorisation_obligatoire OR m.mouvement_corrige_id IS NOT NULL THEN
    IF m.autorise_par IS NULL THEN
      RAISE EXCEPTION 'Autorisation obligatoire pour « % » : indiquez qui l''autorise', t.libelle
        USING ERRCODE = 'GM006';
    END IF;
    SELECT role_code, statut INTO v_role, v_statut_compte FROM utilisateurs WHERE id = m.autorise_par;
    IF v_statut_compte <> 'ACTIF'
       OR NOT (v_role = 'ADMIN' OR (v_role = 'GESTIONNAIRE' AND m.autorise_par <> m.cree_par)) THEN
      RAISE EXCEPTION 'L''autorisation doit venir d''un administrateur, ou d''un gestionnaire autre que l''auteur du mouvement'
        USING ERRCODE = 'GM013';
    END IF;
  END IF;

  IF m.mouvement_corrige_id IS NOT NULL THEN
    SELECT statut INTO v_statut_corrige FROM mouvements WHERE id = m.mouvement_corrige_id;
    IF v_statut_corrige IS DISTINCT FROM 'VALIDE' THEN
      RAISE EXCEPTION 'Un mouvement inverse ne corrige qu''un mouvement validé' USING ERRCODE = 'GM006';
    END IF;
  END IF;

  FOR l IN SELECT * FROM lignes_mouvements WHERE mouvement_id = m.id LOOP
    PERFORM controler_ligne(l, t);         -- le type a pu changer depuis la saisie des lignes
    v_nb_lignes := v_nb_lignes + 1;
    v_avec_materiel := v_avec_materiel OR l.materiel_id IS NOT NULL;
  END LOOP;
  IF v_nb_lignes = 0 THEN
    RAISE EXCEPTION 'Le mouvement % n''a aucune ligne', m.reference USING ERRCODE = 'GM011';
  END IF;

  -- Tout déplacement de matériel est justifié par un ticket.
  IF t.ticket_obligatoire AND v_avec_materiel AND m.numero_ticket IS NULL THEN
    RAISE EXCEPTION 'N° de ticket obligatoire pour un mouvement de matériel « % »', t.libelle
      USING ERRCODE = 'GM006';
  END IF;
END $$;

-- Effet d'un mouvement sur le stock des articles.
--   p_signe :  1 = appliquer, -1 = retirer
--   p_mode  :  'COMPLET'   origine − quantité, destination + quantité
--              'ORIGINE'   origine − quantité seulement (envoi d'un transfert)
--              'RECEPTION' destination + quantité reçue seulement
-- Refuse tout résultat négatif avec un message clair. Ordre fixe des lignes :
-- deux validations simultanées ne peuvent pas s'interbloquer.
CREATE FUNCTION appliquer_stock(p_mouvement_id bigint, p_signe integer, p_mode text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r           record;
  v_dispo     numeric(14, 3);
  v_precedent text;
BEGIN
  v_precedent := drapeau('gm.maj_stock', 'oui');

  FOR r IN
    SELECT d.article_id, d.site_id, sum(d.delta) * p_signe AS delta,
           a.code, a.designation, s.code AS site_code
      FROM (SELECT article_id, site_source_id AS site_id, -quantite AS delta
              FROM lignes_mouvements
             WHERE mouvement_id = p_mouvement_id AND article_id IS NOT NULL AND site_source_id IS NOT NULL
               AND p_mode IN ('COMPLET', 'ORIGINE')
            UNION ALL
            SELECT article_id, site_destination_id, quantite
              FROM lignes_mouvements
             WHERE mouvement_id = p_mouvement_id AND article_id IS NOT NULL AND site_destination_id IS NOT NULL
               AND p_mode = 'COMPLET'
            UNION ALL
            SELECT article_id, site_destination_id, coalesce(quantite_recue, 0)
              FROM lignes_mouvements
             WHERE mouvement_id = p_mouvement_id AND article_id IS NOT NULL AND site_destination_id IS NOT NULL
               AND p_mode = 'RECEPTION') d
      JOIN articles a ON a.id = d.article_id
      JOIN sites s ON s.id = d.site_id
     GROUP BY d.article_id, d.site_id, a.code, a.designation, s.code
     ORDER BY d.article_id, d.site_id
  LOOP
    CONTINUE WHEN r.delta = 0;

    SELECT quantite INTO v_dispo
      FROM stocks_articles
     WHERE article_id = r.article_id AND site_id = r.site_id
       FOR UPDATE;
    v_dispo := coalesce(v_dispo, 0);

    IF v_dispo + r.delta < 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'GM001',
        MESSAGE = format('Stock insuffisant pour %s — %s sur le site %s : disponible %s, demandé %s%s',
                         r.code, r.designation, r.site_code, trim_scale(v_dispo), trim_scale(-r.delta),
                         CASE WHEN p_signe < 0 THEN ' (annulation impossible : cette quantité est déjà sortie)'
                              ELSE '' END);
    END IF;

    IF r.delta > 0 THEN
      INSERT INTO stocks_articles AS s (article_id, site_id, quantite)
      VALUES (r.article_id, r.site_id, r.delta)
      ON CONFLICT (article_id, site_id) DO UPDATE SET quantite = s.quantite + EXCLUDED.quantite;
    ELSE
      -- Une baisse porte toujours sur une ligne existante (verrouillée ci-dessus) :
      -- une insertion à valeur négative serait refusée avant même le conflit.
      UPDATE stocks_articles SET quantite = quantite + r.delta
       WHERE article_id = r.article_id AND site_id = r.site_id;
    END IF;
  END LOOP;

  PERFORM drapeau('gm.maj_stock', v_precedent);
END $$;

-- Effet d'un mouvement sur la fiche des matériels qu'il porte.
--   p_evenement : 'VALIDATION', 'ANNULATION' ou 'RECEPTION' (d'un transfert)
CREATE FUNCTION appliquer_effets_materiels(p_mouvement_id bigint, p_evenement text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  m             mouvements%ROWTYPE;
  t             types_mouvements%ROWTYPE;
  l             lignes_mouvements%ROWTYPE;
  v_mat         materiels%ROWTYPE;
  v_nouveau     text;
  v_prec_mat    text;
  v_prec_int    text;
  v_prec_com    text;
BEGIN
  SELECT * INTO m FROM mouvements WHERE id = p_mouvement_id;
  SELECT * INTO t FROM types_mouvements WHERE code = m.type_code;
  v_prec_mat := drapeau('gm.maj_materiel', 'oui');
  v_prec_int := drapeau('gm.interne', 'oui');
  v_prec_com := coalesce(current_setting('app.commentaire', true), '');

  FOR l IN SELECT * FROM lignes_mouvements
            WHERE mouvement_id = p_mouvement_id AND materiel_id IS NOT NULL
            ORDER BY materiel_id
  LOOP
    SELECT * INTO v_mat FROM materiels WHERE id = l.materiel_id FOR UPDATE;
    v_nouveau := CASE m.type_code WHEN 'PERTE'         THEN 'PERDU'
                                  WHEN 'MISE_AU_REBUT' THEN 'REFORME'
                                  WHEN 'TRANSFERT'     THEN 'EN_TRANSIT' END;

    IF p_evenement = 'VALIDATION' THEN
      IF l.site_source_id IS NOT NULL AND v_mat.site_id <> l.site_source_id THEN
        RAISE EXCEPTION 'Le matériel % ne se trouve pas sur le site d''origine indiqué', v_mat.code
          USING ERRCODE = 'GM004';
      END IF;
      IF t.sens = 'ENTREE' AND m.type_code <> 'RETOUR_AFFECTATION' AND v_mat.site_id <> l.site_destination_id THEN
        RAISE EXCEPTION 'La fiche du matériel % indique un autre site que celui de la réception', v_mat.code
          USING ERRCODE = 'GM004';
      END IF;
      IF m.type_code = 'AFFECTATION'
         AND (v_mat.statut <> 'DISPONIBLE' OR v_mat.etat NOT IN ('NEUF', 'BON', 'MOYEN')) THEN
        RAISE EXCEPTION 'Le matériel % ne peut pas être affecté (statut %, état %)', v_mat.code, v_mat.statut, v_mat.etat
          USING ERRCODE = 'GM008';
      ELSIF m.type_code = 'RETOUR_AFFECTATION' AND v_mat.statut <> 'AFFECTE' THEN
        RAISE EXCEPTION 'Le matériel % n''est pas affecté : pas de retour possible', v_mat.code
          USING ERRCODE = 'GM008';
      ELSIF v_nouveau IS NOT NULL AND v_mat.statut NOT IN ('DISPONIBLE', 'EN_REPARATION') THEN
        RAISE EXCEPTION 'Le matériel % est au statut % : %', v_mat.code, v_mat.statut,
          CASE WHEN v_mat.statut = 'AFFECTE' THEN 'enregistrez d''abord son retour' ELSE 'opération impossible' END
          USING ERRCODE = 'GM008';
      END IF;

      IF v_nouveau IS NOT NULL THEN
        UPDATE lignes_mouvements SET materiel_statut_avant = v_mat.statut WHERE id = l.id;
        PERFORM set_config('app.commentaire',
                           format('%s %s : %s', t.libelle, m.reference, m.motif), true);
        UPDATE materiels SET statut = v_nouveau WHERE id = v_mat.id;
      END IF;

    ELSIF p_evenement = 'ANNULATION' THEN
      IF t.sens = 'ENTREE' AND m.type_code <> 'RETOUR_AFFECTATION' THEN
        RAISE EXCEPTION 'Une réception de matériel ne s''annule pas : sortez le matériel % par une mise au rebut motivée',
          v_mat.code
          USING ERRCODE = 'GM002';
      ELSIF m.type_code = 'AFFECTATION'
            AND EXISTS (SELECT 1 FROM affectations WHERE mouvement_affectation_id = m.id) THEN
        RAISE EXCEPTION 'Ce mouvement porte l''affectation du matériel % : enregistrez son retour', v_mat.code
          USING ERRCODE = 'GM002';
      ELSIF m.type_code = 'RETOUR_AFFECTATION'
            AND EXISTS (SELECT 1 FROM affectations WHERE mouvement_retour_id = m.id) THEN
        RAISE EXCEPTION 'Ce retour clôt l''affectation du matériel % : il ne s''annule plus', v_mat.code
          USING ERRCODE = 'GM002';
      ELSIF l.materiel_statut_avant IS NOT NULL THEN
        IF v_mat.statut <> v_nouveau THEN
          RAISE EXCEPTION 'Le matériel % a changé de statut depuis ce mouvement : annulation impossible', v_mat.code
            USING ERRCODE = 'GM002';
        END IF;
        PERFORM set_config('app.commentaire',
                           format('Annulation de %s : %s', m.reference, m.motif_annulation), true);
        UPDATE materiels SET statut = l.materiel_statut_avant WHERE id = v_mat.id;
      END IF;

    ELSIF p_evenement = 'RECEPTION' THEN
      IF l.quantite_recue = 1 THEN
        PERFORM set_config('app.commentaire', format('Transfert %s reçu', m.reference), true);
        UPDATE materiels SET site_id = l.site_destination_id, statut = l.materiel_statut_avant WHERE id = v_mat.id;
      ELSE
        PERFORM set_config('app.commentaire',
                           format('Non reçu au transfert %s : %s', m.reference, m.motif_ecart), true);
        UPDATE materiels SET statut = 'PERDU' WHERE id = v_mat.id;
      END IF;
    END IF;
  END LOOP;

  PERFORM set_config('app.commentaire', v_prec_com, true);
  PERFORM drapeau('gm.interne', v_prec_int);
  PERFORM drapeau('gm.maj_materiel', v_prec_mat);
END $$;

CREATE FUNCTION trg_mouvements_avant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_champs_annulation text[] := ARRAY['statut', 'annule_par', 'annule_le', 'motif_annulation', 'modifie_le'];
  v_champs_reception  text[] := ARRAY['date_reception', 'recu_par', 'recu_le', 'motif_ecart', 'modifie_le'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un mouvement ne se supprime jamais (%) : annulez-le avec un motif', OLD.reference
      USING ERRCODE = 'GM003';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.statut <> 'BROUILLON' THEN
      RAISE EXCEPTION 'Un mouvement se crée en brouillon, puis se valide' USING ERRCODE = 'GM002';
    END IF;
    NEW.reference     := prochain_code(parametre('prefixe_mouvement'), 6);
    NEW.numero_ticket := nullif(btrim(NEW.numero_ticket), '');
    NEW.cree_par      := coalesce(NEW.cree_par, utilisateur_courant());
    NEW.cree_le       := now();
    NEW.modifie_le    := now();
    RETURN NEW;
  END IF;

  -- Modification
  IF OLD.statut = 'ANNULE' THEN
    RAISE EXCEPTION 'Le mouvement % est annulé : il ne se modifie plus', OLD.reference USING ERRCODE = 'GM002';
  END IF;
  IF NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.cree_par IS DISTINCT FROM OLD.cree_par
     OR NEW.cree_le IS DISTINCT FROM OLD.cree_le THEN
    RAISE EXCEPTION 'La référence et l''auteur d''un mouvement ne se modifient pas' USING ERRCODE = 'GM002';
  END IF;
  NEW.numero_ticket := nullif(btrim(NEW.numero_ticket), '');

  IF OLD.statut = 'VALIDE' THEN
    -- Réception d'un transfert, faite par receptionner_transfert().
    IF NEW.statut = 'VALIDE' AND drapeau_leve('gm.interne')
       AND (to_jsonb(NEW) - v_champs_reception) IS NOT DISTINCT FROM (to_jsonb(OLD) - v_champs_reception) THEN
      NEW.modifie_le := now();
      RETURN NEW;
    END IF;
    IF OLD.recu_le IS NOT NULL THEN
      RAISE EXCEPTION 'Le transfert % est reçu : il ne s''annule plus ; passez un transfert inverse', OLD.reference
        USING ERRCODE = 'GM002';
    END IF;
    IF NEW.statut <> 'ANNULE'
       OR (to_jsonb(NEW) - v_champs_annulation) IS DISTINCT FROM (to_jsonb(OLD) - v_champs_annulation) THEN
      RAISE EXCEPTION 'Le mouvement % est validé : on peut seulement l''annuler (avec un motif) ou passer un mouvement inverse',
        OLD.reference
        USING ERRCODE = 'GM002';
    END IF;
  END IF;

  IF OLD.statut = 'BROUILLON'
     AND (NEW.date_reception IS NOT NULL OR NEW.recu_par IS NOT NULL OR NEW.recu_le IS NOT NULL OR NEW.motif_ecart IS NOT NULL) THEN
    RAISE EXCEPTION 'La réception d''un transfert se fait après son envoi' USING ERRCODE = 'GM002';
  END IF;

  IF NEW.statut = 'ANNULE' THEN
    NEW.annule_par := coalesce(NEW.annule_par, utilisateur_courant());
    NEW.annule_le  := now();
  ELSIF OLD.statut = 'BROUILLON' AND NEW.statut = 'VALIDE' THEN
    NEW.valide_par := coalesce(NEW.valide_par, utilisateur_courant());
    NEW.valide_le  := now();
    PERFORM controler_mouvement(NEW);
  END IF;

  NEW.modifie_le := now();
  RETURN NEW;
END $$;

CREATE FUNCTION trg_mouvements_apres() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_mode text := CASE WHEN NEW.type_code = 'TRANSFERT' THEN 'ORIGINE' ELSE 'COMPLET' END;
BEGIN
  IF OLD.statut = 'BROUILLON' AND NEW.statut = 'VALIDE' THEN
    PERFORM appliquer_stock(NEW.id, 1, v_mode);
    PERFORM appliquer_effets_materiels(NEW.id, 'VALIDATION');
  ELSIF OLD.statut = 'VALIDE' AND NEW.statut = 'ANNULE' THEN
    PERFORM appliquer_stock(NEW.id, -1, v_mode);     -- transfert en route : retour à l'origine
    PERFORM appliquer_effets_materiels(NEW.id, 'ANNULATION');
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER mouvements_avant BEFORE INSERT OR UPDATE OR DELETE ON mouvements
  FOR EACH ROW EXECUTE FUNCTION trg_mouvements_avant();
CREATE TRIGGER mouvements_apres AFTER UPDATE OF statut ON mouvements
  FOR EACH ROW EXECUTE FUNCTION trg_mouvements_apres();
CREATE TRIGGER mouvements_pas_de_vidage BEFORE TRUNCATE ON mouvements
  FOR EACH STATEMENT EXECUTE FUNCTION trg_interdire_vidage();

CREATE FUNCTION trg_lignes_avant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_mvt mouvements%ROWTYPE;
  t     types_mouvements%ROWTYPE;
  v_champs_internes text[] := ARRAY['quantite_recue', 'materiel_statut_avant'];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.mouvement_id <> OLD.mouvement_id THEN
    RAISE EXCEPTION 'Une ligne ne change pas de mouvement' USING ERRCODE = 'GM002';
  END IF;

  -- Verrou partagé sur l'en-tête : une validation en cours attend la fin de la
  -- saisie, et une ligne ne peut pas se glisser dans un mouvement qui se valide.
  SELECT * INTO v_mvt FROM mouvements
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.mouvement_id ELSE NEW.mouvement_id END
     FOR SHARE;

  IF v_mvt.statut <> 'BROUILLON' THEN
    -- Seules les colonnes tenues par la base changent encore, et par la base seule.
    IF TG_OP = 'UPDATE' AND drapeau_leve('gm.interne')
       AND (to_jsonb(NEW) - v_champs_internes) IS NOT DISTINCT FROM (to_jsonb(OLD) - v_champs_internes) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Le mouvement % est % : ses lignes ne se modifient plus', v_mvt.reference,
      CASE v_mvt.statut WHEN 'VALIDE' THEN 'validé' ELSE 'annulé' END
      USING ERRCODE = 'GM002';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  NEW.quantite_recue        := NULL;    -- remplies par la base, jamais à la saisie
  NEW.materiel_statut_avant := NULL;
  SELECT * INTO t FROM types_mouvements WHERE code = v_mvt.type_code;
  PERFORM controler_ligne(NEW, t);
  RETURN NEW;
END $$;

CREATE TRIGGER lignes_avant BEFORE INSERT OR UPDATE OR DELETE ON lignes_mouvements
  FOR EACH ROW EXECUTE FUNCTION trg_lignes_avant();
CREATE TRIGGER lignes_pas_de_vidage BEFORE TRUNCATE ON lignes_mouvements
  FOR EACH STATEMENT EXECUTE FUNCTION trg_interdire_vidage();

-- Réception d'un transfert par le site de destination.
--   p_quantites : [{"ligne_id": 12, "quantite_recue": 4}, …] pour les lignes
--                 arrivées incomplètes ; les autres lignes sont reçues en entier.
--   p_motif_ecart : obligatoire dès qu'une quantité manque.
-- Le manquant n'entre dans aucun stock : il est tracé comme écart de transfert ;
-- un matériel non arrivé passe au statut « perdu ».
CREATE FUNCTION receptionner_transfert(p_mouvement_id bigint,
                                       p_quantites jsonb DEFAULT '[]'::jsonb,
                                       p_motif_ecart text DEFAULT NULL,
                                       p_date_reception date DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  m           mouvements%ROWTYPE;
  e           jsonb;
  l           record;
  v_date      date := coalesce(p_date_reception, aujourdhui());
  v_ecart     boolean;
  v_prec_int  text;
BEGIN
  SELECT * INTO m FROM mouvements WHERE id = p_mouvement_id FOR UPDATE;
  IF NOT FOUND OR m.type_code <> 'TRANSFERT' THEN
    RAISE EXCEPTION 'Seul un transfert se réceptionne' USING ERRCODE = 'GM004';
  END IF;
  IF m.statut <> 'VALIDE' THEN
    RAISE EXCEPTION 'Le transfert % n''est pas en route (statut %)', m.reference, m.statut USING ERRCODE = 'GM002';
  END IF;
  IF m.recu_le IS NOT NULL THEN
    RAISE EXCEPTION 'Le transfert % est déjà reçu', m.reference USING ERRCODE = 'GM002';
  END IF;
  IF v_date > aujourdhui() OR v_date < m.date_mouvement THEN
    RAISE EXCEPTION 'Date de réception non valable (%) : entre l''envoi (%) et aujourd''hui',
      to_char(v_date, 'DD/MM/YYYY'), to_char(m.date_mouvement, 'DD/MM/YYYY')
      USING ERRCODE = 'GM007';
  END IF;

  v_prec_int := drapeau('gm.interne', 'oui');

  UPDATE lignes_mouvements SET quantite_recue = quantite WHERE mouvement_id = m.id;
  FOR e IN SELECT * FROM jsonb_array_elements(coalesce(p_quantites, '[]'::jsonb)) LOOP
    UPDATE lignes_mouvements SET quantite_recue = (e ->> 'quantite_recue')::numeric
     WHERE id = (e ->> 'ligne_id')::bigint AND mouvement_id = m.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La ligne % n''appartient pas au transfert %', e ->> 'ligne_id', m.reference
        USING ERRCODE = 'GM004';
    END IF;
  END LOOP;

  FOR l IN SELECT lm.quantite_recue, lm.materiel_id, a.code, u.decimales
             FROM lignes_mouvements lm
             LEFT JOIN articles a ON a.id = lm.article_id
             LEFT JOIN unites u ON u.code = a.unite_code
            WHERE lm.mouvement_id = m.id
  LOOP
    IF (l.materiel_id IS NOT NULL AND l.quantite_recue NOT IN (0, 1))
       OR (l.materiel_id IS NULL AND l.quantite_recue <> round(l.quantite_recue, l.decimales)) THEN
      RAISE EXCEPTION 'Quantité reçue % non conforme pour %', trim_scale(l.quantite_recue), coalesce(l.code, 'un matériel')
        USING ERRCODE = 'GM005';
    END IF;
  END LOOP;

  v_ecart := EXISTS (SELECT 1 FROM lignes_mouvements WHERE mouvement_id = m.id AND quantite_recue < quantite);
  IF v_ecart AND length(btrim(coalesce(p_motif_ecart, ''))) < 3 THEN
    RAISE EXCEPTION 'Motif obligatoire : la quantité reçue est inférieure à la quantité envoyée' USING ERRCODE = 'GM006';
  END IF;

  UPDATE mouvements
     SET date_reception = v_date,
         recu_par       = utilisateur_courant(),
         recu_le        = now(),
         motif_ecart    = CASE WHEN v_ecart THEN btrim(p_motif_ecart) END
   WHERE id = m.id;

  PERFORM appliquer_stock(m.id, 1, 'RECEPTION');
  PERFORM appliquer_effets_materiels(m.id, 'RECEPTION');
  PERFORM drapeau('gm.interne', v_prec_int);
END $$;

-- =====================================================================
-- 8. Affectations et retours
-- =====================================================================

CREATE TABLE affectations (
  id                       bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  materiel_id              bigint NOT NULL REFERENCES materiels (id),
  employe_id               bigint NOT NULL REFERENCES employes (id),
  numero_contrat           text NOT NULL CONSTRAINT affectations_contrat_non_vide CHECK (btrim(numero_contrat) <> ''),
  date_remise              date NOT NULL DEFAULT aujourdhui(),
  date_retour_prevue       date NOT NULL,      -- d'après le contrat ; prolongeable tant que l'affectation est en cours
  etat_remise              text NOT NULL CONSTRAINT affectations_etat_remise CHECK (etat_remise IN ('NEUF', 'BON', 'MOYEN')),
  remis_par                bigint NOT NULL REFERENCES utilisateurs (id),
  observations_remise      text,
  preuve_remise_url        text,     -- décharge signée, sur un stockage externe
  mouvement_affectation_id bigint NOT NULL REFERENCES mouvements (id),
  date_retour              date,
  etat_retour              text CONSTRAINT affectations_etat_retour
                             CHECK (etat_retour IN ('NEUF', 'BON', 'MOYEN', 'ENDOMMAGE', 'HORS_SERVICE')),
  recu_par                 bigint REFERENCES utilisateurs (id),
  observations_retour      text,
  mouvement_retour_id      bigint REFERENCES mouvements (id),
  cree_le                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affectations_prevue_apres_remise CHECK (date_retour_prevue >= date_remise),
  CONSTRAINT affectations_retour_apres_remise CHECK (date_retour IS NULL OR date_retour >= date_remise),
  CONSTRAINT affectations_retour_complet CHECK (
    (date_retour IS NULL AND etat_retour IS NULL AND recu_par IS NULL AND mouvement_retour_id IS NULL)
    OR (date_retour IS NOT NULL AND etat_retour IS NOT NULL AND recu_par IS NOT NULL AND mouvement_retour_id IS NOT NULL))
);
-- Un matériel ne peut avoir qu'une seule affectation en cours.
CREATE UNIQUE INDEX affectations_une_en_cours_uk ON affectations (materiel_id) WHERE date_retour IS NULL;
CREATE INDEX affectations_employe_idx ON affectations (employe_id);
CREATE INDEX affectations_materiel_idx ON affectations (materiel_id, date_remise DESC);
CREATE INDEX affectations_retour_prevu_idx ON affectations (date_retour_prevue) WHERE date_retour IS NULL;

-- Statut d'un matériel après son retour, selon l'état constaté.
CREATE FUNCTION statut_apres_retour(p_etat text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_etat WHEN 'ENDOMMAGE'    THEN 'EN_REPARATION'
                     WHEN 'HORS_SERVICE' THEN 'REFORME'
                     ELSE 'DISPONIBLE' END
$$;

CREATE FUNCTION trg_affectations_avant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_mat     materiels%ROWTYPE;
  v_actif   boolean;
  v_type    text;
  v_statut  text;
  v_employe bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une affectation ne se supprime pas : elle se clôt par un retour' USING ERRCODE = 'GM003';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_mat FROM materiels WHERE id = NEW.materiel_id FOR UPDATE;
    IF v_mat.statut <> 'DISPONIBLE' THEN
      RAISE EXCEPTION 'Le matériel % n''est pas disponible (statut : %)', v_mat.code, v_mat.statut
        USING ERRCODE = 'GM008';
    END IF;
    IF v_mat.etat NOT IN ('NEUF', 'BON', 'MOYEN') THEN
      RAISE EXCEPTION 'Le matériel % est en état % : il ne peut pas être remis', v_mat.code, v_mat.etat
        USING ERRCODE = 'GM008';
    END IF;
    SELECT actif INTO v_actif FROM employes WHERE id = NEW.employe_id;
    IF NOT v_actif THEN
      RAISE EXCEPTION 'L''employé choisi n''est plus actif' USING ERRCODE = 'GM008';
    END IF;
    SELECT type_code, statut, employe_beneficiaire_id INTO v_type, v_statut, v_employe
      FROM mouvements WHERE id = NEW.mouvement_affectation_id;
    IF v_type IS DISTINCT FROM 'AFFECTATION' OR v_statut IS DISTINCT FROM 'VALIDE'
       OR v_employe IS DISTINCT FROM NEW.employe_id
       OR NOT EXISTS (SELECT 1 FROM lignes_mouvements
                       WHERE mouvement_id = NEW.mouvement_affectation_id AND materiel_id = NEW.materiel_id) THEN
      RAISE EXCEPTION 'Une affectation s''appuie sur un mouvement « Affectation » validé, pour ce matériel et cet employé'
        USING ERRCODE = 'GM004';
    END IF;
    IF NEW.date_remise > aujourdhui() THEN
      RAISE EXCEPTION 'La date de remise est dans le futur' USING ERRCODE = 'GM007';
    END IF;
    IF NEW.date_retour IS NOT NULL THEN
      RAISE EXCEPTION 'Une affectation se crée en cours ; le retour s''enregistre ensuite' USING ERRCODE = 'GM006';
    END IF;
    NEW.remis_par := coalesce(NEW.remis_par, utilisateur_courant());
    NEW.cree_le   := now();
    RETURN NEW;
  END IF;

  -- Modification : seule une affectation en cours change (prolongation du
  -- contrat, puis retour) ; les informations de remise sont figées.
  IF OLD.date_retour IS NOT NULL THEN
    RAISE EXCEPTION 'Cette affectation est close : elle ne se modifie plus' USING ERRCODE = 'GM002';
  END IF;
  IF (NEW.materiel_id, NEW.employe_id, NEW.date_remise, NEW.etat_remise, NEW.remis_par,
      NEW.mouvement_affectation_id, NEW.cree_le)
     IS DISTINCT FROM
     (OLD.materiel_id, OLD.employe_id, OLD.date_remise, OLD.etat_remise, OLD.remis_par,
      OLD.mouvement_affectation_id, OLD.cree_le) THEN
    RAISE EXCEPTION 'Les informations de remise ne se modifient pas' USING ERRCODE = 'GM002';
  END IF;
  IF NEW.date_retour IS NOT NULL THEN
    IF NEW.date_retour > aujourdhui() THEN
      RAISE EXCEPTION 'La date de retour est dans le futur' USING ERRCODE = 'GM007';
    END IF;
    IF NEW.etat_retour IN ('ENDOMMAGE', 'HORS_SERVICE') AND length(btrim(coalesce(NEW.observations_retour, ''))) < 3 THEN
      RAISE EXCEPTION 'Observations obligatoires pour un retour en état %', NEW.etat_retour USING ERRCODE = 'GM006';
    END IF;
    SELECT type_code, statut INTO v_type, v_statut FROM mouvements WHERE id = NEW.mouvement_retour_id;
    IF v_type IS DISTINCT FROM 'RETOUR_AFFECTATION' OR v_statut IS DISTINCT FROM 'VALIDE'
       OR NOT EXISTS (SELECT 1 FROM lignes_mouvements
                       WHERE mouvement_id = NEW.mouvement_retour_id AND materiel_id = NEW.materiel_id) THEN
      RAISE EXCEPTION 'Un retour s''appuie sur un mouvement « Retour d''affectation » validé, pour ce matériel'
        USING ERRCODE = 'GM004';
    END IF;
    NEW.recu_par := coalesce(NEW.recu_par, utilisateur_courant());
  END IF;
  RETURN NEW;
END $$;

-- La fiche du matériel suit l'affectation : « affecté » à la remise ; au
-- retour, état constaté, statut selon cet état et site de retour.
CREATE FUNCTION trg_affectations_apres() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_prec_mat text;
  v_prec_com text := coalesce(current_setting('app.commentaire', true), '');
  v_employe  text;
  v_site     bigint;
BEGIN
  v_prec_mat := drapeau('gm.maj_materiel', 'oui');

  IF TG_OP = 'INSERT' THEN
    SELECT concat_ws(' ', nom, prenoms) INTO v_employe FROM employes WHERE id = NEW.employe_id;
    PERFORM set_config('app.commentaire',
                       format('Remis à %s — contrat %s, retour prévu le %s', v_employe, NEW.numero_contrat,
                              to_char(NEW.date_retour_prevue, 'DD/MM/YYYY')), true);
    UPDATE materiels SET statut = 'AFFECTE' WHERE id = NEW.materiel_id;

  ELSIF OLD.date_retour IS NULL AND NEW.date_retour IS NOT NULL THEN
    SELECT site_destination_id INTO v_site
      FROM lignes_mouvements WHERE mouvement_id = NEW.mouvement_retour_id AND materiel_id = NEW.materiel_id;
    PERFORM set_config('app.commentaire',
                       coalesce(nullif(btrim(NEW.observations_retour), ''), 'Retour d''affectation'), true);
    UPDATE materiels
       SET etat = NEW.etat_retour, statut = statut_apres_retour(NEW.etat_retour), site_id = v_site
     WHERE id = NEW.materiel_id;
  END IF;

  PERFORM set_config('app.commentaire', v_prec_com, true);
  PERFORM drapeau('gm.maj_materiel', v_prec_mat);
  RETURN NULL;
END $$;

CREATE TRIGGER affectations_avant BEFORE INSERT OR UPDATE OR DELETE ON affectations
  FOR EACH ROW EXECUTE FUNCTION trg_affectations_avant();
CREATE TRIGGER affectations_apres AFTER INSERT OR UPDATE ON affectations
  FOR EACH ROW EXECUTE FUNCTION trg_affectations_apres();
CREATE TRIGGER affectations_pas_de_vidage BEFORE TRUNCATE ON affectations
  FOR EACH STATEMENT EXECUTE FUNCTION trg_interdire_vidage();

-- =====================================================================
-- 9. Historiques
-- =====================================================================

CREATE TABLE historiques_etats (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  materiel_id     bigint NOT NULL REFERENCES materiels (id),
  ancien_etat     text,
  nouvel_etat     text NOT NULL,
  ancien_statut   text,
  nouveau_statut  text NOT NULL,
  date_changement timestamptz NOT NULL DEFAULT now(),
  auteur_id       bigint NOT NULL REFERENCES utilisateurs (id),
  commentaire     text
);
CREATE INDEX historiques_etats_materiel_idx ON historiques_etats (materiel_id, date_changement DESC);

CREATE TRIGGER historiques_etats_fige BEFORE UPDATE OR DELETE ON historiques_etats
  FOR EACH ROW EXECUTE FUNCTION trg_historique_fige();
CREATE TRIGGER historiques_etats_pas_de_vidage BEFORE TRUNCATE ON historiques_etats
  FOR EACH STATEMENT EXECUTE FUNCTION trg_historique_fige();

-- Journal des opérations sensibles, écrit par le serveur : connexions, échecs
-- de connexion, créations, modifications, validations, annulations, exports,
-- impressions d'étiquettes…
CREATE TABLE historique_actions (
  id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  date_action    timestamptz NOT NULL DEFAULT now(),
  utilisateur_id bigint REFERENCES utilisateurs (id),     -- vide pour une connexion avec un compte inconnu
  action         text NOT NULL CONSTRAINT historique_actions_action CHECK (action ~ '^[A-Z_]{3,40}$'),
  entite         text,
  entite_id      bigint,
  metadonnees    jsonb NOT NULL DEFAULT '{}'::jsonb,
  adresse_ip     inet
);
CREATE INDEX historique_actions_date_idx ON historique_actions (date_action DESC);
CREATE INDEX historique_actions_entite_idx ON historique_actions (entite, entite_id);
CREATE INDEX historique_actions_utilisateur_idx ON historique_actions (utilisateur_id, date_action DESC);

CREATE TRIGGER historique_actions_fige BEFORE UPDATE OR DELETE ON historique_actions
  FOR EACH ROW EXECUTE FUNCTION trg_historique_fige();
CREATE TRIGGER historique_actions_pas_de_vidage BEFORE TRUNCATE ON historique_actions
  FOR EACH STATEMENT EXECUTE FUNCTION trg_historique_fige();

-- =====================================================================
-- 10. Sessions de connexion (format attendu par connect-pg-simple,
--     option tableName: 'sessions')
-- =====================================================================

CREATE TABLE sessions (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX sessions_expire_idx ON sessions (expire);

-- =====================================================================
-- 11. Vues de lecture (listes, tableau de bord, rapports, contrôles)
-- =====================================================================

-- Matériels avec leur responsable du moment (affectation en cours).
CREATE VIEW v_materiels AS
SELECT m.id, m.code, m.designation,
       m.categorie_id, c.nom AS categorie,
       m.marque, m.modele, m.numero_serie, m.date_achat, m.prix_achat, m.fournisseur,
       m.site_id, s.code AS site_code, s.nom AS site,
       m.service_id, sv.nom AS service,
       m.etat, m.statut,
       af.id AS affectation_id,
       af.employe_id AS responsable_id,
       e.matricule AS responsable_matricule,
       CASE WHEN e.id IS NOT NULL THEN concat_ws(' ', e.nom, e.prenoms) END AS responsable,
       af.numero_contrat, af.date_remise, af.date_retour_prevue,
       coalesce(af.date_retour_prevue < aujourdhui(), false) AS retour_en_retard,
       m.etiquette_imprimee_le, m.photo_url, m.observations, m.cree_le, m.modifie_le
  FROM materiels m
  JOIN categories c ON c.id = m.categorie_id
  JOIN sites s ON s.id = m.site_id
  LEFT JOIN services sv ON sv.id = m.service_id
  LEFT JOIN affectations af ON af.materiel_id = m.id AND af.date_retour IS NULL
  LEFT JOIN employes e ON e.id = af.employe_id;

-- Lignes de transferts envoyés et pas encore reçus.
CREATE VIEW v_transferts_en_route AS
SELECT mv.id AS mouvement_id, mv.reference, mv.numero_ticket,
       mv.date_mouvement AS date_envoi, aujourdhui() - mv.date_mouvement AS jours_en_route,
       l.id AS ligne_id,
       CASE WHEN l.article_id IS NOT NULL THEN 'ARTICLE' ELSE 'MATERIEL' END AS nature,
       l.article_id, l.materiel_id,
       coalesce(a.code, ma.code) AS code_bien,
       coalesce(a.designation, ma.designation) AS designation,
       l.quantite, a.unite_code,
       l.site_source_id, so.code AS site_origine,
       l.site_destination_id, sd.code AS site_destination,
       uv.nom AS envoye_par, mv.motif
  FROM mouvements mv
  JOIN lignes_mouvements l ON l.mouvement_id = mv.id
  LEFT JOIN articles a ON a.id = l.article_id
  LEFT JOIN materiels ma ON ma.id = l.materiel_id
  JOIN sites so ON so.id = l.site_source_id
  JOIN sites sd ON sd.id = l.site_destination_id
  JOIN utilisateurs uv ON uv.id = mv.valide_par
 WHERE mv.type_code = 'TRANSFERT' AND mv.statut = 'VALIDE' AND mv.recu_le IS NULL;

-- Manquants constatés à la réception des transferts.
CREATE VIEW v_ecarts_transferts AS
SELECT mv.id AS mouvement_id, mv.reference, mv.numero_ticket,
       mv.date_mouvement AS date_envoi, mv.date_reception,
       l.id AS ligne_id, l.article_id, l.materiel_id,
       coalesce(a.code, ma.code) AS code_bien,
       coalesce(a.designation, ma.designation) AS designation,
       l.quantite AS quantite_envoyee, l.quantite_recue, l.quantite - l.quantite_recue AS quantite_manquante,
       a.unite_code, so.code AS site_origine, sd.code AS site_destination,
       mv.motif_ecart, ur.nom AS recu_par
  FROM mouvements mv
  JOIN lignes_mouvements l ON l.mouvement_id = mv.id
  LEFT JOIN articles a ON a.id = l.article_id
  LEFT JOIN materiels ma ON ma.id = l.materiel_id
  JOIN sites so ON so.id = l.site_source_id
  JOIN sites sd ON sd.id = l.site_destination_id
  JOIN utilisateurs ur ON ur.id = mv.recu_par
 WHERE mv.type_code = 'TRANSFERT' AND mv.recu_le IS NOT NULL AND l.quantite_recue < l.quantite;

-- Affectations dont la date de retour prévue au contrat est dépassée.
CREATE VIEW v_affectations_en_retard AS
SELECT af.id AS affectation_id, m.id AS materiel_id, m.code, m.designation,
       e.id AS employe_id, e.matricule, concat_ws(' ', e.nom, e.prenoms) AS employe, e.service_id,
       af.numero_contrat, af.date_remise, af.date_retour_prevue,
       aujourdhui() - af.date_retour_prevue AS jours_de_retard
  FROM affectations af
  JOIN materiels m ON m.id = af.materiel_id
  JOIN employes e ON e.id = af.employe_id
 WHERE af.date_retour IS NULL AND af.date_retour_prevue < aujourdhui();

-- Stock total par article, quantité en route et alerte sur le seuil global
-- (seuil 0 = pas de seuil suivi).
CREATE VIEW v_stock_articles AS
WITH stock AS (
  SELECT article_id, sum(quantite) AS quantite FROM stocks_articles GROUP BY article_id
), en_route AS (
  SELECT article_id, sum(quantite) AS quantite FROM v_transferts_en_route
   WHERE article_id IS NOT NULL GROUP BY article_id
)
SELECT a.id AS article_id, a.code, a.designation,
       a.categorie_id, c.nom AS categorie,
       a.unite_code, u.libelle AS unite, u.symbole,
       a.seuil_minimum,
       coalesce(s.quantite, 0) AS quantite_disponible,
       coalesce(r.quantite, 0) AS quantite_en_route,
       coalesce(s.quantite, 0) = 0 AS en_rupture,
       a.seuil_minimum > 0 AND coalesce(s.quantite, 0) <= a.seuil_minimum AS alerte_stock_faible,
       a.site_stockage_id, a.emplacement, a.actif
  FROM articles a
  JOIN categories c ON c.id = a.categorie_id
  JOIN unites u ON u.code = a.unite_code
  LEFT JOIN stock s ON s.article_id = a.id
  LEFT JOIN en_route r ON r.article_id = a.id;

-- Stock par article et par site, avec le seuil propre au site s'il existe.
CREATE VIEW v_stock_articles_sites AS
SELECT a.id AS article_id, a.code, a.designation, a.unite_code, a.actif,
       si.id AS site_id, si.code AS site_code, si.nom AS site,
       coalesce(st.quantite, 0) AS quantite,
       se.seuil_minimum AS seuil_site,
       se.seuil_minimum IS NOT NULL AND coalesce(st.quantite, 0) <= se.seuil_minimum AS alerte_site,
       st.modifie_le
  FROM (SELECT article_id, site_id FROM stocks_articles
        UNION
        SELECT article_id, site_id FROM seuils_articles_sites) k
  JOIN articles a ON a.id = k.article_id
  JOIN sites si ON si.id = k.site_id
  LEFT JOIN stocks_articles st ON st.article_id = k.article_id AND st.site_id = k.site_id
  LEFT JOIN seuils_articles_sites se ON se.article_id = k.article_id AND se.site_id = k.site_id;

-- Toutes les alertes de stock faible : globales et par site (tableau de bord).
CREATE VIEW v_alertes_stock AS
SELECT 'GLOBAL' AS portee, article_id, code, designation, unite_code,
       NULL::bigint AS site_id, NULL::text AS site_code,
       quantite_disponible AS quantite, seuil_minimum AS seuil, en_rupture
  FROM v_stock_articles
 WHERE actif AND alerte_stock_faible
UNION ALL
SELECT 'SITE', article_id, code, designation, unite_code,
       site_id, site_code, quantite, seuil_site, quantite = 0
  FROM v_stock_articles_sites
 WHERE actif AND alerte_site;

-- Une ligne par bien déplacé : base des écrans Mouvements et des exports.
CREATE VIEW v_mouvements_lignes AS
SELECT mv.id AS mouvement_id, mv.reference, mv.date_mouvement,
       mv.type_code, t.libelle AS type, t.sens, mv.statut,
       CASE WHEN t.sens = 'TRANSFERT' AND mv.statut = 'VALIDE'
            THEN CASE WHEN mv.recu_le IS NULL THEN 'EN_ROUTE' ELSE 'RECU' END END AS etat_transfert,
       mv.numero_ticket,
       l.id AS ligne_id,
       CASE WHEN l.article_id IS NOT NULL THEN 'ARTICLE' ELSE 'MATERIEL' END AS nature,
       l.article_id, l.materiel_id,
       coalesce(a.code, m.code) AS code_bien,
       coalesce(a.designation, m.designation) AS designation,
       coalesce(a.categorie_id, m.categorie_id) AS categorie_id,
       l.quantite, l.quantite_recue, a.unite_code,
       l.site_source_id, so.code AS site_origine,
       l.site_destination_id, sd.code AS site_destination,
       mv.origine, mv.motif, mv.reference_externe,
       mv.employe_beneficiaire_id,
       CASE WHEN e.id IS NOT NULL THEN concat_ws(' ', e.nom, e.prenoms) END AS employe_beneficiaire,
       mv.service_beneficiaire_id, sv.nom AS service_beneficiaire,
       mv.mouvement_corrige_id, uz.nom AS autorise_par,
       uc.nom AS cree_par, mv.cree_le,
       uv.nom AS valide_par, mv.valide_le,
       mv.date_reception, ur.nom AS recu_par, mv.motif_ecart,
       ua.nom AS annule_par, mv.annule_le, mv.motif_annulation
  FROM mouvements mv
  JOIN types_mouvements t ON t.code = mv.type_code
  JOIN lignes_mouvements l ON l.mouvement_id = mv.id
  LEFT JOIN articles a ON a.id = l.article_id
  LEFT JOIN materiels m ON m.id = l.materiel_id
  LEFT JOIN sites so ON so.id = l.site_source_id
  LEFT JOIN sites sd ON sd.id = l.site_destination_id
  LEFT JOIN employes e ON e.id = mv.employe_beneficiaire_id
  LEFT JOIN services sv ON sv.id = mv.service_beneficiaire_id
  JOIN utilisateurs uc ON uc.id = mv.cree_par
  LEFT JOIN utilisateurs uz ON uz.id = mv.autorise_par
  LEFT JOIN utilisateurs uv ON uv.id = mv.valide_par
  LEFT JOIN utilisateurs ur ON ur.id = mv.recu_par
  LEFT JOIN utilisateurs ua ON ua.id = mv.annule_par;

-- Contrôle : le stock tenu doit égaler le stock recalculé à partir des
-- mouvements validés (un transfert n'entre à destination que pour la quantité
-- reçue). Cette vue doit toujours être vide.
CREATE VIEW v_controle_stocks AS
WITH calcule AS (
  SELECT article_id, site_id, sum(delta) AS quantite_calculee
    FROM (SELECT l.article_id, l.site_source_id AS site_id, -l.quantite AS delta
            FROM lignes_mouvements l JOIN mouvements m ON m.id = l.mouvement_id
           WHERE m.statut = 'VALIDE' AND l.article_id IS NOT NULL AND l.site_source_id IS NOT NULL
          UNION ALL
          SELECT l.article_id, l.site_destination_id,
                 CASE WHEN m.type_code = 'TRANSFERT' THEN coalesce(l.quantite_recue, 0) ELSE l.quantite END
            FROM lignes_mouvements l JOIN mouvements m ON m.id = l.mouvement_id
           WHERE m.statut = 'VALIDE' AND l.article_id IS NOT NULL AND l.site_destination_id IS NOT NULL) d
   GROUP BY article_id, site_id
)
SELECT coalesce(st.article_id, c.article_id) AS article_id,
       coalesce(st.site_id, c.site_id) AS site_id,
       coalesce(st.quantite, 0) AS quantite_tenue,
       coalesce(c.quantite_calculee, 0) AS quantite_calculee
  FROM stocks_articles st
  FULL JOIN calcule c ON c.article_id = st.article_id AND c.site_id = st.site_id
 WHERE coalesce(st.quantite, 0) <> coalesce(c.quantite_calculee, 0);

-- Contrôle : le statut des matériels va avec les affectations en cours et les
-- transferts en route. Cette vue doit toujours être vide.
CREATE VIEW v_controle_materiels AS
SELECT m.id AS materiel_id, m.code, m.statut, 'Statut affecté sans affectation en cours' AS anomalie
  FROM materiels m
 WHERE m.statut = 'AFFECTE'
   AND NOT EXISTS (SELECT 1 FROM affectations af WHERE af.materiel_id = m.id AND af.date_retour IS NULL)
UNION ALL
SELECT m.id, m.code, m.statut, 'Affectation en cours alors que le statut n''est pas « affecté »'
  FROM materiels m
 WHERE m.statut <> 'AFFECTE'
   AND EXISTS (SELECT 1 FROM affectations af WHERE af.materiel_id = m.id AND af.date_retour IS NULL)
UNION ALL
SELECT m.id, m.code, m.statut, 'Statut « en transit » sans transfert en route'
  FROM materiels m
 WHERE m.statut = 'EN_TRANSIT'
   AND NOT EXISTS (SELECT 1 FROM v_transferts_en_route r WHERE r.materiel_id = m.id)
UNION ALL
SELECT m.id, m.code, m.statut, 'Transfert en route alors que le statut n''est pas « en transit »'
  FROM materiels m
 WHERE m.statut <> 'EN_TRANSIT'
   AND EXISTS (SELECT 1 FROM v_transferts_en_route r WHERE r.materiel_id = m.id);

-- =====================================================================

INSERT INTO schema_migrations (version, description)
VALUES ('0001', 'Schéma initial : référentiels, matériels, articles, seuils, mouvements, transferts en deux temps, '
                'affectations sous contrat, historiques');

COMMIT;
