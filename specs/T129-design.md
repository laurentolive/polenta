# T129 — Design

## 1. Vue d'ensemble

Un seul axe de travail : remplacer les deux `<select>` natifs de `SystemPanel.tsx` (Composant,
Élément) par **un** combobox filtrable, alimenté par un nouveau modèle d'entrées dérivé de
`componentOptions` existant, croisé avec les types de chaque `SystemNode`.

Pas de nouvelle dépendance : le projet n'a aucune librairie de combobox (`@radix-ui`,
`@headlessui`, `cmdk`, `downshift` — vérifié, absentes de `apps/desktop/package.json`), mais le
pattern existe déjà en interne à trois endroits :

- `apps/desktop/src/renderer/components/system/LinkCombobox.tsx` — le plus simple : input texte
  qui filtre une liste en mémoire par substring insensible à la casse, dropdown en `absolute`,
  fermeture au clic extérieur via un listener `mousedown` sur `document`. Conçu pour l'ajout
  multi-liens (chips + bouton ×) — pas directement réutilisable tel quel.
- `apps/desktop/src/renderer/components/sidebar/version/BranchCombobox.tsx` — variante single-
  select : l'input sert à la fois d'affichage de la valeur courante (`readOnly` tant que non
  focus) et de champ de filtre une fois focus. Dropdown positionné via `createPortal(...,
  document.body)` + `getBoundingClientRect()` recalculé au scroll/resize, pour échapper à un
  ancêtre `overflow-hidden`.
- `apps/desktop/src/renderer/components/sidebar/version/GitRefCombobox.tsx` — variante groupée
  (sections `RefGroup` dans la liste), dropdown en `absolute` simple (pas de portail).

Aucun des trois ne gère la navigation clavier (flèches/Entrée) dans la liste filtrée — à ajouter.

**Décision** : nouveau composant `ComponentTypeCombobox.tsx`, construit sur le squelette de
`BranchCombobox.tsx` (single-select, input = affichage + filtre, portail `document.body`) plutôt
que sur `LinkCombobox.tsx`, pour deux raisons :
1. Ce combobox est single-select (remplace la valeur courante), pas un ajouteur de liens multiples
   — le modèle de `BranchCombobox` correspond directement, celui de `LinkCombobox` demanderait de
   retirer la logique de chips.
2. `SystemPanel.tsx` est un panneau latéral de hauteur contrainte (`h-full overflow-hidden`,
   `SystemPanel.tsx:349`) — un dropdown potentiellement long (tous les repos × nœuds × types du
   workspace avant filtrage) serait rogné par cet ancêtre avec un simple `absolute`. Le portail de
   `BranchCombobox` évite ce problème, déjà résolu une fois dans le code, à réutiliser plutôt qu'à
   re-découvrir.

La navigation clavier (flèche haut/bas + Entrée + Échap) est ajoutée dans le nouveau composant —
absente des trois exemples existants, c'est le seul morceau réellement nouveau.

## 2. Nouveau modèle d'entrées (`SystemViewContext.tsx`)

```ts
export interface ComponentTypeOption {
  /** Clé stable pour React + comparaison de sélection : `${repoName}::${nodeId}::${typeId}` */
  key: string
  repoName: string
  nodeId: string
  typeId: string
  /** Libellé complet affiché : chemin composant (avec › si imbriqué) + " / " + libellé du type */
  label: string
  /** En-tête de groupe (nom du repo), même règle qu'aujourd'hui : présent seulement si le
   *  workspace a plus d'un repo (cf. componentOptions existant). */
  groupLabel?: string
}
```

Dérivé de `componentOptions` (inchangé, `SystemViewContext.tsx:224-246`) :

```ts
const componentTypeOptions: ComponentTypeOption[] = componentOptions.flatMap(opt => {
  const repoNodes = schemasByRepoPath.get(opt.repoPath)?.nodes ?? []
  const node = findSystemNode(repoNodes, opt.nodeId)
  const types = node?.objectTypes ?? []
  // décision T129 #3 : un nœud sans type n'a aucune entrée, donc n'apparaît pas
  return types.map(t => ({
    key: `${opt.repoName}::${opt.nodeId}::${t.name}`,
    repoName: opt.repoName,
    nodeId: opt.nodeId,
    typeId: t.name,
    label: `${opt.label} / ${t.label || t.name}`,
    groupLabel: opt.groupLabel,
  }))
})
```

`findSystemNode` est déjà exporté par `packages/types/src/schema-tree.ts` (T123) — réutilisé tel
quel, pas de nouvelle fonction de traversée nécessaire.

## 3. `ComponentTypeCombobox.tsx` — nouveau composant

```ts
function ComponentTypeCombobox({
  options,
  selectedKey,
  onSelect,
  groupByRepo, // true seulement si >1 repo, cf. décision T129 #2 — calculé par l'appelant
}: {
  options: ComponentTypeOption[]
  selectedKey: string
  onSelect: (opt: ComponentTypeOption) => void
  groupByRepo: boolean
}): JSX.Element
```

- État interne : `query` (texte tapé), `open`, `highlightedIndex` (nouveau, pour le clavier),
  `dropPos` (position du portail, calquée sur `BranchCombobox.tsx`).
- Affichage fermé : le `label` de l'option dont `key === selectedKey`.
- Au focus : le champ devient éditable, `query` réinitialisé à `''`, liste complète affichée
  (comportement `BranchCombobox` existant).
