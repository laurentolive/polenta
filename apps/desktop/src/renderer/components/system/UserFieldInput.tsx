import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ForgeMember } from '@polenta/types'
import { api } from '../../api'

/**
 * GH45 S4 — membres de l'organisation propriétaire du repo (spec §7) : chargés une fois par session
 * et par repo (le main les met aussi en cache par organisation). `null`/vide hors ligne, hors
 * Forgejo, repo personnel : la saisie reste du texte libre, sans message.
 */
export function useOrgMembers(repoPath: string | undefined): ForgeMember[] {
  const { data } = useQuery({
    queryKey: ['forge-org-members', repoPath],
    queryFn: () => api.forge.orgMembers(repoPath!),
    enabled: !!repoPath,
    staleTime: Infinity,
    retry: false,
  })
  return data ?? []
}

/** Suggestions `<datalist>` (login, avec le nom affiché) ; rien si la liste est vide. */
export function MemberDatalist({ id, members }: { id: string; members: ForgeMember[] }) {
  if (members.length === 0) return null
  return (
    <datalist id={id}>
      {members.map(m => (
        <option key={m.login} value={m.login}>{m.name !== m.login ? m.name : undefined}</option>
      ))}
    </datalist>
  )
}

interface Props {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  repoPath?: string
  className?: string
  placeholder?: string
  disabled?: boolean
}

/**
 * Champ de type `user` : la valeur enregistrée reste le login, saisi librement ou choisi parmi les
 * membres proposés (format YAML inchangé, spec §7.2).
 */
export function UserFieldInput({ value, onChange, onBlur, repoPath, className, placeholder, disabled }: Props) {
  const listId = useId()
  const members = useOrgMembers(repoPath)
  return (
    <>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        list={members.length > 0 ? listId : undefined}
        autoComplete="off"
        className={className}
        placeholder={placeholder}
      />
      <MemberDatalist id={listId} members={members} />
    </>
  )
}
