# GH52 — Design : mises à jour servies par le serveur du client

Spec validée : `specs/GH52.md`. Réponses du 2026-11-27 : publication manuelle en V1 ; GH388 (signature) ne concerne que le client lourd, et #52 cible justement le client lourd ; ordre GH53 puis GH52.

**Correction de la spec (vérifiée dans le code, 2026-11-27)** : electron-updater 6.8.3 passe par `electron.net` (Chromium), pas par Node (`electronHttpExecutor.js:54`). Chromium sur Windows lit le magasin de certificats système. Donc :
- les **mises à jour** s'appuient sur le magasin Windows : si la DSI installe la CA de l'entreprise dans le magasin, elles fonctionnent sans le fichier `.pem` de GH53 (à vérifier sur un poste réel) ;
- l'**API de la forge** et **git** restent concernés par GH53 (undici et bundle git).
Conséquence : #52 ne dépend pas techniquement de #53 pour les mises à jour. L'ordre décidé (53 puis 52) reste valable pour la forge ; à reconfirmer.

## 1. Décisions de design

| Sujet | Décision | Alternative rejetée |
|---|---|---|
| Où se configure le flux | Clé de config machine `updateFeedUrl` (URL https, base du dossier), lue une fois au démarrage | Clé d'équipe (lue depuis la forge : circulaire) ; build par client |
| Mécanisme | `autoUpdater.setFeedURL({ provider: 'generic', url })` à l'exécution, binaire inchangé | Recompiler l'installeur par client |
| Repli GitHub | **Aucun** quand `updateFeedUrl` est présent : le poste n'interroge plus GitHub | Repli GitHub (fuite réseau, délais) |
| Publication | Commande du kit `polenta-host updates publish <version> <dossier>`. Les artefacts viennent d'une release téléchargée par l'exploitant (le kit ne construit rien) | Le kit télécharge depuis GitHub (le serveur du client n'a pas forcément accès) |
| Ordre de publication | Copie des artefacts d'abord, `latest.yml` **en dernier** et de façon atomique (fichier temporaire puis `mv`) : un client ne voit jamais un `latest.yml` qui pointe vers un fichier absent | Copie directe |
| Stockage et service | `$POLENTA_CADDY/etc/updates/` (déjà monté en lecture seule dans le Caddy, donc pas de changement du compose), servi par une route Caddy `handle_path /polenta-updates/*` dans **chaque** bloc d'instance | Montage supplémentaire (recréation du conteneur Caddy) |
| Authentification | Aucune sur `/polenta-updates/` : les installeurs ne sont pas secrets (même régime que GitHub). L'intégrité repose sur le `sha512` de `latest.yml`, vérifié par electron-updater | Auth HTTP (le client doit la configurer sur chaque poste) |
| Mode external | Non pris en charge en V1 : le kit ne touche pas au Caddy de l'exploitant. Documenté : la route `/polenta-updates/` doit être ajoutée à la main | Générer des blocs dans un Caddy qui n'est pas le nôtre |
| Signature | Hors de ce code : prérequis de mise en production du client lourd (GH388) | Bloquer #52 sur GH388 |

## 2. Sprint S1 — poste (desktop)

### Fichiers

- `packages/types/src/forge.ts` : `MachineConfig.updateFeedUrl?: string`.
- `apps/desktop/src/main/services/machine-config.ts` : clé `updateFeedUrl`, validée comme `defaultServer` (`httpUrl`, https obligatoire hors `localhost`) ; forme normalisée avec `/` final ; sinon avertissement et clé ignorée.
- `apps/desktop/src/main/services/update.service.ts` : `UpdateService` reçoit l'URL (paramètre optionnel). Dans `scheduleStartupCheck`, **avant** le premier `checkForUpdates`, si l'URL est présente : `autoUpdater.setFeedURL({ provider: 'generic', url })`. Log sans les identifiants éventuels de l'URL.
- `apps/desktop/src/main/services/container.ts` (ou l'endroit où `UpdateService` est construit) : passe `machineConfig.updateFeedUrl`.

### Comportement

- Sans `updateFeedUrl` : aucun changement (comportement de `origin/main`).
- Avec `updateFeedUrl` : vérification, téléchargement manuel ou automatique, installation : mêmes règles qu'aujourd'hui, mais sur le flux du serveur.
- `autoUpdate: false` et verrou d'équipe (`updates: managed`) : aucune vérification, quel que soit le flux (règle existante, inchangée).
- Flux injoignable ou réponse invalide : même traitement qu'un GitHub injoignable (état d'erreur, pas de blocage du démarrage).

### Point ouvert pour le Design détaillé

- `BRAND.update` absent (marque sans source) : la vérification est court-circuitée aujourd'hui. Proposition : un flux configuré l'active aussi, sinon la clé n'aurait d'effet que pour Polenta. À confirmer en S1 en lisant `app-settings` et `brand.yaml`.

## 3. Sprint S2 — kit

### Fichiers

- `deploy/polenta-host.sh` : sous-commande `updates publish <version> <dossier>`.
  - Contrôles avant toute copie : `latest.yml` présent dans `<dossier>` ; chaque fichier référencé (`url:` et `path:` de `latest.yml`) présent ; version cohérente avec `latest.yml` ; `sha512` vérifié si `sha512sum`/`openssl` disponible.
  - Copie des artefacts dans `$POLENTA_CADDY/etc/updates/` (sans écraser un fichier existant de même nom : refus), puis `latest.yml` par fichier temporaire + `mv`.
  - Journal dans `host.log` (action, version).
- `deploy/lib/caddy.sh` : `caddy_render_site` ajoute, dans chaque bloc d'instance :
  ```
  handle_path /polenta-updates/* {
      root * /etc/caddy/updates
      file_server
  }
  ```
  Conséquence : le rendu de tous les blocs change (une route de plus). Le test de non-régression octet pour octet de GH53 est à mettre à jour (le nouveau rendu est la référence).
- `deploy/RUNBOOK.md` : section « Mises à jour servies par le serveur (GH52) » : publication, vérification, mode external (route à ajouter à la main), rollback (republier une version précédente : hors V1).

### Risques

- Route publique sur le domaine de la forge : seule `/polenta-updates/` est concernée ; `file_server` ne sert que le dossier.
- Un `latest.yml` écrit à la main peut référencer un artefact absent : le contrôle préalable l'empêche.

## 4. Hors périmètre

- Signature Windows des installeurs (GH388).
- Construction des artefacts et publication depuis GitHub.
- Mode external.
- Retour arrière automatisé (republier une version antérieure est manuel).
- Canaux (bêta, stable) : une seule piste.
