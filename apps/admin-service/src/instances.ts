/**
 * GH63 — instances connues de l'hôte, lues dans /opt/polenta/instances/<nom>/instance.env (nom et
 * organisation Forgejo, nécessaires à la revérification du droit « propriétaire »).
 */
import fs from 'node:fs'
import path from 'node:path'
import { readEnvFile } from './config'
import { INSTANCE_RE } from './validators'

export interface InstanceInfo {
  name: string
  org: string
  complete: boolean
}

export function listInstances(root: string): InstanceInfo[] {
  const dir = path.join(root, 'instances')
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: InstanceInfo[] = []
  for (const name of names.sort()) {
    if (!INSTANCE_RE.test(name)) continue
    const env = readEnvFile(path.join(dir, name, 'instance.env'))
    if (!Object.keys(env).length) continue
    out.push({ name, org: env.ORG || name, complete: fs.existsSync(path.join(dir, name, '.add-complete')) })
  }
  return out
}
