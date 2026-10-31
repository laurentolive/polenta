# GH229 — Design : liens de navigation sur les ID d'élément (+ #236)

Spec : `specs/GH229.md`. Worktree `../polenta-official-GH229`, branche `GH229` (depuis
`milestone-C`, PR vers `milestone-C`).

## 1. Vue d'ensemble

Un seul point d'entrée pour tout ID référencé : le composant `ElementLink` (texte du lien,
clic, survol) et un contrôleur de popup unique (`ElementPreviewProvider`) monté dans
`AppLayout`. Les ID reconnus dans du HTML rendu (richtext en lecture) passent par le même
contrôleur via délégation d'événements sur un attribut `data-element-ref`.

```
AppLayout
 └─ SystemViewProvider            (objectPage() : URL de la page cible)
     └─ ElementNavProvider        (index workspace : objets + campagnes, follow(), displayIdOf())
         ├─ ElementPreviewPopup   (une popup à la fois, portail)
         └─ … écrans → <ElementLink id> / data-element-ref
```

## 2. Modèle de données

### 2.1 `displayIdField` (packages/types `ObjectTypeDefinition`)

```ts
/** GH229 — champ affiché à la place de l'ID Polenta dans les liens (`title` ou nom d'un champ
 *  text / number / enum du type). Absent = ID Polenta. */
displayIdField?: string
```

Fonction partagée `displayIdFieldError(typeDef)` (packages/types `schema.ts`) : `null` si absent
ou valide, sinon message. Utilisée par :
- `SchemaService.save()` → `assertValidDisplayIdFields` (nouveau code
  `DISPLAY_ID_FIELD_INVALID`), chemin de l'UI et du MCP ;
- l'éditeur de type (`objectTypeEditor.tsx`) : la liste ne propose que les valeurs valides ;
  `editableToObjType` retire un `displayIdField` devenu invalide (champ supprimé / retypé).

Fonction `displayIdOf(obj, typeDef)` (packages/types) : valeur du champ (ou `title`) si non
vide après `trim`, sinon `obj.id`. Nombre → `String(n)`.

### 2.2 `WorkspaceObject.displayId?: string`

`WorkspaceLinksService.listObjects` calcule `displayId` avec le schéma du repo de l'objet
(`loadSchemas`), présent seulement s'il diffère de `id`. Une `displayIdField` invalide (YAML
édité à la main) est ignorée (repli ID Polenta).

### 2.3 Préférence `popup`

`FieldVisibilityPref.popup?: string[]` (api-client). Le main fusionne déjà les clés
(`pref:set-field-visibility`), aucun changement côté main. Absent ⇒ `[]`.

## 3. Navigation

### 3.1 `SystemViewContext.objectPage(...)` (nouveau, exposé)

```ts
objectPage(targetRepoPath, nodeId, typeId, view: SystemViewMode, item, category)
  → { pathname: '/product' | '/components', search: Record<string, string> }
```
Extrait de `navigateWith` (même construction des paramètres). `showObject` devient
`navigate(objectPage(...))`. Le nouvel onglet utilise `openTab(pathname, search)` — c'est la
même page, plus la fiche `/req` / `/test`.

`viewModeForLink(targetRepoPath)` (nouveau, exposé) : sur `/product` / `/components`, le
`viewMode` courant ; sinon `readStoredViewMode(targetRepoPath) ?? 'excel'`.

### 3.2 `ElementNavProvider` (`contexts/ElementNavContext.tsx`)

- index : `useWorkspaceLinks(currentProjectId)` (cache partagé) + campagnes de chaque repo du
  workspace (`api.campaigns.list`, clé `['campaigns-all', repoPath]`) ;
- `resolve(id) → { id, displayId, title, category, objectTypeRef, repoPath, status } | null` ;
- `follow(id, { newTab })` : campagne → `/campaign/<id>` (`repoPath`, `projectId`) ; sinon
  `objectPage(repo, node, type, viewModeForLink(repo), id, category)` puis `navigate` ou
  `openTab`. Avant navigation : `blur` du champ actif (comme GH228) ;
- `ready` : index chargé (avant : un ID n'est pas encore « introuvable », rendu en texte simple
  sans marqueur).

Hors projet ouvert (routes nues `/print/*`) : pas de provider → `useElementNav()` renvoie
`null`, `ElementLink` rend le texte brut.

### 3.3 Sélection dans l'arbre de la barre latérale

