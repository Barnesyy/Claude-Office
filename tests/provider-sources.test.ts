/**
 * server/provider-sources.js — Codex and Grok sessions in the office: their
 * files adapted to Claude Code's transcript shape and run through the same
 * watcher. Fixtures: tests/fixtures/providers (regenerate with
 * `node tests/fixtures/providers/make-provider-fixtures.mjs`).
 */

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { TranscriptWatcher, resolveTranscriptConfig, createJsConverter } from '../server/transcript-source.js'
import { PROVIDERS, CodexAdapter, ChatAdapter, normaliseTool, commandText, patchFiles, readOutput, readCodexMeta, resolveProviderConfig } from '../server/provider-sources.js'
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
    expect(started[0]).toMatchObject({ sessionId: MAIN, project: 'School Run' })
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
  it('adapts chat-completion rows and Claude rows alike', () => {
    const a = new ChatAdapter()
    const out = a.adapt([
      { role: 'user', content: 'hi', timestamp: 1794967200 },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'on it' }, { type: 'tool_use', id: 't1', name: 'bash', input: { command: 'ls' } }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a b' }] } },
      { role: 'system', content: 'ignored' },
    ])
    expect(out.map((r: any) => r.type)).toEqual(['user', 'assistant', 'user'])
    expect(out[0].timestamp).toBe('2026-11-18T02:00:00.000Z')
    expect(out[1].message.content[1]).toEqual({ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } })
  })

  it('shows a session with its title, tools and a turn that ends when the reply goes quiet', async () => {
    const { events } = await run('grok')
    expect(events.every(e => e.provider === 'grok')).toBe(true)
    expect(events[0]).toMatchObject({ type: 'session_started', sessionId: 'grok-grok-sess-0001', title: 'Check the spread filter' })
    expect(events.filter(e => e.type === 'agent_working').map(e => e.status)).toEqual(['reading Filter.mqh', 'running: git status'])
    expect(events.at(-1)).toMatchObject({ type: 'session_turn_end', text: 'The spread filter caps at 2.0 points.' })
  })

  it('keeps the turn open while the reply is fresh', async () => {
    const { events } = await run('grok', {}, { settle: 2000 })
    expect(events.some(e => e.type === 'session_turn_end')).toBe(false)
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
