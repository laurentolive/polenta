import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatLinksText, isAcceptedLinkUrl, readLinkValues, type LinkValue } from '@polenta/types'
import { linksFromClipboard } from './linkPaste'

// GH195 — saisie d'un champ `link` (specs/GH195.md §1.5) : une ligne par lien (libellé, URL),
// ajout / retrait / ordre pour un champ `multiple`, URL invalide signalée sur la ligne (l'écriture
// est refusée par le main de toute façon). Collage depuis Word / Excel / un navigateur : les liens
// hypertexte copiés sont convertis (`linksFromClipboard`). La valeur échangée avec l'appelant est la
// forme texte `libellé | URL` : les formulaires restent en `Record<string, string>` et le main
// convertit à l'écriture.

interface Row {
  label: string
  url: string
}

interface Props {
  /** Valeur stockée (objet, liste) ou forme texte. */
  value: unknown
  /** Forme texte des lignes renseignées (`libellé | URL`, une par ligne ; '' si aucune). */
  onChange: (text: string) => void
  multiple?: boolean
  disabled?: boolean
  autoFocus?: boolean
  /** Ctrl/Cmd+Entrée : valider (popover de cellule). */
  onSubmit?: () => void
}

const toRows = (value: unknown): Row[] => readLinkValues(value).map(l => ({ label: l.label ?? '', url: l.url }))

// Une ligne avec un libellé mais sans URL est gardée (`libellé |`) : l'écriture la refuse avec
// « URL manquante » au lieu de perdre le libellé sans prévenir.
function toLinks(rows: Row[]): LinkValue[] {
  return rows
    .map(r => ({ label: r.label.trim(), url: r.url.trim() }))
    .filter(r => r.url || r.label)
    .map(r => (r.label ? r : { url: r.url }))
}

export function LinkEditor({ value, onChange, multiple, disabled, autoFocus, onSubmit }: Props) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Row[]>(() => {
    const initial = toRows(value)
    return initial.length > 0 ? initial : [{ label: '', url: '' }]
  })
  const [notice, setNotice] = useState<string | null>(null)
  // Valeur émise en dernier : une mise à jour de `value` qui n'en vient pas (refetch, autre onglet)
  // remplace les lignes ; sinon on garde les lignes en cours (ligne vide en saisie comprise).
  const emitted = useRef(formatLinksText(readLinkValues(value)))
  useEffect(() => {
    const external = formatLinksText(readLinkValues(value))
    if (external === emitted.current) return
    emitted.current = external
    const next = toRows(value)
    setRows(next.length > 0 ? next : [{ label: '', url: '' }])
  }, [value])

  const commit = (next: Row[]) => {
    setRows(next)
    const text = formatLinksText(toLinks(next))
    if (text !== emitted.current) {
      emitted.current = text
      onChange(text)
    }
  }

  const update = (i: number, patch: Partial<Row>) => commit(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const remove = (i: number) => {
    const next = rows.filter((_, j) => j !== i)
    commit(next.length > 0 ? next : [{ label: '', url: '' }])
  }
  const move = (i: number, delta: number) => {
    const j = i + delta
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }

  const onPaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = linksFromClipboard(e.clipboardData)
    if (!pasted) return
    e.preventDefault()
    const incoming: Row[] = pasted.links.map(l => ({ label: l.label ?? rows[i].label, url: l.url }))
    let next: Row[]
    if (multiple) {
      next = [...rows.slice(0, i), ...incoming, ...rows.slice(i + 1)]
    } else {
      next = [incoming[0]]
    }
    const notes: string[] = []
    if (pasted.rejected > 0) notes.push(t('linkField.pasteRejected', { count: pasted.rejected }))
    if (!multiple && incoming.length > 1) notes.push(t('linkField.pasteSingleOnly'))
    setNotice(notes.length ? notes.join(' ') : null)
    commit(next)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (onSubmit && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="space-y-1" data-link-editor>
      {rows.map((row, i) => {
        const invalidUrl = (row.url.trim() !== '' && !isAcceptedLinkUrl(row.url)) || (row.url.trim() === '' && row.label.trim() !== '')
        const invalidLabel = /[|\r\n]/.test(row.label)
        return (
          <div key={i}>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={row.label}
                onChange={e => update(i, { label: e.target.value })}
                onPaste={e => onPaste(i, e)}
                onKeyDown={onKeyDown}
                disabled={disabled}
                placeholder={t('linkField.labelPlaceholder')}
                aria-label={t('linkField.label')}
                className={`input-field w-1/3 text-xs ${invalidLabel ? 'border-status-danger' : ''}`}
              />
              <input
                type="text"
                value={row.url}
                autoFocus={autoFocus && i === 0}
                onChange={e => update(i, { url: e.target.value })}
                onPaste={e => onPaste(i, e)}
                onKeyDown={onKeyDown}
                disabled={disabled}
                placeholder={t('linkField.urlPlaceholder')}
                aria-label={t('linkField.url')}
                aria-invalid={invalidUrl}
                className={`input-field flex-1 text-xs font-mono ${invalidUrl ? 'border-status-danger' : ''}`}
              />
              {multiple && rows.length > 1 && (
                <>
                  <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} className="btn-icon text-xs px-1" title={t('linkField.moveUp')}>↑</button>
                  <button type="button" disabled={disabled || i === rows.length - 1} onClick={() => move(i, 1)} className="btn-icon text-xs px-1" title={t('linkField.moveDown')}>↓</button>
                </>
              )}
              {(row.url || row.label || rows.length > 1) && (
                <button type="button" disabled={disabled} onClick={() => remove(i)} className="btn-icon text-xs px-1" title={t('linkField.remove')}>×</button>
              )}
            </div>
            {invalidUrl && <p className="text-[11px] text-status-danger mt-0.5">{t('linkField.invalidUrl')}</p>}
            {invalidLabel && <p className="text-[11px] text-status-danger mt-0.5">{t('linkField.invalidLabel')}</p>}
          </div>
        )
      })}
      {multiple && !disabled && (
        <button type="button" onClick={() => commit([...rows, { label: '', url: '' }])} className="text-xs text-ink-2 hover:text-ink underline">
          {t('linkField.add')}
        </button>
      )}
      {notice && <p className="text-[11px] text-ink-3">{notice}</p>}
    </div>
  )
}
