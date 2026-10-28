# GH163 — Design : commentaire de modification

Spec : `specs/GH163.md` (décisions du 28/10). Un sprint ; design et code enchaînés à la demande de Benoit.

## Fichiers

| Fichier | Changement |
|---|---|
| `packages/types/src/history.ts` | `HistoryEntry.comment`, `HistoryActor.comment` ; `applyHistory` le pose sur les entrées créées (pas sur un rattrapage), vide ignoré. |
| `main/services/history.service.ts` | `stamp(…, ownerRepo?, comment?)`. |
| `main/services/requirements.service.ts`, `tests.service.ts` | `persist(…, { comment })` ; `update` (`modificationComment`), `transition` (`comment`), `openDraft(…, comment?)`. |
| `packages/zod-schemas/src/test.schema.ts` | `UpdateTestCaseSchema.modificationComment`. |
| `main/ipc/index.ts`, `packages/api-client`, `web-server/channel-policy.ts` | `openDraft` : argument `comment` (index 4, texte libre). |
| `mcp-server/tools/update.tools.ts`, `read.tools.ts` | `modificationComment` exposé, `warning` sans changement suivi ; `get_history` documente `comment`. |
| `renderer/components/system/EditView.tsx`, `SystemView.tsx` | Champ « Commentaire du changement de statut » sous le statut du formulaire, envoyé avec le changement puis vidé. |
| `renderer/components/history/*` | Commentaire affiché sur la ligne d'historique. |
| `resources/dashboard-lib/polenta.d.ts`, `manifest.json` | Type régénéré (`comment`), version 3 du fichier livré. |

## Décisions

- Le commentaire est un attribut de l'acteur de l'écriture : une même écriture (statut + champ suivi)
  pose le même commentaire sur chacune de ses entrées.
- Saisie non bloquante dans le formulaire (champ facultatif) plutôt qu'une fenêtre à chaque changement
  de statut : ne change pas les flux existants (vue tableau, édition en masse, e2e).

## Limites

- Colonne Statut de la vue tableau et bouton « Repasser en brouillon » de la vue Document : pas de
  saisie dans ce ticket (l'API `openDraft(…, comment)` est prête). À ajouter si besoin.
