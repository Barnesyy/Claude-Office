#!/usr/bin/env node
/**
 * make-ea-fixtures.mjs — MT5 files and Claude Code transcripts for the EA
 * scenes (server/ea-scenes.js), all clearly fixtures: the EA is called
 * "SchoolRun_FIXTURE" and every number in the reports comes from a seeded
 * random walk below, not from any real test.
 *
 *   writeMt5Files(dir)            a tester report as MT5 writes it (UTF-16LE
 *                                 HTML with a BOM) and as Excel XML, a tester
 *                                 ini (UTF-16LE), MetaEditor logs with and
 *                                 without errors (UTF-16LE)
 *   eaSessionRecords(root, opts)  one session's transcript records: it reads a
 *                                 .set, edits lot sizing in a .mq5, compiles
 *                                 (2 errors), fixes and compiles clean, pulls
 *                                 tick data for 2019-2023, runs the tester
 *
 * `node tests/fixtures/ea/make-ea-fixtures.mjs` rewrites tests/fixtures/ea/files/.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** UTF-16LE with a BOM, as MT5 writes its reports, ini files and logs */
export const utf16 = s => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')])

// A seeded walk: the same "deals" every time
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

/** 2 decimals, a space between thousands: "12 345.67" (MT5's own format) */
export const mt5Num = n => {
  const neg = n < 0
  const [i, d] = Math.abs(n).toFixed(2).split('.')
  return `${neg ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${d}`
}

/** The fixture run: deposit, deals (in/out pairs) and the totals they add up to. */
export function fixtureRun({ trades = 96, seed = 7 } = {}) {
  const r = rng(seed)
  const deposit = 10000
  let balance = deposit
  let peak = deposit
  let maxDd = 0
  let maxDdPct = 0
  let grossProfit = 0
  let grossLoss = 0
  const deals = [{ time: '2019.01.02 00:00:00', type: 'balance', profit: deposit, balance }]
  let t = Date.UTC(2019, 0, 2, 8, 15)
  for (let i = 0; i < trades; i++) {
    t += Math.floor(1 + r() * 36) * 86400_000
    const win = r() < 0.47
    const profit = Math.round((win ? 90 + r() * 260 : -(70 + r() * 120)) * 100) / 100
    const at = new Date(t)
    const stamp = d => `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:00`
    deals.push({ time: stamp(at), type: i % 2 ? 'sell' : 'buy', direction: 'in', profit: 0, balance })
    balance = Math.round((balance + profit) * 100) / 100
    if (profit > 0) grossProfit += profit; else grossLoss += profit
    deals.push({ time: stamp(new Date(t + 3 * 3600_000)), type: i % 2 ? 'buy' : 'sell', direction: 'out', profit, balance })
    if (balance > peak) peak = balance
    const dd = peak - balance
    if (dd > maxDd) { maxDd = dd; maxDdPct = (dd / peak) * 100 }
  }
  return {
    deposit, deals, trades,
    netProfit: Math.round((balance - deposit) * 100) / 100,
    grossProfit: Math.round(grossProfit * 100) / 100, grossLoss: Math.round(grossLoss * 100) / 100,
    balanceDd: Math.round(maxDd * 100) / 100, balanceDdPct: Math.round(maxDdPct * 100) / 100,
    // The fixture's floating drawdown: its balance drawdown and a little more
    equityDd: Math.round(maxDd * 1.08 * 100) / 100, equityDdPct: Math.round(maxDdPct * 1.08 * 100) / 100,
  }
}

