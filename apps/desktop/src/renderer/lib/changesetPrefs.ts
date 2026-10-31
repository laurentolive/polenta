// GH207 (retour de validation du 2026-10-31) — affichage de la page d'un changeset retrouvé d'une
// visite à l'autre : sections repliées / dépliées et filtres, par poste (localStorage), comme
// `diffPrefs`.

import { useState } from 'react'

const PREFIX = 'polenta:changesetView:'

function read(key: string): string | null {
  try { return localStorage.getItem(PREFIX + key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(PREFIX + key, value) } catch { /* storage unavailable: preference not kept */ }
}

/** Booléen d'affichage mémorisé (`key` : section ou filtre de la page d'un changeset). */
export function useChangesetViewFlag(key: string, initial: boolean): [boolean, (v: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const stored = read(key)
    return stored === null ? initial : stored === 'true'
  })
  const set = (v: boolean | ((prev: boolean) => boolean)) => setValue(prev => {
    const next = typeof v === 'function' ? v(prev) : v
    write(key, String(next))
    return next
  })
  return [value, set]
}
