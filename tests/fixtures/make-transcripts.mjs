#!/usr/bin/env node
/**
 * Writes tests/fixtures/transcripts/: realistic Claude Code transcripts (the
 * JSONL shapes Claude Code 2.1.x writes: one record per content block,
 * tool_result rows with toolUseResult, sidechain workers under
 * <session>/subagents/agent-<id>.jsonl) for the hookless transcript mode.
 *
 *   A  EA Development          School Run baseline: Read, a foreground worker
 *                              (Grep, Read), then an MT5 backtest Bash call
 *                              that waits ~19 s on a permission dialog
 *   B  EA Development\DAX Ideas  a background Explore worker (WebSearch, a
 *                              failing Bash, Write), its wake-up, an Edit
 *                              rejected after a ~9 s dialog, an interrupt
 *   C  Projects\insider-alpha  another project (hidden by the EA preset)
 *
 * Re-run after editing: node tests/fixtures/make-transcripts.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'transcripts')
const T0 = Date.parse('2026-11-12T03:00:00.000Z')
const ts = s => new Date(T0 + s * 1000).toISOString()
let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

function writer(file, { sessionId, cwd, agentId, branch = 'ea-dev' }) {
  const rows = []
  let parent = null
  const base = (s, extra) => {
    const u = uuid()
    const r = { parentUuid: parent, isSidechain: !!agentId, userType: 'external', cwd, sessionId, version: '2.1.300', gitBranch: branch,
      ...(agentId ? { agentId } : {}), ...extra, uuid: u, timestamp: ts(s) }
    parent = u
    rows.push(r)
    return r
  }
  let msg = 0
  return {
    rows, file,
    raw: r => rows.push(r),
    prompt: (s, text, extra = {}) => base(s, { type: 'user', message: { role: 'user', content: text }, permissionMode: 'default', ...(agentId ? {} : { promptId: `p-${uuid().slice(-6)}` }), ...extra }),
    text: (s, text, stop = null, model = 'claude-opus-4-1') => base(s, { type: 'assistant', requestId: `req_${++msg}`,
      message: { id: `msg_${sessionId.slice(0, 4)}${agentId ?? ''}${msg}`, type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: stop, stop_sequence: null,
        usage: { input_tokens: 1200, cache_read_input_tokens: 24000, output_tokens: 180 } } }),
    tool: (s, id, name, input, model = 'claude-opus-4-1') => base(s, { type: 'assistant', requestId: `req_${++msg}`,
      message: { id: `msg_${sessionId.slice(0, 4)}${agentId ?? ''}${msg}`, type: 'message', role: 'assistant', model, content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', stop_sequence: null,
        usage: { input_tokens: 900, cache_read_input_tokens: 25000, output_tokens: 90 } } }),
    result: (s, id, content, toolUseResult, isError = false) => base(s, { type: 'user',
      message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, ...(isError ? { is_error: true } : {}) }] },
      toolUseResult: toolUseResult ?? content }),
  }
}

const EA = 'C:\\Users\\Barnesy\\OneDrive\\EA Development'
const DAX = `${EA}\\DAX Ideas`
const OTHER = 'C:\\Users\\Barnesy\\Projects\\insider-alpha'
const enc = p => p.replace(/[^A-Za-z0-9]/g, '-')

// ── A: School Run baseline ────────────────────────────────────────────────
const SA = 'a1111111-2222-4333-8444-555555555555'
const A = writer(join(OUT, enc(EA), `${SA}.jsonl`), { sessionId: SA, cwd: EA })
A.raw({ type: 'summary', summary: 'School Run 2.7 baseline check', leafUuid: '00000000-0000-4000-8000-000000000000' })
A.prompt(0, 'Re-run the School Run 2.7 DAX baseline on MT5 real ticks for 2019 to Aug 2026, and audit the one-lot rounding on the way.')
A.text(2, "I'll check the EA inputs first, then hand the rounding audit to a worker.")
A.tool(2.5, 'toolu_A1', 'Read', { file_path: `${EA}\\TraderTomSchoolRunEA.mq5` })
A.result(3.5, 'toolu_A1', 'input double DailyBudgetPct = 2.0;\ninput double FirstTradeShare = 0.375;\n...', { type: 'text', file: { filePath: `${EA}\\TraderTomSchoolRunEA.mq5`, numLines: 1840 } })
const AGENT_PROMPT = 'Audit how lot sizes round up to the 1-lot minimum on the TradeNation account in TraderTomSchoolRunEA.mq5. Report every place the size is rounded and the worst-case risk overshoot.'
A.tool(5, 'toolu_A2', 'Agent', { description: 'Audit one-lot rounding', prompt: AGENT_PROMPT, subagent_type: 'general-purpose' })
const AID = 'a7f3c2e9b1d4e5f60'
const W = writer(join(OUT, enc(EA), SA, 'subagents', `agent-${AID}.jsonl`), { sessionId: SA, cwd: EA, agentId: AID })
W.prompt(6, AGENT_PROMPT)
W.tool(8, 'toolu_W1', 'Grep', { pattern: 'MathCeil|NormalizeDouble|SYMBOL_VOLUME_MIN', path: EA }, 'claude-sonnet-4-5')
W.result(9, 'toolu_W1', 'TraderTomSchoolRunEA.mq5:612\nTraderTomSchoolRunEA.mq5:655\nTraderTomSchoolRunEA.mq5:701', { mode: 'content', numFiles: 1 })
W.tool(11, 'toolu_W2', 'Read', { file_path: `${EA}\\TraderTomSchoolRunEA.mq5`, offset: 600, limit: 120 }, 'claude-sonnet-4-5')
W.result(12, 'toolu_W2', 'double lots = MathMax(minLot, MathCeil(raw / step) * step);', { type: 'text' })
const AUDIT = 'Sizes round up in 3 places (lines 612, 655, 701). On a 1-lot minimum the first trade can risk up to 1.9x its 0.75% budget on small balances.'
W.text(15, AUDIT, 'end_turn', 'claude-sonnet-4-5')
A.result(16, 'toolu_A2', [{ type: 'text', text: AUDIT }], { status: 'completed', prompt: AGENT_PROMPT, agentId: AID, content: [{ type: 'text', text: AUDIT }], totalDurationMs: 10400, totalTokens: 18250, totalToolUseCount: 2 })
A.tool(18, 'toolu_A3', 'Bash', { command: '"C:\\Program Files\\TradeNation MT5\\terminal64.exe" /config:"tester\\schoolrun_2019_2026.ini"', description: 'Run the MT5 real-ticks backtest', timeout: 600000 })
// ~19 s with no answer (a permission dialog, then the run): past the 15 s Bash grace
A.result(37, 'toolu_A3', 'Tester finished. Net profit 12,243,880.40  Max drawdown 18.84%  Trades 1712', { stdout: 'Tester finished. Net profit 12,243,880.40  Max drawdown 18.84%  Trades 1712', stderr: '', interrupted: false, isImage: false })
A.text(39, 'Baseline reproduced: 12.24m net, 18.84% max drawdown at 2%. The rounding audit says small balances overshoot the first-trade budget by up to 1.9x; worth a cap.', 'end_turn')

// ── B: DAX ideas with a background worker ──────────────────────────────────
const SB = 'b2222222-3333-4444-8555-666666666666'
const B = writer(join(OUT, enc(DAX), `${SB}.jsonl`), { sessionId: SB, cwd: DAX })
B.prompt(4, 'Find DAX ideas: is a Bund daily yield change filter worth testing? Check what data we can get first.')
const EXPLORE_PROMPT = 'Find free daily Bund 10y yield sources back to 2013 with publication timestamps, and note how each could be loaded.'
B.tool(6, 'toolu_B1', 'Agent', { description: 'Scan Bund yield data sources', prompt: EXPLORE_PROMPT, subagent_type: 'Explore', run_in_background: true }, 'claude-sonnet-4-5')
const BID = 'b9e8d7c6a5f4e3d20'
B.result(7, 'toolu_B1', [{ type: 'text', text: 'Async agent launched successfully.' }], { status: 'async_launched', agentId: BID, description: 'Scan Bund yield data sources', prompt: EXPLORE_PROMPT })
B.text(8, "The Explorer is scanning data sources in the background; I'll pick this up when it reports.", 'end_turn', 'claude-sonnet-4-5')
const X = writer(join(OUT, enc(DAX), SB, 'subagents', `agent-${BID}.jsonl`), { sessionId: SB, cwd: DAX, agentId: BID })
X.prompt(8.5, EXPLORE_PROMPT)
X.tool(10, 'toolu_X1', 'WebSearch', { query: 'Bundesbank daily 10 year Bund yield time series download' }, 'claude-haiku-4-5')
X.result(12, 'toolu_X1', 'Bundesbank time series database: BBSIS.D.I.ZST.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A ...', { query: 'Bundesbank daily 10 year Bund yield', durationSeconds: 1.8 })
X.tool(14, 'toolu_X2', 'Bash', { command: 'python tools/bund_fetch.py --dry-run', description: 'Try the existing fetch script' }, 'claude-haiku-4-5')
X.result(15, 'toolu_X2', "Exit code 1\nModuleNotFoundError: No module named 'pandas_datareader'", undefined, true)
X.tool(17, 'toolu_X3', 'Write', { file_path: `${DAX}\\research\\bund-sources.md`, content: '# Bund yield sources\n...' }, 'claude-haiku-4-5')
X.result(18, 'toolu_X3', `File created successfully at: ${DAX}\\research\\bund-sources.md`, { type: 'create', filePath: `${DAX}\\research\\bund-sources.md` })
X.text(20, 'Found 3 sources (Bundesbank BBSIS, ECB SDW, FRED IRLTLT01DEM156N monthly only). Bundesbank publishes ~16:00 CET, so a same-day filter must use the previous close.', 'end_turn', 'claude-haiku-4-5')
B.prompt(22, `<task-notification>\n<task-id>${BID}</task-id>\n<status>completed</status>\n<summary>Agent "Scan Bund yield data sources" completed</summary>\n<result>Found 3 sources...</result>\n</task-notification>`)
B.tool(24, 'toolu_B2', 'Edit', { file_path: `${DAX}\\research\\IDEAS.md`, old_string: '## Queue', new_string: '## Queue\n- Bund daily yield change (prev close only)' }, 'claude-sonnet-4-5')
// ~9 s dialog, then rejected in the terminal
B.result(33, 'toolu_B2', "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.", undefined, true)
B.prompt(33.2, '[Request interrupted by user for tool use]')
B.prompt(35, "Don't edit the ideas file yet, just summarise what you found.")
B.text(37, 'Bund daily change is testable from 2013 with the Bundesbank series; it must lag one day (published after the DAX close). Next step: one label, direction only.', 'end_turn', 'claude-sonnet-4-5')

// ── C: another project ─────────────────────────────────────────────────────
const SC = 'c3333333-4444-4555-8666-777777777777'
const C = writer(join(OUT, enc(OTHER), `${SC}.jsonl`), { sessionId: SC, cwd: OTHER, branch: 'main' })
C.prompt(3, 'Why did the last insider batch skip BMNR?')
C.tool(5, 'toolu_C1', 'Read', { file_path: `${OTHER}\\batches\\latest.json` })
C.result(6, 'toolu_C1', '{"skipped":["BMNR"],"reason":"size guard"}', { type: 'text' })
C.text(8, 'BMNR hit the size guard.', 'end_turn')

rmSync(OUT, { recursive: true, force: true })
for (const w of [A, W, B, X, C]) {
  mkdirSync(dirname(w.file), { recursive: true })
  writeFileSync(w.file, w.rows.map(r => JSON.stringify(r)).join('\n') + '\n')
}
console.log(`wrote ${OUT}`)
