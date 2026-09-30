// Helpers du générateur du workspace de démonstration « lave-linge LL800 ».
// Aucune dépendance hors Node : js-yaml est emprunté à apps/desktop (même version que l'app,
// donc même mise en forme que GitService.writeYaml — pas de churn quand l'app réécrit un fichier).
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(here, '../../apps/desktop/package.json'))
export const yaml = require('js-yaml')

// ─── Fichiers ────────────────────────────────────────────────────────────────

export function writeFile(repoDir, rel, content) {
  const full = path.join(repoDir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

/** Même options que GitService.writeYaml côté app. */
export function writeYaml(repoDir, rel, data) {
  writeFile(repoDir, rel, yaml.dump(data, { lineWidth: 120 }))
}

export function removeFile(repoDir, rel) {
  fs.rmSync(path.join(repoDir, rel), { force: true })
}

// ─── Identifiants déterministes ──────────────────────────────────────────────
// Stables d'une génération à l'autre : régénérer le workspace ne change ni les UUID d'arbre
// ni les IDs de liens/widgets.

export function stableUuid(seed) {
  const h = createHash('sha1').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export function stableSuffix(seed, len = 4) {
  const h = createHash('sha1').update(seed).digest()
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[h[i] % alphabet.length]
  return out
}

// ─── Git (CLI) ───────────────────────────────────────────────────────────────

export function git(repoDir, args, env = {}) {
  return execFileSync('git', args, {
    cwd: repoDir,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function authorEnv(person, isoDate) {
  return {
    GIT_AUTHOR_NAME: person.name,
    GIT_AUTHOR_EMAIL: person.email,
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_NAME: person.name,
    GIT_COMMITTER_EMAIL: person.email,
    GIT_COMMITTER_DATE: isoDate,
  }
}

export function initRepo(repoDir) {
  fs.mkdirSync(repoDir, { recursive: true })
  git(repoDir, ['init', '-q', '-b', 'main'])
  git(repoDir, ['config', 'core.autocrlf', 'false'])
}

/** Commit de tout le working tree ; no-op si rien n'a changé. Retourne vrai si un commit a été créé. */
export function commitAll(repoDir, message, person, isoDate) {
  git(repoDir, ['add', '-A'])
  const status = git(repoDir, ['status', '--porcelain'])
  if (!status) return false
  git(repoDir, ['commit', '-q', '-m', message], authorEnv(person, isoDate))
  return true
}

export function annotatedTag(repoDir, tag, message, person, isoDate) {
  git(repoDir, ['tag', '-a', tag, '-m', message], authorEnv(person, isoDate))
}

export function lightweightTag(repoDir, tag) {
  git(repoDir, ['tag', tag])
}

export function headSha(repoDir) {
  return git(repoDir, ['rev-parse', 'HEAD'])
}

// ─── PNG minimal (sans dépendance) ───────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export class Canvas {
  constructor(w, h, bg = [255, 255, 255]) {
    this.w = w
    this.h = h
    this.px = Buffer.alloc(w * h * 3)
    this.rect(0, 0, w, h, bg)
  }
  set(x, y, c) {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 3
    this.px[i] = c[0]
    this.px[i + 1] = c[1]
    this.px[i + 2] = c[2]
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c)
  }
  frame(x, y, w, h, c, t = 2) {
    this.rect(x, y, w, t, c)
    this.rect(x, y + h - t, w, t, c)
    this.rect(x, y, t, h, c)
    this.rect(x + w - t, y, t, h, c)
  }
  disc(cx, cy, r, c) {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r) this.set(cx + i, cy + j, c)
  }
  ring(cx, cy, r, t, c) {
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const d = i * i + j * j
        if (d <= r * r && d >= (r - t) * (r - t)) this.set(cx + i, cy + j, c)
      }
    }
  }
  line(x0, y0, x1, y1, c, t = 2) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let s = 0; s <= n; s++) {
      const x = x0 + ((x1 - x0) * s) / n
      const y = y0 + ((y1 - y0) * s) / n
      this.rect(Math.round(x - t / 2), Math.round(y - t / 2), t, t, c)
    }
  }
  toPng() {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h)
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0
      this.px.copy(raw, y * (this.w * 3 + 1) + 1, y * this.w * 3, (y + 1) * this.w * 3)
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(this.w, 0)
    ihdr.writeUInt32BE(this.h, 4)
    ihdr[8] = 8 // profondeur
    ihdr[9] = 2 // RGB
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  }
}

// ─── draw.io (mxfile non compressé) ──────────────────────────────────────────

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * nodes: [{ id, label, x, y, w, h, style? }] — `id` = identifiant référençable (`#node-…`).
 * edges: [{ id, source, target, label? }]
 */
export function drawio(name, nodes, edges = []) {
  const cells = [
    '<mxCell id="0" />',
    '<mxCell id="1" parent="0" />',
    ...nodes.map(n =>
      `<mxCell id="${esc(n.id)}" value="${esc(n.label)}" style="${esc(n.style ?? 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;')}" vertex="1" parent="1">` +
      `<mxGeometry x="${n.x}" y="${n.y}" width="${n.w ?? 140}" height="${n.h ?? 60}" as="geometry" /></mxCell>`),
    ...edges.map(e =>
      `<mxCell id="${esc(e.id)}" value="${esc(e.label ?? '')}" style="endArrow=classic;html=1;rounded=0;edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="${esc(e.source)}" target="${esc(e.target)}">` +
      '<mxGeometry relative="1" as="geometry" /></mxCell>'),
  ]
  return `<mxfile host="polenta-demo" agent="generate.mjs" version="24.0.0">
  <diagram id="${esc(stableUuid(name))}" name="${esc(name)}">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">
      <root>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`
}
