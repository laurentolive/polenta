import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
  /** GH45 S2b — thème par défaut de l'équipe : appliqué sans être enregistré, seulement sans choix personnel. */
  applyDefault: (t: Theme | null) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggle: () => {},
  setTheme: () => {},
  applyDefault: () => {},
})

// GH45 S2b — choix EXPLICITE de l'utilisateur. L'ancienne clé `polenta:theme` était écrite
// automatiquement à chaque rendu : elle sert encore de valeur initiale, mais ne compte pas comme
// un choix personnel (sinon le thème par défaut d'une équipe ne s'appliquerait jamais).
const CHOICE_KEY = 'polenta:theme-choice'
const LEGACY_KEY = 'polenta:theme'

function read(key: string): Theme | null {
  try {
    const stored = localStorage.getItem(key)
    return stored === 'dark' || stored === 'light' ? stored : null
  } catch {
    return null
  }
}

function osTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => read(CHOICE_KEY) ?? read(LEGACY_KEY) ?? osTheme())

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // GH45 S2b — seul un choix explicite est enregistré (avant : à chaque rendu, ce qui rendait
  // impossible de distinguer un choix de l'utilisateur d'une valeur par défaut).
  const persist = (t: Theme) => {
    try { localStorage.setItem(CHOICE_KEY, t) } catch { /* stockage indisponible */ }
  }
  const setTheme = (t: Theme) => { persist(t); setThemeState(t) }
  const toggle = () => setThemeState(t => {
    const next = t === 'dark' ? 'light' : 'dark'
    persist(next)
    return next
  })
  // `null` : plus de défaut d'équipe (déconnexion, autre équipe) → thème du système.
  const applyDefault = useCallback((t: Theme | null) => {
    if (!read(CHOICE_KEY)) setThemeState(t ?? read(LEGACY_KEY) ?? osTheme())
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle, applyDefault }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
