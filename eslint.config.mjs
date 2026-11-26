// GH395 — configuration ESLint du monorepo (flat config), lancée par `pnpm lint` à la racine.
// Sans type-checking (rapide) : règles recommandées de typescript-eslint + react-hooks sur le renderer.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/build/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      // Rapport HTML de Playwright (reporter de apps/desktop/playwright.config) : régénéré à chaque run e2e
      'apps/desktop/e2e-web/.report/**',
      // Worktrees / outils d'agents copiés sous le repo
      '.claire/**',
      '.claude/**',
      '**/.claude/worktrees/**',
      // Fichiers générés
      '**/routeTree.gen.ts',
      '**/*.generated.js',
      '**/*.min.js',
      'apps/desktop/src/renderer/public/vendor/**',
      // Données runtime / projets de démonstration locaux
      'apps/desktop/PL/**',
      'apps/desktop/.web-data/**',
      'apps/desktop/.tanstack/**',
      '**/data/**',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Convention du code : un nom préfixé `_` est volontairement inutilisé (paramètre imposé
      // par une signature, propriété retirée d'un objet par déstructuration `{ a: _a, ...rest }`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // `catch {}` volontaire (ref git absente, fichier optionnel…) : idiome courant du code.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `cond ? a() : b()` et `fn && fn()` en instruction : idiomes courants du code.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
  {
    // Scripts Node CommonJS (agent hôte GH63, fichiers .cjs ; askpass GH337, livré tel quel)
    files: ['**/*.cjs', 'deploy/**/*.js', 'apps/desktop/src/main/git/askpass/*.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Code React (renderer desktop / client web)
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
)
