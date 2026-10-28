/**
 * GH63 — lecture du verrou de l'hôte (design D7). Le verrou est un `flock` sur /opt/polenta/.lock
 * pris par les scripts eux-mêmes (SSH compris). Un processus SSH n'est pas visible depuis le
 * conteneur (autre espace de pid) : on teste donc le verrou par `flock -n` sur le fichier partagé,
 * puis on lit `.lock.owner` pour dire qui le tient.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface LockOwner {
  op: string
  actor: string
  origin: 'ssh' | 'ui'
  pid: number
  since: string
}

export interface LockProbe {
  /** `true` si un processus tient le verrou. */
  held(): boolean
}

/** Sonde réelle : `flock -n -E 75 <fichier> true` → 75 si tenu. */
export class FlockProbe implements LockProbe {
  constructor(private readonly root: string) {}

  held(): boolean {
    const file = path.join(this.root, '.lock')
    if (!fs.existsSync(file)) return false
    const r = spawnSync('flock', ['-n', '-E', '75', file, 'true'], { stdio: 'ignore', timeout: 5000 })
    return r.status === 75
  }
}

export class HostLock {
  constructor(
    private readonly root: string,
    private readonly probe: LockProbe,
  ) {}

  /** Propriétaire courant, ou `null` si le verrou est libre. Un `.lock.owner` périmé est retiré. */
  owner(): LockOwner | null {
    const file = path.join(this.root, '.lock.owner')
    if (!this.probe.held()) {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true })
      return null
    }
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as LockOwner
    } catch {
      return { op: 'inconnue', actor: 'inconnu', origin: 'ssh', pid: 0, since: '' }
    }
  }
}