`SystemPanel` : effet sur `gotoNodeId`/`gotoSeq` et `editingNodeId` → `setSelectedIds([id])`
et dépliage des dossiers parents (`ElementTree` : prop `revealNodeId` qui déplie les ancêtres
et fait défiler la ligne). Couvre aussi le goto existant (T164) — comportement voulu par la
spec (« comme si on le sélectionnait dans la barre latérale »).

Tableau : la ligne cible devient la ligne sélectionnée (`selectedIds` de l'ExcelView) quand
le goto vient de l'URL (`item`).

### 3.4 Élément masqué par un filtre

Après application du goto, si `item` est hors des lignes filtrées : message non bloquant dans
la barre de la vue (`system.view.itemHiddenByFilter`), effacé au changement de filtre / page.

### 3.5 #236

Causes visées (reproduites par l'e2e `gh229-*` avant correctif) :
1. clic : `navigateToObject` ouvrait toujours l'Édition depuis le Tableau ; pendant le
   chargement de l'arbre du type cible, `viewMode === 'edit'` sans nœud édité → page vide.
   Désormais le mode courant est gardé, et l'Édition attend l'arbre (état de chargement) ;
2. Ctrl+clic : le `mousedown` remontait à la cellule (sélection / goto REPLACE de l'onglet
   source, résolu après le changement d'onglet). `ElementLink` arrête `mousedown` et `click`
   (`stopPropagation`, `preventDefault` sur le `mousedown` du bouton du milieu et sur
   `auxclick`), et `openTab` est appelé après le `blur`.

## 4. Composants

### 4.1 `ElementLink` (`components/element/ElementLink.tsx`)

```tsx
<ElementLink id="SYS-0001" className? fallback? />
```
- texte : `displayId ?? id` ; `title` natif = ID Polenta si différent ;
- introuvable (index prêt, id absent) : `<span>` texte simple ;
- `onMouseDown` : `stopPropagation` (+ `preventDefault` si bouton du milieu) ;
- `onClick` / `onAuxClick` (bouton 1) : `stopPropagation`, `follow(id, { newTab: ctrl||meta||button===1 })` ;
- `data-cell-dblclick-ignore` (le double-clic ne déclenche pas l'édition des liens, GH169) ;
- survol : `preview.hover(id, el)` / `preview.leave()` ; `inPopup` (contexte) : pas de survol.

### 4.2 `ElementPreviewProvider` + `ElementPreviewPopup`

Contrôleur : `hover(id, anchor)` arme un timer 500 ms ; `leave()` arme un timer de fermeture
200 ms, annulé si le pointeur entre dans la popup ; `close()` sur Échap, clic, `scroll`
(capture) hors popup, `pointerType === 'touch'` ignoré, `buttons !== 0` (glisser) ignoré.

Popup (portail `document.body`, `z-[70]`, `data-testid="element-preview"`) :
- position : sous l'ancre, retournée au-dessus si la place manque, bornée à la fenêtre ;
  `max-h-[50vh] overflow-auto`, largeur 24rem ;
- données : `api.requirements.get` / `api.tests.get` / `api.campaigns.get` sur le repo de
  l'objet ; schéma du repo (`['schema', repoPath]`) ; préférence `popup` du type
  (`['pref-visibility', repoPath, username, typeKey]`, même clé que la vue système) ;
- rendu dense : en-tête (ID, ID affiché, pastille type, statut, repo, ⚠ revalidation), titre,
  champs (`ElementPreviewField` : libellé `text-[10px]`, valeur `text-xs` ; richtext via
  `StaticRichTextViewer variant="compact"` ; enum / multi_enum / date / user / nombre en texte ;
  colonnes de liens = `ElementLink` ; `coverageStatus` via `CoverageBadge` ; `steps` = liste
  numérotée compacte) ; champ vide omis ;
- contexte `inPopup` : les `ElementLink` internes ne rouvrent pas de popup.

### 4.3 Onglet « Popup » du panneau ⚙️

`ConfigTab = 'excel' | 'word' | 'popup'`. `FieldConfigModal` reçoit
`visibleFieldsPopup` / `onChangePopup` ; l'onglet n'a pas la case « titres des dossiers » ;
champs proposés = mêmes que Document (sans `section`, `name`, `id`, `status`, `version`,
déjà dans l'en-tête) ; colonnes calculées non proposées (calcul de vue, pas d'objet isolé).
Réinitialiser ⇒ `[]`. Ordre = ordre canonique du panneau (pas de glisser-déposer dans le
panneau : écart de formulation avec la spec §5.3, sans effet — la spec est corrigée).

`SystemView` : état `visibleFieldsPopup` dérivé de `savedPrefs?.popup ?? []`, persistance
`persistPrefs({ popup })`.

### 4.4 ID dans le texte

`lib/elementRefs.ts` :
- `elementRefRegExp()` : `/(?<![\p{L}\p{N}_-])[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*-\d+(?![\p{L}\p{N}_])/gu` ;
- `splitElementRefs(text, exists)` → segments `{ text } | { id }`.

Rendus :
- **markdown-it** (`StaticRichTextViewer`) : règle `element_refs` après `param_refs`, sur les
  jetons `text` hors `link_open…link_close` ; rendu
  `<span class="element-ref" data-element-ref="ID">ID</span>` ; `env.elementRefs.exists`.
  Délégation sur le conteneur : `click` / `auxclick` / `mousedown` / `mouseover` / `mouseout`
  → `follow` / `hover` / `leave`. L'`html` dépend de `elementNav.version` (index rechargé).
- **TipTap lecture** (`RichTextViewer`, `editable: false`) : extension de décoration
  `ElementRefDecoration` (calquée sur `ParamRefDecoration`), active seulement si non éditable ;
  même délégation sur le conteneur.
- **texte simple** : `ParamRefText` rend ses segments de texte via `ElementRefText`, et les
  champs texte sans références de paramètres passent aussi par `ElementRefText`.

Le style `.element-ref` (souligné au survol, curseur main) est ajouté à la feuille globale.

## 5. Sites convertis (inventaire)

Vue système : `ExcelView` LinkCell (l. 590), `WordView` liens sortants / entrants (l. 715,
746), `LinkCombobox` puces (l. 117). `navigateToObject` de `SystemView` délègue à
`elementNav.follow`.

Autres écrans (ID référencé → `ElementLink`) :
- `campaign.$campaignId.tsx` : ID du test d'une ligne (l. 523), exigence (l. 539), campagne
  d'origine (l. 559) ;
- `campaign.new.tsx` l. 306, 331, 333 ; `TestPickerModal` l. 439, 477, 518 ;
  `CampaignCarryPanel` l. 193 ; `RunParamsInfo` l. 19 ; `ReqInstancePicker` l. 38 (lien
  hors du libellé de case) ;
- `constellation.tsx` l. 523, 644 ; `RevalidationList` l. 34 ; `ParameterEditDialog` l. 222,
  249 ; `DrillDownModal` l. 116 ;
- `ResultTable` (requêtes / dashboards) : cellule dont la valeur chaîne est exactement un ID
  existant → `ElementLink` ; autres cellules → `ElementRefText`.

Restent hors lien (ID propre) : en-têtes de fiche, ligne de liste (`requirements.tsx`,
`tests.tsx`, `CampaignListView`, `SearchPanel`, `SearchResultsDoc`, `ComplianceMatrix`,
`impact-analysis` élément modifié, `RevalidationList` l. 84, `FileResolver`), impressions.

## 6. MCP

`schema-mutation.tools.ts` : `displayIdField: z.string().optional()` dans le schéma de type ;
la validation passe par `SchemaService.save` (code `DISPLAY_ID_FIELD_INVALID` relayé).
`agents-md.template.ts` : une ligne sur `displayIdField`.

## 7. Découpage

- **Sprint 1** — modèle (§2), navigation (§3, #236), `ElementLink` + popup (§4.1–4.3), vue
  système (Excel, Word, LinkCombobox), éditeur de schéma, MCP, tests unitaires
  (`displayIdOf`, `displayIdFieldError`, `splitElementRefs`, `objectPage`), e2e vue système.
- **Sprint 2** — ID dans le texte (§4.4), autres écrans (§5), e2e campagne / texte, mises à jour
  SPEC.

## 8. Alternatives rejetées

- Popup par lien (état local) : plusieurs popups possibles, timers dupliqués, impossible pour
  le HTML rendu par markdown-it → contrôleur unique.
- `WorkspaceObject.category` étendu à `campaign` : touchait les candidats de l'éditeur de liens
  et la couverture → index de campagnes séparé dans `ElementNavProvider`.
- Calcul de `displayId` côté renderer : nécessitait les champs de tous les objets du workspace
  → calculé dans `listObjects`, qui les lit déjà.
