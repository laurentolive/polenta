import { useTranslation } from 'react-i18next'
import type { ParamResolutionPreview } from '@polenta/types'
import { TestParamFields } from '../TestParamFields'

/**
 * T179 §5 — sous un test itérant sélectionné (panneau d'ajout, création de campagne) : ses
 * exigences liées, une case par exigence (cochées par défaut, décochables), avec pour chaque
 * exigence cochée ses valeurs `{req.<champ>}` en lecture seule, les références non résolues et
 * les références à saisir propres à l'instance. Une exigence qui a déjà une instance dans la
 * campagne est grisée.
 */
export function ReqInstancePicker({ preview, present, selection, onToggle, onChange }: {
  preview: ParamResolutionPreview
  present: Set<string>
  /** Exigence cochée → valeurs saisies. */
  selection: Record<string, Record<string, string>>
  onToggle: (requirementId: string) => void
  onChange: (requirementId: string, key: string, value: string) => void
}) {
  const { t } = useTranslation()
  const requirements = preview.requirements ?? []
  return (
    <div className="pl-6 pb-2 ml-2 border-l-2 border-edge space-y-1">
      <p className="text-[11px] text-ink-3">{t('campaignParams.reqInstances.hint', { count: requirements.length })}</p>
      {requirements.map(req => {
        const isPresent = present.has(req.requirementId)
        const checked = !isPresent && !!selection[req.requirementId]
        return (
          <div key={req.requirementId}>
            <label className={`flex items-center gap-2 text-xs ${isPresent ? 'text-ink-3' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                className="rounded"
                checked={checked}
                disabled={isPresent}
                onChange={() => onToggle(req.requirementId)}
              />
              <span className="font-mono shrink-0">{req.requirementId}</span>
              <span className="truncate">{req.title}</span>
              {isPresent && (
                <span className="shrink-0 text-[10px] italic ml-auto">{t('campaignParams.reqInstances.alreadyPresent')}</span>
              )}
            </label>
            {checked && (
              <TestParamFields
                labels={preview.manual}
                resolved={{ ...preview.resolved, ...req.resolved }}
                unresolved={[...preview.unresolved, ...req.unresolved]}
                values={selection[req.requirementId] ?? {}}
                onChange={(key, value) => onChange(req.requirementId, key, value)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
