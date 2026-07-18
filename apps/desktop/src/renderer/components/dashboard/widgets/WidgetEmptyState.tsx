/**
 * Shared empty/placeholder state for the 5 widget renderers (T77 sprint 2) — kept in
 * one place so "0 ligne" (T77-tests.md cas limite) and "mapping incomplet" always
 * look the same across Bar/Pie/Line/Kpi/Table rather than each widget inventing its
 * own wording/markup.
 */
export function WidgetEmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full text-xs text-ink-3 italic px-4 text-center">
      {message}
    </div>
  )
}
