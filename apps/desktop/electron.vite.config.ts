import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'
import { resolve } from 'path'

export default defineConfig({
  main: {
    // @polenta/types est aliasé vers sa source TS brute (pas de dist compilé) — sans l'exclure
    // ici, externalizeDepsPlugin le laisse en `require()` externe non transformé, que Node ne
    // sait pas charger (syntaxe ESM `export`). Restait invisible tant que tous les imports
    // depuis @polenta/types côté main étaient `import type` (effacés à la compilation) ; T123
    // (schema-tree.ts : findSystemNode/mapSystemNode/flattenSystemNodes) et T126
    // (parseMultiEnumValue) y introduisent chacun indépendamment le premier import de valeur
    // réel — trouvé et corrigé identiquement dans les deux tickets en vérification manuelle de
    // l'app buildée ("SyntaxError: Unexpected token 'export'" au boot).
    //
    // isomorphic-git, chokidar exclus aussi : externalisés, leurs dépendances transitives
    // (async-lock, readdirp...) ne sont satisfaites QUE par ces libs — pnpm, en mode strict, ne
    // les hisse jamais dans apps/desktop/node_modules (elles n'existent que sous
    // node_modules/.pnpm/<lib>@…/node_modules/). electron-builder ne peut donc jamais les trouver
    // pour le packaging ("Cannot find module 'async-lock'", puis 'readdirp'). keytar reste
    // externalisé : binaire natif (.node), ne peut pas être bundlé par Rollup — cf. asarUnpack
    // dans electron-builder.yml. alasql reste externalisé lui aussi : le forcer dans le bundle
    // casse le build (Rollup tente de parser sa branche optionnelle react-native, qui contient de
    // la syntaxe Flow invalide en JS standard) — ses propres deps manquantes (cross-fetch, yargs)
    // ne sont en fait jamais require()-ées par le chemin d'exécution réellement utilisé ici (déjà
    // vérifié : aucun crash alasql observé dans aucun test, dev ou packagé).
    // electron-updater (GH26) exclu pour la même raison : ses deps transitives (fs-extra,
    // builder-util-runtime, lazy-val, semver…) manquaient au packaging ("Cannot find module
    // 'fs-extra'" au lancement de l'app installée).
    // docxtemplater, pizzip, angular-expressions, markdown-it, xlsx-template (GH34, export par gabarit) exclus pour
    // la même raison : @xmldom/xmldom, pako, entities, mdurl… ne sont pas hissés dans
    // apps/desktop/node_modules. Bundlés dans des chunks chargés au premier export (import()).
    // @polenta/merge-core (GH37) : source TS brute comme @polenta/types, et sa dépendance diff3
    // n'est pas hissée dans apps/desktop/node_modules — les deux bundlés.
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@polenta/types', 'isomorphic-git', 'chokidar', 'docx', 'exceljs', 'js-yaml', 'electron-updater',
          'docxtemplater', 'pizzip', 'angular-expressions', 'markdown-it', 'xlsx-template',
          '@polenta/merge-core', 'diff3',
        ],
      }),
    ],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@polenta/types': resolve(__dirname, '../../packages/types/src/index.ts'),
        '@polenta/zod-schemas': resolve(__dirname, '../../packages/zod-schemas/src/index.ts'),
        '@polenta/merge-core': resolve(__dirname, '../../packages/merge-core/src/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    plugins: [
      // autoCodeSplitting: sans lui, routeTree.gen.ts importe le composant de CHAQUE route en
      // statique (Tiptap, recharts, docx...) — tout le graphe de dépendances doit être transformé
      // par Vite avant le premier paint. Splitte chaque route (component/loader/...) en chunk à
      // charger à la demande, donc seule la route de démarrage est sur le chemin critique.
      // Doit précéder react() : le plugin router doit voir/transformer le JSX des routes avant
      // la transformation JSX de @vitejs/plugin-react (erreur "Plugin order" sinon).
      TanStackRouterVite({
        routesDirectory: './routes',
        generatedRouteTree: './routeTree.gen.ts',
        autoCodeSplitting: true,
      }),
      react(),
    ],
    root: './src/renderer',
    resolve: {
      alias: {
        '@polenta/types': resolve(__dirname, '../../packages/types/src/index.ts'),
        '@polenta/zod-schemas': resolve(__dirname, '../../packages/zod-schemas/src/index.ts'),
        '@polenta/api-client': resolve(__dirname, '../../packages/api-client/src/index.ts'),
        '@polenta/merge-core': resolve(__dirname, '../../packages/merge-core/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
})
