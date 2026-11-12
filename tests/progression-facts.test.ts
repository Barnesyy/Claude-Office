/**
 * progression-facts.test.ts - what the transcript watcher reads out of tool
 * calls for progression (server/progression-facts.js): commits, pushes, PR
 * merges, MT5 tester runs (walk-forward from the ini), EA compiles, and
 * lessons (a failure, then the same thing working). Labels never carry
 * command arguments, output or paths beyond a file name.
 */

import { describe, expect, it } from 'vitest'
import {
  splitSegments, programOf, labelOf, testOrBuild, decodeText, parseTesterIni, configArg, mt5RunInfo, bashFacts, lessonKey, FactExtractor,
} from '../server/progression-facts.js'

const AT = Date.parse('2026-11-12T00:00:00Z')

describe('reading a command', () => {
  it('splits on && ; | and newlines, not inside quotes', () => {
    expect(splitSegments('cd x && npm test; git commit -m "a && b"')).toHaveLength(3)
  })
  it('programOf strips env assignments and wrappers, and Windows paths', () => {
    expect(programOf('CI=1 npx vitest run')?.program).toBe('vitest')
    expect(programOf('"C:\\Program Files\\MetaTrader 5\\terminal64.exe" /config:x.ini')?.program).toBe('terminal64')
  })
  it('labels are the program and subcommands only', () => {
    expect(labelOf(programOf('npm run build -- --secret=abc')!)).toBe('npm run build')
    expect(labelOf(programOf('git commit -m "my message"')!)).not.toMatch(/message/)
  })
  it('test or build', () => {
    expect(testOrBuild(programOf('npx vitest run')!)).toBe('test')
    expect(testOrBuild(programOf('npm run build')!)).toBe('build')
    expect(testOrBuild(programOf('ls -la')!)).toBeNull()
  })
  it('decodes UTF-16LE / BE and UTF-8', () => {
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('[Tester]', 'utf16le')]))).toBe('[Tester]')
    const be = Buffer.from('ab', 'utf16le').swap16()
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe('ab')
    expect(decodeText(Buffer.from('plain'))).toBe('plain')
  })
  it('reads the [Tester] section of an ini and the /config: argument', () => {
    expect(parseTesterIni('[Common]\nLogin=1\n[Tester]\nExpert=SchoolRun.ex5\nForwardMode=2\n[Other]\nX=1')).toEqual({ Expert: 'SchoolRun.ex5', ForwardMode: '2' })
    expect(configArg(['/config:"tester\\a.ini"'])).toBe('tester\\a.ini')
    expect(configArg(['/portable'])).toBeNull()
  })
})

describe('MT5 tester runs', () => {
  const ini = (body: string) => ({ read: () => Buffer.from(`[Tester]\n${body}`), mtimeMs: () => { throw new Error('none') } })
  it('walk-forward comes from ForwardMode in the ini when it can be read', () => {
    expect(mt5RunInfo('plain.ini', { cwd: '/x', at: AT, io: ini('ForwardMode=1') })).toMatchObject({ walkForward: true, source: 'ini' })
    expect(mt5RunInfo('wf_named.ini', { cwd: '/x', at: AT, io: ini('ForwardMode=0') })).toMatchObject({ walkForward: false, source: 'ini' })
  })
  it('an unreadable ini falls back to its name', () => {
    const none = { read: () => { throw new Error('no') }, mtimeMs: () => { throw new Error('no') } }
    expect(mt5RunInfo('tester\\schoolrun_wf_2019.ini', { at: AT, io: none })).toMatchObject({ walkForward: true, source: 'name' })
    expect(mt5RunInfo('tester\\schoolrun_2019.ini', { at: AT, io: none })).toMatchObject({ walkForward: false, source: 'name' })
  })
  it('a report counts only when this run wrote it', () => {
    const io = (m: number) => ({ read: () => Buffer.from('[Tester]\nReport=reports\\sr\n'), mtimeMs: (p: string) => { if (p.endsWith('.htm')) return m; throw new Error('no') } })
    expect(mt5RunInfo('a.ini', { at: AT, io: io(AT - 60_000) }).report).toBe(true)
    expect(mt5RunInfo('a.ini', { at: AT, io: io(AT - 30 * 86400_000) }).report).toBe(false)
  })
  it('bashFacts: a finished foreground run counts; a background or failed one does not', () => {
    const io = { read: () => Buffer.from('[Tester]\nForwardMode=0'), mtimeMs: () => 0 }
    const cmd = '"C:\\Program Files\\MetaTrader 5\\terminal64.exe" /config:"tester\\a.ini"'
    expect(bashFacts({ command: cmd, ok: true, output: '', at: AT, io })).toEqual([expect.objectContaining({ kind: 'mt5_run', walkForward: false })])
    expect(bashFacts({ command: cmd, ok: true, output: '', at: AT, io, background: true })).toEqual([])
    expect(bashFacts({ command: cmd, ok: false, output: '', at: AT, io })).toEqual([])
    expect(bashFacts({ command: 'terminal64.exe', ok: true, output: '', at: AT, io })).toEqual([])
  })
})

