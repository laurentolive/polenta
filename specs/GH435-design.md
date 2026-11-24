# GH435 — Design : dimensions réglables des widgets, mise en page responsive

Spec : `specs/GH435.md` (validée le 2026-11-24). Scénarios : `specs/GH435-tests.md`.

## 1. Découpage en 4 sprints

| Sprint | Contenu | Vérifié par |
|--------|---------|-------------|
| 1 | Modèle, constantes, lecture / écriture, service, MCP, types de l'API | unitaires, typecheck |
| 2 | Flux responsive, poignées de redimensionnement, enregistrement, modale | e2e critères 1, 2, 3, 9, 10, 12, 13, 14 |
| 3 | Rendu adapté au conteneur : taille observée, légendes, « trop petit », infobulles, tableaux | e2e critères 4 à 7 |
| 4 | Impression, mises à jour des SPEC, documentation, niveau 2 complet | e2e critère 8, unitaires des options |

Chaque sprint laisse l'application utilisable : le sprint 1 n'a aucun effet visible, le sprint 2 ajoute le
réglage (graphiques encore redessinés à l'ancienne), le sprint 3 corrige les coupures.

## 2. Modèle et constantes — `packages/types`

Nouveau fichier `packages/types/src/widget-size.ts`, exporté par `index.ts`. Une seule définition, utilisée
par le renderer, le main et le MCP.

```ts
export const DASHBOARD_REF_WIDTH = 1104        // W (Q1)
export const DASHBOARD_GAP = 16
export const DASHBOARD_SMALL_ZONE = 640
export const WIDGET_MIN_WIDTH = 240
export const WIDGET_MIN_HEIGHT = 160
export const WIDGET_MAX_HEIGHT = 720
export const WIDGET_DEFAULT_HEIGHT = 256
export const WIDGET_PRESET_WIDTH: Record<WidgetSize, number> = { sm: 264, md: 544, lg: 1104 }

clampWidgetWidth(v: number, max = DASHBOARD_REF_WIDTH): number   // arrondi puis bornage
clampWidgetHeight(v: number): number
readWidgetDim(v: unknown, kind: 'width' | 'height'): number | undefined  // non numérique → undefined
widgetRequestedWidth(w: { size: WidgetSize; width?: number }): number
widgetDisplayWidth(requested: number, zoneWidth: number): number | '100%'   // règle du flux (spec 3.2)

// Impression (spec 3.7, Q3)
export const PRINT_MARGIN_MM = 10
export const PRINT_PAGE_WIDTH_MM = 210
export function printScale(refWidth = DASHBOARD_REF_WIDTH): number
export const PRINT_SCALE = printScale()        // 0,65
export const PRINT_MIN_FONT_PX = 8
export function printFontFloor(scale = PRINT_SCALE): number   // ceil(8 / s) = 13
```

- `size` ne change pas ; `WidgetSize` reste dans `dashboard.ts`. `Widget`, `StoredWidget`, `ReadWidget` gagnent
  `width?: number` et `height?: number`.
- `widgetDisplayWidth` : zone < 640 → `'100%'` ; sinon `clamp(requested, min(240, zone), zone)`. Fonction
  pure, testée seule, utilisée par la grille.
- `printScale` : largeur utile de la page `Lp = (210 − 2 × 10) / 25,4 × 96 = 718,1 px` ; `s = ⌊Lp / W × 1000⌋ / 1000`
  = 0,650. La largeur de mise en page du moteur est `Lp / s = 1104,8 px ≥ W` : la grille de 1104 px tient avec
  0,8 px de marge. Une échelle arrondie *vers le bas* garantit qu'aucun contenu n'est coupé à droite.
- `printFontFloor` : taille de police (en px de mise en page) pour atteindre 8 px effectifs.

**Format de fichier.** `dashboard.yaml` et entrée `.pref` : clés `width` et `height` de l'entrée du widget,
écrites seulement si elles existent (ordre `id, title, queryId, size, width, height, template`). Pas de
changement de `formatVersion` (précédent GH93). `readWidget` (`suivi-format.ts`) lit `readWidgetDim` ; une
valeur hors bornes est ramenée aux bornes, une valeur non numérique est ignorée.

## 3. Main

### 3.1 `DashboardsService`

- `AddWidgetDto` et `UpdateWidgetDto` : `width?: number | null`, `height?: number | null` (`null` = retirer).
- `DraftWidget` : `width?`, `height?`. Propagés par `toWidget`, `toDraft`, `storedWidget` (donc `stored`,
  `toPrivate`, `writeShared`) — les quatre endroits qui recopient un widget, repérés par recherche de
  `size:` dans le service.
- `addWidget` : `normalizeDim` sur chaque champ fourni. `updateWidget` : `undefined` conserve, `null` retire,
  nombre → `clamp…` ; valeur non finie ou non numérique → `Error('Largeur de widget invalide : …')`.
- Aucun autre service ne reconstruit un widget (vérifié : seeds et mises à jour passent par `addWidget` /
  `updateWidget`) ; `setScope` passe par `toDraft`, les dimensions suivent.
- Le service ne connaît pas la largeur disponible : il borne à `W`. L'écran borne en plus à la zone.

### 3.2 MCP — `dashboards.tools.ts`

- `addWidgetInput` : `width: z.number().int().min(WIDGET_MIN_WIDTH).max(DASHBOARD_REF_WIDTH).optional()` et
  `height` (160 à 720). `updateWidgetInput` : mêmes champs avec `.nullable()` (retour au défaut).
- Rejet par le schéma hors bornes (retour d'erreur à l'agent) ; le service borne en plus (défense).
- Aperçu (`dryRun`) : le widget candidat porte `width` / `height` ; l'écriture les passe au service.
- Descriptions des deux outils et texte d'`AGENTS.md` (`agents-md.template.ts`) : phrase sur les dimensions.
- `list_dashboards` renvoie déjà le widget entier : `width` / `height` apparaissent sans autre changement.

### 3.3 `packages/api-client`

`AddWidgetDto` / `UpdateWidgetDto` : mêmes champs. Le canal IPC `dashboards:update-widget` et la liste
blanche du serveur web sont inchangés (le DTO passe tel quel au service, qui valide).

## 4. Renderer

### 4.1 Flux et zone — `DashboardGrid.tsx`

- Racine : `div.flex.flex-wrap.items-start.gap-4`, observée par `useElementSize` (largeur de zone).
- Chaque widget : `div.relative` (`WidgetSlot`) avec `style={{ flex: '0 1 <largeur>px', maxWidth: '100%',
  minWidth: 'min(240px, 100%)' }}` ; zone < 640 px : `flex: '0 0 100%'`. La largeur vient de
  `widgetDisplayWidth(widgetRequestedWidth(widget), zoneWidth)`.
- Carte : `style={{ height }}` avec `height = widget.height ?? 256` ; tableau natif sans `height` :
  `style={{ minHeight: 160, maxHeight: 720 }}` (auto, § 4.6). `SIZE_SPAN` et `grid-cols-4` disparaissent.
- Glisser-déposer : inchangé (position avant / après selon la moitié horizontale de la cible).
- `printMode` : voir § 5.

### 4.2 Poignées — `ResizeHandle.tsx` (nouveau) et `WidgetSlot`

- Deux poignées par widget modifiable, enfants de `WidgetSlot` (hors de la carte `overflow-hidden`) :
  bord droit (`data-testid="widget-resize-w"`) et bord bas (`widget-resize-h`), `role="separator"`,
  `aria-orientation`, `aria-label` (« Redimensionner la largeur / la hauteur »).
  Repère visible en permanence : barre de 4 × 32 px au milieu du bord, `bg-edge`, accentuée au survol.
- Événements : `pointerdown` → `setPointerCapture`, `user-select: none` sur `body` jusqu'au relâchement ;
  `pointermove` → nouvelle taille bornée (`min`/`max` + zone) mise dans un état local `live`, au plus une fois
  par frame (`requestAnimationFrame`) ; `pointerup` / `pointercancel` → arrondi, appel de `onResizeWidget`.
- **Pas de glisser de carte.** La carte est `draggable` : `onPointerEnter` / `onPointerLeave` des poignées
  appellent `onDragLock` (même mécanisme que les sélecteurs GH125). La capture du pointeur garde le
  verrou jusqu'au relâchement.
- Double-clic : `onResizeWidget({ width: null })` ou `{ height: null }`.
- Pas de poignée si `printMode`, `readOnly` ou `dashboard.state.readOnly`.
- **Pas d'à-coup au retour du serveur.** `live` reste appliqué jusqu'à la fin de la mutation : `onResizeWidget`
  renvoie une promesse qui se résout *après* la relecture du dashboard (`onSuccess` renvoie
  `Promise.all(invalidateQueries)`), puis `live` est remis à `null` ; en cas d'échec il est remis à `null`
  aussitôt (la carte revient à la taille enregistrée) et l'erreur est affichée.

### 4.3 Page — `dashboard.tsx`

- `resizeWidgetMutation` : `api.dashboards.updateWidget(repoPath, username, dashboardId, widgetId, dto)`,
  `onSuccess` : relecture du dashboard et de la liste (promesse renvoyée), `onError` : message dans le bandeau
  d'erreur de la page (`sizeError`, même style que `scopeError`).
- La zone `max-w-6xl p-6` reste ; un commentaire la relie à `DASHBOARD_REF_WIDTH` et un test
  (e2e critère 3) vérifie que la zone mesure 1104 px sur grand écran.

### 4.4 Taille observée — `useElementSize` (nouveau, `hooks/`)

`ResizeObserver` sur un élément ; valeur `{ width, height }` arrondie, mise à jour tout de suite à la première
mesure puis **au plus toutes les 120 ms** (début et fin d'une rafale), ce qui borne le coût d'un redessin
pendant un glissement. Aucun `zoom` CSS dans l'application, donc `contentRect` est fiable.

### 4.5 Graphique — `VegaView.tsx`, `vegaFit.ts` (nouveau), `vegaTheme.ts`

- `VegaView` : racine `relative h-full w-full`, conteneur de mesure `absolute inset-0` (le graphique ne peut
  plus agrandir sa carte). La spec reçoit `width` / `height` **numériques** (taille du corps), plus
  `container` ni `− 40` ; `autosize: { type: 'fit', contains: 'padding' }` est conservé (il est correct, § 1
  de la spec). Une valeur explicite de la spec de l'utilisateur l'emporte (`...resolved` en dernier).
- **Remplacement sans clignotement.** Chaque redessin embarque dans un conteneur détaché, mesure, puis
  `host.replaceChildren(conteneur)` et `finalize()` de l'ancienne vue ; un compteur écarte les rendus
  périmés. Corrige aussi le blanc existant au changement de thème ou de données.
- **`fitSpec(spec, { width, height, rows, minFont })`** (pure, testée) : pour chaque encodage à légende
  (`color`, `fill`, `stroke`, `shape`, `size`, `opacity`, `strokeDash`, au niveau racine et dans `layer`) dont le
  champ est nominal ou ordinal et dont `legend` n'est pas `null` :
  1. entrées = valeurs distinctes de `rows` (ou `scale.domain`), longueur maximale d'un libellé ;
  2. légende **à droite** si sa largeur estimée (`libellé × 5,6 px + 28`) ≤ 40 % de la largeur et si sa hauteur
     tient dans `hauteur − 44` ; sinon **en bas**, `direction: horizontal`, `columns` = ce que la largeur
     permet ;
  3. `labelLimit` = min(libellé le plus long, place disponible) ; `symbolLimit: 0` (pas de limite à 30) ;
  4. les clés posées par l'utilisateur dans `legend` (`orient`, `columns`, `labelLimit`, `symbolLimit`…)
     l'emportent ; `legend: null` n'est pas touché.
  Axes nominaux / ordinaux : `labelLimit` borné à 40 % de la largeur (axe y) ou 35 % de la hauteur (axe x).
- **Second passage de mise en page (ajouté au sprint 3, constaté dans Chromium).** `autosize: fit` ne se
  calcule qu'une fois, au premier passage, quand `rows` est vide ; après `view.data('rows', …).runAsync()`,
  `await view.resize().runAsync()` replace le tracé d'après la légende et les axes réels (sans lui, la légende
  dépasse de la vue : le premier essai du sprint 3 affichait « trop petit » partout). Un script de contrôle
  rend le graphique dans Chromium (md, lg, sm) avec et sans adaptation.
- **Mesure et « trop petit ».** Après `runAsync`, la zone de tracé est lue sur la scène Vega
  (`view.scenegraph().root.items[0]` : `width`, `height` ; repli sur les signaux `width` / `height` — à
  confirmer par un essai au début du sprint 3). Tracé < 48 px d'un côté, ou légende dont les bornes
  dépassent la vue (Vega la couperait) : le graphique n'est **pas** inséré ; `data-testid="widget-too-small"`
  affiche le message. Le prochain changement de taille relance l'essai.
- **Infobulles.** Après rendu, les `<text>` de légende et d'axe qui finissent par « … » reçoivent un
  `<title>` (texte entier retrouvé par préfixe dans les valeurs). Le titre du widget : `title` posé au survol
  seulement s'il est réellement tronqué (`scrollWidth > clientWidth`).
- `themeConfig(resolve, minFont = 10)` : tailles de police des axes et légendes = `minFont` (13 en
  impression).

### 4.6 Tableaux — `WidgetRenderer.tsx`, `ResultTable.tsx`, carte

- Tableau natif sans `height` : carte `minHeight: 160`, `maxHeight: 720`, hauteur automatique.
- Pour que le défilement interne s'active au plafond, toute la chaîne corps → tableau est en colonne flex
  avec `min-h-0` : corps de carte `flex flex-col`, enveloppe du tableau `flex-1 min-h-0 flex flex-col`
  (au lieu de `h-full overflow-hidden`), racine de `ResultTable` compact `flex-1 min-h-0` (au lieu de `h-full`).
  Les vues qui restent à `h-full` (KPI, Vega) ont une carte à hauteur fixe, donc définie.
- Avec `height` enregistrée, la carte est à hauteur fixe : le même enchaînement défile.

### 4.7 Modale — `WidgetConfigModal.tsx`

- `save()` : si le préréglage a changé par rapport au widget modifié, `width: null, height: null` s'ajoutent
  au DTO (`WidgetConfigResult` étendu). Inchangé sinon.
- Sous les boutons radio, quand le widget a des dimensions enregistrées : « Taille personnalisée : 700 × 320 px —
  choisir une taille remet les dimensions par défaut. »
- L'aperçu reste dans sa boîte (`flex-1 min-h-[260px]`) : il utilise le même `VegaView`, donc la même taille
  observée et le même message « trop petit ».

### 4.8 i18n

Clés FR et EN : `dashboardPage.resize.width`, `dashboardPage.resize.height`, `dashboardPage.widget.tooSmall`,
`dashboard.widgetModal.sizeCustomHint`, `dashboardPage.sizeSaveError`.

## 5. Impression

- **Moteur, pas CSS.** L'échelle passe par l'option `scale` du moteur (Electron `printToPDF({ scale })`,
  Chromium headless `page.pdf({ scale })`) : la page est mise en page à `Lp / s` = 1104,8 px puis réduite.
  Aucun `zoom` ni `transform` : Vega, `ResizeObserver` et la pagination travaillent en pixels de mise en page
  normaux. Alternative rejetée : `zoom: s` sur la grille (mesures d'éléments ambiguës selon la version de
  Chromium, double réduction possible des graphiques).
- **Options par type d'export** — `print-renderer.ts` : `PRINT_OPTIONS_BY_KIND: Partial<Record<ExportKind,
  { scale: number; marginMm: number }>>`, seul `dashboard` est renseigné (`PRINT_SCALE`, `PRINT_MARGIN_MM`).
  Deux convertisseurs purs, testés : Electron `{ scale, margins: { top, bottom, left, right } en pouces }`,
  Playwright `{ scale, margin: { … '10mm' } }`. Les autres exports gardent leurs options actuelles.
  Aujourd'hui Electron imprime avec ses marges par défaut (1 cm) et Playwright sans marge : pour le dashboard
  les deux prennent 10 mm.
- **Route `/print/dashboard`** : plus de `p-10` ; conteneur de largeur fixe `DASHBOARD_REF_WIDTH` (jamais
  réduit à la fenêtre : la fenêtre cachée a sa propre taille pendant le rendu) ; titre `h1` dans ce
  conteneur. `DashboardGrid` en `printMode` : largeurs = largeur demandée sans réduction à la zone, pas de
  poignées, `break-inside: avoid` sur chaque `WidgetSlot` (et `break-after` neutre).
- Polices : `themeConfig` reçoit `printFontFloor()` (13 px de mise en page = 8,45 px imprimés) ; une règle CSS
  limitée à la route (`.print-widgets`) relève de même le texte HTML des cartes (`text-xs`, `text-[11px]`,
  `text-[10px]`). Le test d'impression parcourt le texte du widget et vérifie `fontSize × s ≥ 8`.
- **Prêt à imprimer** : chaque widget signale `onRendered` après son insertion définitive (y compris
  « trop petit » et les tableaux), comme aujourd'hui.

## 6. Décisions et alternatives rejetées

| Sujet | Retenu | Rejeté, pourquoi |
|-------|--------|------------------|
| `autosize.contains` | rester à `padding` | `content` : n'inclut ni axes ni légendes, ajoute 10 px de débordement (§ 1 de la spec) |
| Redessin | recompiler à chaque taille, plafonné à 120 ms | `view.resize()` : ne recalcule pas la légende choisie selon la taille |
| Légende | `fitSpec` sur la spec avant compilation | patcher le SVG après coup : la place est déjà perdue |
| Échelle d'impression | option `scale` du moteur | `zoom` / `transform` CSS (ci-dessus) |
| Modification pendant le glissement | état React plafonné à une fois par frame | mutation directe du DOM : écrasée par tout rendu parent concurrent |
| Format | champs facultatifs, sans `formatVersion` | v2 : rendrait en lecture seule les dashboards chez les collègues non à jour |
| Hauteur d'un tableau | CSS (min / max + chaîne flex) | mesurer les lignes en JS : fragile, double rendu |
| Retour au défaut | double-clic sur la poignée | menu contextuel : plus de code, peu découvrable |

## 7. Fichiers

| Fichier | Sprint |
|---------|--------|
| `packages/types/src/widget-size.ts` (nouveau), `dashboard.ts`, `suivi-format.ts`, `index.ts` | 1 |
| `apps/desktop/src/main/services/dashboards.service.ts` | 1 |
| `apps/desktop/src/mcp-server/tools/dashboards.tools.ts`, `main/services/agents-md.template.ts` | 1 |
| `packages/api-client/src/types.ts` | 1 |
| `renderer/components/dashboard/DashboardGrid.tsx`, `ResizeHandle.tsx` (nouveau) | 2 |
| `renderer/routes/dashboard.tsx`, `WidgetConfigModal.tsx`, fichiers i18n | 2 |
| `renderer/hooks/useElementSize.ts` (nouveau), `VegaView.tsx`, `vegaFit.ts` (nouveau), `vegaTheme.ts` | 3 |
| `widgets/WidgetRenderer.tsx`, `ResultTable.tsx` | 3 |
| `renderer/routes/print.dashboard.tsx`, `main/host/print-renderer.ts`, `electron-pdf.ts`, `web-server/print/headless-print.ts`, CSS d'impression | 4 |
| `specs/SPEC-DASHBOARDS.md`, `SPEC-MCP-SERVER.md`, `SPEC-WEB.md`, `SPEC-ELECTRON-DESKTOP.md`, `SPEC-INDEX.md`, tutoriels `docs/` | 4 |
| Tests : § `GH435-tests.md` | 1 à 4 |

## 8. Risques et parades

- **Glisser natif** : verrou de glisser sur les poignées + test e2e du critère 10 (souris).
- **Arrondi du flux** : `flex-basis` en px entiers, test à 1104 px exact ; test à 1103 px pour fixer le
  comportement (passage à la ligne attendu, pas de débordement).
- **Légende coupée par Vega** : détection par les bornes de la scène, jamais par la seule heuristique.
- **Pagination d'un conteneur flex** : vérifiée par le nombre de pages d'un PDF de contrôle (13 cartes de
  720 px : 7 pages avec `break-inside: avoid`, 6 sans). Repli si Chromium coupe quand même : rangées en blocs
  (`display: block` par rangée) en impression seulement.
- **Texte HTML sous 8 px imprimés** : règle CSS d'impression + test sur tous les textes du widget.
- **Régression sur les graphiques existants** : le corpus `suivi-corpus` ne rend pas de graphique ; les e2e
  GH74 / GH69 / GH93 / GH125 (graphiques, matrice, tableaux, sélecteurs) sont relancés au niveau 2.
