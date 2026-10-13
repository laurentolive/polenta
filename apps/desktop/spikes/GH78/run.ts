/**
 * GH78 — commande unique de reproduction : `pnpm --filter @polenta/desktop spike:gh78`
 * (prérequis : workspace de démo généré, `node scripts/demo-lave-linge/generate.mjs`, ou
 * GH78_DEMO_WS=<dossier>). Enchaîne : mesures (graphe, QuickJS, bibliothèque, limites, isolation)
 * → poids des bundles → rendu Vega-Lite (Chromium + Electron) → évaluation des sorties IA.
 * Résultats : `spikes/GH78/results/*.json|png`.
 * Options : `--no-baseline` (ne rebuild pas l'application pour la référence de taille).
 */
import { runBench } from './bench'
import { measureBundles } from './measure-bundles'
import { runRender } from './render/render'
import { runAiEval } from './ai-eval'

void (async () => {
  const step = async (name: string, fn: () => Promise<unknown>) => {
    const t = performance.now()
    console.log(`[GH78] ${name}…`)
    await fn()
    console.log(`[GH78] ${name} : ${Math.round((performance.now() - t) / 1000)} s`)
  }
  await step('mesures', runBench)
  await step('bundles', () => measureBundles({ baseline: !process.argv.includes('--no-baseline') }))
  await step('rendu', runRender)
  await step('sorties IA', runAiEval)
  console.log('[GH78] terminé — résultats dans spikes/GH78/results/')
})().catch(e => { console.error(e); process.exit(1) })
