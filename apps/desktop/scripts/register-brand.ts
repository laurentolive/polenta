/**
 * GH49 — pour les points d'entrée exécutés par `tsx` (pas de `define` de build) : pose la
 * marque désignée par POLENTA_BRAND sur `globalThis`, où `src/shared/brand.ts` la lit.
 * À importer EN PREMIER (les imports s'évaluent dans l'ordre de déclaration), avant tout
 * module applicatif qui lit `BRAND` à son chargement.
 */
import { loadBrand } from './brand'

;(globalThis as { __POLENTA_BRAND__?: unknown }).__POLENTA_BRAND__ = loadBrand().info
