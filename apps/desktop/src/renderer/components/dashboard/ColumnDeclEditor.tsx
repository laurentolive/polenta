/**
 * ColumnDeclEditor — déclaration de colonne calculée de la Vue Système d'une requête partagée
 * (GH70, vue `/query`). Case « Utiliser comme colonne », libellé, catégories et types d'objet
 * concernés, type de champ (rendu de la cellule), valeurs pour un enum. Les erreurs de
 * `validateColumnDecl` sont affichées sous le formulaire (l'enregistrement est refusé tant qu'il y
 * en a). Désactivé avec une mention pour une requête privée ou pas encore enregistrée.
 */
import { useTranslation } from 'react-i18next'
import type { ComputedColumnType, QueryColumnDef } from '@polenta/types'
import { COMPUTED_COLUMN_CATEGORIES, COMPUTED_COLUMN_TYPES, labelText, validateColumnDecl } from '@polenta/types'

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
  readOnly?: boolean
  /** Raison d'indisponibilité (requête privée, non enregistrée) : formulaire désactivé. */
  unavailableReason?: string
}

export function ColumnDeclEditor({ value, onChange, defaultLabel, objectTypes, readOnly = false, unavailableReason }: Props) {
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
