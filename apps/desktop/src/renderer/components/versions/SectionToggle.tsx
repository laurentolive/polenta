import { ChevronDown, ChevronRight } from 'lucide-react'

/**
 * GH245 / GH439 — en-tête repliable d'une section de la page d'une version : chevron, libellé, compteur
 * facultatif. Le même pour toutes les sections (Informations, Composants, Changements, Analyse d'impact,
 * Tests à exécuter, Exigences).
 */
export function SectionToggle({ open, onToggle, label, count, testId }: {
  open: boolean
  onToggle: () => void
  label: string
  /** Compteur « (n) » ; absent : rien d'affiché (section sans liste, ou liste pas encore chargée). */
  count?: number
  testId: string
}) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-center gap-1 section-label hover:text-ink self-start" data-testid={testId}>
      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      {label}
      {count !== undefined && <span className="font-normal text-ink-3 normal-case">({count})</span>}
    </button>
  )
}
