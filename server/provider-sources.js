/**
 * provider-sources.js — other agents in the same office.
 *
 * The transcript watcher (server/transcript-source.js) was written for Claude
 * Code. A provider here teaches it another tool's session files by doing two
 * small things:
 *
 *   scan(config, now)      which files are sessions, and whose
 *   createAdapter(entry)   that tool's records -> records in Claude Code's
 *                          transcript shape (user / assistant rows with
 *                          text, tool_use and tool_result blocks)
 *
 * Everything after that is the unchanged pipeline: TranscriptSession rebuilds
 * the hook payloads, the tracker turns them into office events, and the EA
 * scenes and the progression layer read the same payloads. So a Codex shell
 * call that runs terminal64.exe lights the backtest station exactly as a
 * Claude Bash call does.
 *
 * Session ids carry the provider as a prefix (`codex-<id>`, `grok-<id>`), so
 * two tools can never share an id and the page can tell whose character it is
 * from the id alone (src/providers.ts).
 *
 *   codex   OpenAI Codex (CLI, IDE extension and the desktop app all write
 *           ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl).
 *           Built from the format in openai/codex (codex-rs/protocol and
 *           codex-rs/rollout). Turn ends are explicit (turn_complete).
 *   grok    Grok's CLI (~/.grok/sessions/<cwd>/<id>/updates.jsonl, with
 *           events.jsonl beside it). Built from real sessions. Turn ends are
 *           explicit, and an open permission prompt is read, not guessed.
 *
 * Nothing is written to either tool's folder.
 */

import { readdirSync, statSync, openSync, readSync, closeSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'

export const PROVIDER_IDS = Object.freeze(['claude', 'codex', 'grok'])

// ---------------------------------------------------------------------------
// Tool names: every tool's own names -> the ones the tracker knows
// ---------------------------------------------------------------------------

const PATH_KEYS = ['file_path', 'path', 'filePath', 'filepath', 'file', 'target_file', 'targetFile', 'filename', 'absolute_path', 'relative_path']
const firstString = (obj, keys) => { for (const k of keys) if (typeof obj?.[k] === 'string' && obj[k]) return obj[k]; return '' }

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : { input: raw } } catch { return { input: raw } }
}

/** `["bash","-lc","npm test"]` -> "npm test"; `["git","status"]` -> "git status". */
export function commandText(cmd) {
  if (typeof cmd === 'string') return cmd
  if (!Array.isArray(cmd)) return ''
  const parts = cmd.map(String)
  const shell = basename(String(parts[0] ?? '').replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '')
  if (parts.length >= 3 && /^(bash|sh|zsh|pwsh|powershell|cmd)$/.test(shell) && /^(-l?c|-command|\/c|-noprofile)$/i.test(parts[1])) return parts[parts.length - 1]
  return parts.join(' ')
}

/** The files an apply_patch body touches, and whether the first one is new. */
export function patchFiles(patch) {
  const files = []
  let added = false
  for (const m of String(patch ?? '').matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) {
    if (!files.length) added = m[1] === 'Add'
    files.push(m[2].trim())
  }
  return { files, added }
}

