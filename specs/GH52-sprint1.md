# GH52 — Sprint 1 : flux de mise à jour du serveur du client (poste)

Design : `specs/GH52-design.md` § 2. Scénarios : `specs/GH52-tests.md` S1.

## Fichiers modifiés

- `packages/types/src/forge.ts` : `MachineConfig.updateFeedUrl?: string`.
- `apps/desktop/src/main/services/machine-config.ts` : clé `updateFeedUrl` (https, sans identifiants, « / » final ajouté ;
  sinon avertissement, clé ignorée).
- `apps/desktop/src/main/services/update.service.ts` : constructeur `(settings, feedUrl?)` ; `setFeedURL({ provider: 'generic', url })`
  avant la première vérification ; lien vers les notes GitHub non proposé quand le flux est configuré (`releaseLink`).
- `apps/desktop/src/main/index.ts` : `UpdateService` reçoit `host.machineConfig.updateFeedUrl`.
- Tests : `services/update.service.gh52.test.ts` (U-U1, U-U2, U-U3, U-U6 et non-régression du lien), `services/machine-config.gh52.test.ts` (U-M1 à U-M3).

## Comportement implémenté

- Sans `updateFeedUrl` : inchangé (GitHub).
- Avec `updateFeedUrl` : électron-updater interroge le dossier du serveur, pas GitHub. Aucun repli.
- `autoUpdate: false` et `updates: managed` : toujours prioritaires (code inchangé).

## Écarts avec le design

- **HTTPS strict** : le design autorisait `http://` pour `localhost`. Implémenté : https uniquement, sans identifiants. Plus simple,
  et aucun cas réel de `localhost` pour un poste client.
- **Lien vers les notes** : le design ne le traitait pas. Ajouté : le lien GitHub serait inaccessible au client.

## Point clos

- `BRAND.update` absent (autre marque) : sans objet. Décision de l'humain (2026-11-27) : la gestion de plusieurs marques
  n'est plus d'actualité ; la vérification reste court-circuitée sans source de marque, comme avant.

## Tests lancés

- `npx vitest run` : `update.service.gh52` et `update.service.gh302` (25 tests), `machine-config*` (14 tests) : verts.
- `pnpm typecheck` (apps/desktop) : vert. `eslint` sur les fichiers modifiés : vert.
- `pnpm test` complet : voir le sprint 2 (lancé une fois le lot du ticket terminé).

## Vérification manuelle à faire

1. Poste de test, `config.json` avec `updateFeedUrl` pointant sur une VM qui sert un `latest.yml` plus récent : proposition de mise à jour.
2. Journal réseau : aucune requête vers `github.com` quand la clé est présente.
3. Installation complète : vérifie que electron-updater accepte l'installeur (dépend de GH388 pour un installeur signé).
