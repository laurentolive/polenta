# GH137 — Design : colonnes de lien par sens

Spec : `specs/GH137.md` (Q1–Q3 tranchées). Un sprint ; design et code enchaînés à la demande de
Benoit (28/10).

## Fichiers

| Fichier | Changement |
|---|---|
| `renderer/components/system/linkUtils.ts` | `parseLinkColumn`, `isLinkColumn`, `linkColumnKeys` (deux clés si le type est source et cible), `linkColumnLabel`, `normalizeLinkColumns` (compatibilité des préférences). |
| `renderer/components/system/SystemView.tsx` | Champs visibles de l'onglet Tableau normalisés (`excelFields`) pour l'affichage et le panneau ; préférence non réécrite à la lecture. |
| `renderer/components/system/FieldConfigModal.tsx` | Onglet Tableau : une case par clé de `linkColumnKeys` ; onglet Document : `link::` inchangé (Q3). |
| `renderer/components/system/ExcelView.tsx` | Titre, valeur de cellule (un seul sens), filtre et largeur via `getCellText` ; popover ouvert avec `direction` (Q1), identifié par la clé de colonne. |
| `renderer/lib/exportColumns.ts` | `link-out::` / `link-in::` exclues de l'export, comme `link::`. |

## Décisions

- Normalisation en lecture seule dans `SystemView` : la préférence garde l'ancien format jusqu'à la
  prochaine modification (spec § Compatibilité) ; le panneau écrit alors les nouvelles clés.
- `LinkTypeEditor` supportait déjà `direction: 'out' | 'in'` : réutilisé tel quel pour le popover.
- Q2 : « Réinitialiser » inchangé (colonnes de lien hors défaut).
