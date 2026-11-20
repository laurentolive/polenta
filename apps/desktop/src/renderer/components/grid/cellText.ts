/** GH389 — texte affiché d'un contenu HTML (richtext) dans une cellule : filtre, largeur auto, export. */
export function htmlToCellText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
