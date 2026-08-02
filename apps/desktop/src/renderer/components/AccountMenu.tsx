import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { api } from '../api'

interface Identity {
  login: string
  name: string
  email: string
  remote: string
}

const KNOWN_REMOTES = [
  'https://github.com',
  'https://gitlab.com',
]

export function AccountMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      for (const remote of KNOWN_REMOTES) {
        try {
          const token = await api.auth.getToken(remote)
          if (!token) continue
          const id = await api.auth.resolveIdentity(remote)
          setIdentity({ ...id, remote })
          return
        } catch {
          // try next remote
        }
      }
    }
    load()
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function handleLogout() {
    setOpen(false)
    if (identity) {
      try {
        await api.auth.deleteToken(identity.remote)
      } catch {
        // best-effort
      }
    }
    await navigate({ to: '/login' })
  }

  function handleChangeAccount() {
    setOpen(false)
    navigate({ to: '/login' })
  }

  const label = identity ? identity.login : t('account.menu.defaultLabel')

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-sm px-3 py-1.5 rounded hover:bg-hover border border-edge text-ink"
      >
        {label}
        <span className="text-xs text-ink-3">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-surface border border-edge rounded-lg shadow-lg z-50">
          {identity && (
            <div className="px-4 py-3 border-b border-edge">
              <p className="text-sm font-medium text-ink">{identity.name}</p>
              {identity.email && (
                <p className="text-xs text-ink-3 mt-0.5">{identity.email}</p>
              )}
              <p className="text-xs text-ink-3 mt-0.5">{identity.remote}</p>
            </div>
          )}
          <div className="py-1">
            <button
              type="button"
              onClick={handleChangeAccount}
              className="w-full text-left px-4 py-2 text-sm text-ink hover:bg-hover"
            >
              {t('common.changeAccount')}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full text-left px-4 py-2 text-sm text-status-danger hover:bg-hover"
            >
              {t('common.logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
