import * as fsP from 'fs/promises'
import * as path from 'path'

export interface LoadedImage {
  data: Buffer
  ext: 'png' | 'jpeg' | 'gif'
  /** Dimensions natives en pixels. */
  width: number
  height: number
}

const REMOTE_TIMEOUT_MS = 10_000
const MAX_BYTES = 10 * 1024 * 1024

/**
 * GH34 sprint 2 — charge une image référencée par un champ richtext : chemin relatif au repo
 * (`images/…`, SPEC-REQ §3.2b), URL `data:` ou `http(s)` (timeout 10 s, 10 Mo max). `null` si
 * l'image est introuvable, illisible ou dans un format que Word n'affiche pas nativement en
 * l'état (SVG, WebP…) — l'appelant insère alors un paragraphe de repli.
 */
export async function loadImage(src: string, repoPath: string): Promise<LoadedImage | null> {
  let data: Buffer | null = null
  try {
    if (src.startsWith('data:')) {
      const m = /^data:[^;,]*;base64,(.*)$/s.exec(src)
      data = m ? Buffer.from(m[1], 'base64') : null
    } else if (/^https?:\/\//i.test(src)) {
      const res = await fetch(src, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        data = buf.length <= MAX_BYTES ? buf : null
      }
    } else {
      const root = path.resolve(repoPath)
      const abs = path.resolve(root, decodeURI(src))
      // Pas de lecture hors du repo depuis un contenu de champ.
      if (abs.startsWith(root + path.sep)) data = await fsP.readFile(abs)
    }
  } catch {
    return null
  }
  return data ? identify(data) : null
}

function identify(data: Buffer): LoadedImage | null {
  // PNG : signature + IHDR (largeur/hauteur big-endian aux octets 16 et 20).
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) {
    return { data, ext: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  }
  // GIF : « GIF8 » + largeur/hauteur little-endian aux octets 6 et 8.
  if (data.length > 10 && data.toString('ascii', 0, 4) === 'GIF8') {
    return { data, ext: 'gif', width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
  }
  // JPEG : premier marqueur SOFn (hors DHT/JPG/DAC) porte hauteur puis largeur.
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let i = 2
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) { i++; continue }
      const marker = data[i + 1]
      const length = data.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { data, ext: 'jpeg', height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) }
      }
      i += 2 + length
    }
  }
  return null
}
