import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'

// GH74 — compilation d'une spec Vega-Lite pour valider les widgets écrits par MCP (specs/GH74-design.md
// §4.1). Bundle ESM séparé à côté du serveur (`vega-compile.mjs`), sinon le paquet `vega-lite`
// (exécution par tsx). Le spécificateur est une variable : esbuild ne tente pas de bundler l'import.

type Compile = (spec: unknown) => unknown

let loading: Promise<Compile | null> | null = null

function loadCompiler(): Promise<Compile | null> {
  loading ??= (async () => {
    const bundled = path.join(__dirname, 'vega-compile.mjs')
    const specifier = fs.existsSync(bundled) ? pathToFileURL(bundled).href : 'vega-lite'
    try {
      const mod = await import(specifier) as { compile: Compile }
      return mod.compile
    } catch {
      return null
    }
  })()
  return loading
}

/** Erreur de compilation de la spec, `null` si elle compile, `undefined` si le compilateur est indisponible. */
export async function compileSpecError(specText: string): Promise<string | null | undefined> {
  const compile = await loadCompiler()
  if (!compile) return undefined
  try {
    compile(JSON.parse(specText))
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
