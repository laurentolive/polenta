# GH387 — Sprint 1 : chronométrage et clone modèle

## Fichiers modifiés

- `apps/desktop/e2e-web/support/session.ts` — chronométrage des hooks (`POLENTA_E2E_TIMINGS`), projet de
  départ copié d'un modèle par worker (signature = refs du repo nu de la forge), connexion et préparation
  du projet par requêtes HTTP (`rpc`) au lieu de charger l'application deux fois.
- `apps/desktop/e2e-web/support/helpers.ts` — `rpc(context, channel, ...args)` : `POST /rpc/<channel>` avec
  les cookies de session du contexte (même requête que le bridge web).
- `apps/desktop/e2e-web/support/timings.mjs` (nouveau) — résumé des mesures.

## Comportement

- Premier fichier d'un worker (ou repo nu publié depuis) : vrai clone, puis copie du workspace ouvert vers
  `<run>/templates/`. Fichiers suivants : copie du modèle (`fs.cpSync`, horodatages conservés), puis
  ouverture comme avant.
- `s.cloneAndOpen(...)` et les clones depuis l'UI gardent le vrai clone.
- `project: null` : `clear-last-opened` par requête, puis chargement de `/`.

## Divergences par rapport au design

- Ajout non prévu : connexion `/auth/login` par requête (`context.request`, redirection non suivie) et
  préparation du projet par `rpc` depuis le process de test. L'ancienne connexion chargeait `/`, qui
  rouvrait le projet de la spec précédente, avant de charger le dashboard.

## Mesures

`specs/GH387.md` § 6, passage M1 : 384 ✓, 1200 s ; `beforeAll` 4,3 s par fichier dont 3,2 s de
navigation initiale.
