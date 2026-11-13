# Connexion, rôles et droits

**Gestion des matériels et des articles** — version 0.8.0 (phase 8)
Référence : cahier des charges § 1.3 (profils) et § 8.1 (sécurité). Les droits sont définis dans [`middleware/permissions.js`](../middleware/permissions.js). Ils sont vérifiés par le serveur à chaque requête : le menu affiché à l'écran n'en est qu'un reflet.

---

## 1. Rôles

| Rôle | Pour qui | Ce qu'il voit |
|---|---|---|
| **Administrateur** | Paramétrage, comptes, droits | Tout |
| **Gestionnaire de matériels** | Fiches, mouvements, affectations, inventaires | Tout le parc |
| **Responsable de service** | Suivi des biens de son service | Les biens de **son service** |
| **Employé** | Consultation de ce qui lui est confié | **Ses** matériels affectés |

Un compte de responsable est rattaché à un service ; un compte d'employé à une fiche employé. La base refuse un compte qui ne respecte pas ces rattachements.

## 2. Droits par rôle

| Droit | Admin. | Gestion. | Resp. service | Employé |
|---|:-:|:-:|:-:|:-:|
| Modifier les paramètres de l'application | ✓ | | | |
| Créer et gérer les comptes utilisateurs | ✓ | | | |
| Consulter et exporter le journal des opérations (**Paramètres › Journal des opérations**) | ✓ | | | |
| Consulter les alertes (écran **Alertes**, pastille du menu et cloche de la barre du haut) | ✓ | ✓ | son service ⁴ | |
| Gérer sites, services et catégories | ✓ | | | |
| Consulter sites, services, catégories et unités | ✓ | ✓ | ✓ | |
| Créer et modifier les fiches employés | ✓ | ✓ | | |
| Consulter les matériels | ✓ | ✓ | son service | |
| Créer et modifier les fiches matériels, imprimer les étiquettes | ✓ | ✓ | | |
| Consulter les articles et les stocks | ✓ | ✓ | ✓ | |
| Créer et modifier les articles et leurs seuils | ✓ | ✓ | | |
| Consulter les mouvements | ✓ | ✓ | son service | |
| Saisir et valider les mouvements | ✓ | ✓ | | |
| Annuler un mouvement validé | ✓ | ✓ | | |
| Autoriser une correction d'inventaire ou un mouvement inverse ¹ | ✓ | ✓ | | |
| Confirmer la réception d'un transfert resté en route (d'avant le 12/11) ⁶ | ✓ | ✓ | site de son service ² | |
| Consulter les remises et retours (écran « Remises et retours ») | ✓ | ✓ | son service | |
| Remettre un matériel, enregistrer son retour, prolonger un contrat | ✓ | ✓ | | |
| Consulter les matériels qui me sont affectés | ✓ | ✓ | ✓ | ✓ |
| Signaler une panne, une perte ou un retour souhaité sur un de mes matériels ³ | ✓ | ✓ | ✓ | ✓ |
| Prendre en charge et clore les signalements | ✓ | ✓ | | |
| Consulter le tableau de bord et les rapports | ✓ | ✓ | son service ⁵ | |
| Exporter les rapports en CSV ou en PDF (chaque export est inscrit au journal) | ✓ | ✓ | son service ⁵ | |

