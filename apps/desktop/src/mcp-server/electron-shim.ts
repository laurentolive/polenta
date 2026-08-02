/**
 * Substitut minimal du module `electron` — utilisé UNIQUEMENT lors du bundling du
 * serveur MCP packagé (`pnpm build:mcp-server`, esbuild `--alias:electron=...`, cf.
 * `package.json`), jamais en dev (`tsx src/mcp-server/index.ts`, où `import 'electron'`
 * résout déjà vers le stub npm `electron` — même comportement observable, cf.
 * ci-dessous).
 *
 * Les classes réutilisées de `main/services/*` (`AuthService` notamment) importent
 * `{ app, shell } from 'electron'` en tête de fichier, mais aucun tool MCP de ce
 * ticket n'appelle jamais une méthode qui les utilise réellement (lecture seule +
 * garde-fous du ticket — pas de clone/push/pull/commit/token, cf.
 * specs/T122-design.md §2.1). Un bundle Node autonome packagé (hors process Electron)
 * n'a pas accès au vrai module `electron` — plutôt que de le laisser échouer au
 * `require` (erreur cryptique "Cannot find module 'electron'" dès l'import, même si
 * jamais appelé), ce shim répond avec un objet qui échoue EXPLICITEMENT si un futur
 * changement de code venait à réellement invoquer `app`/`shell` — jamais
 * silencieusement.
 *
 * (En dev via `tsx`, le vrai stub npm `electron` — présent dans `node_modules` car
 * c'est une dépendance du projet — est chargé à la place de ce shim, mais son
 * comportement est équivalent pour notre usage : hors d'un process Electron réel, il
 * exporte simplement le chemin du binaire Electron en `default`, donc `app`/`shell`
 * y sont déjà `undefined` — un appel réel y échouerait aussi, avec un message moins
 * explicite. Ce shim durcit ce même constat pour le bundle packagé.)
 */
function notAvailable(name: string): never {
  throw new Error(
    `[mcp-server] '${name}' (module 'electron') n'est pas disponible en mode serveur MCP autonome — ` +
      'ce tool ne devrait jamais y accéder (cf. src/mcp-server/electron-shim.ts).',
  )
}

function makeUnavailableProxy(namespace: string): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get: (_target, prop) => () => notAvailable(`${namespace}.${String(prop)}`),
    },
  )
}

export const app = makeUnavailableProxy('app')
export const shell = makeUnavailableProxy('shell')
export const session = {
  // `net-proxy.ts` (résolution du proxy système via Chromium) encadre déjà cet appel
  // dans un try/catch best-effort — l'échec explicite ci-dessous y est absorbé et
  // retombe simplement sur une connexion directe, comme si aucun proxy système
  // n'était configuré.
  defaultSession: makeUnavailableProxy('session.defaultSession'),
}
export const BrowserWindow = class {
  constructor() {
    notAvailable('BrowserWindow')
  }
}
