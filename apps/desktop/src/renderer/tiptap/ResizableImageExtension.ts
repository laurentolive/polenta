import Image, { type ImageOptions } from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ResizableImageView } from './ResizableImageView'
import { parseCropAttr, type CropRectAttr } from './mediaAttrs'
import { escapeXml } from '../lib/drawioRender'

export type ImageCropRect = CropRectAttr

interface ImageMarkdownPayload {
  src?: unknown
  alt?: unknown
  title?: unknown
  width?: unknown
  height?: unknown
  crop?: unknown
}

interface MarkdownItToken {
  info: string
  content: string
}
interface MarkdownItRendererSelf {
  renderToken(tokens: MarkdownItToken[], idx: number, options: unknown): string
}
type FenceRule = (
  tokens: MarkdownItToken[],
  idx: number,
  options: unknown,
  env: unknown,
  self: MarkdownItRendererSelf,
) => string
interface MarkdownItLike {
  __imageFenceInstalled?: boolean
  renderer: { rules: { fence?: FenceRule } }
}

// Types structurels minimaux (même approche que DrawioEmbedExtension.ts) pour
// éviter de dépendre des types de prosemirror-markdown/prosemirror-model —
// dépendances transitives non déclarées explicitement dans ce package.
interface MarkdownSerializerStateLike {
  write(text: string): void
  text(text: string, escape?: boolean): void
  esc(text: string): string
  ensureNewLine(): void
  closeBlock(node: unknown): void
}
interface ProseMirrorNodeLike {
  attrs: Record<string, unknown>
}

export interface ResizableImageOptions extends ImageOptions {
  repoPath?: string
}

// Étend l'extension standard @tiptap/extension-image (même nom de node
// `image` conservé — `setImage`, le paste handler `schema.nodes['image']`
// existants continuent de fonctionner sans changement) avec des attributs de
// taille d'affichage et de rognage, un NodeView interactif (redimensionnement
// + rognage + menu contextuel), et une sérialisation Markdown compatible
// ascendante (cf. specs/T75-design.md §4).
export const ResizableImage = Image.extend<ResizableImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      repoPath: undefined,
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      // width/height : attributs HTML standards sur <img>, gérés par le
      // mécanisme par défaut de TipTap (parse/render automatiques) — pas de
      // parseHTML/renderHTML custom nécessaire ici.
      width: { default: null },
      height: { default: null },
      // crop : non standard, nécessite un attribut HTML dédié.
      crop: {
        default: null,
        parseHTML: element => {
          const raw = element.getAttribute('data-crop')
          return raw ? parseCropAttr(JSON.parse(raw)) : null
        },
        renderHTML: attrs => (attrs.crop ? { 'data-crop': JSON.stringify(attrs.crop) } : {}),
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerStateLike, node: ProseMirrorNodeLike) {
          const attrs = node.attrs
          const width = attrs.width as number | null
          const height = attrs.height as number | null
          const crop = attrs.crop as ImageCropRect | null

          // Aucune métadonnée : syntaxe Markdown standard inchangée (même
          // sortie que le sérialiseur par défaut de prosemirror-markdown,
          // répliquée ici pour ne pas ajouter de dépendance directe sur ce
          // package) — compatibilité ascendante totale avec les images déjà
          // stockées, zéro churn Git sur une image jamais redimensionnée.
          if (!width && !height && !crop) {
            const src = String(attrs.src ?? '').replace(/[()]/g, '\\$&')
            const title = attrs.title ? ` "${String(attrs.title).replace(/"/g, '\\"')}"` : ''
            state.write(`![${state.esc(String(attrs.alt ?? ''))}](${src}${title})`)
            return
          }

          const payload: ImageMarkdownPayload = { src: attrs.src }
          if (attrs.alt) payload.alt = attrs.alt
          if (attrs.title) payload.title = attrs.title
          if (width) payload.width = width
          if (height) payload.height = height
          if (crop) payload.crop = crop
          state.write('```image\n')
          state.text(JSON.stringify(payload), false)
          state.ensureNewLine()
          state.write('```')
          state.closeBlock(node)
        },
        parse: {
          setup(markdownitUnknown: unknown) {
            const markdownit = markdownitUnknown as MarkdownItLike
            if (markdownit.__imageFenceInstalled) return
            markdownit.__imageFenceInstalled = true
            const defaultFence = markdownit.renderer.rules.fence
            markdownit.renderer.rules.fence = (tokens, idx, options, env, self) => {
              const token = tokens[idx]
              if (token.info.trim() === 'image') {
                const content = token.content.trim()
                try {
                  const parsed = JSON.parse(content) as ImageMarkdownPayload
                  const src = typeof parsed.src === 'string' ? parsed.src : ''
                  const alt = typeof parsed.alt === 'string' ? parsed.alt : ''
                  const title = typeof parsed.title === 'string' ? parsed.title : ''
                  const width = typeof parsed.width === 'number' ? parsed.width : null
                  const height = typeof parsed.height === 'number' ? parsed.height : null
                  const crop = parseCropAttr(parsed.crop)
                  const htmlAttrs = [`src="${escapeXml(src)}"`]
                  if (alt) htmlAttrs.push(`alt="${escapeXml(alt)}"`)
                  if (title) htmlAttrs.push(`title="${escapeXml(title)}"`)
                  if (width) htmlAttrs.push(`width="${width}"`)
                  if (height) htmlAttrs.push(`height="${height}"`)
                  if (crop) htmlAttrs.push(`data-crop="${escapeXml(JSON.stringify(crop))}"`)
                  return `<img ${htmlAttrs.join(' ')}>`
                } catch {
                  // Contenu non-JSON (édition manuelle) : bloc ignoré plutôt que de faire échouer le parsing.
                  return ''
                }
              }
              return defaultFence
                ? defaultFence(tokens, idx, options, env, self)
                : self.renderToken(tokens, idx, options)
            }
          },
        },
      },
    }
  },
})
