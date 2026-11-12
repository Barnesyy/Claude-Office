#!/usr/bin/env node
/**
 * Writes tests/fixtures/progression-transcripts/: one EA Development session
 * (School Run) that exercises every progression fact the watcher reads, in
 * the JSONL shapes tests/fixtures/make-transcripts.mjs uses:
 *
 *   a failing vitest run, an Edit, the same run green (a lesson: fail → fix),
 *   a MetaEditor compile with 0 errors, an MT5 walk-forward tester run
 *   (terminal64 /config:...wf....ini), a git commit, a git push, a gh pr
 *   merge, a worker that finishes, and the turn's end.
 *
 * Re-run after editing: node tests/fixtures/make-progression-transcripts.mjs
 * Play it: node scripts/replay-transcripts.mjs --from tests/fixtures/progression-transcripts
 */
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'progression-transcripts')
const T0 = Date.parse('2026-11-12T04:00:00.000Z')
const ts = s => new Date(T0 + s * 1000).toISOString()
let n = 0
const uuid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`

function writer(file, { sessionId, cwd, agentId, branch = 'ea-progression' }) {
  const rows = []
  let parent = null
  let msg = 0
  const base = (s, extra) => {
    const u = uuid()
    const r = { parentUuid: parent, isSidechain: !!agentId, userType: 'external', cwd, sessionId, version: '2.1.300', gitBranch: branch,
      ...(agentId ? { agentId } : {}), ...extra, uuid: u, timestamp: ts(s) }
    parent = u
    rows.push(r)
    return r
  }
  const asst = (s, content, stop, model) => base(s, { type: 'assistant', requestId: `req_p${++msg}`,
    message: { id: `msg_p${sessionId.slice(0, 4)}${agentId ?? ''}${msg}`, type: 'message', role: 'assistant', model, content, stop_reason: stop, stop_sequence: null,
      usage: { input_tokens: 900, cache_read_input_tokens: 25000, output_tokens: 120 } } })
  return {
    rows, file,
    raw: r => rows.push(r),
    prompt: (s, text) => base(s, { type: 'user', message: { role: 'user', content: text }, permissionMode: 'acceptEdits', ...(agentId ? {} : { promptId: `pp-${uuid().slice(-6)}` }) }),
    text: (s, text, stop = null, model = 'claude-opus-4-1') => asst(s, [{ type: 'text', text }], stop, model),
    tool: (s, id, name, input, model = 'claude-opus-4-1') => asst(s, [{ type: 'tool_use', id, name, input }], 'tool_use', model),
    result: (s, id, content, toolUseResult, isError = false) => base(s, { type: 'user',
      message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, ...(isError ? { is_error: true } : {}) }] },
      toolUseResult: toolUseResult ?? content }),
  }
}

const EA = 'C:\\Users\\Barnesy\\OneDrive\\EA Development'
const SR = `${EA}\\School Run`
const enc = p => p.replace(/[^A-Za-z0-9]/g, '-')
const bash = (stdout, stderr = '') => ({ stdout, stderr, interrupted: false, isImage: false })

const SD = 'd4444444-5555-4666-8777-888888888888'
const D = writer(join(OUT, enc(SR), `${SD}.jsonl`), { sessionId: SD, cwd: SR })
D.raw({ type: 'summary', summary: 'Ship the one-lot rounding cap', leafUuid: '00000000-0000-4000-9000-000000000000' })
D.prompt(0, 'Cap the one-lot rounding overshoot, prove it with the tests and a walk-forward, then ship it.')
D.text(1.5, 'Running the lot-size tests first.')
D.tool(2, 'toolu_D1', 'Bash', { command: 'cd tools && npx vitest run tests/lots.test.ts', description: 'Lot-size tests' })
D.result(5, 'toolu_D1', 'Exit code 1\n FAIL  tests/lots.test.ts > caps the first trade at 1.25x budget\n Tests  1 failed | 41 passed (42)', undefined, true)
D.tool(6, 'toolu_D2', 'Edit', { file_path: `${SR}\\TraderTomSchoolRunEA.mq5`, old_string: 'double lots = MathMax(minLot, MathCeil(raw / step) * step);', new_string: 'double lots = CapRoundedLots(raw, minLot, step, budget);' })
D.result(7, 'toolu_D2', `The file ${SR}\\TraderTomSchoolRunEA.mq5 has been updated.`, { filePath: `${SR}\\TraderTomSchoolRunEA.mq5` })
D.tool(8, 'toolu_D3', 'Bash', { command: 'cd tools && npx vitest run tests/lots.test.ts', description: 'Lot-size tests again' })
D.result(11, 'toolu_D3', ' ✓ tests/lots.test.ts (42 tests) 31ms\n Test Files  1 passed (1)\n      Tests  42 passed (42)', bash(' ✓ tests/lots.test.ts (42 tests) 31ms\n Test Files  1 passed (1)\n      Tests  42 passed (42)'))
D.tool(12, 'toolu_D4', 'Bash', { command: '"C:\\Program Files\\TradeNation MT5\\metaeditor64.exe" /compile:"TraderTomSchoolRunEA.mq5" /log', description: 'Compile the EA' })
D.result(14, 'toolu_D4', 'Result: 0 errors, 2 warnings, 1840 msec elapsed', bash('Result: 0 errors, 2 warnings, 1840 msec elapsed'))
D.tool(15, 'toolu_D5', 'Bash', { command: '"C:\\Program Files\\TradeNation MT5\\terminal64.exe" /config:"tester\\schoolrun_wf_2019_2026.ini"', description: 'MT5 walk-forward, real ticks', timeout: 1800000 })
D.result(24, 'toolu_D5', 'Tester finished. Forward pass 1/4: PF 1.41, max DD 16.2%', bash('Tester finished. Forward pass 1/4: PF 1.41, max DD 16.2%'))
D.tool(25, 'toolu_D6', 'Bash', { command: 'git add TraderTomSchoolRunEA.mq5 && git commit -m "Cap one-lot rounding at 1.25x the trade budget"', description: 'Commit' })
D.result(26, 'toolu_D6', '[ea-progression 3f2a9c1] Cap one-lot rounding at 1.25x the trade budget\n 1 file changed, 14 insertions(+), 3 deletions(-)', bash('[ea-progression 3f2a9c1] Cap one-lot rounding at 1.25x the trade budget\n 1 file changed, 14 insertions(+), 3 deletions(-)'))
D.tool(27, 'toolu_D7', 'Bash', { command: 'git push origin ea-progression', description: 'Push' })
D.result(29, 'toolu_D7', 'To github.com:Barnesyy/school-run.git\n   9b1d2e0..3f2a9c1  ea-progression -> ea-progression', bash('', 'To github.com:Barnesyy/school-run.git\n   9b1d2e0..3f2a9c1  ea-progression -> ea-progression'))
D.tool(30, 'toolu_D8', 'Bash', { command: 'gh pr merge 42 --squash --repo Barnesyy/school-run', description: 'Merge the PR' })
D.result(32, 'toolu_D8', '✓ Squashed and merged pull request Barnesyy/school-run#42 (Cap one-lot rounding)', bash('✓ Squashed and merged pull request Barnesyy/school-run#42 (Cap one-lot rounding)'))
const AGENT_PROMPT = 'Write the 14-day reconciliation note for the rounding cap.'
D.tool(33, 'toolu_D9', 'Agent', { description: 'Reconciliation note', prompt: AGENT_PROMPT, subagent_type: 'general-purpose' })
const AID = 'd7f3c2e9b1d4e5f61'
const W = writer(join(OUT, enc(SR), SD, 'subagents', `agent-${AID}.jsonl`), { sessionId: SD, cwd: SR, agentId: AID })
W.prompt(34, AGENT_PROMPT)
W.tool(35, 'toolu_DW1', 'Write', { file_path: `${SR}\\notes\\reconciliation.md`, content: '# 14-day reconciliation\n...' }, 'claude-sonnet-4-5')
W.result(36, 'toolu_DW1', `File created successfully at: ${SR}\\notes\\reconciliation.md`, { type: 'create', filePath: `${SR}\\notes\\reconciliation.md` })
W.text(38, 'Reconciliation note written: 14 days, no size breach after the cap.', 'end_turn', 'claude-sonnet-4-5')
D.result(39, 'toolu_D9', [{ type: 'text', text: 'Reconciliation note written.' }], { status: 'completed', prompt: AGENT_PROMPT, agentId: AID, content: [{ type: 'text', text: 'Reconciliation note written.' }], totalDurationMs: 4200, totalTokens: 6100, totalToolUseCount: 1 })
D.text(41, 'Shipped: tests green after the fix, EA compiles clean, walk-forward pass 1/4 PF 1.41, PR #42 merged.', 'end_turn')

rmSync(OUT, { recursive: true, force: true })
for (const w of [D, W]) {
  mkdirSync(dirname(w.file), { recursive: true })
  writeFileSync(w.file, w.rows.map(r => JSON.stringify(r)).join('\n') + '\n')
}
console.log(`wrote ${OUT}`)
