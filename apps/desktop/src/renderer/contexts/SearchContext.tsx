/**
 * SearchContext — état partagé de la Vue Recherche (T167).
 *
 * Le panneau latéral (`SearchPanel`, dans la `Sidebar`) et la zone principale
 * (`routes/search.tsx`, dans l'`<Outlet/>`) sont dans deux sous-arbres React
 * distincts. Cet état — requête, options, filtres de type, résultats calculés,
 * cible « goto », élément en cours d'édition — vit donc dans un provider monté
 * dans `AppLayout` (branche `currentProjectId`), consommé par les deux.
 *
 * `enabled: !!regex` sur les requêtes de liste : aucun fetch tant qu'aucune
 * recherche n'est saisie — le provider est inerte au repos.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import i18n from '../i18n'
import { decodeProjectId } from '../lib/projectId'
import {
  buildRegex,
  findMatches,
  getStringFields,
  replaceInText,
  type SearchOpts,
  type SearchResult,
  type SearchTypes,
} from '../lib/searchQuery'
import type { Requirement, TestCase, TestCampaign } from '@polenta/types'

interface EditingTarget {
  id: string
  itemType: 'requirement' | 'test'
}

interface SearchContextValue {
  // ── état recherche ──
  query: string
  setQuery: (v: string) => void
  replaceQuery: string
  setReplaceQuery: (v: string) => void
  showReplace: boolean
  setShowReplace: Dispatch<SetStateAction<boolean>>
  opts: SearchOpts
  setOpts: Dispatch<SetStateAction<SearchOpts>>
  types: SearchTypes
  setTypes: Dispatch<SetStateAction<SearchTypes>>
  // ── dérivés ──
  repoPath: string
  regex: RegExp | null
  regexInvalid: boolean
  results: SearchResult[]
  totalMatches: number
  requirements: Requirement[]
  tests: TestCase[]
  campaigns: TestCampaign[]
  // ── remplacement ──
  replacing: boolean
  replaceError: string | null
  handleReplaceOne: (result: SearchResult) => Promise<void>
  handleReplaceAll: () => Promise<void>
  // ── goto (clic simple) ──
  gotoId: string | null
  gotoSeq: number
  setGoto: (id: string | null) => void
  clearGoto: () => void
  // ── édition inline (double-clic — sprint 2) ──
  editing: EditingTarget | null
  openEditor: (result: SearchResult) => void
  closeEditor: () => void
}

const SearchContext = createContext<SearchContextValue | null>(null)

export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext)
  if (!ctx) throw new Error('useSearch must be used within a SearchProvider')
  return ctx
}

/** Variante non-throw : le provider n'est monté qu'avec un projet ouvert, or la route
 *  `/search` peut être atteinte sans `projectId` (route restaurée au démarrage, projet
 *  fermé alors qu'on est sur la Recherche). Retourne `null` dans ce cas. */
export function useOptionalSearch(): SearchContextValue | null {
  return useContext(SearchContext)
}

