import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TestedConfig, TestedConfigNode, TestedDriftItem } from '@polenta/types'
import { api } from '../../api'

// GH202 — copie de la version testée d'un run, en lecture seule (specs/GH202.md §4).

type T = ReturnType<typeof useTranslation>['t']

/** Détail d'une différence avec l'état courant. */
export function driftText(t: T, item: TestedDriftItem): string {
  const none = t('testedConfig.none')
  const where = item.path ? `${item.path} : ` : ''
  switch (item.kind) {
    case 'version_missing': return `${where}${t('testedConfig.drift.missing', { ref: item.ref })}`
    case 'version_abandoned': return `${where}${t('testedConfig.drift.abandoned', { ref: item.ref })}`
    case 'component_changed': return `${where}${t('testedConfig.drift.component', { from: item.from ?? none, to: item.to ?? none })}`
    case 'change_added':
    case 'change_removed': {
      const verb = t(item.kind === 'change_added' ? 'testedConfig.drift.added' : 'testedConfig.drift.removed', { id: item.id, ref: item.ref })
      const when = item.at ? ` · ${new Date(item.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}` : ''
      return `${where}${verb}${when}${item.by ? ` · ${item.by}` : ''}`
    }
  }
}

/** Texte d'une valeur de la copie : label et ID, ou valeur libre. */
export function testedValueText(node: TestedConfigNode): string {
  if (node.undocumented) return node.undocumented
  return node.label ? `${node.label} (${node.ref})` : node.ref ?? ''
}

function NodeRow({ name, node, depth }: { name: string; node: TestedConfigNode; depth: number }) {
  const { t } = useTranslation()
  const deviates = !!node.undocumented || node.expected !== undefined
  return (
    <>
      <div
        className={`flex items-baseline gap-2 text-xs px-2 py-0.5 rounded ${node.undocumented ? 'bg-status-danger-bg' : deviates ? 'bg-status-warning-bg' : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        data-testid={`tested-node-${name}`}
      >
        <span className="text-ink-2 w-40 shrink-0 truncate" title={name}>{name}</span>
        <span className="text-ink">{testedValueText(node)}</span>
        {node.state && <span className="text-ink-3">{t(`testedConfig.state.${node.state}`)}</span>}
        {node.commit && <span className="font-mono text-ink-3" title={node.commit}>{node.commit.slice(0, 7)}</span>}
        {node.undocumented && <span className="text-status-danger">{t('testedConfig.undocumented')}</span>}
        {node.expected !== undefined && (
          <span className="text-status-warning">{t('testedConfig.expected', { ref: node.expected ?? t('testedConfig.none') })}</span>
        )}
      </div>
      {Object.entries(node.components ?? {}).map(([child, value]) => <NodeRow key={child} name={child} node={value} depth={depth + 1} />)}
    </>
  )
}

export function TestedConfigView({ repoPath, config, workspaceDir }: { repoPath: string; config: TestedConfig; workspaceDir?: string }) {
  const { t } = useTranslation()
  const { data: drift } = useQuery({
    queryKey: ['tested-config-drift', repoPath, config, workspaceDir ?? null],
    queryFn: () => api.testedConfig.drift(repoPath, config, workspaceDir),
    staleTime: 0,
  })
  return (
    <div data-testid="tested-config">
      <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">{t('testedConfig.title')}</p>
      <div className="border border-edge rounded px-1 py-2 bg-hover space-y-0.5">
        <NodeRow name={config.component} node={config} depth={0} />
        {(drift?.items.length ?? 0) > 0 && (
          <div className="mt-2 mx-2 pt-2 border-t border-edge text-xs text-status-warning" data-testid="tested-drift">
            <p className="font-medium mb-1">{t('testedConfig.evolved')}</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {drift!.items.map((item, i) => <li key={i}>{driftText(t, item)}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
