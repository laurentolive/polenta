import type { TestCase } from '@polenta/types'

/** Miroir de `requirementsFilter.ts` pour les tests — mêmes règles (filtre texte id/titre +
 *  `objectTypeRef` au format `<node>::<type>`), réutilisé par `SystemView.tsx` et
 *  `print.tests.tsx`. */
export function filterTests(
  tests: TestCase[],
  { filter, objectTypeRef }: { filter: string; objectTypeRef?: string },
): TestCase[] {
  let filtered = tests
  if (objectTypeRef) filtered = filtered.filter(t => t.objectTypeRef === objectTypeRef)
  if (filter.trim()) {
    const needle = filter.toLowerCase()
    filtered = filtered.filter(t =>
      t.id.toLowerCase().includes(needle) || (t.title ?? '').toLowerCase().includes(needle)
    )
  }
  return filtered
}
