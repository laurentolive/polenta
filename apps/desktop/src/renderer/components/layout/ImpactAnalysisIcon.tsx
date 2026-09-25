// T174: activity-bar icon for the impact analysis — a checklist sheet with a pencil,
// drawn in the lucide style (24×24 grid, currentColor stroke) to sit with the other icons.
export function ImpactAnalysisIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
      <path d="m7 7.5 1.5 1.5 2.5-2.5" />
      <path d="M13.5 8H15" />
      <path d="m7 12.5 1.5 1.5 2.5-2.5" />
      <path d="M13.5 13H15" />
      <path d="m7 17.5 1.5 1.5 2.5-2.5" />
      <path d="M21.4 12.6a1.4 1.4 0 0 0-2-2l-5.2 5.2a2 2 0 0 0-.5.85l-.7 2.45 2.45-.7a2 2 0 0 0 .85-.5z" />
    </svg>
  )
}
