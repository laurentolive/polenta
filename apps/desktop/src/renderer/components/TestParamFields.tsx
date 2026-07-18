import type { TestCase } from '@polenta/types'
import { extractTestParameters } from '../lib/testParams'

interface Props {
  testCase: TestCase
  values: Record<string, string>
  onChange: (label: string, value: string) => void
}

/** Formulaire de saisie des valeurs de paramètres {label} détectés dans un test. Rendu
 * conditionnel — ne s'affiche rien si le test n'a aucun paramètre. Utilisé à l'ajout d'un
 * test à une campagne (nouvelle ou existante) et pour l'édition ultérieure des valeurs. */
export function TestParamFields({ testCase, values, onChange }: Props) {
  const params = extractTestParameters(testCase)
  if (params.length === 0) return null

  return (
    <div className="pl-6 pb-2 space-y-1.5 border-l-2 border-edge ml-2">
      {params.map(label => (
        <label key={label} className="flex items-center gap-2 text-xs">
          <span className="font-mono text-ink-3 shrink-0 w-24 truncate" title={label}>
            {'{' + label + '}'}
          </span>
          <input
            type="text"
            value={values[label] ?? ''}
            onChange={e => onChange(label, e.target.value)}
            className="input-field flex-1 text-xs py-1"
            placeholder="Valeur…"
          />
        </label>
      ))}
    </div>
  )
}
