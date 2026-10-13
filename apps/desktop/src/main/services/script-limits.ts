// GH74 — limites et types du bac à sable, sans dépendance à QuickJS : importables par le main
// (moteur, bibliothèque) sans charger le wasm, qui ne vit que dans le worker.

export interface SandboxLimits {
  /** Limite mémoire d'un runtime (graphe compris). */
  memoryBytes: number
  /** Limite de temps d'une exécution (script + transformation). */
  timeMs: number
  /** Pile maximale. Au-delà de ~256 Ko, la récursion déborde la pile native avant QuickJS (#78). */
  stackBytes: number
  /** Plafond de la mémoire linéaire wasm d'un module. */
  wasmMaxMb: number
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  memoryBytes: 64 * 1024 * 1024,
  timeMs: 2000,
  stackBytes: 256 * 1024,
  wasmMaxMb: 128,
}

/** Modules de la bibliothèque : clé d'import (`lib/x.js`, `<composant>::lib/x.js`) → source. */
export type LibraryModules = Record<string, string>
