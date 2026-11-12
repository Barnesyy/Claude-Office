/**
 * progression-equity.test.ts - demo equity from MT5 account reports
 * (server/progression-equity.js). The report below is a SYNTHETIC sample in
 * the shape of MT5's History → Report → HTML export (UTF-16LE, label cells
 * followed by value cells); the numbers are made up for the test and are not
 * anyone's account. Nothing is ever estimated: no report, no reading.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { htmlText, parseAmount, parseAccountReport, reportFiles, readEquity } from '../server/progression-equity.js'

const SAMPLE = (account: string, equity: string) => `<html><body><table>
<tr><th colspan="2">Trade History Report</th></tr>
<tr><td>Name:</td><td><b>Synthetic Test</b></td></tr>
<tr><td>Account:</td><td><b>${account}</b></td></tr>
<tr><td>Date:</td><td><b>2026.11.12 09:30</b></td></tr>
<tr><td>Balance:</td><td><b>10&nbsp;120.00</b></td><td>Equity:</td><td><b>${equity}</b></td></tr>
<tr><td>Equity Drawdown Maximal:</td><td>99.00</td></tr>
</table></body></html>`

const utf16le = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')])

describe('parsing', () => {
  it('amounts with spaces, commas and minus signs', () => {
    expect(parseAmount('10 234.56')).toBe(10234.56)
    expect(parseAmount('10,234.56')).toBe(10234.56)
    expect(parseAmount('-1 000.00')).toBe(-1000)
    expect(parseAmount('n/a')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
  it('html to cells', () => {
    expect(htmlText('<td>Equity:</td><td><b>1&nbsp;000.00</b></td>')).toBe('Equity:\n1 000.00')
  })
  it('a demo account report reads its equity, balance, login and date', () => {
    expect(parseAccountReport(SAMPLE('5012345 (MetaQuotes-Demo, Hedge)', '10 250.75'))).toEqual({
      equity: 10250.75, balance: 10120, login: '5012345', demo: true, date: '2026.11.12 09:30',
    })
  })
  it('a live account is not demo unless it is listed', () => {
    const live = SAMPLE('7000001 (SomeBroker-Live)', '500.00')
    expect(parseAccountReport(live)?.demo).toBe(false)
    expect(parseAccountReport(live, { demoAccounts: ['7000001'] })?.demo).toBe(true)
  })
  it('a Strategy Tester report is never an account reading', () => {
    expect(parseAccountReport(`<h1>Strategy Tester Report</h1>${SAMPLE('5012345 (MetaQuotes-Demo)', '99 999.00')}`)).toBeNull()
  })
  it('no equity figure, no reading ("Equity Drawdown" is not equity)', () => {
    expect(parseAccountReport('<td>Equity Drawdown Maximal:</td><td>12.00</td><td>Account:</td><td>1234 Demo</td>')).toBeNull()
    expect(parseAccountReport('hello')).toBeNull()
  })
})

describe('readEquity on files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prog-equity-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads UTF-16 reports in a folder, demo only, newest first; ignores other files', () => {
    writeFileSync(join(dir, 'ReportHistory-5012345.html'), utf16le(SAMPLE('5012345 (MetaQuotes-Demo)', '10 300.00')))
    writeFileSync(join(dir, 'ReportHistory-7000001.html'), utf16le(SAMPLE('7000001 (Broker-Live)', '800.00')))
    writeFileSync(join(dir, 'old-demo.htm'), SAMPLE('5012345 (MetaQuotes-Demo)', '10 000.00'))
    writeFileSync(join(dir, 'notes.txt'), 'Equity: 1')
    const old = Date.now() / 1000 - 3600
    utimesSync(join(dir, 'old-demo.htm'), old, old)
    expect(reportFiles([dir]).map(f => f.path).sort()).toHaveLength(3)
    const r = readEquity({ equityReports: [dir] })
    expect(r.map(x => x.equity)).toEqual([10300, 10000])
    expect(r.every(x => x.demo)).toBe(true)
  })

  it('no config, a missing path: no readings', () => {
    expect(readEquity({})).toEqual([])
    expect(readEquity({ equityReports: [join(dir, 'nope')] })).toEqual([])
    expect(readEquity({ equityReports: 'not-a-list' as any })).toEqual([])
  })
})
