// GH178 — préférences des vues de diff (par poste, localStorage), distinctes de celles de la
// résolution de conflits (`mergePrefs`).

const MODE_KEY = 'polenta:diffViewMode'
const HIDE_UNCHANGED_KEY = 'polenta:diffHideUnchanged'

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable: preference not kept */ }
}

export const diffPrefs = {
  /** Rendu par défaut (première ouverture), puis le dernier mode choisi. */
  mode: (): 'raw' | 'rendered' => (read(MODE_KEY) === 'raw' ? 'raw' : 'rendered'),
  setMode: (v: 'raw' | 'rendered') => write(MODE_KEY, v),
  hideUnchanged: () => read(HIDE_UNCHANGED_KEY) === 'true',
  setHideUnchanged: (v: boolean) => write(HIDE_UNCHANGED_KEY, String(v)),
}
