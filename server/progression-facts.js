/**
 * progression-facts.js — what one rebuilt hook payload means for the
 * progression layer (server/progression.js), read on the watcher side.
 *
 * The transcript watcher (scripts/transcript-watch.mjs) hands every payload it
 * rebuilds to `onPayload`. A FactExtractor turns the few that matter into
 * small facts and the watcher POSTs them to /progression/facts:
 *
 *   commit        a `git commit` that made a commit (its "[branch abc1234]" line)
 *   push          a `git push` that went through (not "[rejected]", not "Everything up-to-date"),
 *                 only without the tracker's signals (its push_done is the same push)
 *   pr_merge      `gh pr merge` that merged (pr number and repo when the command or output names them)
 *   mt5_run       a finished MT5 tester run: terminal64 (or metatester64) with /config:<ini>,
 *                 not in the background. `walkForward` when the ini's [Tester] ForwardMode is
 *                 non-zero (or, with an unreadable ini, its name says walk-forward / wf);
 *                 `report` when the ini's Report= file exists and was written by this run
 *   ea_compile    metaeditor64 /compile: `ok` from its "N errors" line, else the exit status
 *   test / build  pass or fail of a test or build command, ONLY when the converter has no
 *                 signals of its own (the built-in JS one); the Python tracker's `signal`
 *                 broadcasts carry these otherwise, and the server counts those
 *   lesson        the same thing failed and then worked in one session (a tool call that
 *                 failed, then the same command or the same file edit that succeeded):
 *                 label, how many failures, how long it took
 *
 * What a fact carries: kind, id (the tool_use_id, so a replay never counts
 * twice), sessionId, at, and a short `label` built only from program names,
 * subcommand words and file basenames: never a command's arguments, output,
 * an error line or a path, so nothing a command printed (tokens, passwords)
 * leaves the machine's own office.
 *
 * Pure apart from two reads, both injectable for tests: the MT5 ini file and
 * the report file's mtime.
 */

import { readFileSync, statSync } from 'fs'
import { basename, isAbsolute, join, win32 } from 'path'

// ---------------------------------------------------------------------------
// Reading a Bash command
// ---------------------------------------------------------------------------

