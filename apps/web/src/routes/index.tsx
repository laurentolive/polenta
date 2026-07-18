import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { Project } from '@polenta/types'

export const Route = createFileRoute('/')({
  component: ProjectsPage,
})

async function fetchProjects(): Promise<Project[]> {
  const res = await fetch('/api/v1/projects')
  if (!res.ok) throw new Error('Failed to fetch projects')
  return res.json()
}

function ProjectsPage() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  })

  if (isLoading) return <div className="text-muted-foreground">Chargement...</div>

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Projets</h1>
      {projects?.length === 0 && (
        <p className="text-muted-foreground">Aucun projet. Créez votre premier projet.</p>
      )}
      <ul className="space-y-2">
        {projects?.map((p) => (
          <li key={p.id} className="border rounded-lg p-4 hover:bg-muted/50 cursor-pointer">
            <div className="font-medium">{p.name}</div>
            {p.description && <div className="text-sm text-muted-foreground mt-1">{p.description}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}
