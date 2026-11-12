/**
 * The EA scenes end to end: a fixture EA session's transcript (it reads a
 * .set, edits lot sizing, compiles with errors and clean, pulls tick data,
 * runs the tester) -> TranscriptWatcher -> slimPayload -> POST /ea/payload
 * (bearer token, like scripts/transcript-watch.mjs) -> `ea_state` on the
 * WebSocket: the report's own numbers on a trusted page, file names but no
 * paths on a read-only one.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import request from 'supertest'
import WebSocket from 'ws'
import { loadOffice, removeOffice, postAuthed, listen, officeProtocols, type Office } from './helpers'
import { TranscriptWatcher, resolveTranscriptConfig, createJsConverter } from '../server/transcript-source.js'
import { isEaRelevant, slimPayload } from '../server/ea-scenes.js'
import { eaSessionRecords } from './fixtures/ea/make-ea-fixtures.mjs'

let office: Office | undefined
const temps: string[] = []
afterAll(async () => {
  office?.server.httpServer.close()
  removeOffice(office)
  for (const d of temps) rmSync(d, { recursive: true, force: true })
})

const enc = (p: string) => p.replace(/[^A-Za-z0-9]/g, '-')

describe('EA session -> watcher -> /ea/payload -> WebSocket', () => {
  it('shows the tester report numbers, the compile result, tick cabinets, screens and the risk flag', async () => {
    office = await loadOffice()
    const { server } = office
    const port = await listen(server.httpServer)

    // A trusted page and a read-only one
    const open = (protocols?: string[]) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, protocols)
      const got: any[] = []
      ws.on('message', d => { try { got.push(JSON.parse(String(d))) } catch {} })
      return { ws, got, ready: new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) }) }
    }
    const trusted = open(officeProtocols(server))
    const readOnly = open()
    await Promise.all([trusted.ready, readOnly.ready])

    // The EA folder and the transcript, written as a real session would leave them
    const root = mkdtempSync(join(tmpdir(), 'ea-office-'))
    temps.push(root)
    const ea = join(root, 'EA Development')
    const projects = join(root, 'projects')
    const { records, setup, files, run } = eaSessionRecords(ea)
    for (const f of [...setup, ...records.flatMap(r => r.writes ?? [])]) { mkdirSync(dirname(f.path), { recursive: true }); writeFileSync(f.path, f.data) }
    const t0 = Date.now() - 60_000
    const sessionId = records[0].record.sessionId
    const transcript = join(projects, enc(files.ea), `${sessionId}.jsonl`)
    mkdirSync(dirname(transcript), { recursive: true })
    writeFileSync(transcript, records.map(r => JSON.stringify({ ...r.record, timestamp: new Date(t0 + r.at * 1000).toISOString() })).join('\n') + '\n')

    const config = resolveTranscriptConfig({ transcripts: { dir: projects, onlyListed: false } }, {})
    const sent: number[] = []
    const batch: any[] = []
    const w = new TranscriptWatcher({
      config, converter: createJsConverter(), fromStart: true, log: { log() {}, warn() {}, error() {} },
      sink: async () => {},
      onPayload: (p: any) => { if (isEaRelevant(p)) batch.push(slimPayload(p)) },
    })
    w.tick()
    await w.flush()
    expect(batch.length).toBeGreaterThan(8)
    // The edit's code never leaves the watcher
    expect(JSON.stringify(batch)).not.toContain('MathFloor')
    const res = await postAuthed(server, '/ea/payload', { payloads: batch })
    sent.push(res.status)
    // Without the token: refused
    const refused = await request(server.app).post('/ea/payload').send({ payloads: batch })
    expect(refused.status).toBe(401)
    await new Promise(r => setTimeout(r, 200))
    trusted.ws.close(); readOnly.ws.close()

    expect(sent).toEqual([200])
    const states = trusted.got.filter(m => m.type === 'ea_state').map(m => m.ea)
    expect(states.length).toBeGreaterThan(3)
    // Along the way: compile red, then green
    expect(states.some(s => s.station.status === 'compile-error' && s.station.compile.errors === 2)).toBe(true)
    expect(states.some(s => s.station.status === 'compile-ok')).toBe(true)
    expect(states.some(s => s.station.status === 'running')).toBe(true)
    const last = states.at(-1)
    expect(last.station).toMatchObject({ status: 'done', kind: 'backtest', officeId: `main-${sessionId}` })
    expect(last.station.report).toMatchObject({ netProfit: run.netProfit, maxDrawdown: run.equityDd, trades: run.trades, path: files.report })
    expect(last.equity.points.length).toBe(run.deals.length)
    expect(last.cabinets.map((c: any) => c.year)).toEqual([2019, 2020, 2021, 2022, 2023])
    expect(last.risk[0]).toMatchObject({ officeId: `main-${sessionId}`, file: 'SchoolRun_FIXTURE.mq5' })
    expect(last.risk[0].categories).toContain('lot sizing')
    expect(last.screens[0]).toMatchObject({ officeId: `main-${sessionId}`, kind: 'tester' })

    // The read-only page: the same scene, no paths
    const ro = readOnly.got.filter(m => m.type === 'ea_state').at(-1)?.ea
    expect(ro.station.report.netProfit).toBe(run.netProfit)
    expect(JSON.stringify(readOnly.got)).not.toContain(root)

    // GET /ea/state: paths only with the token
    const plain = await request(server.app).get('/ea/state')
    expect(JSON.stringify(plain.body)).not.toContain(root)
    const authed = await request(server.app).get('/ea/state').set('Authorization', `Bearer ${server.AUTH_TOKEN}`)
    expect(authed.body.station.report.path).toBe(files.report)

    // A new page gets it in the snapshot
    const late = open(officeProtocols(server))
    await late.ready
    await new Promise(r => setTimeout(r, 150))
    late.ws.close()
    const snap = late.got.find(m => m.type === 'snapshot')
    expect(snap.ea.station.status).toBe('done')
  }, 30000)
})
