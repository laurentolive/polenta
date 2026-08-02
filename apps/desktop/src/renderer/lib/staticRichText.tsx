import { useEffect, useMemo, useRef } from 'react'
import MarkdownIt from 'markdown-it'
import { api } from '../api'
import { escapeXml } from './drawioRender'

/**
 * Read-only counterpart to RichTextField/RichTextViewer, for lists that render many objects at
 * once (WordView's document view) — a live Tiptap/ProseMirror editor per richtext field, even
 * `editable: false`, still pays the full editor-construction cost (schema, plugins, DOM
 * binding). For N items × M richtext fields that's N×M editors mounted at once, which is what
 * froze the "Exigences" tab on a project the size of PL/Product (281 items × 3 richtext fields —
 * confirmed by profiling, see the freeze investigation this component was extracted from).
 * `markdown-it` alone (also what tiptap-markdown parses with) renders the same source string to
 * plain HTML with no editor/DOM-binding cost.
 *
 * `image`/`drawio` fences are ResizableImageExtension/DrawioEmbedExtension's own markdown
 * encoding (not standard markdown) — mirrored here so those blocks don't fall through to a
 * plain, unreadable code-fence render. Drawio embeds render as a static label rather than the
 * live interactive diagram: reproducing that view is a per-item canvas render, which is exactly
 * the kind of per-row cost this component exists to avoid — click into edit mode to see it.
 */

let sharedMd: MarkdownIt | null = null

function getMarkdownIt(): MarkdownIt {
  if (sharedMd) return sharedMd
  const md = new MarkdownIt({ html: false, linkify: true })
  const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules)
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const info = token.info.trim()

    if (info === 'image') {
      try {
        const parsed = JSON.parse(token.content.trim()) as {
          src?: unknown; alt?: unknown; title?: unknown; width?: unknown; height?: unknown
        }
        const src = typeof parsed.src === 'string' ? parsed.src : ''
        const attrs = [`src="${escapeXml(src)}"`, `data-static-img-src="${escapeXml(src)}"`]
        if (typeof parsed.alt === 'string' && parsed.alt) attrs.push(`alt="${escapeXml(parsed.alt)}"`)
        if (typeof parsed.title === 'string' && parsed.title) attrs.push(`title="${escapeXml(parsed.title)}"`)
        if (typeof parsed.width === 'number') attrs.push(`width="${parsed.width}"`)
        if (typeof parsed.height === 'number') attrs.push(`height="${parsed.height}"`)
        return `<img ${attrs.join(' ')}>`
      } catch {
        return ''
      }
    }

    if (info === 'drawio') {
      try {
        const parsed = JSON.parse(token.content.trim()) as { path?: unknown }
        const path = typeof parsed.path === 'string' ? parsed.path : ''
        const label = path.split(/[/\\]/).pop() || 'diagramme'
        return `<span class="inline-flex items-center gap-1 text-xs text-ink-3 italic border border-edge rounded px-1.5 py-0.5">📐 ${escapeXml(label)}</span>`
      } catch {
        return ''
      }
    }

    return defaultFence ? defaultFence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
  }
  sharedMd = md
  return md
}

function isLiteralSrc(src: string): boolean {
  return src.startsWith('data:') || /^https?:\/\//.test(src)
}

const VIEWER_CLASS = 'text-sm text-ink [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:font-medium [&_h3]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-status-neutral-bg [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-status-neutral-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-ink-2 [&_pre]:bg-status-neutral-bg [&_pre]:p-2 [&_pre]:rounded [&_img]:max-w-full [&_img]:rounded [&_table]:border-collapse [&_table]:my-2 [&_th]:border [&_th]:border-edge [&_th]:bg-hover [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-edge [&_td]:px-2 [&_td]:py-1 [&_p]:my-1'

export function StaticRichTextViewer({ value, repoPath }: { value: string; repoPath?: string }) {
  const html = useMemo(() => (value ? getMarkdownIt().render(value) : ''), [value])
  const containerRef = useRef<HTMLDivElement>(null)

  // Repo-relative image paths (T76) can't be resolved by the browser directly (not a web URL) —
  // same async read RichTextField's live image node view uses, just applied to plain <img> tags
  // instead of a NodeView instance. Runs once per actual image present, not per row/field, so it
  // stays cheap even across hundreds of items.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !repoPath) return
    const imgs = container.querySelectorAll<HTMLImageElement>('img[data-static-img-src]')
    let cancelled = false
    for (const img of imgs) {
      const src = img.getAttribute('data-static-img-src') ?? ''
      if (!src || isLiteralSrc(src)) continue
      void api.image.read(repoPath, src).then(result => {
        if (cancelled || !result) return
        img.src = `data:${result.mimeType};base64,${result.base64}`
      })
    }
    return () => { cancelled = true }
  }, [html, repoPath])

  if (!value) return null
  return <div ref={containerRef} className={VIEWER_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
}
