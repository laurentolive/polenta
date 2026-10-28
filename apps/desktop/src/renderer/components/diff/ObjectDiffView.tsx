import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { unitValue } from '@polenta/merge-core'
import type { ObjectTypeDefinition, TestStep } from '@polenta/types'
import { diffUnits, unitChanged, type DiffUnit } from '../../lib/objectUnits'
import { DiffValue } from './DiffValue'
import { StepsDiff } from './StepsDiff'
import { useMediaDiff } from './useMediaDiff'

type Obj = Record<string, unknown>

export interface DiffSide {
  /** Objet de cette version, `null` si le fichier y est absent. */
  value: Obj | null
  /** Version git (images, diagrammes), `null` = working tree. */
  at: string | null
  /** Titre de colonne (« Avant · a1b2c3d »). */
  label: string
  /** Type selon le schéma de cette version : libellés (statut, valeurs) de la colonne. */
  typeDef?: ObjectTypeDefinition
}

/**
 * GH178 — mode Rendu d'une exigence / d'un test : grille à deux colonnes (Avant | Après), une rangée
 * par unité. Un seul conteneur défilant : les deux côtés d'une unité restent à la même hauteur.
 */
export function ObjectDiffView({ before, after, typeDef, repoPath, hideUnchanged }: {
  before: DiffSide
  after: DiffSide
  typeDef?: ObjectTypeDefinition
  repoPath: string
  hideUnchanged: boolean
}) {
  const { t } = useTranslation()
  const units = useMemo(() => diffUnits(before.value, after.value, typeDef), [before.value, after.value, typeDef])
  const present = units.filter(u => unitValue(before.value, u.key) !== undefined || unitValue(after.value, u.key) !== undefined)
  // Richtexts compared on their referenced media too (diagram / image changed at the other version).
  const richTexts = useMemo(() => units
    .filter(u => u.kind === 'richtext')
    .map(u => ({ key: u.key, before: asText(unitValue(before.value, u.key)), after: asText(unitValue(after.value, u.key)) }))
    .filter(r => r.before || r.after), [units, before.value, after.value])
  const media = useMediaDiff(richTexts, repoPath, before.at, after.at)
  const changed = useMemo(
    () => new Set(present
      .filter(u => unitChanged(before.value, after.value, u.key)
        || (media.get(u.key)?.before.size ?? 0) > 0 || (media.get(u.key)?.after.size ?? 0) > 0)
      .map(u => u.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [units, before.value, after.value, media],
  )
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Consecutive unchanged units fold into one row when hidden.
  const rows: Array<{ unit: DiffUnit } | { folded: DiffUnit[] }> = []
  for (const u of present) {
    const last = rows[rows.length - 1]
    if (hideUnchanged && !changed.has(u.key) && !expanded.has(u.key)) {
      if (last && 'folded' in last) last.folded.push(u)
      else rows.push({ folded: [u] })
    } else {
      rows.push({ unit: u })
    }
  }

  const cell = (side: 'before' | 'after', u: DiffUnit) => {
    const s = side === 'before' ? before : after
    const isChanged = changed.has(u.key)
    const tone = !isChanged ? '' : side === 'before'
      ? 'bg-status-danger-bg dark:bg-status-danger-bg/15'
      : 'bg-status-success-bg dark:bg-status-success-bg/15'
    return (
      <div className={`px-3 py-2 min-w-0 ${side === 'after' ? 'border-l border-edge' : ''} ${tone}`}>
        {s.value && (
          <DiffValue unit={u} value={unitValue(s.value, u.key)} side={side}
            other={isChanged ? unitValue((side === 'before' ? after : before).value, u.key) : undefined}
            media={media.get(u.key)?.[side]}
            typeDef={s.typeDef ?? typeDef} repoPath={repoPath} at={s.at} />
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto" data-testid="object-diff">
      <div className="grid grid-cols-2 min-w-0">
        <ColumnTitle>{before.label}</ColumnTitle>
        <ColumnTitle border>{after.label}</ColumnTitle>
        {(!before.value || !after.value) && (
          <>
            <AbsentNotice show={!before.value} />
            <AbsentNotice show={!after.value} border />
          </>
        )}
        {rows.map(row => 'unit' in row ? (
          <Fragment key={row.unit.key}>
            <div data-unit={row.unit.key} data-changed={changed.has(row.unit.key) || undefined}
              className="col-span-2 px-3 pt-2 text-[11px] uppercase tracking-wide text-ink-3 border-t border-edge-subtle">
              {row.unit.labelKey ? t(row.unit.labelKey) : row.unit.label}
            </div>
            {row.unit.kind === 'steps' && isSteps(before.value, after.value, row.unit.key)
              ? <StepsDiff before={steps(before.value, row.unit.key)} after={steps(after.value, row.unit.key)}
                  repoPath={repoPath} beforeAt={before.at} afterAt={after.at} />
              : <>{cell('before', row.unit)}{cell('after', row.unit)}</>}
          </Fragment>
        ) : (
          <button key={`fold-${row.folded[0].key}`} type="button"
            className="col-span-2 px-3 py-1 text-xs text-ink-3 hover:bg-surface-hover border-t border-edge-subtle flex items-center gap-1 text-left"
            onClick={() => setExpanded(prev => new Set([...prev, ...row.folded.map(u => u.key)]))}>
            <ChevronRight size={12} />
            {t('diffView.unchangedCount', { count: row.folded.length })}
          </button>
        ))}
      </div>
    </div>
  )
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Steps aligned row by row when each present side is a list (a file absent on one side counts). */
function isSteps(a: Obj | null, b: Obj | null, key: string): boolean {
  return [a, b].every(o => !o || unitValue(o, key) === undefined || Array.isArray(unitValue(o, key)))
}

function steps(o: Obj | null, key: string): TestStep[] {
  const v = unitValue(o, key)
  return Array.isArray(v) ? (v as TestStep[]) : []
}

function ColumnTitle({ children, border }: { children: ReactNode; border?: boolean }) {
  return (
    <div className={`sticky top-0 z-10 px-3 py-1 bg-canvas border-b border-edge text-[11px] uppercase tracking-wide text-ink-3 truncate ${border ? 'border-l' : ''}`}>
      {children}
    </div>
  )
}

function AbsentNotice({ show, border }: { show: boolean; border?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className={`px-3 py-2 ${border ? 'border-l border-edge' : ''}`}>
      {show && <p className="text-xs text-ink-3 italic">{t('diffView.absentFile')}</p>}
    </div>
  )
}