const SHELL_NAME = /^(shell|shell_command|exec_command|local_shell|container\.exec|unified_exec|bash|run_command|run_terminal_cmd|run_terminal_command|execute_command|terminal|run_shell_command|execute_bash)$/i
const POWERSHELL = /(^|[\\/\s"'])(pwsh|powershell)(\.exe)?(\s|"|'|$)/i

/**
 * One tool call in the tracker's vocabulary: { name, input }. Unknown tools
 * keep their own name (the office shows "using <name>").
 */
export function normaliseTool(rawName, rawArgs) {
  const name = String(rawName ?? '')
  const args = parseArgs(rawArgs)
  if (name.startsWith('mcp__')) return { name, input: args }
  if (SHELL_NAME.test(name)) {
    const raw = args.command ?? args.cmd ?? args.script ?? args.input ?? ''
    const command = commandText(raw)
    const viaPowershell = Array.isArray(raw) ? POWERSHELL.test(String(raw[0] ?? '')) : false
    const input = { command }
    const cwd = firstString(args, ['workdir', 'cwd', 'working_directory'])
    if (cwd) input.cwd = cwd
    return { name: viaPowershell ? 'PowerShell' : 'Bash', input }
  }
  if (/^apply_patch$/i.test(name)) {
    const patch = typeof args.input === 'string' ? args.input : (typeof args.patch === 'string' ? args.patch : '')
    const { files, added } = patchFiles(patch)
    return { name: added ? 'Write' : 'Edit', input: { file_path: files[0] ?? firstString(args, PATH_KEYS), ...(patch ? { patch: patch.slice(0, 20_000) } : {}) } }
  }
  if (/^update_plan$/i.test(name) && Array.isArray(args.plan)) {
    return { name: 'TodoWrite', input: { todos: args.plan.map(s => ({ content: String(s?.step ?? ''), status: s?.status === 'completed' ? 'completed' : s?.status === 'in_progress' ? 'in_progress' : 'pending' })) } }
  }
  const file = firstString(args, PATH_KEYS)
  if (/^(read_file|view_file|view_image|read|view|open_file|cat)$/i.test(name)) return { name: 'Read', input: { ...args, file_path: file } }
  if (/^(write_file|create_file|write|save_file)$/i.test(name)) return { name: 'Write', input: { ...args, file_path: file } }
  if (/^(edit_file|str_replace_editor|str_replace|replace_in_file|edit|multi_edit|search_replace)$/i.test(name)) return { name: 'Edit', input: { ...args, file_path: file } }
  if (/^(grep|grep_search|search_files|search|ripgrep|codebase_search)$/i.test(name)) return { name: 'Grep', input: { ...args, pattern: firstString(args, ['pattern', 'query', 'regex', 'search']) } }
  if (/^(glob|list_files|list_dir|list_directory|find_files|ls|file_search)$/i.test(name)) return { name: 'Glob', input: { ...args, pattern: firstString(args, ['pattern', 'glob', 'query', 'path', 'directory', 'target_directory']) } }
  if (/^(web_search|search_web)$/i.test(name)) return { name: 'WebSearch', input: args }
  if (/^(web_fetch|fetch_url|browse|open_url)$/i.test(name)) return { name: 'WebFetch', input: args }
  return { name: name || 'tool', input: args }
}

// ---------------------------------------------------------------------------
// Small helpers shared by the adapters
// ---------------------------------------------------------------------------

const textBlocks = content => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(b => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : '')).filter(Boolean).join('\n')
}

/** A tool's output as text, and whether it says the call failed. */
export function readOutput(output) {
  let text = ''
  let failed = false
  let body = output
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (body.success === false) failed = true
    body = body.content ?? body.body ?? body.output ?? body.text ?? ''
  }
  text = typeof body === 'string' ? body : textBlocks(body)
  // Older shells answer with a JSON string: {"output":"…","metadata":{"exit_code":1}}
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text)
      const code = j?.metadata?.exit_code ?? j?.exit_code
      if (Number.isInteger(code) && code !== 0) failed = true
      if (typeof j?.output === 'string') text = j.output
    } catch {}
  }
  const exit = /^\s*Exit code:\s*(-?\d+)/im.exec(text.slice(0, 400))
  if (exit && Number(exit[1]) !== 0) failed = true
  if (/^(execution error|command timed out|sandbox error|aborted by user)/i.test(text.trimStart())) failed = true
  return { text, failed }
}

function readHead(path, maxBytes = 512 * 1024) {
  let fd
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(maxBytes)
    const n = readSync(fd, buf, 0, maxBytes, 0)
    return buf.toString('utf8', 0, n)
  } catch { return '' } finally { if (fd !== undefined) try { closeSync(fd) } catch {} }
}

const iso = (t, fallback) => {
  if (typeof t === 'number' && Number.isFinite(t)) return new Date(t < 1e12 ? t * 1000 : t).toISOString()
  if (typeof t === 'string' && Number.isFinite(Date.parse(t))) return t
  return fallback
}

const safeId = id => String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 72)

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

const ROLLOUT_FILE = /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_[^.]*)?\.jsonl$/i

