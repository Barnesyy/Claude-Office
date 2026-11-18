/**
 * server/provider-sources.js — Codex and Grok sessions in the office: their
 * files adapted to Claude Code's transcript shape and run through the same
 * watcher. Fixtures: tests/fixtures/providers (regenerate with
 * `node tests/fixtures/providers/make-provider-fixtures.mjs`).
 */

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { TranscriptWatcher, TranscriptSession, resolveTranscriptConfig, createJsConverter } from '../server/transcript-source.js'
import { PROVIDERS, CodexAdapter, GrokAdapter, GrokEventsAdapter, normaliseTool, commandText, patchFiles, readOutput, readCodexMeta, resolveProviderConfig } from '../server/provider-sources.js'
import { providerOf, providerInfo } from '../src/providers'
import { reduceOffice, initialOfficeState } from '../src/officeReducer'

const FIXTURES = join(__dirname, 'fixtures', 'providers')
const MAIN = 'codex-019a0000-aaaa-7bbb-8ccc-000000000001'
const WORKER = '019a0000-aaaa-7bbb-8ccc-000000000002'
const END = Date.parse('2026-11-18T02:00:30.000Z')
const quietLog = { log() {}, warn() {}, error() {} }

async function run(id: 'codex' | 'grok', office: object = {}, { settle = 10_000 } = {}) {
  const base = resolveTranscriptConfig(office, {})
  const config = resolveProviderConfig(id, office, base, { [`AGENT_OFFICE_${id.toUpperCase()}_DIR`]: join(FIXTURES, id, 'sessions') })
  let now = END
  const events: any[] = []
  const payloads: any[] = []
  const w = new TranscriptWatcher({
    config, converter: createJsConverter(), fromStart: true, log: quietLog, now: () => now, provider: PROVIDERS[id],
    sink: (evs: any[]) => { events.push(...evs) }, onPayload: (p: any) => payloads.push(p),
  })
  w.tick()
  now += settle
  w.tick()
  await w.flush()
  return { events, payloads, config }
}

