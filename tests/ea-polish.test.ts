/**
 * ea-polish: the equity wall's pick (automatic with a dwell, or pinned), its
 * caption parts, and the EA Workbench run queue lighting the backtest station
 * (server/ea-workbench.js) — all read from files shaped like Jake's
 * (runqueue\queue.json, campaign pipeline_state.json, MT5 data folder reports),
 * with fixture numbers only.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, utimesSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EaScenes, resolveEaConfig, strategyKey, sameStrategy, periodParts, readReport, eaReadOnly, reportFolder } from '../server/ea-scenes.js'
import { readWorkbench, findWorkbench, FINISHED } from '../server/ea-workbench.js'
import { fixtureRun, reportHtml, reportXml, utf16 } from './fixtures/ea/make-ea-fixtures.mjs'

const temps: string[] = []
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }) })
function tmp() { const d = mkdtempSync(join(tmpdir(), 'ea-polish-')); temps.push(d); return d }

function report(dir: string, name: string, expert: string, seed: number, ageMs = 0) {
  const p = join(dir, name)
  writeFileSync(p, utf16(reportHtml(fixtureRun({ seed }), { expert })))
  const t = (Date.now() - ageMs) / 1000
  utimesSync(p, t, t)
  return p
}

describe('strategy names and periods', () => {
  it('groups builds of one EA, not different EAs', () => {
    expect(strategyKey('BrooksSetupTesterDAX_v024_bad76042')).toBe('brookssetuptesterdax')
    expect(sameStrategy('BrooksSetupTesterDAX_parity_61907080.ex5', 'BrooksSetupTesterDAX_v024_bad76042')).toBe(true)
    expect(sameStrategy('SRS_DAX_Corrected_BlackBull', 'SRSLiveR24A15')).toBe(true)
    expect(sameStrategy('SRS_DAX_Corrected_BlackBull', 'BrooksSetupTesterDAX_v024')).toBe(false)
    expect(strategyKey('EA_BrooksPA_BlackBull')).toBe('ea_brookspa')
  })
  it('splits an MT5 period into timeframe and date range', () => {
    expect(periodParts('M5 (2013.01.01 - 2013.12.31)')).toEqual({ timeframe: 'M5', from: '2013.01.01', to: '2013.12.31' })
    expect(periodParts(null)).toEqual({ timeframe: null, from: null, to: null })
  })
})

describe('equity wall pick', () => {
  function scene(dir: string, opts: Record<string, unknown> = {}) {
    let now = Date.now()
    const pins: Array<string | null> = []
    const s = new EaScenes({ config: { ...resolveEaConfig({}, {}), reportsDir: dir, rescanSeconds: 1, workbench: false, ...opts }, now: () => now, onPin: p => pins.push(p) })
    return { s, pins, advance: (ms: number) => { now += ms } }
  }

  it('shows the newest report, then holds it for the dwell time before switching to a newer one', () => {
    const dir = tmp()
    report(dir, 'a.htm', 'SchoolRun_FIXTURE', 1, 60_000)
    const { s, advance } = scene(dir, { equityDwellMinutes: 10 })
    s.tick()
    expect(s.snapshot().equity).toMatchObject({ name: 'a.htm', pick: 'auto', timeframe: 'M15', from: '2019.01.02', to: '2023.12.29' })
    report(dir, 'b.htm', 'SchoolRun_FIXTURE', 2)
    advance(2000); s.tick()
    const held = s.snapshot().equity
    expect(held.name).toBe('a.htm')
    expect(held.held).toMatchObject({ name: 'b.htm' })
    advance(10 * 60_000); s.tick()
    expect(s.snapshot().equity).toMatchObject({ name: 'b.htm', held: null })
  })

  it('follows the EA being worked on: the newest report of that EA beats a newer one of another', () => {
    const dir = tmp()
    report(dir, 'brooks.htm', 'BrooksSetupTesterDAX_v024_bad76042', 1, 120_000)
    report(dir, 'srs.htm', 'SRS_DAX_Corrected_BlackBull', 2, 1000)
    const { s } = scene(dir)
    s.setFocus('BrooksSetupTesterDAX_parity_61907080.ex5', 'workbench', Date.now())
    s.tick()
    expect(s.snapshot().equity).toMatchObject({ name: 'brooks.htm', source: 'focus', focus: 'BrooksSetupTesterDAX_parity_61907080' })
  })

  it('a pin holds one listed report until set back to automatic; an unlisted path is refused', () => {
    const dir = tmp()
    const a = report(dir, 'a.htm', 'SchoolRun_FIXTURE', 1, 60_000)
    report(dir, 'b.htm', 'SchoolRun_FIXTURE', 2)
    const { s, pins, advance } = scene(dir, { equityDwellMinutes: 0 })
    s.tick()
    expect(s.snapshot().equity.name).toBe('b.htm')
    expect(s.snapshot().equityChoices.map((c: any) => c.name)).toEqual(['b.htm', 'a.htm'])
    expect(s.setPin('/etc/passwd')).toBe(false)
    expect(s.setPin(a)).toBe(true)
    report(dir, 'c.htm', 'SchoolRun_FIXTURE', 3)
    advance(5000); s.tick()
    expect(s.snapshot().equity).toMatchObject({ name: 'a.htm', pick: 'pinned' })
    expect(s.setPin(null)).toBe(true)
    expect(s.snapshot().equity).toMatchObject({ name: 'c.htm', pick: 'auto' })
    expect(pins).toEqual([a, null])
    // Read-only viewers see the choices without paths
    expect(JSON.stringify(eaReadOnly(s.snapshot()))).not.toContain(dir)
  })
})

/** A Workbench like Jake's: runqueue files, two campaigns, the tester's data folder with the case report. */
function workbench({ running = true, ownerAlive = true } = {}) {
  const root = tmp()
  const wb = join(root, 'EAWorkbench')
  const appData = join(root, 'Roaming')
  const T2 = '5E8BFC34636DA7CA71761F67BC68251A'
  const T1 = 'DE601592229B769EB83691237E5B9D7E'
  mkdirSync(join(wb, 'runqueue'), { recursive: true })
  const camp = (name: string) => { const d = join(wb, 'research', 'BST', name); mkdirSync(d, { recursive: true }); return d }
  const done = camp('OnOffT2'), live = camp('SearchT1')
  writeFileSync(join(wb, 'runqueue', 'config.json'), JSON.stringify({ armed: true, installs: { [T1]: { name: 'BlackBull tester' }, [T2]: { name: 'BlackBull tester 2' } } }))
  writeFileSync(join(wb, 'runqueue', 'state.json'), JSON.stringify({ holds: {} }))
  writeFileSync(join(wb, 'runqueue', 'queue.json'), JSON.stringify({ items: [
    { id: 'Q1', test: 'R1802', install: T2, campaign: done, what: 'on/off verification', expert: 'EADevelopment/BST_DAX/BrooksSetupTesterDAX_v024_bad76042.ex5', symbol: 'DAX40', status: 'started', started: '2026-11-12T16:49:02' },
    { id: 'Q2', test: 'R1781', install: T1, campaign: live, what: 'GO139B1 search', expert: 'C:/b/SRS_DAX_Corrected_BlackBull.ex5', symbol: 'DAX40', status: 'started', started: '2026-11-12T14:42:00' },
    { id: 'Q3', test: 'R1783', install: T1, campaign: camp('Next'), what: 'next search', status: 'queued' },
    { id: 'Q4', test: 'R1700', install: T2, campaign: camp('Old'), what: 'dropped', status: 'dropped' },
  ] }))
  writeFileSync(join(done, 'pipeline_state.json'), JSON.stringify({ status: 'REVIEW_REQUIRED', updated: new Date(Date.now() - 60_000).toISOString(), terminal: T2, owner_pid: null, completed: 2, planned: 2, completed_cases: ['BSTDAX_ONOFF_F01', 'BSTDAX_ONOFF_F02'] }))
  writeFileSync(join(live, 'pipeline_state.json'), JSON.stringify({ status: running ? 'NATIVE_OPTIMIZER_RUNNING' : 'STOPPED', updated: new Date(Date.now() - 3600_000).toISOString(), terminal: T1, owner_pid: 2716, completed: 0, planned: 4, completed_cases: [], run: 'GO139B1_FRAC' }))
  const tdir = join(appData, 'MetaQuotes', 'Terminal', T2)
  mkdirSync(tdir, { recursive: true })
  writeFileSync(join(tdir, 'BSTDAX_ONOFF_F02.htm'), utf16(reportHtml(fixtureRun({ seed: 9 }), { expert: 'BrooksSetupTesterDAX_v024_bad76042', symbol: 'DAX40' })))
  const alive = (pid: number) => ownerAlive && pid === 2716
  return { wb, appData, alive, T1, T2, root }
}