¹ La base ajoute sa propre règle : l'autorisation vient d'un administrateur, ou d'un gestionnaire **autre que l'auteur** du mouvement. Il n'y a pas d'étape séparée : la personne qui valide un mouvement à autoriser l'autorise (bouton « Autoriser et valider » sur la fiche du mouvement ; liste « À autoriser par moi » dans **Mouvements**). Son auteur, s'il est gestionnaire, ne voit pas ce bouton.
² Les transferts dont le site de destination est celui auquel son service est rattaché. Un service sans site ne reçoit rien : rattachez chaque service à son site.
³ Seulement si l'administrateur a activé la fonction dans les paramètres (cahier des charges § 1.3 : « si cette fonction est activée »). La fonction s'active dans **Paramètres › Réglages de l’application** (désactivée à l'installation) ; l'employé signale depuis **Mes matériels**, seulement sur un matériel qui lui est affecté.
⁴ Décision du 11/11 (phase 7) : stocks sous le seuil propre au site de son service, retours en retard ou proches des employés et des matériels de son service, transferts qui partent de ce site ou y arrivent, réparations et matériels endommagés de son service. Pas de signalements, de mouvements à autoriser ni d'étiquettes : ce n'est pas à lui d'agir.

⁵ Phase 8 : ses matériels (ceux de son service), les mouvements et affectations de son service ou touchant le site de son service, le stock des articles du site de son service, les anomalies de son service. Le filtre « Service » ne lui est pas proposé ; un export porte la mention « Périmètre : votre service ». Le journal des opérations reste réservé à l'administrateur.

⁶ Décision du 12/11 : un transfert est reçu en entier dès l'envoi, par la personne qui l'envoie ; l'écran Réceptions a été retiré. Seuls les transferts restés « en route » d'avant cette décision se réceptionnent encore, depuis leur fiche (bouton « Réceptionner »).

Changer l'état d'un matériel (et l'envoyer en réparation ou l'en faire revenir) fait partie de « Créer et modifier les fiches matériels » : administrateur et gestionnaire. L'historique des états suit « Consulter les matériels » (le responsable : son service).

La page **Paramètres** (12/11) s'ouvre pour toute personne connectée, mais ne montre que les cartes des écrans permis à son rôle (« Mon mot de passe » pour tous). Le lien « Paramètres » du menu n'apparaît que s'il y a autre chose que le mot de passe : administrateur (toutes les cartes), gestionnaire (Rapports, Historique des états, Employés) et responsable de service (Rapports, Historique des états), depuis que Rapports et Historique des états y sont rangés (12/11).

Tous les droits du tableau sont en place depuis la phase 8 (12/11). L'employé arrive directement sur **Mes matériels** ; son menu ne montre que cette page. Le responsable de service voit les mouvements et les remises de son service en lecture seule (écrans **Mouvements** et **Remises et retours**).

## 3. Règles de connexion

| Règle | Réglage |
|---|---|
| Connexion | Par adresse e-mail ou identifiant, sans tenir compte des majuscules |
| Chiffrement des mots de passe | Argon2id ; la base refuse tout mot de passe en clair |
| Message d'échec | Toujours le même, que le compte existe ou non, qu'il soit bloqué ou non, avec le même temps de réponse |
| Blocage d'un compte | Après **5 échecs**, pendant **15 minutes** (paramètres `connexion_tentatives_max` et `connexion_verrouillage_minutes`) ; l'administrateur peut débloquer avant |
| Limite par poste | 20 tentatives par quart d'heure depuis une même adresse |
| Compte fermé | Un compte suspendu ou désactivé est refusé ; la raison n'est donnée qu'à qui a saisi le bon mot de passe |
| Session | Stockée en base, dans un cookie inaccessible au JavaScript, envoyé seulement en HTTPS en ligne ; **fermée après 4 heures sans activité** ; nouvel identifiant à chaque connexion |
| Premier mot de passe | Tapé par l'administrateur dans « Nouvel utilisateur », sous le rôle : **obligatoire et définitif**, avec les règles d'un mot de passe personnel (décisions du 13/11). Un œil dans le champ l'affiche ou le masque. Plus de mot de passe provisoire à l'écran |
| Mot de passe provisoire | Seulement pour le **premier administrateur** (`npm run admin:creer`) : montré une seule fois, **à changer avant toute autre action** (badge « Mot de passe à changer ») |
| Mot de passe personnel | 10 caractères au moins, sans l'identifiant ni l'adresse e-mail |
| Changement de mot de passe | Ferme les autres sessions ouvertes du compte |
| Suspension, nouveau mot de passe tapé par l'administrateur | Ferment aussitôt les sessions du compte |
| Mot de passe oublié | L'administrateur tape un nouveau mot de passe dans « Modifier le compte » (le bouton « Mot de passe provisoire » est retiré le 13/11) |
| Mot de passe tapé dans « Modifier le compte » (13/11) | **Définitif**, mêmes règles qu'un mot de passe personnel ; débloque le compte ; laissé vide, le mot de passe ne change pas. Pas pour son propre compte (passer par « Mon mot de passe », qui demande l'actuel) |
| Changement de rôle | Pris en compte dès la requête suivante |
| Administrateurs | Il en reste toujours au moins un actif ; un administrateur ne peut ni changer son propre rôle ni fermer son propre compte |
| Écritures | Refusées si elles viennent d'un autre site |

Un compte ne se supprime jamais : il se **suspend** (temporairement) ou se **désactive** (départ). L'historique de ses opérations reste attaché à son nom.

## 4. Journal

Chaque opération ci-dessous est inscrite dans `historique_actions`, avec son auteur, sa date et l'adresse du poste. Cette table ne se modifie pas.

| Action | Quand |
|---|---|
| `CONNEXION`, `DECONNEXION` | Connexion réussie, déconnexion |
| `CONNEXION_ECHEC` | Compte inconnu, mot de passe faux ou compte bloqué (avec le motif) |
| `CONNEXION_REFUSEE` | Bon mot de passe sur un compte fermé |
| `MOT_DE_PASSE_CHANGE` | L'utilisateur a choisi un nouveau mot de passe |
| `UTILISATEUR_CREE`, `UTILISATEUR_MODIFIE` | Création ou modification d'un compte (champs modifiés, avant et après) |
| `MOT_DE_PASSE_REINITIALISE`, `COMPTE_DEBLOQUE` | Actions de l'administrateur |
| `ADMINISTRATEUR_CREE` | Compte créé par la commande `npm run admin:creer` |
| `EXPORT_RAPPORT` | Export d'un rapport en CSV ou en PDF : rapport, format, nombre de lignes, filtres appliqués (phase 8) |

## 5. Décisions du 11/11/2026

| # | Question | Décision |
|---|---|---|
| 1 | Le responsable de service peut-il **confirmer la réception** d'un transfert ? | **Oui**, pour les transferts qui arrivent au site de son service |
| 2 | Le responsable de service peut-il **exporter** les rapports ? | **Oui**, pour son service seulement ; chaque export est journalisé |
| 3 | Qui crée les **fiches employés** ? | **Gestionnaire et administrateur** |
| 4 | Durée avant déconnexion automatique | **4 heures** sans activité |
| 5 | Signalement d'un problème par l'employé | **Oui, activable** par l'administrateur ; construit avec l'écran « Mes matériels » (phase 6) |
| 6 | Mot de passe à la création et à la modification d'un compte (13/11) | **Choisi par l'administrateur et définitif** (champ sous le rôle, aussi dans « Modifier le compte ») ; **obligatoire à la création** : plus de mot de passe provisoire ni de bouton « Mot de passe provisoire » (un oubli se règle dans « Modifier ») ; bouton « Afficher » remplacé par un **œil**. « Mon mot de passe » n'est plus une carte de Paramètres : il reste dans le menu du compte |

Ces décisions sont vérifiées par `tests/permissions.test.js`.
