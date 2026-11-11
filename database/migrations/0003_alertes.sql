-- =====================================================================
--  0003 — Suivi du parc : délais d'alerte et réparations en cours
--  (phase 7, décisions du 11/11/2026)
--  - Trois délais d'alerte, modifiables par l'administrateur :
--    transfert en route depuis 3 jours, réparation depuis 30 jours,
--    retour prévu dans les 7 jours.
--  - Vue des matériels en réparation, avec la date de départ en réparation
--    (lue dans l'historique des états).
--  Appliquée par « npm run db:migrer », dans une transaction.
-- =====================================================================

CREATE OR REPLACE FUNCTION trg_parametres_controle() RETURNS trigger
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
  ELSIF NEW.cle IN ('alerte_transfert_jours', 'alerte_reparation_jours', 'alerte_retour_jours')
        AND (NEW.valeur !~ '^[0-9]{1,3}$' OR NEW.valeur::int > 365) THEN
    RAISE EXCEPTION 'Délai d''alerte : un nombre entier de jours, entre 0 et 365' USING ERRCODE = 'GM006';
  ELSIF NEW.cle = 'signalements_actifs' AND NEW.valeur NOT IN ('oui', 'non') THEN
    RAISE EXCEPTION 'Valeur « oui » ou « non » attendue pour %', NEW.cle USING ERRCODE = 'GM006';
  ELSIF NEW.cle = 'nom_societe' AND (btrim(NEW.valeur) = '' OR length(NEW.valeur) > 100) THEN
    RAISE EXCEPTION 'Nom de la société : 1 à 100 caractères' USING ERRCODE = 'GM006';
  END IF;
  NEW.modifie_le := now();
  RETURN NEW;
END $$;

INSERT INTO parametres (cle, valeur, description) VALUES
  ('alerte_transfert_jours',  '3',  'Alerte quand un transfert est en route depuis ce nombre de jours ou plus'),
  ('alerte_reparation_jours', '30', 'Alerte quand un matériel est en réparation depuis ce nombre de jours ou plus'),
  ('alerte_retour_jours',     '7',  'Annonce des retours d''affectation prévus dans ce nombre de jours');

-- Matériels en réparation : depuis quand (dernier passage au statut « en
-- réparation » dans l'historique), avec le commentaire de ce passage.
CREATE VIEW v_reparations_en_cours AS
SELECT m.id AS materiel_id, m.code, m.designation, m.etat,
       m.site_id, s.nom AS site, m.service_id, sv.nom AS service,
       d.depuis, aujourdhui() - (d.depuis AT TIME ZONE fuseau_horaire())::date AS jours,
       d.commentaire
  FROM materiels m
  JOIN sites s ON s.id = m.site_id
  LEFT JOIN services sv ON sv.id = m.service_id
  LEFT JOIN LATERAL (
    SELECT h.date_changement AS depuis, h.commentaire
      FROM historiques_etats h
     WHERE h.materiel_id = m.id
       AND h.nouveau_statut = 'EN_REPARATION'
       AND h.ancien_statut IS DISTINCT FROM 'EN_REPARATION'
     ORDER BY h.date_changement DESC, h.id DESC
     LIMIT 1) d ON true
 WHERE m.statut = 'EN_REPARATION';

-- Historique des états de tout le parc, du plus récent au plus ancien.
CREATE INDEX historiques_etats_date_idx ON historiques_etats (date_changement DESC);
