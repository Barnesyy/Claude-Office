/**
 * server/transcript-source.js — hookless mode: Claude Code's JSONL
 * transcripts rebuilt into hook payloads and run through the tracker.
 * Fixtures: tests/fixtures/transcripts (regenerate with
 * `node tests/fixtures/make-transcripts.mjs`).
 */

import { afterAll, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TranscriptWatcher, resolveTranscriptConfig, labelFor, encodeProjectPath, needsPermission, ruleAllows,
  createJsConverter, createPythonConverter, findPython, splitLines,
} from '../server/transcript-source.js'

const FIXTURES = join(__dirname, 'fixtures', 'transcripts')
const A = 'a1111111-2222-4333-8444-555555555555'
const B = 'b2222222-3333-4444-8555-666666666666'
const C = 'c3333333-4444-4555-8666-777777777777'
const END = Date.parse('2026-11-12T03:00:39.000Z')
const temps: string[] = []
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }) })

function tempClaude(): string {
  const dir = mkdtempSync(join(tmpdir(), 'co-transcripts-'))
  temps.push(dir)
  mkdirSync(join(dir, 'sessions'))
  mkdirSync(join(dir, 'projects'))
  return dir
}

const quietLog = { log() {}, warn() {}, error() {} }

async function runAll(config: object, converter = createJsConverter()) {
  const claude = tempClaude()
  cpSync(FIXTURES, join(claude, 'projects'), { recursive: true })
  const cfg = resolveTranscriptConfig(config, { CLAUDE_CONFIG_DIR: claude })
  let now = END + 60_000
  const events: any[] = []
  const payloads: any[] = []
  const w = new TranscriptWatcher({
    config: cfg, converter, fromStart: true, log: quietLog, now: () => now,
    sink: evs => { events.push(...evs) }, onPayload: p => payloads.push(p),
  })
  w.tick()
  now += 10_000
  w.tick()
  await w.flush()
  return { events, payloads, cfg }
}

describe('projects and labels', () => {
  it('encodes a Windows path the way Claude Code names its project dir', () => {
    expect(encodeProjectPath('C:\\Users\\Barnesy\\OneDrive\\EA Development')).toBe('C--Users-Barnesy-OneDrive-EA-Development')
  })

  it('the ea-development preset lists the EA folder only, and labels sub folders', () => {
    const cfg = resolveTranscriptConfig({ transcripts: { preset: 'ea-development' } }, {})
    expect(cfg.onlyListed).toBe(true)
    expect(cfg.projects.map(p => p.name)).toEqual(['EA Dev'])
    expect(labelFor('C:\\Users\\Barnesy\\OneDrive\\EA Development', null, cfg.projects).label).toBe('EA Dev')
    expect(labelFor('c:/users/barnesy/onedrive/ea development/School Run', null, cfg.projects).label).toBe('EA Dev · School Run')
    expect(labelFor('', 'C--Users-Barnesy-OneDrive-EA-Development-DAX-Ideas', cfg.projects).label).toBe('EA Dev · DAX Ideas')
    expect(labelFor('C:\\Users\\Barnesy\\Projects\\insider-alpha', null, cfg.projects).project).toBeNull()
  })

  it('env overrides the transcripts dir; defaults are sane', () => {
    const cfg = resolveTranscriptConfig({}, { AGENT_OFFICE_TRANSCRIPTS_DIR: '/x/projects', CLAUDE_CONFIG_DIR: '/c' })
    expect(cfg.dir).toBe('/x/projects')
    expect(cfg.registryDir).toBe(join('/c', 'sessions'))
    expect(cfg.onlyListed).toBe(false)
    expect(cfg.permissionGraceMs).toBe(6000)
    expect(cfg.bashPermissionGraceMs).toBe(15000)
  })
})