/** Split a command line into segments on && || ; | & and newlines, outside quotes and $(...). */
export function splitSegments(command) {
  const out = []
  let cur = ''
  let quote = null
  let depth = 0
  const s = String(command ?? '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      cur += c
      if (c === quote && s[i - 1] !== '\\') quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue }
    if (c === '$' && s[i + 1] === '(') { depth++; cur += c; continue }
    if (c === ')' && depth > 0) { depth--; cur += c; continue }
    if (depth === 0 && (c === ';' || c === '\n' || c === '|' || c === '&')) {
      // && / || / |& count as one separator; a lone & (background) too
      if ((c === '&' || c === '|') && (s[i + 1] === c || s[i + 1] === '&')) i++
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Words of one segment, quotes removed (a quoted word with spaces stays one word). */
export function words(segment) {
  const out = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

const WRAPPERS = new Set(['sudo', 'env', 'npx', 'time', 'nice', 'nohup', 'command', 'exec', 'call', '&', 'start', 'cmd', 'cmd.exe', 'powershell', 'pwsh', 'bunx', 'pnpx'])
const WRAPPER_FLAGS = new Set(['/c', '/k', '-c', '-Command', '-command', '-NoProfile', '-noprofile', '/wait', '/b', '/min', '-ExecutionPolicy', 'Bypass', '-File'])

/** The program (basename, lower case, without .exe) and its arguments, past env assignments and wrappers. */
export function programOf(segment) {
  const w = words(segment)
  let i = 0
  while (i < w.length) {
    const t = w[i]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue }
    const base = t.replace(/\\/g, '/').split('/').pop().toLowerCase()
    if (WRAPPERS.has(base) || WRAPPER_FLAGS.has(t)) { i++; continue }
    if (base === 'timeout' && /^\d/.test(w[i + 1] ?? '')) { i += 2; continue }
    if (base === 'uv' && w[i + 1] === 'run') { i += 2; continue }
    break
  }
  if (i >= w.length) return null
  const raw = w[i]
  const program = raw.replace(/\\/g, '/').split('/').pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')
  return { program, raw, args: w.slice(i + 1) }
}

const NEVER = /(^|\s)--(dry-run|version|help)(\s|$)/

/** The text a Bash call printed (transcript toolUseResult or a plain string). */
function outputOf(response) {
  if (response == null) return ''
  if (typeof response === 'string') return response
  if (typeof response === 'object') return [response.stdout, response.stderr, response.output].filter(s => typeof s === 'string').join('\n')
  return ''
}

/** A short, safe label: program and its subcommand words only (no flags, values, paths). */
export function labelOf(prog, maxWords = 2) {
  if (!prog) return ''
  const sub = []
  for (const a of prog.args) {
    if (sub.length >= maxWords) break
    if (/^[a-z][a-z0-9:_-]{0,24}$/.test(a)) sub.push(a)
    else break
  }
  return [prog.program, ...sub].join(' ').slice(0, 60)
}

const TEST_PROGRAMS = new Set(['vitest', 'jest', 'mocha', 'pytest', 'py.test', 'rspec', 'phpunit'])
const BUILD_PROGRAMS = new Set(['tsc', 'vue-tsc', 'webpack', 'esbuild'])
const PKG = new Set(['npm', 'pnpm', 'yarn', 'bun'])

/** test | build | null for one segment (the core of the tracker's rules, for the JS converter). */
export function testOrBuild(prog) {
  if (!prog) return null
  const { program, args } = prog
  const first = args[0] ?? ''
  if (TEST_PROGRAMS.has(program)) return 'test'
  if (BUILD_PROGRAMS.has(program)) return 'build'
  if ((program === 'python' || program === 'python3' || program === 'py') && args[0] === '-m' && /^(pytest|unittest)$/.test(args[1] ?? '')) return 'test'
  if (PKG.has(program)) {
    const script = first === 'run' || first === 'run-script' ? args[1] ?? '' : first
    if (/^(test|t|tst)(:|$)|^test[-:]|^e2e/.test(script)) return 'test'
    if (/^(build|compile|typecheck|type-check)/.test(script)) return 'build'
    return null
  }
  if (program === 'vite' || program === 'next') return first === 'build' ? 'build' : null
  if (program === 'cargo' || program === 'go' || program === 'dotnet') return first === 'test' ? 'test' : first === 'build' ? 'build' : null
  if (program === 'make') return /^(test|check)$/.test(first) ? 'test' : null
  return null
}

// ---------------------------------------------------------------------------
// MT5
// ---------------------------------------------------------------------------

const MT5_TERMINAL = /^(terminal64|terminal|metatester64)$/
const MT5_EDITOR = /^metaeditor(64)?$/

/** Decode an ini/report that may be UTF-16 (MT5 writes UTF-16LE with a BOM). */
export function decodeText(buf) {
  if (!buf || !buf.length) return ''
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return b.toString('utf16le') }
  // No BOM but every other byte zero: UTF-16LE all the same
  let zeros = 0
  for (let i = 1; i < Math.min(buf.length, 400); i += 2) if (buf[i] === 0) zeros++
  if (zeros > Math.min(buf.length, 400) / 4) return buf.toString('utf16le')
  return buf.toString('utf8').replace(/^\uFEFF/, '')
}

/** The [Tester] section of an MT5 ini as a plain object (keys as written). */
export function parseTesterIni(text) {
  const out = {}
  let section = ''
  for (const line of String(text).split(/\r?\n/)) {
    const l = line.trim()
    if (!l || l.startsWith(';')) continue
    const sec = /^\[(.+)\]$/.exec(l)
    if (sec) { section = sec[1].toLowerCase(); continue }
    if (section !== 'tester') continue
    const eq = l.indexOf('=')
    if (eq > 0) out[l.slice(0, eq).trim()] = l.slice(eq + 1).trim()
  }
  return out
}

/** The value of /config:<path> (quoted or not) in a terminal's arguments. */
export function configArg(args) {
  for (let i = 0; i < args.length; i++) {
    const m = /^[/-]config:(.*)$/i.exec(args[i])
    if (m) return m[1].replace(/^"|"$/g, '') || args[i + 1] || null
  }
  return null
}

const winAbs = p => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')

/** Candidate locations of a relative path, against the session's cwd. */
function candidates(p, cwd) {
  if (!p) return []
  if (isAbsolute(p) || winAbs(p)) return [p]
  const out = []
  if (cwd) out.push(winAbs(cwd) ? win32.join(cwd, p) : join(cwd, p))
  out.push(p)
  return out
}

const defaultIo = {
  read: path => readFileSync(path),
  mtimeMs: path => statSync(path).mtimeMs,
}

/**
 * What one finished terminal64 /config run was: walk-forward or not, and
 * whether its report was written by it. Reads the ini (and stats the report)
 * on this machine; an unreadable ini falls back to its name.
 */
export function mt5RunInfo(iniPath, { cwd, at, maxRunMs = 6 * 3600_000, io = defaultIo } = {}) {
  let ini = null
  for (const p of candidates(iniPath, cwd)) {
    try { ini = parseTesterIni(decodeText(io.read(p))); break } catch {}
  }
  const name = basename(String(iniPath ?? '').replace(/\\/g, '/'))
  let walkForward
  let source = 'name'
  if (ini && Object.keys(ini).length) {
    source = 'ini'
    const fwd = Number(ini.ForwardMode ?? 0)
    walkForward = Number.isFinite(fwd) && fwd > 0
  } else walkForward = /walk[-_ ]?forward|(^|[-_.])wf([-_.]|$)|forward/i.test(name)
  let report = false
  const rep = ini?.Report
  if (rep) {
    const exts = /\.(html?|xml)$/i.test(rep) ? [''] : ['.htm', '.html', '.xml']
    outer: for (const base of candidates(rep, cwd)) {
      for (const ext of exts) {
        try {
          const m = io.mtimeMs(base + ext)
          // Written by this run: during it (after it could have started), not long before
          if (m <= at + 60_000 && m >= at - maxRunMs) { report = true; break outer }
        } catch {}
      }
    }
  }
  return { walkForward, report, source, ini: name.slice(0, 80), symbol: ini?.Symbol?.slice(0, 20), expert: ini?.Expert ? basename(ini.Expert.replace(/\\/g, '/')).slice(0, 60) : undefined }
}

// ---------------------------------------------------------------------------
// One Bash call
// ---------------------------------------------------------------------------

/**
 * The facts one finished Bash call yields (success = PostToolUse, else
 * PostToolUseFailure), apart from lessons.
 * @param {{ command: string, ok: boolean, output: string, cwd?: string, at: number, background?: boolean, withSignals: boolean, io?: object }} call
 */
export function bashFacts({ command, ok, output, cwd, at, background = false, withSignals = true, io }) {
  const facts = []
  if (!command || NEVER.test(command)) return facts
  const out = output ?? ''
  for (const seg of splitSegments(command)) {
    const prog = programOf(seg)
    if (!prog) continue
    const { program, args } = prog
    if (program === 'git') {
      const verb = args.find(a => !a.startsWith('-'))
      if (verb === 'commit' && ok && !/nothing to commit|no changes added/i.test(out)) {
        // With output to read, only a real commit line counts
        if (!out || /\[[^\]\n]+ [0-9a-f]{7,40}\]/.test(out)) facts.push({ kind: 'commit', label: 'git commit', amend: args.includes('--amend') })
      }
      // With the tracker, its push_done signal is the push (the server counts that)
      if (verb === 'push' && ok && !withSignals && !/\[rejected\]|Everything up-to-date|! \[remote rejected\]/i.test(out)) {
        facts.push({ kind: 'push', label: 'git push' })
      }
      continue
    }
    if (program === 'gh' && args[0] === 'pr' && args[1] === 'merge') {
      if (ok && !/not mergeable|failed|could not|auto-merge/i.test(out)) {
        const num = args.slice(2).find(a => /^#?\d+$/.test(a)) ?? (/#(\d+)/.exec(out)?.[1])
        const ri = args.findIndex(a => a === '--repo' || a === '-R')
        const repo = ri >= 0 ? args[ri + 1] : undefined
        facts.push({ kind: 'pr_merge', label: 'gh pr merge', pr: num ? Number(String(num).replace('#', '')) : undefined, repo: repo && /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : cwd ? basename(cwd.replace(/\\/g, '/')).slice(0, 60) : undefined })
      }
      continue
    }
    if (MT5_TERMINAL.test(program)) {
      const ini = configArg(args)
      if (!ini || background || !ok) continue
      const info = mt5RunInfo(ini, { cwd, at, io })
      facts.push({ kind: 'mt5_run', label: `${program} ${info.ini}`.slice(0, 60), walkForward: info.walkForward, report: info.report, source: info.source, ...(info.expert ? { expert: info.expert } : {}) })
      continue
    }
    if (MT5_EDITOR.test(program) && args.some(a => /^[/-]compile/i.test(a))) {
      if (background) continue
      const m = /(\d+)\s+errors?\b/i.exec(out)
      const passed = m ? Number(m[1]) === 0 : ok
      facts.push({ kind: 'ea_compile', label: 'metaeditor compile', ok: passed })
      continue
    }
    if (!withSignals && !background) {
      const kind = testOrBuild(prog)
      if (kind) facts.push({ kind, label: labelOf(prog), ok })
    }
  }
  return facts
}

// ---------------------------------------------------------------------------
// The extractor: payloads in, facts out (with lesson pairing)
// ---------------------------------------------------------------------------

const LESSON_TOOLS = new Set(['Bash', 'PowerShell', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
// Why 2 h: a failure that is fixed the next morning is a new day's work, not this lesson
const LESSON_WINDOW_MS = 2 * 3600_000

// Programs that only look (search, list, print, compare): a non-zero exit from these is an answer
// ("no match", "differs", "not there"), not a failure anyone learns from
const PROBES = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'findstr', 'find', 'fd', 'ls', 'dir', 'tree', 'test', '[', '[[', 'true', 'false',
  'which', 'where', 'type', 'command', 'cat', 'head', 'tail', 'less', 'more', 'sed', 'awk', 'cut', 'tr', 'sort', 'uniq', 'wc',
  'diff', 'cmp', 'comm', 'stat', 'file', 'du', 'df', 'echo', 'printf', 'pwd', 'date', 'sleep', 'xargs', 'jq', 'tee', 'ps',
  'tasklist', 'pgrep', 'get-childitem', 'gci', 'select-string', 'sls', 'test-path', 'get-content', 'gc', 'get-item', 'get-process',
  'select-object', 'where-object', 'format-table', 'measure-object', 'out-string', 'write-output', 'write-host', 'start-sleep',
])
// Edit/Write refusals that are bookkeeping, not a mistake: the file was not read first, the text moved
const EDIT_CHORES = /has not been read|read it first|string to replace not found|not found in (the )?file|modified since|has been modified|old_string|no changes to make|matches of the string|is identical/i
// What a real failure says
const ERROR_WORDS = /\berror\b|exception|traceback|\bfail(ed|ure|ing)?\b|fatal|not found|no such file|denied|cannot|can't|unable|invalid|syntax|refused|timed? ?out|panic|abort|segmentation|missing|undefined|not recognized|unexpected/i

/** Separators (&& || ; |) and runs of white space, and a leading cd / set-up, gone: one key per command a person would call "the same". */
export function normaliseCommand(command) {
  const segs = splitSegments(command ?? '')
  // Skip cd / setup segments at the front: where it ran is not what was tried
  let i = 0
  while (i < segs.length && /^(cd|pushd|set|export|source|\.|set-location|sl|chdir)$/i.test(programOf(segs[i])?.program ?? '')) i++
  return segs.slice(i).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ; ').slice(0, 400)
}

const INTERPRETERS = new Set(['python', 'python3', 'py', 'node', 'bash', 'sh', 'pwsh', 'powershell', 'deno', 'bun', 'ruby', 'perl', 'tsx', 'ts-node'])
const SCRIPT_EXT = /\.(py|mjs|cjs|js|ts|ps1|sh|rb|pl)$/i

/** The label of a Bash command: programs and subcommand words, and for an interpreter the script's file name (never arguments or paths). */
function bashLabel(main) {
  return main.slice(0, 2).map(p => {
    if (INTERPRETERS.has(p.program)) {
      const script = p.args.find(a => !a.startsWith('-'))
      if (script && SCRIPT_EXT.test(script)) return `${p.program} ${basename(script.replace(/\\/g, '/')).slice(0, 40)}`
    }
    return labelOf(p)
  }).join(' && ')
}

/**
 * The key two calls share when they are "the same thing": the whole command (normalised), or the tool and the
 * file it edits. The key stays on this side; only the label (program names, a script or file name) is sent.
 */
export function lessonKey(toolName, input) {
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = input?.command ?? ''
    const segs = splitSegments(command).map(programOf).filter(Boolean)
    const main = segs.filter(p => !/^(cd|pushd|set|export|echo|source|\.|set-location|sl|chdir)$/.test(p.program))
    if (!main.length) return null
    const norm = normaliseCommand(command)
    const label = bashLabel(main)
    const probe = main.every(p => PROBES.has(p.program))
    return label && norm ? { key: `Bash:${norm}`, label, probe } : null
  }
  const file = input?.file_path ?? input?.notebook_path
  if (typeof file !== 'string' || !file) return null
  const name = basename(file.replace(/\\/g, '/')).slice(0, 60)
  return { key: `${toolName === 'MultiEdit' ? 'Edit' : toolName}:${file.toLowerCase()}`, label: `${toolName === 'Write' ? 'Write' : 'Edit'} ${name}`, probe: false }
}

