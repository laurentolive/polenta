import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { JUNIT_MESSAGE_MAX, junitKey, parseJunit, parseJunitTimestamp, type JunitResult } from './junit-report.util'

// GH129 — lecture des rapports JUnit (specs/GH129-tests.md, scénarios 1–6).

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'gh129', name), 'utf-8')
const ok = (xml: string, file = 'r.xml'): JunitResult[] => {
  const parsed = parseJunit(xml, file)
  if ('fatal' in parsed) throw new Error(parsed.fatal)
  return parsed
}

describe('parseJunit', () => {
  it('pytest (e2Sim) : verdicts, durée, date de la suite, exigences par testcase', () => {
    const results = ok(fixture('pytest-e2sim.xml'), 'sim32.xml')
    expect(results.map(r => [junitKey(r), r.verdict])).toEqual([
      ['tests.test_system.test_t09_two_firmwares', 'PASS'],
      ['tests.test_system.test_t07_pwm_to_model', 'FAIL'],
      ['tests.test_system.test_fixture', 'BLOCKED'],
      ['tests.test_gui.test_gui', 'SKIPPED'],
    ])
    expect(results[0]).toMatchObject({ file: 'sim32.xml', suite: 'pytest', duration: 4.25, requirements: ['SYS-0001'], executedAt: '2026-11-07T09:15:30.123Z' })
    expect(results[1].requirements).toEqual(['SYS-0002', 'SYS-0003'])
    expect(results[1].message).toMatch(/^AssertionError: heavier load/)
    expect(results[1].message).toContain('value > duty + 150')
    expect(results[2].message).toBe('failed on setup with "RuntimeError: no toolchain"\nRuntimeError: no toolchain <host32>')
    expect(results[3].message).toBe('')
  })

  it('e2Unit : racine testsuite, propriétés de suite, date sans fuseau lue en UTC', () => {
    const results = ok(fixture('e2unit.xml'))
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      classname: 'fan.host', name: 'T01 CRC16 known vectors', verdict: 'PASS', requirements: [],
      executedAt: '2026-11-07T09:00:00.000Z', suiteProperties: [['runner', 'host'], ['hash', 'ab12']],
    })
  })

  it('suites imbriquées : date et propriétés de la suite la plus proche', () => {
    const results = ok(`<testsuites>
      <testsuite name="outer" timestamp="2026-01-01T00:00:00Z">
        <properties><property name="a" value="1"/><property name="b" value="1"/></properties>
        <testsuite name="inner" timestamp="2026-02-01T00:00:00Z">
          <properties><property name="b" value="2"/></properties>
          <testcase name="x"/>
        </testsuite>
        <testcase name="y" time="abc"/>
      </testsuite></testsuites>`)
    expect(results[0]).toMatchObject({ suite: 'inner', executedAt: '2026-02-01T00:00:00.000Z', suiteProperties: [['a', '1'], ['b', '2']] })
    expect(results[1]).toMatchObject({ suite: 'outer', executedAt: '2026-01-01T00:00:00.000Z', duration: 0, classname: '' })
    expect(junitKey(results[1])).toBe('y')
  })

  it('sans timestamp : date absente', () => {
    expect(ok('<testsuite name="s"><testcase name="x"/></testsuite>')[0].executedAt).toBeUndefined()
    expect(parseJunitTimestamp('pas une date')).toBeUndefined()
  })

  it('XML mal formé ou racine inconnue : fatal', () => {
    expect(parseJunit('<testsuite><testcase name="x"></testsuite>', 'r.xml')).toHaveProperty('fatal')
    expect(parseJunit('not xml at all', 'r.xml')).toHaveProperty('fatal')
    expect(parseJunit('<report><testcase name="x"/></report>', 'r.xml')).toHaveProperty('fatal')
  })

  it('BOM UTF-8 en tête ; erreur récupérable (« & » non échappé) : lu', () => {
    expect(ok('﻿<?xml version="1.0" encoding="utf-8"?><testsuite><testcase name="a"/></testsuite>')).toHaveLength(1)
    expect(ok('<testsuite><testcase name="a&b"/></testsuite>')[0].name).toBe('a&b')
  })

  it('message tronqué', () => {
    const long = 'x'.repeat(JUNIT_MESSAGE_MAX + 50)
    const [r] = ok(`<testsuite><testcase name="t"><failure>${long}</failure></testcase></testsuite>`)
    expect(r.message).toHaveLength(JUNIT_MESSAGE_MAX)
    expect(r.message.endsWith('…')).toBe(true)
  })
})