describe('permissions', () => {
  it('read-only tools never ask; edits ask in default mode but not in acceptEdits; bypass never asks', () => {
    expect(needsPermission('Read', {}, 'default')).toBe(false)
    expect(needsPermission('Edit', { file_path: 'a.mq5' }, 'default')).toBe(true)
    expect(needsPermission('Edit', { file_path: 'a.mq5' }, 'acceptEdits')).toBe(false)
    expect(needsPermission('Bash', { command: 'rm -rf x' }, 'bypassPermissions')).toBe(false)
  })

  it('an allow rule covers the matching Bash prefix only', () => {
    expect(ruleAllows('Bash(npm test:*)', 'Bash', { command: 'npm test -- --run' })).toBe(true)
    expect(ruleAllows('Bash(npm test:*)', 'Bash', { command: 'npm publish' })).toBe(false)
    expect(needsPermission('Bash', { command: 'git status' }, 'default', ['Bash(git status)'])).toBe(false)
  })
})

describe('splitLines', () => {
  it('keeps a half-written line for the next read and skips junk', () => {
    const r1 = splitLines('', '{"a":1}\nnot json\n{"b":')
    expect(r1.records).toEqual([{ a: 1 }])
    const r2 = splitLines(r1.rest, '2}\n')
    expect(r2.records).toEqual([{ b: 2 }])
  })
})

describe('TranscriptWatcher over the fixtures (JS converter)', () => {
  it('every session, labelled, with its workers spawned and finished, and the turns ended', async () => {
    const { events } = await runAll({})
    const started = events.filter(e => e.type === 'session_started')
    expect(new Set(started.map(e => e.sessionId))).toEqual(new Set([A, B, C]))
    const labels = Object.fromEntries(started.map(e => [e.sessionId, e.project]))
    expect(labels[A]).toBe('EA Development')
    expect(labels[B]).toBe('DAX Ideas')
    expect(labels[C]).toBe('insider-alpha')
    expect(events.every(e => e.via === 'transcript')).toBe(true)
    expect(events.some(e => 'answerable' in e || 'nonce' in e)).toBe(false)

    expect(events.filter(e => e.type === 'session_prompt' && !e.isWakeup).length).toBeGreaterThanOrEqual(3)
    expect(events.some(e => e.type === 'session_prompt' && e.isWakeup)).toBe(true)
    const spawned = events.filter(e => e.type === 'agent_spawned')
    expect(spawned.map(e => e.agent.background).sort()).toEqual([false, true])
    expect(events.some(e => e.type === 'agent_started' && e.subagentId === 'a7f3c2e9b1d4e5f60')).toBe(true)
    expect(events.some(e => e.type === 'agent_started' && e.subagentId === 'b9e8d7c6a5f4e3d20')).toBe(true)
    expect(events.filter(e => e.type === 'agent_completed').length).toBeGreaterThanOrEqual(2)
    expect(events.some(e => e.type === 'agent_working' && e.failed)).toBe(true)
    expect(events.some(e => e.type === 'agent_working' && /reading/.test(e.status))).toBe(true)
    for (const id of [A, B, C]) expect(events.some(e => e.type === 'session_turn_end' && e.sessionId === id)).toBe(true)
  })

  it('a worker starts after the Agent call that launched it (records interleaved by time)', async () => {
    const { events } = await runAll({})
    const spawnA = events.findIndex(e => e.type === 'agent_spawned' && e.sessionId === A)
    const startA = events.findIndex(e => e.type === 'agent_started' && e.subagentId === 'a7f3c2e9b1d4e5f60')
    const doneA = events.findIndex(e => e.type === 'agent_completed' && e.sessionId === A && !String(e.agentId).startsWith('a7f'))
    expect(spawnA).toBeGreaterThanOrEqual(0)
    expect(startA).toBeGreaterThan(spawnA)
    expect(doneA).toBeGreaterThan(startA)
  })

  it('the EA preset keeps only EA sessions and names them "EA Dev · …"', async () => {
    const { events } = await runAll({ transcripts: { preset: 'ea-development' } })
    const ids = new Set(events.map(e => e.sessionId).filter(Boolean))
    expect(ids.has(C)).toBe(false)
    expect(ids.has(A) && ids.has(B)).toBe(true)
    const started = events.filter(e => e.type === 'session_started')
    expect(started.find(e => e.sessionId === A)?.project).toBe('EA Dev')
    expect(started.find(e => e.sessionId === B)?.project).toBe('EA Dev · DAX Ideas')
  })
})