/** "Exit code 2" (Claude Code's failure text) -> 2; null when the text names none. */
export function exitCodeOf(text) {
  const m = /\bexit(?:ed)?(?: with)?(?: code| status)?[: ]+(-?\d+)/i.exec(String(text ?? ''))
  return m ? Number(m[1]) : null
}

/**
 * Whether a failed call is one worth a lesson: a shell command that exited non-zero and said why (an error line),
 * not a search or listing that found nothing; an edit refused for a reason other than bookkeeping.
 */
export function meaningfulFailure(toolName, key, errorText) {
  const text = String(errorText ?? '')
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    if (key.probe) return false
    const code = exitCodeOf(text)
    if (code === 0) return false
    // Exit 1 with nothing else to say is how many tools say "no" (grep, test, findstr): not a failure to learn from
    const body = text.replace(/\bexit(?:ed)?(?: with)?(?: code| status)?[: ]+-?\d+/ig, '').trim()
    if (!body) return false
    return ERROR_WORDS.test(body)
  }
  if (!text.trim()) return false
  return !EDIT_CHORES.test(text)
}

export class FactExtractor {
  /**
   * @param {{ withSignals?: boolean, now?: () => number, io?: object, timeOf?: (p: object) => number | undefined, startedAt?: number }} [opts]
   *   withSignals: the converter sends build/test/push signals itself (Python tracker)
   *   timeOf: when the payload's call really happened (the transcript record's time); the wall clock otherwise
   *   startedAt: calls from before this (a catch-up read of history) earn nothing: they still open a failure, so a
   *              fix made after the start pairs with it at its real times, but they send no fact
   */
  constructor({ withSignals = true, now = () => Date.now(), io, timeOf, startedAt } = {}) {
    this.withSignals = withSignals
    this.now = now
    this.io = io
    this.timeOf = timeOf
    this.startedAt = Number.isFinite(startedAt) ? startedAt : null
    /** `${sessionId}\u0000${key}` -> { fails, firstAt, label } */
    this.failing = new Map()
  }

