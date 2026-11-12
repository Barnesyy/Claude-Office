/**
 * transcript-source.js — the hookless data source (EA fork default).
 *
 * Instead of Claude Code hooks, this reads the JSONL transcripts Claude Code
 * writes anyway (~/.claude/projects/<encoded cwd>/<session id>.jsonl, and
 * <session id>/subagents/agent-<id>.jsonl for each worker) and rebuilds the
 * hook payloads the hook mode would have sent: SessionStart, UserPromptSubmit,
 * PreToolUse / PostToolUse / PostToolUseFailure / PostToolBatch,
 * SubagentStart / SubagentStop, PermissionRequest, Stop, StopFailure,
 * PostCompact, CwdChanged, PostModelSwitch, SessionEnd. Those payloads are
 * turned into office events by the unchanged hooks/agent-tracker.py (through
 * hooks/tracker-bridge.py, one long-lived process) or, when no Python is
 * found, by the small built-in converter below, and handed to a sink (POST
 * /event with the office token, see scripts/transcript-watch.mjs).
 *
 * Nothing is installed into Claude Code and nothing in ~/.claude is written.
 *
 * What a transcript cannot say, and how it is inferred:
 *   - permission waits: Claude Code's registry (~/.claude/sessions/<pid>.json,
 *     status "waiting") when the session has an entry there; otherwise a tool
 *     call that needs permission (not allowed by the permission mode or a
 *     settings.json allow rule) and has had no answer for a grace period
 *   - turn end without a stop_reason: the last record is a text-only reply and
 *     the file has been quiet for TURN_IDLE_MS
 *   - session end: /exit, or the file quiet for idleEndMs
 *
 * Everything that maps records to payloads is pure (TranscriptSession), so
 * tests/transcript-source.test.ts covers it without files or timers.
 */

import { spawn, spawnSync } from 'child_process'
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const BRIDGE_SCRIPT = join(HERE, '..', 'hooks', 'tracker-bridge.py')

// ---------------------------------------------------------------------------
// Projects: which sessions to show, and what to call them
// ---------------------------------------------------------------------------

/** Claude Code's project dir name for a cwd: every non-alphanumeric character becomes '-'. */
export function encodeProjectPath(p) {
  return String(p ?? '').replace(/[^A-Za-z0-9]/g, '-')
}

/** Built-in project presets (`"preset": "ea-development"` in office.config.json). */
export const PRESETS = Object.freeze({
  'ea-development': {
    projects: [{ name: 'EA Dev', path: 'C:\\Users\\Barnesy\\OneDrive\\EA Development' }],
    onlyListed: true,
  },
})

function normPath(p) {
  return String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** The last path segment of a cwd, either separator. */
export function baseName(p) {
  const parts = String(p ?? '').split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : String(p ?? '')
}

/**
 * The transcript settings from office.config.json's `transcripts` block (and
 * its `preset`), with defaults. Pure.
 */
export function resolveTranscriptConfig(config = {}, env = process.env) {
  const t = config && typeof config.transcripts === 'object' && config.transcripts ? config.transcripts : {}
  const presetName = t.preset ?? config.preset
  const preset = presetName && PRESETS[presetName] ? PRESETS[presetName] : null
  const listed = Array.isArray(t.projects) ? t.projects : (preset?.projects ?? [])
  const projects = listed
    .filter(p => p && typeof p.path === 'string' && p.path.trim())
    .map(p => ({
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 40) : baseName(p.path),
      path: p.path.trim(),
      norm: normPath(p.path.trim()),
      encoded: encodeProjectPath(p.path.trim()).toLowerCase(),
    }))
    // Longest first, so a sub-project listed on its own wins over its parent
    .sort((a, b) => b.norm.length - a.norm.length)
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
  const claudeDir = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return {
    dir: env.AGENT_OFFICE_TRANSCRIPTS_DIR || (typeof t.dir === 'string' && t.dir.trim()) || join(claudeDir, 'projects'),
    registryDir: env.AGENT_OFFICE_REGISTRY_DIR || join(claudeDir, 'sessions'),
    claudeDir,
    projects,
    onlyListed: typeof t.onlyListed === 'boolean' ? t.onlyListed : (preset?.onlyListed ?? false),
    activeWindowMs: num(t.activeWindowMinutes, 20) * 60_000,
    idleEndMs: num(t.idleEndMinutes, 45) * 60_000,
    permissionGraceMs: num(t.permissionGraceSeconds, 6) * 1000,
    bashPermissionGraceMs: num(t.bashPermissionGraceSeconds, 15) * 1000,
    turnIdleMs: num(t.turnIdleSeconds, 4) * 1000,
    pollMs: num(t.pollMs, 700),
  }
}

/**
 * Which listed project a session belongs to and its readable label:
 *   cwd = the project path              -> "EA Dev"
 *   cwd = <project path>\School Run      -> "EA Dev · School Run"
 * Falls back to the encoded project dir name when the cwd is unknown.
 * Returns { project, label } (project null when no listed project matches).
 */
export function labelFor(cwd, encodedDir, projects) {
  const n = normPath(cwd)
  for (const p of projects) {
    if (n && (n === p.norm || n.startsWith(p.norm + '/'))) {
      const rel = cwd.replace(/\\/g, '/').slice(p.norm.length).split('/').filter(Boolean)
      return { project: p, label: rel.length ? `${p.name} · ${rel.join(' / ')}` : p.name }
    }
  }
  const enc = String(encodedDir ?? '').toLowerCase()
  for (const p of projects) {
    if (enc && (enc === p.encoded || enc.startsWith(p.encoded + '-'))) {
      const rest = String(encodedDir).slice(p.encoded.length).split('-').filter(Boolean).join(' ')
      return { project: p, label: rest ? `${p.name} · ${rest}` : p.name }
    }
  }
  return { project: null, label: cwd ? baseName(cwd) : (encodedDir || 'session') }
}

