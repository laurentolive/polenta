export type Side = 'left' | 'right'

/** How a conflicting file is merged and edited (GH37 design §2.1). */
export type FileKind = 'object' | 'text' | 'binary'

/** Labels written on the conflict markers of a region (`<<<<<<< <left> [key]`). */
export interface MarkerLabels {
  left: string
  right: string
}

/** One conflict block: an object field (`title`, `fields.statement`…) or a text hunk (`hunk:0`). */
export interface MergeBlock {
  key: string
  /** Side fragments as they appear in a marker region — `undefined` = absent on that side. */
  left?: string
  right?: string
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
  /** `kind: 'object'` only — the YAML outside the regions, when it parses. */
  value?: Record<string, unknown>
  /** Malformed markers or invalid YAML outside the regions. */
  error?: string
}
