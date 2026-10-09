# GH44 — Scénarios de test : client web

Références : `specs/GH44.md` (AC 1–13), `specs/GH44-design.md`.
Légende : **[A]** test automatique (vitest, `apps/desktop/src/web-server/*.test.ts`),
**[M]** test manuel. Projet de référence : projet de démo (`Démo`) + un projet multi-repos avec
composant en repo séparé.

## Sprint 1 — Non-régression desktop

| ID | Scénario | Attendu |
|---|---|---|
| S1-1 [M] | Lancer le desktop, se connecter (PAT et Device Flow), ouvrir la démo. | Identique à main. |
| S1-2 [M] | Créer une exigence, insérer une image (sélecteur), insérer un drawio hors repo puis dans le repo. | Image copiée sous le repo ; drawio : `copied: true` puis `false`. |
| S1-3 [M] | Exports Word, Excel, PDF (exigences, campagne), export par gabarit avec drawio. | Fichiers identiques en contenu à main ; PDF A4 avec fond ; diagrammes rendus en PNG. |
| S1-4 [M] | Classeur d'exécution : export, remplissage, import (aperçu + application). | Comportement GH36 inchangé. |
| S1-5 [M] | Écriture externe (éditer un YAML dans un éditeur). | Vue rafraîchie (`repo:file-changed`). |
| S1-6 [M] | Merge en conflit → résolution GH37 → abandon puis reprise. | Brouillons retrouvés dans `userData/merge-drafts`. |
| S1-7 [M] | Auto-update (préférence), « Afficher dans le dossier », « Ouvrir dans draw.io ». | Inchangés. |
| S1-8 [M] | Serveur MCP (`pnpm mcp-server` et bundle `build:mcp-server`) : tools de lecture et de liens. | Inchangés. |
| S1-9 [A] | `pnpm -r typecheck`, `pnpm --filter @polenta/merge-core test`. | Zéro erreur nouvelle. |
| S1-10 [A] | `grep "from 'electron'" apps/desktop/src/main/services`. | Seulement `net-proxy.ts`, `update.service.ts`. |

## Sprint 2 — Serveur, bridge, mode dev

### Nominal
| ID | Scénario | Attendu |
|---|---|---|
| S2-1 [M] | `pnpm dev:web` en mode dev, ouvrir le navigateur. | Écran d'accueil web ; aucune erreur console. |
| S2-2 [M] | Cloner un projet par URL, l'ouvrir. | Clone sous `<data>/users/<login>/workspaces/` ; arbre et vues chargés. |
| S2-3 [M] | Parcours de parité (cf. §Parité) dans le navigateur. | Identique au desktop, PDF excepté. |
| S2-4 [M] | Insérer une image et un drawio (upload). | Fichier copié dans le repo (`images/`, `diagrams/`), affiché. |
| S2-5 [M] | Export Word et Excel. | Fichier téléchargé par le navigateur, nom suggéré conservé ; pas de bouton « Ouvrir »/« Afficher dans le dossier ». |
| S2-6 [M] | Classeur d'exécution : export (téléchargement), import (upload), aperçu, application. | Résultats appliqués comme sur desktop. |
| S2-7 [M] | Deux onglets, édition dans le premier. | Second onglet rafraîchi sans rechargement (AC 9). |
| S2-8 [M] | Couper la connexion WebSocket (devtools offline 10 s) puis rétablir. | Reconnexion, caches invalidés, aucune erreur bloquante. |
| S2-9 [M] | Publier puis vérifier `git log` du remote. | Commit à l'identité du compte dev. |

