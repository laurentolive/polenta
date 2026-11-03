# GH203 — Design : vues enregistrées nommées du ⚙️

Un seul sprint. Spec : `specs/GH203.md`.

## Modules

| Fichier | Rôle |
|---|---|
| `packages/types/src/saved-views.ts` (nouveau) | `SavedView`, `SavedViewRef`, `SavedViewsList`, règles pures : `normalizeViewName`, `SAVED_VIEW_ERRORS` |
| `main/services/saved-views.service.ts` (nouveau) | lecture / écriture des deux portées ; renommage de champ, de type ; suppression |
| `main/ipc/index.ts` | canaux `views:list`, `views:create`, `views:update`, `views:rename`, `views:delete` |
| `web-server/channel-policy.ts` | canaux exposés, arguments de chemin `[0, n]` (repo et `workspaceDir`) |
| `packages/api-client` | `api.views.*`, clés `savedViews` et `activeView` de `FieldVisibilityPref` |
| `renderer/components/system/SavedViewsMenu.tsx` (nouveau) | liste, actions, modale de nom ; ne connaît ni les colonnes ni `SystemView` |
| `renderer/components/system/savedViewSettings.ts` (nouveau) | réglages de `SystemView` ↔ `settings`, comparaison |
| `SystemView.tsx` | montage du menu, application d'une vue, « Colonnes par défaut » |
| `field-rename.service`, `type-rename.service`, `schema-delete.service` | maintien du fichier d'équipe |
| `useLiveFileSync` | `.polenta/views/` ou `*` invalide `['saved-views']` |
| `agents-md.template.ts` | invariant : le fichier est maintenu par l'application |

## API

```ts
interface SavedView { name: string; settings: Record<string, unknown> }
interface SavedViewRef { scope: 'personal' | 'team'; name: string }
interface SavedViewsList {
  personal: SavedView[]; team: SavedView[]
  teamError?: 'unreadable' | 'newer-format'
  teamReadonly: boolean
}
```

`views:list(repoPath, username, typeKey, workspaceDir)` et, pour l'écriture,
`views:create | update | rename | delete(repoPath, username, typeKey, ref…, workspaceDir)`.

Le service valide `typeKey` (`<nœud>::<type>`, sans séparateur de chemin ni `..`) : il compose un chemin
à partir d'une valeur reçue du client web. Erreurs préfixées, comme ailleurs : `READONLY_REPO`,
`VIEW_NAME_INVALID`, `VIEW_NAME_TAKEN`, `VIEW_NOT_FOUND`, `VIEWS_UNREADABLE`.

## Décisions techniques

- **Service unique pour les deux portées.** Les règles de nom vivent à un seul endroit. Le renderer
  n'écrit jamais `savedViews` par `pref:set-field-visibility` ; `activeView` passe en revanche par ce
  canal, avec le reste du réglage courant.
- **`settings` opaque côté service.** Seul le renderer connaît les clés : #204 y rangera ses zones. La
  migration d'un renommage de champ cible les valeurs de `excel`, `word`, `popup`, seule connaissance
  des clés côté main.
- **Application.** `SystemView` pose ses états puis envoie un patch `FieldVisibilityPatch` complet : une
  clé absente de la vue vaut `null`, donc le défaut. `picker`, `executions`, `collapsedFolders*` ne sont
  pas dans le patch et restent intacts grâce à l'écriture partielle (GH176).
- **« modifiée ».** Comparaison pure des réglages courants et de la vue, défauts appliqués (`showFolders*`
  vrai, `freezeColCountExcel` 0, `popup` vide, colonnes absentes = défaut du schéma). L'ordre des colonnes
  compte. État brut `visibleFieldsExcel`, pas `excelFields` normalisé : une clé invalide ne fait pas
  apparaître de différence.
- **Vue active disparue.** Effet dans `SystemView` : liste chargée pour le `typeKey` courant, sans
  `teamError`, ref absente → `activeView: null`. Avec `teamError` la ref est gardée : un fichier
  temporairement cassé (conflit) ne fait pas perdre la sélection.
- **Écriture d'équipe.** Lecture, refus si illisible, YAML réécrit entier, fichier retiré avec la dernière
  vue. Pas de commit : `sync.status` le présente dans Publier comme toute modification.
- **Tri.** Fait à l'affichage (`localeCompare`) ; le fichier garde l'ordre d'insertion pour limiter les
  conflits de merge.

## Alternatives rejetées

- `pref:set-field-visibility` pour les vues personnelles et un service pour l'équipe seule : règles de
  nom dupliquées, dans le renderer pour le `.pref`.
- Un fichier par vue : le renommage devient un déplacement, et il faudrait encoder le nom dans un chemin.
- Canal générique `views:save` : les refus (doublon, vue absente) dépendraient de drapeaux.

## Découpage

Un sprint : le mécanisme n'a de valeur que complet, et il tient dans un diff limité.
