/**
 * GH222 — règle de vue d'ensemble (à la manière de VS Code) : une bande verticale le long de la
 * barre de défilement d'un panneau, avec une marque par changement à sa position relative dans le
 * contenu. Un clic sur une marque y fait défiler (`onJump`).
 */

export type RulerTone = 'del' | 'ins' | 'mod' | 'conflict' | 'left' | 'right' | 'resolved'

export interface RulerMark {
  /** Position et hauteur, en fraction de la hauteur totale du contenu (0..1). */
  top: number
  height: number
  tone: RulerTone
}

const TONE: Record<RulerTone, string> = {
  del: 'bg-diff-gutter-del',
  ins: 'bg-diff-gutter-ins',
  mod: 'bg-diff-auto-left',
  conflict: 'bg-diff-conflict',
  left: 'bg-diff-auto-left',
  right: 'bg-diff-auto-right',
  resolved: 'bg-diff-resolved',
}

export function OverviewRuler({ marks, current, onJump, label }: {
  marks: RulerMark[]
  /** Index de la marque courante (navigation), mise en relief. */
  current?: number
  onJump: (index: number) => void
  label: string
}) {
  if (marks.length === 0) return null
  return (
    <div className="absolute right-0 top-0 bottom-0 w-2.5 z-20 border-l border-edge-subtle bg-canvas/60" role="navigation" aria-label={label} data-testid="overview-ruler">
      {marks.map((m, i) => (
        <button
          key={i}
          type="button"
          tabIndex={-1}
          aria-label={`${label} ${i + 1}`}
          onClick={() => onJump(i)}
          className={`absolute left-0.5 right-0.5 rounded-sm cursor-pointer ${TONE[m.tone]} ${i === current ? 'ring-2 ring-ink-2' : 'opacity-80 hover:opacity-100'}`}
          style={{ top: `${Math.min(m.top, 0.997) * 100}%`, height: `max(3px, ${m.height * 100}%)` }}
          data-ruler-mark={m.tone}
        />
      ))}
    </div>
  )
}
