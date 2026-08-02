## Analyse

Le format de stockage (chaîne CSV, `"a, b, c"`) et l'algorithme de rendu (cases à cocher, sélection togglée, `join(', ')`) sont déjà corrects et éprouvés dans `EditView.tsx` (`FieldControl`, case `'multi_enum'`, lignes 102-134). Le travail consiste à porter ce même comportement dans 3 autres endroits, sans changer le modèle de données ni créer de nouveau `SchemaFieldType`.

Point clé qui simplifie le câblage du catalogue `roles` (Cas 1 de la spec) : les 9 écrans qui utilisent `DynamicField` appellent **déjà** `useProjectSchema(repoPath)` pour résoudre leur `ObjectTypeDefinition` (`getReqTypeDef`/`getTestTypeDef`/`getCampaignTypeDef`/`getAllObjectTypes`), et stockent le résultat dans une variable `schema` (`const { data: schema } = useProjectSchema(repoPath)`, même nom partout, confirmé par grep). `ProjectSchema.roles` est donc déjà disponible sans aucune requête réseau supplémentaire — il suffit de dériver `schema?.roles?.map(r => r.name)` et de le passer en prop à `DynamicField`.

## Fichiers à modifier

### 1. `packages/types/src/schema.ts` — utilitaire partagé (nouveau)

