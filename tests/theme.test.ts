/**
 * src/theme.ts — the Trading Floor cast survives a reload and a theme toggle (audit
 * C47): only the theme name used to be persisted, and setTheme wiped the cast.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeStorage {
  private map = new Map<string, string>()
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null }
  setItem(k: string, v: string) { this.map.set(k, String(v)) }
  removeItem(k: string) { this.map.delete(k) }
  clear() { this.map.clear() }
}

describe('theme.ts cast persistence (C47)', () => {
  beforeEach(() => {
    ;(globalThis as any).localStorage = new FakeStorage()
    vi.resetModules()
  })
  afterEach(() => {
    delete (globalThis as any).localStorage
  })

  it('keeps every role\'s character across /trading-floor off -> on and across a reload', async () => {
    const t1 = await import('../src/theme')
    t1.setTheme('office')
    const debugger1 = t1.getCharacterBaseForRole('debugger', 'dev-1')
    const reviewer1 = t1.getCharacterBaseForRole('code-reviewer', 'employee-1')
    const name1 = t1.themedDisplayName('debugger', 'Debugger')
    // Why: the Trading Floor deals names, not art; the sprite stays upstream's MIT one
    expect(debugger1).toBe('dev-1')
    expect(name1).not.toBe('Debugger')
    const cast1 = t1.castForRole('debugger')

    // Toggle off and on: same cast
    t1.toggleTheme()
    expect(t1.getTheme()).toBe('default')
    t1.toggleTheme()
    expect(t1.getCharacterBaseForRole('debugger', 'dev-1')).toBe(debugger1)
    expect(t1.getCharacterBaseForRole('code-reviewer', 'employee-1')).toBe(reviewer1)
    expect(t1.themedDisplayName('debugger', 'Debugger')).toBe(name1)
    expect(t1.castForRole('debugger')).toBe(cast1)

    // Reload (fresh module, same localStorage): same cast
    vi.resetModules()
    const t2 = await import('../src/theme')
    expect(t2.getTheme()).toBe('office')
    expect(t2.getCharacterBaseForRole('debugger', 'dev-1')).toBe(debugger1)
    expect(t2.getCharacterBaseForRole('code-reviewer', 'employee-1')).toBe(reviewer1)
    expect(t2.castForRole('debugger')).toBe(cast1)
    expect(t2.themedDisplayName('debugger', 'Debugger')).toBe(name1)
  })

  it('releasing a role frees its character for the next agent, and the release is persisted too', async () => {
    const t1 = await import('../src/theme')
    t1.setTheme('office')
    t1.assignCharacterToRole('dm-slot-3', 'rory-risk')
    expect(t1.getActiveCastSlugs().has('rory-risk')).toBe(true)
    t1.releaseRole('dm-slot-3')
    expect(t1.getActiveCastSlugs().has('rory-risk')).toBe(false)

    vi.resetModules()
    const t2 = await import('../src/theme')
    expect(t2.getActiveCastSlugs().has('rory-risk')).toBe(false)
  })

  it('ignores a corrupt or foreign saved cast', async () => {
    ;(globalThis as any).localStorage.setItem('agent-office-theme', 'office')
    ;(globalThis as any).localStorage.setItem('agent-office-cast', '{"castByRole":{"boss":"not-a-character","assistant":"jim-halpert","debugger":"quinn-quant"}}')
    const t = await import('../src/theme')
    expect(t.castForRole('debugger')).toBe('quinn-quant')
    expect(t.castForRole('assistant')).toBe('claude-analyst') // an old-skin slug is dropped and re-dealt
    expect(t.castForRole('boss')).toBe('desk-head') // fixed casting, the bad slug was dropped
    expect(t.getCharacterBaseForRole('boss', 'Me-1')).toBe('Me-1')
  })

  it('the Trading Floor never asks for removed fan-art paths', async () => {
    const t = await import('../src/theme')
    t.setTheme('office')
    expect(t.getSpriteDir()).toBe('/sprites/characters')
    expect(t.getRoomImage('day')).not.toMatch(/-dm/)
    expect(t.getRoomImage('night')).not.toMatch(/-dm/)
    expect(t.getSpritePath('a1', 'debugger', 'dev-1', 'front-left')).toMatch(/^\/sprites\/characters\/dev-1-front-left/)
    for (const p of t.OFFICE_PROP_PATHS) expect(p).toMatch(/^\/sprites\/trading\/props\//)
    expect(t.getOfficePropForRole('debugger')).toMatch(/^\/sprites\/trading\/props\//)
  })
})
