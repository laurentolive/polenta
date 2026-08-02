import { useRef, useEffect } from 'react'
import { useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api'
import { decodeProjectId } from '../../../lib/projectId'
import { useSelectedRepo } from '../../../contexts/SelectedRepoContext'
import { useCompareRefs } from '../../../contexts/CompareRefsContext'
import { useWorkspaceStructure } from '../../../hooks/useWorkspaceStructure'
import { GitRefCombobox } from './GitRefCombobox'
import { FileList } from './FileList'

interface Props {
  projectId: string
}

/** Body shown in place of the repo tree when the Version sidebar is scoped to the
 *  `/version-diff` route (T-sidebar-compare): the modified-files tree isn't relevant while
 *  comparing two arbitrary commits, so this replaces it with the repo picker + the two
 *  commit comboboxes that used to live in a panel local to the `/version-diff` page itself. */
export function VersionCompareSelector({ projectId }: Props) {
  const { t } = useTranslation()
  // shouldThrow: false — VersionPanel decides to mount this component from `location.pathname`
  // (useRouterState), which can update a tick before the router's matches array includes
  // this route ; without it, useSearch() throws "Could not find an active match" in that window.
  const search = useSearch({ from: '/version-diff', shouldThrow: false })
  const { repoPath: urlRepoPath, ref1, sha1: urlSha1, ref2, sha2: urlSha2 } = search ?? {}
  const { selectedRepoPath, rootRepoPath, selectRepo } = useSelectedRepo()
  const { sha1, sha2, selectedFile, setSha1, setSha2, setSelectedFile } = useCompareRefs()

  const workspaceDir = decodeProjectId(projectId)
  const { flatNodes } = useWorkspaceStructure(workspaceDir, rootRepoPath)
  const repoPath = selectedRepoPath

  // Amorçage (une fois) : si l'URL porte un repoPath explicite différent du repo
  // actuellement sélectionné dans le contexte partagé, l'y reporter. Attend que le
  // contexte ait résolu un premier repo (le root, par défaut) avant de comparer.
  const seededRepoRef = useRef(false)
  useEffect(() => {
    if (seededRepoRef.current) return
    if (!repoPath) return
    if (urlRepoPath && urlRepoPath !== repoPath) {
      selectRepo(urlRepoPath)
      return
    }
    seededRepoRef.current = true
  }, [repoPath, urlRepoPath, selectRepo])

  // Suivi du repo sélectionné (T80) : toute transition *après* l'amorçage initial est un
  // changement voulu par l'utilisateur — réinitialise Objet A/B, une branche/tag/commit
  // d'un repo n'existant pas forcément dans un autre.
  const prevRepoRef = useRef<string | null>(null)
  useEffect(() => {
    if (!seededRepoRef.current) return
    if (prevRepoRef.current === null) {
      prevRepoRef.current = repoPath
      return
    }
    if (prevRepoRef.current !== repoPath) {
      prevRepoRef.current = repoPath
      setSha1(undefined)
      setSha2(undefined)
    }
  }, [repoPath, setSha1, setSha2])

  const { data: refs = [] } = useQuery({
    queryKey: ['sync:resolve-refs', repoPath],
    queryFn: () => api.sync.resolveRefs(repoPath),
    enabled: !!repoPath,
  })

  // Initialize sha1/sha2 from URL params once, the first time refs are available.
  // Gated on `seededRepoRef` — see version-diff.tsx history for why (T80 stale-repo race).
  const initializedRef = useRef(false)
  useEffect(() => {
    if (initializedRef.current) return
    if (!seededRepoRef.current) return
    if (!refs.length && !urlSha1 && !urlSha2) return

    if (urlSha1) {
      setSha1(urlSha1)
    } else if (ref1) {
      if (!refs.length) return
      const found = refs.find(r => r.name === ref1)
      if (found) setSha1(found.sha)
    }

    if (urlSha2) {
      setSha2(urlSha2)
    } else if (ref2) {
      if (!refs.length) return
      const found = refs.find(r => r.name === ref2)
      if (found) setSha2(found.sha)
    }

    if (urlSha1 || urlSha2 || refs.length) {
      initializedRef.current = true
    }
  }, [refs, urlSha1, urlSha2, ref1, ref2, repoPath, setSha1, setSha2])

  const { data: files = [], isLoading: isLoadingFiles } = useQuery({
    queryKey: ['sync:diff-between', repoPath, sha1, sha2],
    queryFn: () => api.sync.diffBetween(repoPath, sha1!, sha2!),
    enabled: !!repoPath && !!sha1 && !!sha2,
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 flex flex-col gap-2 shrink-0">
        <div>
          <p className="text-xs text-ink-3 mb-1">{t('sidebar.version.repo')}</p>
          <select
            value={repoPath}
            onChange={e => selectRepo(e.target.value)}
            className="w-full text-xs px-2 py-1 border border-edge rounded bg-surface text-ink"
          >
            {flatNodes.map(n => (
              <option key={n.repoPath} value={n.repoPath}>{n.name}</option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-xs text-ink-3 mb-1">{t('sidebar.version.objectA')}</p>
          <GitRefCombobox refs={refs} value={sha1} placeholder={t('sidebar.version.select')} onChange={setSha1} />
        </div>
        <div>
          <p className="text-xs text-ink-3 mb-1">{t('sidebar.version.objectB')}</p>
          <GitRefCombobox refs={refs} value={sha2} placeholder={t('sidebar.version.select')} onChange={setSha2} />
        </div>
      </div>

      <div className="px-3 py-1.5 border-y border-edge-subtle shrink-0">
        <p className="section-label">{t('sidebar.version.modifiedFiles')}{files.length > 0 ? ` (${files.length})` : ''}</p>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {!sha1 || !sha2 ? (
          <p className="text-xs text-ink-3 italic px-3 py-2">
            {t('sidebar.version.selectTwoObjects')}
          </p>
        ) : isLoadingFiles ? (
          <p className="text-xs text-ink-3 italic px-3 py-2">{t('common.loading')}</p>
        ) : (
          <FileList files={files} selected={selectedFile} onSelect={setSelectedFile} />
        )}
      </div>
    </div>
  )
}
