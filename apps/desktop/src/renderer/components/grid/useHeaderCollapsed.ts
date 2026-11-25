import { useCallback, useState } from 'react'

const storageKey = (page: string) => `polenta.headerCollapsed.${page}`

function read(page: string): boolean {
  try {
    return localStorage.getItem(storageKey(page)) === '1'
  } catch {
    return false
  }
}

function write(page: string, collapsed: boolean): void {
  try {
    localStorage.setItem(storageKey(page), collapsed ? '1' : '0')
  } catch { /* stockage indisponible : état non mémorisé */ }
}

/**
 * GH389 — en-tête repliable d'une page (validation) : état mémorisé par poste, commun à toutes les
 * pages du même genre. `localStorage` indisponible : en-tête déplié, rien n'est retenu.
 * GH439 — la page d'une version n'a plus d'en-tête repliable : ses informations sont une section.
 */
export function useHeaderCollapsed(page: 'validation'): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => read(page))
  const toggle = useCallback(() => {
    const next = !collapsed
    write(page, next)
    setCollapsed(next)
  }, [page, collapsed])
  return [collapsed, toggle]
}
