import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH22 — projet de démo : `if-bus-interne`, interface en repo séparé (rôles sur le nœud `root` de son
 * schéma), est implémentée par `comp-moteur`, `comp-module-wifi` et le composant local `carte-commande`.
 * Sa matrice de conformité n'avait aucune colonne d'implémenteur.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface Matrix { interfaceName: string; requirements: unknown[]; components: Array<{ name: string; roles: string[] }> }

test('GH22-1 — interface en repo séparé : une colonne par implémenteur déclaré', async () => {
  const matrices = await s.invoke<Matrix[]>('interface:compliance-matrix', s.project.workspaceDir)
  const matrix = matrices.find(m => m.interfaceName === 'if-bus-interne')!
  expect(matrix.requirements.length).toBeGreaterThan(0)
  const columns = matrix.components.map(c => c.name)
  expect(columns).toEqual(expect.arrayContaining(['comp-moteur', 'comp-module-wifi']))
  expect(columns.some(c => c.includes('carte-commande') || c.includes('Carte'))).toBe(true)
  expect(matrix.components.find(c => c.name === 'comp-moteur')!.roles).toEqual(['device'])
})

test('GH22-2 — interface locale : matrice inchangée', async () => {
  const matrices = await s.invoke<Matrix[]>('interface:compliance-matrix', s.project.workspaceDir)
  const local = matrices.find(m => m.interfaceName.includes('bus-ihm') || m.interfaceName.includes('IHM'))!
  expect(local.components.length).toBeGreaterThan(0)
})
