#!/usr/bin/env node
/**
 * Writes the Codex and Grok session fixtures (tests/provider-sources.test.ts).
 *   node tests/fixtures/providers/make-provider-fixtures.mjs
 * Codex: the rollout shape of openai/codex (codex-rs/protocol, codex-rs/rollout):
 * one { timestamp, type, payload } per line. Grok: chat-completion rows.
 * The numbers and names are made up; nothing here is a real session.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const T0 = Date.parse('2026-11-18T02:00:00.000Z')
const at = s => new Date(T0 + s * 1000).toISOString()
const write = (path, lines) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n') + '\n') }

export const CODEX_MAIN = '019a0000-aaaa-7bbb-8ccc-000000000001'
export const CODEX_WORKER = '019a0000-aaaa-7bbb-8ccc-000000000002'
const CWD = 'C:\\Users\\Barnesy\\OneDrive\\EA Development\\School Run'
const line = (s, type, payload) => ({ timestamp: at(s), type, payload })
const ev = (s, payload) => line(s, 'event_msg', payload)
const item = (s, payload) => line(s, 'response_item', payload)

write(join(HERE, 'codex', 'sessions', '2026', '11', '18', `rollout-2026-11-18T02-00-00-${CODEX_MAIN}.jsonl`), [
  line(0, 'session_meta', { id: CODEX_MAIN, session_id: CODEX_MAIN, timestamp: at(0), cwd: CWD, originator: 'codex_desktop', cli_version: '0.0.0', source: 'vscode', model_provider: 'openai' }),
  line(1, 'turn_context', { turn_id: 't1', cwd: CWD, approval_policy: 'on-request', model: 'gpt-5.2-codex' }),
  ev(1, { type: 'turn_started', turn_id: 't1' }),
  item(1, { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>...</environment_context>' }] }),
  ev(1, { type: 'user_message', message: 'Run the School Run backtest and fix the lot sizing' }),
  item(2, { type: 'reasoning', summary: [], encrypted_content: 'x' }),
  ev(3, { type: 'agent_message', message: 'Looking at the EA first.' }),
  item(3, { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['powershell.exe', '-Command', 'Get-Content SchoolRun.mq5 | Select-Object -First 40'], workdir: CWD }), call_id: 'call_1' }),
  item(4, { type: 'function_call_output', call_id: 'call_1', output: 'Exit code: 0\nWall time: 0.4 seconds\nOutput:\n//+---- SchoolRun.mq5' }),
  item(5, { type: 'custom_tool_call', call_id: 'call_2', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: SchoolRun.mq5\n@@\n-double lots=0.1;\n+double lots=RiskLots(1.0);\n*** End Patch' }),
  item(6, { type: 'custom_tool_call_output', call_id: 'call_2', output: 'Success. Updated the following files:\nM SchoolRun.mq5' }),
  item(7, { type: 'function_call', name: 'shell_command', arguments: JSON.stringify({ command: 'npm test' }), call_id: 'call_3' }),
  item(9, { type: 'function_call_output', call_id: 'call_3', output: JSON.stringify({ output: '1 failed', metadata: { exit_code: 1, duration_seconds: 2 } }) }),
  item(10, { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'Fix lots', status: 'completed' }, { step: 'Backtest', status: 'in_progress' }] }), call_id: 'call_4' }),
  item(10, { type: 'function_call_output', call_id: 'call_4', output: 'Plan updated' }),
  ev(11, { type: 'token_count', info: null }),
  ev(12, { type: 'agent_message', message: 'Lot sizing now uses 1% risk.' }),
  ev(12, { type: 'turn_complete', turn_id: 't1', last_agent_message: 'Lot sizing now uses 1% risk.' }),
  // A second turn that is interrupted with a call still open
  line(20, 'turn_context', { turn_id: 't2', cwd: CWD, approval_policy: 'on-request', model: 'gpt-5.2-codex' }),
  ev(20, { type: 'user_message', message: 'Now run the tester' }),
  item(21, { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'terminal64.exe /config:tester.ini' }), call_id: 'call_5' }),
  ev(25, { type: 'turn_aborted', turn_id: 't2', reason: 'interrupted' }),
])

write(join(HERE, 'codex', 'sessions', '2026', '11', '18', `rollout-2026-11-18T02-00-05-${CODEX_WORKER}.jsonl`), [
  line(5, 'session_meta', { id: CODEX_WORKER, session_id: CODEX_MAIN, parent_thread_id: CODEX_MAIN, timestamp: at(5), cwd: CWD, originator: 'codex_desktop', cli_version: '0.0.0', source: { subagent: 'thread_spawn' }, agent_role: 'explorer', agent_nickname: 'Faraday' }),
  line(5, 'turn_context', { turn_id: 'w1', cwd: CWD, approval_policy: 'never', model: 'gpt-5.2-codex-mini' }),
  ev(5, { type: 'user_message', message: 'Find where lot size is set' }),
  item(6, { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'rg -n lots SchoolRun.mq5'] }), call_id: 'w_call_1' }),
  item(7, { type: 'function_call_output', call_id: 'w_call_1', output: { content: '12: double lots=0.1;', success: true } }),
  ev(8, { type: 'turn_complete', turn_id: 'w1', last_agent_message: 'Lot size is set on line 12.' }),
])

export const GROK_SESSION = 'grok-sess-0001'
write(join(HERE, 'grok', 'sessions', GROK_SESSION, 'messages.jsonl'), [
  { type: 'session', timestamp: at(0), cwd: '/home/jake/ea', title: 'Check the spread filter', model: 'grok-code-fast-1' },
  { timestamp: at(1), role: 'user', content: 'Check the spread filter' },
  { timestamp: at(2), role: 'assistant', model: 'grok-code-fast-1', content: '', tool_calls: [{ id: 'g1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'Filter.mqh' }) } }] },
  { timestamp: at(3), role: 'tool', tool_call_id: 'g1', content: 'input double MaxSpread=2.0;' },
  { timestamp: at(4), role: 'assistant', content: '', tool_calls: [{ id: 'g2', type: 'function', function: { name: 'run_terminal_cmd', arguments: JSON.stringify({ command: 'git status' }) } }] },
  { timestamp: at(5), role: 'tool', tool_call_id: 'g2', content: 'On branch main' },
  { timestamp: at(6), role: 'assistant', content: 'The spread filter caps at 2.0 points.' },
])
console.log('provider fixtures written')
