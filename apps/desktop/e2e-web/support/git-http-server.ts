import { spawn, execFileSync } from 'child_process'
import * as http from 'http'
import * as path from 'path'

/**
 * GH44 — serveur git « smart HTTP » local pour les tests e2e : un CGI minimal autour de
 * `git http-backend` (livré avec git). Sert les repos nus de `projectRoot` en clone/fetch/push, sans
 * authentification (`REMOTE_USER` posé pour autoriser le push). Remplace GitHub/Forgejo pendant les
 * tests : Publier pousse ici et le test relit l'historique du repo nu.
 */
export function startGitHttpServer(projectRoot: string, port: number): Promise<http.Server> {
  const backend = path.join(execFileSync('git', ['--exec-path'], { encoding: 'utf-8' }).trim(), 'git-http-backend')

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const child = spawn(backend, [], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: projectRoot,
        GIT_HTTP_EXPORT_ALL: '1',
        REMOTE_USER: 'e2e',
        REQUEST_METHOD: req.method ?? 'GET',
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.replace(/^\?/, ''),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        CONTENT_LENGTH: req.headers['content-length'] ?? '',
        HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
        HTTP_GIT_PROTOCOL: String(req.headers['git-protocol'] ?? ''),
      },
    })
    req.pipe(child.stdin)

    // Sortie CGI : en-têtes, ligne vide, corps.
    let headerBuf = Buffer.alloc(0)
    let headersDone = false
    child.stdout.on('data', (chunk: Buffer) => {
      if (headersDone) {
        res.write(chunk)
        return
      }
      headerBuf = Buffer.concat([headerBuf, chunk])
      const sep = headerBuf.indexOf('\r\n\r\n')
      if (sep < 0) return
      headersDone = true
      let status = 200
      for (const line of headerBuf.subarray(0, sep).toString('latin1').split('\r\n')) {
        const i = line.indexOf(':')
        if (i < 0) continue
        const name = line.slice(0, i).trim()
        const value = line.slice(i + 1).trim()
        if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10)
        else res.setHeader(name, value)
      }
      res.statusCode = status
      res.write(headerBuf.subarray(sep + 4))
    })
    child.stdout.on('end', () => res.end())
    child.stderr.on('data', (d: Buffer) => process.stderr.write(`[git-http] ${d}`))
    child.on('error', (err) => {
      res.statusCode = 500
      res.end(String(err))
    })
  })
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)))
}
