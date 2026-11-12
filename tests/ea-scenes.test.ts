/**
 * The EA scenes' server side (server/ea-scenes.js): MT5 files read as MT5
 * writes them (UTF-16LE reports, ini files and logs), commands recognised,
 * and the state machine — a report's own numbers or "report not found",
 * never an estimate. Fixtures: tests/fixtures/ea (SchoolRun_FIXTURE, a seeded
 * random walk, not a real test).
 */

import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EaScenes, classifyCommand, decodeText, eaReadOnly, isEaRelevant, parseCompileResult, parseTesterReport, readReport,
  reportCandidates, resolveEaConfig, riskTouches, slimPayload, testerSetup, yearsIn, isTickPath, parseNum,
} from '../server/ea-scenes.js'
import { compileLog, fixtureRun, reportHtml, reportXml, testerIni, utf16 } from './fixtures/ea/make-ea-fixtures.mjs'

const FILES = join(__dirname, 'fixtures', 'ea', 'files')
const RUN = fixtureRun()
const temps: string[] = []
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }) })
function tmp() { const d = mkdtempSync(join(tmpdir(), 'ea-scenes-')); temps.push(d); return d }

describe('MT5 files', () => {
  it('reads the HTML report MT5 writes (UTF-16LE with a BOM): its own net profit, max drawdown, trades and balance curve', () => {
    const buf = readFileSync(join(FILES, 'ReportTester-SchoolRun_FIXTURE.htm'))
    expect([buf[0], buf[1]]).toEqual([0xff, 0xfe])
    const r = parseTesterReport(buf)!
    expect(r.netProfit).toBe(RUN.netProfit)
    expect(r.maxDrawdown).toBe(RUN.equityDd)
    expect(r.maxDrawdownPct).toBe(RUN.equityDdPct)
    expect(r.drawdownKind).toBe('equity')
    expect(r.trades).toBe(96)
    expect(r.initialDeposit).toBe(10000)
    expect(r.expert).toBe('SchoolRun_FIXTURE')
    expect(r.symbol).toBe('GER40')
    expect(r.historyQuality).toBe('100% real ticks')
    // The curve is the deals table's balance column, first and last as written
    expect(r.dealCount).toBe(RUN.deals.length)
    expect(r.points[0][1]).toBe(10000)
    expect(r.points[r.points.length - 1][1]).toBe(Math.round((10000 + RUN.netProfit) * 100) / 100)
  })

  it('reads the Excel XML report the same', () => {
    const r = parseTesterReport(readFileSync(join(FILES, 'ReportTester-SchoolRun_FIXTURE.xml')))!
    expect([r.netProfit, r.maxDrawdown, r.trades, r.dealCount]).toEqual([RUN.netProfit, RUN.equityDd, 96, RUN.deals.length])
  })

  it('a report without an equity drawdown gives the balance one, labelled so; anything else stays null', () => {
    const html = reportHtml(RUN).replace(/<tr[^\n]*Equity Drawdown Maximal[^\n]*\n/, m => m.replace(/Equity Drawdown Maximal:/, 'Something Else:'))
    const r = parseTesterReport(html)!
    expect(r.drawdownKind).toBe('balance')
    expect(r.maxDrawdown).toBe(RUN.balanceDd)
    const bare = parseTesterReport('<html><table><tr><td>Total Net Profit:</td><td><b>-250.50</b></td></tr></table></html>')!
    expect(bare.netProfit).toBe(-250.5)
    expect(bare.trades).toBeNull()
    expect(bare.maxDrawdown).toBeNull()
    expect(parseTesterReport('<html>not a report</html>')).toBeNull()
  })

  it('numbers in MT5 and other formats', () => {
    expect(parseNum('12 345.67')).toBe(12345.67)
    expect(parseNum('-1 029.97 (8.63%)')).toBe(-1029.97)
    expect(parseNum('1,234.5')).toBe(1234.5)
    expect(parseNum('1234,56')).toBe(1234.56)
    expect(parseNum('n/a')).toBeNull()
  })

  it('reads the tester ini (UTF-16LE) and a MetaEditor log', () => {
    const ini = testerSetup(decodeText(readFileSync(join(FILES, 'tester-SchoolRun_FIXTURE.ini'))))
    expect(ini).toMatchObject({ symbol: 'GER40', period: 'M15', model: 4, modelName: 'every tick based on real ticks', report: 'ReportTester-SchoolRun_FIXTURE' })
    expect(parseCompileResult(decodeText(readFileSync(join(FILES, 'compile-errors.log'))))).toEqual({ errors: 2, warnings: 1 })
    expect(parseCompileResult(decodeText(readFileSync(join(FILES, 'compile-clean.log'))))).toEqual({ errors: 0, warnings: 1 })
    expect(parseCompileResult('nothing here')).toBeNull()
  })

  it('a relative Report= is looked for in the data folders, the terminal folder, beside the ini and in the reports folder', () => {
    const c = reportCandidates('ReportTester-x', { iniDir: 'C:\\EA', terminalDir: 'C:\\Program Files\\TradeNation MT5', dataDirs: ['C:\\Users\\B\\AppData\\Roaming\\MetaQuotes\\Terminal\\ABC'] })
    expect(c[0]).toBe('C:\\Users\\B\\AppData\\Roaming\\MetaQuotes\\Terminal\\ABC\\ReportTester-x.htm')
    expect(c).toContain('C:\\Program Files\\TradeNation MT5\\ReportTester-x.xml')
    expect(c).toContain('C:\\EA\\ReportTester-x.htm')
    expect(reportCandidates('C:\\R\\x.htm', { iniDir: 'C:\\EA' })).toEqual(['C:\\R\\x.htm'])
  })
})

