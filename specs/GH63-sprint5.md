# GH63 — Sprint 5 : opérations sensibles, fonctions sans équivalent Forgejo, RUNBOOK

Périmètre : `specs/GH63-design.md` §7 Sprint 5. Scénarios : `specs/GH63-tests.md` §Sprint 5.
Avant ce sprint : branche remise à jour sur `main` (91 commits, conflits résolus dans `platform.ts`,
`AppLayout.tsx` et les locales ; build web à nouveau possible sans correctif local, GH131 inclus).

## Fichiers

| Fichier | Changement |
|---|---|
| `deploy/polenta-host.sh` | `instance keys <nom> --json` : clé restic dans le résultat (fd 3) seulement, jamais au journal ; `require_operator`. |
| `apps/admin-service/src/jobs/registry.ts` | Nouvelles opérations : `backup.keys` (hôte, nom exigé, usage unique), `backup.restore` (nom de la cible, `pre-restore` par le kit), `export.run` (annulable), `export.delete` (archive de sa propre instance seulement), `s3.rotate` et `s3.purge` (hôte, secrets par descripteur, phrase exacte pour la purge), `users.import` (dépôt préalable). Confirmation `phrase` ; `fdSecrets`, `check`, `oneTime` par nom de clé à toute profondeur. |
| `apps/admin-service/src/jobs/runner.ts` | Secrets transmis sur le **descripteur 4** (tube, `k=v`), masqués dans le journal, jamais dans l'argv, `job.json`, l'audit ni sur disque ; fichiers déposés effacés en fin de travail ; extraction récursive des valeurs à usage unique (`created.3.temporaryPassword`). |
| `apps/admin-service/src/sensitive-routes.ts` (nouveau) | `GET /exports` (filtré à l'instance), `GET /exports/:file/download` (flux, droit revérifié, audité), `GET /host/s3` (endpoint, bucket, 4 derniers caractères), `GET /s3/purge-preview` (inventaire), `POST /users/import/preview` (dépôt CSV ≤ 5 Mo, aperçu du kit), `GET /users/access-report`, `GET /users/invite`. |
| `apps/admin-service/src/app.ts`, `service.ts` | Codes du kit 2/3 → 400, 6 → 422 en lecture directe ; purge refusée si l'instance existe encore ; secret relu → **404** (S5-3) ; dépôts abandonnés effacés après une heure. |
| `apps/desktop/src/web-server/admin/*` | Routes S5 relayées ; archive relayée **en flux** (pas de délai global, mémoire constante). |
| `apps/desktop/src/renderer/components/admin/*` | Sauvegardes : « Afficher la clé » (hôte) et « Restaurer » (confirmation par le nom) ; onglets **Exports**, **Utilisateurs** (import CSV avec aperçu, mots de passe téléchargeables en CSV une fois, rapport d'accès filtrable + CSV identique, message d'invitation, lien vers la forge `noopener`), **Stockage S3** (indice de clé, remplacement, purge en deux temps) ; `OneTimeSecret` (masqué, copie, téléchargement). |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | Clés `admin.*` du sprint. |
| `deploy/RUNBOOK.md` | **A17 « Administration depuis Polenta »** : architecture, installation, droits, audit, secrets, tableau opération ↔ commande SSH (26 lignes), refus volontaires, désinstallation. |
| `apps/admin-service/test/sensitive.test.ts`, `runbook.test.ts` (nouveaux), `fixtures/fake-kit.sh` | Tests S5 et cohérence RUNBOOK ↔ catalogue. |
| `deploy/tests/host-json.test.sh` | `instance keys --json`. |
| `apps/desktop/e2e-web/gh63-sensitive.spec.ts` (nouveau), `support/fake-admin-service.mjs` | E2E S5. |

## Divergences par rapport au design

1. **Lien de téléchargement** : pas de jeton court distinct. Le téléchargement passe par la session
   (cookie signé, `HttpOnly`) et le droit est revérifié par le service à chaque appel : un lien copié
   dans une autre session est refusé (S5-13) sans état supplémentaire.
2. **Dépôt CSV en JSON** (`{csv}`, 5 Mo) plutôt qu'en multipart : un seul chemin de relais, limite
   appliquée au web-server et au service.
3. **Rapport d'accès CSV généré par la page** à partir des lignes affichées (« CSV identique à
   l'affichage », S5-19), filtre compris.
4. **Purge en deux temps** : l'inventaire est une lecture (`/s3/purge-preview`), la purge un travail ; la
   page n'active la purge qu'après l'inventaire et exige la phrase exacte du kit.
5. **Secrets par descripteur sous Windows** : non transmis à bash MSYS (tests correspondants sautés
   sous Windows, verts sous Linux).

## Mises à jour SPEC

- `specs/SPEC-WEB.md` §7 (capacité `serverAdmin`, ligne « Administration du serveur »), §8
  (`POLENTA_ADMIN_URL`, `POLENTA_ADMIN_SERVICE_TOKEN`, `POLENTA_WEB_ADMIN_DEV`), **§12 nouveau**
  (administration du serveur : chemin, droit, découverte, renderer, tests).
- `specs/SPEC-INDEX.md` : ligne SPEC-WEB (mots-clés administration, MAJ → GH63).
- `specs/GH63-design.md` D10 et R1 (révisés au Sprint 2) ; `specs/GH63-tests.md` S2-14.

## Tests

- **Service** (Linux, conteneur `node:22`) : **121/121** — dont sentinelles (S5-1 : clé S3, nouvelle clé,
  clé de purge, jeton utilisateur, clé restic, mots de passe temporaires absents des réponses, journaux,
  audit, `job.json`, résultats), clé à usage unique et relecture 404 (S5-2, S5-3), mots de passe d'import
  (S5-4), purge (instance existante, sans clé, sans phrase, S5-7, S5-9), exports (filtre, flux, audit,
  autre instance refusée, S5-12 à S5-14), import (colonne manquante, > 5 Mo, doublon, dépôt effacé,
  S5-16/S5-17), rapport et invitation (S5-19, S5-20), audit (S5-22, S5-23), RUNBOOK (S5-28). Windows :
  118 verts, 3 sautés (SIGTERM, descripteur 4).
- **Serveur web** : 13 verts (dont archive de 3 Mo relayée en flux, routes S5).
- **E2E** (vrai navigateur, faux service) : `gh63-admin` 5/5 et `gh63-sensitive` 5/5 — S5-2, S5-5/S5-7,
  S5-10, S5-12/S5-14, S5-16, S5-19, S5-20, S5-21.
- **Kit** (Debian 13) : `host-json` 30, `host-ops` 36, `lib-common` 39, `admin-users` 22,
  `host-admin-env` 13 ; `shellcheck` sans avertissement.
- **VM** (WSL2 Ubuntu, Docker, systemd) : non-régression S2 (37 contrôles) et S3 (21 contrôles).
- **Suite desktop** : 936/936 après fusion de `main` ; `tsc` sans erreur.

Non exécutés (hôte complet nécessaire : vraie forge, stockage S3, DNS) : S5-6, S5-8, S5-11, S5-15,
S5-18 (SMTP), S5-24 (deux utilisateurs réels), S5-25 (hôtes jumeaux), S5-26 (`acceptance.sh` complet),
S5-27, S5-29 (installation sur hôte neuf).
