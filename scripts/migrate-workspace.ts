#!/usr/bin/env tsx
/**
 * migrate-workspace.ts — T69 Sprint 3
 *
 * Migrates a repo using the old submodule-based model to the new workspace model:
 *   1. Reads schema.yaml from the repo root.
 *   2. For each node with a `url` field: generates a dependency entry in polenta-repo.yaml.
 *   3. Removes `url` and `branch` from the nodes in schema.yaml.
 *   4. Writes the updated schema.yaml.
 *   5. Deletes .gitmodules if present.
 *
 * Usage:
 *   tsx scripts/migrate-workspace.ts <repo-path>
 *   tsx scripts/migrate-workspace.ts .
 *
 * The node `name` is used as the dependency mount name in polenta-repo.yaml.
 * No data is lost: objectTypeRef cross-component references continue to work
 * because node names are preserved.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LegacySystemNode {
  name: string
  label: string
  description?: string
  url?: string
  branch?: string
  readonly?: boolean
  objectTypes?: unknown[]
}

interface LegacyProjectSchema {
  version: number
  nodes: LegacySystemNode[]
  linkTypes?: unknown[]
}

interface PolentaRepoDependency {
  name: string
  url: string
  pin: string
}

interface PolentaRepoManifest {
  dependencies: PolentaRepoDependency[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readYaml<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return (yaml.load(raw) as T) ?? null
  } catch {
    return null
  }
}

function writeYaml(filePath: string, data: unknown): void {
  const content = yaml.dump(data, { lineWidth: 120 })
  fs.writeFileSync(filePath, content, 'utf-8')
}

// ── Main ──────────────────────────────────────────────────────────────────────

function migrate(repoPath: string): void {
  const schemaPath = path.join(repoPath, '.polenta', 'schema.yaml')
  const polentaRepoPath = path.join(repoPath, 'polenta-repo.yaml')
  const gitmodulesPath = path.join(repoPath, '.gitmodules')

  // 1. Read schema.yaml
  const schema = readYaml<LegacyProjectSchema>(schemaPath)
  if (!schema) {
    console.error(`[migrate-workspace] ERROR: Could not read ${schemaPath}`)
    process.exit(1)
  }

  // 2. Find nodes with url
  const submoduleNodes = (schema.nodes ?? []).filter(n => n.url)
  if (submoduleNodes.length === 0) {
    console.log('[migrate-workspace] No submodule nodes found. Nothing to migrate.')
    return
  }

  console.log(`[migrate-workspace] Found ${submoduleNodes.length} submodule node(s):`)
  submoduleNodes.forEach(n => console.log(`  - ${n.name}: ${n.url} (branch: ${n.branch ?? 'main'})`))

  // 3. Build polenta-repo.yaml content
  const manifest: PolentaRepoManifest = {
    dependencies: submoduleNodes.map(n => ({
      name: n.name,
      url: n.url!,
      // No commit SHA available from schema.yaml — pin is empty (user must fill)
      pin: n.branch ?? 'main',
    })),
  }

  // Check if polenta-repo.yaml already exists
  const existingManifest = readYaml<PolentaRepoManifest>(polentaRepoPath)
  if (existingManifest) {
    console.warn(`[migrate-workspace] WARNING: ${polentaRepoPath} already exists.`)
    console.warn('  Merging new dependencies (new entries will be appended, existing will be kept).')
    const existingNames = new Set(existingManifest.dependencies.map(d => d.name))
    for (const dep of manifest.dependencies) {
      if (!existingNames.has(dep.name)) {
        existingManifest.dependencies.push(dep)
      } else {
        console.log(`  Skipped existing entry: ${dep.name}`)
      }
    }
    writeYaml(polentaRepoPath, existingManifest)
  } else {
    writeYaml(polentaRepoPath, manifest)
  }
  console.log(`[migrate-workspace] Written: ${polentaRepoPath}`)
  console.log('  NOTE: Pin values are set to branch name (e.g. "main"). Update them to commit SHAs for reproducible builds.')

  // 4. Remove url and branch from nodes in schema.yaml
  const updatedNodes = schema.nodes.map(n => {
    if (!n.url) return n
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { url: _url, branch: _branch, ...rest } = n
    return rest
  })
  const updatedSchema: LegacyProjectSchema = { ...schema, nodes: updatedNodes }
  writeYaml(schemaPath, updatedSchema)
  console.log(`[migrate-workspace] Updated: ${schemaPath} (url/branch fields removed from nodes)`)

  // 5. Remove .gitmodules if present
  if (fs.existsSync(gitmodulesPath)) {
    fs.rmSync(gitmodulesPath)
    console.log(`[migrate-workspace] Deleted: ${gitmodulesPath}`)
  }

  console.log('\n[migrate-workspace] Migration complete.')
  console.log('Next steps:')
  console.log('  1. Review polenta-repo.yaml and update pin values to commit SHAs.')
  console.log('  2. Create a Polenta workspace in the parent directory of this repo.')
  console.log('  3. Open the workspace — Polenta will clone dependencies automatically.')
  console.log('  4. Commit the changes: schema.yaml (modified) + polenta-repo.yaml (new).')
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const repoPath = args[0] ? path.resolve(args[0]) : process.cwd()

if (!fs.existsSync(repoPath)) {
  console.error(`[migrate-workspace] ERROR: Path does not exist: ${repoPath}`)
  process.exit(1)
}

if (!fs.existsSync(path.join(repoPath, '.polenta', 'schema.yaml'))) {
  console.error(`[migrate-workspace] ERROR: No .polenta/schema.yaml found in ${repoPath}`)
  console.error('  This does not appear to be a Polenta repo root.')
  process.exit(1)
}

migrate(repoPath)
