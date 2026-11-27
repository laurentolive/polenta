# GH446 — Résumé de sprint : historique Git des objets (popup « Historique »)

Spec : [GH446.md](GH446.md) (révision 3) · Design : [GH446-design.md](GH446-design.md) · Tests : [GH446-tests.md](GH446-tests.md)

Les trois sprints du design sont faits dans cette branche : backend (commit `e4f882a`), popup et entrées du panneau,
entrées Excel et Word, et spec e2e. Le détail est ci-dessous.

## Fichiers

**Backend**
- `packages/types/src/object-history-file.ts` (nouveau) : `ObjectCommitKind`, `objectHistoryFile(kind, id)` (refuse un ID
  hors du dossier attendu), `ObjectCommit`.
- `apps/desktop/src/main/services/git.service.ts` : `fileCommits` renvoie `subject` (première ligne du message).
- `apps/desktop/src/main/services/object-commits.service.ts` (nouveau) : `listObjectCommits` (kind inconnu refusé).
- `apps/desktop/src/main/ipc/index.ts` : canal `history:commits`.
- `packages/api-client/src/types.ts`, `ipc-client.ts` : `api.history.commits`.
- `apps/desktop/src/web-server/channel-policy.ts` : `history:commits` exposé, racine `[0]`.

**Renderer**
- `components/history/ObjectCommitsDialog.tsx` (nouveau) : popup modale, liste des commits à gauche, `FileDiffView`
  en lecture seule à droite (Brut / Rendu, préférence `diffPrefs`). Hook `useObjectCommitsDialog`.
- `components/system/ElementTree.tsx` : entrée « Historique » sur un élément ; désactivée en sélection multiple.
- `components/sidebar/SystemPanel.tsx` : arbre (exigence, test, issue) et liste des campagnes (menu clic droit).
- `components/sidebar/version/ProductVersionsPanel.tsx` : entrée sur une version.
- `components/sidebar/ValidationPanel.tsx` : menu clic droit sur une validation existante.
- `components/system/ExcelView.tsx` : entrée sur exigence, test, campagne, issue ; désactivée en sélection multiple.
- `components/system/WordView.tsx` : menu clic droit sur une carte (aucun menu auparavant).
- `i18n/locales/fr.json`, `en.json` : clés `history.commits.*`.

**Tests**
- `apps/desktop/src/main/services/object-commits.service.test.ts` : U1 à U5 (dépôt git temporaire).
- `apps/desktop/e2e-web/gh446-history.spec.ts` : E1 à E9.

## Écarts par rapport au design

- **Rendu** : `FileDiffView` propose le Rendu pour tout fichier YAML. Le choix Brut / Rendu est donc offert pour les
  six types, ce qui tranche le point ouvert de D6 (critère 8).
- **Sélection** : aucun diff n'est lu à l'ouverture de la popup (critère 15) ; le premier commit n'est pas
  sélectionné d'office.
- **Clic dans la popup** : `backdropDismiss` ferme sur tout clic dont le mousedown et le mouseup visent la même
  cible, y compris un clic dans la liste. La popup stoppe la propagation du clic (comme les autres popups), trouvé
  par E1.
- **Campagnes et validations** : le menu à une entrée est un `NodeContextMenu` (même primitive que les versions).

## Vérifications

| Niveau | Commande | Résultat |
|---|---|---|
| 1 | `pnpm typecheck` | OK |
| 1 | `eslint` sur les fichiers modifiés | OK |
| 1 | `vitest` ciblé (U1-U5, `channel-policy`) | 11 tests OK |
| 2 | `pnpm test` (unitaires complets) | voir le compte rendu de la validation |
| 2 | `playwright e2e-web/gh446-history.spec.ts` | 9 tests OK (E1-E9) |

**Non fait** : E13 (client web, même popup via le bridge HTTP) : la liste blanche est testée (`channel-policy`), le
parcours web n'a pas de spec dédiée. R1 et R2 (tests de composant) : couverts par les e2e (E1 : aucun diff à
l'ouverture ; E6 : « Aucun commit »).

**Mise à jour SPEC** : SPEC-SYSTEM-VIEW (section Vue document, GH446), SPEC-INDEX (MAJ de la ligne Vue Excel / Vue Word).
SPEC-WEB non modifiée (la liste blanche est documentée par `channel-policy.ts` et son test).
