import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * GH170 — référence stable (identité constante sur toute la vie du composant) qui appelle
 * toujours la dernière version de `fn`. Pour les callbacks passés aux vues Tableau / Document :
 * leurs cellules sont mémoïsées, et un callback recréé à chaque rendu du parent (dépendance à un
 * `useMutation`, closure inline…) les re-rendait toutes à chaque re-rendu de la vue — refetch en
 * arrière-plan compris. À n'utiliser que pour des gestionnaires d'événements, jamais pendant le rendu.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  useLayoutEffect(() => { ref.current = fn })
  return useCallback((...args: A) => ref.current(...args), [])
}
