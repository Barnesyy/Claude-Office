#!/usr/bin/env node
/**
 * Writes the Codex and Grok session fixtures (tests/provider-sources.test.ts).
 *   node tests/fixtures/providers/make-provider-fixtures.mjs
 * Codex: the rollout shape of openai/codex (codex-rs/protocol, codex-rs/rollout):
 * one { timestamp, type, payload } per line. Grok: the session folder its CLI keeps
 * (updates.jsonl, events.jsonl, summary.json), in the shape of real ones.
 * The numbers and names are made up; nothing here is a real session.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
rmSync(join(HERE, 'grok'), { recursive: true, force: true })
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

// Grok: ~/.grok/sessions/<url-encoded cwd>/<session id>/{updates.jsonl, events.jsonl, summary.json}
export const GROK_SESSION = '01a1e000-0000-7000-8000-000000000001'
const GROK_CWD = 'C:\\Users\\Barnesy\\OneDrive\\EA Development'
const gdir = join(HERE, 'grok', 'sessions', encodeURIComponent(GROK_CWD), GROK_SESSION)
let gseq = 0
const upd = (s, update, method = 'session/update') => ({ timestamp: Math.floor((T0 + s * 1000) / 1000), method,
  params: { sessionId: GROK_SESSION, update, _meta: { eventId: `${GROK_SESSION}-${++gseq}`, agentTimestampMs: T0 + s * 1000 } } })
const xtool = (name, kind, extra = {}) => ({ 'x.ai/tool': { version: 1, name, kind, namespace: 'grok_build', ...extra } })
write(join(gdir, 'updates.jsonl'), [
  upd(0, { sessionUpdate: 'current_mode_update', currentModeId: 'default' }),
  upd(1, { sessionUpdate: 'hook_execution', event_name: 'user_prompt_submit', runs: [] }, '_x.ai/session/update'),
  upd(1, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Check the spread filter' }, _meta: { modelId: 'grok-4.7', promptIndex: 0 } }),
  upd(2, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } }),
  upd(3, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Reading the filter. ' } }),
  upd(3, { sessionUpdate: 'tool_call', toolCallId: 'g1', title: 'read_file', rawInput: { target_file: 'Filter.mqh' }, _meta: xtool('read_file', 'read') }),
  upd(3, { sessionUpdate: 'tool_call_update', toolCallId: 'g1', kind: 'read', title: 'Read `Filter.mqh`', rawInput: { variant: 'ReadFile', target_file: 'Filter.mqh' } }),
  upd(4, { sessionUpdate: 'tool_call_update', toolCallId: 'g1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'input double MaxSpread=2.0;' } }] }),
  upd(5, { sessionUpdate: 'tool_call', toolCallId: 'g2', title: 'list_dir', rawInput: { target_directory: 'Include' }, _meta: xtool('list_dir', 'list') }),
  upd(5, { sessionUpdate: 'tool_call_update', toolCallId: 'g2', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'Filter.mqh' } }] }),
  upd(6, { sessionUpdate: 'tool_call', toolCallId: 'g3', title: 'run_terminal_command', rawInput: { command: 'git status', description: 'Check the tree' }, _meta: xtool('run_terminal_command', 'execute') }),
  upd(8, { sessionUpdate: 'tool_call_update', toolCallId: 'g3', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'fatal: not a git repository' } }] }),
  upd(9, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The spread filter ' } }),
  upd(9, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'caps at 2.0 points.' } }),
  upd(10, { sessionUpdate: 'turn_completed', stop_reason: 'end_turn', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, elapsed_ms: 9000 }, '_x.ai/session/update'),
  // A second turn, cancelled while a command waits
  upd(20, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Now run the tester' }, _meta: { modelId: 'grok-4.7', promptIndex: 1 } }),
  upd(21, { sessionUpdate: 'tool_call', toolCallId: 'g4', title: 'run_terminal_command', rawInput: { command: 'terminal64.exe /config:tester.ini' }, _meta: xtool('run_terminal_command', 'execute') }),
  upd(25, { sessionUpdate: 'turn_completed', stop_reason: 'cancelled' }, '_x.ai/session/update'),
])
const gev = (s, type, extra = {}) => ({ ts: at(s), type, ...extra })
write(join(gdir, 'events.jsonl'), [
  gev(1, 'turn_started', { session_id: GROK_SESSION, turn_number: 0, model_id: 'grok-4.7' }),
  gev(3, 'tool_started', { tool_name: 'read_file' }),
  gev(3, 'permission_requested', { tool_name: 'read_file' }),
  gev(3, 'permission_resolved', { tool_name: 'read_file', decision: 'allow', wait_ms: 0 }),
  gev(4, 'tool_completed', { tool_name: 'read_file', outcome: 'success', tool_call_id: 'g1' }),
  gev(10, 'turn_ended', { outcome: 'completed' }),
])
mkdirSync(gdir, { recursive: true })
writeFileSync(join(gdir, 'summary.json'), JSON.stringify({ info: { id: GROK_SESSION, cwd: GROK_CWD }, session_summary: 'Check the spread filter', current_model_id: 'grok-4.7', session_kind: 'interactive' }))
// A session folder without a stream is not a session the office can show
write(join(HERE, 'grok', 'sessions', encodeURIComponent(GROK_CWD), '01a1e000-0000-7000-8000-000000000002', 'chat_history.jsonl'), [{ type: 'system', content: 'x' }])
console.log('provider fixtures written')