describe('tool names', () => {
  it('unwraps a shell wrapper and keeps a plain argv', () => {
    expect(commandText(['bash', '-lc', 'npm test'])).toBe('npm test')
    expect(commandText(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-Command', 'dir'])).toBe('dir')
    expect(commandText(['git', 'status'])).toBe('git status')
    expect(commandText('ls')).toBe('ls')
  })

  it('maps each tool family to the tracker\'s names', () => {
    expect(normaliseTool('shell', '{"command":["bash","-lc","ls"]}')).toEqual({ name: 'Bash', input: { command: 'ls' } })
    expect(normaliseTool('shell', { command: ['powershell.exe', '-Command', 'dir'] }).name).toBe('PowerShell')
    expect(normaliseTool('exec_command', '{"cmd":"terminal64.exe /config:t.ini"}').input.command).toBe('terminal64.exe /config:t.ini')
    expect(normaliseTool('read_file', { path: 'a.mq5' })).toMatchObject({ name: 'Read', input: { file_path: 'a.mq5' } })
    expect(normaliseTool('mcp__mt5__run', { a: 1 })).toEqual({ name: 'mcp__mt5__run', input: { a: 1 } })
    expect(normaliseTool('spawn_agent', '{}').name).toBe('spawn_agent')
  })

  it('reads the file out of an apply_patch body', () => {
    expect(patchFiles('*** Begin Patch\n*** Add File: New.mqh\n+x\n*** End Patch')).toEqual({ files: ['New.mqh'], added: true })
    expect(normaliseTool('apply_patch', { input: '*** Begin Patch\n*** Update File: EA.mq5\n*** End Patch' })).toMatchObject({ name: 'Edit', input: { file_path: 'EA.mq5' } })
    expect(normaliseTool('apply_patch', { input: '*** Add File: New.mqh' }).name).toBe('Write')
  })

  it('tells a failed output from a clean one', () => {
    expect(readOutput('Exit code: 0\nOutput:\nok').failed).toBe(false)
    expect(readOutput('Exit code: 2\nOutput:\nboom').failed).toBe(true)
    expect(readOutput(JSON.stringify({ output: 'x', metadata: { exit_code: 1 } }))).toEqual({ text: 'x', failed: true })
    expect(readOutput({ content: 'fine', success: true })).toEqual({ text: 'fine', failed: false })
    expect(readOutput({ content: 'no', success: false }).failed).toBe(true)
  })
})

describe('Codex', () => {
  it('reads who a rollout belongs to from its first line', () => {
    const dir = join(FIXTURES, 'codex', 'sessions', '2026', '11', '18')
    expect(readCodexMeta(join(dir, 'rollout-2026-11-18T02-00-05-019a0000-aaaa-7bbb-8ccc-000000000002.jsonl'))).toMatchObject({ id: WORKER, parent_thread_id: MAIN.slice(6), agent_role: 'explorer' })
  })

  it('ignores the model-context copies of a prompt and never guesses a turn end', () => {
    const a = new CodexAdapter({ kind: 'main' })
    const out = a.adapt([
      { timestamp: '2026-11-18T02:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context/>' }] } },
      { timestamp: '2026-11-18T02:00:00.000Z', type: 'response_item', payload: { type: 'reasoning', summary: [] } },
      { timestamp: '2026-11-18T02:00:01.000Z', type: 'event_msg', payload: { type: 'token_count' } },
    ])
    expect(out).toEqual([])
  })

  it('shows the thread as a session with its prompts, tools, a worker and both turn ends', async () => {
    const { events, payloads } = await run('codex')
    expect(events.every(e => e.provider === 'codex' && e.via === 'transcript')).toBe(true)
    expect(new Set(events.map(e => e.sessionId))).toEqual(new Set([MAIN]))

    const started = events.filter(e => e.type === 'session_started')
    expect(started[0]).toMatchObject({ sessionId: MAIN, project: 'School Run', model: 'gpt-5.2-codex' })
    expect(started.at(-1)).toMatchObject({ model: 'gpt-5.2-codex', title: 'Run the School Run backtest and fix the lot sizing' })

    expect(events.filter(e => e.type === 'session_prompt').map(e => e.text)).toEqual(['Run the School Run backtest and fix the lot sizing', 'Now run the tester'])
    expect(events.filter(e => e.type === 'session_turn_end').map(e => e.text)).toEqual(['Lot sizing now uses 1% risk.', '(interrupted)'])

    const tools = payloads.filter(p => p.hook_event_name === 'PreToolUse' && !p.agent_id && p.tool_name !== 'Agent').map(p => p.tool_name)
    expect(tools).toEqual(['PowerShell', 'Edit', 'Bash', 'TodoWrite', 'Bash'])
    expect(payloads.find(p => p.tool_use_id === 'call_2' && p.hook_event_name === 'PreToolUse').tool_input.file_path).toBe('SchoolRun.mq5')
    // npm test exited 1: a failure, as a failed Bash call is for Claude
    expect(payloads.find(p => p.tool_use_id === 'call_3' && p.hook_event_name === 'PostToolUseFailure')).toBeTruthy()
    // The tester call the abort cut short did not finish
    expect(payloads.find(p => p.tool_use_id === 'call_5' && p.hook_event_name === 'PostToolUseFailure')).toBeTruthy()
    expect(payloads.some(p => p.tool_use_id === 'call_5' && p.hook_event_name === 'PostToolUse')).toBe(false)
    // No approval is ever guessed for Codex
    expect(events.some(e => e.type === 'session_needs_you')).toBe(false)

    // The worker thread (its own rollout, parent_thread_id) is a worker of the same session
    expect(events.find(e => e.type === 'agent_started')).toMatchObject({ subagentId: WORKER, agentType: 'explorer' })
    expect(events.find(e => e.type === 'agent_working' && e.agentId === WORKER)).toMatchObject({ status: 'running: rg -n lots SchoolRun.mq5' })
    expect(events.find(e => e.type === 'agent_completed' && e.agentId === WORKER)).toMatchObject({ result: 'Lot size is set on line 12.' })
  })

  it('labels a thread by the listed project, and hides others when told to', async () => {
    const office = { transcripts: { preset: 'ea-development' } }
    const shown = await run('codex', office)
    expect(shown.events.find(e => e.type === 'session_started').project).toBe('EA Dev · School Run')
    const hidden = await run('codex', { transcripts: { projects: [{ name: 'Other', path: 'D:\\Other' }] }, providers: { codex: { onlyListed: true } } })
    expect(hidden.events).toEqual([])
  })

  it('can be turned off, and only lists days inside its window', async () => {
    expect(resolveProviderConfig('codex', { providers: { codex: { enabled: false } } }, {}, {})).toBeNull()
    const cfg = resolveProviderConfig('codex', {}, {}, { CODEX_HOME: '/x/.codex' })
    expect(cfg.dir).toBe(join('/x/.codex', 'sessions'))
    const old = PROVIDERS.codex.scan({ dir: join(FIXTURES, 'codex', 'sessions'), scanDays: 30 }, END + 90 * 86_400_000)
    expect(old).toEqual([])
  })
})

