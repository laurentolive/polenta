# GH53 — Scénarios de test

Niveaux (WORKFLOW § Niveaux de vérification) : 1 ciblé pendant le sprint ; 2 en fin de sprint (`pnpm test` complet + e2e du ticket si pertinent) ; 3 (suite e2e complète) seulement au push du lot.

## S1 — poste (vitest)

| ID | Scénario | Attendu |
|---|---|---|
| T-M1 | `caPath` chaîne non vide dans `config.json` | `machineConfig.caPath` renseigné |
| T-M2 | `caPath` vide, nombre ou objet | avertissement, clé ignorée, autres réglages inchangés |
| T-M3 | Aucune `caPath` | configuration identique à `DEFAULT_MACHINE_CONFIG` (non-régression) |
| T-X1 | PEM avec deux certificats | `parsePemCertificates` renvoie deux blocs |
| T-X2 | Fichier absent | `[]` + avertissement, pas d'exception |
| T-X3 | Fichier sans bloc `BEGIN CERTIFICATE` | `[]` + avertissement |
| T-X4 | `tlsOptionsCa()` sans CA | `undefined` |
| T-X5 | `tlsOptionsCa()` avec une CA | contient toutes les racines de `tls.rootCertificates` **et** la CA (la liste publique n'est pas perdue) |
| T-P1 | Serveur HTTPS de test signé par une CA de test (fixtures), requête via `resolveProxyDispatcher` **avec** la CA | 200 |
| T-P2 | Même serveur, dispatcher **sans** CA | échec TLS (`SELF_SIGNED_CERT_IN_CHAIN` ou `UNABLE_TO_VERIFY_LEAF_SIGNATURE`) |
| T-P3 | Cache : agent créé sans CA puis avec CA | deux agents distincts (pas de réutilisation) |
| T-G1 | Chemin du bundle git par défaut sur le PortableGit embarqué | fichier trouvé ; **si non, arrêter S1 et corriger le chemin** |
| T-G2 | `writeGitCaBundle` | le bundle écrit contient le bundle par défaut et la CA |
| T-G3 | `netRun` sur URL `https` avec CA | arguments contiennent `-c http.sslCAInfo=<bundle>` |
| T-G4 | `netRun` sur URL `https` sans CA, ou URL `ssh` avec CA | aucun `http.sslCAInfo` |
| T-G5 | Bundle par défaut introuvable | avertissement, pas de `http.sslCAInfo`, pas d'exception |
| T-E2E | git clone `https://` depuis le serveur de test (`e2e-web/support/git-http-server.ts`) avec CA | non prévu en S1 : le serveur de test est en HTTP ; à traiter si un serveur HTTPS de test est disponible (sinon noté comme non couvert) |

Fixtures : `apps/desktop/src/main/services/fixtures/extra-ca/` — CA de test et certificat serveur pour `localhost`, validité longue, **clés de test uniquement**.

## S2 — kit (bash, sans Docker)

| ID | Scénario | Attendu |
|---|---|---|
| T-K1 | `instance add --tls-cert` sans `--tls-key` | refus `E_USAGE`, rien créé |
| T-K2 | Certificat et clé qui ne correspondent pas | refus, rien créé |
| T-K3 | Fichier absent ou non PEM | refus, rien créé |
| T-K4 | Paire valide en `CADDY_MODE=managed` | `tls/cert.pem` (644) et `tls/key.pem` (600) présents, `TLS_PROVIDED=1` |
| T-K5 | `caddy_render_site` avec `TLS_PROVIDED=1` | ligne `tls /etc/caddy/tls/<nom>/cert.pem /etc/caddy/tls/<nom>/key.pem` |
| T-K6 | `caddy_render_site` sans `TLS_PROVIDED` | sortie **identique** à `origin/main` (octet pour octet) |
| T-K7 | `caddy_add_site` | `etc/tls/<nom>/` copié depuis `instances/<nom>/tls/` |
| T-K8 | `caddy_remove_site` | `etc/tls/<nom>/` supprimé |
| T-K9 | `--tls-cert` en `CADDY_MODE=external` | refus explicite, rien créé |

Exécution : le test bash est lancé localement (Git Bash) avec `openssl` ; les scénarios Docker (`instance add` complet) restent à faire sur un hôte de test, comme GH84.

## Validation humaine (à faire, non automatisable ici)

1. Poste Windows de test : `config.json` avec `caPath` pointant vers la CA de test ; connexion à une forge HTTPS signée par cette CA ; clone d'un dépôt ; mise à jour de l'appli inchangée.
2. Poste sans `caPath` : comportement identique à aujourd'hui.
3. Hôte de test (VM) : `instance add … --tls-cert … --tls-key …` ; `https://<domaine>/api/healthz` répond avec le certificat fourni (`openssl s_client`).