  /** When the call happened: the transcript's time if known and sane, else now. */
  timeFor(p) {
    const nowMs = this.now()
    let t
    try { t = this.timeOf?.(p) } catch {}
    if (!Number.isFinite(t)) t = Number.isFinite(p.at) ? p.at : undefined
    return Number.isFinite(t) && t > 0 && t <= nowMs + 60_000 ? t : nowMs
  }

  /** The facts one payload yields (often none). */
  facts(p) {
    if (!p || typeof p !== 'object') return []
    const ev = p.hook_event_name
    if (ev !== 'PostToolUse' && ev !== 'PostToolUseFailure') return []
    const tool = p.tool_name
    const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {}
    const ok = ev === 'PostToolUse'
    const at = this.timeFor(p)
    // A catch-up read of a turn that ran before the office started: remembered, never counted
    const replayed = this.startedAt !== null && at < this.startedAt - 1000
    const sessionId = typeof p.session_id === 'string' ? p.session_id : undefined
    const id = typeof p.tool_use_id === 'string' ? p.tool_use_id : undefined
    const out = []
    const response = p.tool_response
    // A call stopped with Esc failed nobody
    if (!ok && p.is_interrupt) return []
    if (ok && response && typeof response === 'object' && response.interrupted === true) return []

    if (tool === 'Bash' && !replayed) {
      const background = input.run_in_background === true || (ok && response && typeof response === 'object' && typeof response.backgroundTaskId === 'string')
      for (const f of bashFacts({ command: input.command, ok, output: ok ? outputOf(response) : String(p.error ?? ''), cwd: p.cwd, at, background, withSignals: this.withSignals, io: this.io })) {
        out.push({ ...f, ...(id ? { id: `${id}:${f.kind}` } : {}) })
      }
    }

    if (LESSON_TOOLS.has(tool) && sessionId) {
      const k = lessonKey(tool, input)
      if (k) {
        const mapKey = `${sessionId}\u0000${k.key}`
        this.prune(at)
        const text = ok ? outputOf(response) : String(p.error ?? '')
        // A run whose own output says it failed (exit 0 piped through tail) is no fix
        const quietFail = ok && (tool === 'Bash' || tool === 'PowerShell') && !k.probe && /\b[1-9]\d* (failed|failing)\b|\bFAIL\b|Build failed|error TS\d+/.test(text) && !/\b0 (failed|failing)\b/.test(text)
        if (!ok || quietFail) {
          if (quietFail || meaningfulFailure(tool, k, text)) {
            const prev = this.failing.get(mapKey)
            this.failing.set(mapKey, { fails: (prev?.fails ?? 0) + 1, firstAt: prev?.firstAt ?? at, label: k.label })
          }
        } else {
          const prev = this.failing.get(mapKey)
          if (prev) {
            this.failing.delete(mapKey)
            if (!replayed) out.push({ kind: 'lesson', label: prev.label, fails: prev.fails, ms: Math.max(0, at - prev.firstAt), ...(id ? { id: `${id}:lesson` } : {}) })
          }
        }
      }
    }

    return out.map(f => ({ ...f, at, ...(sessionId ? { sessionId } : {}), ...(p.agent_id ? { agentId: String(p.agent_id).slice(0, 80) } : {}) }))
  }

  prune(at) {
    if (this.failing.size < 50) {
      for (const [k, v] of this.failing) if (at - v.firstAt > LESSON_WINDOW_MS) this.failing.delete(k)
      return
    }
    // Bounded: drop the oldest when many are open
    const sorted = [...this.failing.entries()].sort((a, b) => a[1].firstAt - b[1].firstAt)
    for (const [k, v] of sorted) if (at - v.firstAt > LESSON_WINDOW_MS || this.failing.size > 200) this.failing.delete(k)
  }
}

/** Fact kinds the server accepts (server/progression.js validates against this). */
export const FACT_KINDS = new Set(['commit', 'push', 'pr_merge', 'mt5_run', 'ea_compile', 'test', 'build', 'lesson'])
