// Point d'entrée de mesure côté Node (process main Electron / serveur web / serveur MCP).
export const loaders = {
  quickjs: () => import('./chunk-quickjs'),
  vegaLite: () => import('./chunk-vega-lite'),
}
