# GH45 — Sprint S2b : configuration par équipe, lien d'invitation, tests d'interface

Périmètre : spec §3bis / §3ter (amendement du 2026-10-10), design §13, tests S2b-1 à S2b-14.
Forges réelles : `acme` (Forgejo 15.0.9), `gitea-test` (Gitea 28.1.0) sur `vps-f515f9c6`.

## Fichiers

Créés :

| Fichier | Rôle |
|---|---|
| `deploy/instance/polenta-config.yaml.tmpl` | Modèle commenté de `config.yaml` |
| `main/services/forge/team-config.ts` | Lecture tolérante et résolution par équipes (fonctions pures) |
| `main/services/forge-config.service.ts` | Lecture sur la forge du compte courant, cache hors-ligne, projets accessibles |
| `main/host/invite-link.ts` | Lien `polenta://connect` : analyse stricte, invitation en attente |
| `renderer/hooks/useTeamConfig.ts`, `useInviteLinks.ts` ; `renderer/lib/{projectHome,inviteStore}.ts` ; `renderer/components/home/TeamProjects.tsx` | Configuration d'équipe appliquée, invitations, « Projets de votre équipe » |
| `apps/desktop/e2e-desktop/` (`forge.spec.ts`, `support/{app,forge}.ts`, `support/forge-setup.py`), `playwright.desktop.config.ts` | **Tests d'interface du desktop** (Playwright Electron, profil isolé) |
| Tests : `team-config.test.ts`, `forge-config.service.test.ts`, `pref-defaults.test.ts` | 30 tests unitaires |

Modifiés :
- kit : `polenta-host.sh` (`ensure_config_repo`, `instance sync`, organisations réservées à l'admin), `polenta-admin.sh` (lien et message d'invitation), `host.env.example` (`POLENTA_DOWNLOAD_URL`), `.gitattributes` ;
- main : `index.ts` (instance unique, protocole, isolation de test), `container.ts`, `auth.service.ts` (`currentAccountWithToken`), `app-settings.service.ts`, `update.service.ts`, `workspace.service.ts` (`findRecentByRemote`), `ipc/{index,channels,desktop-only.handlers,pref.handlers}.ts`, `host/electron-host.ts` ;
- `electron-builder.yml` (protocole `polenta`) ;
- web : `channel-policy.ts` ;
- `packages/types/src/forge.ts`, `packages/api-client` ;
- renderer : `__root.tsx`, `login.tsx`, `index.tsx`, `ThemeContext.tsx`, `AccountPanel.tsx`, `useCurrentAccount.ts`, i18n.

## Comportement implémenté

- **Kit**
  - `instance add` / `instance sync` créent `<org>/polenta-config` : modèle commenté, démo en projet proposé, branche `main` protégée (push réservé à `Owners`).
  - `instance sync` remet à niveau une instance existante (fait sur `acme`, `globex` et `gitea-test`).
  - Les utilisateurs ne peuvent plus créer d'organisation : une seule organisation par instance.
  - `polenta-admin user add` affiche le lien d'invitation et un message prêt à envoyer. `user import` affiche le lien sur chaque ligne.
- **Lien d'invitation** (`polenta://connect?server=…&login=…`)
  - Il ouvre la connexion avec le serveur et l'identifiant pré-remplis, et un bandeau « Invitation à vous connecter au serveur … ». Il ne connecte jamais tout seul.
  - Si Polenta est déjà ouvert, le lien est traité par la fenêtre existante (instance unique).
  - Il n'accepte que `https`.
  - Une politique DSI qui impose un serveur l'emporte : un lien vers un autre serveur est ignoré, avec un message.
- **Configuration par équipe**
  - Elle est lue au démarrage, à la connexion, toutes les 30 minutes et à la déconnexion. Elle est mise en cache pour le hors-ligne.
  - Elle est prise dans l'organisation la plus ancienne qui en a une.
  - Résolution : projets en union ; `updates: managed` l'emporte ; pour les préférences, la première équipe du fichier l'emporte, et les champs visibles sont résolus type par type.
- **Effets**
  - « Projets de votre équipe » à l'accueil : seulement les projets accessibles, ouverts s'ils sont déjà sur le poste, sinon clonés dans un dossier vide.
  - Vue d'ouverture d'un projet selon l'équipe.
  - Mises à jour verrouillées par `updates: managed`.
  - Langue, thème et champs visibles par défaut, jamais imposés à un choix personnel et jamais enregistrés. Ils sont rétablis quand ils disparaissent.
  - Le panneau Compte affiche « Configuration du serveur appliquée (équipes : …) » ou l'erreur.

## Divergences par rapport à la spec et au design

