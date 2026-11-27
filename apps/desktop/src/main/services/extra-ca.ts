import * as fs from 'fs'
import * as path from 'path'
import * as tls from 'tls'

/**
 * GH53 — autorité de certification privée de l'entreprise (`caPath` de la config machine).
 *
 * Electron et Node ne lisent pas le magasin Windows : la CA est lue une fois au démarrage
 * (`configureExtraCa`), puis **ajoutée** aux racines publiques de Node pour les appels à la forge
 * (net-proxy) et, dans un bundle combiné, pour git (git-backend). Jamais en remplacement : sinon
 * GitHub et Let's Encrypt cesseraient de fonctionner sur le même poste.
 */

const CERTIFICATE_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g

/** Blocs `BEGIN CERTIFICATE` d'un fichier PEM, un par élément, chacun terminé par un saut de ligne. */
export function parsePemCertificates(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n')
  return (normalized.match(CERTIFICATE_BLOCK) ?? []).map(block => `${block}\n`)
}

export interface LoadExtraCaOptions {
  path: string
  /** Contenu du fichier, `null` s'il n'existe pas (toute autre erreur est levée et rattrapée ici). */
  readFile: (file: string) => string | null
  warn: (message: string) => void
}

/** Certificats de la CA de l'entreprise. Fichier absent, illisible ou sans PEM : avertissement, `[]`. */
export function loadExtraCaCertificates(opts: LoadExtraCaOptions): string[] {
  let text: string | null
  try {
    text = opts.readFile(opts.path)
  } catch (err) {
    opts.warn(`[extra-ca] ${opts.path} illisible, CA de l'entreprise non chargée (${err instanceof Error ? err.message : String(err)})`)
    return []
  }
  if (text === null) {
    opts.warn(`[extra-ca] ${opts.path} introuvable, CA de l'entreprise non chargée`)
    return []
  }
  const pems = parsePemCertificates(text)
  if (pems.length === 0) opts.warn(`[extra-ca] ${opts.path} sans certificat PEM (BEGIN CERTIFICATE), ignoré`)
  return pems
}

let extraPems: readonly string[] = []
let dataDirectory: string | null = null

/** Fixe la CA de l'entreprise pour tout le processus (une fois, au démarrage) et le dossier des fichiers dérivés. */
export function configureExtraCa(config: { pems: readonly string[]; dataDir: string }): void {
  extraPems = [...config.pems]
  dataDirectory = config.dataDir
}

export function extraCaCertificates(): readonly string[] {
  return extraPems
}

/**
 * Options `ca` d'une connexion TLS : toutes les racines de Node **plus** la CA de l'entreprise.
 * `undefined` sans CA, pour que la connexion garde exactement ses réglages d'origine.
 */
export function tlsCaOption(): string[] | undefined {
  return extraPems.length > 0 ? [...tls.rootCertificates, ...extraPems] : undefined
}

/**
 * Bundle CA par défaut du Git for Windows embarqué (PortableGit 2.56.1, `pnpm git:fetch`) : `usr/ssl/…`.
 * Vérifié sur l'archive réelle ; `mingw64/` et `ucrt64/` n'y existent pas.
 */
export const GIT_DEFAULT_BUNDLE_RELATIVE = 'usr/ssl/certs/ca-bundle.crt'

/** Bundle CA par défaut de l'installation git embarquée, `null` si introuvable. */
export function gitDefaultBundle(gitDir: string | null, exists: (file: string) => boolean = fs.existsSync): string | null {
  if (!gitDir) return null
  const candidate = path.join(gitDir, GIT_DEFAULT_BUNDLE_RELATIVE)
  return exists(candidate) ? candidate : null
}

/**
 * Bundle combiné pour git (`http.sslCAInfo` remplace le bundle, il faut donc y mettre les racines
 * publiques de git puis la CA de l'entreprise). `null` sans CA ou sans bundle par défaut ; dans ce
 * dernier cas un avertissement est émis et git garde ses réglages.
 */
export function gitCaBundlePath(defaultBundle: string | null, warn: (message: string) => void): string | null {
  if (extraPems.length === 0) return null
  if (dataDirectory === null) return null
  if (defaultBundle === null) {
    warn(`[extra-ca] bundle CA de git introuvable : la CA de l'entreprise n'est pas transmise à git`)
    return null
  }
  const dest = path.join(dataDirectory, 'ca', 'git-ca-bundle.pem')
  const base = fs.readFileSync(defaultBundle, 'utf-8').replace(/\r\n/g, '\n').replace(/\n*$/, '\n')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, `${base}${extraPems.join('')}`)
  return dest
}