describe('EA Workbench run queue', () => {
  it('finds the Workbench only where a run queue is', () => {
    const { wb, root } = workbench()
    expect(findWorkbench(null, join(root))).toBe(wb)
    expect(findWorkbench(null, join(root, 'nope'))).toBeNull()
    expect(findWorkbench(false, root)).toBeNull()
    expect(FINISHED.test('REVIEW_REQUIRED') && !FINISHED.test('NATIVE_OPTIMIZER_RUNNING')).toBe(true)
  })

  it('reads what runs (owner alive, not finished), the queue depth per tester, and the last result from its own report', () => {
    const { wb, appData, alive } = workbench()
    const q = readWorkbench(wb, { appData, alive, readReport })
    expect(q.ok).toBe(true)
    expect(q.running.map((r: any) => [r.test, r.installName, r.completed, r.planned, r.run])).toEqual([['R1781', 'BlackBull tester', 0, 4, 'GO139B1_FRAC']])
    expect(q.queued).toBe(1)
    expect(q.installs.map((i: any) => [i.name, i.running?.test ?? null, i.queued])).toEqual([['BlackBull tester', 'R1781', 1], ['BlackBull tester 2', null, 0]])
    const run = fixtureRun({ seed: 9 })
    expect(q.latest).toMatchObject({ test: 'R1802', lastCase: 'BSTDAX_ONOFF_F02', installName: 'BlackBull tester 2' })
    expect(q.latest.report).toMatchObject({ netProfit: run.netProfit, trades: 96, expert: 'BrooksSetupTesterDAX_v024_bad76042' })
    expect(q.newest).toMatchObject({ test: 'R1802', expert: 'BrooksSetupTesterDAX_v024_bad76042' })
  })

  it('a dead owner is not running; a missing or optimisation report says why, with no number', () => {
    const { wb, appData, T2 } = workbench({ ownerAlive: false })
    const q = readWorkbench(wb, { appData, alive: () => false, readReport })
    expect(q.running).toEqual([])
    rmSync(join(appData, 'MetaQuotes', 'Terminal', T2, 'BSTDAX_ONOFF_F02.htm'))
    expect(readWorkbench(wb, { appData, alive: () => false, readReport }).latest).toMatchObject({ report: null, why: 'no report named BSTDAX_ONOFF_F02 on BlackBull tester 2' })
    writeFileSync(join(appData, 'MetaQuotes', 'Terminal', T2, 'BSTDAX_ONOFF_F02.xml'), '<xml>optimisation passes</xml>')
    expect(readWorkbench(wb, { appData, alive: () => false, readReport }).latest).toMatchObject({ report: null, why: 'BSTDAX_ONOFF_F02.xml is an optimisation (no single result)' })
    expect(readWorkbench(join(wb, 'nope')).ok).toBe(false)
  })

  it('lights the station from the queue when no session runs the tester, and says starts and ends on the ticker', () => {
    const fx = workbench()
    let now = Date.now()
    const s = new EaScenes({ config: { ...resolveEaConfig({}, {}), workbench: fx.wb, appData: fx.appData, rescanSeconds: 1 }, now: () => now,
      readWorkbench: (dir: string) => readWorkbench(dir, { appData: fx.appData, alive: fx.alive, readReport, now }) })
    s.tick()
    const st = s.snapshot().station
    expect(st).toMatchObject({ status: 'running', source: 'workbench', label: 'Workbench R1781 on BlackBull tester · 0/4' })
    expect(st.queue).toMatchObject({ queued: 1, armed: true })
    expect(st.officeId).toBeUndefined()
    // The search ends: the station shows the newest finished run's report
    writeFileSync(join(fx.wb, 'research', 'BST', 'SearchT1', 'pipeline_state.json'), JSON.stringify({ status: 'STOPPED', updated: new Date(now).toISOString(), terminal: fx.T1, completed: 0, planned: 4, completed_cases: [] }))
    now += 2000; s.tick()
    const after = s.snapshot()
    expect(after.station.status).toBe('report-missing')            // the search's own last case has no report
    expect(after.station.note).toMatch(/report not found: no finished case yet/)
    expect(after.ticker.map((t: any) => t.text).join('\n')).toMatch(/R1781 finished|Workbench/)
  })
})

