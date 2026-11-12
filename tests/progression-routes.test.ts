/**
 * progression-routes.test.ts - progression in a whole office
 * (server/progression-routes.js mounted by server/index.js): events posted
 * to /event earn XP through the event tap, the watcher's facts need the
 * office token, and on/off and reset need the UI.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { loadOffice, postAuthed, postEvent, removeOffice, type Office } from './helpers'

const tick = () => new Promise(r => setTimeout(r, 20))

describe('progression in the office', () => {
  let office: Office
  beforeAll(async () => { office = await loadOffice() })
  afterAll(() => removeOffice(office))
  const get = async (path = '/progression') => (await request(office.server.app).get(path)).body

  it('GET /progression is a fresh office: level 1, the cabinet open', async () => {
    const s = await get()
    expect(s).toMatchObject({ enabled: true, xp: 0, level: 1 })
    expect(s.unlocks.find((u: any) => u.id === 'trophy-cabinet').unlocked).toBe(true)
  })

  it('a green test signal on /event earns XP through the tap; a failed one earns none', async () => {
    await postEvent(office.server, { type: 'session_started', sessionId: 'prog-1', project: 'demo', cwd: '/tmp/demo' })
    await postEvent(office.server, { type: 'signal', sessionId: 'prog-1', signals: [{ kind: 'test_failed' }] })
    await tick()
    expect((await get()).xp).toBe(0)
    await postEvent(office.server, { type: 'signal', sessionId: 'prog-1', signals: [{ kind: 'test_ok' }] })
    await tick()
    const s = await get()
    expect(s.counts).toMatchObject({ test_ok: 1, test_fail: 1 })
    expect(s.xp).toBe(12)
  })

  it('POST /progression/facts needs the office token, takes known kinds only, at most 50', async () => {
    const fact = { kind: 'pr_merge', id: 'r1:pr_merge', pr: 9, repo: 'a/b', sessionId: 'prog-1' }
    expect((await request(office.server.app).post('/progression/facts').send({ facts: [fact] })).status).toBe(401)
    expect((await postAuthed(office.server, '/progression/facts', { facts: [fact] }, 'nope')).status).toBe(401)
    const ok = await postAuthed(office.server, '/progression/facts', { facts: [fact, { kind: 'free_xp' }] })
    expect(ok.body).toEqual({ ok: true, accepted: 1 })
    expect((await get()).shipped).toBe(1)
    expect((await postAuthed(office.server, '/progression/facts', { facts: Array(51).fill(fact) })).status).toBe(413)
    expect((await postAuthed(office.server, '/progression/facts', { facts: 'x' })).status).toBe(400)
  })

  it('day and quarter reads, and bad dates', async () => {
    const d = await get('/progression/day')
    expect(d).toMatchObject({ today: true })
    expect(d.kinds.pr_merge.count).toBe(1)
    expect(d.recap).toBeTruthy()
    expect((await request(office.server.app).get('/progression/day?date=nope')).status).toBe(400)
    expect((await get('/progression/quarter')).xp).toBeGreaterThan(0)
    expect((await request(office.server.app).get('/progression/quarter?q=2026-Q9')).status).toBe(400)
  })

  it('on/off and reset need a token; reset needs the confirm word', async () => {
    expect((await request(office.server.app).post('/progression/settings').send({ enabled: false })).status).toBe(401)
    expect((await request(office.server.app).post('/progression/settings').set('Authorization', `Bearer ${office.server.UI_TOKEN}`).send({ enabled: false })).status).toBe(200)
    await postAuthed(office.server, '/progression/facts', { facts: [{ kind: 'commit', id: 'off:commit' }] })
    expect((await get()).counts.commit).toBe(0)
    expect((await postAuthed(office.server, '/progression/settings', { enabled: true })).body).toEqual({ ok: true, enabled: true })
    expect((await postAuthed(office.server, '/progression/reset', {})).status).toBe(400)
    expect((await request(office.server.app).post('/progression/reset').send({ confirm: 'reset' })).status).toBe(401)
    expect((await postAuthed(office.server, '/progression/reset', { confirm: 'reset' })).body).toEqual({ ok: true })
    expect(await get()).toMatchObject({ xp: 0, shipped: 0 })
  })

  it('POST /progression/equity without reports configured reads nothing', async () => {
    expect((await postAuthed(office.server, '/progression/equity', {})).body).toEqual({ ok: true, configured: false, result: null })
  })
})
