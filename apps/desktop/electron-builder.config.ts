/**
 * Configuration electron-builder, paramétrée par la marque (GH49 — remplace electron-builder.yml).
 * Utilisée par scripts/package.ts (API programmatique). Pour la marque `polenta`, produit
 * exactement la configuration historique (vérifié par scripts/check-gh49.ts).
 *
 * Les macros `${version}` / `${ext}` d'electron-builder sont dans des chaînes simples (pas des
 * template literals) : elles doivent rester littérales jusqu'à electron-builder.
 */
import path from 'node:path'
import type { Configuration, PublishConfiguration } from 'electron-builder'
import type { LoadedBrand } from './scripts/brand'

/** Nom de fichier de l'installeur, réduit à [A-Za-z0-9._-] (accents retirés, le reste → tiret) :
 * GitHub renomme les espaces et caractères spéciaux au téléversement, latest.yml pointerait alors
 * vers un fichier inexistant — GH49 design D4. */
export function artifactBaseName(productName: string): string {
  return productName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function publishConfig(brand: LoadedBrand): PublishConfiguration | null {
  const update = brand.info.update
  if (!update) return null
  if (update.provider === 'github') {
    return { provider: 'github', owner: update.owner, repo: update.repo, releaseType: 'release' } as PublishConfiguration
  }
  return { provider: 'generic', url: update.url } as PublishConfiguration
}

export function builderConfig(brand: LoadedBrand): Configuration {
  const { info, icons } = brand
  return {
    appId: info.appId,
    productName: info.productName,
    // GH26 — l'installeur NSIS one-click par utilisateur nomme son dossier d'installation (et le
    // cache de l'updater) d'après le "name" npm, pas productName : "@polenta/desktop" donnait
    // %LOCALAPPDATA%\Programs\@polentadesktop. Réécrit seulement le package.json packagé ; userData
    // n'en dépend pas (main/index.ts force app.setName(BRAND.productName)).
    extraMetadata: {
      name: info.executableName,
    },
    // keytar ne se recompile pas ici : son binaire napi prébuilt (récupéré par prebuild-install à
    // l'install) est déjà celui qu'utilisent `pnpm dev`/`pnpm preview` avec succès (N-API est stable
    // entre versions d'Electron, pas besoin de rebuild par cible) — laisser npmRebuild à true déclenche
    // `npm rebuild keytar` via node-gyp, qui échoue ici faute de toolchain MSVC C++ complet installée.
    npmRebuild: false,
    // keytar.node (module natif) ne peut pas être chargé (dlopen) depuis l'intérieur d'app.asar — doit
    // être extrait tel quel à côté (app.asar.unpacked). D'ordinaire electron-builder détecte ça tout
    // seul, mais son détecteur de modules natifs ne suit pas la structure symlinkée de node_modules par
    // pnpm : sans cette ligne, keytar.node finit packagé DANS l'asar et le require échoue au lancement
    // ("Cannot find module '../build/Release/keytar.node'").
    // GH74 — worker du moteur de scripts et .wasm de QuickJS : chargés hors asar (`new Worker(path)`).
    // GH238 — node-pty en entier : binaires (.node, conpty.dll, OpenConsole.exe) et worker de sortie
    // ConPTY (`new Worker(__dirname/…)`), chargé depuis app.asar.unpacked (terminal.service.ts).
    asarUnpack: ['**/keytar/build/Release/keytar.node', 'out/main/script-worker.js', 'out/main/emscripten-module.wasm', '**/node_modules/node-pty/**'],
    directories: {
      output: 'dist',
      // GH49 — les ressources de build (icônes) vivent dans le dossier de la marque.
      buildResources: path.relative(path.resolve(__dirname), brand.dir),
    },
    files: [
      'out/**/*',
      // Le bundle mcp-server (out/mcp-server/index.cjs, produit par `pnpm build:mcp-server`,
      // cf. package.json) est traité comme une ressource extraite plutôt que packagé dans
      // `files`/app.asar (ci-dessous) — voir extraResources : il doit rester un fichier
      // ordinaire sur disque, lançable comme process séparé par un client MCP externe.
      '!out/mcp-server/**/*',
      // GH120 — mentions tierces : livrées à côté de l'exécutable (extraResources), pas dans l'asar.
      '!out/notices/**/*',
      // electron.vite.config.ts externalise toutes les deps npm du process main
      // (externalizeDepsPlugin) — elles restent des `require()` réels à l'exécution (keytar,
      // isomorphic-git...) et doivent donc être physiquement présentes dans le package. Le
      // détecteur "production dependencies" intégré d'electron-builder (marche l'arbre de
      // package.json pour ne garder que les deps de prod) ne suit pas correctement la structure
      // symlinkée de node_modules par pnpm : des deps transitives comme `async-lock` (requise par
      // `isomorphic-git`, pas listée dans notre package.json) passaient à la trappe — "Cannot find
      // module 'async-lock'" au lancement. On inclut tout node_modules explicitement plutôt que de
      // compter sur cette détection.
      'node_modules/**/*',
    ],
    extraResources: [
      // T122 sprint 4 — copie le bundle mcp-server (esbuild, autonome hormis `keytar`
      // natif) hors de app.asar, à un chemin stable résolu par
      // `main/services/mcp-launch.util.ts::resolveMcpServerLaunchConfig()` via
      // `process.resourcesPath` en build packagé (cf. specs/T122-design.md §6.2,
      // specs/SPEC-MCP-SERVER.md §Packaging).
      { from: 'out/mcp-server', to: 'mcp-server' },
      // `keytar` marqué `--external` par l'esbuild de mcp-server (module natif, non
      // bundleable en un seul fichier JS) — copié ici pour que `require('keytar')`
      // depuis `resources/mcp-server/index.cjs` le retrouve par la résolution Node
      // standard (remontée de node_modules). Le serveur MCP n'appelle en pratique jamais
      // de méthode qui l'invoque réellement (cf. electron-shim.ts et
      // specs/T122-design.md §2.1) — copié par prudence, pour que le simple `require`
      // (évaluation du module, pas son appel) ne casse pas le démarrage du process.
      { from: 'node_modules/keytar', to: 'mcp-server/node_modules/keytar' },
      // GH34 — gabarits Word d'exemple et référence des balises, copiés dans la bibliothèque de
      // l'utilisateur par « Installer les exemples » (export-templates:install-examples).
      { from: 'resources/export-templates', to: 'export-templates' },
      // GH74 — bibliothèque de départ des scripts de dashboards (dashboards/lib/ des projets).
      { from: 'resources/dashboard-lib', to: 'dashboard-lib' },
      // GH120 — mentions de licences des composants tiers (pnpm build:notices).
      { from: 'out/notices/THIRD-PARTY-NOTICES.txt', to: 'THIRD-PARTY-NOTICES.txt' },
    ],
    win: {
      icon: icons.ico,
      // GH26 — installeur NSIS (plus de portable) : seule cible Windows qu'electron-updater sait
      // mettre à jour. Installation par utilisateur (cf. bloc nsis), sans droits admin.
      target: 'nsis',
      // ${version} : extraMetadata.version, posée par scripts/package.ts depuis le tag git (GH158)
      // — même string que celle exposée en renderer via app:get-version (barre de titre).
      artifactName: artifactBaseName(info.productName) + '-Setup-${version}.${ext}',
    },
    nsis: {
      oneClick: true,
      // %LOCALAPPDATA%\Programs\<executableName> — pas d'élévation UAC, ni à l'installation ni aux
      // mises à jour.
      perMachine: false,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: info.productName,
    },
    // GH26 — sert uniquement à générer latest.yml (lu par electron-updater au runtime) : le build
    // tourne avec `publish: 'never'`, le téléversement est fait par release.yml (action-gh-release).
    // GH49 — marque sans `update` : pas de publish, donc ni latest.yml ni app-update.yml.
    publish: publishConfig(brand),
    mac: { icon: icons.png },
    linux: { icon: icons.png },
  }
}