Le split/join CSV est aujourd'hui dupliqué (EditView.tsx L109/112, objectTypeEditor.tsx L36 — ce dernier porte sur `values:` du schéma, pas sur une valeur de champ, donc hors sujet ici) et va l'être à nouveau dans `DynamicField.tsx`, le popover partagé (WordView/ExcelView) et `interface-compliance.service.ts`. `packages/types` est déjà importé côté renderer **et** côté main (`interface-compliance.service.ts` l'importe), et contient déjà un export non-type (`TEST_RUN_STATUS_LABELS` dans `test.ts`) — c'est le bon endroit pour deux fonctions pures partagées :

```ts
export function parseMultiEnumValue(value: string): string[] {
  return value ? value.split(',').map(s => s.trim()).filter(Boolean) : []
}

export function serializeMultiEnumValue(values: string[]): string {
  return values.join(', ')
}
```

Remplace les occurrences équivalentes dans `EditView.tsx` (L109/112) par ces imports, pour ne pas garder une 2e implémentation en parallèle.

### 2. `apps/desktop/src/renderer/components/DynamicField.tsx`

- Nouvelle prop optionnelle `interfaceRoles?: string[]` (même sémantique que `EditView.tsx`).
- Nouveau `field.type === 'multi_enum'` (avant le fallback générique `<input>`, après le bloc `'boolean'`) : cases à cocher, calquées sur `EditView.tsx` L102-134 —
  - `opts = (field.name === 'roles' && interfaceRoles?.length) ? interfaceRoles : (field.values ?? [])`
  - `selected = parseMultiEnumValue(value)`
  - `toggle(v)` : ajoute/retire `v` de `selected`, appelle `onChange(serializeMultiEnumValue(next))`
  - Cas `opts.length === 0` : message vide (réutiliser la clé i18n `system.editView.noConfiguredValue`, déjà générique — pas de nouvelle clé à créer).

### 3. Les 9 sites d'appel de `DynamicField`

Chacun ajoute `interfaceRoles={schema?.roles?.map(r => r.name)}` à son/ses appel(s) `<DynamicField .../>` — une ligne par site, aucune nouvelle requête (la variable `schema` existe déjà à cet endroit) :

- `apps/desktop/src/renderer/routes/req.new.tsx` (L136)
- `apps/desktop/src/renderer/routes/req.$reqId.tsx` (L156)
- `apps/desktop/src/renderer/routes/test.new.tsx` (L151)
- `apps/desktop/src/renderer/routes/test.$testId.tsx` (L180)
- `apps/desktop/src/renderer/routes/campaign.new.tsx` (L195)
- `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` (L336)
- `apps/desktop/src/renderer/components/impact/RequirementEditModal.tsx` (L77)
- `apps/desktop/src/renderer/components/impact/TestCaseEditModal.tsx` (L75)

(Les écrans test/campagne n'ont normalement pas de champ nommé `roles` dans leur `ObjectTypeDefinition` — passer la prop ne change rien pour eux, `field.name === 'roles'` ne matchera jamais ; on la passe partout par cohérence/simplicité plutôt que de la conditionner par type d'objet.)

### 4. Nouveau composant partagé — popover à cases à cocher

`apps/desktop/src/renderer/components/system/MultiEnumPopover.tsx` (nouveau) :

```ts
interface Props {
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  style: React.CSSProperties   // position fixed déjà calculée par l'appelant
  dataAttr: string             // ex. 'data-multi-enum-popover', pour le click-outside de l'appelant
}
```

Rendu : `<div style={style} data-multi-enum-popover ...>` + liste de `<label><input type="checkbox">...</label>`, style visuel identique au bloc `EditView.tsx` L116-132 (`flex flex-wrap gap-2`). Chaque clic sur une case appelle `onToggle` immédiatement (pas de bouton « valider » — cohérent avec le popover richtext existant qui commit à chaque `onChange`, cf. `ExcelView.tsx` L1434-1436).

Utilisé par `ExcelView.tsx` et `WordView.tsx` (détails ci-dessous). Un seul composant, deux call sites — pas de duplication du rendu checkbox.

### 5. `apps/desktop/src/renderer/components/system/ExcelView.tsx`

Le mécanisme de popover positionné en `fixed` existe déjà pour richtext (`activeRichtextPopover`, L572-590) et pour les liens (`activeLinkPopover`, L561-570) — même gabarit à dupliquer :

- Nouvel état `activeMultiEnumPopover: { objectId, field, top, left, width } | null` + `useEffect` de fermeture au clic extérieur (`data-multi-enum-popover`), copié du bloc L581-590.
- Le `<td>` en mode édition (actuellement : `fieldDef?.type === 'enum' ? <select>... : <input type="text">`, L199-220) gagne une branche `fieldDef?.type === 'multi_enum'` : au lieu d'éditer inline dans la `<td>`, le clic ouvre `activeMultiEnumPopover` (même schéma que `onRichtextEdit`, L1319-1324 : capture `getBoundingClientRect()`, stocke `{ objectId, field, top: rect.bottom + 2, left: rect.left, width: rect.width }`).
- Nouveau bloc de rendu (après le bloc richtext popover, L1403-1441) : `{activeMultiEnumPopover && (...)}`, utilise `MultiEnumPopover` avec `options` = `field.name === 'roles' ? interfaceRoles : field.values ?? []` (le composant reçoit déjà `interfaceRoles` en prop de haut niveau, comme pour `EditView.tsx`/`WordView.tsx`) et `onToggle` qui appelle `onInlineEdit` avec la valeur CSV mise à jour.
- Échap ferme sans revert nécessaire ici (contrairement au richtext, chaque toggle est déjà un commit atomique et réversible individuellement — pas de brouillon en cours à annuler) : Échap ferme simplement le popover.

### 6. `apps/desktop/src/renderer/components/system/WordView.tsx`

Contrairement à `ExcelView.tsx`, `WordView.tsx` n'a aujourd'hui **aucun** mécanisme de popover (le richtext y est géré en expansion inline via `RichTextInlineField`, pas via popover — pas besoin d'échapper à un `overflow-auto` de table). Deux options :

- **(a)** Ajouter la même plomberie complète que `ExcelView.tsx` (état top-level + callback bubbling `InlineField` → `ItemCard` → `WordView`) pour rester cohérent visuellement entre les deux vues, comme décidé.
- **(b)** Rendre les cases à cocher inline dans `InlineField` (comme `EditView.tsx`), sans popover, car `InlineField` est dans un flux `flex` normal (pas une `<td>` contrainte) et n'a pas de problème de clipping.

Décision retenue ici (cohérence avec la décision « popover pour les deux vues ») : **(a)**. `InlineField` reçoit une nouvelle prop `onMultiEnumEdit?: (objectId, field, rect) => void` (miroir de `onRichtextEdit`), déclenchée au clic sur la valeur en lecture (remplace `setEditing(true)` pour ce type uniquement). `ItemCard` relaie la prop comme il le fait déjà pour `onRichtextEdit`. `WordView.tsx` (composant racine) gagne le même état `activeMultiEnumPopover` + rendu popover que `ExcelView.tsx`, réutilisant `MultiEnumPopover`.

`interfaceRoles` (dérivé de `schema.roles` dans `WordView.tsx`, L398 aujourd'hui réservé à `EditView.tsx` — même calcul à dupliquer localement, `WordView.tsx` a déjà accès à `repoPath` et peut appeler `useProjectSchema` ou recevoir `schema` en prop selon ce qui existe déjà dans ce fichier) est transmis à `InlineField`/`MultiEnumPopover` de la même façon que pour `EditView.tsx`.

### 7. `apps/desktop/src/main/services/interface-compliance.service.ts`

Deux sites, même bug (cast direct `req.fields?.['roles'] as string[] | undefined` sur une valeur réellement stockée en chaîne CSV) :

- L248 (`isRequirementApplicable`) : `const reqRoles = parseMultiEnumValue((req.fields?.['roles'] as string | undefined) ?? '')`
- L254 (`toRowDescriptor`) : idem.

`declaredRoles` (`impl.roles`, provenant de `schema.implements[].roles: string[]`, cf. `SPEC-TEMPLATES.md` §3b) reste un vrai tableau — pas de champ `SchemaField`, pas de format CSV, aucun changement nécessaire côté composant.

### 8. `apps/desktop/src/renderer/components/schema/objectTypeEditor.tsx`

Aucun changement — la saisie du catalogue `values:` pour `multi_enum` y fonctionne déjà de façon générique avec `enum` (condition `f.type === 'enum' || f.type === 'multi_enum'`, L36/230-235, confirmée par l'exploration initiale).

## Décisions techniques et alternatives rejetées

- **Popover vs `<select multiple>` natif** : popover à cases à cocher retenu (décision humaine) malgré le coût supplémentaire (nouveau composant + plomberie WordView) — alternative `<select multiple>` rejetée pour cohérence visuelle avec `EditView.tsx`/`DynamicField.tsx` et découvrabilité (Ctrl+clic jugé peu intuitif).
- **useQuery dédiée dans `DynamicField` vs prop `interfaceRoles`** : prop retenue — `useProjectSchema` est déjà appelée par tous les appelants, dupliquer l'appel dans `DynamicField` aurait ajouté des instances de hook inutiles pour un gain nul (react-query dédoublonnerait déjà le réseau, mais pas les abonnements).
- **Utilitaire partagé `packages/types`** : retenu plutôt que dupliquer une 5e/6e fois le split/join CSV (déjà dupliqué 2 fois avant ce ticket) — cohérent avec le remarque de l'exploration initiale. Reste volontairement minimal (2 fonctions pures, pas de nouvelle classe/abstraction).
- **Correction `interface-compliance.service.ts` incluse dans ce ticket plutôt qu'un ticket bug séparé** : décision humaine — même champ `multi_enum roles`, la spec documente déjà le format CSV donc le contexte est déjà réuni.

## Découpage en sprints

**Sprint 1** — chemin formulaires + backend (indépendamment testable) :
- `packages/types/src/schema.ts` (utilitaire) + migration `EditView.tsx` vers cet utilitaire
- `DynamicField.tsx` (nouveau case `multi_enum` + prop `interfaceRoles`)
- 9 sites d'appel (ajout de la prop)
- `interface-compliance.service.ts` (correctif CSV/array)

**Sprint 2 (final)** — vues tabulaires (le plus gros morceau UI, nouveau composant partagé) :
- `MultiEnumPopover.tsx` (nouveau composant)
- `ExcelView.tsx` (état popover + branchement `<td>`)
- `WordView.tsx` (plomberie popover complète, absente aujourd'hui, + branchement `InlineField`)
- Mise à jour `SPEC-REQ-requirements.md` §3.2/§3.2d (sprint final, cf. `WORKFLOW.md`)