describe('Grok', () => {
  const G = 'grok-01a1e000-0000-7000-8000-000000000001'
  const T = Date.parse('2026-11-18T02:00:00.000Z')
  const upd = (ms: number, update: object) => ({ timestamp: Math.floor((T + ms) / 1000), method: 'session/update', params: { sessionId: 'x', update, _meta: { agentTimestampMs: T + ms } } })

  it('finds a session by its stream, with the cwd from the folder name', () => {
    const found = PROVIDERS.grok.scan({ dir: join(FIXTURES, 'grok', 'sessions'), scanDays: 36500 }, Date.now() + 1e9)
    expect(found.map((f: any) => [f.sessionId, !!f.aux, f.cwd])).toEqual([
      [G, false, 'C:\\Users\\Barnesy\\OneDrive\\EA Development'],
      [G, true, 'C:\\Users\\Barnesy\\OneDrive\\EA Development'],
    ])
  })

  it('joins the message chunks, names tools by kind when the name is new, and marks an MCP tool', () => {
    const a = new GrokAdapter({})
    const out: any[] = a.adapt([
      upd(1000, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'one ' } }),
      upd(1100, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'two' } }),
      upd(1200, { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'brand_new_reader', rawInput: {}, _meta: { 'x.ai/tool': { name: 'brand_new_reader', kind: 'read', namespace: 'grok_build' } } }),
      upd(1300, { sessionUpdate: 'tool_call', toolCallId: 'b', title: 'run_backtest', rawInput: {}, _meta: { 'x.ai/tool': { name: 'run_backtest', kind: 'other', namespace: 'mt5_research' } } }),
      upd(1400, { sessionUpdate: 'tool_call_update', toolCallId: 'a', kind: 'read' }),
    ])
    expect(out[0].message.content).toEqual([{ type: 'text', text: 'one two' }])
    expect(out[0].timestamp).toBe('2026-11-18T02:00:01.200Z')
    expect(out[1].message.content[0].name).toBe('Read')
    expect(out[2].message.content[0].name).toBe('mcp__mt5_research__run_backtest')
    expect(out).toHaveLength(3)
  })

  it('shows a session with its title, tools, a failed command and both turn ends', async () => {
    const { events, payloads } = await run('grok')
    expect(events.every(e => e.provider === 'grok' && e.sessionId === G)).toBe(true)
    const started = events.filter(e => e.type === 'session_started')
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ project: 'EA Development', title: 'Check the spread filter', model: 'grok-4.7' })
    expect(events.filter(e => e.type === 'session_prompt').map(e => e.text)).toEqual(['Check the spread filter', 'Now run the tester'])
    expect(payloads.filter(p => p.hook_event_name === 'PreToolUse').map(p => p.tool_name)).toEqual(['Read', 'Glob', 'Bash', 'Bash'])
    expect(payloads.find(p => p.tool_use_id === 'g3' && p.hook_event_name === 'PostToolUseFailure')).toBeTruthy()
    expect(payloads.find(p => p.tool_use_id === 'g4' && p.hook_event_name === 'PostToolUseFailure')).toBeTruthy()
    expect(events.filter(e => e.type === 'session_turn_end').map(e => e.text)).toEqual(['The spread filter caps at 2.0 points.', '(interrupted)'])
    // Every prompt in the replay was answered in the same instant: no hand
    expect(events.some(e => e.type === 'session_needs_you')).toBe(false)
  })

  it('raises a hand only for a permission prompt that is still open', () => {
    const e = new GrokEventsAdapter()
    expect(e.adapt([
      { ts: '2026-11-18T02:00:03.000Z', type: 'permission_requested', tool_name: 'read_file' },
      { ts: '2026-11-18T02:00:03.000Z', type: 'permission_resolved', tool_name: 'read_file', decision: 'allow', wait_ms: 0 },
    ])).toEqual([])
    expect(e.adapt([{ ts: '2026-11-18T02:00:06.000Z', type: 'permission_requested', tool_name: 'run_terminal_command' }]))
      .toEqual([{ type: 'x-permission', timestamp: '2026-11-18T02:00:06.000Z', toolName: 'Bash' }])

    // …and the session turns it into a permission request for the call that waits
    const s = new TranscriptSession({ sessionId: G, transcriptPath: 'updates.jsonl' })
    const a = new GrokAdapter({ cwd: 'C:\\ea' })
    s.mainRecords(a.adapt([
      upd(1000, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'go' } }),
      upd(2000, { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'run_terminal_command', rawInput: { command: 'del x' }, _meta: { 'x.ai/tool': { name: 'run_terminal_command', kind: 'execute', namespace: 'grok_build' } } }),
    ]))
    const out = s.mainRecords([{ type: 'x-permission', timestamp: '2026-11-18T02:00:03.000Z', toolName: 'Bash' }])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'c1', tool_input: { command: 'del x' } })
    // Once per call
    expect(s.mainRecords([{ type: 'x-permission', timestamp: '2026-11-18T02:00:04.000Z', toolName: 'Bash' }])).toEqual([])
  })
})