/** A Strategy Tester report as MT5 5.x writes it to HTML (the parts that matter, same markup). */
export function reportHtml(run = fixtureRun(), { expert = 'SchoolRun_FIXTURE', symbol = 'GER40' } = {}) {
  const row = (cells) => `<tr align="right">${cells.map(([v, span]) => `<td nowrap${span ? ` colspan=${span}` : ''}>${v}</td>`).join('')}</tr>`
  const kv = (pairs) => `<tr align="right">${pairs.map(([k, v]) => `<td nowrap colspan=3>${k}</td><td nowrap><b>${v}</b></td>`).join('')}</tr>`
  const pf = run.grossLoss ? (run.grossProfit / -run.grossLoss).toFixed(2) : '0.00'
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html>
  <head>
    <title>${expert}: Strategy Tester Report</title>
    <meta name="generator" content="client terminal">
    <style type="text/css" media="screen"><!-- td { font: 8pt Tahoma,Arial; } //--></style>
  </head>
<body topmargin=1 marginheight=1>
<div align=center>
<table cellspacing=1 cellpadding=3 border=0 width=820>
<tr align=center><td colspan=13><div style="font: 14pt Tahoma"><b>Strategy Tester Report</b><br></div></td></tr>
<tr align=center><td colspan=13><div style="font: 10pt Tahoma"><b>FixtureBroker-Demo (Build 4620)</b><br><br></div></td></tr>
<tr align=left><td nowrap colspan=3>Expert:</td><td colspan=10><b>${expert}</b></td></tr>
<tr align=left><td nowrap colspan=3>Symbol:</td><td colspan=10><b>${symbol}</b></td></tr>
<tr align=left><td nowrap colspan=3>Period:</td><td colspan=10><b>M15 (2019.01.02 - 2023.12.29)</b></td></tr>
<tr align=left><td nowrap colspan=3>Company:</td><td colspan=10><b>Fixture Markets Ltd</b></td></tr>
<tr align=left><td nowrap colspan=3>Currency:</td><td colspan=10><b>AUD</b></td></tr>
<tr align=left><td nowrap colspan=3>Initial Deposit:</td><td colspan=10><b>${mt5Num(run.deposit)}</b></td></tr>
<tr><td colspan=13 style="height: 10px"></td></tr>
${kv([['History Quality:', '100% real ticks'], ['Bars:', '120 412'], ['Ticks:', '48 120 993']])}
${kv([['Total Net Profit:', mt5Num(run.netProfit)], ['Balance Drawdown Absolute:', '0.00'], ['Equity Drawdown Absolute:', '0.00']])}
${kv([['Gross Profit:', mt5Num(run.grossProfit)], ['Balance Drawdown Maximal:', `${mt5Num(run.balanceDd)} (${run.balanceDdPct.toFixed(2)}%)`], ['Equity Drawdown Maximal:', `${mt5Num(run.equityDd)} (${run.equityDdPct.toFixed(2)}%)`]])}
${kv([['Gross Loss:', mt5Num(run.grossLoss)], ['Balance Drawdown Relative:', `${run.balanceDdPct.toFixed(2)}% (${mt5Num(run.balanceDd)})`], ['Equity Drawdown Relative:', `${run.equityDdPct.toFixed(2)}% (${mt5Num(run.equityDd)})`]])}
${kv([['Profit Factor:', pf], ['Expected Payoff:', (run.netProfit / run.trades).toFixed(2)], ['Margin Level:', '812.40%']])}
${kv([['Total Trades:', String(run.trades)], ['Short Trades (won %):', '48 (45.83%)'], ['Long Trades (won %):', '48 (47.92%)']])}
${kv([['Total Deals:', String(run.deals.length)], ['Profit Trades (% of total):', '45 (46.88%)'], ['Loss Trades (% of total):', '51 (53.13%)']])}
</table>
<br>
<table cellspacing=1 cellpadding=3 border=0 width=820>
<tr align=center><td colspan=13><div style="font: 10pt Tahoma"><b>Deals</b></div></td></tr>
<tr align=center bgcolor="#E5F0FC"><td nowrap><b>Time</b></td><td nowrap><b>Deal</b></td><td nowrap><b>Symbol</b></td><td nowrap><b>Type</b></td><td nowrap><b>Direction</b></td><td nowrap><b>Volume</b></td><td nowrap><b>Price</b></td><td nowrap><b>Order</b></td><td nowrap><b>Commission</b></td><td nowrap><b>Swap</b></td><td nowrap><b>Profit</b></td><td nowrap><b>Balance</b></td><td nowrap><b>Comment</b></td></tr>
${run.deals.map((d, i) => `<tr bgcolor="${i % 2 ? '#F7F7F7' : '#FFFFFF'}" align=right><td>${d.time}</td><td>${i + 1}</td><td>${d.type === 'balance' ? '' : symbol}</td><td>${d.type}</td><td>${d.direction ?? ''}</td><td>${d.type === 'balance' ? '' : '1.00'}</td><td>${d.type === 'balance' ? '' : (15000 + i * 7).toFixed(1)}</td><td>${d.type === 'balance' ? '' : i + 1}</td><td>0.00</td><td>0.00</td><td>${mt5Num(d.profit)}</td><td>${mt5Num(d.balance)}</td><td>${d.direction === 'out' ? 'sl/tp' : ''}</td></tr>`).join('\n')}
${row([['', 9], [mt5Num(run.netProfit + run.deposit)], [mt5Num(run.netProfit + run.deposit)], ['']])}
</table>
</div>
</body>
</html>
`
}

/** The same run as MT5's "Excel" (SpreadsheetML 2003) report. */
export function reportXml(run = fixtureRun(), { expert = 'SchoolRun_FIXTURE', symbol = 'GER40' } = {}) {
  const cell = v => `<Cell><Data ss:Type="${typeof v === 'number' ? 'Number' : 'String'}">${v}</Data></Cell>`
  const kvRow = pairs => `<Row>${pairs.map(([k, v]) => `<Cell ss:MergeAcross="2"><Data ss:Type="String">${k}</Data></Cell>${cell(v)}`).join('')}</Row>`
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Tester"><Table>
<Row><Cell ss:MergeAcross="12"><Data ss:Type="String">Strategy Tester Report</Data></Cell></Row>
${kvRow([['Expert:', expert]])}
${kvRow([['Symbol:', symbol]])}
${kvRow([['Initial Deposit:', mt5Num(run.deposit)]])}
${kvRow([['Total Net Profit:', mt5Num(run.netProfit)], ['Balance Drawdown Maximal:', `${mt5Num(run.balanceDd)} (${run.balanceDdPct.toFixed(2)}%)`], ['Equity Drawdown Maximal:', `${mt5Num(run.equityDd)} (${run.equityDdPct.toFixed(2)}%)`]])}
${kvRow([['Total Trades:', run.trades]])}
<Row>${['Time', 'Deal', 'Symbol', 'Type', 'Direction', 'Volume', 'Price', 'Order', 'Commission', 'Swap', 'Profit', 'Balance', 'Comment'].map(cell).join('')}</Row>
${run.deals.map((d, i) => `<Row>${cell(d.time)}${cell(i + 1)}${cell(d.type === 'balance' ? '' : symbol)}${cell(d.type)}${cell(d.direction ?? '')}<Cell ss:Index="11"><Data ss:Type="Number">${d.profit}</Data></Cell>${cell(d.balance)}</Row>`).join('\n')}
</Table></Worksheet>
</Workbook>
`
}

