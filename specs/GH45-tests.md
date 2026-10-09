# GH45 — Scénarios de test : serveur git auto-hébergé (Forgejo)

Références : `specs/GH45.md` (UC1–UC11, critères 1–20), `specs/GH45-design.md`.

Légende :
- **[A]** test automatique : vitest `apps/desktop/src/main/services/**/*.test.ts`, ou
  `deploy/tests/acceptance.sh` ;
- **[M]** test manuel.

Environnement :
- hôte = VPS `vps-f515f9c6` (Debian 13), sans client ;
- `BASE_DOMAIN = forge.<domaine>` ;
- instances de test `acme` et `globex` ;
- instance Gitea temporaire `gitea-test` (`FORGE_IMAGE=gitea/gitea`), pour S2 uniquement.

## Sprint 1 — Infra de base

### Nominal
| ID | Scénario | Attendu |
|---|---|---|
| S1-1 [M] | Copier `deploy/` sur l'hôte, remplir `host.env`, `sudo ./polenta-host.sh setup`. | Docker, ufw, fail2ban, unattended-upgrades, restic et Caddy installés ; sortie 0 ; durée < 10 min. |
| S1-2 [M] | Relancer `setup`. | « rien à faire » pour chaque étape ; aucun fichier modifié (`find /etc /opt/polenta -newer <repère>` vide hors journaux) ; sortie 0 (critère 13). |
| S1-3 [M] | `polenta-host instance add acme --domain acme.forge.<domaine> --org acme --client-admin alice alice@…`. | HTTPS valide en < 5 min après DNS ; récapitulatif avec `config.json` ; équipes `auteurs`/`testeurs`/`lecteurs` ; 5 repos de démo importés ; `polenta-repo.yaml` de la racine ne contient plus `github.com` (UC1). |
| S1-4 [M] | Relancer la même commande `instance add acme`. | Refus explicite « instance déjà existante » ; rien n'est modifié. |
| S1-5 [M] | `instance add globex --domain globex.forge.<domaine> --no-demo`. | Seconde forge en HTTPS ; `acme` toujours en service pendant l'ajout (sonde `healthz` chaque seconde, aucun échec) (UC1b). |
| S1-6 [M] | `instance list`. | Deux lignes : domaine, version, santé `ok`, disque. |
| S1-7 [M] | `polenta-admin --instance acme user add bob bob@… --team auteurs`. | Compte créé, mot de passe temporaire affiché (pas de SMTP), changement imposé à la première connexion ; ligne dans `admin.log` sans mot de passe. |
| S1-8 [M] | `user import` d'un CSV de 10 lignes, dont 2 invalides (e-mail vide, équipe inconnue). | 8 OK, 2 ERREUR avec leur motif ; l'import va au bout (UC2). |
| S1-9 [M] | `team add projet-x write <repo>` puis `team member add projet-x bob`. | bob voit `<repo>` en écriture, et les autres repos selon ses autres équipes. |
| S1-10 [M] | `project create essai --team projet-x`. | Repo privé `acme/essai` avec `.gitignore` + `AGENTS.md` ; ouvrable dans Polenta. |
| S1-11 [M] | `oauth-app create polenta-web https://web.acme.forge.<domaine>/auth/callback`. | Client id/secret affichés ; application visible dans l'admin Forgejo. |
| S1-12 [M] | `instance stop acme` puis `start acme`. | `acme` indisponible puis de retour ; `globex` jamais interrompu. |

