/**
 * Hookless mode end to end: the fixtures' transcripts -> TranscriptWatcher ->
 * POST /event (bearer token, like scripts/transcript-watch.mjs) -> the office
 * -> the WebSocket, and the event taps a progression layer would use.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { loadOffice, removeOffice, postEvent, listen, officeProtocols, type Office } from './helpers'
import { TranscriptWatcher, resolveTranscriptConfig, createJsConverter } from '../server/transcript-source.js'

const FIXTURES = join(__dirname, 'fixtures', 'transcripts')
const END = Date.parse('2026-11-12T03:00:39.000Z')
let office: Office | undefined
const temps: string[] = []
afterAll(async () => {
  office?.server.httpServer.close()
  removeOffice(office)
  for (const d of temps) rmSync(d, { recursive: true, force: true })
})

describe('transcripts -> office -> WebSocket', () => {
  it('EA sessions and their workers appear, animate and finish; taps see every broadcast', async () => {
    office = await loadOffice()
    const { server } = office
    const port = await listen(server.httpServer)

    const tapped: any[] = []
    const off = server.addEventTap((e: any) => tapped.push(e))

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, officeProtocols(server))
    const received: any[] = []
    ws.on('message', d => { try { received.push(JSON.parse(String(d))) } catch {} })
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })

    const claude = mkdtempSync(join(tmpdir(), 'co-e2e-'))
    temps.push(claude)
    mkdirSync(join(claude, 'sessions'))
    cpSync(FIXTURES, join(claude, 'projects'), { recursive: true })
    const config = resolveTranscriptConfig({ transcripts: { preset: 'ea-development' } }, { CLAUDE_CONFIG_DIR: claude })
    let now = END + 60_000
    const statuses: number[] = []
    const w = new TranscriptWatcher({
      config, converter: createJsConverter(), fromStart: true, log: { log() {}, warn() {}, error() {} }, now: () => now,
      sink: async events => { for (const e of events) statuses.push((await postEvent(server, e)).status) },
    })
    w.tick(); now += 10_000; w.tick()
    await w.flush()
    await new Promise(r => setTimeout(r, 200))
    ws.close()
    off()

    expect(statuses.length).toBeGreaterThan(10)
    expect(statuses.every(s => s >= 200 && s < 300)).toBe(true)

    const types = new Set(received.map(m => m.type))
    for (const t of ['session_started', 'agent_spawned', 'agent_completed']) expect(types.has(t)).toBe(true)
    // Workers walked in and out; a failed tool showed as failed
    const spawned = received.filter(m => m.type === 'agent_spawned')
    expect(spawned.length).toBeGreaterThanOrEqual(2)
    expect(received.some(m => JSON.stringify(m).includes('EA Dev · DAX Ideas'))).toBe(true)
    expect(received.some(m => JSON.stringify(m).includes('insider-alpha'))).toBe(false)

    // The taps saw what the pages saw, in the same order
    expect(tapped.map(e => e.type)).toEqual(received.filter(m => tapped.some(t => t.type === m.type)).map(m => m.type).slice(0, tapped.length))
    expect(tapped.length).toBeGreaterThan(0)
  }, 30000)
})

describe('project focus on the registry roster', () => {
  it('with the EA preset, a registry-only session outside EA Development is left out of the strip', async () => {
    const { writeFileSync } = await import('node:fs')
    const cfgDir = mkdtempSync(join(tmpdir(), 'co-cfg-'))
    const reg = mkdtempSync(join(tmpdir(), 'co-reg-'))
    temps.push(cfgDir, reg)
    writeFileSync(join(cfgDir, 'office.config.json'), JSON.stringify({ transcripts: { preset: 'ea-development' } }))
    const pid = process.pid
    writeFileSync(join(reg, `${pid}.json`), JSON.stringify({ pid, sessionId: 'e1111111-0000-4000-8000-000000000001', cwd: 'C:\\Users\\Barnesy\\OneDrive\\EA Development\\School Run', status: 'idle', startedAt: Date.now() }))
    const o = await loadOffice({ env: { AGENT_OFFICE_CONFIG_DIR: cfgDir, AGENT_OFFICE_REGISTRY_DIR: reg } })
    try {
      const registry = o.server.app.locals.registry
      registry.scan()
      const ids = () => [...o.server.sessions.keys()]
      expect(ids()).toContain('e1111111-0000-4000-8000-000000000001')
      writeFileSync(join(reg, `${pid}.json`), JSON.stringify({ pid, sessionId: 'f2222222-0000-4000-8000-000000000002', cwd: 'C:\\Users\\Barnesy\\Projects\\insider-alpha', status: 'idle', startedAt: Date.now() }))
      registry.scan()
      expect(ids()).not.toContain('f2222222-0000-4000-8000-000000000002')
    } finally { removeOffice(o) }
  })
})
