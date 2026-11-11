# Installation et lancement en local

**Gestion des matériels et des articles** — version 0.7.0 (phase 7)

Ce guide permet d'installer l'application sur un poste, de créer la base de données sur Neon et de vérifier que tout fonctionne. La mise en ligne sur Render fera l'objet d'un guide séparé (phase 9).

---

## 1. Prérequis

| Outil | Version | Vérifier avec |
|---|---|---|
| Node.js | 22 ou plus | `node --version` |
| npm | fourni avec Node.js | `npm --version` |
| Accès Internet | pour joindre Neon | — |
| `psql` (facultatif) | PostgreSQL 16 ou plus | `psql --version` |

## 2. Installer les dépendances

Depuis le dossier du projet :

```bash
npm ci
```

Cette commande installe exactement les versions notées dans `package-lock.json` : Express 5, pg 8 et helmet 8.

## 3. Créer la base sur Neon (une seule fois)

Ces étapes sont faites par la personne qui gère le compte Neon de la société. L'application ne crée aucun compte.

1. Sur <https://neon.com>, créer un projet **gestion-materiels** : base `neondb`, PostgreSQL 17, région **AWS Europe Central 1 (Frankfurt)**. Laisser désactivés les autres services proposés (stockage, Auth, Functions…). Le service Render devra être dans la même région (phase 9), pour que le serveur et la base soient proches.
2. Le projet contient une branche principale (`production` ou `main` selon Neon) : c'est la **base de travail**.
3. Créer tout de suite une seconde branche **`test`** (**Create child branch**), tant que la branche principale est encore vide, avec **Auto-delete : Never**. C'est la **base de test** : les contrôles y écrivent, puis effacent tout, et elle doit rester vide.
4. Ne pas utiliser le « prompt pour agent » proposé par Neon : la commande `npm run configurer` (étape 4) fait le nécessaire sans que le mot de passe de la base passe par un tiers.

L'application ne pose que des réglages limités à chaque transaction. Elle fonctionne donc avec le « pooling » de Neon, qui économise les connexions de l'offre gratuite.

> Les noms des écrans de Neon peuvent changer. Dans ce cas, retenez l'essentiel : une chaîne de connexion « pooled » pour chaque branche.

## 4. Configurer le fichier `.env`

```bash
npm run configurer
```

La commande demande deux chaînes de connexion, l'une après l'autre. Pour chacune, dans Neon : choisir la branche, cliquer sur **Connect**, activer **Connection pooling**, cliquer sur **Show password** puis sur **Copy snippet**, et coller dans le terminal.

1. la chaîne de la branche **principale** (base de travail) ;
2. la chaîne de la branche **`test`**.

La commande :

- corrige la fin des chaînes (`/neondb?sslmode=verify-full`) ;
- refuse deux fois la même branche, et prévient si la région n'est pas Frankfurt ou si le pooling n'est pas activé ;
- ajoute une clé de session tirée au hasard ;
- enregistre le tout dans `.env` (les autres lignes du fichier sont conservées) ;
- essaie les deux connexions.

Elle se termine par « Tout est prêt » et peut être relancée sans risque.

| Variable écrite | Valeur |
|---|---|
| `DATABASE_URL` | chaîne de la branche principale |
| `DATABASE_URL_TEST` | chaîne de la branche `test` |
| `SESSION_SECRET` | clé tirée au hasard, gardée si elle existe déjà ; **obligatoire en ligne** |

`PORT` reste à 3000 ; changez-le dans `.env` s'il est déjà pris.

Le fichier `.env` contient des mots de passe : il est exclu de Git par `.gitignore` et ne doit jamais être envoyé, ni copié dans un message.

## 5. Créer le schéma

```bash
npm run db:migrer
```

Résultat attendu sur une base vide :

```
Base vide : création du schéma (version 0001)…
Migration 0002_signalements.sql…
Migration 0003_alertes.sql…
Base à jour : version 0003 (2 migration(s) appliquée(s)).
```

Sur une base déjà créée, seules les migrations qui manquent apparaissent : `0002_signalements.sql` ajoute la table des signalements et le paramètre qui les active (phase 6) ; `0003_alertes.sql` ajoute les trois délais d'alerte et la vue des réparations en cours (phase 7).

La commande peut être relancée sans risque : elle n'applique que ce qui manque.

## 5 bis. Créer le premier administrateur

Une seule fois, sur la base de travail :

```bash
npm run admin:creer -- --nom "Prénom NOM" --email adresse@societe.mg --identifiant pnom
```

La commande affiche un **mot de passe provisoire**, une seule fois. À la première connexion, l'application impose de le remplacer par un mot de passe personnel. Les comptes suivants se créent depuis l'écran **Utilisateurs** ; les règles de connexion et les droits de chaque rôle sont décrits dans [droits.md](droits.md).

La même commande dépanne si le seul administrateur a perdu son mot de passe : elle crée un second administrateur, qui donne ensuite un mot de passe provisoire au premier.

## 6. Contrôler

```bash
npm run db:verifier
npm test
```

| Commande | Ce qu'elle vérifie | Résultat attendu |
|---|---|---|
| `npm run db:verifier` | Les règles tenues par la base (scénarios de recette 3 à 11, décisions du 11/11), sur la base de **test** | `123 contrôles réussis.` |
| `npm test` | Le serveur : santé, sécurité, erreurs, transactions, connexion, sessions, droits, matériels, articles, mouvements, réceptions, affectations, signalements, états, alertes, journal | `pass 93`, `fail 0` |

