import React, { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { ForgeDetection, MachineConfig, PasswordLoginResult } from '@polenta/types'
import { api } from '../api'
import { isWeb } from '../platform'
import { forgeAccessNotices } from '../lib/forgeAccessNotices'
import { useQueryClient } from '@tanstack/react-query'
import { refreshTeamConfig } from '../hooks/useTeamConfig'
import { inviteStore } from '../lib/inviteStore'

export const Route = createFileRoute('/login')({
  component: isWeb ? WebLoginRedirect : LoginPage,
  // GH45 — `server` : serveur pré-rempli (retour depuis la bannière « accès révoqué »).
  // GH45 S2b — `login` : identifiant pré-rempli (lien d'invitation, spec §3ter).
  validateSearch: (search: Record<string, unknown>): { server?: string; login?: string } => ({
    ...(typeof search['server'] === 'string' ? { server: search['server'] } : {}),
    ...(typeof search['login'] === 'string' ? { login: search['login'] } : {}),
  }),
})

/** GH44 — version web : connexion gérée par le serveur (session ; forge OIDC au sprint 3). */
function WebLoginRedirect() {
  useEffect(() => { window.location.replace('/auth/login') }, [])
  return null
}

const COMMON_REMOTES = [
  'https://github.com',
  'https://gitlab.com',
]

type DeviceState = 'idle' | 'waiting' | 'error'
type Detection = { status: 'idle' | 'pending' } | { status: 'done'; value: ForgeDetection } | { status: 'error'; message: string }

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Adresse saisie sans schéma (« acme.forge.example.fr ») : https par défaut. */
function withScheme(input: string): string {
  const v = input.trim()
  if (!v || /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v
  return `https://${v}`
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/** Serveurs proposés : la configuration machine peut masquer GitHub/GitLab et imposer celui de l'entreprise. */
function serverOptions(config: MachineConfig): string[] {
  if (config.hideGithub) return config.defaultServer ? [config.defaultServer] : []
  return [...new Set([...(config.defaultServer ? [config.defaultServer] : []), ...COMMON_REMOTES])]
}

function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const routeSearch = Route.useSearch()
  // GH45 S2b — invitation en cours : paramètres de l'URL, sinon l'invitation gardée en mémoire
  // (une navigation vers /login sans paramètres ne doit pas la perdre).
  const [invite, setInvite] = useState(inviteStore.get())
  useEffect(() => inviteStore.subscribe(setInvite), [])
  const search = {
    server: routeSearch.server ?? invite?.server,
    login: routeSearch.login ?? invite?.login,
  }
  const qc = useQueryClient()
  const [machineConfig, setMachineConfig] = useState<MachineConfig | null>(null)
  const [remote, setRemote] = useState('')
  const [customRemote, setCustomRemote] = useState('')
  const [pat, setPat] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // GH45 — connexion Forgejo/Gitea par identifiant + mot de passe.
  const [detection, setDetection] = useState<Detection>({ status: 'idle' })
  const [usePat, setUsePat] = useState(false)
  const [login, setLogin] = useState(search.login ?? '')
  // Nouvelle invitation alors que l'écran est déjà affiché : identifiant mis à jour.
  useEffect(() => {
    if (search.login) setLogin(search.login)
  }, [search.login])
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpRequested, setOtpRequested] = useState(false)
  // Invitation vers un serveur refusée par la politique DSI (lien ignoré, message affiché).
  const [inviteRejected, setInviteRejected] = useState(false)
  // Compte neuf : mot de passe temporaire à changer sur la forge avant de pouvoir se connecter.
  const [passwordChangeUrl, setPasswordChangeUrl] = useState<string | null>(null)

  const [deviceState, setDeviceState] = useState<DeviceState>('idle')
  const [deviceCode, setDeviceCode] = useState<string | null>(null)
  const [verificationUri, setVerificationUri] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const pollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollGeneration = useRef(0)
  const startingDeviceFlow = useRef(false)

  // Serveurs proposés : la configuration machine peut masquer GitHub/GitLab et imposer le serveur
  // de l'entreprise (spec §3).
  const hideGithub = machineConfig?.hideGithub ?? false
  const defaultServer = machineConfig?.defaultServer
  const options = machineConfig ? serverOptions(machineConfig) : []

  useEffect(() => {
    let cancelled = false
    api.app.getMachineConfig()
      .catch((): MachineConfig => ({ hideGithub: false }))
      .then(config => {
        if (cancelled) return
        setMachineConfig(config)
        // Politique DSI (serveur imposé, GitHub masqué) : une invitation vers un autre serveur est ignorée.
        const policyServer = config.hideGithub && config.defaultServer ? config.defaultServer : null
        const invited = search.server && (!policyServer || sameOrigin(search.server, policyServer)) ? search.server : undefined
        setInviteRejected(Boolean(search.server && !invited))
        const wanted = invited ?? config.defaultServer ?? (config.hideGithub ? '' : COMMON_REMOTES[0])
        if (wanted && serverOptions(config).includes(wanted)) {
          setRemote(wanted)
        } else {
          setRemote('custom')
          setCustomRemote(wanted)
        }
      })
    return () => { cancelled = true }
  }, [search.server])

  const effectiveRemote = remote === 'custom' ? withScheme(customRemote) : remote
  const githubAllowed = !hideGithub
  const provider = detection.status === 'done' ? detection.value.provider : null
  const isGithub = provider === 'github' && githubAllowed
  const isForge = provider === 'forgejo'
  const passwordMode = isForge && !usePat
  // Gitea ne signale pas la 2FA requise (réponse générique) : le champ code est toujours proposé.
  const showOtp = passwordMode && (otpRequested || (detection.status === 'done' && detection.value.flavor === 'gitea'))
  const busy = loading || deviceState === 'waiting'

  // Détection du type de forge à la saisie de l'URL (anti-rebond ; github.com : sans réseau).
  useEffect(() => {
    setOtpRequested(false)
    setOtp('')
    setError(null)
    setPasswordChangeUrl(null)
    if (!isHttpUrl(effectiveRemote)) {
      setDetection({ status: 'idle' })
      return
    }
    let cancelled = false
    setDetection({ status: 'pending' })
    const timer = setTimeout(() => {
      api.auth.detectForge(effectiveRemote)
        .then(value => { if (!cancelled) setDetection({ status: 'done', value }) })
        .catch(err => { if (!cancelled) setDetection({ status: 'error', message: err instanceof Error ? err.message : String(err) }) })
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [effectiveRemote])

  // Bumping the generation makes any in-flight poll's response a no-op once it resolves.
  const clearPolling = () => {
    pollGeneration.current += 1
    if (pollTimeout.current !== null) {
      clearTimeout(pollTimeout.current)
      pollTimeout.current = null
    }
  }

  useEffect(() => clearPolling, [])

  const loggedIn = async (serverUrl: string) => {
    forgeAccessNotices.clear(hostOf(serverUrl))
    inviteStore.clear()
    // GH45 S2b — configuration de l'équipe du compte qui vient de se connecter.
    await refreshTeamConfig(qc)
    await navigate({ to: '/' })
  }

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
          await loggedIn(effectiveRemote)
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

  const passwordError = (result: Exclude<PasswordLoginResult, { status: 'ok' }>): string | null => {
    switch (result.status) {
      case 'otp-required':
        setOtpRequested(true)
        return null
      case 'invalid-otp': return t('login.forge.invalidOtp')
      case 'invalid-credentials':
        return detection.status === 'done' && detection.value.flavor === 'gitea'
          ? t('login.forge.invalidCredentialsGitea')
          : t('login.forge.invalidCredentials')
      case 'account-disabled': return t('login.forge.accountDisabled')
      case 'password-change-required':
        setPasswordChangeUrl(result.url)
        return null
      case 'not-a-forge': return t('login.forge.notAForge')
      case 'network': return result.message
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!effectiveRemote) return
    setLoading(true)
    setError(null)
    try {
      if (passwordMode) {
        if (!login || !password) return
        setPasswordChangeUrl(null)
        const result = await api.auth.loginWithPassword(effectiveRemote, login, password, otp || undefined)
        if (result.status === 'ok') {
          setPassword('')
          await loggedIn(effectiveRemote)
        } else {
          setError(passwordError(result))
        }
        return
      }
      if (!pat) return
      await api.auth.setup(effectiveRemote, pat)
      await loggedIn(effectiveRemote)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  if (!machineConfig) return <div className="min-h-screen bg-canvas" />

  const canSubmit = passwordMode
    ? Boolean(login && password && (!otpRequested || otp))
    : Boolean(pat)

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas">
      <div className="w-full max-w-md bg-surface rounded-xl shadow-sm border border-edge p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t('login.welcome')}</h1>
          <p className="text-sm text-ink-2 mt-1">
            {t('login.subtitle')}
          </p>
        </div>

        {search.server && !inviteRejected && (
          <p className="text-sm text-ink-2 bg-canvas border border-edge rounded px-3 py-2">
            {t('login.forge.invited', { server: search.server })}
          </p>
        )}
        {inviteRejected && (
          <p className="text-sm text-status-danger bg-status-danger-bg border border-status-danger-border rounded px-3 py-2">
            {t('login.forge.inviteRejected', { server: search.server })}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">{t('login.remoteLabel')}</label>
            {hideGithub && defaultServer && remote !== 'custom' ? (
              <p className="input-field w-full bg-canvas text-ink-2 font-mono text-sm">{defaultServer}</p>
            ) : options.length > 0 ? (
              <select value={remote} onChange={e => { setRemote(e.target.value); handleCancelDeviceFlow() }}
                className="input-field w-full" disabled={busy}>
                {options.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
                <option value="custom">{t('login.forge.companyServer')}</option>
              </select>
            ) : null}
            {remote === 'custom' && (
              <input value={customRemote} onChange={e => setCustomRemote(e.target.value)}
                placeholder={t('login.forge.serverPlaceholder')}
                className="input-field w-full mt-2" disabled={busy} />
            )}
            {detection.status === 'pending' && (
              <p className="text-xs text-ink-3 mt-1">{t('login.forge.detecting')}</p>
            )}
            {detection.status === 'error' && (
              <p className="text-xs text-status-danger mt-1">{detection.message}</p>
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

          {passwordMode ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">{t('login.forge.login')}</label>
                <input value={login} onChange={e => setLogin(e.target.value)} autoComplete="username"
                  className="input-field w-full" disabled={busy} autoFocus={!search.login} />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">{t('login.forge.password')}</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password" className="input-field w-full" disabled={busy} autoFocus={!!search.login} />
              </div>
              {showOtp && (
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    {otpRequested ? t('login.forge.otp') : t('login.forge.otpOptional')}
                  </label>
                  <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    inputMode="numeric" autoComplete="one-time-code"
                    className="input-field w-full font-mono tracking-widest" disabled={busy} autoFocus={otpRequested} />
                  {otpRequested && <p className="text-xs text-ink-3 mt-1">{t('login.forge.otpHelp')}</p>}
                </div>
              )}
              {passwordChangeUrl && (
                <div className="rounded border border-status-warning-border bg-status-warning-bg px-3 py-2 space-y-2">
                  <p className="text-sm text-status-warning">{t('login.forge.passwordChangeRequired')}</p>
                  <button type="button" className="btn-secondary btn-sm"
                    onClick={() => void api.auth.openPasswordChange()}>
                    {t('login.forge.changePassword')}
                  </button>
                  <p className="text-xs text-ink-3 break-all font-mono">{passwordChangeUrl}</p>
                </div>
              )}
              <p className="text-xs text-ink-3">{t('login.forge.passwordNotStored')}</p>
              <button type="button" onClick={() => { setUsePat(true); setError(null) }}
                className="text-xs text-ink-2 underline hover:text-ink">
                {t('login.forge.useToken')}
              </button>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                {t('login.patLabel')}
              </label>
              <input type="password" value={pat} onChange={e => setPat(e.target.value)}
                placeholder={isForge ? '' : 'ghp_…'} className="input-field w-full font-mono" disabled={busy} />
              <p className="text-xs text-ink-3 mt-1">
                {isForge ? t('login.forge.patHelp') : t('login.patHelp')}
              </p>
              {isForge && (
                <button type="button" onClick={() => { setUsePat(false); setError(null) }}
                  className="text-xs text-ink-2 underline hover:text-ink mt-1">
                  {t('login.forge.usePassword')}
                </button>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-status-danger bg-status-danger-bg border border-status-danger-border rounded px-3 py-2">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy || !canSubmit || !effectiveRemote || detection.status === 'pending'}
            className="btn-primary w-full">
            {loading ? t('login.connecting') : t('login.submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
