import { describe, expect, it, vi } from 'vitest'
import { ReleaseCheck, isNewer, versionFromLatestYml } from './release-check'

const github = { provider: 'github' as const, owner: 'o', repo: 'r' }

function fetchReturning(body: unknown, init: { ok?: boolean; status?: number; text?: string } = {}) {
  return vi.fn(async (_url: string, _init?: unknown) => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => init.text ?? '',
  }))
}

describe('GH302 — dernière release (serveur web)', () => {
  it('W1 — comparaison de versions', () => {
    expect(isNewer('1.2.0', '1.1.9')).toBe(true)
    expect(isNewer('1.10.0', '1.9.0')).toBe(true)
    expect(isNewer('1.2.0', '1.2.0-alpha.3')).toBe(true)
    expect(isNewer('1.2.0-alpha.4', '1.2.0-alpha.3')).toBe(true)
    expect(isNewer('1.2.0-alpha.10', '1.2.0-alpha.9')).toBe(true)
    expect(isNewer('1.2.0', '1.2.0')).toBe(false)
    expect(isNewer('1.1.0', '1.2.0')).toBe(false)
    expect(isNewer('1.2.0-alpha.3', '1.2.0')).toBe(false)
    expect(isNewer('v1.3.0', '1.2.0')).toBe(true)
    expect(isNewer('n/a', '1.2.0')).toBe(false)
    expect(isNewer('1.3.0', '0.0.0-dev')).toBe(true)
  })

  it('W1b — version de latest.yml', () => {
    expect(versionFromLatestYml("version: 1.4.0\nfiles:\n  - url: x.exe\n")).toBe('1.4.0')
    expect(versionFromLatestYml("version: '1.4.0'\n")).toBe('1.4.0')
    expect(versionFromLatestYml('files: []\n')).toBeNull()
  })

  it('W2 — release GitHub plus récente : disponible, avec la page de la release', async () => {
    const fetch = fetchReturning({ tag_name: 'v0.3.0', html_url: 'https://github.com/o/r/releases/tag/v0.3.0' })
    const check = new ReleaseCheck('0.2.0', github, undefined, () => {}, fetch)
    await check.check()
    expect(fetch.mock.calls[0]![0]).toBe('https://api.github.com/repos/o/r/releases/latest')
    expect(check.state()).toEqual({
      status: 'available', currentVersion: '0.2.0', availableVersion: '0.3.0',
      releaseUrl: 'https://github.com/o/r/releases/tag/v0.3.0',
    })
  })

  it('W2b — source generic : latest.yml, page des releases de la marque', async () => {
    const fetch = fetchReturning(null, { text: 'version: 0.3.0\n' })
    const check = new ReleaseCheck('0.2.0', { provider: 'generic', url: 'https://dl.example.org/polenta/' }, 'https://example.org/notes', () => {}, fetch)
    await check.check()
    expect(fetch.mock.calls[0]![0]).toBe('https://dl.example.org/polenta/latest.yml')
    expect(check.state()).toMatchObject({ status: 'available', availableVersion: '0.3.0', releaseUrl: 'https://example.org/notes' })
  })

  it('W3 — release identique ou plus ancienne : au repos', async () => {
    const check = new ReleaseCheck('0.3.0', github, undefined, () => {}, fetchReturning({ tag_name: 'v0.3.0' }))
    await check.check()
    expect(check.state()).toEqual({ status: 'idle', currentVersion: '0.3.0' })
  })

  it('W3b — échec réseau : journalisé, résultat précédent conservé', async () => {
    const log = vi.fn()
    const fetch = fetchReturning({ tag_name: 'v0.3.0' })
    const check = new ReleaseCheck('0.2.0', github, undefined, log, fetch)
    await check.check()
    fetch.mockRejectedValueOnce(new Error('offline'))
    await check.check()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('offline'))
    expect(check.state().availableVersion).toBe('0.3.0')
    fetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}), text: async () => '' })
    await check.check()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'))
  })

  it('W4 — marque sans source : aucune requête', async () => {
    const fetch = fetchReturning({ tag_name: 'v9.0.0' })
    const check = new ReleaseCheck('0.2.0', undefined, undefined, () => {}, fetch)
    check.start()
    await check.check()
    expect(fetch).not.toHaveBeenCalled()
    expect(check.state().status).toBe('idle')
  })
})
