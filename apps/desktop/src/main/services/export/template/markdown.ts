import MarkdownIt from 'markdown-it'

export type MdToken = ReturnType<MarkdownIt['parse']>[number]

// Mêmes options que le rendu à l'écran (`StaticRichTextViewer`) pour que les deux interprètent la
// même source de la même façon (tables GFM et barré activés par défaut dans markdown-it).
let md: MarkdownIt | null = null

/** GH34 — tokens markdown-it d'un champ richtext (Polenta stocke le richtext en Markdown). */
export function parseMarkdown(markdown: string): MdToken[] {
  md ??= new MarkdownIt({ html: false, linkify: false })
  return md.parse(markdown, {})
}

/** Liens internes `[[SW-0042]]` → `SW-0042` (pas de lien hypertexte en export, GH34 §2.5). */
export function stripInternalLinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, '$1')
}
