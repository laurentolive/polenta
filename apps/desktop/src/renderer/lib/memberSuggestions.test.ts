import { describe, expect, it } from 'vitest'
import type { ForgeMemberSuggestion } from '@polenta/types'
import { rankMemberSuggestions } from './memberSuggestions'

/** GH368 — classement des suggestions de membres (specs/GH368-tests.md U-01 à U-07). */

const m = (login: string, orgs: string[], name = login): ForgeMemberSuggestion => ({ login, name, orgs })
const all = [
  m('zoe', ['acme']),
  m('alice', ['beta'], 'Alice'),
  m('carol', ['beta'], 'Carol Martín'),
  m('malika', ['beta']),
  m('kali', ['acme']),
]
const logins = (q: string, opts: Parameters<typeof rankMemberSuggestions>[2] = { exclude: [] }) =>
  rankMemberSuggestions(all, q, opts).map(s => s.login)

describe('rankMemberSuggestions', () => {
  it('U-01 — texte vide ou blanc : aucune suggestion', () => {
    expect(logins('')).toEqual([])
    expect(logins('   ')).toEqual([])
  })

  it('U-02 / U-03 — dans le login ou le nom, sans casse ni accents', () => {
    expect(logins('ali')).toEqual(['alice', 'kali', 'malika'])
    expect(logins('martin')).toEqual(['carol'])
    expect(logins('MARTIN')).toEqual(['carol'])
    expect(logins('martín')).toEqual(['carol'])
  })

  it('U-04 / U-05 — organisation propriétaire d\'abord, puis début du login, puis ordre alphabétique', () => {
    expect(logins('ali', { exclude: [], ownerOrg: 'ACME' })).toEqual(['kali', 'alice', 'malika'])
    expect(logins('a')).toEqual(['alice', 'carol', 'kali', 'malika'])
  })

  it('U-06 — exclus sans tenir compte de la casse', () => {
    expect(logins('ali', { exclude: ['ALICE'] })).toEqual(['kali', 'malika'])
  })

  it('U-07 — 8 suggestions au plus', () => {
    const many = Array.from({ length: 30 }, (_, i) => m(`user${String(i).padStart(2, '0')}`, ['acme']))
    expect(rankMemberSuggestions(many, 'e', { exclude: [] })).toHaveLength(8)
  })
})
