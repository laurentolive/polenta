/**
 * ColumnDeclEditor — déclaration de colonne calculée de la Vue Système d'une requête partagée
 * (GH70, vue `/query`). Case « Utiliser comme colonne », libellé, catégories et types d'objet
 * concernés, type de champ (rendu de la cellule), valeurs pour un enum. Les erreurs de
 * `validateColumnDecl` sont affichées sous le formulaire (l'enregistrement est refusé tant qu'il y
 * en a). Désactivé avec une mention pour une requête privée. Sprint 3 : disponible aussi en mode
 * modèle ; colonnes du résultat servant d'identifiant / valeur / infobulle choisies parmi celles du
 * dernier résultat.
 */
import { useTranslation } from 'react-i18next'
import type { ComputedColumnType, QueryColumnDef } from '@polenta/types'
import { COLUMN_DEFAULT_ID, COLUMN_DEFAULT_TOOLTIP, COLUMN_DEFAULT_VALUE, COMPUTED_COLUMN_CATEGORIES, COMPUTED_COLUMN_TYPES, labelText, validateColumnDecl } from '@polenta/types'

interface ObjectTypeOption {
  objectTypeRef: string
  label: string
  component: string
  category: string
}

interface Props {
  value: QueryColumnDef | null
  onChange: (next: QueryColumnDef | null) => void
  /** Libellé proposé à l'activation (titre de la requête). */
  defaultLabel: string
  objectTypes: ObjectTypeOption[]
  /** Colonnes du dernier résultat de la requête (choix des colonnes identifiant / valeur / infobulle). */
  resultColumns: string[]
  readOnly?: boolean
  /** Raison d'indisponibilité (requête privée, non enregistrée) : formulaire désactivé. */
  unavailableReason?: string
}

