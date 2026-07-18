import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen flex flex-col">
      <nav className="border-b px-6 py-3 flex items-center gap-6">
        <span className="font-semibold text-primary">Polenta</span>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground [&.active]:text-foreground">
          Projets
        </Link>
      </nav>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  ),
})
