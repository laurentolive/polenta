/**
 * GH63 — configuration du service d'administration : environnement du conteneur + host.env du kit
 * (ADMIN_INSTANCE, CADDY_MODE, HARDEN_HOST/HOST_MODULES), relu à chaque usage (pas de redémarrage
 * nécessaire après un `polenta-host setup`).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { HostModules } from '@polenta/types'

export interface AdminConfig {
  /** Racine d'état du kit (`/opt/polenta`), montée en volume. */
  root: string
  /** Dossier des scripts du kit dans l'image (`/opt/polenta-kit`). */
  kitDir: string
  listenHost: string
  port: number
  /** Adresse de la forge d'une instance, vue du réseau polenta-admin-net (`{instance}` remplacé). */
  forgeUrlTemplate: string
  hostName: string
  /** Durée de vie du cache « propriétaire » (ms) — jamais utilisé pour une opération destructive. */
  ownerCacheMs: number
  retentionDays: number
  retentionCount: number
  /** Délai maximal d'une lecture exécutée en direct (liste, instantanés, DNS). */
  inlineTimeoutMs: number
  /** Socket de l'agent hôte (ADMIN_AGENT_SOCKET de host.env, monté en lecture seule). */
  agentSocket: string
  /** Délai de retour de l'hôte après un redémarrage demandé (REBOOT_WAIT_MIN). */
  rebootWaitMs: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  return {
    root: env.POLENTA_ROOT || '/opt/polenta',
    kitDir: env.POLENTA_KIT_DIR || '/opt/polenta-kit',
    listenHost: env.POLENTA_ADMIN_HOST || '0.0.0.0',
    port: Number(env.POLENTA_ADMIN_PORT || 8787),
    forgeUrlTemplate: env.POLENTA_ADMIN_FORGE_URL || 'http://forgejo-{instance}:3000',
    hostName: env.POLENTA_HOST_NAME || os.hostname(),
    ownerCacheMs: Number(env.POLENTA_ADMIN_OWNER_CACHE_MS || 60_000),
    retentionDays: 90,
    retentionCount: 200,
    inlineTimeoutMs: Number(env.POLENTA_ADMIN_INLINE_TIMEOUT_MS || 120_000),
    agentSocket: env.POLENTA_AGENT_SOCKET || '/run/polenta/agent.sock',
    rebootWaitMs: Number(env.REBOOT_WAIT_MIN || 15) * 60_000,
  }
}

/** Lecture d'un fichier KEY=valeur du kit (host.env, instance.env), comme `env_get` de common.sh. */
export function readEnvFile(file: string): Record<string, string> {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return {}
  }
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    let value = line.slice(eq + 1)
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    out[line.slice(0, eq).trim()] = value
  }
  return out
}

export interface HostSettings {
  adminInstance: string
  caddyMode: 'managed' | 'external'
  modules: HostModules
}

// Niveaux de durcissement (deploy/lib/modules.sh) ; docker est actif à tous les niveaux.
const LEVEL_MODULES: Record<string, string[]> = {
  full: ['firewall', 'fail2ban', 'unattended', 'ssh-hardening', 'backup-cron', 'fail2ban-forge'],
  basic: ['fail2ban', 'fail2ban-forge', 'unattended', 'backup-cron'],
  none: ['backup-cron'],
}

export function hostSettings(cfg: AdminConfig): HostSettings {
  const env = readEnvFile(path.join(cfg.root, 'host.env'))
  const level = (env.HARDEN_HOST || 'full').trim().toLowerCase()
  const override = (env.HOST_MODULES || '').split(/[\s,]+/).filter(Boolean)
  const active = new Set(override.length ? override : LEVEL_MODULES[level] ?? LEVEL_MODULES.full)
  const modules: HostModules = {
    docker: true,
    firewall: active.has('firewall'),
    fail2ban: active.has('fail2ban'),
    unattended: active.has('unattended'),
    'ssh-hardening': active.has('ssh-hardening'),
    'backup-cron': active.has('backup-cron'),
    'fail2ban-forge': active.has('fail2ban-forge'),
  }
  return {
    adminInstance: env.ADMIN_INSTANCE || '',
    caddyMode: env.CADDY_MODE === 'external' ? 'external' : 'managed',
    modules,
  }
}
