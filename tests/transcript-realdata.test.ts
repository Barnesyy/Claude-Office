/**
 * Shapes seen in real Claude desktop app transcripts on Jake's PC (Nov 2026),
 * rebuilt with made-up content: auto permission mode, the PowerShell tool,
 * <wake>/<relay> prompt wrappers, SubagentHandback and peer hand-backs,
 * workers launched before the watcher looked, OneDrive-touched files, big
 * files at start-up, registry thread names, cd into sub folders.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TranscriptSession, TranscriptWatcher, resolveTranscriptConfig, needsPermission, cleanPrompt, labelFor, createJsConverter,
} from '../server/transcript-source.js'

const ROOT = 'C:\\Users\\Barnesy\\OneDrive\\EA Development'
const ENC = 'C--Users-Barnesy-OneDrive-EA-Development'
const SID = 'd1111111-2222-4333-8444-555555555555'
const temps: string[] = []
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }) })
const quietLog = { log() {}, warn() {}, error() {} }
const T0 = Date.parse('2026-11-12T04:00:00.000Z')
const iso = (ms: number) => new Date(T0 + ms).toISOString()

const user = (ms: number, content: any, extra: object = {}) => ({ type: 'user', sessionId: SID, cwd: ROOT, permissionMode: 'auto', entrypoint: 'claude-desktop', timestamp: iso(ms), message: { role: 'user', content }, ...extra })
const tool = (ms: number, id: string, name: string, input: object, extra: object = {}) => ({ type: 'assistant', sessionId: SID, cwd: ROOT, timestamp: iso(ms), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' }, ...extra })
const result = (ms: number, id: string, text = 'ok', extra: object = {}) => user(ms, [{ type: 'tool_result', tool_use_id: id, content: text }], extra)
const wake = (text: string) => `<wake reason="mention" current-time="x"><project id="chan_1" type="project"><thread ts="cmsg_1"><message trigger="true" from="human" trust="principal" id="cmsg_2">${text}</message></thread></project></wake>`

function claudeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'co-realdata-'))
  temps.push(dir)
  mkdirSync(join(dir, 'sessions'))
  mkdirSync(join(dir, 'projects', ENC), { recursive: true })
  return dir
}
const write = (file: string, rows: object[]) => writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n')

function watcher(dir: string, now: () => number, alive = (_pid: number) => true) {
  const events: any[] = []
  const payloads: any[] = []
  const cfg = resolveTranscriptConfig({ transcripts: { preset: 'ea-development' } }, { CLAUDE_CONFIG_DIR: dir })
  const w = new TranscriptWatcher({ config: cfg, converter: createJsConverter(), log: quietLog, now, alive,
    sink: evs => { events.push(...evs) }, onPayload: p => payloads.push(p) })
  return { w, events, payloads }
}

describe('permission inference on real modes and tools', () => {
  it('auto mode never infers a dialog from a slow call; questions still ask', () => {
    expect(needsPermission('Bash', { command: 'make' }, 'auto')).toBe(false)
    expect(needsPermission('PowerShell', { command: 'Get-ChildItem' }, 'auto')).toBe(false)
    expect(needsPermission('Edit', { file_path: 'x.mq5' }, 'auto')).toBe(false)
    expect(needsPermission('AskUserQuestion', {}, 'auto')).toBe(true)
  })

  it('PowerShell follows the Bash rules: allow rules by prefix, background never asks, the longer grace', () => {
    expect(needsPermission('PowerShell', { command: 'npm test' }, 'default', ['PowerShell(npm test:*)'])).toBe(false)
    expect(needsPermission('PowerShell', { command: 'Remove-Item x' }, 'default', ['PowerShell(npm test:*)'])).toBe(true)
    expect(needsPermission('PowerShell', { command: 'x', run_in_background: true }, 'default')).toBe(false)
    const s = new TranscriptSession({ sessionId: SID, transcriptPath: 'x', encodedDir: ENC })
    s.mainRecords([user(0, 'go', { permissionMode: 'default' }), tool(100, 't1', 'PowerShell', { command: 'Start-Process terminal64.exe' })])
    const opts = { graceMs: 6000, bashGraceMs: 15000, turnIdleMs: 4000 }
    expect(s.quietCheck(0, 9000, opts).some(p => p.hook_event_name === 'PermissionRequest')).toBe(false)
    expect(s.quietCheck(0, 16000, opts).some(p => p.hook_event_name === 'PermissionRequest')).toBe(true)
  })

  it('desktop bookkeeping tools never ask', () => {
    for (const t of ['SendMessage', 'Monitor', 'ReadNotifications', 'CronCreate', 'SendUserFile', 'SubagentHandback']) expect(needsPermission(t, {}, 'default')).toBe(false)
  })
})

describe('prompts from the desktop app', () => {
  it('unwraps a <wake> message from Jake, and marks relays and scheduled tasks as not his', () => {
    expect(cleanPrompt(wake('Run the &amp; DAX test'))).toEqual({ text: 'Run the & DAX test', human: true })
    expect(cleanPrompt('<relay from="coordinator" session="s"><note>Change the plan</note></relay>')).toEqual({ text: 'relay from coordinator: Change the plan', human: false })
    expect(cleanPrompt('<project_claude_message session="s" thread_id="t"><relay from="build-bot"><note>done</note></relay></project_claude_message>').text).toBe('relay from build-bot: done')
    expect(cleanPrompt('<scheduled-task name="daily-check" file="f">body</scheduled-task>')).toEqual({ text: 'scheduled task: daily-check', human: false })
    expect(cleanPrompt('plain words')).toEqual({ text: 'plain words', human: true })
  })

  it('a relay is not the boss speaking; a wake from Jake is, and titles the session', async () => {
    const dir = claudeDir()
    let now = T0 + 1000
    const { w, events } = watcher(dir, () => now)
    w.tick()
    write(join(dir, 'projects', ENC, `${SID}.jsonl`), [user(0, wake('Tighten the lot rounding')), user(500, '<relay from="coordinator"><note>also check Monday</note></relay>')])
    now += 1000; w.tick(); await w.flush()
    const prompts = events.filter(e => e.type === 'session_prompt')
    expect(prompts.map(e => [e.text, e.isWakeup])).toEqual([['Tighten the lot rounding', false], ['relay from coordinator: also check Monday', true]])
    expect(events.filter(e => e.type === 'session_started').at(-1).title).toBe('Tighten the lot rounding')
  })
})

describe('labels stay put', () => {
  it('a session that changes directory into a deep sub folder keeps its project label', async () => {
    const dir = claudeDir()
    let now = T0 + 1000
    const { w, events } = watcher(dir, () => now)
    w.tick()
    const deep = `${ROOT}\\engineering\\MT5_Runtime\\BPA_StrictDay`
    write(join(dir, 'projects', ENC, `${SID}.jsonl`), [user(0, 'go'), tool(100, 't1', 'Bash', { command: 'cd engineering' }), result(200, 't1', 'ok', { cwd: deep }), tool(300, 't2', 'Read', { file_path: 'x' }, { cwd: deep })])
    now += 1000; w.tick(); await w.flush()
    expect(new Set(events.map(e => e.project))).toEqual(new Set(['EA Dev']))
    expect(events.some(e => e.type === 'session_cwd')).toBe(true)
  })

  it('a session started deep down shows the folder name, not the whole path', () => {
    const { projects } = resolveTranscriptConfig({ transcripts: { preset: 'ea-development' } }, {})
    expect(labelFor(`${ROOT}\\School Run`, null, projects).label).toBe('EA Dev · School Run')
    expect(labelFor(`${ROOT}\\MQL5\\Experts`, null, projects).label).toBe('EA Dev · MQL5 / Experts')
    expect(labelFor(`${ROOT}\\MQL5\\Experts\\Trader Tom School Run EA`, null, projects).label).toBe('EA Dev · Trader Tom School Run EA')
  })
})

describe('start-up on real files', () => {
  it('a file OneDrive touched (fresh mtime, old records) does not come back to life', async () => {
    const dir = claudeDir()
    const now = T0 + 3 * 3600_000
    const file = join(dir, 'projects', ENC, `${SID}.jsonl`)
    write(file, [user(0, 'old work'), tool(100, 't1', 'Bash', { command: 'x' })])
    utimesSync(file, new Date(now - 60_000), new Date(now - 60_000))
    const { w, events } = watcher(dir, () => now)
    w.tick(); await w.flush()
    expect(events).toEqual([])
  })

  it('catch-up on a file bigger than one 8 MB read rebuilds the current turn only', async () => {
    const dir = claudeDir()
    const now = T0 + 120_000
    const file = join(dir, 'projects', ENC, `${SID}.jsonl`)
    const pad = 'x'.repeat(4000)
    const rows: object[] = [user(0, 'first ask')]
    for (let i = 0; i < 2600; i++) rows.push(tool(10 + i * 10, `old${i}`, 'Read', { file_path: pad }), result(15 + i * 10, `old${i}`))
    rows.push(user(60_000, wake('the current ask')), tool(60_100, 'now1', 'Grep', { pattern: 'lot' }))
    write(file, rows)
    utimesSync(file, new Date(now - 5000), new Date(now - 5000))
    const { w, events } = watcher(dir, () => now)
    w.tick(); w.tick(); w.tick(); await w.flush()
    const prompts = events.filter(e => e.type === 'session_prompt').map(e => e.text)
    expect(prompts).toEqual(['the current ask'])
    expect(events.filter(e => e.type === 'agent_working').map(e => e.tool)).toEqual(['Grep'])
    expect(events.find(e => e.type === 'session_started').source).toBe('resume')
  })

  it('a worker launched before the watcher started gets its own stand-in spawn, and a peer hand-back ends it', async () => {
    const dir = claudeDir()
    const now = T0 + 120_000
    const main = join(dir, 'projects', ENC, `${SID}.jsonl`)
    const AID = 'a0123456789abcdef'
    write(main, [
      user(0, wake('build it')),
      tool(100, 'ag1', 'Agent', { description: 'Write runner', prompt: 'You write the runner', run_in_background: true, subagent_type: 'general-purpose' }),
      result(200, 'ag1', 'launched', { toolUseResult: { isAsync: true, status: 'async_launched', agentId: AID } }),
      user(30_000, wake('and the readme')),
    ])
    mkdirSync(join(dir, 'projects', ENC, SID, 'subagents'), { recursive: true })
    const sub = join(dir, 'projects', ENC, SID, 'subagents', `agent-${AID}.jsonl`)
    write(sub, [
      user(150, 'You write the runner', { isSidechain: true, agentId: AID }),
      tool(40_000, 's1', 'Edit', { file_path: 'runner.py' }, { isSidechain: true, agentId: AID }),
      result(40_100, 's1', 'ok', { isSidechain: true, agentId: AID }),
    ])
    for (const f of [main, sub]) utimesSync(f, new Date(now - 5000), new Date(now - 5000))
    let t = now
    const { w, events } = watcher(dir, () => t)
    w.tick(); await w.flush()
    const kinds = events.filter(e => e.type.startsWith('agent_') && e.type !== 'agent_working').map(e => e.type)
    expect(kinds).toEqual(['agent_spawned', 'agent_linked', 'agent_started'])
    const spawn = events.find(e => e.type === 'agent_spawned')
    expect(spawn.agent.id).toBe(`agent-w-${AID}`)
    expect(spawn.agent.task).toBe('Write runner')
    expect(events.find(e => e.type === 'agent_linked').subagentId).toBe(AID)
    // The desktop app's hand-back: SubagentHandback, then a meta message from the peer
    const more = [tool(50_000, 's2', 'SubagentHandback', { summary: 'done' }, { isSidechain: true, agentId: AID }), result(50_100, 's2', '{"success":true}', { isSidechain: true, agentId: AID })]
    writeFileSync(sub, more.map(r => JSON.stringify(r)).join('\n') + '\n', { flag: 'a' })
    writeFileSync(main, JSON.stringify(user(50_200, 'Another Claude session sent a message', { isMeta: true, origin: { kind: 'peer', from: AID } })) + '\n', { flag: 'a' })
    t += 1000; w.tick(); await w.flush()
    expect(events.filter(e => e.type === 'agent_completed' && e.agentId === AID)).toHaveLength(1)
  })

  it('workers that finished before the current turn are not rebuilt', async () => {
    const dir = claudeDir()
    const now = T0 + 120_000
    const main = join(dir, 'projects', ENC, `${SID}.jsonl`)
    const AID = 'a99999999abcdef00'
    write(main, [user(0, wake('one')), user(60_000, wake('two')), tool(60_100, 'g', 'Grep', { pattern: 'x' })])
    mkdirSync(join(dir, 'projects', ENC, SID, 'subagents'), { recursive: true })
    const sub = join(dir, 'projects', ENC, SID, 'subagents', `agent-${AID}.jsonl`)
    // An untimed row after the worker's last timed row rides on that time
    write(sub, [user(100, 'task', { isSidechain: true, agentId: AID }), { type: 'api-request-blob', agentId: AID, isSidechain: true, message: { content: [] } }])
    for (const f of [main, sub]) utimesSync(f, new Date(now - 5000), new Date(now - 5000))
    const { w, events } = watcher(dir, () => now)
    w.tick(); await w.flush()
    expect(events.filter(e => e.type.startsWith('agent_') && e.type !== 'agent_working')).toEqual([])
  })
})

describe('the registry', () => {
  it('a desktop thread name becomes the title; a derived one does not; a dead pid is ignored', async () => {
    const dir = claudeDir()
    let now = T0 + 1000
    writeFileSync(join(dir, 'sessions', '111.json'), JSON.stringify({ pid: 111, sessionId: SID, status: 'busy', name: 'Research School Run settings', updatedAt: 5 }))
    const { w, events } = watcher(dir, () => now, pid => pid === 111)
    w.tick()
    write(join(dir, 'projects', ENC, `${SID}.jsonl`), [user(0, wake('hello')), tool(100, 't', 'Bash', { command: 'sleep 100' }, { permissionMode: 'default' })])
    now += 1000; w.tick(); await w.flush()
    expect(events.filter(e => e.type === 'session_started').at(-1).title).toBe('Research School Run settings')
    // registry "busy": a slow Bash is running, not asking
    now += 60_000; w.tick(); await w.flush()
    expect(events.some(e => e.type === 'session_needs_you')).toBe(false)

    const dir2 = claudeDir()
    writeFileSync(join(dir2, 'sessions', '222.json'), JSON.stringify({ pid: 222, sessionId: SID, status: 'busy', name: 'ea-development-58', nameSource: 'derived' }))
    let now2 = T0 + 1000
    const second = watcher(dir2, () => now2, () => false)
    second.w.tick()
    write(join(dir2, 'projects', ENC, `${SID}.jsonl`), [user(0, wake('hello'), { permissionMode: 'default' }), tool(100, 't', 'Bash', { command: 'rm -rf x' }, { permissionMode: 'default' })])
    now2 += 1000; second.w.tick(); await second.w.flush()
    expect(second.events.filter(e => e.type === 'session_started').at(-1).title).toBe('hello')
    // dead pid: no registry, so the grace decides (default mode, unlisted command)
    now2 += 16_000; second.w.tick(); await second.w.flush()
    expect(second.events.some(e => e.type === 'session_needs_you')).toBe(true)
  })
})
