/**
 * A project's route id is its workspace directory path, base64url-encoded so
 * it can safely appear as a TanStack Router path/search param.
 */
export function encodeProjectId(workspaceDir: string): string {
  return btoa(unescape(encodeURIComponent(workspaceDir)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function decodeProjectId(id: string): string {
  const padded = id.replace(/-/g, '+').replace(/_/g, '/')
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  return decodeURIComponent(escape(atob(withPadding)))
}
