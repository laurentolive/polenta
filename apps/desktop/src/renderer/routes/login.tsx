import React, { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { api } from '../api'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

const COMMON_REMOTES = [
  'https://github.com',
  'https://gitlab.com',
]

type DeviceState = 'idle' | 'waiting' | 'error'

function isGithubRemote(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'github.com'
  } catch {
    return false
  }
}

function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [remote, setRemote] = useState('https://github.com')
  const [customRemote, setCustomRemote] = useState('')
  const [pat, setPat] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [deviceState, setDeviceState] = useState<DeviceState>('idle')
  const [deviceCode, setDeviceCode] = useState<string | null>(null)
  const [verificationUri, setVerificationUri] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const pollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollGeneration = useRef(0)
  const startingDeviceFlow = useRef(false)

  const effectiveRemote = remote === 'custom' ? customRemote : remote
  const isGithub = isGithubRemote(effectiveRemote)
  const busy = loading || deviceState === 'waiting'

  // Bumping the generation makes any in-flight poll's response a no-op once it resolves.
  const clearPolling = () => {
    pollGeneration.current += 1
    if (pollTimeout.current !== null) {
      clearTimeout(pollTimeout.current)
      pollTimeout.current = null
    }
  }

  useEffect(() => clearPolling, [])

  // Self-scheduling: the next poll is only queued once the current one resolves, so no overlap.
  const schedulePoll = (code: string, delayMs: number, generation: number) => {
    pollTimeout.current = setTimeout(async () => {
      const result = await api.auth.pollDeviceFlow(effectiveRemote, code)
      if (generation !== pollGeneration.current) return // cancelled or superseded

      switch (result.status) {
        case 'pending':
          schedulePoll(code, delayMs, generation)
          break
        case 'slow_down':
          schedulePoll(code, result.interval * 1000, generation)
          break
        case 'success':
          pollTimeout.current = null
          navigate({ to: '/' })
          break
        case 'expired':
          pollTimeout.current = null
          setDeviceState('error')
          setDeviceError(t('login.codeExpired'))
          break
        case 'denied':
          pollTimeout.current = null
          setDeviceState('error')
          setDeviceError(t('login.connectionDenied'))
          break
        case 'error':
          pollTimeout.current = null
          setDeviceState('error')
          setDeviceError(result.message)
          break
      }
    }, delayMs)
  }

  const handleStartDeviceFlow = async () => {
    if (startingDeviceFlow.current) return
    startingDeviceFlow.current = true
    setDeviceError(null)
    setDeviceState('waiting')
    clearPolling()
    const generation = pollGeneration.current
    try {
      const session = await api.auth.startDeviceFlow(effectiveRemote)
      setDeviceCode(session.userCode)
      setVerificationUri(session.verificationUri)
      schedulePoll(session.deviceCode, session.interval * 1000, generation)
    } catch (err) {
      setDeviceState('error')
      setDeviceError(err instanceof Error ? err.message : String(err))
    } finally {
      startingDeviceFlow.current = false
    }
  }

  const handleCancelDeviceFlow = () => {
    clearPolling()
    setDeviceState('idle')
    setDeviceCode(null)
    setVerificationUri(null)
    setDeviceError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!effectiveRemote || !pat) return
    setLoading(true)
    setError(null)
    try {
      await api.auth.setup(effectiveRemote, pat)
      await navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas">
      <div className="w-full max-w-md bg-surface rounded-xl shadow-sm border border-edge p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t('login.welcome')}</h1>
          <p className="text-sm text-ink-2 mt-1">
            {t('login.subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">{t('login.remoteLabel')}</label>
            <select value={remote} onChange={e => { setRemote(e.target.value); handleCancelDeviceFlow() }}
              className="input-field w-full" disabled={busy}>
              {COMMON_REMOTES.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
              <option value="custom">{t('login.otherOption')}</option>
            </select>
            {remote === 'custom' && (
              <input value={customRemote} onChange={e => setCustomRemote(e.target.value)}
                placeholder="https://git.example.com"
                className="input-field w-full mt-2" disabled={busy} />
            )}
          </div>

          {isGithub && (
            <div className="space-y-3">
              {deviceState === 'waiting' && deviceCode ? (
                <div className="rounded border border-edge bg-canvas p-4 space-y-2 text-center">
                  <p className="text-xs text-ink-2">{t('login.validateInBrowser')}</p>
                  <p className="text-2xl font-mono tracking-widest text-ink">{deviceCode}</p>
                  {verificationUri && (
                    <p className="text-xs text-ink-3 font-mono break-all">{verificationUri}</p>
                  )}
                  <p className="text-xs text-ink-3">{t('login.waitingValidation')}</p>
                  <button type="button" onClick={handleCancelDeviceFlow}
                    className="text-sm text-ink-2 underline hover:text-ink">
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button type="button" onClick={handleStartDeviceFlow} disabled={busy}
                  className="btn-primary w-full">
                  {t('login.connectWithGithub')}
                </button>
              )}
              {deviceError && (
                <p className="text-sm text-status-danger bg-status-danger-bg border border-status-danger-border rounded px-3 py-2">
                  {deviceError}
                </p>
              )}
              <div className="flex items-center gap-2 text-xs text-ink-3">
                <div className="flex-1 border-t border-edge" />
                {t('common.or')}
                <div className="flex-1 border-t border-edge" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              {t('login.patLabel')}
            </label>
            <input type="password" value={pat} onChange={e => setPat(e.target.value)}
              placeholder="ghp_…" className="input-field w-full font-mono" disabled={busy} />
            <p className="text-xs text-ink-3 mt-1">
              {t('login.patHelp')}
            </p>
          </div>

          {error && (
            <p className="text-sm text-status-danger bg-status-danger-bg border border-status-danger-border rounded px-3 py-2">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy || !pat || !effectiveRemote}
            className="btn-primary w-full">
            {loading ? t('login.connecting') : t('login.submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
