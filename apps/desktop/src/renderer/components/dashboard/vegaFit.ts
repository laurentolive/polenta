/**
 * GH435 — adaptation d'une spec Vega-Lite à la taille de sa carte (specs/GH435.md § 3.4 et § 3.6).
 *
 * Pourquoi : avec `autosize: fit`, Vega ne compte une légende que dans sa dimension orthogonale (une légende
 * à droite compte en largeur, jamais en hauteur) ; ce qui dépasse est coupé (`vega-view-transforms`,
 * `ViewLayout.js`). La place d'une légende doit donc être choisie AVANT la compilation, d'après la taille de
 * la carte et les libellés réels ; et après le rendu, il faut vérifier que rien ne dépasse, sinon le widget
 * affiche « trop petit » au lieu d'un graphique tronqué en silence.
 *
 * Fonctions pures : `fitSpec` (spec → spec) et `measureChart` (vue Vega rendue → mesures).
 */

export type Spec = Record<string, unknown>

export interface FitInput {
  /** Taille du corps de la carte (px) : celle que la vue doit occuper en entier, axes et légende compris. */
  width: number
  height: number
  /** Lignes injectées dans la source `rows` : donnent les valeurs de légende. */
  rows: readonly Record<string, unknown>[]
  /** Taille de police des axes et légendes (px), 10 à l'écran ; plus grande à l'impression. */
  minFont?: number
}

/** Canaux qui portent une légende. */
const LEGEND_CHANNELS = ['color', 'fill', 'stroke', 'shape', 'size', 'opacity', 'strokeDash'] as const
/** Largeur moyenne d'un caractère, en fraction de la taille de police (Vega mesure sur un canevas ; ceci est
 *  une estimation qui sert à CHOISIR la place, jamais à vérifier — la vérification lit la vue rendue). */
const CHAR_RATIO = 0.58
const SYMBOL_PX = 16
const LABEL_GAP_PX = 8
const LEGEND_PAD_PX = 24
/** Hauteur réservée à l'axe horizontal et à son titre (px). */
const AXIS_RESERVE_PX = 44
/** Une légende à droite ne doit pas prendre plus de cette part de la largeur. */
const RIGHT_MAX_SHARE = 0.4
/** Axes nominaux : part de la largeur (axe y) ou de la hauteur (axe x) qu'un libellé peut prendre. */
const AXIS_LABEL_SHARE_Y = 0.4
const AXIS_LABEL_SHARE_X = 0.35

const isObject = (v: unknown): v is Spec => !!v && typeof v === 'object' && !Array.isArray(v)

/** Valeurs distinctes, dans l'ordre, d'un champ de légende (domaine explicite sinon valeurs des lignes). */
function legendEntries(def: Spec, rows: readonly Record<string, unknown>[]): string[] {
  const domain = isObject(def.scale) && Array.isArray(def.scale.domain) ? def.scale.domain : null
  const values = domain ?? [...new Set(rows.map((r) => r[def.field as string]).filter((v) => v !== null && v !== undefined))]
  return values.map((v) => String(v))
}

function computeLegend(def: Spec, entries: string[], input: FitInput, userLegend: Spec): Spec {
  const font = input.minFont ?? 10
  const charPx = font * CHAR_RATIO
  const labelPx = Math.max(...entries.map((e) => e.length)) * charPx
  const rowPx = font + 6
  const userOrient = typeof userLegend.orient === 'string' ? userLegend.orient : null

  const sideLegend = (limitPx: number): Spec => ({ labelLimit: Math.max(40, Math.ceil(Math.min(labelPx + 4, limitPx))), symbolLimit: 0 })
  const bottomLegend = (): Spec => {
    const avail = Math.max(60, input.width - LEGEND_PAD_PX)
    const labelRoom = Math.max(40, avail - SYMBOL_PX - LABEL_GAP_PX)
    const labelWidth = Math.min(labelPx + 4, labelRoom)
    const columns = Math.max(1, Math.floor(avail / (labelWidth + SYMBOL_PX + LABEL_GAP_PX + 12)))
    return { orient: 'bottom', direction: 'horizontal', columns, labelLimit: Math.ceil(labelWidth), symbolLimit: 0 }
  }

  // Orientation imposée par la spec : on n'adapte que ce qui en dépend (limites de libellé).
  if (userOrient) {
    const horizontal = !['left', 'right'].includes(userOrient)
    return horizontal
      ? sideLegend(Math.max(60, input.width - LEGEND_PAD_PX - SYMBOL_PX - LABEL_GAP_PX))
      : sideLegend(input.width * RIGHT_MAX_SHARE - SYMBOL_PX - LABEL_GAP_PX)
  }

  const hasTitle = (isObject(def.legend) ? def.legend.title : def.title) !== null
  const rightWidth = labelPx + 4 + SYMBOL_PX + LABEL_GAP_PX + LEGEND_PAD_PX
  const rightHeight = entries.length * rowPx + (hasTitle ? rowPx + 8 : 0)
  const rightFits = rightWidth <= input.width * RIGHT_MAX_SHARE && rightHeight <= input.height - AXIS_RESERVE_PX
  return rightFits ? { orient: 'right', ...sideLegend(labelPx + 4) } : bottomLegend()
}

