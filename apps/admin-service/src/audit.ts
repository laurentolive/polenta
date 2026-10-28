/**
 * GH63 — journal d'audit (design §6.4) : `/opt/polenta/admin/audit.log`, JSONL, 0600, ouvert en
 * ajout seul. Une ligne `accepted` à la création d'un travail, une ligne de résultat à la fin,
 * `refused` pour tout refus. Jamais purgé.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AuditLine } from '@polenta/types'

export class AuditLog {
  readonly file: string

  constructor(root: string) {
    const dir = path.join(root, 'admin')
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    this.file = path.join(dir, 'audit.log')
  }

  write(line: Omit<AuditLine, 'ts'>): void {
    const full: AuditLine = { ts: new Date().toISOString(), ...line }
    const fd = fs.openSync(this.file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT, 0o600)
    try {
      fs.writeSync(fd, JSON.stringify(full) + '\n')
    } finally {
      fs.closeSync(fd)
    }
  }

  read(filter: { from?: string; instance?: string } = {}): AuditLine[] {
    let text = ''
    try {
      text = fs.readFileSync(this.file, 'utf8')
    } catch {
      return []
    }
    const out: AuditLine[] = []
    for (const raw of text.split('\n')) {
      if (!raw) continue
      let line: AuditLine
      try {
        line = JSON.parse(raw)
      } catch {
        continue
      }
      if (filter.from && line.ts < filter.from) continue
      if (filter.instance && line.actorInstance !== filter.instance && line.target !== filter.instance) continue
      out.push(line)
    }
    return out
  }
}

const CSV_COLUMNS: (keyof AuditLine)[] = ['ts', 'actor', 'actorInstance', 'ip', 'origin', 'operation', 'target', 'params', 'jobId', 'result', 'reason']

export function auditCsv(lines: AuditLine[]): string {
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    // Pas de formule interprétée par un tableur (=, +, -, @ en tête).
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
    return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return [CSV_COLUMNS.join(','), ...lines.map((l) => CSV_COLUMNS.map((c) => cell(l[c])).join(','))].join('\n') + '\n'
}
