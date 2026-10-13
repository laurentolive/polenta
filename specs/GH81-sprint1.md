# GH81 — Sprint 1 (unique) : plus d'écriture de la campagne sur une consultation

Spec : `specs/GH81.md` · design : `specs/GH81-design.md` · tests : `specs/GH81-tests.md`.

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `packages/types/src/campaign-execution-sheet.ts` | `EXECUTION_SHEET_FORMAT_VERSION = 2`, `EXECUTION_SHEET_SUPPORTED_VERSIONS = [1, 2]`, erreur `test_changed_since_export` |
| `apps/desktop/src/main/services/campaign-snapshot.util.ts` (nouveau) | `testFingerprint` : sha256 de la forme canonique d'une version de test |
| `apps/desktop/src/main/services/campaigns.service.ts` | `refreshEntries` supprimée ; `effectiveTests` (lecture seule) ; `isResyncable` ; `updateRun(…, meta.testSnapshot)` fige la version fournie |
| `apps/desktop/src/main/services/campaign-execution.service.ts` | export sans écriture (version effective + empreinte) ; `validate` partagé par `preview`/`apply` ; `apply` fige la version exportée (classeur v2, instance resynchronisable) |
| `apps/desktop/src/main/services/export/campaign-execution.xlsx.ts` | colonne `fingerprint` dans `_polenta` |
| `apps/desktop/src/main/services/export/campaign-execution-import.ts` | lecture de l'empreinte, v1 et v2 acceptées, contrôle `test_changed_since_export`, avertissement sur la version effective |
| `apps/desktop/src/main/ipc/index.ts` | `campaigns:refresh-entries` supprimé ; `campaigns:update-run` reçoit `displayed` |
| `apps/desktop/src/web-server/channel-policy.ts` | `campaigns:refresh-entries` retiré de la liste blanche |
| `packages/api-client/src/{types,ipc-client}.ts` | `refreshEntries` retiré ; `updateRun(…, displayed?)` |
| `apps/desktop/src/renderer/hooks/useResolvedCampaignTest.ts` | option `live` : test live (sans `history`) relu à l'ouverture, repli sur la copie si échec |
| `apps/desktop/src/renderer/routes/campaign.$campaignId_.execute.$testId.tsx` | plus de mutation de resynchronisation ; affichage live pour une instance resynchronisable ; version affichée envoyée à la saisie |
| `apps/desktop/src/renderer/components/campaign/ExecutionImportModal.tsx`, `i18n/locales/{fr,en}.json` | message `testChangedSinceExport` ; texte du bandeau « test modifié » ; clé `refreshFailed` retirée |
| `apps/desktop/scripts/check-gh36.ts` | faux service avec `effectiveTests`, `formatVersion` 2 |
| Tests | `campaigns.service.refresh.test.ts` (U1–U12), `campaign-execution.gh68.test.ts` (X1–X13, sur de vrais classeurs), e2e `gh81-no-write-on-read.spec.ts` (E1, E2, E6, E7), `gh68-unapproved.spec.ts` et `gh80-execute-switch.spec.ts` adaptés |

## Comportement implémenté

- Ouvrir la page d'exécution ou exporter le classeur n'écrit plus rien. Une instance
  resynchronisable affiche ou exporte l'état actuel du test.
- À la saisie, la page envoie la version affichée ; le main la fige dans la même écriture que le
  résultat (instance resynchronisable seulement ; `id` incohérent → refus).
- Le classeur v2 porte une empreinte par instance ; à l'import, une empreinte différente refuse
  l'instance (`test_changed_since_export`) — #75 couvert, y compris une modification hors
  application. Empreinte égale : la version exportée est figée. Classeur v1 : importé comme avant.

## Divergences par rapport au design

1. **Empreinte sans `status` ni `version`** (revue de code) : approuver un test après l'export sans
   en changer le contenu ne refuse plus l'import ; la version figée est alors la version approuvée
   (même contenu). D2 visait déjà le contenu, pas le numéro de version.
2. **`apply` ne transmet la version à figer que pour une instance resynchronisable** (le main
   l'ignorerait de toute façon) ; `effectiveTests` accepte le prédicat d'approbation déjà lu, pour
   ne pas relire le schéma.
3. **Repli sur la copie** si la relecture live échoue dans la page d'exécution (une donnée en cache
   pourrait être périmée).
4. **CA10** : comme annoncé (design §4), seul le fichier de campagne est protégé ; le `TestRun` créé
   avant `updateRun` reste.

Non retenus de la revue : vérifier côté main le contenu envoyé par la page (D3 validée : la version
affichée est figée telle quelle) ; règle « resynchronisable » dupliquée dans le renderer (déjà le
cas depuis GH80).

## Vérifications

- `pnpm typecheck` : 0 erreur. `pnpm test` : 445/445 (desktop), 38/38 (merge-core).
- `tsx scripts/check-gh36.ts` : 67 PASS, 0 FAIL.
- `pnpm --filter @polenta/desktop test:e2e:web` : 78 passés, 13 ignorés (forge/déploiement,
  ignorés aussi sans GH81), 0 échec.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-TESTS.md §4.1–4.2` « Tests non approuvés » | `refreshEntries` remplacée par la version effective en lecture seule ; aucune écriture sur consultation ; gel à la saisie (`update-run`, version affichée) ; contrôle d'`id` |
| `SPEC-TESTS.md §4+` page d'exécution | test live affiché, repli copie, bandeau GH71 sur modification du test, version affichée enregistrée |
| `SPEC-TESTS.md §4.5` | `_polenta` v2 et `fingerprint`, v1 accepté, erreur `test_changed_since_export`, export sans écriture, gel à l'import |
| `SPEC-INDEX.md` | lignes SPEC-TESTS §4+, §4.5, §4.1–4.2 : résumé, mots-clés, MAJ → GH81 |

`SPEC-WEB.md` ne cite pas le channel supprimé : inchangé.

## Test manuel (desktop)

Les scénarios M1, E2, M2 et M3 ci-dessous sont joués par l'interface du client web, avec
`git status` sur le clone, dans `e2e-web/gh81-verif.spec.ts` : 3/3 passés. Captures
`gh81v-m1-execution-version-actuelle`, `gh81v-m2-apercu-test-modifie` et
`gh81v-m3-apercu-classeur-v1` dans `e2e-web/.results/`. Seule la boîte « Enregistrer sous » du
desktop n'est pas couverte : le web télécharge le classeur, et les handlers IPC sont les mêmes.

1. **M1** — Campagne ouverte avec un test brouillon ; modifier le test ; ouvrir sa page
   d'exécution (la nouvelle version s'affiche), revenir sans saisir : `git status` propre.
2. **E2** — Ouvrir l'exécution, modifier le test dans un autre onglet, soumettre et confirmer
   « Exécuter quand même » : la copie de l'instance est la version qui était affichée.
3. **M2** — Exporter le classeur d'exécution (`git status` propre), modifier une étape d'un test
   exporté, remplir et réimporter : l'aperçu signale « le test … a changé depuis l'export du
   classeur — réexportez… » pour cette instance ; les autres sont importées.
4. **M3** — Réimporter un classeur exporté avant GH81 : pas d'erreur de format, import normal.