describe('equity picker: one entry per result, and AUTO following the EA being worked on', () => {
  const age = (p: string, ms: number) => { const t = (Date.now() - ms) / 1000; utimesSync(p, t, t) }
  function scene(fx: ReturnType<typeof workbench>, opts: Record<string, unknown> = {}) {
    let now = Date.now()
    const s = new EaScenes({ config: { ...resolveEaConfig({}, {}), reportsDir: join(fx.appData, 'MetaQuotes', 'Terminal'), workbench: fx.wb, appData: fx.appData, rescanSeconds: 1, ...opts }, now: () => now,
      readWorkbench: (dir: string) => readWorkbench(dir, { appData: fx.appData, alive: fx.alive, readReport, now }) })
    return { s, advance: (ms: number) => { now += ms } }
  }
  const term = (fx: ReturnType<typeof workbench>, id: string) => { const d = join(fx.appData, 'MetaQuotes', 'Terminal', id); mkdirSync(d, { recursive: true }); return d }

  it('folds the same run saved as .htm and .xml, and copied to another tester folder, into one choice named by file and tester', () => {
    const fx = workbench()
    const t2 = term(fx, fx.T2), t1 = term(fx, fx.T1)
    const run = fixtureRun({ seed: 9 })
    writeFileSync(join(t2, 'BSTDAX_ONOFF_F02.xml'), reportXml(run, { expert: 'BrooksSetupTesterDAX_v024_bad76042', symbol: 'DAX40' }))
    writeFileSync(join(t1, 'copy.htm'), utf16(reportHtml(run, { expert: 'BrooksSetupTesterDAX_v024_bad76042', symbol: 'DAX40' })))
    age(join(t2, 'BSTDAX_ONOFF_F02.xml'), 1000); age(join(t2, 'BSTDAX_ONOFF_F02.htm'), 2000); age(join(t1, 'copy.htm'), 3000)
    // a different result of the same EA stays its own entry
    writeFileSync(join(t2, 'other.htm'), utf16(reportHtml(fixtureRun({ seed: 4 }), { expert: 'BrooksSetupTesterDAX_v024_bad76042', symbol: 'DAX40' })))
    age(join(t2, 'other.htm'), 60_000)
    const { s } = scene(fx)
    s.tick()
    const choices = s.snapshot().equityChoices
    expect(choices.map((c: any) => [c.file, c.folder, c.also])).toEqual([['BSTDAX_ONOFF_F02.htm', 'BlackBull tester 2', 2], ['other.htm', 'BlackBull tester 2', 0]])
    expect(reportFolder('C:\\x\\Terminal\\0123456789ABCDEF0123\\a.htm')).toEqual({ id: '0123456789ABCDEF0123', name: '012345' })
  })

  it('shows the newest report until the EA being worked on has a finished one, then that, and keeps it over newer reports of other EAs', () => {
    const fx = workbench()
    const t2 = term(fx, fx.T2), t1 = term(fx, fx.T1)
    rmSync(join(t2, 'BSTDAX_ONOFF_F02.htm'))           // the Workbench's newest run (R1802, Brooks) has no report yet
    writeFileSync(join(t1, 'srs1.htm'), utf16(reportHtml(fixtureRun({ seed: 5 }), { expert: 'SRS_DAX_Corrected_BlackBull' })))
    const { s, advance } = scene(fx)
    s.tick()
    expect(s.snapshot().equity).toMatchObject({ name: 'srs1.htm', source: 'folder', focus: 'BrooksSetupTesterDAX_v024_bad76042' })
    // Its report lands: shown after the dwell (it replaces a curve that is not the focus's)
    writeFileSync(join(t2, 'BSTDAX_ONOFF_F02.htm'), utf16(reportHtml(fixtureRun({ seed: 9 }), { expert: 'BrooksSetupTesterDAX_v024_bad76042', symbol: 'DAX40' })))
    advance(2000); s.tick()
    expect(s.snapshot().equity.held).toMatchObject({ name: 'BSTDAX_ONOFF_F02.htm' })
    advance(10 * 60_000); s.tick()
    expect(s.snapshot().equity).toMatchObject({ name: 'BSTDAX_ONOFF_F02.htm', source: 'focus' })
    // A newer report of another EA does not take the wall
    writeFileSync(join(t1, 'srs2.htm'), utf16(reportHtml(fixtureRun({ seed: 6 }), { expert: 'SRS_DAX_Corrected_BlackBull' })))
    advance(11 * 60_000); s.tick()
    expect(s.snapshot().equity).toMatchObject({ name: 'BSTDAX_ONOFF_F02.htm', source: 'focus' })
    expect(s.snapshot().equityChoices.find((c: any) => c.file === 'BSTDAX_ONOFF_F02.htm')).toMatchObject({ focus: true })
  })

  it('finds the focus EA under more than a picker-full of newer reports, and lists it', () => {
    const fx = workbench()
    const t1 = term(fx, fx.T1)
    age(join(fx.appData, 'MetaQuotes', 'Terminal', fx.T2, 'BSTDAX_ONOFF_F02.htm'), 3600_000)
    for (let i = 0; i < 20; i++) { const p = join(t1, `srs${i}.htm`); writeFileSync(p, utf16(reportHtml(fixtureRun({ seed: 20 + i }), { expert: 'SRS_DAX_Corrected_BlackBull' }))); age(p, i * 1000) }
    const { s } = scene(fx)
    s.tick()
    const snap = s.snapshot()
    expect(snap.equity).toMatchObject({ name: 'BSTDAX_ONOFF_F02.htm', source: 'focus' })
    expect(snap.equityChoices).toHaveLength(15)
    expect(snap.equityChoices[14]).toMatchObject({ file: 'BSTDAX_ONOFF_F02.htm', focus: true })
  })
})

