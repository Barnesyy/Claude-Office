#!/usr/bin/env node
/**
 * spawn-hidden.mjs — start one process with no console window, detached from
 * whoever ran this (closing a terminal does not stop it), at BelowNormal
 * priority, stdout/stderr appended to log files. Prints {"pid": N} and exits.
 *
 *   node spawn-hidden.mjs <out.log> <err.log> <command> [args...]
 *
 * Why node and not Start-Process: Start-Process with redirected output
 * shares the caller's console, so the child dies with that terminal;
 * detached + windowsHide gives the child its own hidden console.
 */
import { spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import { constants, setPriority } from 'node:os'

const [out, err, cmd, ...args] = process.argv.slice(2)
if (!out || !err || !cmd) {
  console.error('usage: spawn-hidden.mjs <out.log> <err.log> <command> [args...]')
  process.exit(2)
}
const child = spawn(cmd, args, {
  detached: true,
  windowsHide: true,
  stdio: ['ignore', openSync(out, 'a'), openSync(err, 'a')],
  env: process.env,
})
child.on('error', e => { console.error(String(e?.message ?? e)); process.exit(1) })
child.on('spawn', () => {
  try { setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL) } catch {}
  process.stdout.write(JSON.stringify({ pid: child.pid }) + '\n')
  child.unref()
  process.exit(0)
})
