/** GH36 — extrait de `export/campaign-execution-import.ts` par GH129 (module sans ExcelJS). */

/**
 * Commentaire saisi en texte brut → Markdown du richtext : une ligne non vide = un paragraphe,
 * caractères Markdown échappés (y compris les marqueurs de liste en début de ligne) pour que la
 * relecture affiche exactement le texte saisi.
 */
export function plainTextToMarkdown(text: string): string {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line
      .replace(/([\\`*_[\]#<>|~])/g, '\\$1')
      .replace(/^([-+])(\s)/, '\\$1$2')
      .replace(/^(\d+)\.(\s)/, '$1\\.$2'))
    .join('\n\n')
}
