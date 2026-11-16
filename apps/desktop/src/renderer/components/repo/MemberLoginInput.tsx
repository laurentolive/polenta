import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { rankMemberSuggestions } from '../../lib/memberSuggestions'

interface Props {
  accountKey: string
  /** Organisation propriétaire du repo : ses membres sont proposés en premier. */
  ownerOrg?: string
  /** Logins déjà membres ou invités : pas proposés. */
  exclude: string[]
  value: string
  onChange: (value: string) => void
  /** Ajout du login choisi, ou du texte saisi sans sélection. */
  onSubmit: (login: string) => void
  'aria-label': string
  placeholder?: string
  className?: string
}

/**
 * GH368 — champ login d'un membre avec complétion (motif ARIA combobox) sur les membres des
 * organisations du compte (spec §1). La liste est chargée une fois par compte ; la saisie libre
 * reste acceptée, et un échec de chargement ne laisse que la saisie libre, sans message.
 */
export function MemberLoginInput({ accountKey, ownerOrg, exclude, value, onChange, onSubmit, placeholder, className, ...rest }: Props) {
  const { t } = useTranslation()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const { data: all = [] } = useQuery({
    queryKey: ['forge-member-suggestions', accountKey],
    queryFn: () => api.forge.memberSuggestions(accountKey),
    enabled: !!accountKey,
    // Rechargée à la réouverture après 5 min : une liste vide (hors ligne) ou partielle ne reste
    // pas toute la session (spec §1.6) ; le main garde en cache les organisations déjà lues.
    staleTime: 5 * 60_000,
    retry: false,
  })
  const excludeKey = exclude.join('\n')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `exclude` est recréé à chaque rendu : clé stable
  const suggestions = useMemo(() => rankMemberSuggestions(all, value, { ownerOrg, exclude }), [all, value, ownerOrg, excludeKey])
  const shown = open && suggestions.length > 0
  // La liste peut raccourcir sous la sélection (membre ajouté entre-temps) : sélection bornée.
  const selected = shown && active >= 0 && active < suggestions.length ? active : -1
  const optionId = (i: number) => `${listId}-opt-${i}`

  const submit = (login: string) => {
    setOpen(false)
    setActive(-1)
    if (login.trim()) onSubmit(login.trim())
  }

  return (
    <div className="relative flex-1">
      <input
        role="combobox"
        aria-label={rest['aria-label']}
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={selected >= 0 ? optionId(selected) : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        className={className}
        onChange={e => { onChange(e.target.value); setOpen(true); setActive(-1) }}
        onBlur={() => setOpen(false)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const n = suggestions.length
            if (n === 0) return
            // Liste fermée (après Échap) : la rouvre sur la première (↓) ou la dernière (↑) suggestion.
            if (!shown) { setOpen(true); setActive(e.key === 'ArrowDown' ? 0 : n - 1); return }
            setActive(e.key === 'ArrowDown' ? (selected + 1) % n : (selected <= 0 ? n - 1 : selected - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            submit(selected >= 0 ? suggestions[selected].login : value)
          } else if (e.key === 'Escape' && shown) {
            // Ferme la liste seulement : la fenêtre (useModalHotkeys, sur window) reste ouverte.
            e.stopPropagation()
            e.nativeEvent.stopPropagation()
            setOpen(false)
            setActive(-1)
          }
        }}
      />
      {shown && (
        <ul id={listId} role="listbox" aria-label={t('repoWizard.members.suggestions')}
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded border border-edge bg-surface shadow-lg">
          {suggestions.map((s, i) => (
            <li key={s.login} id={optionId(i)} role="option" aria-selected={i === selected}
              className={`flex items-baseline gap-2 px-2 py-1 text-sm cursor-pointer ${i === selected ? 'bg-surface-hover' : ''}`}
              onMouseDown={e => { e.preventDefault(); submit(s.login) }}
              onMouseEnter={() => setActive(i)}>
              <span className="font-medium text-ink">{s.login}</span>
              {s.name !== s.login && <span className="truncate text-ink-2">{s.name}</span>}
              <span className="ml-auto shrink-0 text-xs text-ink-3">{s.orgs.join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
