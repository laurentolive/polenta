import { createFileRoute } from '@tanstack/react-router'
import { AdminPage } from '../components/admin/AdminPage'

// GH63 — administration du serveur (version web, propriétaires).
export const Route = createFileRoute('/admin')({
  component: AdminPage,
})