- Filtrage : `options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))` —
  substring simple sur le libellé complet déjà construit (repo + chemin + type), pas de recherche
  multi-champs pondérée (cf. spec, "hors scope : tri/pondération avancée").
- Rendu groupé : si `groupByRepo`, les options filtrées sont regroupées par `groupLabel` en
  préservant l'ordre (les entrées d'un même repo sont déjà contiguës dans `componentOptions`,
  comme documenté dans `renderComponentOptions` actuel) et rendues sous un en-tête de section
  non cliquable — même technique que `RefGroup` dans `GitRefCombobox.tsx`.
- Clavier : `ArrowDown`/`ArrowUp` déplacent `highlightedIndex` dans la liste filtrée (aplatie, en
  ignorant les en-têtes de groupe) ; `Enter` sélectionne l'entrée surlignée ; `Escape` ferme et
  restaure l'affichage de la sélection courante.
- Sélection (clic ou Entrée) : appelle `onSelect(opt)`, ferme le dropdown, `blur` de l'input.

## 4. Câblage dans `SystemViewContext.tsx` / `SystemPanel.tsx`

- Nouveau handler unique, remplace `handleComponentChange` + `handleTypeChange`
  (`SystemViewContext.tsx:374-390`) :

  ```ts
  const handleTargetChange = useCallback(
    (repoName: string, nodeId: string, typeId: string) => navigateWith(repoName, nodeId, typeId),
    [navigateWith],
  )
  ```

  Plus besoin de calculer un `firstType` intermédiaire (`handleComponentChange` actuel) puisque le
  type fait partie de l'entrée sélectionnée dès le départ.
- `SystemPanel.tsx:355-400` : les deux blocs `<select>` (Composant, Élément) sont remplacés par un
  seul bloc :
  ```tsx
  <div className="flex items-center gap-2 px-3 py-2 border-b border-edge shrink-0">
    <label className="text-xs text-ink-3 shrink-0">{t('sidebar.system.componentElement')}</label>
    <ComponentTypeCombobox
      options={componentTypeOptions}
      selectedKey={`${selectedRepoName}::${effectiveNodeId}::${effectiveTypeId}`}
      onSelect={opt => handleTargetChange(opt.repoName, opt.nodeId, opt.typeId)}
      groupByRepo={flatNodes.length > 1}
    />
  </div>
  ```
- État vide global (aucune entrée du tout dans `componentTypeOptions`) : réutilise la clé i18n
  `sidebar.system.noComponentConfigured` déjà existante, combobox désactivé — pas de nouvelle clé
  nécessaire pour ce cas précis.
- `renderComponentOptions` (`SystemPanel.tsx:35-63`) devient mort code, à supprimer.
- Clés i18n `sidebar.system.component` / `sidebar.system.element` : à vérifier si utilisées
  ailleurs (`i18n/locales/fr.json`/`en.json`) avant suppression — sinon les laisser (coût nul,
  évite une recherche exhaustive hors scope).

## 5. Alternatives rejetées

- **`<select multiple>` custom avec `<optgroup>` natif + `<datalist>` pour le filtre.**
  `<datalist>` ne permet pas de style/contrôle du rendu des options (pas de libellé riche
  repo/type sur deux niveaux), et le support de la saisie libre + suggestion diffère trop entre
  navigateurs — écarté, cohérent avec la décision actée en conversation (combobox custom
  nécessaire pour le filtrage substring).
- **Introduire une dépendance externe (`cmdk`, `@radix-ui/react-combobox`).** Le besoin (single-
  select, filtrage substring, groupes, clavier basique) est entièrement couvert par le pattern
  déjà répliqué 3 fois dans le code ; ajouter une dépendance pour un besoin déjà résolu localement
  irait à l'encontre de la cohérence avec le reste du renderer.
- **Étendre `LinkCombobox.tsx` avec un mode single-select** plutôt que créer un nouveau composant.
  Rejeté : `LinkCombobox` porte une logique de chips/existingLinks/onRemove non pertinente ici : un
  paramètre `mode: 'single' | 'multi'` aurait rendu le composant plus dur à lire pour un gain de
  réutilisation faible (les deux composants ne partagent que ~15 lignes de logique de filtrage).

## 6. Sprints

**Un seul sprint** — périmètre contenu : un nouveau composant + un nouveau modèle dérivé + le
câblage dans un seul panneau. Pas de découpage nécessaire.

## 7. Fichiers concernés

- `apps/desktop/src/renderer/contexts/SystemViewContext.tsx` — `componentTypeOptions` (nouveau),
  `handleTargetChange` (remplace `handleComponentChange`/`handleTypeChange`), export dans le
  contexte (`SystemViewContextValue`, lignes ~108-121 à adapter).
- `apps/desktop/src/renderer/components/system/ComponentTypeCombobox.tsx` — nouveau fichier.
- `apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx` — remplacement des deux `<select>`
  (lignes 355-400), suppression de `renderComponentOptions` (lignes 35-63) et du type
  `ComponentOption` réexporté si devenu inutile ailleurs (à vérifier).
- `apps/desktop/src/renderer/i18n/locales/fr.json` / `en.json` — nouvelle clé
  `sidebar.system.componentElement` (libellé du combobox fusionné).
- `specs/SPEC-SYSTEM-VIEW.md` — section "Combobox Composant" / "Combobox Élément" à fusionner en
  une seule section (fait par l'Agent Dev en fin de sprint, cf. WORKFLOW.md).

## Refs SPEC

- `SPEC-SYSTEM-VIEW.md` §"Panel Système" — sections Combobox Composant / Combobox Élément.
