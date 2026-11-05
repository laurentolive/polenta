import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { findMcpServerPids, parseProcessList, selectMcpServerPids, stopProcesses } from './mcp-server-processes'

const BUNDLE = 'C:\\Users\\Élise\\AppData\\Local\\Programs\\Polenta\\resources\\mcp-server\\index.cjs'
const EXE = 'C:\\Users\\Élise\\AppData\\Local\\Programs\\Polenta\\Polenta.exe'

describe('GH293 — sélection des serveurs MCP', () => {
  it('ne retient que les serveurs de cette installation, jamais les auxiliaires Electron ni soi-même', () => {
    const pids = selectMcpServerPids([
      { pid: 1, commandLine: `${EXE} ${BUNDLE} --repo .` },
      { pid: 2, commandLine: `"${EXE}" --type=renderer --user-data-dir=x` },
      { pid: 3, commandLine: `D:\\Autre\\Polenta.exe D:\\Autre\\resources\\mcp-server\\index.cjs --repo .` },
      { pid: 4, commandLine: `${EXE} ${BUNDLE}` },
    ], BUNDLE, 4)
    expect(pids).toEqual([1])
  })

  it('ignore la casse et le sens des séparateurs de chemin', () => {
    const commandLine = `polenta.exe ${BUNDLE.replace(/\\/g, '/').toUpperCase()} --repo .`
    expect(selectMcpServerPids([{ pid: 7, commandLine }], BUNDLE, 1)).toEqual([7])
  })

  it('lit un tableau, un objet seul, et écarte une ligne sans ligne de commande', () => {
    expect(parseProcessList('[{"pid":1,"commandLine":"a"},{"pid":2,"commandLine":null}]'))
      .toEqual([{ pid: 1, commandLine: 'a' }])
    expect(parseProcessList('{"pid":3,"commandLine":"b"}')).toEqual([{ pid: 3, commandLine: 'b' }])
    expect(parseProcessList('[]')).toEqual([])
  })
})

describe.skipIf(process.platform !== 'win32')('GH293 — vrais processus Windows', () => {
  const children: ChildProcess[] = []
  const dirs: string[] = []

  afterEach(() => {
    for (const child of children.splice(0)) child.kill()
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  async function startScript(dir: string, relative: string): Promise<ChildProcess> {
    const script = path.join(dir, relative)
    fs.mkdirSync(path.dirname(script), { recursive: true })
    fs.writeFileSync(script, 'process.stdout.write("up"); setInterval(() => {}, 1000)')
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'ignore'] })
    children.push(child)
    await new Promise((resolve) => child.stdout!.once('data', resolve))
    return child
  }

  it('trouve le serveur (chemin accentué) et l\'arrête sans toucher au processus voisin', async () => {
    const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'gh293-é-'))
    dirs.push(resources)
    const server = await startScript(resources, 'mcp-server/index.cjs')
    const neighbour = await startScript(resources, 'autre/index.cjs')

    expect(findMcpServerPids(process.execPath, resources)).toEqual([server.pid])

    const exited = new Promise((resolve) => server.once('exit', resolve))
    stopProcesses([server.pid!])
    await exited

    expect(neighbour.exitCode).toBeNull()
    expect(findMcpServerPids(process.execPath, resources)).toEqual([])
  }, 30_000)

  it('un processus déjà terminé ne fait pas échouer l\'arrêt', () => {
    expect(() => stopProcesses([999_999_999])).not.toThrow()
  })
})
