/**
 * GH337 — erreurs du git natif (design §3). Le classement lit le stderr de git, lancé en `LC_ALL=C`
 * (messages anglais stables pour une version de git fixée).
 */

export type GitErrorKind =
  | 'not-found'
  | 'conflict'
  | 'local-changes'
  | 'non-fast-forward'
  | 'auth'
  | 'network'
  | 'timeout'
  | 'lock'
  | 'other'

export class GitError extends Error {
  constructor(
    readonly kind: GitErrorKind,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
    /** Code d'origine (ETIMEDOUT…) quand l'erreur vient du processus plutôt que de git. */
    readonly code?: string,
  ) {
    super(`git ${args.filter(a => !a.startsWith('-c')).slice(0, 3).join(' ')} : ${firstLines(stderr) || `code ${exitCode}`}`)
    this.name = 'GitError'
  }
}

function firstLines(s: string): string {
  return s.split(/\r?\n/).filter(l => l.trim()).slice(0, 4).join(' | ')
}

const RULES: [GitErrorKind, RegExp][] = [
  ['lock', /index\.lock': File exists|Unable to create '.*\.lock'|cannot lock ref .*is at .* but expected|Another git process seems to be running/i],
  ['local-changes', /Your local changes to the following files would be overwritten|untracked working tree files would be (overwritten|removed)/i],
  ['conflict', /CONFLICT \(|Automatic merge failed|Merge conflict in/i],
  ['non-fast-forward', /\[rejected\].*\((non-fast-forward|fetch first)\)|Updates were rejected because|Not possible to fast-forward|non-fast-forward/i],
  ['auth', /Authentication failed|could not read Username|could not read Password|HTTP Basic: Access denied|Permission denied \(publickey|returned error: 40[13]|terminal prompts disabled|Invalid username or (password|token)/i],
  ['timeout', /timed out|Operation too slow|Connection timed out/i],
  ['network', /Could not resolve host|Failed to connect|Connection refused|Could not resolve hostname|Network is unreachable|unable to access '.*': (Couldn't|Could not|Recv failure|SSL)|Connection reset|No route to host|Could not read from remote repository|The remote end hung up unexpectedly/i],
  ['not-found', /not a valid object name|unknown revision|bad revision|did not match any file|pathspec '.*' did not match|couldn't find remote ref|Not a valid object name|does not exist|Needed a single revision|repository '.*' not found|not a git repository/i],
]

export function classifyGitError(stderr: string): GitErrorKind {
  for (const [kind, re] of RULES) if (re.test(stderr)) return kind
  return 'other'
}

export function isGitError(err: unknown, kind?: GitErrorKind): err is GitError {
  return err instanceof GitError && (kind === undefined || err.kind === kind)
}
