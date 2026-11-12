#!/usr/bin/env node
/**
 * Write src/seasonManifest.ts from the seasonal copies that exist in public/.
 * The page uses this list so it never requests a -autumn/-xmas/... file that
 * is not there (those used to 404 on every load).
 *
 *   node scripts/season-manifest.mjs
 */
import { readdirSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '..')
const pub = join(root, 'public')
const SUFFIX = /(?:-xmas|-halloween|-easter|-valentine|-spring|-summer|-autumn|-winter)(?:-walk\d+)?\.webp$/

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && SUFFIX.test(e.name)) out.push('/' + relative(pub, p).replaceAll('\\', '/'))
  }
  return out
}

export function listSeasonFiles(dir = pub) {
  return walk(dir).sort()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = listSeasonFiles()
  const lines = files.map(u => `  '${u}',`).join('\n')
  const body = `/**
 * Seasonal copies that exist in public/. Generated; do not edit by hand.
 *
 *   node scripts/season-manifest.mjs
 *
 * The page looks a URL up here instead of probing it, so a missing
 * -autumn.webp (or -xmas, -winter, ...) is not requested and does not 404.
 */
export const SEASON_FILES: ReadonlySet<string> = new Set([
${lines}
])
`
  writeFileSync(join(root, 'src', 'seasonManifest.ts'), body)
  console.log(`season-manifest: ${files.length} files -> src/seasonManifest.ts`)
}
