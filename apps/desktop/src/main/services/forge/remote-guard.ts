/**
 * GH44/GH45 — contrôle des URLs contactées par le process (git ET API de forge). Le desktop n'en
 * pose aucun (l'utilisateur contacte ce qu'il veut depuis son poste) ; le serveur web limite les
 * clones/fetch/push et les appels d'API aux hôtes de la forge, pour qu'un utilisateur ne fasse pas
 * interroger un service interne par le serveur (SSRF).
 */
let remoteGuard: ((url: URL) => void) | null = null

export function setRemoteGuard(guard: ((url: URL) => void) | null): void {
  remoteGuard = guard
}

/** Lève une erreur si le garde refuse l'URL. */
export function checkRemote(url: string | URL): void {
  if (remoteGuard) remoteGuard(typeof url === 'string' ? new URL(url) : url)
}
