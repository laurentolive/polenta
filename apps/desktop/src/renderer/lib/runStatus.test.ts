import { describe, expect, it } from 'vitest'
import { isTestRunStatus, worstRunStatus } from './runStatus'

describe('runStatus (GH69)', () => {
  it('pire statut : FAIL > BLOCKED > INCOMPLETE > pending > PASS', () => {
    expect(worstRunStatus(['PASS', 'FAIL', 'BLOCKED'])).toBe('FAIL')
    expect(worstRunStatus(['PASS', 'INCOMPLETE', 'BLOCKED'])).toBe('BLOCKED')
    expect(worstRunStatus(['pending', 'INCOMPLETE'])).toBe('INCOMPLETE')
    expect(worstRunStatus(['PASS', 'pending'])).toBe('pending')
    expect(worstRunStatus(['PASS', 'PASS'])).toBe('PASS')
  })

  it('isTestRunStatus : valeurs exactes uniquement', () => {
    expect(isTestRunStatus('FAIL')).toBe(true)
    expect(isTestRunStatus('pending')).toBe(true)
    expect(isTestRunStatus('fail')).toBe(false)
    expect(isTestRunStatus('toString')).toBe(false)
    expect(isTestRunStatus(null)).toBe(false)
  })
})