describe('permission waits from a quiet transcript', () => {
  async function partial(sessionDir: string, file: string, keepLines: number, waitMs: number, registry?: string) {
    const claude = tempClaude()
    const dir = join(claude, 'projects', sessionDir)
    mkdirSync(dir, { recursive: true })
    const lines = readFileSync(join(FIXTURES, sessionDir, file), 'utf8').split('\n').slice(0, keepLines)
    writeFileSync(join(dir, file), lines.join('\n') + '\n')
    const sessionId = file.slice(0, -6)
    if (registry) writeFileSync(join(claude, 'sessions', '123.json'), JSON.stringify({ pid: 123, sessionId, status: registry }))
    const cfg = resolveTranscriptConfig({}, { CLAUDE_CONFIG_DIR: claude })
    let now = END
    const events: any[] = []
    const w = new TranscriptWatcher({ config: cfg, converter: createJsConverter(), fromStart: true, log: quietLog, now: () => now, sink: evs => { events.push(...evs) } })
    w.tick()
    now += waitMs
    w.tick()
    await w.flush()
    return events
  }
  const B_DIR = 'C--Users-Barnesy-OneDrive-EA-Development-DAX-Ideas'
  const A_DIR = 'C--Users-Barnesy-OneDrive-EA-Development'

  it('an Edit with no result after the grace raises "needs you"', async () => {
    const events = await partial(B_DIR, `${B}.jsonl`, 6, 9000)
    const need = events.find(e => e.type === 'session_needs_you')
    expect(need?.kind).toBe('permission')
    expect(need?.toolName).toBe('Edit')
  })

  it('…but not before the grace is up', async () => {
    const events = await partial(B_DIR, `${B}.jsonl`, 6, 2000)
    expect(events.some(e => e.type === 'session_needs_you')).toBe(false)
  })

  it('a long Bash waits for the longer Bash grace, and the registry says "busy" means running, not asking', async () => {
    expect((await partial(A_DIR, `${A}.jsonl`, 8, 9000)).some(e => e.type === 'session_needs_you')).toBe(false)
    expect((await partial(A_DIR, `${A}.jsonl`, 8, 16000)).some(e => e.type === 'session_needs_you')).toBe(true)
    expect((await partial(A_DIR, `${A}.jsonl`, 8, 16000, 'busy')).some(e => e.type === 'session_needs_you')).toBe(false)
    expect((await partial(A_DIR, `${A}.jsonl`, 8, 3000, 'waiting')).some(e => e.type === 'session_needs_you')).toBe(true)
  })
})

const python = findPython()
describe.skipIf(!python)('the Python bridge (the unchanged agent-tracker.py)', () => {
  it('gives the same session picture as the JS converter, plus the tracker\'s extras', async () => {
    const conv = createPythonConverter(python!, { log: quietLog })
    try {
      const { events } = await runAll({ transcripts: { preset: 'ea-development' } }, conv)
      const types = new Set(events.map(e => e.type))
      for (const t of ['session_started', 'session_prompt', 'agent_spawned', 'agent_started', 'agent_completed', 'agent_working', 'session_turn_end']) {
        expect(types.has(t)).toBe(true)
      }
      expect(events.filter(e => e.type === 'session_started').find(e => e.sessionId === B)?.project).toBe('EA Dev · DAX Ideas')
      expect(events.some(e => 'answerable' in e)).toBe(false)
    } finally { conv.close() }
  }, 20000)
})
