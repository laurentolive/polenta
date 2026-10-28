/**
 * GH63 — catalogue fermé des opérations (design §5.3). Chaque entrée : commande du kit en tableau
 * argv codé en dur (jamais de chaîne shell), paramètres à motif strict, niveau minimal, confirmation,
 * annulation, champs d'audit. Sprint 2 : opérations de base ; actions de l'agent déclarées mais
 * indisponibles tant que l'agent est absent (S3) ; opérations sensibles (S5) absentes du catalogue.
 */
import type { AdminLevel, OperationId } from '@polenta/types'
import type { AgentAction } from '../agent-client'
import { v, type Validator } from '../validators'

export interface ParamDef {
  validate: Validator
  required?: boolean
}

export interface OperationDef {
  id: OperationId
  level: AdminLevel
  /** L'opération vise une instance (cible = instance d'origine au niveau instance). */
  needsInstance: boolean
  /** Prend le verrou de l'hôte (refus 409 si un travail mutant est en cours). */
  mutating: boolean
  /** Revérification du droit sans cache à la création du travail. */
  destructive: boolean
  /** `name` : nom exact de la cible ; `simple` : `true` ou le nom ; `hostname` : nom d'hôte. */
  confirm?: 'name' | 'simple' | 'hostname'
  cancellable: boolean
  /** Action de l'agent hôte qui exécute l'opération (Sprint 3) ; absent = script du kit. */
  agent?: AgentAction
  /** Module de durcissement requis (#62), actif selon l'agent. */
  module?: 'fail2ban' | 'firewall'
  script: 'host' | 'admin'
  params: Record<string, ParamDef>
  /** Paramètres recopiés dans l'audit (liste blanche ; le reste n'est jamais écrit). */
  audit: string[]
  /** Refus « instance d'exploitation / client web courant » (code 18, design §6.6). */
  selfGuard?: 'self-target'
  /** Chemins du résultat déplacés vers le secret à usage unique (`GET /jobs/:id/secret`). */
  oneTime?: string[][]
  /** Étapes affichées au suivi (indicatives, mises à jour par le runner). */
  steps?: string[]
  argv(target: string | null, p: Record<string, unknown>): string[]
}

const s = (x: unknown) => String(x)