### Sécurité / isolation
| ID | Scénario | Attendu |
|---|---|---|
| S1-13 [A] | `deploy/tests/acceptance.sh acme.forge.<d> globex.forge.<d>` depuis le poste de dev. | HTTPS valide ; page d'accueil → connexion ; `/user/sign_up` refusé ; 22/80/443 ouverts, 3000/2222/8080 fermés ; HSTS, `X-Content-Type-Options` et `Referrer-Policy` présents (critère 14). |
| S1-14 [M] | Se connecter sur `globex` avec un compte d'`acme`. | Refusé (UC1b, critère 15). |
| S1-15 [M] | `docker exec forgejo-acme wget -qO- http://forgejo-globex:3000` puis par l'IP du conteneur `globex`. | Nom non résolu ; IP injoignable (critère 15). |
| S1-16 [M] | Création d'un repo **public** par alice dans l'interface web. | Forcé en privé. |
| S1-17 [M] | `user add` avec `--instance` omis alors qu'il y a 2 instances. | Erreur qui liste `acme`, `globex`. |
| S1-18 [M] | `instance add` avec un domaine qui ne résout pas vers l'hôte. | Refus avant toute création, avec l'IP attendue et l'IP trouvée. |
| S1-19 [M] | `setup` alors qu'aucune clé n'est dans `authorized_keys` (VM de test ou utilisateur temporaire). | Avertissement ; `sshd_config` non modifié ; l'admin garde son accès par mot de passe. |
| S1-20 [A] | `shellcheck deploy/**/*.sh` (sur l'hôte). | Zéro avertissement. |

### Point de vérification API (design §6)
| ID | Scénario | Attendu |
|---|---|---|
| S1-21 [M] | Vérifications §6.1 à §6.7 sur `acme` et `gitea-test`. | Résultats consignés dans `GH45-sprint1.md` ; fixtures JSON enregistrées pour les tests unitaires du S2 ; design corrigé si un résultat le contredit. |

## Sprint 2 — P0 Polenta

### Nominal
| ID | Scénario | Attendu |
|---|---|---|
| S2-1 [M] | Poste sans `config.json`, compte GitHub existant : mise à jour vers GH45, lancement. | Compte actif, projets et Device Flow inchangés ; écran de connexion identique à ece9810 (UC10, critère 3). |
| S2-2 [M] | `config.json` = `{defaultServer: acme, hideGithub: true, demoProjectUrl: …}` via `POLENTA_CONFIG`. Premier lancement. | Écran de connexion : serveur `acme` seul, identifiant + mot de passe ; ni github.com, ni gitlab.com, ni Device Flow (UC3, critère 3). |
| S2-3 [M] | Connexion bob / mot de passe. | Compte `acme.forge.<d>:bob` créé ; jeton `polenta-<poste>-<date>` visible dans les paramètres Forgejo de bob ; accueil affiché. |
| S2-4 [M] | Bouton Démo, puis éditer une exigence et Publier. | Démo clonée depuis `acme` (5 repos) ; `git log` sur le serveur : auteur = nom complet et e-mail Forgejo de bob (UC4, critère 1). |
| S2-5 [M] | Activer la 2FA pour bob, se déconnecter, se reconnecter. | Champ code affiché après le premier envoi ; connexion OK avec le code ; le login n'est pas ressaisi. |
| S2-6 [M] | Déconnexion. | Retour à la connexion ; ligne d'aide sur la révocation du jeton côté Forgejo ; jeton absent du trousseau. |
| S2-7 [M] | `autoUpdate: false` dans `config.json`, lancement d'un build packagé, journal réseau (proxy ou `[update]`). | Aucune requête vers github.com ; case « Vérifier les mises à jour » désactivée avec infobulle (critère 4). |
| S2-8 [M] | Refaire S2-2 à S2-5 contre `gitea-test`. | Identique (UC11, critère 11). |

### Accès révoqué / insuffisant
| ID | Scénario | Attendu |
|---|---|---|
| S2-9 [M] | Projet ouvert ; `polenta-admin user disable bob` ; attendre 2 ticks d'auto-pull (intervalle réduit en dev). | Bannière « accès révoqué » **une seule fois** ; aucun nouveau message ni `console.warn` aux ticks suivants ; working tree intact (`git status` identique) (UC7, critères 5 et 19). |
| S2-10 [M] | Pendant S2-9, tenter Publier. | Commit local créé ; message 401 lisible, sans marqueur visible ; bannière déjà présente, pas dupliquée. |
| S2-11 [M] | `user enable bob`, puis « Se reconnecter » depuis la bannière. | Écran de connexion avec le serveur pré-rempli ; après connexion, bannière levée et auto-pull repris ; le push en attente part au tick suivant. |
| S2-12 [M] | Charlie (équipe `lecteurs`) : modifier puis Publier. | Commit local conservé (`git log`) ; message « Vous n'avez pas le droit de publier sur … » (UC6, critère 6). |
| S2-13 [M] | Ouvrir un workspace dont un composant est dans un repo sans accès pour bob. | Message GH30 version forgejo : « Demandez à l'administrateur… », sans « scope repo » (spec §5.4). |
| S2-14 [M] | Même cas avec un compte GitHub sur un repo GitHub privé inaccessible. | Message GH30 GitHub actuel, inchangé. |

### Connexion — erreurs
| ID | Scénario | Attendu |
|---|---|---|
| S2-15 [A]/[M] | Mauvais mot de passe ; code 2FA invalide ; compte désactivé ; URL `https://example.com` ; serveur injoignable. | Messages distincts : identifiants invalides / code invalide / compte désactivé / « n'est pas un serveur Forgejo/Gitea » / message réseau (spec §4.4). [A] avec les fixtures du S1. |
| S2-16 [A] | Erreur de création de jeton : contenu du message, du journal et de `auth.json`. | Le mot de passe n'apparaît nulle part (critère 2). |
| S2-17 [A] | Identité introuvable (`/api/v1/user` en 500) au `persistToken` d'un compte `forgejo`. | La connexion échoue ; aucun compte « Git User » créé. |

### Configuration machine
| ID | Scénario | Attendu |
|---|---|---|
| S2-18 [A] | JSON invalide ; clé inconnue ; `defaultServer: "ftp://x"` ; `autoUpdate: true` ; fichier absent. | Configuration par défaut, ou clé ignorée, avec avertissement journalisé ; jamais d'exception. |
| S2-19 [M] | `hideGithub: true` sans `demoProjectUrl`. | Bouton Démo masqué. |
| S2-20 [M] | `hideGithub: true` et un compte GitHub déjà enregistré. | Projets GitHub toujours utilisables (push/pull) ; seule la connexion GitHub est masquée. |

### Non-régression et structure
| ID | Scénario | Attendu |
|---|---|---|
| S2-21 [A] | `pnpm -r typecheck`, `pnpm --filter @polenta/desktop test`, lint. | Zéro erreur nouvelle (critère 12). |
| S2-22 [A] | `pnpm --filter @polenta/desktop build:web-server` et `build:mcp-server`. | Builds OK : la couche forge n'importe ni `electron` ni `keytar` (critère 10). |
| S2-23 [A] | `grep -rn "github.com" apps/desktop/src/main apps/desktop/src/renderer --include=*.ts --include=*.tsx`. | Seulement `github.provider.ts`, `LEGACY_BARE_TOKEN_HOSTS`, `update.service.ts` (URL des releases), `demoProject.ts` et l'ouverture de la page de release (critère 9). |
| S2-24 [A] | `forge-access` : `encode` puis `parse` aller-retour, avec le préfixe IPC Electron `Error invoking remote method 'sync:push': Error: `. | Problème d'accès et texte lisible retrouvés. |
| S2-25 [A] | `forgejo.provider` sur un serveur simulé : `listRepos` sur 120 repos (3 pages), `createOrgRepo` → 409. | 120 repos ; erreur « nom pris ». |
| S2-26 [M] | Web (GH44, mode dev) : `auth:login-password` appelé depuis la console. | Refusé (channel non exposé) ; `app:get-machine-config` renvoie la forge de `POLENTA_WEB_GIT_HOSTS`. |

## Sprint 3 — Infra exploitation

| ID | Scénario | Attendu |
|---|---|---|
| S3-1 [M] | `instance backup --all`, puis `restic snapshots` pour chaque instance. | Un snapshot par instance ; coupure de chacune < 30 s ; ping de supervision reçu. |
| S3-2 [M] | Ouvrir le dépôt restic de `globex` avec le mot de passe d'`acme`. | Refus (critère 16). |
| S3-3 [M] | Couper l'accès S3 (mauvaise clé) pour `acme` seulement, puis `backup --all`. | `acme` en échec signalé (ping `/fail`) ; `globex` sauvegardé. |
| S3-4 [M] | `instance restore acme --from latest --domain acme-restore.forge.<d>`. | Seconde copie fonctionnelle : comptes, équipes, repos, historique, 2FA de bob (le `SECRET_KEY` est restauré). |
| S3-5 [M] | `instance update acme 99.99.99`. | Échec du pull ; rien de changé ; message ; forge OK (critère 17). |
| S3-6 [M] | `instance update acme <version LTS suivante ou précédente valide>`. | Mise à jour OK ; `globex` jamais interrompu ; sinon retour arrière automatique vérifié. |
| S3-7 [M] | Retour arrière forcé : `healthz` simulé en échec (variable de test du script). | Snapshot `pre-update` restauré ; ancienne version en service ; données identiques. |
| S3-8 [M] | `instance export globex`. | Archive + `.sha256` ; contenu : dump, `data/`, `instance.env` sans `OPS_TOKEN` ni identifiants S3, `LISEZMOI.md`. |
| S3-9 [M] | Remonter l'export de `globex` avec l'image Forgejo officielle en suivant `LISEZMOI.md` (instance temporaire sur l'hôte, hors kit). | Forge identique (critère 18). |
| S3-10 [M] | `instance remove globex` (saisie du nom). | Export préalable ; plus de conteneur, de réseau, de site ni de dossier `globex` ; `acme` jamais interrompu (UC1c). |
| S3-11 [M] | 10 échecs de connexion depuis une IP de test sur `acme`. | IP bannie (chaîne `DOCKER-USER`) pour 80/443 ; levée après 1 h ou `fail2ban-client unban`. |
| S3-12 [M] | `polenta-admin --instance acme access report --csv`. | Une ligne par (utilisateur, repo), avec le droit effectif maximal ; cohérent avec S1-9. |
| S3-13 [M] | **Réinstallation complète de l'OS** (console OVH), puis copie du kit, `setup`, puis `instance restore acme --from latest`. | `acme` identique, sous le même domaine ; un poste Polenta déjà connecté reprend push/pull sans reconnexion (UC9, critère 16). |
| S3-14 [M] | Relecture du RUNBOOK par le demandeur : préparer un hôte, ajouter un client et un utilisateur, restaurer. | Validé (critère 20). |
| S3-15 [M] | Fin de campagne : réinstallation de l'OS (console OVH) avant tout client. | Hôte vierge prêt pour la production (spec §9.9). |

## Sprint 4 — P1 Polenta

| ID | Scénario | Attendu |
|---|---|---|
| S4-1 [M] | Accueil « Depuis un repo » avec un compte `acme`. | Liste des repos accessibles, recherche, badge « lecture seule » ; clone au clic (UC4). |
| S4-2 [M] | Compte qui voit plus de 50 repos (créés par script). | Tous listés (critère 7). |
| S4-3 [M] | « Saisir une URL » depuis la liste. | Flux actuel. |
| S4-4 [M] | Deux comptes `forgejo` (acme et gitea-test). | Sélecteur de compte. |
| S4-5 [M] | « Créer » → « Sur le serveur » par bob (`auteurs`). | Repo privé dans `acme`, branche `main` poussée, projet ouvert (UC5, critère 8). |
| S4-6 [M] | Même action par charlie (`lecteurs` seulement). | Option désactivée, avec explication. |
| S4-7 [M] | Nom déjà pris. | Erreur avant toute création locale ; aucun dossier créé. |
| S4-8 [M] | Créer sur le serveur avec le réseau coupé juste après la création distante (proxy de test). | Projet local ouvert, `origin` configuré, avertissement « publiez plus tard » ; repo distant conservé. |
| S4-9 [M] | `AddDependencyModal` → « Créer le repo sur le serveur ». | Repo composant créé et initialisé ; URL remplie ; ajout et clone OK. |
| S4-10 [M] | Champ de type `user` dans un repo `acme`. | Autocomplétion des membres (login + nom) ; login enregistré dans le YAML ; saisie libre acceptée (UC8). |
| S4-11 [M] | Même champ hors ligne, et dans un repo GitHub. | Texte libre, aucun message. |
| S4-12 [M] | Charlie ouvre un projet. | Bandeau « lecture seule » non bloquant (UC6). |
| S4-13 [M] | Web (GH44 mode dev, forge = acme) : S4-1, S4-5, S4-10. | Identique au desktop dans l'espace serveur. |
| S4-14 [A] | Typecheck, tests, builds web et MCP. | Zéro erreur nouvelle. |

## Parcours de non-régression (fin de S2 et de S4)

Desktop + compte GitHub, sans `config.json` :
- connexion par jeton et par Device Flow ;
- démo GitHub ;
- Publier, auto-pull, Résoudre les conflits (GH37) ;
- création de projet locale (GH27) ;
- ajout d'un composant par URL ;
- exports.

Attendu : identique à ece9810.
