import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useOptionalTabs } from '../contexts/TabsContext'
import { encodeProjectId } from '../lib/projectId'
import { rowTargetRoute } from '../lib/rowNavigation'

/**
 * GH65 — ouvre, dans un nouvel onglet, l'objet d'une ligne de résultat de la vue Suivi (exigence,
 * test, campagne filtrée, résultat d'exécution). `message` est renseigné quelques secondes quand la
 * ligne ne correspond à aucun objet du périmètre, ou quand la résolution a échoué (pas de système
 * de toast dans l'app : l'appelant affiche la mention à côté de la table).
 */
export function useOpenRowTarget(repoPath: string, workspaceDir: string) {
  const { t } = useTranslation()
  // Hors `TabsProvider` (route d'impression d'un dashboard) : rien à ouvrir, les widgets n'y sont
  // de toute façon pas interactifs.
  const tabs = useOptionalTabs()
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(timer.current), [])

  const flash = useCallback((text: string) => {
    setMessage(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), 4000)
  }, [])

  const open = useCallback(async (row: Record<string, unknown>) => {
    if (!tabs) return
    let target
    try {
      target = await api.queries.resolveRowTarget(repoPath, row, workspaceDir)
    } catch (err) {
      flash(t('dashboardPage.drillDown.openFailed', { message: err instanceof Error ? err.message : String(err) }))
      return
    }
    if (!target) {
      flash(t('dashboardPage.drillDown.notFound'))
      return
    }
    const { pathname, search } = rowTargetRoute(target, encodeProjectId(workspaceDir || repoPath))
    tabs.openTab(pathname, search)
  }, [repoPath, workspaceDir, tabs, flash, t])

  return { open, message }
}