1. **`projectHome`** : les valeurs sont `dashboard | requirements | tests | campaigns`, alignées sur les panneaux existants. Il n'existe pas de vue « système » unique ni de vue « traçabilité ».
2. **Lien d'invitation** : `https` uniquement (la spec admettait `http`). C'est une protection contre l'hameçonnage.
3. **Rafraîchissement** : il est déclenché par le renderer (démarrage, connexion, 30 min, déconnexion) et non par un minuteur du process main. C'est plus simple pour le serveur web, qui a un conteneur par utilisateur.
4. **Thème** : le choix explicite est enregistré sous une nouvelle clé `polenta:theme-choice`. L'ancienne clé était écrite automatiquement à chaque rendu et ne permettait pas de distinguer un choix personnel. Conséquence : un thème choisi avant cette version est conservé à l'affichage, mais un défaut d'équipe peut le remplacer tant que l'utilisateur ne l'a pas re-choisi.
5. **Protocole `polenta://`** : il n'est enregistré que par l'application installée (`app.isPackaged`). En mode dev ou en test, le lien est passé en argument.
6. **Kit** : `DEFAULT_ALLOW_CREATE_ORGANIZATION=false` et `DISABLE_REGULAR_ORG_CREATION=true`, pour qu'une organisation personnelle ne puisse pas masquer la configuration de l'entreprise.
7. **Projet d'équipe** : il est cloné dans un dossier **vide** uniquement. On n'ouvre jamais un autre projet à sa place.

## Revue de code

`/code-review` (medium) : 10 constats, tous traités.

| Constat | Traitement |
|---|---|
| Invitation : contourne la politique DSI, accepte `http` (hameçonnage, mot de passe en clair) | `https` seul ; serveur DSI prioritaire, lien ignoré avec message ; bandeau d'invitation |
| Thème d'équipe jamais appliqué après mise à jour (ancienne clé écrite automatiquement) | Nouvelle clé de choix explicite |
| Invitation perdue si la fenêtre principale est fermée | Fenêtre existante, ou nouvelle fenêtre (macOS) |
| Mode dev et tests réenregistraient le protocole système | Enregistrement par l'application installée seulement |
| `ensure_config_repo` non reprenable entre la création du repo et celle du fichier | Étapes séparées et idempotentes |
| Organisation personnelle masquant la configuration ; une seule page lue | Organisation la plus ancienne, pagination, création d'organisations interdite par le kit |
| Projet d'équipe : un autre projet ouvert à sa place ; message de la démo | Dossier vide exigé, message propre |
| Langue et thème d'équipe non rétablis (déconnexion, autre équipe) | Rétablis ; configuration relue à la déconnexion |
| Champs visibles d'une équipe écrasant tous les défauts | Résolution type par type |
| Projets vérifiés un par un (jusqu'à 10 s chacun) | Vérification en parallèle |

## Tests

- **Typecheck** propre, **118 tests unitaires** (30 nouveaux), builds desktop, MCP et web OK, shellcheck propre.
- **Kit sur le VPS** : S2b-1 (`instance sync`, second passage sans effet), S2b-2 (auteur : lecture OK, modification refusée en 403 ; propriétaire : modification acceptée lors du paramétrage des tests), S2b-14 (lien et message d'invitation).
- **Tests d'interface du desktop** (`pnpm test:e2e:desktop`, Playwright Electron, profil et trousseau isolés) — **11/11** contre `acme` :

| Test | Couvre |
|---|---|
| Sans compte : écran GitHub inchangé | S2-1 |
| Politique DSI : seul le serveur de l'entreprise, GitHub masqué | S2-2, S2-19 |
| Politique DSI : invitation vers un autre serveur ignorée | S2b-6 (sécurité) |
| Invitation pré-remplie, pas d'auto-connexion ; langue de l'équipe (en), puis choix personnel (fr) conservé au redémarrage | S2b-6, S2b-10, critère 21, 23 |
| Second lancement : lien transmis à la fenêtre ouverte, seconde instance arrêtée | S2b-7 |
| Mauvais mot de passe ; compte neuf → changement de mot de passe proposé | S2-15 |
| 2FA : champ code, connexion | S2-5 |
| Testeur : « Projets de votre équipe », clone, ouverture sur Campagnes | S2b-8, UC13 |
| Lecteur : mises à jour verrouillées, « équipes : lecteurs » | S2b-9, UC14 |
| Compte désactivé : bannière unique, « Se reconnecter » pré-rempli, bannière levée | S2-9, S2-10, S2-11 |
| Déconnexion, y compris au démarrage suivant ; ligne d'aide sur le jeton | S2-6 |

- **Intégration** (`scripts/forge-smoke.ts`) : 22/22 sur Forgejo et sur Gitea (régression S2).

## Reste à valider manuellement

- L'installateur NSIS enregistre bien `polenta://` (build `pnpm package`, puis clic sur un lien depuis un e-mail).
- Lecture du modèle `config.yaml` par l'admin d'un client dans l'interface web de la forge.

## Mises à jour SPEC

Aucune à ce sprint (dernier sprint, design §10). À ajouter à la liste : configuration par équipe
et invitation dans `SPEC-ACCOUNTS-AUTH.md`, projets d'équipe dans `SPEC-ELECTRON-DESKTOP.md` §16.
