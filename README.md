# Gestion des matériels et des articles

Application web de suivi des entrées, sorties, affectations, stocks et états des biens de la société.

Document de référence : [docs/Cahier_des_charges_Gestion_Materiels.pdf](docs/Cahier_des_charges_Gestion_Materiels.pdf) (version 1.0 du 10/11/2026).

## Pile technique retenue

| Couche | Technologie |
|---|---|
| Interface | HTML5, CSS3, JavaScript natif (Bootstrap 5 facultatif) |
| Serveur | Node.js + Express.js (API REST) |
| Base de données | PostgreSQL hébergé sur Neon |
| Hébergement | Render — Web Service Free |
| Dépôt de code | GitHub |

Chemin : navigateur → Render (Express) → Neon (PostgreSQL). Le navigateur ne se connecte **jamais** directement à Neon.

## Démarrage rapide

Guide complet, avec la création de la base sur Neon : [docs/installation.md](docs/installation.md).

```bash
npm ci
npm run configurer          # demande les 2 chaînes de connexion Neon, écrit .env, essaie la connexion
npm run db:migrer           # crée le schéma
npm run admin:creer -- --nom "Prénom NOM" --email adresse@societe.mg   # premier administrateur
npm run db:verifier         # 117 contrôles des règles, sur la base de test
npm test                    # 67 tests du serveur
npm run dev                 # http://localhost:3000
```

Connexion, rôles et droits : [docs/droits.md](docs/droits.md).

## Premiers pas dans l'application

1. **Administration** (administrateur) : créer les **sites** (siège, dépôt…), puis les **services**, chacun rattaché à son site. Les catégories de base sont déjà là ; on peut en ajouter.
2. **Utilisateurs** : créer les comptes des collègues. Un responsable de service est rattaché à son service.
3. **Employés** : créer les fiches des personnes à qui l'on remettra du matériel.
4. **Matériels** → **Nouveau matériel** : la fiche et sa réception (achat ou don) s'enregistrent ensemble, et le code `MAT-AAAA-NNNN` est attribué.
5. Cocher les matériels, puis **Imprimer les étiquettes** : planche A4 de 3 × 7 étiquettes (63,5 × 38,1 mm), à imprimer en « Taille réelle ». Pour ouvrir une fiche, il suffit ensuite de scanner l'étiquette dans le champ de recherche de l'en-tête.
6. **Articles** → **Nouvel article** : unité et seuil global obligatoires ; seuils par site facultatifs, depuis la fiche de l'article. Le stock évoluera par les mouvements (phase 6).

## Organisation du dossier

```
gestion-materiels/
├── docs/          cahier des charges, dictionnaire de données, droits, guide d'installation
├── public/        pages (connexion, matériels, articles, employés, administration, étiquettes…), css/, js/
├── routes/        API : sante, auth, utilisateurs, referentiels, employes, materiels, articles
├── middleware/    erreurs, origine, journal, session, authentification, permissions
├── database/      schema.sql, migrations/, tests/, db.js, migrer.js, verifier.js
├── services/      mots de passe, journal des opérations, contrôle des saisies
├── scripts/       creer-admin.js (premier administrateur)
├── tests/         tests du serveur (node --test)
├── app.js         application Express
├── server.js      démarrage et arrêt propre
├── config.js      configuration lue dans l'environnement
├── .env.example   variables attendues, sans aucun secret
└── .gitignore
```

## Modules de la première version

| Module | Priorité |
|---|---|
| Tableau de bord (indicateurs, alertes, derniers mouvements) | Essentielle |
| Matériels durables (code unique, état, statut, site, responsable) | Essentielle |
| Articles consommables (unité, quantité, seuil minimum) | Essentielle |
| Entrées / sorties (réceptions, consommations, transferts, pertes, retours) | Essentielle |
| Affectations et retours | Essentielle |
| États et maintenance | Essentielle |
| Rapports + export CSV (PDF ensuite) | Importante |
| Inventaire physique | Évolution proche |
| Code-barres : impression des étiquettes, recherche par scan | **Avancé en première version** (décision du 11/11) |

