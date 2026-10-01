import type { ExportKind, ExportTemplateKey, TemplateExportFormat } from '@polenta/types'

/**
 * GH34 — formats pour lesquels un kind d'export accepte un gabarit client. Miroir de
 * `DATA_BUILDERS` (main, `template-export.service.ts`) : étendu au même rythme (campagnes et
 * dashboard au sprint 3, xlsx au sprint 4, cf. specs/GH34-design.md §5).
 */
export const TEMPLATE_FORMATS_BY_KIND: Partial<Record<ExportKind, TemplateExportFormat[]>> = {
  requirements: ['docx', 'xlsx'],
  tests: ['docx', 'xlsx'],
  'campaign-plan': ['docx', 'xlsx'],
  'campaign-report': ['docx'],
  dashboard: ['docx'],
  'query-result': ['xlsx'],
  'impact-analysis': ['xlsx'],
}

export function templateKey(kind: ExportKind, format: TemplateExportFormat): ExportTemplateKey {
  return `${kind}:${format}`
}

/** Clés réglables dans les préférences projet, dans l'ordre d'affichage. */
export const TEMPLATE_KEYS: { kind: ExportKind; format: TemplateExportFormat }[] = Object.entries(TEMPLATE_FORMATS_BY_KIND)
  .flatMap(([kind, formats]) => (formats ?? []).map(format => ({ kind: kind as ExportKind, format })))
