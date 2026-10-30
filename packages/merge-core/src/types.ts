export type Side = 'left' | 'right'

/** How a conflicting file is merged and edited (GH37 design §2.1). GH222: `yaml` = any other YAML
 *  written by the app (generic structural merge), `trees` = display trees (`.polenta/trees`),
 *  `drawio` = merged page by page. */
export type FileKind = 'object' | 'links' | 'parameters' | 'yaml' | 'trees' | 'drawio' | 'text' | 'binary'

/** Labels written on the conflict markers of a region (`<<<<<<< <left> [key]`). */
export interface MarkerLabels {
  left: string
  right: string
}

/** One conflict block: an object field (`title`, `fields.statement`…), a text hunk (`hunk:0`), or
 *  any node of a YAML file (GH222: `steps~2`, `link:<id>`, a pointer `/nodes/@root/label`…). */
export interface MergeBlock {
  key: string
  /** Side fragments as they appear in a marker region — `undefined` = absent on that side. */
  left?: string
  right?: string
  /** Fragment of the common ancestor (« Prendre l'ancêtre ») : `''` = absent from the ancestor,
   *  `undefined` = not available for this block (a display tree position). */
  base?: string
}

/** Outcome of the 3-way merge of one file, before any user action. */
export interface FileMerge {
  kind: FileKind
  /** Initial output: resolved parts + one marker region per block. */
  output: string
  blocks: MergeBlock[]
  /** Units taken automatically from one side (or identical on both). */
  auto: { key: string; from: Side | 'both' }[]
}

/** Result of reading an output back: the marker regions still open, and the parsed value. */
export interface ParsedOutput {
  /** Keys of the regions still present in the text, in order. */
  unresolved: string[]
  /** YAML kinds only — the YAML outside the regions, when it parses. */
  value?: Record<string, unknown>
  /** Malformed markers or invalid YAML outside the regions. */
  error?: string
}
