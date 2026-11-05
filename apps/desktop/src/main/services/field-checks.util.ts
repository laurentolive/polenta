/**
 * Contrôles de champs utilisés par les fonctions de Polenta : import en masse (MCP, T122) et
 * résolution de conflits (GH37). GH74 — la maturité des exigences (anciennes colonnes `maturity*`
 * du moteur SQL) n'est plus calculée par Polenta : c'est un script de la bibliothèque projet
 * (`dashboards/lib/maturity.js`), qui reprend ces deux règles à l'identique.
 */

// GH206 — déplacés dans `packages/types` (field-validators.ts), partagés avec le renderer.
export { isEarsCompliant, isFilled } from '@polenta/types'
