/**
 * providers.ts — whose session a character is.
 *
 * The office started as Claude Code's. The watcher's other tools (server/
 * provider-sources.js) send their sessions with the tool's name as the id's
 * prefix (`codex-<id>`, `grok-<id>`), so everything here can tell a session's
 * provider from its id alone: the character's name, its tint, the pill's chip.
 * Claude Code's ids carry no prefix.
 */

export type ProviderId = 'claude' | 'codex' | 'grok'

export interface ProviderInfo {
  id: ProviderId
  /** The character's name, and the chip on its pill */
  name: string
  /** The tool, for the task line ("Codex · EA Dev") */
  app: string
  color: string
  emoji: string
  /** A CSS filter over Claude's sprite, until the provider has art of its own ('' = none) */
  tint: string
}

export const PROVIDER_INFO: Record<ProviderId, ProviderInfo> = {
  claude: { id: 'claude', name: 'Claude', app: 'Claude Code', color: '#cc785c', emoji: '🤖', tint: '' },
  codex: { id: 'codex', name: 'Codex', app: 'Codex', color: '#19c39b', emoji: '🌀', tint: 'hue-rotate(128deg) saturate(0.85)' },
  grok: { id: 'grok', name: 'Grok', app: 'Grok', color: '#b9c2d0', emoji: '🌌', tint: 'grayscale(1) contrast(1.15) brightness(0.92)' },
}

/** The provider of a session: the server's `provider` when it sent one, else the id's prefix; Claude otherwise. */
export function providerOf(sessionId?: string | null, provider?: string | null): ProviderId {
  if (provider === 'codex' || provider === 'grok') return provider
  const id = String(sessionId ?? '').replace(/^main-/, '')
  if (id.startsWith('codex-')) return 'codex'
  if (id.startsWith('grok-')) return 'grok'
  return 'claude'
}

export function providerInfo(sessionId?: string | null, provider?: string | null): ProviderInfo {
  return PROVIDER_INFO[providerOf(sessionId, provider)]
}