/** A tester ini as Jake's runs write it ([Tester] Model=4: every tick based on real ticks). */
export function testerIni({ expert = 'School Run\\SchoolRun_FIXTURE.ex5', report = 'ReportTester-SchoolRun_FIXTURE', symbol = 'GER40' } = {}) {
  return `[Common]\r\nLogin=0\r\n[Tester]\r\nExpert=${expert}\r\nSymbol=${symbol}\r\nPeriod=M15\r\nModel=4\r\nFromDate=2019.01.02\r\nToDate=2023.12.29\r\nDeposit=10000\r\nCurrency=AUD\r\nLeverage=1:100\r\nReport=${report}\r\nReplaceReport=1\r\nShutdownTerminal=1\r\n`
}

/** A MetaEditor compile log: `errors` errors (with their lines), and the result line. */
export function compileLog({ file = 'SchoolRun_FIXTURE.mq5', errors = 2, warnings = 1 } = {}) {
  const lines = [`${file} : information: compiling '${file}'`]
  for (let i = 0; i < errors; i++) lines.push(`${file}(${612 + i * 43},${9 + i}) : error 256: 'lotStepFixture' - undeclared identifier`)
  for (let i = 0; i < warnings; i++) lines.push(`${file}(701,12) : warning 43: possible loss of data due to type conversion from 'double' to 'long'`)
  lines.push(`Result: ${errors} errors, ${warnings} warnings, 1102 msec elapsed`)
  return lines.join('\r\n') + '\r\n'
}

