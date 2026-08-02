import { useTranslation } from 'react-i18next'
import type { SyncFileStatus } from '@polenta/api-client'

interface FileListProps {
  files: SyncFileStatus[]
  selected: string | null
  onSelect: (path: string) => void
}

function markerColor(marker: 'M' | 'A' | 'D'): string {
  if (marker === 'A') return 'text-status-success'
  if (marker === 'D') return 'text-status-danger'
  return 'text-status-warning'
}

export function FileList({ files, selected, onSelect }: FileListProps) {
  const { t } = useTranslation()
  if (files.length === 0) {
    return <p className="text-xs text-ink-3 italic px-3 py-2">{t('sidebar.version.noModifiedFile')}</p>
  }
  return (
    <div className="overflow-y-auto flex-1">
      {files.map(f => (
        <button
          key={f.path}
          type="button"
          onClick={() => onSelect(f.path)}
          className={`w-full text-left px-3 py-1 flex items-center gap-2 text-xs font-mono hover:bg-hover transition-colors ${selected === f.path ? 'bg-hover' : ''}`}
        >
          <span className={`font-bold shrink-0 ${markerColor(f.marker)}`}>{f.marker}</span>
          <span className="truncate text-ink">{f.path}</span>
        </button>
      ))}
    </div>
  )
}
