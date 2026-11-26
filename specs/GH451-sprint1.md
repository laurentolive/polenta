# GH451 — Sprint 1 (unique)

## Fichiers modifiés

- `packages/types/src/product-version.ts` — codes `BASE_NOT_RELEASED`, `VERSION_IS_BASE`.
- `apps/desktop/src/main/services/versions.service.ts` — `basedOnCandidates` (released ou en cours, ni elle-même, ni
  une descendante, ni abandonnée) ; `assertBasedOn` (base déjà enregistrée acceptée telle quelle ; refus « introuvable »,
  « version abandonnée », « boucle de lignée ») ; `basedOnOptions` de la page ; motif `BASE_NOT_RELEASED` au passage
  released ; refus `VERSION_IS_BASE` à la suppression.
- `apps/desktop/src/renderer/components/versions/VersionInfoSection.tsx`, `NewVersionDialog.tsx` — options en cours
  proposées, suffixe d'état (« — En cours », « — Abandonnée » pour une base actuelle abandonnée).
- `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` — libellés des deux codes.
- `apps/desktop/src/mcp-server/tools/versions.tools.ts` — description de `basedOn`.
- Tests : `versions.gh451.test.ts` (U1–U11, U7b, U9b), `e2e-web/gh451-version-based-on.spec.ts` (E1–E4).

## Comportement implémenté

Conforme à `specs/GH451.md`. Après revue (`/code-review`) :

- **Passage released** : toute la lignée est parcourue (abandonnées sautées) ; la première version en cours bloque.
  Sans cela, V2 → V1 abandonnée → V0 en cours sortait et figeait les changements planifiés de V0 (spec § 2.3 précisée).
- **Suppression** : le refus reste valable quel que soit l'état de la version basée dessus (spec § 2.4) ; le message
  précise qu'une version released ou abandonnée garde sa base — la version qui lui sert de base reste alors comme
  historique.

## Divergences par rapport au design

Aucune sur le fond ; § 2.4 du design (passage released) étendu à la lignée entière (ci-dessus).

## Mises à jour SPEC

- `SPEC-REQ-requirements.md` §11.1 (`basedOn` released ou en cours), §11.2 (règle « Version de base », refus
  `VERSION_IS_BASE` à la suppression, `BASE_NOT_RELEASED` au passage released), §11.5 (lignée non abandonnée, vue plan
  pour une version en cours, exemple chiffré).
- `SPEC-MCP-SERVER.md` § écriture des versions (GH362) : `basedOn` et `BASE_NOT_RELEASED`.
- `SPEC-INDEX.md` : MAJ → GH451 (SPEC-REQ §11, SPEC-MCP-SERVER §global).

## Vérifications

- Niveau 1 : `pnpm typecheck` OK ; eslint des fichiers du ticket OK. `pnpm lint` complet : 5 erreurs **préexistantes**,
  hors ticket (`askpass.js`, `node-checkout.gh337.test.ts`, `merge-resolution.service.ts`, `vendor/git/…/xterm.js`),
  mêmes que dans les journaux de GH442 / GH450.
- Niveau 2 : `pnpm test` OK (desktop 2457 passés, 5 ignorés ; admin-service 124 passés, 3 ignorés) ; après les correctifs
  de revue, tests de versions / validations relancés : 138 passés. `pnpm build:web` + e2e `gh451-`, `gh439-version-page`,
  `gh252-versions` : 24 passés.
- Non lancé : suite e2e complète (niveau 3, au push du lot).

## Comment tester à la main

Projet washer (`ver-washer`, 7 versions en cours) :

1. Page de Proto V2 → « Basée sur » : les 6 autres versions, suffixées « — En cours » ; choisir Proto V1.
2. Page de Proto V1 → Proto V2 n'est plus proposée (descendante).
3. Proto V2 → « Passer released » : motif « La version de base n'est pas encore released : WASHER_VER-0002 Proto V1 ».
4. Supprimer Proto V1 : refus « Sert de base à WASHER_VER-0003 Proto V2… ».
5. Inclure des exigences dans Proto V1 et Proto V2 : la section « Exigences » de Proto V2 liste les deux.
