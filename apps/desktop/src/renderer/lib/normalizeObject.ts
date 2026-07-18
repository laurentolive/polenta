import type { Requirement, TestCase } from '@polenta/types'

/** Aplati un `Requirement`/`TestCase` en `Record<string,string>` — champs système + `fields{}`
 *  personnalisés du schéma, tous en chaînes. Même normalisation utilisée par `SystemView.tsx`
 *  (rendu écran, `ExcelView`/`WordView`) et par les routes `/print/*` (export pdf) pour que les
 *  deux ne puissent jamais diverger. */
export function normalizeObject(obj: Requirement | TestCase): Record<string, string> {
  const version = (obj as Requirement).version
  return {
    id: obj.id ?? '',
    title: obj.title ?? '',
    status: obj.status ?? '',
    version: version != null ? String(version) : '1',
    createdAt: obj.createdAt ?? '',
    updatedAt: obj.updatedAt ?? '',
    author: obj.createdBy ?? '',
    objectTypeRef: obj.objectTypeRef ?? '',
    ...Object.fromEntries(
      Object.entries(obj.fields ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)])
    ),
  }
}