// ---------------------------------------------------------------------------
// Permissions: would this call have shown a dialog?
// ---------------------------------------------------------------------------

/** Tools that never ask (read-only, or the office's own bookkeeping). */
const NEVER_ASKS = new Set(['Read', 'Grep', 'Glob', 'LS', 'TodoWrite', 'TodoRead', 'Agent', 'Task', 'NotebookRead',
  'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop', 'BashOutput', 'KillShell', 'KillBash',
  'WebSearch', 'Skill', 'ToolSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'SubagentHandback'])
/** Tools that always wait on the person (a question, a plan to approve). */
const ALWAYS_ASKS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
  return new RegExp(`^${esc}$`, 'i')
}

/** Does one allow rule ("Bash(npm test:*)", "Edit", "mcp__github", "WebFetch(domain:x.com)") cover this call? */
export function ruleAllows(rule, tool, input = {}) {
  const m = /^([^()]+)(?:\((.*)\))?$/.exec(String(rule).trim())
  if (!m) return false
  const [, name, spec] = m
  if (name.startsWith('mcp__')) return tool === name || tool.startsWith(name + '__') || (name.endsWith('__*') && tool.startsWith(name.slice(0, -1)))
  if (name !== tool) return false
  if (spec === undefined || spec === '' || spec === '*') return true
  if (tool === 'Bash') {
    const cmd = String(input.command ?? '').trim()
    if (spec.endsWith(':*')) return cmd.startsWith(spec.slice(0, -2))
    if (spec.includes('*')) return globToRegex(spec).test(cmd)
    return cmd === spec
  }
  if (tool === 'WebFetch' && spec.startsWith('domain:')) {
    try { return new URL(String(input.url)).hostname.endsWith(spec.slice(7)) } catch { return false }
  }
  const path = String(input.file_path ?? input.notebook_path ?? input.path ?? '').replace(/\\/g, '/')
  const pat = spec.replace(/^\/\//, '/').replace(/\\/g, '/')
  return globToRegex(pat.startsWith('/') || /^[A-Za-z]:/.test(pat) ? pat : `**/${pat.replace(/^\.\//, '')}`).test(path)
}

/** Would this call show a permission dialog, given the session's mode and allow rules? */
export function needsPermission(tool, input, mode, allowRules = []) {
  if (!tool) return false
  if (ALWAYS_ASKS.has(tool)) return true
  if (NEVER_ASKS.has(tool)) return false
  if (mode === 'bypassPermissions') return false
  if (mode === 'acceptEdits' && EDIT_TOOLS.has(tool)) return false
  if (tool === 'Bash' && input?.run_in_background) return false
  return !allowRules.some(rule => ruleAllows(rule, tool, input ?? {}))
}

/** permissions.allow and defaultMode from the user's and the project's settings files (read-only). */
export function readPermissionSettings(claudeDir, cwd) {
  const files = [join(claudeDir, 'settings.json'), join(claudeDir, 'settings.local.json')]
  if (cwd) files.push(join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json'))
  const allow = []
  let defaultMode
  for (const f of files) {
    try {
      const s = JSON.parse(readFileSync(f, 'utf8'))
      if (Array.isArray(s?.permissions?.allow)) allow.push(...s.permissions.allow.filter(r => typeof r === 'string'))
      if (typeof s?.permissions?.defaultMode === 'string') defaultMode = s.permissions.defaultMode
    } catch {}
  }
  return { allow, defaultMode }
}

// ---------------------------------------------------------------------------
// One session: transcript records in, hook payloads out (pure)
// ---------------------------------------------------------------------------

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
}

/**
 * When the transcript record behind a rebuilt payload was written (ms), for
 * taps that need the real time of a tool call (the EA scenes compare a
 * tester report's mtime with when its run started). Kept beside the payload,
 * not in it, so the payloads stay exactly the hook's shape.
 */
const payloadTimes = new WeakMap()
export function payloadTime(p) { return payloadTimes.get(p) }

const REJECTED = /doesn't want to proceed with this tool use|tool use was rejected|permission to use .* has been denied/i
const INTERRUPTED = /^\[Request interrupted by user/

export class TranscriptSession {
  /**
   * @param {{sessionId: string, transcriptPath: string, encodedDir?: string, projects?: object[]}} opts
   */
  constructor({ sessionId, transcriptPath, encodedDir = '', projects = [] }) {
    this.sessionId = sessionId
    this.transcriptPath = transcriptPath
    this.encodedDir = encodedDir
    this.projects = projects
    this.cwd = ''
    this.model = ''
    this.title = ''
    this.started = false
    this.ended = false
    this.permissionMode = 'default'
    this.promptId = undefined
    this.turnOpen = false
    this.lastText = ''
    this.lastKind = ''          // 'text' | 'tool' | 'result' | 'prompt' | 'stop'
    /** tool_use_id -> { name, input, agentId?, agentType?, at, raised } */
    this.pending = new Map()
    /** tool_use_ids of the current batch per thread ('' = main) */
    this.batches = new Map()
    /** Agent tool calls: tool_use_id -> { subagentType, prompt, background, subagentId? } */
    this.agentCalls = new Map()
    /** subagent id -> { agentType, transcriptPath, lastText, started, done } */
    this.subagents = new Map()
  }

  get label() { return labelFor(this.cwd, this.encodedDir, this.projects) }

  base(extra = {}) {
    const p = { session_id: this.sessionId, transcript_path: this.transcriptPath, ...extra }
    if (this.recordAt) payloadTimes.set(p, this.recordAt)
    if (this.cwd) p.cwd = this.cwd
    if (this.promptId) p.prompt_id = this.promptId
    return p
  }

  startPayload(source) {
    // A later update (title learnt, resumed after idle) keeps how it first started
    if (this.started && !this.ended && this.startSource) source = this.startSource
    this.startSource = source
    this.started = true
    this.ended = false
    const p = this.base({ hook_event_name: 'SessionStart', source })
    if (this.model) p.model = this.model
    if (this.title) p.session_title = this.title
    return p
  }

  /** Records of the session's own transcript. */
  mainRecords(records, out = []) {
    for (const r of records) this.mainRecord(r, out)
    return out
  }

  mainRecord(r, out = []) {
    if (!r || typeof r !== 'object') return out
    this.recordAt = Date.parse(r.timestamp) || undefined
    if (r.isSidechain && r.agentId) return this.subagentRecord(r.agentId, r, out)
    if (!this.started && (r.type === 'user' || r.type === 'assistant')) {
      if (typeof r.cwd === 'string' && r.cwd) this.cwd = r.cwd
      out.push(this.startPayload('startup'))
    }
    if (typeof r.cwd === 'string' && r.cwd && this.cwd && r.cwd !== this.cwd) {
      out.push(this.base({ hook_event_name: 'CwdChanged', old_cwd: this.cwd, new_cwd: r.cwd }))
      this.cwd = r.cwd
    } else if (typeof r.cwd === 'string' && r.cwd && !this.cwd) this.cwd = r.cwd
    if (typeof r.permissionMode === 'string') this.permissionMode = r.permissionMode

    switch (r.type) {
      case 'summary':
      case 'custom-title':
      case 'ai-title': {
        const t = r.customTitle ?? r.aiTitle ?? r.title ?? r.summary
        if (typeof t === 'string' && t.trim() && (r.type === 'custom-title' || !this.titleIsCustom)) {
          this.title = t.trim().slice(0, 80)
          if (r.type === 'custom-title') this.titleIsCustom = true
          if (this.started) out.push(this.startPayload('resume'))
        }
        return out
      }
      case 'system': {
        if (r.subtype === 'compact_boundary') out.push(this.base({ hook_event_name: 'PostCompact', trigger: r.compactMetadata?.trigger ?? 'auto' }))
        else if (r.subtype === 'turn_duration' && this.turnOpen && this.pending.size === 0) out.push(this.stop())
        return out
      }
      case 'user': return this.userRecord(r, null, out)
      case 'assistant': return this.assistantRecord(r, null, out)
      default: return out
    }
  }

  stop(text = this.lastText) {
    this.turnOpen = false
    this.lastKind = 'stop'
    const background = [...this.subagents.entries()]
      .filter(([, s]) => s.background && !s.done)
      .map(([id, s]) => ({ id, type: 'local_agent', status: 'running', description: s.description ?? s.agentType }))
    return this.base({ hook_event_name: 'Stop', last_assistant_message: text, background_tasks: background, session_crons: [], stop_hook_active: false })
  }

  userRecord(r, sub, out) {
    if (r.isMeta) return out
    if (r.isCompactSummary) { out.push(this.base({ hook_event_name: 'PostCompact', trigger: 'auto' })); return out }
    const content = r.message?.content
    const results = Array.isArray(content) ? content.filter(b => b && b.type === 'tool_result') : []
    if (results.length) {
      for (const b of results) this.toolResult(b, r.toolUseResult, sub, out)
      return out
    }
    if (sub) return out  // a worker's prompt is its task, already on the Agent call
    const text = textOf(content)
    if (!text.trim()) return out
    if (/<command-name>\/exit<\/command-name>/.test(text)) {
      this.ended = true
      out.push(this.base({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }))
      return out
    }
    if (/^\s*<(command-name|command-message|local-command-stdout|local-command-caveat|bash-input|bash-stdout)/.test(text)) return out
    if (INTERRUPTED.test(text.trim())) {
      if (this.turnOpen) out.push(this.stop('(interrupted)'))
      this.pending.clear()
      return out
    }
    if (typeof r.promptId === 'string') this.promptId = r.promptId
    // A background worker reporting back: its stop first, then the wake-up prompt
    const task = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(text)
    if (text.trimStart().startsWith('<task-notification>') && task) {
      const s = this.subagents.get(task[1])
      if (s && !s.done) {
        s.done = true
        const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text)
        out.push(this.base({ hook_event_name: 'SubagentStop', agent_id: task[1], agent_type: s.agentType,
          last_assistant_message: s.lastText || summary?.[1] || 'done', agent_transcript_path: s.transcriptPath }))
      }
    }
    this.pending.clear()
    this.batches.clear()
    this.turnOpen = true
    this.lastKind = 'prompt'
    this.lastText = ''
    if (!this.title && !text.trimStart().startsWith('<')) this.firstPrompt ??= text.trim().split('\n')[0].slice(0, 60)
    out.push(this.base({ hook_event_name: 'UserPromptSubmit', prompt: text, permission_mode: this.permissionMode }))
    return out
  }

  assistantRecord(r, sub, out) {
    const msg = r.message ?? {}
    const model = typeof msg.model === 'string' && msg.model !== '<synthetic>' ? msg.model : ''
    if (!sub && model && model !== this.model) {
      if (this.model && this.started) out.push(this.base({ hook_event_name: 'PostModelSwitch', from_model: this.model, to_model: model, source: 'transcript' }))
      this.model = model
    }
    if (!sub && !this.turnOpen && msg.content) this.turnOpen = true
    const blocks = Array.isArray(msg.content) ? msg.content : []
    const thread = sub?.id ?? ''
    for (const b of blocks) {
      if (!b) continue
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        if (sub) sub.lastText = b.text
        else { this.lastText = b.text; this.lastKind = 'text' }
      } else if (b.type === 'tool_use' && b.id && b.name) {
        const input = b.input && typeof b.input === 'object' ? b.input : {}
        const call = { name: b.name, input, at: Date.parse(r.timestamp) || Date.now(), raised: false, thread }
        if (sub) { call.agentId = sub.id; call.agentType = sub.agentType }
        this.pending.set(b.id, call)
        if (!this.batches.has(thread)) this.batches.set(thread, [])
        this.batches.get(thread).push(b.id)
        if (b.name === 'Agent' || b.name === 'Task') {
          this.agentCalls.set(b.id, { subagentType: input.subagent_type || input.agent_type || 'general-purpose',
            prompt: String(input.prompt ?? ''), description: String(input.description ?? ''), background: !!input.run_in_background })
        }
        if (!sub) this.lastKind = 'tool'
        out.push(this.base({ hook_event_name: 'PreToolUse', tool_name: b.name, tool_input: input, tool_use_id: b.id,
          ...(sub ? { agent_id: sub.id, agent_type: sub.agentType } : {}) }))
      }
    }
    if (r.isApiErrorMessage && !sub) {
      this.turnOpen = false
      out.push(this.base({ hook_event_name: 'StopFailure', error: String(r.error ?? 'api_error'), last_assistant_message: textOf(msg.content) }))
      return out
    }
    if (!sub && (msg.stop_reason === 'end_turn' || msg.stop_reason === 'stop_sequence') && this.pending.size === 0) out.push(this.stop())
    return out
  }

  toolResult(b, toolUseResult, sub, out) {
    const id = b.tool_use_id
    const call = this.pending.get(id)
    if (!call) return
    this.pending.delete(id)
    const text = typeof b.content === 'string' ? b.content : textOf(b.content)
    const extra = sub ? { agent_id: sub.id, agent_type: sub.agentType } : (call.agentId ? { agent_id: call.agentId, agent_type: call.agentType } : {})
    const common = { tool_name: call.name, tool_input: call.input, tool_use_id: id, ...extra }
    if (b.is_error || REJECTED.test(text)) {
      const error = REJECTED.test(text) ? 'rejected in the terminal' : text || 'error'
      out.push(this.base({ hook_event_name: 'PostToolUseFailure', ...common, error, is_interrupt: false }))
    } else {
      let response = toolUseResult ?? text
      if ((call.name === 'Agent' || call.name === 'Task') && response && typeof response === 'object') {
        const agentCall = this.agentCalls.get(id)
        const sid = response.agentId ?? agentCall?.subagentId
        if (sid && response.status === 'async_launched') {
          const s = this.subagents.get(sid) ?? {}
          this.subagents.set(sid, { agentType: agentCall?.subagentType ?? 'general-purpose', ...s, background: true, description: agentCall?.description })
        } else if (sid && this.subagents.has(sid)) this.subagents.get(sid).done = true
      }
      out.push(this.base({ hook_event_name: 'PostToolUse', ...common, tool_response: response }))
    }
    if (!sub) this.lastKind = 'result'
    // The whole batch of that thread answered: PostToolBatch (lowers the thread's hands)
    const thread = call.thread ?? ''
    const batch = this.batches.get(thread)
    if (batch && batch.every(t => !this.pending.has(t))) {
      this.batches.delete(thread)
      out.push(this.base({ hook_event_name: 'PostToolBatch', tool_calls: batch.map(t => ({ tool_use_id: t })),
        ...(thread ? { agent_id: thread } : {}) }))
    }
  }

  /** Records of one worker (its own subagents/agent-<id>.jsonl, or sidechain rows of the main file). */
  subagentRecords(agentId, records, out = [], transcriptPath) {
    for (const r of records) this.subagentRecord(agentId, r, out, transcriptPath)
    return out
  }

  subagentRecord(agentId, r, out = [], transcriptPath) {
    if (!r || typeof r !== 'object') return out
    this.recordAt = Date.parse(r.timestamp) || undefined
    let s = this.subagents.get(agentId)
    if (!s || !s.started) {
      // Which Agent call launched it: the one whose prompt is the worker's first message
      const first = r.type === 'user' ? textOf(r.message?.content) : ''
      let callId = null
      for (const [id, c] of this.agentCalls) if (!c.subagentId && first && c.prompt && c.prompt.trim() === first.trim()) { callId = id; break }
      if (!callId) for (const [id, c] of this.agentCalls) if (!c.subagentId && this.pending.has(id)) { callId = id; break }
      const c = callId ? this.agentCalls.get(callId) : null
      if (c) c.subagentId = agentId
      s = { ...(s ?? {}), id: agentId, agentType: c?.subagentType ?? s?.agentType ?? 'general-purpose', description: c?.description,
        background: c?.background ?? s?.background ?? false, transcriptPath, started: true, lastText: '' }
      this.subagents.set(agentId, s)
      out.push(this.base({ hook_event_name: 'SubagentStart', agent_id: agentId, agent_type: s.agentType }))
    }
    s.id = agentId
    if (r.type === 'user') this.userRecord(r, s, out)
    else if (r.type === 'assistant') this.assistantRecord(r, s, out)
    return out
  }

  /**
   * What to raise now that the file has been quiet: a permission hand for a
   * call that would have asked and still has no answer. `registryWaiting` is
   * true / false from Claude Code's registry, or undefined when the session
   * has no registry entry (then the grace periods decide).
   */
  quietCheck(now, quietMs, { graceMs, bashGraceMs, turnIdleMs, allow = [], defaultMode, registryWaiting } = {}) {
    const out = []
    const mode = this.permissionMode !== 'default' ? this.permissionMode : (defaultMode ?? 'default')
    const candidates = [...this.pending.entries()].filter(([, c]) => !c.raised && c.name !== 'Agent' && c.name !== 'Task')
    for (const [id, c] of candidates.reverse()) {
      let raise = false
      if (registryWaiting === true) raise = true
      else if (registryWaiting === undefined) {
        const grace = c.name === 'Bash' ? bashGraceMs : graceMs
        raise = grace > 0 && quietMs >= grace && needsPermission(c.name, c.input, mode, allow)
      }
      if (!raise) continue
      c.raised = true
      out.push(this.base({ hook_event_name: 'PermissionRequest', tool_name: c.name, tool_input: c.input, tool_use_id: id,
        permission_mode: mode, ...(c.agentId ? { agent_id: c.agentId, agent_type: c.agentType } : {}) }))
      break  // one dialog at a time
    }
    if (this.turnOpen && this.lastKind === 'text' && this.pending.size === 0 && turnIdleMs > 0 && quietMs >= turnIdleMs) out.push(this.stop())
    return out
  }
}

// ---------------------------------------------------------------------------
// Converters: hook payload -> office events
// ---------------------------------------------------------------------------

/** A python that runs: AGENT_OFFICE_PYTHON, else py -3 / python / python3 (Windows) or python3 / python. */
export function findPython(env = process.env, platform = process.platform) {
  const candidates = []
  if (env.AGENT_OFFICE_PYTHON) candidates.push([env.AGENT_OFFICE_PYTHON, []])
  if (platform === 'win32') candidates.push(['py', ['-3']], ['python', []], ['python3', []])
  else candidates.push(['python3', []], ['python', []])
  for (const [cmd, args] of candidates) {
    try {
      const r = spawnSync(cmd, [...args, '-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
      if (r.status === 0 && r.stdout.trim() === '3') return { cmd, args }
    } catch {}
  }
  return null
}

/**
 * The unchanged hooks/agent-tracker.py behind one long-lived python process
 * (hooks/tracker-bridge.py). convert(payload) resolves with its events, in order.
 */
export function createPythonConverter(python, { log = console } = {}) {
  const child = spawn(python.cmd, [...python.args, '-X', 'utf8', BRIDGE_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  const waiting = []
  let buf = ''
  let dead = false
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      const w = waiting.shift()
      if (!w) continue
      try { w.resolve(JSON.parse(line).events ?? []) } catch { w.resolve([]) }
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', d => log.warn?.(String(d).trim()))
  child.on('exit', code => {
    dead = true
    for (const w of waiting.splice(0)) w.resolve([])
    log.warn?.(`[transcripts] tracker bridge exited (${code})`)
  })
  return {
    kind: 'python',
    convert(payload) {
      if (dead) return Promise.resolve([])
      return new Promise(resolve => {
        waiting.push({ resolve })
        child.stdin.write(JSON.stringify(payload) + '\n')
      })
    },
    close() { try { child.stdin.end() } catch {}; try { child.kill() } catch {} },
    get alive() { return !dead },
  }
}

/**
 * The built-in converter, for a machine without Python: the core events only
 * (no Bash signals, no role guess from the task text).
 */
export function convertPayloadJs(d) {
  const ev = []
  const session = {}
  if (d.session_id) session.sessionId = String(d.session_id)
  if (d.cwd) { session.cwd = d.cwd; session.project = baseName(d.cwd) }
  if (d.transcript_path) session.transcriptPath = d.transcript_path
  const emit = e => ev.push({ ...e, ...Object.fromEntries(Object.entries(session).filter(([k]) => !(k in e))), ...(d.prompt_id && !e.promptId ? { promptId: String(d.prompt_id) } : {}) })
  const sub = d.agent_id ? { agentId: String(d.agent_id), agentType: String(d.agent_type || 'general-purpose') } : {}
  const tool = d.tool_name || ''
  const inp = d.tool_input && typeof d.tool_input === 'object' ? d.tool_input : {}
  const file = p => String(p || '').split(/[\\/]/).pop()
  switch (d.hook_event_name) {
    case 'SessionStart': emit({ type: 'session_started', source: d.source || 'startup', ...(d.model ? { model: d.model } : {}), ...(d.session_title ? { title: d.session_title } : {}) }); break
    case 'SessionEnd': emit({ type: 'session_ended', reason: d.reason || 'other' }); break
    case 'SubagentStart': emit({ type: 'agent_started', subagentId: String(d.agent_id), agentType: String(d.agent_type) }); break
    case 'SubagentStop': emit({ type: 'agent_completed', agentId: String(d.agent_id), result: String(d.last_assistant_message || 'done').slice(0, 120), ...(d.agent_transcript_path ? { agentTranscriptPath: d.agent_transcript_path } : {}) }); break
    case 'UserPromptSubmit': {
      const text = String(d.prompt || '')
      const e = { type: 'session_prompt', text: text.slice(0, 2000), isWakeup: false }
      if (text.trimStart().startsWith('<task-notification>')) {
        e.isWakeup = true
        const id = /<task-id>\s*([^<\s]+)/.exec(text); if (id) e.wakeupAgentId = id[1]
        const sum = /<summary>([\s\S]*?)<\/summary>/.exec(text); e.text = (sum ? sum[1] : 'a background task finished').replace(/\s+/g, ' ').trim()
      }
      emit(e); break
    }
    case 'Stop': emit({ type: 'session_turn_end', text: String(d.last_assistant_message || '').slice(0, 2000), backgroundTasks: d.background_tasks || [], crons: 0, stopHookActive: false }); break
    case 'StopFailure': emit({ type: 'session_error', error: String(d.error || 'unknown').slice(0, 40), detail: String(d.last_assistant_message || '').slice(0, 200) }); break
    case 'PostCompact': emit({ type: 'session_compact', phase: 'post', trigger: d.trigger || 'auto' }); break
    case 'CwdChanged': emit({ type: 'session_cwd', cwd: d.new_cwd, project: baseName(d.new_cwd), oldCwd: d.old_cwd }); break
    case 'PostModelSwitch': emit({ type: 'session_model', model: d.to_model, fromModel: d.from_model }); break
    case 'PostToolBatch': emit({ type: 'session_tool_done', batch: true, count: (d.tool_calls || []).length, ...(sub.agentId ? { agentId: sub.agentId } : {}) }); break
    case 'PermissionRequest': emit({ type: 'session_needs_you', kind: 'permission', toolName: tool, summary: tool === 'Bash' ? String(inp.command || '').slice(0, 80) : (file(inp.file_path) || tool), ...(sub.agentId ? { agentId: sub.agentId } : {}) }); break
    case 'PreToolUse':
      if (tool === 'Agent' || tool === 'Task') {
        const type = inp.subagent_type || 'general-purpose'
        emit({ type: 'agent_spawned', agent: { id: `agent-${d.tool_use_id}`, name: type === 'Explore' ? 'Explorer' : 'Agent', role: type === 'Explore' ? 'Explore' : 'general-purpose', task: String(inp.description || inp.prompt || 'Working on task').slice(0, 80), agentType: type, background: !!inp.run_in_background, ...(sub.agentId ? { parentSubagentId: sub.agentId } : {}) } })
      } else if (tool.startsWith('mcp__')) {
        const [server, t] = tool.slice(5).split('__'); emit({ type: 'mcp_call', server, tool: t || '' })
      } else {
        const status = { Read: `reading ${file(inp.file_path)}`, Write: `writing ${file(inp.file_path)}`, Edit: `editing ${file(inp.file_path)}`, Bash: `running: ${String(inp.command || inp.description || '').slice(0, 60)}`, Grep: `searching for '${String(inp.pattern || '').slice(0, 30)}'`, Glob: `finding files: ${String(inp.pattern || '').slice(0, 40)}` }[tool] ?? `using ${tool.slice(0, 40)}`
        emit({ type: 'agent_working', status, tool, ...sub })
      }
      break
    case 'PostToolUse':
      if (tool === 'Agent' || tool === 'Task') {
        const r = d.tool_response && typeof d.tool_response === 'object' ? d.tool_response : {}
        if (r.status === 'async_launched') emit({ type: 'agent_linked', agentId: `agent-${d.tool_use_id}`, subagentId: String(r.agentId || '') })
        else emit({ type: 'agent_completed', agentId: `agent-${d.tool_use_id}`, result: String((Array.isArray(r.content) ? r.content.map(c => c.text).join(' ') : r.content) || 'done').slice(0, 120) })
      } else if (tool.startsWith('mcp__')) {
        const [server, t] = tool.slice(5).split('__'); emit({ type: 'mcp_done', server, tool: t || '', ...(sub.agentId ? { agentId: sub.agentId } : {}) })
      } else emit({ type: 'session_tool_done', toolName: tool, ...(sub.agentId ? { agentId: sub.agentId } : {}) })
      break
    case 'PostToolUseFailure':
      if (tool === 'Agent' || tool === 'Task') emit({ type: 'agent_completed', agentId: `agent-${d.tool_use_id}`, result: `failed: ${String(d.error).slice(0, 110)}` })
      else emit({ type: 'agent_working', status: `failed: ${tool} — ${String(d.error || 'unknown error').replace(/\s+/g, ' ').slice(0, 60)}`, failed: true, tool, ...sub })
      break
  }
  return ev
}

export function createJsConverter() {
  return { kind: 'js', convert: p => Promise.resolve(convertPayloadJs(p)), close() {}, alive: true }
}

// ---------------------------------------------------------------------------
// The watcher: files on disk -> sessions -> converter -> sink
// ---------------------------------------------------------------------------

function readFrom(file, offset, maxBytes = 8 * 1024 * 1024) {
  let fd
  try {
    fd = openSync(file, 'r')
    const size = statSync(file).size
    if (size <= offset) return { text: '', end: size }
    const len = Math.min(size - offset, maxBytes)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, offset)
    return { text: buf.toString('utf8'), end: offset + len }
  } catch { return { text: '', end: offset } } finally { if (fd !== undefined) try { closeSync(fd) } catch {} }
}

/** Complete JSONL lines from a chunk; the half-written tail stays for next time. */
export function splitLines(pending, chunk) {
  const text = pending + chunk
  const i = text.lastIndexOf('\n')
  if (i < 0) return { records: [], rest: text }
  const records = []
  for (const line of text.slice(0, i).split('\n')) {
    const l = line.trim()
    if (!l) continue
    try { records.push(JSON.parse(l)) } catch {}
  }
  return { records, rest: text.slice(i + 1) }
}

const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f-]{27,}|[A-Za-z0-9_-]{8,80})\.jsonl$/
const AGENT_FILE = /^agent-([A-Za-z0-9_-]{1,80})\.jsonl$/

export class TranscriptWatcher {
  /**
   * @param {object} opts
   * @param {ReturnType<typeof resolveTranscriptConfig>} opts.config
   * @param {{convert: (p: object) => Promise<object[]>}} opts.converter
   * @param {(events: object[], payload: object) => Promise<void>|void} opts.sink
   * @param {boolean} [opts.fromStart] read every existing file from its start (replay / tests)
   * @param {(payload: object) => void} [opts.onPayload] tap: every rebuilt hook payload (progression, debugging)
   */
  constructor({ config, converter, sink, fromStart = false, log = console, onPayload, now = () => Date.now() }) {
    this.config = config
    this.converter = converter
    this.sink = sink
    this.fromStart = fromStart
    this.log = log
    this.onPayload = onPayload
    this.now = now
    /** path -> { offset, rest, sessionId, agentId?, lastGrowth, kind } */
    this.files = new Map()
    /** sessionId -> TranscriptSession */
    this.sessions = new Map()
    this.queue = Promise.resolve()
    this.settingsCache = new Map()
    this.registry = new Map()
    this.firstScan = true
    this.timer = null
    this.stats = { payloads: 0, events: 0 }
  }

  start() {
    this.tick()
    this.timer = setInterval(() => this.tick(), this.config.pollMs)
    this.timer.unref?.()
    return this
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }

  /** Wait until everything read so far has reached the sink. */
  flush() { return this.queue }

  wanted(encodedDir, cwd) {
    if (!this.config.onlyListed) return true
    return labelFor(cwd, encodedDir, this.config.projects).project !== null
  }

  scan() {
    const root = this.config.dir
    let dirs = []
    try { dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) } catch { return [] }
    const found = []
    for (const enc of dirs) {
      // Cheap pre-filter on the dir name; the cwd check happens per record
      if (this.config.onlyListed && !this.config.projects.some(p => enc.toLowerCase().startsWith(p.encoded))) continue
      const pdir = join(root, enc)
      let entries = []
      try { entries = readdirSync(pdir, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        if (e.isFile() && SESSION_FILE.test(e.name)) found.push({ path: join(pdir, e.name), enc, sessionId: e.name.slice(0, -6), kind: 'main' })
        else if (e.isDirectory()) {
          const sdir = join(pdir, e.name, 'subagents')
          let subs = []
          try { subs = readdirSync(sdir) } catch { continue }
          for (const f of subs) {
            const m = AGENT_FILE.exec(f)
            if (m) found.push({ path: join(sdir, f), enc, sessionId: e.name, agentId: m[1], kind: 'agent' })
          }
        }
      }
    }
    return found
  }

  session(sessionId, enc, path) {
    let s = this.sessions.get(sessionId)
    if (!s) {
      s = new TranscriptSession({ sessionId, transcriptPath: path, encodedDir: enc, projects: this.config.projects })
      this.sessions.set(sessionId, s)
    }
    return s
  }

  readRegistry() {
    this.registry.clear()
    let names = []
    try { names = readdirSync(this.config.registryDir).filter(n => n.endsWith('.json')) } catch { return }
    for (const n of names) {
      try {
        const e = JSON.parse(readFileSync(join(this.config.registryDir, n), 'utf8'))
        if (e?.sessionId && typeof e.status === 'string') this.registry.set(e.sessionId, e.status)
      } catch {}
    }
  }

  settingsFor(cwd) {
    const key = cwd || ''
    const hit = this.settingsCache.get(key)
    if (hit && this.now() - hit.at < 30_000) return hit.value
    const value = readPermissionSettings(this.config.claudeDir, cwd)
    this.settingsCache.set(key, { at: this.now(), value })
    return value
  }

  tick() {
    const now = this.now()
    const found = this.scan()
    // Main files first, so an Agent call is known before its worker's first line
    found.sort((a, b) => (a.kind === 'main' ? 0 : 1) - (b.kind === 'main' ? 0 : 1))
    this.readRegistry()
    const batches = []
    for (const f of found) {
      let st
      try { st = statSync(f.path) } catch { continue }
      let entry = this.files.get(f.path)
      if (!entry) {
        const fresh = !this.firstScan
        const recent = now - st.mtimeMs <= this.config.activeWindowMs
        // New files are read whole; at start-up only recently active ones are
        // (to rebuild their current turn), unless replaying everything
        const offset = this.fromStart || fresh || recent ? 0 : st.size
        entry = { ...f, offset, rest: '', lastGrowth: fresh ? now : st.mtimeMs, wasOld: offset > 0, catchUp: !this.fromStart && !fresh && recent }
        this.files.set(f.path, entry)
      }
      if (st.size > entry.offset) {
        const { text, end } = readFrom(f.path, entry.offset)
        entry.offset = end
        const { records, rest } = splitLines(entry.rest, text)
        entry.rest = rest
        entry.lastGrowth = now
        if (records.length) batches.push({ entry, records })
      } else if (st.size < entry.offset) { entry.offset = 0; entry.rest = '' }
    }
    // Catch-up reads go whole (they rebuild a turn); everything else is
    // interleaved by timestamp across files, so a worker's first line lands
    // after the Agent call that launched it and before that call's result
    const live = []
    for (const b of batches) {
      if (b.entry.catchUp) { this.ingest(b.entry, b.records); b.entry.catchUp = false }
      else b.records.forEach((r, i) => live.push({ entry: b.entry, r, i, t: Date.parse(r?.timestamp) }))
    }
    live.sort((a, b) => (Number.isFinite(a.t) && Number.isFinite(b.t) ? a.t - b.t : 0) || (a.entry === b.entry ? a.i - b.i : 0))
    for (let i = 0; i < live.length;) {
      let j = i
      while (j < live.length && live[j].entry === live[i].entry) j++
      this.ingest(live[i].entry, live.slice(i, j).map(x => x.r))
      i = j
    }
    this.firstScan = false
    this.quiet(now)
  }

  ingest(entry, records) {
    const s = this.session(entry.sessionId, entry.enc, entry.kind === 'main' ? entry.path : join(dirname(dirname(dirname(entry.path))), `${entry.sessionId}.jsonl`))
    // Learn the cwd before deciding whether the session is wanted
    if (!s.cwd) { const c = records.find(r => typeof r?.cwd === 'string' && r.cwd); if (c) s.cwd = c.cwd }
    if (!this.wanted(entry.enc, s.cwd)) return
    const out = []
    if (entry.kind === 'main') {
      if (entry.catchUp) {
        // Start-up on a live session: replay only from its last real prompt
        let from = 0
        for (let i = records.length - 1; i >= 0; i--) {
          const r = records[i]
          if (r?.type === 'user' && !r.isMeta && !r.isSidechain && typeof textOf(r.message?.content) === 'string' && textOf(r.message?.content).trim() && !(Array.isArray(r.message?.content) && r.message.content.some(b => b?.type === 'tool_result'))) { from = i; break }
        }
        const head = records.slice(0, from)
        // Silently learn title / model / cwd from what came before
        s.mainRecords(head, [])
        s.pending.clear(); s.batches.clear(); s.turnOpen = false
        s.started = false
        s.mainRecords([...records.slice(from)], out)
        if (!s.started) out.push(s.startPayload('resume'))
        else if (out[0]?.hook_event_name === 'SessionStart') out[0].source = 'resume'
      } else {
        // A session that was quiet when the watcher started (or had ended) is resuming
        if ((!s.started && entry.wasOld) || s.ended) {
          const c = records.find(r => typeof r?.cwd === 'string' && r.cwd)
          if (c) s.cwd = c.cwd
          out.push(s.startPayload('resume'))
        }
        s.mainRecords(records, out)
      }
      // A session with no explicit title: its first prompt
      if (!s.title && s.firstPrompt && s.started) {
        s.title = s.firstPrompt
        out.push(s.startPayload('resume'))
      }
    } else {
      if (!s.started) out.push(s.startPayload('resume'))
      s.subagentRecords(entry.agentId, records, out, entry.path)
    }
    this.emit(s, out)
  }

  quiet(now) {
    for (const s of this.sessions.values()) {
      if (!s.started || s.ended) continue
      const files = [...this.files.values()].filter(f => f.sessionId === s.sessionId)
      const last = Math.max(...files.map(f => f.lastGrowth))
      const quietMs = now - last
      const status = this.registry.get(s.sessionId)
      const { allow, defaultMode } = this.settingsFor(s.cwd)
      const out = s.quietCheck(now, quietMs, {
        graceMs: this.config.permissionGraceMs, bashGraceMs: this.config.bashPermissionGraceMs, turnIdleMs: this.config.turnIdleMs,
        allow, defaultMode, registryWaiting: status === undefined ? undefined : status === 'waiting',
      })
      if (quietMs >= this.config.idleEndMs && this.config.idleEndMs > 0 && s.pending.size === 0 && status === undefined) {
        s.ended = true
        out.push(s.base({ hook_event_name: 'SessionEnd', reason: 'idle' }))
      }
      if (out.length) this.emit(s, out)
    }
  }

  emit(s, payloads) {
    for (const p of payloads) {
      this.stats.payloads++
      try { this.onPayload?.(p) } catch {}
      this.queue = this.queue.then(async () => {
        let events = []
        try { events = await this.converter.convert(p) } catch (err) { this.log.warn?.(`[transcripts] convert: ${err.message}`) }
        // The office shows the readable label (EA Dev · School Run), not the raw basename
        const { label } = labelFor(p.cwd ?? s.cwd, s.encodedDir, s.projects)
        for (const e of events) {
          if ('project' in e || e.sessionId) e.project = label
          delete e.answerable; delete e.nonce; delete e.claim
          e.via = 'transcript'
        }
        this.stats.events += events.length
        if (events.length) {
          try { await this.sink(events, p) } catch (err) { this.log.warn?.(`[transcripts] sink: ${err.message}`) }
        }
      })
    }
  }
}

/** Pick the best converter: the tracker through Python, else the built-in one. */
export function createConverter({ log = console, env = process.env, forceJs = false } = {}) {
  if (!forceJs && existsSync(BRIDGE_SCRIPT)) {
    const py = findPython(env)
    if (py) return createPythonConverter(py, { log })
    log.warn?.('[transcripts] no Python 3 found — using the built-in converter (no Bash signals). Set AGENT_OFFICE_PYTHON to fix.')
  }
  return createJsConverter()
}

export { basename }