### Sécurité / cas limites
| ID | Scénario | Attendu |
|---|---|---|
| S2-10 [A] | `PathGuard` : `repoPath` = racine d'un autre utilisateur, `../`, `C:\`, `/etc`, lien symbolique sortant, `\0`, ID `../../x`, DTO `{ workspaceDir: '/etc' }`. | Tous refusés (403) ; handler jamais appelé (AC 5). |
| S2-11 [A] | `PathGuard` : richtext contenant `../docs` dans un DTO. | Accepté (champ de contenu non inspecté). |
| S2-12 [A] | Exhaustivité : channels enregistrés = `ChannelPolicy` ∪ `DESKTOP_ONLY`, intersection vide. | Test vert ; échoue si un channel est ajouté sans classement. |
| S2-13 [A] | RPC sur `auth:get-token`, `dialog:pick-folder`, `update:install`, `export:open-file`, channel inconnu. | 404 (AC 6). |
| S2-14 [A] | RPC sans session / sans en-tête CSRF / CSRF erroné. | 401 / 403 / 403. |
| S2-15 [A] | Erreur levée par un service. | `{ ok:false, error:{message} }`, pas de stack ; le bridge rejette avec le même message. |
| S2-16 [A] | Upload trop gros / extension interdite. | 413 / 415 ; rien d'écrit. |
| S2-17 [A] | `GET /download/:id` d'un autre utilisateur, ou après téléchargement. | 404. |
| S2-18 [A] | Sérialisation : réponses des channels du parcours de parité passées par JSON. | Égalité profonde avec la valeur d'origine (pas de `Date`/`Buffer`/`Map` perdus). |
| S2-19 [A] | Démarrage `POLENTA_WEB_AUTH=dev` avec `NODE_ENV=production`. | Refus de démarrer, message explicite. |
| S2-20 [M] | Console navigateur sur tout le parcours de parité. | Aucune erreur, aucun bouton inopérant (AC 8). |
| S2-21 [A] | Argument racine relatif (`workspace:remove-repo-dir('src')`). | 403. |
| S2-22 [A] | Lien symbolique créé par le serveur (checkout d'un repo). | Fichier texte contenant la cible, jamais un lien. |
| S2-23 [A] | Clone/fetch vers un hôte hors `POLENTA_WEB_GIT_HOSTS`, HTTP, IP de métadonnées. | Refusé. |
| S2-24 [A] | Dépendance `polenta-repo.yaml` / override nommé `../x`. | Ignorée (nom de montage invalide). |
| S2-25 [M] | WebSocket `/events` ouvert depuis une autre origine (autre port). | Fermé (4403). |

## Sprint 3 — Forge, sessions, multi-utilisateurs (Forgejo de #45)

| ID | Scénario | Attendu |
|---|---|---|
| S3-1 [M] | Connexion d'Alice via Forgejo (OIDC). | Retour sur l'accueil web ; aucun formulaire PAT (AC 1). |
| S3-2 [M] | Inspecter cookies, réponses `/rpc`, `/auth/me`, logs serveur. | Jeton forge absent partout ; cookie de session `HttpOnly` (AC 1). |
| S3-3 [M] | Alice modifie SYS-0001 et publie. | `git log --format='%an <%ae>'` = identité Forgejo d'Alice ; `updatedBy` = Alice (AC 2). |
| S3-4 [M] | Alice et Bob ouvrent le même projet ; Alice modifie sans publier. | Bob ne voit rien ; Bob a son propre clone (AC 4). |
| S3-5 [M] | Alice et Bob modifient le même champ ; Alice publie, puis Bob. | Bob passe par la résolution GH37 dans le navigateur. |
| S3-6 [M] | Désactiver Bob dans Forgejo pendant sa session, puis Bob publie. | Message de révocation, retour au login ; modifications non publiées retrouvées après réactivation et reconnexion (AC 3). |
| S3-7 [M] | Désactiver Bob, Bob ne fait rien. | Session invalidée en ≤ 5 min. |
| S3-8 [M] | Sous-traitant n'ayant accès qu'à un repo : cloner un repo non autorisé. | Erreur d'accès explicite (droits forge). |
| S3-9 [M] | Inactivité 30 min (ou délai réduit en test), puis reprise. | Mémoire libérée (log d'éviction) ; projet rouvert sans perte (AC 10). |
| S3-10 [M] | Redémarrer le conteneur. | Reconnexion ; clones et modifications non publiées conservés (AC 11). |
| S3-11 [M] | « Mes projets » : supprimer un projet avec modifications non publiées. | Confirmation demandée ; suppression du clone seulement après confirmation. |
| S3-12 [A] | Pool : création concurrente pour le même login. | Un seul Container. |
| S3-13 [A] | Pool : dépassement de `MAX_ACTIVE_USERS` avec/sans sockets ouvertes. | Éviction LRU / 503. |
| S3-14 [A] | Login forge contenant des caractères hors `[a-z0-9._-]`. | Connexion refusée proprement. |

## Sprint 4 — Impression, Docker, déploiement

| ID | Scénario | Attendu |
|---|---|---|
| S4-1 [M] | Export PDF de chaque `kind` (exigences, tests, plan, rapport de campagne, requête, analyse d'impact, dashboard). | PDF téléchargé, rendu équivalent au desktop (comparaison visuelle). |
| S4-2 [M] | Export Word par gabarit avec diagrammes drawio. | Diagrammes en PNG nets (zoom 2). |
| S4-3 [M] | Trois exports PDF lancés simultanément par deux utilisateurs. | Tous aboutissent (file d'attente) ; chaque PDF contient les données de son auteur. |
| S4-4 [A] | Jeton d'impression réutilisé ou expiré. | Refusé. |
| S4-5 [M] | `docker compose --profile web up` sur le VPS de test (#45). | `https://polenta.<domaine>` servi par Caddy ; `/healthz` OK (AC 13). |
| S4-6 [M] | `backup.sh` puis `restore.sh` sur un VPS vierge. | Espaces utilisateurs restaurés, modifications non publiées comprises. |
| S4-7 [M] | Mesure mémoire : 5 utilisateurs sur la démo. | < 300 Mo par utilisateur actif. |
| S4-8 [M] | Desktop packagé (`pnpm package`) après tous les sprints. | Fonctionne sans aucun code serveur (AC 12). |

## Parcours de parité (S2-3, S4-1, AC 7)

À dérouler à l'identique sur desktop et web ; toute différence hors adaptations listées en
`GH44.md` §4 est un défaut.

1. Ouvrir la démo ; naviguer Vue système, Tableau, Excel, Word.
2. Créer une exigence (EARS), la modifier, changer son statut, la supprimer (pierre tombale posée).
3. Créer un test avec étapes ; lier test ↔ exigence depuis chaque côté ; vérifier la couverture.
4. Paramètres : créer `{vitesse}`, l'utiliser dans une exigence, le modifier → marquage revalidation.
5. Campagne : créer, ajouter des tests (vue Excel GH33), exécuter un test, clore ; exporter le
   classeur d'exécution, réimporter.
6. Baseline : créer, comparer à l'état courant, analyse d'impact.
7. Dashboard : créer une requête builder + SQL, un widget, ordonner.
8. Recherche + remplacement.
9. Publier, Rafraîchir, auto-sync ; conflit → résolution GH37.
10. Exports Word, Excel, PDF, gabarit.
11. Préférences (langue, thème), onglets internes (raccourcis web documentés).
