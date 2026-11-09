// GH336 — seule l'option globale `DEFAULT_MAX_PENDING` est utilisée (git-lock-limits.ts).
declare module 'async-lock' {
  const AsyncLock: { DEFAULT_MAX_PENDING: number }
  export default AsyncLock
}
