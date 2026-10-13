// Point d'entrée de mesure : chaque bibliothèque n'est chargée qu'au premier widget affiché
// (import() → chunk séparé), comme alasql aujourd'hui. Le chunk d'entrée = surcoût permanent.
export const loaders = {
  vegaRuntime: () => import('./chunk-vega-runtime'),
  vegaLite: () => import('./chunk-vega-lite'),
  vegaEmbed: () => import('./chunk-vega-embed'),
  quickjs: () => import('./chunk-quickjs'),
}
;(globalThis as { __gh78?: unknown }).__gh78 = loaders