export function ColumnDeclEditor({ value, onChange, defaultLabel, objectTypes, resultColumns, readOnly = false, unavailableReason }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'fr'
  const disabled = readOnly || !!unavailableReason
  const { errors } = validateColumnDecl(value)
  // Un même `<nœud>::<type>` peut exister dans plusieurs repos : proposé une seule fois.
  const typeOptions = [...new Map(
    objectTypes.filter((o) => o.category === 'requirement' || o.category === 'test').map((o) => [o.objectTypeRef, o]),
  ).values()]

  const enable = (on: boolean) => onChange(on
    ? { label: defaultLabel.trim() || t('queryPage.column.defaultLabel'), appliesTo: { categories: ['test'], objectTypes: [] }, type: 'text' }
    : null)
  const update = (patch: Partial<QueryColumnDef>) => {
    if (!value) return
    const next = { ...value, ...patch }
    if (patch.type && patch.type !== value.type) {
      if (patch.type === 'enum' || patch.type === 'multi_enum') next.values = value.values ?? []
      else delete next.values
    }
    onChange(next)
  }
  const toggleIn = <T extends string>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])
  // Liste des colonnes du résultat (valeur enregistrée comprise, signalée si absente du résultat).
  const columnSelect = (opts: {
    current: string; options: string[]; label: string; testId: string; onSelect: (v: string) => void; emptyLabel?: string
  }) => (
    <select
      value={opts.current}
      disabled={disabled}
      onChange={(e) => opts.onSelect(e.target.value)}
      className="input-field text-xs py-1 w-36 font-mono"
      aria-label={opts.label}
      data-testid={opts.testId}
    >
      {opts.emptyLabel !== undefined && <option value="">{opts.emptyLabel}</option>}
      {[...new Set([...(opts.current ? [opts.current] : []), ...opts.options, ...resultColumns])].map((c) => (
        <option key={c} value={c}>{c}{!resultColumns.includes(c) ? ` (${t('queryPage.column.notInResult')})` : ''}</option>
      ))}
    </select>
  )

  // Colonne du résultat : la valeur par défaut n'est pas écrite (déclaration minimale).
  const mappingSelect = (key: 'idColumn' | 'valueColumn' | 'tooltipColumn', fallback: string, label: string) => {
    if (!value) return null
    return (
      <Field label={label} hint={t('queryPage.column.mappingHint')}>
        {columnSelect({
          current: value[key] ?? fallback, options: [fallback], label, testId: `column-decl-${key}`,
          onSelect: (v) => {
            const next = { ...value }
            if (v === fallback) delete next[key]
            else next[key] = v
            onChange(next)
          },
        })}
      </Field>
    )
  }

  // GH126 — colonne éclatée : une sous-colonne par valeur de `splitColumn`, libellée par
  // `splitLabelColumn` (option vide = la valeur). Décocher retire les deux propriétés.
  const splitFields = () => {
    if (!value) return null
    const on = value.splitColumn !== undefined
    const set = (patch: Pick<QueryColumnDef, 'splitColumn' | 'splitLabelColumn'>) => {
      const next = { ...value, ...patch }
      if (!next.splitColumn) { delete next.splitColumn; delete next.splitLabelColumn }
      if (!next.splitLabelColumn) delete next.splitLabelColumn
      onChange(next)
    }
    // Défaut : première colonne du résultat qui n'est ni l'identifiant, ni la valeur, ni l'infobulle
    // (éclater sur l'ID donnerait une sous-colonne par élément).
    const used = new Set([value.idColumn ?? COLUMN_DEFAULT_ID, value.valueColumn ?? COLUMN_DEFAULT_VALUE, value.tooltipColumn ?? COLUMN_DEFAULT_TOOLTIP, '_ids'])
    const defaultSplit = resultColumns.find((c) => !used.has(c)) ?? resultColumns[0] ?? COLUMN_DEFAULT_ID
    return (
      <>
        <Field label={t('queryPage.column.split')} hint={t('queryPage.column.splitHint')}>
          <span className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={on}
              disabled={disabled}
              onChange={(e) => set({ splitColumn: e.target.checked ? defaultSplit : undefined })}
              aria-label={t('queryPage.column.split')}
              data-testid="column-decl-split-enable"
            />
            {on && columnSelect({
              current: value.splitColumn!, options: [], label: t('queryPage.column.split'), testId: 'column-decl-splitColumn',
              onSelect: (v) => set({ splitColumn: v }),
            })}
          </span>
        </Field>
        {on && (
          <Field label={t('queryPage.column.splitLabelColumn')} hint={t('queryPage.column.mappingHint')}>
            {columnSelect({
              current: value.splitLabelColumn ?? '', options: [], label: t('queryPage.column.splitLabelColumn'), testId: 'column-decl-splitLabelColumn',
              emptyLabel: t('queryPage.column.splitLabelDefault'), onSelect: (v) => set({ splitLabelColumn: v || undefined }),
            })}
          </Field>
        )}
      </>
    )
  }

  return (
    <div className="border border-edge rounded-lg" data-testid="column-decl-editor">
      <label className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-ink-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!value}
          disabled={disabled}
          onChange={(e) => enable(e.target.checked)}
          data-testid="column-decl-enable"
        />
        {t('queryPage.column.enable')}
        {unavailableReason && <span className="text-[11px] font-normal text-ink-3 italic">— {unavailableReason}</span>}
      </label>
      {value && (
        <div className="px-3 py-2 border-t border-edge-subtle flex flex-wrap items-start gap-3 text-xs">
          <Field label={t('queryPage.column.label')}>
            <input
              value={labelText(value.label, lang)}
              disabled={disabled}
              // Libellé bilingue (généré par un modèle) : seule la langue affichée est modifiée.
              onChange={(e) => update({ label: typeof value.label === 'string' ? e.target.value : { ...value.label, [lang]: e.target.value } })}
              className="input-field text-xs py-1 w-44"
              aria-label={t('queryPage.column.label')}
              data-testid="column-decl-label"
            />
          </Field>
          <Field label={t('queryPage.column.categories')}>
            <span className="flex flex-col gap-0.5">
              {COMPUTED_COLUMN_CATEGORIES.map((c) => (
                <label key={c} className="flex items-center gap-1 text-[11px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={value.appliesTo.categories.includes(c)}
                    disabled={disabled}
                    onChange={() => update({ appliesTo: { ...value.appliesTo, categories: toggleIn(value.appliesTo.categories, c) } })}
                    data-testid={`column-decl-category-${c}`}
                  />
                  {t(`queryPage.column.category.${c}`)}
                </label>
              ))}
            </span>
          </Field>
          <Field label={t('queryPage.column.objectTypes')} hint={t('queryPage.column.objectTypesHint')}>
            <span className="flex flex-col gap-0.5 max-h-24 overflow-y-auto pr-2">
              {typeOptions.length === 0 && <span className="text-[11px] text-ink-3 italic">—</span>}
              {typeOptions.map((o) => (
                <label key={o.objectTypeRef} className="flex items-center gap-1 text-[11px] text-ink-2" title={o.objectTypeRef}>
                  <input
                    type="checkbox"
                    checked={value.appliesTo.objectTypes.includes(o.objectTypeRef)}
                    disabled={disabled}
                    onChange={() => update({ appliesTo: { ...value.appliesTo, objectTypes: toggleIn(value.appliesTo.objectTypes, o.objectTypeRef) } })}
                  />
                  {o.label} <span className="text-ink-3">({o.component})</span>
                </label>
              ))}
            </span>
          </Field>
          <Field label={t('queryPage.column.type')}>
            <select
              value={value.type}
              disabled={disabled}
              onChange={(e) => update({ type: e.target.value as ComputedColumnType })}
              className="input-field text-xs py-1"
              aria-label={t('queryPage.column.type')}
              data-testid="column-decl-type"
            >
              {COMPUTED_COLUMN_TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
            </select>
          </Field>
          {(value.type === 'enum' || value.type === 'multi_enum') && (
            <Field label={t('queryPage.column.values')} hint={t('queryPage.column.valuesHint')}>
              <textarea
                // Non contrôlé (une ligne vide en cours de saisie serait retirée) : remonté quand les
                // valeurs changent de l'extérieur.
                key={JSON.stringify(value.values ?? [])}
                defaultValue={(value.values ?? []).join('\n')}
                disabled={disabled}
                onBlur={(e) => update({ values: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })}
                rows={4}
                className="input-field text-xs py-1 w-36 font-mono"
                aria-label={t('queryPage.column.values')}
                data-testid="column-decl-values"
              />
            </Field>
          )}
          {mappingSelect('idColumn', COLUMN_DEFAULT_ID, t('queryPage.column.idColumn'))}
          {mappingSelect('valueColumn', COLUMN_DEFAULT_VALUE, t('queryPage.column.valueColumn'))}
          {mappingSelect('tooltipColumn', COLUMN_DEFAULT_TOOLTIP, t('queryPage.column.tooltipColumn'))}
          {splitFields()}
          {value.appliesTo.categories.length === 0 && value.appliesTo.objectTypes.length === 0 && (
            <p className="basis-full text-[11px] text-status-warning" data-testid="column-decl-nowhere">{t('queryPage.column.appliesNowhere')}</p>
          )}
          <p className="basis-full text-[11px] text-ink-3">{t('queryPage.column.contract')}</p>
        </div>
      )}
      {value && errors.length > 0 && (
        <ul className="px-3 py-2 border-t border-edge-subtle text-[11px] text-status-danger list-disc list-inside" data-testid="column-decl-errors">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[11px] text-ink-3" title={hint}>{label}</span>
      {children}
    </span>
  )
}
