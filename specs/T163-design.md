# T163 — Design technique

Réf. : `specs/T163.md`. Un seul sprint.

## 1. Vue d'ensemble

Tout se joue dans `StaticRichTextViewer`
(`apps/desktop/src/renderer/lib/staticRichText.tsx`) et un nouveau module utilitaire
`apps/desktop/src/renderer/lib/staticDrawio.ts`. Aucun changement d'IPC, d'API, de
schéma ni de composant Tiptap.

Pipeline actuel : `value` (markdown) → `markdown-it` → HTML → `dangerouslySetInnerHTML`.
Un `useEffect` post-rendu résout déjà les `<img data-static-img-src>` de façon
impérative (lecture fichier repo → `data:` URI). On ajoute le **même patron** pour
les diagrammes : la *fence* `drawio` produit un placeholder, un second `useEffect`
observe ces placeholders et y monte le viewer mxGraph vendoré quand ils approchent
le viewport.

## 2. Changements par fichier

### 2.1 `lib/staticRichText.tsx`

**a. Règle de *fence* `drawio` de `getMarkdownIt()`** (≈ lignes 50-59)

Remplacer le rendu `<span>📐 label</span>` par un placeholder qui porte tout le
payload et **conserve** le span en repli :

```ts
if (info === 'drawio') {
  try {
    const parsed = JSON.parse(token.content.trim()) as {
      path?: unknown; nodeId?: unknown; width?: unknown; height?: unknown; crop?: unknown
    }
    const path = typeof parsed.path === 'string' ? parsed.path : ''
    if (!path) return ''
    const label = path.split(/[/\\]/).pop() || 'diagramme'
    const attrs = [`class="static-drawio"`, `data-drawio-path="${escapeXml(path)}"`]
    if (typeof parsed.nodeId === 'string' && parsed.nodeId)
      attrs.push(`data-drawio-node-id="${escapeXml(parsed.nodeId)}"`)
    if (typeof parsed.width === 'number')
      attrs.push(`data-drawio-width="${parsed.width}"`)
    if (typeof parsed.height === 'number')
      attrs.push(`data-drawio-height="${parsed.height}"`)
    if (parsed.crop && typeof parsed.crop === 'object')
      attrs.push(`data-drawio-crop="${escapeXml(JSON.stringify(parsed.crop))}"`)
    return `<span ${attrs.join(' ')}>`
         + `<span class="…badge actuelle…">📐 ${escapeXml(label)}</span>`
         + `</span>`
  } catch { return '' }
}
```

- Élément externe : `<span>` (et non `<div>`) — le bloc `drawio` peut être
  sérialisé dans un contexte inline ; `markdown-it` avec `html:false` n'interdit
  pas la sortie HTML des règles de renderer, mais un `<div>` dans un `<p>` casse
  le nesting. `display:inline-block` posé en CSS (2.3).
- Le span badge interne reste le **repli visuel** (avant rendu, si `repoPath`
  absent, ou sur erreur).
- `crop` sérialisé en JSON dans l'attribut (parse au consommateur via
  `parseCropAttr`).

**b. Nouveau `useEffect` d'observation** (à côté de celui des images)

```ts
useEffect(() => {
  const container = containerRef.current
  if (!container || !repoPath) return
  const placeholders = container.querySelectorAll<HTMLElement>('.static-drawio')
  if (placeholders.length === 0) return

  const teardowns: Array<() => void> = []
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const el = entry.target as HTMLElement
      io.unobserve(el)
      teardowns.push(renderStaticDrawio(el, repoPath, t))
    }
  }, { root: null, rootMargin: '200px' })

  for (const el of placeholders) io.observe(el)
  return () => { io.disconnect(); teardowns.forEach(fn => fn()) }
}, [html, repoPath, t])
```

- Clé `[html, repoPath, t]` : au changement de `html`, React réécrit
  l'`innerHTML` → l'effet se relance, l'ancien `IntersectionObserver` + les
  `ResizeObserver` par diagramme sont libérés par le cleanup.
- `t` (via `useTranslation`) est désormais nécessaire dans le composant (2.1c).

**c. `useTranslation`**