/** Writes the MT5 fixtures into `dir`; returns their paths. */
export function writeMt5Files(dir, run = fixtureRun()) {
  mkdirSync(dir, { recursive: true })
  const files = {
    html: join(dir, 'ReportTester-SchoolRun_FIXTURE.htm'),
    xml: join(dir, 'ReportTester-SchoolRun_FIXTURE.xml'),
    ini: join(dir, 'tester-SchoolRun_FIXTURE.ini'),
    logErrors: join(dir, 'compile-errors.log'),
    logClean: join(dir, 'compile-clean.log'),
  }
  writeFileSync(files.html, utf16(reportHtml(run)))
  writeFileSync(files.xml, reportXml(run))
  writeFileSync(files.ini, utf16(testerIni()))
  writeFileSync(files.logErrors, utf16(compileLog({ errors: 2, warnings: 1 })))
  writeFileSync(files.logClean, utf16(compileLog({ errors: 0, warnings: 1 })))
  return files
}

/**
 * One EA session's transcript records (Claude Code 2.1 shapes), in time
 * order, each with `at` (seconds from the start) and, for a tool result that
 * should leave a file behind, `writes: [{ path, data }]` (a replay writes it
 * as the record lands, so its mtime is the run's own).
 * @param {string} root the EA folder (posix or Windows path)
 * @param {{ sessionId?: string, sep?: string, reportWritten?: boolean }} [opts]
 */
