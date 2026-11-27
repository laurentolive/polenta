# GH52 — Sprint 2 : publication des mises à jour et route /polenta-updates/ (kit)

Design : `specs/GH52-design.md` § 3. Scénarios : `specs/GH52-tests.md` S2.

## Fichiers modifiés

- `deploy/lib/updates.sh` (nouveau) : `updates_check`, `updates_publish` (refus de la version déjà publiée, artefacts d'abord
  sous nom caché puis renommés, `latest.yml` en dernier par renommage, refus en `CADDY_MODE=external`).
- `deploy/polenta-host.sh` : source de `lib/updates.sh`, sous-commande `updates publish <dossier>` (`cmd_updates`).
- `deploy/lib/caddy.sh` : `caddy_render_site` ajoute `handle_path /polenta-updates/*` (`root * /etc/caddy/updates`, `file_server`)
  avant le `reverse_proxy` de la forge.
- `deploy/RUNBOOK.md` : section « Mises à jour servies par le serveur du client (GH52) » après la section certificat fourni.
- Tests (nouveau) : `deploy/tests/updates-publish.test.sh` (K-P1 à K-P6, K-R1).

## Comportement implémenté

- Publication : contrôles (latest.yml, version, fichiers référencés, noms sûrs, pas de version déjà publiée) avant toute copie.
- Ordre : artefacts (et leurs `.blockmap`) d'abord, `latest.yml` en dernier, par renommage. Un échec de copie laisse `latest.yml`
  inchangé ; les fichiers partiels restent non référencés (noms cachés `.part` supprimés).
- Service : `https://<forge>/polenta-updates/` sert le dossier `etc/updates/` du Caddy du kit, sans authentification
  (installeurs publics, intégrité par `sha512` de `latest.yml`).

## Écarts avec le design

- **Rendu de tous les blocs** : la route est dans le bloc de **chaque** instance. Conséquence : le bloc Caddy ne correspond plus à
  `origin/main` octet pour octet. Ce que dit `specs/GH53-sprint2.md` n'est donc vrai qu'à la date de GH53 ; la référence est désormais
  le rendu de GH52. Une instance existante doit être remise à niveau (`instance sync`), documenté au RUNBOOK.
- **Mode external refusé** pour `updates publish` (règle GH61 : le kit ne crée pas de dossier Caddy en external). Le design le
  prévoyait « non pris en charge » : traduit en refus explicite et testé (K-P6).
- **Pas de contrôle `sha512`** dans le kit : electron-updater le vérifie à l'installation. À ajouter si l'on veut un refus à la publication.

## Défauts trouvés sur le VPS et corrigés (2026-11-27)

- **`instance sync` ne réécrivait pas le bloc en managé** : la route n'arrivait donc pas aux instances existantes, et le
  renouvellement de GH53 non plus. Le RUNBOOK et ce résumé disaient le contraire. Corrigé : `sync` appelle `caddy_add_site`
  dans les deux modes. Vérifié en banc (appel effectif) ; sur VPS, la route était absente après `sync` avant correction et
  présente après `stop`/`start` (même chemin de rendu).
- **Copie restaurée avec client web** : la copie reprenait `WEB_DOMAIN` de la source (déjà servi par elle) et son `web.env`.
  Caddy refusait le rechargement (« ambiguous site definition »). Corrigé : la copie ne reprend ni le domaine web ni `web.env`,
  avec un avertissement qui indique la commande `instance web enable`. Vérifié en banc et sur VPS.
- Connu, non corrigé : les refus d'usage affichent « Erreur inattendue (code N) » en plus du message utile (gestionnaire d'erreurs
  du kit, préexistant).

## Tests lancés

- `deploy/tests/updates-publish.test.sh` : vert (K-P1 à K-P6, K-R1).
- `deploy/tests/caddy-tls.test.sh` (GH53) : vert après l'ajout de la route.
- shellcheck : aucun avertissement sur `lib/updates.sh`, `tests/updates-publish.test.sh`, `lib/caddy.sh` ; `polenta-host.sh` sans
  avertissement.
- `instance add` / `instance sync` complets, route servie sur un hôte : non lancés (pas de Docker sur ce poste).

## Vérification manuelle à faire (VM de test)

1. `sudo polenta-host updates publish <dossier avec latest.yml et un installeur de test>`.
2. `curl -fsS https://<domaine de test>/polenta-updates/latest.yml` : 200, contenu identique.
3. `sudo polenta-host instance sync <nom>`, puis un `caddy validate` de la configuration rendue (ou `caddy reload` sans erreur).
4. Republier la même version : refus, `latest.yml` inchangé.
