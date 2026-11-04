import * as fsP from 'fs/promises'
import * as path from 'path'
import yaml from 'js-yaml'

/** GH268 — tags posés par une version figée, abandonnée comprise : tag -> ID. Un tel tag n'est ni une baseline, ni supprimable. */
export async function frozenVersionTags(repoPath: string): Promise<Map<string, string>> {
  const dir = path.join(repoPath, 'versions')
  const files = await fsP.readdir(dir).catch(() => [] as string[])
  const tags = new Map<string, string>()
  await Promise.all(files.filter(f => f.endsWith('.yaml')).map(async f => {
    try {
      const v = yaml.load(await fsP.readFile(path.join(dir, f), 'utf8')) as { id?: string; freeze?: { tag?: string } } | null
      if (v?.freeze?.tag) tags.set(v.freeze.tag, v.id ?? f.replace(/\.yaml$/, ''))
    } catch { /* fichier illisible : signalé par la liste des versions */ }
  }))
  return tags
}

export async function assertNotVersionTag(repoPath: string, tag: string): Promise<void> {
  const id = (await frozenVersionTags(repoPath)).get(tag)
  if (id) throw new Error(`Le tag ${tag} appartient à la version ${id} : il ne se supprime pas.`)
}