export function eaSessionRecords(root, { sessionId = 'e5555555-6666-4777-8888-999999999999', sep = '/', reportWritten = true } = {}) {
  const j = (...p) => [root, ...p].join(sep)
  const ea = j('School Run')
  const mq5 = j('School Run', 'SchoolRun_FIXTURE.mq5')
  const set = j('School Run', 'SchoolRun_FIXTURE.set')
  const ini = j('School Run', 'tester-SchoolRun_FIXTURE.ini')
  const report = j('School Run', 'ReportTester-SchoolRun_FIXTURE.htm')
  const logErr = j('School Run', 'compile-1.log')
  const logOk = j('School Run', 'compile-2.log')
  const run = fixtureRun()
  const out = []
  let n = 0
  let parent = null
  const uuid = () => `00000000-0000-4eae-8000-${String(++n).padStart(12, '0')}`
  const base = (at, extra) => {
    const u = uuid()
    const r = { parentUuid: parent, isSidechain: false, userType: 'external', cwd: ea, sessionId, version: '2.1.300', gitBranch: 'ea-dev', ...extra, uuid: u }
    parent = u
    out.push({ at, record: r })
    return out[out.length - 1]
  }
  const prompt = (at, text) => base(at, { type: 'user', message: { role: 'user', content: text }, permissionMode: 'default', promptId: `p-ea${n}` })
  const say = (at, text, stop = null) => base(at, { type: 'assistant', requestId: `req_ea${n}`, message: { id: `msg_ea${n}`, type: 'message', role: 'assistant', model: 'claude-opus-4-1', content: [{ type: 'text', text }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 120 } } })
  const tool = (at, id, name, input) => base(at, { type: 'assistant', requestId: `req_ea${n}`, message: { id: `msg_ea${n}`, type: 'message', role: 'assistant', model: 'claude-opus-4-1', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 90 } } })
  const result = (at, id, content, toolUseResult, isError = false) => base(at, { type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, ...(isError ? { is_error: true } : {}) }] }, toolUseResult: toolUseResult ?? content })

  prompt(0, 'Tighten the School Run first-trade lot rounding, recompile, top up the 2019-2023 real ticks and re-run the M15 real-tick backtest.')
  say(1.5, "I'll check the preset first.")
  tool(2, 'toolu_ea1', 'Read', { file_path: set })
  result(3, 'toolu_ea1', 'InpRiskPercent=0.75\nInpFirstTradeShare=0.375', { type: 'text' })
  tool(4, 'toolu_ea2', 'Edit', { file_path: mq5, old_string: 'double lots = MathMax(minLot, MathCeil(raw / step) * step);', new_string: 'double lots = MathMax(minLot, MathFloor(raw / lotStepFixture) * lotStepFixture);\nif(lots * slPoints * tickValue > InpRiskPercent * balance / 100.0) lots = 0;' })
  result(5, 'toolu_ea2', `The file ${mq5} has been updated.`, { filePath: mq5 })
  const compile = (at, id, log) => tool(at, id, 'Bash', { command: `"/opt/mt5/metaeditor64.exe" /compile:"${mq5}" /log:"${log}"`, description: 'Compile the EA' })
  compile(6, 'toolu_ea3', logErr)
  result(9, 'toolu_ea3', '', { stdout: '', stderr: '', interrupted: false }).writes = [{ path: logErr, data: utf16(compileLog({ errors: 2, warnings: 1 })) }]
  say(10, 'Two undeclared identifiers: declaring the step.')
  tool(11, 'toolu_ea4', 'Edit', { file_path: mq5, old_string: 'double minLot', new_string: 'double lotStepFixture = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);\ndouble minLot' })
  result(12, 'toolu_ea4', `The file ${mq5} has been updated.`, { filePath: mq5 })
  compile(13, 'toolu_ea5', logOk)
  result(16, 'toolu_ea5', '', { stdout: '', stderr: '', interrupted: false }).writes = [{ path: logOk, data: utf16(compileLog({ errors: 0, warnings: 1 })) }]
  tool(17, 'toolu_ea6', 'Bash', { command: `python tools/dukascopy_ticks.py --symbol GER40 --from 2019 --to 2023 --out "${j('ticks')}"`, description: 'Top up real ticks' })
  result(27, 'toolu_ea6', 'GER40 2019..2023: 5 years, 1 247 files up to date', { stdout: 'GER40 2019..2023: 5 years, 1 247 files up to date', stderr: '', interrupted: false })
  tool(28, 'toolu_ea7', 'Bash', { command: `"/opt/mt5/terminal64.exe" /config:"${ini}"`, description: 'Run the MT5 real-tick backtest', timeout: 3600000 })
  const done = result(44, 'toolu_ea7', '', { stdout: '', stderr: '', interrupted: false })
  if (reportWritten) done.writes = [{ path: report, data: utf16(reportHtml(run)) }]
  say(45, reportWritten ? 'The tester report is in; summarising it.' : 'The tester exited without a report.', 'end_turn')
  return {
    records: out, run,
    /** When the tester's tool result lands (s) */
    testerDoneAt: done.at,
    files: { mq5, set, ini, report, logErr, logOk, ea },
    // Written before the session starts: the ini the tester reads (Report= next to it)
    setup: [
      { path: ini, data: utf16(testerIni({ report: report })) },
      { path: mq5, data: Buffer.from('// SchoolRun_FIXTURE.mq5 (fixture)\n') },
      { path: set, data: utf16('InpRiskPercent=0.75\r\nInpFirstTradeShare=0.375\r\n') },
    ],
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = writeMt5Files(join(HERE, 'files'))
  console.log(Object.values(files).join('\n'))
}
