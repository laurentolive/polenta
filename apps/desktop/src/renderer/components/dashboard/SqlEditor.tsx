/**
 * SqlEditor — raw SQL text area for the "SQL avancé" mode of the Requêtes view
 * (T77 sprint 1). Read-only against the in-memory dataset — the forbidden-
 * statements guard lives server-side in query-engine.service.ts, this is just the
 * input widget.
 */

interface Props {
  value: string
  onChange: (sql: string) => void
}

export function SqlEditor({ value, onChange }: Props) {
  return (
    <div className="space-y-1.5">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="SELECT * FROM requirements WHERE status = 'approved'"
        rows={6}
        spellCheck={false}
        className="input-field w-full font-mono text-xs resize-y"
      />
      <p className="text-[11px] text-ink-3">
        Tables disponibles : <code className="font-mono">requirements</code>, <code className="font-mono">tests</code>, <code className="font-mono">links</code>.
        Lecture seule — INSERT / UPDATE / DELETE / DROP / CREATE / ATTACH sont refusés.
      </p>
    </div>
  )
}