const OPS: OperationDef[] = [
  {
    id: 'instance.list',
    level: 'instance',
    needsInstance: false,
    mutating: false,
    destructive: false,
    cancellable: true,
    script: 'host',
    params: {},
    audit: [],
    argv: () => ['instance', 'list'],
  },
  {
    id: 'instance.add',
    level: 'host',
    needsInstance: false,
    mutating: true,
    destructive: false,
    cancellable: false,
    script: 'host',
    params: {
      name: { validate: v.instance, required: true },
      domain: { validate: v.domain },
      org: { validate: v.org },
      version: { validate: v.version },
      appName: { validate: v.appName },
      clientAdminLogin: { validate: v.login },
      clientAdminEmail: { validate: v.email },
      demo: { validate: v.bool },
    },
    audit: ['name', 'domain', 'org', 'version', 'clientAdminLogin', 'demo'],
    oneTime: [['clientAdmin', 'temporaryPassword']],
    steps: ['dns', 'image', 'forge', 'organisation', 'sauvegarde'],
    argv: (_t, p) => {
      const a = ['instance', 'add', s(p.name)]
      if (p.domain) a.push('--domain', s(p.domain))
      if (p.org) a.push('--org', s(p.org))
      if (p.version) a.push('--version', s(p.version))
      if (p.appName) a.push('--app-name', s(p.appName))
      if (p.clientAdminLogin && p.clientAdminEmail) a.push('--client-admin', s(p.clientAdminLogin), s(p.clientAdminEmail))
      if (p.demo === false) a.push('--no-demo')
      return a
    },
  },
  {
    id: 'instance.stop',
    level: 'instance',
    needsInstance: true,
    mutating: true,
    destructive: true,
    confirm: 'simple',
    cancellable: false,
    script: 'host',
    params: {},
    audit: [],
    selfGuard: 'self-target',
    argv: (t) => ['instance', 'stop', s(t)],
  },
  {
    id: 'instance.start',
    level: 'instance',
    needsInstance: true,
    mutating: true,
    destructive: false,
    cancellable: false,
    script: 'host',
    params: {},
    audit: [],
    argv: (t) => ['instance', 'start', s(t)],
  },
  {
    id: 'instance.sync',
    level: 'instance',
    needsInstance: true,
    mutating: true,
    destructive: false,
    cancellable: false,
    script: 'host',
    params: {},
    audit: [],
    argv: (t) => ['instance', 'sync', s(t)],
  },
  {
    id: 'instance.remove',
    level: 'host',
    needsInstance: true,
    mutating: true,
    destructive: true,
    confirm: 'name',
    cancellable: false,
    script: 'host',
    params: {},
    audit: [],
    selfGuard: 'self-target',
    steps: ['export', 'arrêt', 'suppression'],
    argv: (t) => ['instance', 'remove', s(t), '--confirm', s(t)],
  },
  {
    id: 'forge.update',
    level: 'instance',
    needsInstance: true,
    mutating: true,
    destructive: false,
    cancellable: false,
    script: 'host',
    params: { version: { validate: v.version, required: true } },
    audit: ['version'],
    steps: ['sauvegarde pre-update', 'image', 'redémarrage', 'contrôle'],
    argv: (t, p) => ['instance', 'update', s(t), '--version', s(p.version)],
  },
  {
    id: 'backup.run',
    level: 'instance',
    needsInstance: true,
    mutating: true,
    destructive: false,
    cancellable: true,
    script: 'host',
    params: { tag: { validate: v.tag } },
    audit: ['tag'],
    argv: (t, p) => ['instance', 'backup', s(t), '--tag', p.tag ? s(p.tag) : 'manual'],
  },
  {
    id: 'backup.list',
    level: 'instance',
    needsInstance: true,
    mutating: false,
    destructive: false,
    cancellable: true,
    script: 'host',
    params: {},
    audit: [],
    argv: (t) => ['instance', 'snapshots', s(t)],
  },
  {
    id: 'dns.check',
    level: 'instance',
    needsInstance: false,
    mutating: false,
    destructive: false,
    cancellable: true,
    script: 'host',
    params: { domain: { validate: v.domain, required: true } },
    audit: ['domain'],
    argv: (_t, p) => ['dns', 'check', s(p.domain)],
  },
  {
    id: 'web.enable',
    level: 'instance',
    needsInstance: true,
    mutating: true,
    destructive: false,
    cancellable: false,
    script: 'host',
    params: { domain: { validate: v.domain }, version: { validate: v.version } },
    audit: ['domain', 'version'],
    argv: (t, p) => {
      const a = ['instance', 'web', 'enable', s(t)]
      if (p.domain) a.push('--domain', s(p.domain))
      if (p.version) a.push('--version', s(p.version))
      return a
    },
  },
  {
    id: 'web.disable',
    level: 'instance',
    needsInstance: true,
    mutating: true,
    destructive: false,
    cancellable: false,
    script: 'host',
    params: {},
    audit: [],
    selfGuard: 'self-target',
    argv: (t) => ['instance', 'web', 'disable', s(t)],
  },
  // Actions de l'agent hôte (Sprint 3) : niveau hôte, exécutées par le socket de l'agent (503 s'il est
  // absent), refusées si le module requis n'est pas actif (#62 : aucune installation implicite).
  ...(
    [
      ['host.setup', true, false, undefined],
      ['fail2ban.status', false, false, 'fail2ban'],
      ['fail2ban.unban', true, false, 'fail2ban'],
      ['firewall.status', false, false, 'firewall'],
      ['host.reboot', true, true, undefined],
    ] as const
  ).map(
    ([id, mutating, destructive, module]): OperationDef => ({
      id,
      level: 'host',
      needsInstance: false,
      mutating,
      destructive,
      confirm: id === 'host.reboot' ? 'hostname' : undefined,
      // Actions brèves (fail2ban, ufw) ou non interruptibles (setup, redémarrage) : pas d'annulation.
      cancellable: false,
      agent: id,
      module,
      script: 'host',
      params: id === 'fail2ban.unban' ? { ip: { validate: v.ip, required: true } } : id === 'host.setup' ? { sshHardeningConfirmed: { validate: v.bool } } : {},
      audit: id === 'fail2ban.unban' ? ['ip'] : id === 'host.setup' ? ['sshHardeningConfirmed'] : [],
      argv: () => [],
    }),
  ),
]

export const REGISTRY: ReadonlyMap<string, OperationDef> = new Map(OPS.map((o) => [o.id, o]))

export type ParamCheck = { ok: true; params: Record<string, unknown> } | { ok: false; field: string }

/** Paramètres validés : champ inconnu, absent obligatoire ou hors motif = refus (rien n'est exécuté). */
export function checkParams(def: OperationDef, raw: unknown): ParamCheck {
  const input = raw ?? {}
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, field: 'params' }
  const params: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const p = def.params[key]
    if (!p) return { ok: false, field: key }
    if (value === undefined || value === null || value === '') continue
    if (!p.validate(value)) return { ok: false, field: key }
    params[key] = value
  }
  for (const [key, p] of Object.entries(def.params)) {
    if (p.required && params[key] === undefined) return { ok: false, field: key }
  }
  return { ok: true, params }
}

/** Confirmation attendue : `name` exige la chaîne exacte (jamais `true`). */
export function checkConfirm(def: OperationDef, confirm: unknown, expected: string): boolean {
  switch (def.confirm) {
    case undefined:
      return true
    case 'simple':
      return confirm === true || confirm === expected
    case 'name':
    case 'hostname':
      return typeof confirm === 'string' && confirm === expected
  }
}

export function pickAudit(def: OperationDef, params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of def.audit) if (params[k] !== undefined) out[k] = params[k]
  return out
}
