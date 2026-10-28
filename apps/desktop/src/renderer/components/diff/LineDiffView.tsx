import { useTranslation } from 'react-i18next'
import type { DiffLine } from '../../lib/lineDiff'

/** Mode Raw des vues de diff : diff texte ligne à ligne (inchangé depuis avant GH178). */
export function LineDiffView({ lines }: { lines: DiffLine[] }) {
  const { t } = useTranslation()
  if (lines.length === 0) return <p className="text-ink-3 italic p-6">{t('diffPage.noDifference')}</p>
  return (
    <table className="w-full border-collapse">
      <tbody>
        {lines.map((line, idx) => (
          <tr
            key={idx}
            className={
              line.type === 'add'
                ? 'bg-status-success-bg dark:bg-status-success-bg/15'
                : line.type === 'remove'
                ? 'bg-status-danger-bg dark:bg-status-danger-bg/15'
                : ''
            }
          >
            <td className="select-none text-right px-2 py-px text-ink-3 w-10 border-r border-edge-subtle align-top">
              {line.type !== 'add' ? line.lineNum : ''}
            </td>
            <td className="select-none text-right px-2 py-px text-ink-3 w-10 border-r border-edge-subtle align-top">
              {line.type !== 'remove' ? line.lineNum : ''}
            </td>
            <td className={`px-1 py-px w-6 select-none text-center font-bold align-top ${
              line.type === 'add' ? 'text-status-success' : line.type === 'remove' ? 'text-status-danger' : 'text-ink-3'
            }`}>
              {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
            </td>
            <td className="px-3 py-px text-ink whitespace-pre-wrap break-all">{line.content}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
