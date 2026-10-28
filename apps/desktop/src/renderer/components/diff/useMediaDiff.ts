import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { api } from '../../api'
import { resolveDrawioTarget } from '../../lib/drawioRender'
import { changedMedia, mediaBlocks, type MediaBlock } from '../../lib/mediaDiff'

export interface MediaChanges { before: Set<number>; after: Set<number> }

interface Read { kind: MediaBlock['kind']; path: string; at: string | null }

function isLiteralSrc(src: string): boolean {
  return src.startsWith('data:') || /^https?:\/\//.test(src)
}

const readKey = (r: Read) => `${r.kind}\u0000${r.path}\u0000${r.at ?? ''}`

/**
 * GH178 — blocs média modifiés (cadre) de chaque richtext comparé : référence changée, ou contenu
 * référencé (page draw.io ciblée, image) différent entre les deux versions. Une unité dont un bloc
 * est encadré compte comme modifiée, même si son texte est identique.
 */
export function useMediaDiff(
  texts: Array<{ key: string; before: string; after: string }>,
  repoPath: string,
  beforeAt: string | null,
  afterAt: string | null,
): Map<string, MediaChanges> {
  const parsed = useMemo(
    () => texts.map(t => ({ key: t.key, before: mediaBlocks(t.before), after: mediaBlocks(t.after) })),
    [texts],
  )
  const reads = useMemo(() => {
    const all = new Map<string, Read>()
    // A literal image (`data:`, URL) carries its content in its payload: nothing to read in the repo.
    const inRepo = (b: MediaBlock) => b.kind === 'drawio' || !isLiteralSrc(b.path)
    for (const p of parsed) {
      for (const b of p.before.filter(inRepo)) all.set(readKey({ ...b, at: beforeAt }), { kind: b.kind, path: b.path, at: beforeAt })
      for (const b of p.after.filter(inRepo)) all.set(readKey({ ...b, at: afterAt }), { kind: b.kind, path: b.path, at: afterAt })
    }
    return [...all.values()]
  }, [parsed, beforeAt, afterAt])

  const results = useQueries({
    queries: reads.map(r => ({
      queryKey: ['diff-media', r.kind, repoPath, r.path, r.at],
      queryFn: async () => (r.kind === 'drawio'
        ? (await api.drawio.read(repoPath, r.path, r.at)) ?? null
        : (await api.image.read(repoPath, r.path, r.at)) ?? null),
      enabled: !!repoPath && !!r.path,
      // A commit never changes; the working tree may.
      staleTime: r.at ? Infinity : 0,
    })),
  })

  return useMemo(() => {
    const byKey = new Map<string, unknown>()
    reads.forEach((r, i) => { if (results[i]?.isSuccess) byKey.set(readKey(r), results[i].data) })
    const content = (side: 'before' | 'after', block: MediaBlock): string | null | undefined => {
      const key = readKey({ kind: block.kind, path: block.path, at: side === 'before' ? beforeAt : afterAt })
      if (!byKey.has(key)) return undefined
      const data = byKey.get(key)
      if (data === null || data === undefined) return null
      if (block.kind === 'image') return (data as { base64: string }).base64
      const pages = data as Array<{ id: string; xml: string }>
      return pages.length ? pages[resolveDrawioTarget(pages, block.nodeId ?? undefined).pageIndex]?.xml ?? null : null
    }
    const out = new Map<string, MediaChanges>()
    for (const p of parsed) out.set(p.key, changedMedia(p.before, p.after, content))
    return out
    // `results` is a new array on every render; its data is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, reads, beforeAt, afterAt, results.map(r => r.dataUpdatedAt).join(',')])
}