Sans `DATABASE_URL_TEST`, `npm test` passe seulement les tests qui n'ont pas besoin de base, et le signale.

`npm test` crée de vrais comptes dans la base de test, puis la remet à zéro avant et après. Par sécurité, il refuse d'effacer une base qui contient des données sans porter la marque « base de test » qu'il pose lui-même.

## 7. Lancer l'application

```bash
npm run dev
```

`npm run dev` relance le serveur à chaque modification du code ; `npm start` le lance sans ce rechargement automatique. Ouvrir ensuite <http://localhost:3000> : la page de connexion s'affiche. Après connexion, l'accueil montre l'état du service, avec la pastille **Opérationnel**, la version du schéma et la date du jour à Antananarivo.

Mettre une `SESSION_SECRET` dans `.env` évite de devoir se reconnecter à chaque redémarrage du serveur (voir `.env.example`).

La même vérification est disponible en JSON : <http://localhost:3000/api/sante>.

## 8. Problèmes fréquents

| Message | Cause | Solution |
|---|---|---|
| `Configuration incomplète : DATABASE_URL absente` | Pas de fichier `.env` | Étape 4 |
| `Base vide : lancez « npm run db:migrer »` | Schéma pas encore créé | Étape 5 |
| `La base de données ne répond pas` | Neon en veille, chaîne erronée ou pas d'Internet | Réessayer après quelques secondes (réveil de Neon), vérifier la chaîne |
| `La base de test contient des données` | La branche `test` a été créée après l'arrivée de données dans `main` | Supprimer la branche `test` et la recréer vide |
| `DATABASE_URL_TEST doit désigner une autre base` | Les deux variables ont la même valeur | Mettre la chaîne de la branche `test` |
| Avertissement SSL de `pg` au démarrage | Le mode `sslmode=require` est signalé par la bibliothèque | Remplacer `sslmode=require` par `sslmode=verify-full` dans la chaîne |
| `EADDRINUSE` | Le port est déjà utilisé | Mettre par exemple `PORT=3100` dans `.env` |
| `Identifiant ou mot de passe incorrect…` alors que le mot de passe est bon | Compte bloqué après 5 échecs | Attendre 15 minutes, ou demander à l'administrateur de le débloquer |
| Connexion perdue à chaque redémarrage en local | Pas de `SESSION_SECRET` | En mettre une dans `.env` |
| `Refus d'effacer : la base DATABASE_URL_TEST contient des données…` | `npm test` pointe vers une base qui n'est pas la base de test | Corriger `DATABASE_URL_TEST` |

## 9. Sans Neon : PostgreSQL installé sur le poste

Pour travailler sans Internet, créer deux bases vides sur un PostgreSQL 16 ou plus :

```bash
createdb gestion_materiels
createdb gestion_materiels_test
```

Puis, dans `.env` :

```
DATABASE_URL=postgresql://postgres:mot_de_passe@localhost:5432/gestion_materiels
DATABASE_URL_TEST=postgresql://postgres:mot_de_passe@localhost:5432/gestion_materiels_test
```

Reprendre ensuite à l'étape 5.

## 10. Faire évoluer le schéma

Un changement de structure ne modifie jamais `schema.sql` une fois la base en service. Il prend la forme d'un nouveau fichier :

```
database/migrations/0002_description_courte.sql
```

`npm run db:migrer` applique les fichiers manquants dans l'ordre, chacun dans une transaction : en cas d'erreur, rien n'est appliqué. Chaque version appliquée est inscrite dans la table `schema_migrations`. Un fichier déjà appliqué ne se modifie plus ; une correction se fait par un nouveau fichier.

## 11. Organisation du code

| Fichier ou dossier | Rôle |
|---|---|
| `server.js` | Démarrage, contrôle de la configuration, arrêt propre |
| `app.js` | Application Express : en-têtes de sécurité, API sous `/api`, pages de `public/` |
| `config.js`, `env.js` | Lecture des variables d'environnement et du fichier `.env` |
| `database/db.js` | Connexions, `transaction(utilisateurId, travail)`, `poserCommentaire()` |
| `database/mise-a-niveau.js`, `migrer.js` | Création du schéma et migrations |
| `database/verifier.js` | Contrôle des règles sur la base de test |
| `middleware/erreurs.js` | Traduction des erreurs de la base en messages français |
| `middleware/origine.js` | Refus des écritures venant d'un autre site |
| `middleware/session.js`, `authentification.js` | Sessions en base, utilisateur courant, `exigerConnexion()`, `exigerDroit()` |
| `middleware/permissions.js` | Droits de chaque rôle et périmètre (service, employé) |
| `services/mots-de-passe.js` | Argon2id, règles de choix, mots de passe provisoires |
| `services/journal.js`, `validation.js` | Journal des opérations, contrôle des données reçues |
| `routes/` | API : `sante`, `auth` (connexion), `utilisateurs`, `referentiels`, `employes`, `materiels`, `articles` |
| `node_modules/jsbarcode` | Code-barres des étiquettes, servi sous `/vendor/jsbarcode` (licence MIT) |
| `scripts/creer-admin.js` | Création d'un administrateur en ligne de commande |
| `public/js/app.js` | Appels à l'API, messages, dialogues et confirmations, communs à toutes les pages |
| `public/js/entete.js` | En-tête des pages connectées : menu selon les droits, déconnexion |
| `tests/` | Tests du serveur (`npm test`) |