Hors première version : comptabilité et amortissements, circuit d'achats fournisseurs, application mobile native, IA, synchronisation hors ligne.

## Règles à ne jamais enfreindre

- Chaque matériel et chaque article a un code unique (ex. `MAT-2026-0001`).
- Une sortie ne dépasse jamais le stock disponible.
- Un mouvement validé n'est jamais supprimé : on l'annule (tracé) ou on passe un mouvement inverse autorisé.
- Un transfert se fait en deux temps : envoi par le site d'origine, réception confirmée par le site destinataire ; un manquant est motivé et tracé.
- Tout mouvement de matériel porte le n° du ticket qui le justifie ; une date future est refusée.
- Une affectation suit un contrat (n° et date de retour prévue) ; les retards sont signalés. Un matériel affecté ne peut pas l'être une seconde fois.
- Au retour, le statut suit l'état constaté : neuf, bon, moyen → disponible ; endommagé → en réparation ; hors service → réformé.
- Une correction d'inventaire est autorisée par un administrateur ou un autre gestionnaire que son auteur.
- Seuil d'alerte global par article, plus un seuil par site facultatif. Prix en Ariary entiers.
- État physique (neuf, bon, moyen, endommagé, hors service) et statut (disponible, affecté, en réparation, en transit, perdu, réformé) sont deux notions séparées ; chaque changement est daté, signé par son auteur et commenté si besoin.
- Toute opération touchant plusieurs tables passe dans une transaction SQL.
- Mots de passe hachés (bcrypt ou Argon2), requêtes SQL paramétrées, secrets uniquement dans les variables d'environnement Render.
- Aucun fichier indispensable sur le disque de Render (éphémère) : base sur Neon, photos sur un stockage externe ou reportées.

## Base de données

- Création : `database/schema.sql` (21 tables, 10 vues), à exécuter une fois sur une base vide.
- Description complète : [docs/dictionnaire_donnees.md](docs/dictionnaire_donnees.md) (tables, types de mouvement, cycle de vie, codes d'erreur, ce que le serveur doit faire, décisions du 11/11).
- Contrôle des règles : `database/tests/test_regles.sql`, sur une base de test (117 contrôles, transaction annulée à la fin).
- Évolutions : un fichier par changement dans `database/migrations/` (`0002_…sql`), appliqué par `npm run db:migrer` et inscrit dans la table `schema_migrations`.
- Le serveur écrit toujours par `transaction(utilisateurId, …)` (`database/db.js`) : la base connaît ainsi l'auteur de chaque opération.

## Planning

| Phase | Travaux | Livrable | État |
|---|---|---|---|
| 1 | Validation du périmètre et des règles | Cahier des charges validé | Reçu, **visas à recueillir** |
| 2 | Conception de la base PostgreSQL | `schema.sql` + dictionnaire de données | **Fait** — choix validés et intégrés le 11/11, 117 contrôles OK |
| 3 | Initialisation Node.js / Express + connexion Neon | Serveur opérationnel | **Fait le 11/11**, testé sur PostgreSQL local (22 tests) — **base Neon à créer** ([guide](docs/installation.md)) |
| 4 | Authentification et rôles | Connexion sécurisée (session en base) | **Fait le 11/11** — recette 1 et 2 couvertes, 46 tests ; droits validés ([droits.md](docs/droits.md) § 5) |
| 5 | Matériels et articles | Fiches et listes, étiquettes code-barres, recherche par scan | **Fait le 11/11** (version 0.5.0) — référentiels, employés, matériels avec réception, étiquettes, articles et seuils par site ; recette 3 et 4 couvertes, 67 tests |
| 6 | Mouvements, affectations, retours | Traçabilité, réception des transferts (y compris par le responsable du site), « Mes matériels » et signalements activables | À faire |
| 7 | États, historiques, alertes | Suivi du parc et des stocks | À faire |
| 8 | Tableau de bord et rapports | Indicateurs et exports | À faire |
| 9 | Tests, sauvegardes, déploiement | Version de recette en ligne | À faire |

La recette se fait sur les 14 scénarios du chapitre 11 du cahier des charges.
"# gestion-materiels" 