describe('bashFacts: git, gh, metaeditor, tests', () => {
  it('a commit only with a real commit line', () => {
    expect(bashFacts({ command: 'git commit -m x', ok: true, output: '[ea-dev 1a2b3c4] x\n 1 file changed', at: AT })).toEqual([expect.objectContaining({ kind: 'commit' })])
    expect(bashFacts({ command: 'git commit -m x', ok: true, output: 'nothing to commit, working tree clean', at: AT })).toEqual([])
    expect(bashFacts({ command: 'git commit -m x', ok: false, output: 'hook failed', at: AT })).toEqual([])
  })
  it('a push is a fact only without the tracker (its push_done signal is the push otherwise)', () => {
    const push = { command: 'git push origin ea-dev', ok: true, output: 'To github.com:x/y\n   a..b  ea-dev -> ea-dev', at: AT }
    expect(bashFacts({ ...push, withSignals: true })).toEqual([])
    expect(bashFacts({ ...push, withSignals: false })).toEqual([expect.objectContaining({ kind: 'push' })])
    expect(bashFacts({ ...push, withSignals: false, output: 'Everything up-to-date' })).toEqual([])
    expect(bashFacts({ ...push, withSignals: false, output: ' ! [rejected] ea-dev -> ea-dev (fetch first)' })).toEqual([])
  })
  it('a PR merge with its number and repo', () => {
    expect(bashFacts({ command: 'gh pr merge 42 --squash --repo Barnesyy/school-run', ok: true, output: '✓ Squashed and merged pull request #42', at: AT }))
      .toEqual([expect.objectContaining({ kind: 'pr_merge', pr: 42, repo: 'Barnesyy/school-run' })])
    expect(bashFacts({ command: 'gh pr merge 7', ok: true, output: '', cwd: 'C:\\Users\\me\\School Run', at: AT })[0]).toMatchObject({ pr: 7, repo: 'School Run' })
    expect(bashFacts({ command: 'gh pr merge 7 --auto', ok: true, output: '✓ Pull request #7 will be automatically merged (auto-merge)', at: AT })).toEqual([])
  })
  it('a MetaEditor compile is passed by its error count', () => {
    const cmd = 'metaeditor64.exe /compile:"Experts\\SchoolRun.mq5" /log'
    expect(bashFacts({ command: cmd, ok: true, output: 'Result: 0 errors, 2 warnings', at: AT })[0]).toMatchObject({ kind: 'ea_compile', ok: true })
    expect(bashFacts({ command: cmd, ok: true, output: 'Result: 3 errors, 0 warnings', at: AT })[0]).toMatchObject({ kind: 'ea_compile', ok: false })
  })
  it('tests and builds only without the tracker (which signals them itself)', () => {
    expect(bashFacts({ command: 'npx vitest run', ok: true, output: '', at: AT, withSignals: true })).toEqual([])
    expect(bashFacts({ command: 'npx vitest run', ok: true, output: '', at: AT, withSignals: false })).toEqual([expect.objectContaining({ kind: 'test', ok: true })])
  })
})

