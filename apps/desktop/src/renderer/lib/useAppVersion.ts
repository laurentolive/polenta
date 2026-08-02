import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

/** Version applicative (package.json), affichée dans la barre de titre. Ne change jamais en cours de session. */
export function useAppVersion() {
  return useQuery({
    queryKey: ['app:version'],
    queryFn: () => api.app.getVersion(),
    staleTime: Infinity,
  })
}