`StaticRichTextViewer` devient un composant qui appelle `useTranslation()` pour
passer `t` au helper (messages d'erreur). Pas d'autre impact.

### 2.2 `lib/staticDrawio.ts` (nouveau)

Deux exports :

```ts
export interface DrawioLayout {
  displayW: number; displayH: number
  scale: number; offsetX: number; offsetY: number
}

/** Géométrie non-éditable de ResizableMediaFrame, extraite en fonction pure
 *  (lisibilité + parité vérifiable avec le viewer live).
 *  `natural` = taille rendue mesurée du viewer. */
export function computeDrawioLayout(
  natural: { width: number; height: number },
  width: number | null,
  height: number | null,
  crop: { x: number; y: number; width: number; height: number } | null,
): DrawioLayout {
  const displayW = width ?? natural.width
  const displayH = height ?? natural.height
  if (crop && crop.width > 0 && crop.height > 0) {
    const scale = displayW / crop.width
    return { displayW, displayH, scale, offsetX: -crop.x * scale, offsetY: -crop.y * scale }
  }
  const scale = displayW / natural.width
  return { displayW, displayH, scale, offsetX: 0, offsetY: 0 }
}

/** Monte le viewer mxGraph dans le placeholder. Renvoie un teardown. */
export function renderStaticDrawio(
  placeholder: HTMLElement,
  repoPath: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): () => void
```

`renderStaticDrawio` :

1. Lit `data-drawio-*` du placeholder (`path`, `nodeId?`, `width?`, `height?`,
   `crop?` via `parseCropAttr(JSON.parse(...))`).
2. `let cancelled = false`. Jeton d'annulation renvoyé dans le teardown.
3. `const pages = await api.drawio.read(repoPath, path)` — `null`/vide →
   `showError(t('richTextViewer.drawioNotFound', { path }))`, `return`.
4. `const target = resolveDrawioTarget(pages, nodeId)` ; `page = pages[target.pageIndex]` ;
   `!page?.xml` → `showError(t('richTextViewer.drawioInvalid', { path }))`.
5. `try { await loadDrawioViewer() } catch { showError(...) }`.
6. `if (cancelled) return`.
7. Construit la structure DOM (2.2a), vide le placeholder (`placeholder.replaceChildren(outer)`).
8. `container.className = 'mxgraph'` ; `container.setAttribute('data-mxgraph', JSON.stringify({ xml: page.xml, resize: true, nav: false, lightbox: 0 }))`
   — **identique à `DrawioEmbedView`**, sans clé `toolbar`.
9. `window.GraphViewer?.createViewerForElement(container, () => { if (cancelled) return; measureAndLayout() })`.
10. `measureAndLayout()` : `ResizeObserver` sur `container` ; à chaque
    `contentRect` > 0, `computeDrawioLayout(natural, width, height, crop)` puis
    applique les styles (2.2a). L'observer est gardé jusqu'au teardown (le viewer
    peut se redimensionner après coup, cf. `DrawioEmbedView`). Ajoute le
    `ResizeObserver.disconnect` au teardown.

Teardown renvoyé : `() => { cancelled = true; resizeObs?.disconnect() }`.
(Pas de `viewer.destroy()` — non exposé par l'API vendorée telle qu'utilisée
aujourd'hui ; le nœud DOM est libéré par le remplacement d'`innerHTML` côté React.)

**2.2a Structure DOM créée**

```
placeholder <span.static-drawio> (position: relative; display: inline-block)
└─ outer <span> (display:inline-block; position:relative; overflow:hidden;
                  width: displayW; height: displayH;
                  border: 1px solid var(--edge); border-radius: 4px; background: var(--print-bg))
   ├─ inner <span> (position:absolute; left: offsetX; top: offsetY;
   │                width: natural.width; height: natural.height;
   │                transform: scale(scale); transform-origin: 0 0;
   │                pointer-events: none)
   │  └─ container <div> (le conteneur mxgraph)
   └─ overlay <span> (position:absolute; inset:0)   ← capte le pointeur, aucun
                                                        handler ; le click remonte
                                                        au onClick du champ (R5)
```

Avant la 1ʳᵉ mesure : `outer` prend une taille provisoire
(`width ?? 400` × `height ?? 300`, mêmes valeurs de repli que
`FALLBACK_BOUNDS`) ; `measureAndLayout` la corrige.

`showError(msg)` : `placeholder.replaceChildren` d'un `<span>` discret
(`class` texte d'erreur, `text-status-danger`, `text-xs`) contenant `msg`.

### 2.3 CSS

Ajouter au `VIEWER_CLASS` de `staticRichText.tsx` (ou une règle globale) :
`[&_.static-drawio]:inline-block [&_.static-drawio]:my-2 [&_.static-drawio]:align-top`.
Le `.mxgraph` interne est stylé par le viewer vendoré lui-même.

### 2.4 i18n

Ajouter dans `fr.json` / `en.json`, section `richTextViewer` (créer si absente) :

| clé | fr | en |
|-----|----|----|
| `richTextViewer.drawioNotFound` | `Diagramme introuvable : {{path}}` | `Diagram not found: {{path}}` |
| `richTextViewer.drawioInvalid` | `Diagramme invalide : {{path}}` | `Invalid diagram: {{path}}` |

(`DrawioEmbedView` garde ses chaînes en dur — hors périmètre de ce ticket.)

### 2.5 Mise à jour SPEC (dernier sprint)

- `SPEC-REQ-requirements.md §3.2a` : ajouter que le diagramme est rendu **aussi
  en lecture Vue Word**, via un rendu paresseux (`IntersectionObserver`) borné au
  viewport ; le viewer n'y est jamais interactif (clic = passe le champ en
  édition).
- `SPEC-REQ-requirements.md §3.2b` : préciser que « jamais dans le rendu lecture
  seule » vise l'**interaction d'édition** (poignées, rognage, menu), pas la
  présence du diagramme ; le cadrage/redimensionnement **stockés** sont bien
  restitués en lecture.
- `SPEC-SYSTEM-VIEW.md §"Vue Word"` : note « les diagrammes draw.io des champs
  richtext sont rendus paresseusement (au défilement) ».
- `SPEC-INDEX.md` colonne MAJ → `T163` pour `SPEC-REQ §3`, `SPEC-SYSTEM-VIEW`.

## 3. Décisions (questions ouvertes de la spec)

| # | Décision | Justification |
|---|----------|---------------|
| QO1 | **Pas de surlignage de cellule** en v1. `resolveDrawioTarget` sélectionne quand même la bonne page ; `highlightCellId` ignoré. | Overlay de surlignage = code mxGraph interne fragile ; la page contenante suffit à la lecture. Réintroductible si demandé. |
| QO2 | **Pas de plafond** de rendus concurrents. | `IntersectionObserver` + `rootMargin` bornent déjà ; `loadDrawioViewer()` est un singleton. Un « Tout déplier » massif reste un cas limite — à instrumenter en test de charge (T163-tests §4), file d'attente ajoutée seulement si jank mesuré. |
| QO3 | `root: null` (viewport), `rootMargin: '200px'`. | Plus simple et robuste que cibler le conteneur scrollable ; 200 px = pré-chargement d'un écran partiel. |
| QO4 | **Un `IntersectionObserver` par instance** de `StaticRichTextViewer`. | Cleanup trivialement corrélé au cycle de vie du composant ; le nombre d'instances = nombre de champs richtext visibles, négligeable. |

## 4. Risques / points d'attention

1. **`<span>` externe dans un `<p>`** : la sortie de la *fence* est insérée par
   `markdown-it` au niveau bloc → en pratique le bloc `drawio` est sur sa propre
   ligne, `markdown-it` l'enveloppe dans un `<p>`. Un `<span display:inline-block>`
   y est valide (contrairement à `<div>`). Vérifier au rendu réel qu'aucun `<p>`
   parasite ne casse la mise en page (test M3).
2. **Course annulation** : un placeholder qui entre puis sort du viewport pendant
   le `await api.drawio.read` — on a déjà `unobserve` dès l'entrée, et le
   `cancelled` protège les étapes suivantes. Le teardown global (changement de
   `html`) met tous les `cancelled = true`.
3. **`dangerouslySetInnerHTML` réécrit** : si `value` change, React remplace le
   sous-arbre ; nos nœuds mxGraph partent avec. L'effet se relance et rebranche
   sur les nouveaux placeholders. Pas de double-montage car `unobserve` + nouvel
   observer.
4. **Mesure `natural` tardive** : `createViewerForElement` est asynchrone et le
   viewer se redimensionne parfois après le 1ᵉʳ callback (`resize:true`) — d'où
   le `ResizeObserver` gardé actif (pas une mesure ponctuelle), comme
   `DrawioEmbedView.tsx:143-162`.
5. **Thème** : le viewer rend le XML tel quel (couleurs du diagramme) ; le fond
   `--print-bg` (déjà utilisé par `DrawioEmbedView`) garantit un contraste
   correct en thème sombre.

## 5. Périmètre sprint unique

Un seul sprint :
- 2.1 fence + effect + `useTranslation`
- 2.2 module `staticDrawio.ts`
- 2.3 CSS, 2.4 i18n
- Vérif `typecheck` + `lint` (pas de runner de test dans le repo — cf. T163-tests,
  scénarios manuels)
- 2.5 MAJ SPEC + `SPEC-INDEX`

> **Note infra** : ni `apps/desktop` ni les `packages/*` n'embarquent de runner de
> test (`turbo test` ne cible rien). La validation repose sur `typecheck`, `lint`
> et les scénarios manuels de `T163-tests.md`. `computeDrawioLayout` reste une
> fonction pure isolée : si un runner est introduit plus tard, elle est
> directement testable.