describe('FactExtractor: lessons', () => {
  const bash = (command: string, ok: boolean, id: string, stdout = '') => ({
    hook_event_name: ok ? 'PostToolUse' : 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command },
    tool_response: ok ? { stdout, stderr: '', interrupted: false } : undefined, error: ok ? undefined : 'Exit code 1', tool_use_id: id, session_id: 's1', cwd: '/x',
  })
  it('a failure then the same command working is one lesson, with the fail count and time', () => {
    const clock = { t: AT }
    const x = new FactExtractor({ now: () => clock.t })
    expect(x.facts(bash('npx vitest run', false, 'a'))).toEqual([])
    clock.t += 1000
    x.facts(bash('npx vitest run', false, 'b'))
    clock.t += 60_000
    const out = x.facts(bash('npx vitest run', true, 'c', 'Tests 12 passed'))
    expect(out).toEqual([expect.objectContaining({ kind: 'lesson', label: 'vitest run', fails: 2, ms: 61_000, id: 'c:lesson', sessionId: 's1' })])
    // and only once
    expect(x.facts(bash('npx vitest run', true, 'd'))).toEqual([])
  })
  it('a green-looking exit with failures in its output is no fix', () => {
    const x = new FactExtractor({ now: () => AT })
    x.facts(bash('npx vitest run | tail', false, 'a'))
    expect(x.facts(bash('npx vitest run | tail', true, 'b', 'Tests 3 failed | 9 passed'))).toEqual([])
    expect(x.facts(bash('npx vitest run | tail', true, 'c', 'Tests 0 failed | 12 passed'))).toEqual([expect.objectContaining({ kind: 'lesson', fails: 2 })])
  })
  it('different sessions do not pair, and a fix after 2 h is not a lesson', () => {
    const clock = { t: AT }
    const x = new FactExtractor({ now: () => clock.t })
    x.facts(bash('cargo build', false, 'a'))
    expect(x.facts({ ...bash('cargo build', true, 'b'), session_id: 's2' })).toEqual([])
    clock.t += 3 * 3600_000
    expect(x.facts(bash('cargo build', true, 'c'))).toEqual([])
  })
  it('an Edit that failed and then worked on the same file is a lesson labelled by file name only', () => {
    const x = new FactExtractor({ now: () => AT })
    const edit = (ok: boolean, id: string) => ({ hook_event_name: ok ? 'PostToolUse' : 'PostToolUseFailure', tool_name: 'Edit', tool_input: { file_path: 'C:\\Users\\me\\EA\\SchoolRun.mq5', old_string: 'secret' }, tool_use_id: id, session_id: 's1' })
    x.facts(edit(false, 'a'))
    expect(x.facts(edit(true, 'b'))).toEqual([expect.objectContaining({ kind: 'lesson', label: 'Edit SchoolRun.mq5' })])
  })
  it('interrupted calls are nothing, and other hooks are ignored', () => {
    const x = new FactExtractor({ now: () => AT })
    expect(x.facts({ ...bash('npx vitest run', false, 'a'), is_interrupt: true })).toEqual([])
    expect(x.facts({ ...bash('git commit -m x', true, 'b', '[main abc1234] x'), tool_response: { stdout: '[main abc1234] x', interrupted: true } })).toEqual([])
    expect(x.facts({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit' } })).toEqual([])
    expect(x.facts(null)).toEqual([])
  })
  it('lessonKey skips cd and setup segments', () => {
    expect(lessonKey('Bash', { command: 'cd "C:\\x" && npm test' })?.label).toBe('npm test')
    expect(lessonKey('Bash', { command: 'cd x' })).toBeNull()
  })
})