describe('the office', () => {
  it('knows a provider from the session id', () => {
    expect(providerOf('codex-abc')).toBe('codex')
    expect(providerOf('main-grok-abc')).toBe('grok')
    expect(providerOf('a1111111-2222-4333-8444-555555555555')).toBe('claude')
    expect(providerOf('whatever', 'codex')).toBe('codex')
    expect(providerInfo('codex-abc').name).toBe('Codex')
  })

  it('seats a Codex session as Codex, and a Claude one as before', () => {
    const env = { now: 1000, live: true, computePath: () => [], random: () => 0.5 } as any
    let r = reduceOffice(initialOfficeState([], 1000), { type: 'session_started', sessionId: MAIN, project: 'EA Dev' } as any, env)
    const codex = r.state.agents.find(a => a.id === `main-${MAIN}`)!
    expect(codex).toMatchObject({ name: 'Codex', task: 'Codex · EA Dev' })
    expect(r.effects.find((e: any) => e.kind === 'msg')).toMatchObject({ sender: 'Codex', color: providerInfo(MAIN).color })
    r = reduceOffice(r.state, { type: 'session_started', sessionId: 'a1111111-2222-4333-8444-555555555555', project: 'EA Dev' } as any, env)
    const claude = r.state.agents.find(a => a.id === 'main-a1111111-2222-4333-8444-555555555555')!
    expect(claude.task).toBe('Claude Code · EA Dev')
    expect(claude.name).not.toBe('Codex')
  })
})