describe('commands and edits', () => {
  it('knows a tester run, a compile and a tick-data tool on Windows and in Bash', () => {
    expect(classifyCommand('"C:\\Program Files\\TradeNation MT5\\terminal64.exe" /config:"C:\\Users\\Barnesy\\OneDrive\\EA Development\\tester.ini"'))
      .toEqual({ kind: 'backtest', configPath: 'C:\\Users\\Barnesy\\OneDrive\\EA Development\\tester.ini', terminalDir: 'C:\\Program Files\\TradeNation MT5' })
    expect(classifyCommand("& 'C:\\Program Files\\TradeNation MT5\\terminal64.exe' /config:C:\\EA\\t.ini /portable")?.kind).toBe('backtest')
    const c = classifyCommand('"C:\\MT5\\metaeditor64.exe" /compile:"C:\\EA\\School Run.mq5" /log')!
    expect(c).toMatchObject({ kind: 'compile', sourcePath: 'C:\\EA\\School Run.mq5', logPath: 'C:\\EA\\School Run.log', logFlag: true })
    expect(classifyCommand('python tools/dukascopy_ticks.py --symbol GER40 --from 2019 --to 2021')).toEqual({ kind: 'tickdata', years: [2019, 2020, 2021] })
    expect(classifyCommand('Start-Process terminal64.exe')).toBeNull()
    expect(classifyCommand('git status')).toBeNull()
    expect(yearsIn('ticks 2013-2015 and 2019')).toEqual([2013, 2014, 2015, 2019])
    expect(isTickPath('D:\\data\\dukascopy\\GER40\\2020\\01\\00h_ticks.bi5')).toBe(true)
    expect(isTickPath('C:\\EA\\School Run.mq5')).toBe(false)
  })

  it('a risk edit is a pattern match on identifiers: lot sizing, risk, stop-loss (info only)', () => {
    expect(riskTouches('double lots = NormalizeDouble(raw / lotStep, 2);')).toEqual({ categories: ['lot sizing'], terms: ['lots', 'lotStep'] })
    expect(riskTouches('input double InpRiskPercent = 0.75; sl = price - StopLoss * _Point;').categories).toEqual(['risk', 'stop-loss'])
    expect(riskTouches('Print("hello"); int bars = 3;').categories).toEqual([])
    // "slope", "closed", "lottery" are not risk words
    expect(riskTouches('double slope; bool closed; int lottery;').categories).toEqual([])
  })

  it('the watcher sends which risk words an edit touched, never the code', () => {
    const p = { hook_event_name: 'PreToolUse', session_id: 's', tool_use_id: 't', tool_name: 'Edit',
      tool_input: { file_path: 'C:\\EA\\x.mq5', old_string: 'double lots = 1; // SECRET', new_string: 'double lots = 2; // SECRET' } }
    expect(isEaRelevant(p)).toBe(true)
    const slim = slimPayload(p)
    expect(JSON.stringify(slim)).not.toContain('SECRET')
    expect(slim.risk.categories).toEqual(['lot sizing'])
    expect(isEaRelevant({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\x\\notes.md' } })).toBe(false)
    expect(isEaRelevant({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } })).toBe(false)
  })

  it('config: office.config.json ea block, AGENT_OFFICE_EA_REPORTS_DIR wins', () => {
    expect(resolveEaConfig({ ea: { reportsDir: 'C:\\Reports', reportWaitMinutes: 5 } }, {})).toMatchObject({ reportsDir: 'C:\\Reports', reportWaitMinutes: 5, screenMinutes: 10 })
    expect(resolveEaConfig({ ea: { reportsDir: 'C:\\Reports' } }, { AGENT_OFFICE_EA_REPORTS_DIR: '/r' }).reportsDir).toBe('/r')
    expect(resolveEaConfig({}, {}).reportsDir).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The state machine, on a real folder with files written when a run would
// ---------------------------------------------------------------------------

function scene(dir: string, opts: Record<string, unknown> = {}) {
  let now = Date.now()
  const s = new EaScenes({ config: { ...resolveEaConfig({}, {}), ...opts }, now: () => now })
  return { s, advance: (ms: number) => { now += ms; return now }, at: () => now, dir }
}
const pre = (id: string, command: string, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: 'S1', tool_use_id: id, tool_name: 'Bash', tool_input: { command }, ...extra })
const post = (id: string, command: string, out = '') => ({ hook_event_name: 'PostToolUse', session_id: 'S1', tool_use_id: id, tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: out, stderr: '' } })

function testerFiles(dir: string, { report = true } = {}) {
  const ini = join(dir, 'tester.ini')
  const reportPath = join(dir, 'ReportTester-SchoolRun_FIXTURE.htm')
  writeFileSync(ini, utf16(testerIni({ report: reportPath })))
  if (report) writeFileSync(reportPath, utf16(reportHtml(RUN)))
  return { ini, reportPath, cmd: `"/opt/mt5/terminal64.exe" /config:"${ini}"` }
}

describe('backtest station', () => {
  it('lights while the tester runs, then shows the report written for this run (its numbers, exactly)', () => {
    const dir = tmp()
    const { s, advance } = scene(dir)
    const ini = join(dir, 'tester.ini')
    writeFileSync(ini, utf16(testerIni({ report: join(dir, 'ReportTester-SchoolRun_FIXTURE.htm') })))
    const cmd = `"/opt/mt5/terminal64.exe" /config:"${ini}"`
    s.note(pre('t1', cmd))
    expect(s.snapshot().station).toMatchObject({ status: 'running', kind: 'backtest', label: 'testing SchoolRun_FIXTURE.ex5 on GER40 M15', config: { model: 4 } })
    advance(30_000)
    writeFileSync(join(dir, 'ReportTester-SchoolRun_FIXTURE.htm'), utf16(reportHtml(RUN)))
    s.note(post('t1', cmd))
    const snap = s.snapshot()
    expect(snap.station.status).toBe('done')
    expect(snap.station.report).toMatchObject({ netProfit: RUN.netProfit, maxDrawdown: RUN.equityDd, maxDrawdownPct: RUN.equityDdPct, trades: 96 })
    expect(snap.equity?.points.length).toBe(RUN.deals.length)
    expect(snap.equity?.source).toBe('run')
    expect(snap.runs.at(-1)).toMatchObject({ kind: 'backtest', status: 'done', netProfit: RUN.netProfit, trades: 96 })
    expect(snap.ticker.at(-1)?.text).toContain('tester report')
    expect(snap.station.officeId).toBe('main-S1')
  })

  it("an older report is not this run's: report not found (and nothing estimated)", () => {
    const dir = tmp()
    const { s, advance } = scene(dir, { reportWaitMinutes: 0 })
    const { cmd, reportPath } = testerFiles(dir)
    const old = (Date.now() - 3600_000) / 1000
    utimesSync(reportPath, old, old)
    s.note(pre('t1', cmd))
    advance(20_000)
    s.note(post('t1', cmd))
    const st = s.snapshot().station
    expect(st.status).toBe('report-missing')
    expect(st.note).toBe('report not found: only an older report (ReportTester-SchoolRun_FIXTURE.htm)')
    expect(st.report).toBeUndefined()
    expect(s.snapshot().equity).toBeNull()
  })

  it('waits for a report a detached tester writes later, then reads it; gives up after reportWaitMinutes', () => {
    const dir = tmp()
    const { s, advance } = scene(dir, { reportWaitMinutes: 1 })
    const { cmd, reportPath } = testerFiles(dir, { report: false })
    s.note(pre('t1', cmd))
    s.note(post('t1', cmd, ''))
    expect(s.snapshot().station.status).toBe('awaiting-report')
    advance(10_000)
    expect(s.tick()).toBe(false)
    writeFileSync(reportPath, utf16(reportHtml(RUN)))
    expect(s.tick()).toBe(true)
    expect(s.snapshot().station).toMatchObject({ status: 'done', report: { trades: 96 } })

    // A second run whose report never comes
    const { s: s2, advance: adv2 } = scene(dir, { reportWaitMinutes: 1 })
    const other = testerFiles(tmp(), { report: false })
    s2.note(pre('t2', other.cmd))
    s2.note(post('t2', other.cmd))
    adv2(61_000)
    s2.tick()
    expect(s2.snapshot().station).toMatchObject({ status: 'report-missing', note: 'report not found: no report at ReportTester-SchoolRun_FIXTURE.htm' })
  })

  it('a tester call that failed says so; an unreadable ini says which', () => {
    const { s } = scene(tmp())
    const cmd = '"C:\\Program Files\\TradeNation MT5\\terminal64.exe" /config:"C:\\nowhere\\t.ini"'
    s.note(pre('t1', cmd))
    expect(s.snapshot().station.label).toBe('testing the EA')
    s.note({ hook_event_name: 'PostToolUseFailure', session_id: 'S1', tool_use_id: 't1', tool_name: 'Bash', tool_input: { command: cmd }, error: 'Exit code 1\nterminal crashed' })
    expect(s.snapshot().station).toMatchObject({ status: 'failed', note: 'report not found: could not read t.ini', error: 'Exit code 1' })
  })

  it('a run that ends while a newer one is still going does not take the station', () => {
    const dir = tmp()
    const { s, advance } = scene(dir, { reportWaitMinutes: 0 })
    const a = testerFiles(dir, { report: false })
    s.note(pre('old', a.cmd))
    advance(5000)
    s.note(pre('new', a.cmd))
    advance(5000)
    s.note(post('old', a.cmd))
    expect(s.snapshot().station.status).toBe('running')
    expect(s.snapshot().runs.at(-1)).toMatchObject({ status: 'report-missing' })
  })

  it('compile: red on errors (from its log), green on none, unknown without a log', () => {
    const dir = tmp()
    const { s, advance, at } = scene(dir)
    const src = join(dir, 'School Run.mq5')
    const log = join(dir, 'c.log')
    const cmd = `"/opt/mt5/metaeditor64.exe" /compile:"${src}" /log:"${log}"`
    s.note(pre('c1', cmd))
    expect(s.snapshot().station.status).toBe('compiling')
    advance(2000)
    writeFileSync(log, utf16(compileLog({ errors: 2, warnings: 1 })))
    utimesSync(log, at() / 1000, at() / 1000)
    s.note(post('c1', cmd))
    expect(s.snapshot().station).toMatchObject({ status: 'compile-error', compile: { errors: 2, warnings: 1, file: 'School Run.mq5', source: 'log' } })
    advance(2000)
    s.note(pre('c2', cmd))
    advance(2000)
    writeFileSync(log, utf16(compileLog({ errors: 0, warnings: 0 })))
    utimesSync(log, at() / 1000, at() / 1000)
    s.note(post('c2', cmd))
    expect(s.snapshot().station.status).toBe('compile-ok')
    // No /log and no .ex5: unknown, not green
    const bare = `"/opt/mt5/metaeditor64.exe" /compile:"${join(dir, 'Other.mq5')}"`
    s.note(pre('c3', bare))
    s.note(post('c3', bare))
    expect(s.snapshot().station).toMatchObject({ status: 'compile-unknown', note: 'no compile log (/log not given) and no .ex5 written' })
    // ...but a fresh .ex5 means no errors
    s.note(pre('c4', bare))
    writeFileSync(join(dir, 'Other.ex5'), 'x')
    utimesSync(join(dir, 'Other.ex5'), at() / 1000, at() / 1000)
    s.note(post('c4', bare))
    expect(s.snapshot().station).toMatchObject({ status: 'compile-ok', compile: { source: 'ex5' } })
  })
})

describe('screens, cabinets, risk flags', () => {
  it('a .set read and a .mq5 edit put EA screens on that worker; a risk edit raises a flag', () => {
    const { s } = scene(tmp())
    s.note({ hook_event_name: 'PreToolUse', session_id: 'S1', agent_id: 'w1', tool_use_id: 'r1', tool_name: 'Read', tool_input: { file_path: 'C:\\EA\\SchoolRun.set' } })
    s.note({ hook_event_name: 'PreToolUse', session_id: 'S2', tool_use_id: 'e1', tool_name: 'Edit', tool_input: { file_path: 'C:\\EA\\SchoolRun.mq5' }, risk: { categories: ['lot sizing', 'stop-loss'], terms: ['lots', 'sl'] } })
    const snap = s.snapshot({ resolve: (sid: string, aid?: string) => (aid ? `office-${aid}` : `main-${sid}`) })
    expect(snap.screens.map((x: any) => [x.officeId, x.kind, x.file])).toEqual([['office-w1', 'set', 'SchoolRun.set'], ['main-S2', 'mq5', 'SchoolRun.mq5']])
    expect(snap.risk).toHaveLength(1)
    expect(snap.risk[0]).toMatchObject({ officeId: 'main-S2', file: 'SchoolRun.mq5', categories: ['lot sizing', 'stop-loss'] })
  })

  it('a tick-data tool opens cabinets for its years while it runs; they close after', () => {
    const { s, advance } = scene(tmp(), { cabinetMinutes: 1 })
    const cmd = 'python tools/dukascopy_ticks.py --symbol GER40 --from 2019 --to 2021'
    s.note(pre('k1', cmd))
    expect(s.snapshot().cabinets).toEqual([2019, 2020, 2021].map(year => expect.objectContaining({ year, active: true })))
    s.note(post('k1', cmd, 'done'))
    expect(s.snapshot().cabinets.every((c: any) => !c.active)).toBe(true)
    advance(61_000)
    s.tick()
    expect(s.snapshot().cabinets).toEqual([])
  })

  it('read-only connections get file names, not paths', () => {
    const dir = tmp()
    const { s } = scene(dir, { reportsDir: dir })
    const { cmd } = testerFiles(dir)
    s.note(pre('t1', cmd))
    s.note(post('t1', cmd))
    const full = s.snapshot()
    expect(full.station.report.path).toContain(dir)
    const ro = eaReadOnly(full)
    expect(JSON.stringify(ro)).not.toContain(dir)
    expect(ro.station.report.name).toBe('ReportTester-SchoolRun_FIXTURE.htm')
    expect(JSON.stringify(s.snapshot({ trusted: false }))).not.toContain(dir)
  })

  it('the equity wall picks up the newest report in the reports folder', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'older'))
    writeFileSync(join(dir, 'older', 'a.htm'), utf16(reportHtml(fixtureRun({ seed: 3 }), { expert: 'Older_FIXTURE' })))
    const old = (Date.now() - 86400_000) / 1000
    utimesSync(join(dir, 'older', 'a.htm'), old, old)
    writeFileSync(join(dir, 'b.xml'), reportXml(RUN))
    const { s } = scene(dir, { reportsDir: dir })
    expect(s.tick()).toBe(true)
    expect(s.snapshot().equity).toMatchObject({ source: 'folder', name: 'b.xml', netProfit: RUN.netProfit })
    expect(readReport(join(dir, 'nope.htm'))).toBeNull()
  })
})