describe('AUTO follows a Workbench build whose report names the EA differently (as on Jake\'s PC)', () => {
  it('a report its runs wrote, in their tester folders since they started, is the focus; an older one there is not', () => {
    const fx = workbench()
    const T3 = '287BB2AAAAAAAAAAAAAAAAAAAAAAAAAA', T4 = 'B5ADFFAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const rq = join(fx.wb, 'runqueue')
    writeFileSync(join(rq, 'config.json'), JSON.stringify({ armed: true, installs: { [fx.T1]: { name: 'BlackBull tester' }, [fx.T2]: { name: 'BlackBull tester 2' }, [T3]: { name: 'BlackBull tester 3' }, [T4]: { name: 'BlackBull tester 4' } } }))
    const q = JSON.parse(readFileSync(join(rq, 'queue.json'), 'utf8'))
    const pad = (n: number) => String(n).padStart(2, '0')
    const local = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
    const startedAt = Date.now() - 10 * 60_000
    const expert = 'C:\\Users\\x\\AppData\\Local\\EAWorkbench\\builds\\BPA_LIVE_SDR16\\twin\\BPA\\EA_BrooksPA_BlackBull.ex5'
    for (const [id, test, inst, at] of [['Q10', 'R1803', T3, startedAt], ['Q11', 'R1804', T4, startedAt + 12_000]] as const) {
      const camp = join(fx.wb, 'research', 'BPA', test); mkdirSync(camp, { recursive: true })
      writeFileSync(join(camp, 'pipeline_state.json'), JSON.stringify({ status: 'RUNNING', updated: new Date().toISOString(), terminal: inst, owner_pid: 2716, completed: 1, planned: 40, completed_cases: [] }))
      q.items.push({ id, test, install: inst, campaign: camp, what: 'Brooks Price Action target x stop map', expert, symbol: 'NAS_BB13', status: 'started', started: local(at) })
    }
    writeFileSync(join(rq, 'queue.json'), JSON.stringify(q))
    const dir = (id: string) => { const d = join(fx.appData, 'MetaQuotes', 'Terminal', id); mkdirSync(d, { recursive: true }); return d }
    const write = (p: string, ex: string, seed: number, ago: number) => { writeFileSync(p, utf16(reportHtml(fixtureRun({ seed }), { expert: ex, symbol: 'NAS_BB13' }))); const t = (Date.now() - ago) / 1000; utimesSync(p, t, t) }
    write(join(dir(T4), 'OLD_BEFORE.htm'), 'SomethingElse', 31, 60 * 60_000)        // in the folder, but from before the build started
    write(join(dir(T3), 'BTS_T450_S055.htm'), 'BPASDR16Twin', 32, 4 * 60_000)        // the build's result, under the EA's inner name
    write(join(dir(fx.T2), 'srs_newer.htm'), 'SRS_DAX_Corrected_BlackBull', 33, 1000) // a newer report of another EA
    let now = Date.now()
    const s = new EaScenes({ config: { ...resolveEaConfig({}, {}), reportsDir: join(fx.appData, 'MetaQuotes', 'Terminal'), workbench: fx.wb, appData: fx.appData, rescanSeconds: 1 }, now: () => now,
      readWorkbench: (d: string) => readWorkbench(d, { appData: fx.appData, alive: fx.alive, readReport, now }) })
    s.tick()
    const snap = s.snapshot()
    expect(snap.equity).toMatchObject({ name: 'BTS_T450_S055.htm', source: 'focus', focus: 'EA_BrooksPA_BlackBull', expert: 'BPASDR16Twin' })
    const flag = (f: string) => snap.equityChoices.find((c: any) => c.file === f)
    expect([flag('BTS_T450_S055.htm')?.focus, flag('BTS_T450_S055.htm')?.folder, flag('OLD_BEFORE.htm')?.focus, flag('srs_newer.htm')?.focus]).toEqual([true, 'BlackBull tester 3', false, false])
  })
})