/** The session_meta line of a rollout (its first line): who the thread is and whose worker. */
export function readCodexMeta(path) {
  const head = readHead(path)
  const nl = head.indexOf('\n')
  const line = nl >= 0 ? head.slice(0, nl) : head
  let meta = null
  try { const j = JSON.parse(line); if (j?.type === 'session_meta') meta = j.payload?.meta ?? j.payload } catch {}
  if (!meta) {
    // A first line longer than the head read (large base instructions): the ids are near its start
    const pick = k => new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`).exec(line)?.[1]
    if (line.includes('"session_meta"')) meta = { id: pick('id'), session_id: pick('session_id'), parent_thread_id: pick('parent_thread_id'), cwd: pick('cwd')?.replace(/\\\\/g, '\\'), agent_role: pick('agent_role'), agent_nickname: pick('agent_nickname') }
  }
  return meta && typeof meta === 'object' ? meta : null
}

function codexScan(config, now) {
  const root = config.dir
  const found = []
  const cutoff = now - config.scanDays * 86_400_000
  const list = d => { try { return readdirSync(d, { withFileTypes: true }) } catch { return [] } }
  const metaCache = (codexScan.cache ??= new Map())
  const take = (dir, e) => {
    const m = ROLLOUT_FILE.exec(e.name)
    if (!m) return
    const path = join(dir, e.name)
    let info = metaCache.get(path)
    if (!info) {
      const meta = readCodexMeta(path) ?? {}
      const own = String(meta.id ?? m[1])
      const parent = meta.parent_thread_id ? String(meta.parent_thread_id) : ''
      // session_id is the root thread; a worker thread also names its parent
      const rootId = parent ? String(meta.session_id && meta.session_id !== own ? meta.session_id : parent) : own
      info = parent
        ? { sessionId: `codex-${safeId(rootId)}`, kind: 'agent', agentId: safeId(own), cwd: meta.cwd, agentType: meta.agent_role || 'worker', description: meta.agent_nickname || meta.agent_role || 'Codex worker' }
        : { sessionId: `codex-${safeId(own)}`, kind: 'main', cwd: meta.cwd }
      // An empty file has no meta yet: look again next time
      if (meta.id) metaCache.set(path, info)
    }
    found.push({ path, enc: '', ...info })
  }
  // sessions/YYYY/MM/DD/rollout-*.jsonl; only the days inside the scan window are listed
  for (const y of list(root)) {
    if (y.isFile()) { take(root, y); continue }
    if (!y.isDirectory() || !/^\d{4}$/.test(y.name)) continue
    for (const mo of list(join(root, y.name))) {
      if (!mo.isDirectory() || !/^\d{2}$/.test(mo.name)) continue
      for (const d of list(join(root, y.name, mo.name))) {
        if (!d.isDirectory() || !/^\d{2}$/.test(d.name)) continue
        const dayEnd = Date.UTC(Number(y.name), Number(mo.name) - 1, Number(d.name)) + 2 * 86_400_000
        if (dayEnd < cutoff) continue
        const dir = join(root, y.name, mo.name, d.name)
        for (const f of list(dir)) if (f.isFile()) take(dir, f)
      }
    }
  }
  // A worker's main file is its root thread's, when that is in the window too
  const mains = new Map(found.filter(f => f.kind === 'main').map(f => [f.sessionId, f.path]))
  for (const f of found) if (f.kind === 'agent') f.mainPath = mains.get(f.sessionId) ?? f.path
  return found
}

/**
 * Rollout lines -> Claude-shaped records. One adapter per file (it remembers
 * the model, the cwd and which calls are still open).
 */
export class CodexAdapter {
  constructor(entry = {}) {
    this.sub = entry.kind === 'agent'
    this.model = ''
    this.cwd = entry.cwd || ''
    /** call_id -> true while the call has no output */
    this.open = new Map()
    this.lastUser = ''
  }

  row(type, at, message, extra = {}) {
    return { type, timestamp: at, ...(this.cwd ? { cwd: this.cwd } : {}), ...(this.model ? { model: this.model } : {}), message, ...extra }
  }

  call(at, id, rawName, rawArgs) {
    const { name, input } = normaliseTool(rawName, rawArgs)
    const callId = String(id || `call-${at}-${this.open.size}`)
    this.open.set(callId, true)
    return this.row('assistant', at, { role: 'assistant', model: this.model || undefined, content: [{ type: 'tool_use', id: callId, name, input }] })
  }

  result(at, id, output) {
    const callId = String(id ?? '')
    if (!this.open.has(callId)) return null
    this.open.delete(callId)
    const { text, failed } = readOutput(output)
    return this.row('user', at, { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content: text.slice(0, 20_000), is_error: failed }] })
  }

  /** Calls the turn left unanswered (an abort): closed, so the turn can end. */
  closeOpen(at, out, aborted = false) {
    for (const id of [...this.open.keys()]) {
      this.open.delete(id)
      // An aborted call did not finish: it must not count as a run that did (progression, the backtest station)
      out.push(this.row('user', at, { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: aborted ? 'interrupted' : '', is_error: aborted }] }))
    }
  }

  adapt(lines) {
    const out = []
    for (const l of lines) {
      if (!l || typeof l !== 'object') continue
      const at = iso(l.timestamp, new Date().toISOString())
      const p = l.payload && typeof l.payload === 'object' ? l.payload : {}
      switch (l.type) {
        case 'session_meta': {
          const meta = p.meta ?? p
          if (typeof meta.cwd === 'string' && meta.cwd) this.cwd = meta.cwd
          break
        }
        case 'turn_context':
          if (typeof p.cwd === 'string' && p.cwd) this.cwd = p.cwd
          if (typeof p.model === 'string' && p.model) this.model = p.model
          break
        case 'compacted':
          out.push(this.row('user', at, { role: 'user', content: '' }, { isCompactSummary: true }))
          break
        case 'event_msg':
          this.event(p, at, out)
          break
        case 'response_item':
          this.item(p, at, out)
          break
      }
    }
    return out
  }

  event(p, at, out) {
    switch (p.type) {
      case 'user_message': {
        const text = String(p.message ?? '').trim()
        if (!text) break
        this.lastUser = text
        out.push(this.row('user', at, { role: 'user', content: text }))
        break
      }
      case 'agent_message': {
        const text = String(p.message ?? '').trim()
        if (text) out.push(this.row('assistant', at, { role: 'assistant', model: this.model || undefined, content: [{ type: 'text', text }] }))
        break
      }
      // task_* are the same events under their older names
      case 'turn_complete':
      case 'task_complete': {
        this.closeOpen(at, out)
        const text = String(p.last_agent_message ?? '').trim()
        if (this.sub) { out.push({ type: 'x-done', timestamp: at, text }); break }
        out.push(this.row('assistant', at, { role: 'assistant', model: this.model || undefined, content: text ? [{ type: 'text', text }] : [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' }))
        break
      }
      case 'turn_aborted': {
        this.closeOpen(at, out, true)
        if (this.sub) { out.push({ type: 'x-done', timestamp: at, text: 'stopped' }); break }
        out.push(this.row('user', at, { role: 'user', content: '[Request interrupted by user]' }))
        break
      }
      case 'thread_name_updated': {
        const t = String(p.thread_name ?? p.name ?? '').trim()
        if (t && !this.sub) out.push({ type: 'custom-title', timestamp: at, customTitle: t })
        break
      }
      case 'context_compacted':
        out.push(this.row('user', at, { role: 'user', content: '' }, { isCompactSummary: true }))
        break
    }
  }

  item(p, at, out) {
    switch (p.type) {
      case 'function_call': {
        const ns = typeof p.namespace === 'string' ? p.namespace : ''
        const name = ns.startsWith('mcp__') && !String(p.name).startsWith('mcp__') ? `${ns.replace(/_*$/, '')}__${p.name}` : p.name
        out.push(this.call(at, p.call_id, name, p.arguments))
        break
      }
      case 'custom_tool_call':
        out.push(this.call(at, p.call_id, p.name, { input: p.input }))
        break
      case 'local_shell_call':
        out.push(this.call(at, p.call_id ?? p.id, 'shell', { command: p.action?.command, workdir: p.action?.working_directory }))
        break
      case 'function_call_output':
      case 'custom_tool_call_output': {
        const r = this.result(at, p.call_id, p.output)
        if (r) out.push(r)
        break
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Grok
// ---------------------------------------------------------------------------
//
// Grok's CLI ("Grok Build") keeps a folder per session:
//   ~/.grok/sessions/<url-encoded cwd>/<session id>/
//     updates.jsonl   the session's update stream, one JSON-RPC notification
//                     per line: { timestamp, method: "session/update",
//                     params: { sessionId, update: { sessionUpdate, … }, _meta } }
//                     with user_message_chunk, agent_message_chunk, tool_call,
//                     tool_call_update (status completed | failed) and
//                     turn_completed (stop_reason, usage)
//     events.jsonl    timings: permission_requested / permission_resolved,
//                     tool_started, turn_ended, …
//     summary.json    title (session_summary), cwd, current_model_id
// Read from real sessions (Grok 4.7, November 2026). updates.jsonl is the
// session; events.jsonl only adds the one thing it cannot say, that a
// permission prompt is open right now.

const GROK_KIND = { read: 'Read', edit: 'Edit', execute: 'Bash', search: 'Grep', list: 'Glob', fetch: 'WebFetch' }
const GROK_RESCAN_MS = 5000

function readJson(path) {
  try { return JSON.parse(readHead(path, 256 * 1024)) } catch { return null }
}

function grokScan(config, now) {
  const cache = (grokScan.cache ??= new Map())
  let hit = cache.get(config.dir)
  // The folder list is walked every few seconds; in between, the known sessions are enough
  if (hit && now - hit.at < GROK_RESCAN_MS && now >= hit.at) return hit.found
  const found = []
  const cutoff = now - config.scanDays * 86_400_000
  const list = d => { try { return readdirSync(d, { withFileTypes: true }) } catch { return [] } }
  for (const c of list(config.dir)) {
    if (!c.isDirectory()) continue
    let cwd = ''
    try { cwd = decodeURIComponent(c.name) } catch { cwd = c.name }
    for (const sdir of list(join(config.dir, c.name))) {
      if (!sdir.isDirectory()) continue
      const dir = join(config.dir, c.name, sdir.name)
      const path = join(dir, 'updates.jsonl')
      let st
      try { st = statSync(path) } catch { continue }
      if (st.mtimeMs < cutoff) continue
      const sessionId = `grok-${safeId(sdir.name)}`
      const summaryPath = join(dir, 'summary.json')
      found.push({ path, enc: '', sessionId, kind: 'main', cwd, summaryPath })
      found.push({ path: join(dir, 'events.jsonl'), enc: '', sessionId, kind: 'main', aux: true, cwd })
    }
  }
  cache.set(config.dir, { at: now, found })
  return found
}

/** updates.jsonl -> Claude-shaped records. */
export class GrokAdapter {
  constructor(entry = {}) {
    this.cwd = entry.cwd || ''
    this.summaryPath = entry.summaryPath
    this.model = ''
    this.title = ''
    this.text = ''
    this.open = new Map()
  }

  row(type, at, message, extra = {}) {
    return { type, timestamp: at, ...(this.cwd ? { cwd: this.cwd } : {}), ...(this.model ? { model: this.model } : {}), message, ...extra }
  }

  /** The title and model Grok keeps beside the stream (summary.json), when they changed. */
  summary(at, out) {
    if (!this.summaryPath) return
    const j = readJson(this.summaryPath)
    if (!j) return
    if (typeof j.current_model_id === 'string' && j.current_model_id) this.model = j.current_model_id
    const t = typeof j.session_summary === 'string' ? j.session_summary.trim() : ''
    if (t && t !== this.title) { this.title = t; out.push({ type: 'custom-title', timestamp: at, customTitle: t }) }
  }

  /** What Grok has said since the last tool call or prompt, as one text row. */
  flushText(at, out, extra = {}) {
    const text = this.text.trim()
    this.text = ''
    if (!text && !extra.stop_reason) return
    out.push(this.row('assistant', at, { role: 'assistant', model: this.model || undefined, content: [{ type: 'text', text: text || 'done' }], ...extra }))
  }

  adapt(lines) {
    const out = []
    let last = new Date().toISOString()
    // The title and model first, so the session starts with them
    if (!this.title && lines.length) this.summary(iso(lines[0]?.params?._meta?.agentTimestampMs ?? lines[0]?.timestamp, last), out)
    for (const l of lines) {
      const u = l?.params?.update
      if (!u || typeof u !== 'object') continue
      const meta = l.params._meta ?? {}
      const at = iso(meta.agentTimestampMs ?? l.timestamp, last)
      last = at
      switch (u.sessionUpdate) {
        case 'user_message_chunk': {
          const text = String(u.content?.text ?? '').trim()
          if (typeof u._meta?.modelId === 'string') this.model = u._meta.modelId
          this.text = ''
          if (text) out.push(this.row('user', at, { role: 'user', content: text }))
          break
        }
        case 'agent_message_chunk':
          if (typeof u.content?.text === 'string') this.text += u.content.text
          break
        case 'tool_call': {
          this.flushText(at, out)
          const tool = u._meta?.['x.ai/tool'] ?? {}
          const raw = String(tool.name ?? u.title ?? 'tool')
          const ns = typeof tool.namespace === 'string' ? tool.namespace : ''
          let { name, input } = normaliseTool(raw, u.rawInput)
          if (ns && ns !== 'grok_build' && !name.startsWith('mcp__')) name = `mcp__${ns}__${raw}`
          else if (name === raw && GROK_KIND[tool.kind]) name = GROK_KIND[tool.kind]
          const id = String(u.toolCallId ?? `call-${at}-${this.open.size}`)
          this.open.set(id, true)
          out.push(this.row('assistant', at, { role: 'assistant', model: this.model || undefined, content: [{ type: 'tool_use', id, name, input }] }))
          break
        }
        case 'tool_call_update': {
          const id = String(u.toolCallId ?? '')
          if ((u.status !== 'completed' && u.status !== 'failed') || !this.open.has(id)) break
          this.open.delete(id)
          const text = (Array.isArray(u.content) ? u.content : []).map(c => (typeof c?.content?.text === 'string' ? c.content.text : '')).filter(Boolean).join('\n')
          out.push(this.row('user', at, { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text.slice(0, 20_000), is_error: u.status === 'failed' }] }))
          break
        }
        case 'turn_completed': {
          const cancelled = u.stop_reason === 'cancelled'
          for (const id of [...this.open.keys()]) {
            this.open.delete(id)
            out.push(this.row('user', at, { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: cancelled ? 'interrupted' : '', is_error: cancelled }] }))
          }
          if (cancelled) {
            this.flushText(at, out)
            out.push(this.row('user', at, { role: 'user', content: '[Request interrupted by user]' }))
          } else this.flushText(at, out, { stop_reason: 'end_turn' })
          break
        }
      }
    }
    if (out.length) this.summary(last, out)
    return out
  }
}

/**
 * events.jsonl -> the one record the stream cannot give: a permission prompt
 * that is open. Grok writes permission_requested for every call and resolves
 * the ones its rules allow in the same instant, so only a request that is
 * still unanswered at the end of a read is a prompt on screen.
 */
export class GrokEventsAdapter {
  constructor() { this.asked = null }

  adapt(lines) {
    const out = []
    for (const l of lines) {
      if (!l || typeof l !== 'object') continue
      if (l.type === 'permission_requested') this.asked = { at: iso(l.ts, new Date().toISOString()), tool: String(l.tool_name ?? '') }
      else if (l.type === 'permission_resolved' || l.type === 'turn_ended' || l.type === 'tool_completed') this.asked = null
    }
    if (this.asked) {
      const { name } = normaliseTool(this.asked.tool, {})
      out.push({ type: 'x-permission', timestamp: this.asked.at, toolName: name })
      this.asked = null
    }
    return out
  }
}

// ---------------------------------------------------------------------------
// The providers, and their settings
// ---------------------------------------------------------------------------

export const PROVIDERS = Object.freeze({
  codex: {
    id: 'codex',
    name: 'Codex',
    /** turn_complete is in the file: a quiet text reply is not the end of a turn */
    explicitTurnEnd: true,
    /** Approval dialogs are not in the file; a slow call is never guessed to be one */
    guessPermissions: false,
    defaultDir: env => join(env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'),
    scan: codexScan,
    createAdapter: entry => new CodexAdapter(entry),
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    /** turn_completed is in the stream */
    explicitTurnEnd: true,
    /** An open prompt is read from events.jsonl, never guessed */
    guessPermissions: false,
    defaultDir: env => join(env.GROK_HOME || join(homedir(), '.grok'), 'sessions'),
    scan: grokScan,
    createAdapter: entry => (entry.aux ? new GrokEventsAdapter() : new GrokAdapter(entry)),
  },
})

/**
 * A provider's watcher config: the transcript settings (projects, timings),
 * with its own folder and its own project filter. `providers.<id>` in
 * office.config.json: { enabled, dir, onlyListed, scanDays }. A provider is on
 * unless `enabled` is false; a folder that does not exist simply finds nothing.
 */
export function resolveProviderConfig(id, officeConfig = {}, base = {}, env = process.env) {
  const provider = PROVIDERS[id]
  if (!provider) return null
  const all = officeConfig && typeof officeConfig.providers === 'object' && officeConfig.providers ? officeConfig.providers : {}
  const own = all[id] && typeof all[id] === 'object' ? all[id] : {}
  if (own.enabled === false || all[id] === false) return null
  const envDir = env[`AGENT_OFFICE_${id.toUpperCase()}_DIR`]
  const days = typeof own.scanDays === 'number' && own.scanDays > 0 ? own.scanDays : 30
  return {
    ...base,
    dir: envDir || (typeof own.dir === 'string' && own.dir.trim()) || provider.defaultDir(env),
    registryDir: null,
    claudeDir: null,
    // Every thread of the other tools shows unless told otherwise: their cwd may be a worktree outside the listed folders
    onlyListed: typeof own.onlyListed === 'boolean' ? own.onlyListed : false,
    scanDays: days,
  }
}
