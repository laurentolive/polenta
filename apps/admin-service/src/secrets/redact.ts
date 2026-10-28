/**
 * GH63 — filtre des secrets (design §6.5) : valeurs exactes connues du travail, puis motifs
 * `password=…`, `token: …`, `Bearer …`. Appliqué au journal avant écriture et aux erreurs HTTP.
 */
const PATTERNS: [RegExp, string][] = [
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  [/\b([A-Za-z_]*(?:password|passwd|secret|token|key))(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1$2***'],
]

export function redact(text: string, values: readonly string[] = []): string {
  let out = text
  for (const value of values) {
    if (value && value.length >= 6) out = out.split(value).join('***')
  }
  for (const [re, by] of PATTERNS) out = out.replace(re, by)
  return out
}
