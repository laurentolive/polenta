# GH53 — Design : forge interne avec autorité de certification privée

Spec validée : `specs/GH53.md` (réponses du 2026-11-27 : `.pem` déployé par la DSI, CA ajoutée et non substituée, ordre GH53 puis GH52).
Sprints : **S1** poste (desktop) — CA lue depuis la config machine, appliquée à l'API et à git. **S2** kit — certificat fourni pour une instance.

## 1. Décisions de design

| Sujet | Décision | Alternative rejetée |
|---|---|---|
| Où vit la CA sur le poste | Clé de config machine `caPath` (chemin absolu d'un PEM), lue une fois au démarrage | Lecture du magasin Windows `ROOT` : Windows seulement, plus complexe |
| Mode d'ajout | La CA s'**ajoute** aux racines publiques de Node (`tls.rootCertificates`). Un `ca` seul remplacerait les racines : GitHub et Let's Encrypt cesseraient de fonctionner | `ca` seul |
| git | `http.sslCAInfo` pointe vers un **bundle combiné** : bundle CA de git embarqué + CA de l'entreprise, écrit dans `userData/ca/git-ca-bundle.pem`. Même raison : `sslCAInfo` remplace le bundle | Un PEM seul (casserait git vers les hôtes publics) |
| Repli si le bundle git est introuvable | Avertissement journalisé, pas de `sslCAInfo` : git reste sur ses réglages, le poste ne démarre pas en erreur | Arrêt |
| Erreur de fichier | Chemin absent, illisible ou sans bloc `BEGIN CERTIFICATE` : avertissement, `[]`, comportement de `origin/main` | Erreur bloquante |
| Certificat fourni (kit) | Option `instance add --tls-cert F --tls-key F`. Fichiers copiés dans `instances/<nom>/tls/` (sauvegardés et supprimés avec l'instance), rendus dans `etc/tls/<nom>/` du Caddy au moment de `caddy_add_site` | Montage direct de l'hôte (non sauvegardé, non supprimé) |
| Mode external | Refusé explicitement (« le certificat relève du Caddy de l'exploitant ») | Générer un bloc qui référence des fichiers que le Caddy de l'exploitant ne voit pas |
| Renouvellement | **Hors V1** : re-créer l'instance ou ré-exécuter une commande dédiée, à décider (question ouverte) | Commande `instance tls` dans ce ticket |

## 2. Sprint S1 — poste

### Fichiers

- `packages/types/src/forge.ts` : `MachineConfig.caPath?: string` (documenté : PEM, racine ou chaîne, ajouté aux CA publiques).
- `apps/desktop/src/main/services/machine-config.ts` : clé `caPath` ; chaîne non vide, sinon avertissement. Le fichier n'est pas lu ici (le chargeur reste pur).
- **Nouveau** `apps/desktop/src/main/services/extra-ca.ts` :
  - `parsePemCertificates(text)` : extrait les blocs `-----BEGIN CERTIFICATE-----` … `-----END CERTIFICATE-----`.
  - `loadExtraCaCertificates({ path, readFile, warn })` : `[]` + avertissement si absent, illisible ou sans certificat.
  - `setExtraCaCertificates(pems)` / `extraCaCertificates()` : état de processus, fixé une fois au démarrage.
  - `tlsOptionsCa()` : `undefined` si aucune CA, sinon `[...tls.rootCertificates, ...extra]`.
  - `writeGitCaBundle(defaultBundle, extra, dest)` : concatène et écrit ; `null` si le bundle par défaut est introuvable (avertissement).
- `apps/desktop/src/main/host/electron-host.ts` : lecture du fichier (même `readFile` que la config machine) puis `setExtraCaCertificates`.
- `apps/desktop/src/main/services/net-proxy.ts` : `ca` dans `connect` (Agent), `proxyTls` et `requestTls` (ProxyAgent). La clé de cache inclut un indicateur `ca` pour ne pas réutiliser un agent sans CA.
- `apps/desktop/src/main/git/git-backend.ts` (`netRun`) : si une CA est définie et que l'URL est `https`, ajouter `-c http.sslCAInfo=<bundle>`.

### Chemin du bundle git

Le bundle par défaut de Git for Windows se trouve sous la racine de l'installation embarquée (`gitInstall.gitDir`). **À vérifier sur le PortableGit réellement embarqué** (`pnpm git:fetch`) avant de figer le chemin ; le chemin exact est un point de contrôle de S1 (voir tests T-G1).

### Risques

- `tls.rootCertificates` est une liste figée de Node ; elle est à jour avec la version de Node embarquée dans Electron, pas avec le magasin système. Acceptable pour V1 (les CA publiques courantes y figurent).
- Le cache de dispatchers est par processus : un changement de `caPath` exige un redémarrage (la config machine est déjà lue une fois).

## 3. Sprint S2 — kit

### Fichiers

- `deploy/polenta-host.sh` : `instance add` accepte `--tls-cert F --tls-key F` (les deux, ensemble). Contrôles avant toute création : fichiers lisibles ; `openssl x509` lit le certificat ; `openssl pkey` lit la clé ; les clés publiques correspondent. Sinon `E_USAGE`, rien n'est créé. En `CADDY_MODE=external` : refus explicite.
  - Copie : `instances/<nom>/tls/cert.pem` (644), `key.pem` (600). `instance.env` : `TLS_PROVIDED=1`.
- `deploy/lib/caddy.sh` :
  - `caddy_render_site` : si `TLS_PROVIDED=1`, une ligne `tls /etc/caddy/tls/<nom>/cert.pem /etc/caddy/tls/<nom>/key.pem` dans le bloc. Sans l'option, le rendu est **octet pour octet identique** (test de non-régression du test d'acceptation).
  - `caddy_add_site` : copie `instances/<nom>/tls/` vers `$POLENTA_CADDY/etc/tls/<nom>/` avant `site_apply`.
  - `caddy_remove_site` : supprime `$POLENTA_CADDY/etc/tls/<nom>/`.
- `deploy/RUNBOOK.md` : section « Certificat fourni » (A3), échéance à surveiller, renouvellement hors V1.

### Chemins dans le conteneur

Le Caddy monte `$POLENTA_CADDY/etc` en `/etc/caddy` (lecture seule) : les fichiers rendus sont donc visibles sous `/etc/caddy/tls/<nom>/`.

## 4. Hors périmètre

- Renouvellement d'un certificat fourni (question ouverte).
- Alerte d'échéance (proposition de la spec, non confirmée : à confirmer).
- Mode external pour le certificat fourni.
- VPN et DNS interne (à la charge du client).
- Lecture du magasin Windows.
