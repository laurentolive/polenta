import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { DrawioEmbedView } from './DrawioEmbedView'
import { escapeXml } from '../lib/drawioRender'
import { parseCropAttr, parseDrawioFencePayload, type CropRectAttr } from './mediaAttrs'

// Représentation HTML intermédiaire utilisée uniquement pendant le pipeline
// markdown-it → HTML → schéma ProseMirror (cf. parse.setup ci-dessous) — jamais
// affichée telle quelle, le NodeView prend le relais pour le rendu réel.
const HTML_TAG = 'div[data-drawio-embed]'

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
  __drawioFenceInstalled?: boolean
  renderer: { rules: { fence?: FenceRule } }
}

export interface DrawioEmbedOptions {
  repoPath?: string
}

export type DrawioCropRect = CropRectAttr

interface DrawioEmbedPayload {
  path?: unknown
  nodeId?: unknown
  width?: unknown
  height?: unknown
  crop?: unknown
}

// Types structurels minimaux pour éviter de dépendre des types de
// prosemirror-markdown/prosemirror-model (dépendances transitives non
// déclarées explicitement) — seuls les membres réellement utilisés ici.
interface MarkdownSerializerStateLike {
  write(text: string): void
  text(text: string, escape?: boolean): void
  ensureNewLine(): void
  closeBlock(node: unknown): void
}
interface ProseMirrorNodeLike {
  attrs: Record<string, unknown>
}

export const DrawioEmbed = Node.create<DrawioEmbedOptions>({
  name: 'drawioEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { repoPath: undefined }
  },

  addAttributes() {
    return {
      path: { default: '' },
      nodeId: { default: null },
      // Taille d'affichage du conteneur en px ; `null` = taille auto (comportement historique).
      width: { default: null },
      height: { default: null },
      // Fenêtre de cadrage (pan/zoom) en unités du modèle mxGraph ; `null` = pas de rognage.
      crop: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: HTML_TAG,
        getAttrs: el => {
          if (typeof el === 'string') return false
          const width = el.getAttribute('data-width')
          const height = el.getAttribute('data-height')
          const cropRaw = el.getAttribute('data-crop')
          return {
            path: el.getAttribute('data-path') ?? '',
            nodeId: el.getAttribute('data-node-id') || null,
            width: width ? Number(width) : null,
            height: height ? Number(height) : null,
            crop: cropRaw ? parseCropAttr(JSON.parse(cropRaw)) : null,
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-drawio-embed': '1',
        'data-path': node.attrs.path as string,
        ...(node.attrs.nodeId ? { 'data-node-id': node.attrs.nodeId as string } : {}),
        ...(node.attrs.width ? { 'data-width': String(node.attrs.width) } : {}),
        ...(node.attrs.height ? { 'data-height': String(node.attrs.height) } : {}),
        ...(node.attrs.crop ? { 'data-crop': JSON.stringify(node.attrs.crop) } : {}),
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawioEmbedView)
  },

  addStorage() {
    return {
      markdown: {
        // Contenu du bloc sérialisé en JSON (pas `path#nodeId`) : `path` est un
        // chemin de fichier et peut légitimement contenir lui-même un `#`, ce
        // qui rendrait un séparateur `#` ambigu à la reparse (round-trip cassé).
        serialize(state: MarkdownSerializerStateLike, node: ProseMirrorNodeLike) {
          const path = (node.attrs.path as string) ?? ''
          const nodeId = node.attrs.nodeId as string | null
          const width = node.attrs.width as number | null
          const height = node.attrs.height as number | null
          const crop = node.attrs.crop as DrawioCropRect | null
          const payload: DrawioEmbedPayload = { path }
          if (nodeId) payload.nodeId = nodeId
          if (width) payload.width = width
          if (height) payload.height = height
          if (crop) payload.crop = crop
          state.write('```drawio\n')
          state.text(JSON.stringify(payload), false)
          state.ensureNewLine()
          state.write('```')
          state.closeBlock(node)
        },
        parse: {
          setup(markdownitUnknown: unknown) {
            const markdownit = markdownitUnknown as MarkdownItLike
            if (markdownit.__drawioFenceInstalled) return
            markdownit.__drawioFenceInstalled = true
            const defaultFence = markdownit.renderer.rules.fence
            markdownit.renderer.rules.fence = (tokens, idx, options, env, self) => {
              const token = tokens[idx]
              if (token.info.trim() === 'drawio') {
                const { path, nodeId, width, height, crop } = parseDrawioFencePayload(token.content)
                const attrs = [`data-drawio-embed="1"`, `data-path="${escapeXml(path)}"`]
                if (nodeId) attrs.push(`data-node-id="${escapeXml(nodeId)}"`)
                if (width) attrs.push(`data-width="${width}"`)
                if (height) attrs.push(`data-height="${height}"`)
                if (crop) attrs.push(`data-crop="${escapeXml(JSON.stringify(crop))}"`)
                return `<div ${attrs.join(' ')}></div>`
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