function patchEncoding(encoding: Spec, input: FitInput): Spec {
  const out: Spec = { ...encoding }
  for (const channel of LEGEND_CHANNELS) {
    const def = encoding[channel]
    if (!isObject(def) || def.legend === null || typeof def.field !== 'string') continue
    if (def.type !== 'nominal' && def.type !== 'ordinal') continue
    const entries = legendEntries(def, input.rows)
    if (entries.length === 0) continue
    const user = isObject(def.legend) ? def.legend : {}
    // Les clés posées par l'utilisateur l'emportent sur le calcul.
    out[channel] = { ...def, legend: { ...computeLegend(def, entries, input, user), ...user } }
  }
  // Axes d'une dimension discrète : un libellé long ne mange pas la moitié du graphique.
  for (const [axis, share, base] of [['y', AXIS_LABEL_SHARE_Y, input.width], ['x', AXIS_LABEL_SHARE_X, input.height]] as const) {
    const def = out[axis]
    if (!isObject(def) || def.axis === null || typeof def.field !== 'string') continue
    if (def.type !== 'nominal' && def.type !== 'ordinal') continue
    const entries = legendEntries(def, input.rows)
    if (entries.length === 0) continue
    const labelPx = Math.max(...entries.map((e) => e.length)) * (input.minFont ?? 10) * CHAR_RATIO
    const user = isObject(def.axis) ? def.axis : {}
    out[axis] = { ...def, axis: { labelLimit: Math.max(40, Math.ceil(Math.min(labelPx + 4, base * share))), ...user } }
  }
  return out
}

/**
 * Spec adaptée à `input` : pour chaque encodage à légende (racine et couches), place et limites choisies
 * d'après la taille et les libellés. Une spec sans légende discrète est rendue telle quelle ; les clés de
 * `legend` / `axis` écrites par l'utilisateur ne sont jamais remplacées ; `legend: null` n'est pas touché.
 */
export function fitSpec(spec: Spec, input: FitInput): Spec {
  const out: Spec = { ...spec }
  if (isObject(spec.encoding)) out.encoding = patchEncoding(spec.encoding, input)
  if (Array.isArray(spec.layer)) {
    out.layer = spec.layer.map((layer) => (isObject(layer) && isObject(layer.encoding) ? { ...layer, encoding: patchEncoding(layer.encoding, input) } : layer))
  }
  return out
}

// ─── Mesure après rendu ──────────────────────────────────────────────────────

/** Zone de tracé minimale (px) : en dessous, le graphique n'a plus de sens et le widget le dit. */
export const MIN_PLOT_PX = 48

interface SceneItem {
  role?: string
  items?: SceneItem[]
  bounds?: { x1: number; y1: number; x2: number; y2: number }
}

/** Ce que `measureChart` lit d'une vue Vega rendue. */
export interface MeasurableView {
  width(): number
  height(): number
  origin(): number[]
  scenegraph(): { root: { items?: SceneItem[] } }
}

export interface ChartMeasure {
  /** Zone de tracé (hors axes et légende), px. */
  plotWidth: number
  plotHeight: number
  /** Une légende dépasse de la vue : Vega la coupe. */
  legendClipped: boolean
}

/**
 * Mesures d'une vue rendue à la taille `size`. Après `autosize: fit`, `width()` / `height()` sont la zone de
 * tracé ; une légende dont les bornes (relatives au tracé, à décaler de l'origine) sortent de la vue est
 * coupée par Vega.
 */
export function measureChart(view: MeasurableView, size: { width: number; height: number }): ChartMeasure {
  const [ox = 0, oy = 0] = view.origin()
  const group = view.scenegraph().root.items?.[0]
  let legendClipped = false
  for (const mark of group?.items ?? []) {
    if (mark.role !== 'legend') continue
    for (const item of mark.items ?? []) {
      const b = item.bounds
      if (!b || ![b.x1, b.y1, b.x2, b.y2].every(Number.isFinite)) continue
      if (b.x1 + ox < -1 || b.y1 + oy < -1 || b.x2 + ox > size.width + 1 || b.y2 + oy > size.height + 1) legendClipped = true
    }
  }
  return { plotWidth: view.width(), plotHeight: view.height(), legendClipped }
}

/** Le graphique ne peut pas s'afficher entier à cette taille. */
export function isTooSmall(m: ChartMeasure): boolean {
  return m.legendClipped || m.plotWidth < MIN_PLOT_PX || m.plotHeight < MIN_PLOT_PX
}