export function SearchProvider({
  currentProjectId,
  children,
}: {
  currentProjectId: string
  children: ReactNode
}) {
  const queryClient = useQueryClient()

  const [query, setQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [opts, setOpts] = useState<SearchOpts>({
    caseSensitive: false,
    wholeWord: false,
    isRegex: false,
    preserveCase: false,
  })
  const [types, setTypes] = useState<SearchTypes>({
    requirements: true,
    tests: true,
    campaigns: true,
  })
  const [replacing, setReplacing] = useState(false)
  const [replaceError, setReplaceError] = useState<string | null>(null)

  const [gotoTarget, setGotoTarget] = useState<{ id: string | null; seq: number }>({ id: null, seq: 0 })
  const [editing, setEditing] = useState<EditingTarget | null>(null)

  const { data: project } = useQuery({
    queryKey: ['workspace', currentProjectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId)),
  })
  const repoPath = project?.localPath ?? ''

  const regex = useMemo(() => buildRegex(query, opts), [query, opts])
  const regexInvalid = opts.isRegex && !!query && !regex

  const { data: requirements = [] } = useQuery({
    queryKey: ['requirements', repoPath],
    queryFn: () => api.requirements.list(repoPath),
    enabled: !!repoPath && types.requirements && !!regex,
  })

  const { data: tests = [] } = useQuery({
    queryKey: ['tests', repoPath],
    queryFn: () => api.tests.list(repoPath),
    enabled: !!repoPath && types.tests && !!regex,
  })

  const { data: campaigns = [] } = useQuery({
    queryKey: ['campaigns', repoPath],
    queryFn: () => api.campaigns.list(repoPath),
    enabled: !!repoPath && types.campaigns && !!regex,
  })

  const results = useMemo((): SearchResult[] => {
    if (!regex) return []
    const out: SearchResult[] = []

    if (types.requirements) {
      for (const req of requirements as Requirement[]) {
        const fields = [
          { key: 'id', value: req.id },
          { key: 'title', value: req.title },
          ...getStringFields(req.fields),
        ]
        const matches = findMatches(fields, regex)
        if (matches.length) out.push({ itemType: 'requirement', id: req.id, title: req.title, matches })
      }
    }

    if (types.tests) {
      for (const test of tests as TestCase[]) {
        const fields = [
          { key: 'id', value: test.id },
          { key: 'title', value: test.title },
          ...getStringFields(test.fields),
        ]
        const matches = findMatches(fields, regex)
        if (matches.length) out.push({ itemType: 'test', id: test.id, title: test.title, matches })
      }
    }

    if (types.campaigns) {
      for (const camp of campaigns as TestCampaign[]) {
        const fields = [
          { key: 'id', value: camp.id },
          { key: 'title', value: camp.title },
          ...Object.entries(camp.fields ?? {})
            .filter(([, v]) => typeof v === 'string' && v)
            .map(([k, v]) => ({ key: k, value: v as string })),
        ]
        const matches = findMatches(fields, regex)
        if (matches.length) out.push({ itemType: 'campaign', id: camp.id, title: camp.title, matches })
      }
    }

    return out
  }, [regex, requirements, tests, campaigns, types])

  const totalMatches = results.reduce((acc, r) => acc + r.matches.length, 0)

  const replaceInItem = useCallback(async (result: SearchResult): Promise<void> => {
    if (!regex || !repoPath) return

    if (result.itemType === 'requirement') {
      const req = (requirements as Requirement[]).find((r) => r.id === result.id)
      if (!req) return
      const newTitle = result.matches.some((m) => m.key === 'title')
        ? replaceInText(req.title, regex, replaceQuery, opts.preserveCase)
        : req.title
      const newFields: Record<string, unknown> = { ...req.fields }
      for (const m of result.matches) {
        if (m.key !== 'id' && m.key !== 'title') {
          const v = req.fields[m.key]
          if (typeof v === 'string') {
            newFields[m.key] = replaceInText(v, regex, replaceQuery, opts.preserveCase)
          }
        }
      }
      await api.requirements.update(repoPath, result.id, { title: newTitle, fields: newFields })
      queryClient.invalidateQueries({ queryKey: ['requirements', repoPath] })
    } else if (result.itemType === 'test') {
      const test = (tests as TestCase[]).find((t) => t.id === result.id)
      if (!test) return
      const newTitle = result.matches.some((m) => m.key === 'title')
        ? replaceInText(test.title, regex, replaceQuery, opts.preserveCase)
        : test.title
      const newFields: Record<string, unknown> = { ...test.fields }
      for (const m of result.matches) {
        if (m.key !== 'id' && m.key !== 'title') {
          const v = test.fields[m.key]
          if (typeof v === 'string') {
            newFields[m.key] = replaceInText(v, regex, replaceQuery, opts.preserveCase)
          }
        }
      }
      await api.tests.update(repoPath, result.id, { title: newTitle, fields: newFields })
      queryClient.invalidateQueries({ queryKey: ['tests', repoPath] })
    }
    // campaigns: pas de endpoint update générique
  }, [regex, repoPath, requirements, tests, replaceQuery, opts.preserveCase, queryClient])

  const handleReplaceOne = useCallback(async (result: SearchResult) => {
    setReplaceError(null)
    try {
      await replaceInItem(result)
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : i18n.t('sidebar.search.replaceError'))
    }
  }, [replaceInItem])

  const handleReplaceAll = useCallback(async () => {
    if (!regex || !repoPath || replacing || results.length === 0) return
    setReplacing(true)
    setReplaceError(null)
    try {
      for (const result of results) {
        if (result.itemType !== 'campaign') {
          await replaceInItem(result)
        }
      }
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : i18n.t('sidebar.search.replaceError'))
    } finally {
      setReplacing(false)
    }
  }, [regex, repoPath, replacing, results, replaceInItem])

  const setGoto = useCallback((id: string | null) => {
    setEditing(null)
    setGotoTarget((g) => ({ id, seq: g.seq + 1 }))
  }, [])

  const clearGoto = useCallback(() => {
    setGotoTarget((g) => (g.id === null ? g : { id: null, seq: g.seq + 1 }))
  }, [])

  const openEditor = useCallback((result: SearchResult) => {
    if (result.itemType === 'campaign') return
    setGotoTarget((g) => (g.id === null ? g : { id: null, seq: g.seq + 1 }))
    setEditing({ id: result.id, itemType: result.itemType })
  }, [])

  const closeEditor = useCallback(() => setEditing(null), [])

  const value = useMemo((): SearchContextValue => ({
    query, setQuery,
    replaceQuery, setReplaceQuery,
    showReplace, setShowReplace,
    opts, setOpts,
    types, setTypes,
    repoPath,
    regex,
    regexInvalid,
    results,
    totalMatches,
    requirements: requirements as Requirement[],
    tests: tests as TestCase[],
    campaigns: campaigns as TestCampaign[],
    replacing, replaceError,
    handleReplaceOne, handleReplaceAll,
    gotoId: gotoTarget.id,
    gotoSeq: gotoTarget.seq,
    setGoto, clearGoto,
    editing, openEditor, closeEditor,
  }), [
    query, replaceQuery, showReplace, opts, types,
    repoPath, regex, regexInvalid, results, totalMatches,
    requirements, tests, campaigns,
    replacing, replaceError, handleReplaceOne, handleReplaceAll,
    gotoTarget, setGoto, clearGoto,
    editing, openEditor, closeEditor,
  ])

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}
