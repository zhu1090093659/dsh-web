/**
 * jyn (女仆鲸鱼娘) pet manifest + on-disk frames guard:
 * 78-frame (74 source + 4 RIFE bridge) seamless idle, shy/shy2/shy3
 * interactions, work/success/fail loop, and the sleep -> sleeping loop
 * (sleep intro is one-shot, falls back into the sleeping loop).
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePetManifest } from '../src/manifest-v2.ts'
import { petPackageRoot } from '../src/registry.ts'

const JYN_DIR = join(petPackageRoot(import.meta.url), 'assets', 'jyn')

describe('jyn pet manifest', () => {
  const parsed = JSON.parse(readFileSync(join(JYN_DIR, 'pet.json'), 'utf8'))
  const res = parsePetManifest(parsed, 'jyn-assets')

  it('parses clean (fail-closed' + ')', () => {
    expect(res.ok).toBe(true)
    if (res.ok) {
      const errors = res.diagnostics.filter(d => d.level === 'error')
      expect(errors).toEqual([])
    }
  })

  it('declares all tracks with 40ms default duration', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const frames2d = res.manifest.frames2d!
    expect(Object.keys(frames2d.tracks).sort()).toEqual(
      ['anyejinjin-angry', 'anyejinjin-idle', 'idle', 'lanhainishang-idle', 'lanhainishang-lift-skirt', 'shy', 'shy2', 'shy3', 'sleep', 'sleeping', 'work', 'work-fail', 'work-success'],
    )
    for (const t of ['shy', 'shy2', 'shy3']) {
      expect(frames2d.tracks[t].loop).toBe(false)
      expect(frames2d.tracks[t].fallback).toBe('idle')
    }
    for (const t of ['work-success', 'work-fail']) {
      expect(frames2d.tracks[t].loop).toBe(false)
      expect(frames2d.tracks[t].fallback).toBe('work')
    }
    expect(frames2d.tracks.work.loop ?? true).toBe(true)
    // sleep intro is one-shot and settles into the sleeping loop.
    expect(frames2d.tracks.sleep.loop).toBe(false)
    expect(frames2d.tracks.sleep.fallback).toBe('sleeping')
    expect(frames2d.tracks.sleeping.loop ?? true).toBe(true)
    expect(frames2d.defaultFrameMs).toBe(40)
    expect(frames2d.phases.idle).toBe('idle')
  })

  it('declares the anyejinjin skin with a looping idleTrack', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const skins = res.manifest.frames2d?.skins
    expect(skins).toBeDefined()
    const skin = skins?.find(s => s.id === 'anyejinjin')
    expect(skin).toBeDefined()
    expect(skin?.label).toBe('暗夜鎏金')
    expect(skin?.idleTrack).toBe('anyejinjin-idle')
    const idleTrack = res.manifest.frames2d?.tracks[skin!.idleTrack]
    expect(idleTrack).toBeDefined()
    expect(idleTrack?.loop ?? true).toBe(true)
  })

  it('anyejinjin skin declares the angry click action at 30%', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const skins = res.manifest.frames2d?.skins
    const skin = skins?.find(s => s.id === 'anyejinjin')
    expect(skin?.clickActions).toBeDefined()
    const action = skin?.clickActions?.find(a => a.track === 'anyejinjin-angry')
    expect(action).toBeDefined()
    expect(action?.probability).toBeCloseTo(0.3, 6)
    const track = res.manifest.frames2d?.tracks[action!.track]
    expect(track).toBeDefined()
    expect(track?.loop).toBe(false)
    expect(track?.fallback).toBe('idle')
  })

  it('declares the lanhainishang skin with a looping idleTrack', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const skins = res.manifest.frames2d?.skins
    expect(skins).toBeDefined()
    const skin = skins?.find(s => s.id === 'lanhainishang')
    expect(skin).toBeDefined()
    expect(skin?.label).toBe('蓝海霓裳')
    expect(skin?.idleTrack).toBe('lanhainishang-idle')
    const idleTrack = res.manifest.frames2d?.tracks[skin!.idleTrack]
    expect(idleTrack).toBeDefined()
    expect(idleTrack?.loop ?? true).toBe(true)
  })

  it('lanhainishang skin declares the lift-skirt click action at 30%', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const skins = res.manifest.frames2d?.skins
    const skin = skins?.find(s => s.id === 'lanhainishang')
    expect(skin?.clickActions).toBeDefined()
    const action = skin?.clickActions?.find(a => a.track === 'lanhainishang-lift-skirt')
    expect(action).toBeDefined()
    expect(action?.probability).toBeCloseTo(0.3, 6)
    // The action track is one-shot and settles back to the idle base.
    const track = res.manifest.frames2d?.tracks[action!.track]
    expect(track).toBeDefined()
    expect(track?.loop).toBe(false)
    expect(track?.fallback).toBe('idle')
    // Skins only inherit actions declared on themselves: lanhainishang
    // never carries the anyejinjin angry action.
    const angry = skin?.clickActions?.find(a => a.track === 'anyejinjin-angry')
    expect(angry).toBeUndefined()
  })

  it('work gameplay block: 50%, success anim once then back to work', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const work = res.manifest.gameplay?.work
    expect(work).toBeDefined()
    expect(work!.state).toBe('work')
    expect(work!.successState).toBe('work-success')
    expect(work!.failState).toBe('work-fail')
    expect(work!.successProbability).toBeCloseTo(0.5, 6)
    expect(work!.tickMs).toBe(10000)
    const successEffects = work!.success?.effects ?? []
    expect(successEffects.some(e => e.currency === 'treats' && e.amount === 1)).toBe(true)
  })

  it('sleep gameplay block: sleep intro holds the sleep track, restores energy', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const sleep = res.manifest.gameplay?.sleep
    expect(sleep).toBeDefined()
    expect(sleep!.state).toBe('sleep')
    expect(sleep!.restore.stat).toBe('energy')
    expect(sleep!.restore.amount).toBe(4)
    expect(sleep!.restore.intervalMs).toBe(30000)
  })

  it('head-touch triggers shy at 30% (click-only)', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const zones = res.manifest.gameplay?.touch?.zones ?? []
    const head = zones.find(z => z.name === 'head')
    expect(head).toBeDefined()
    expect(head?.y1).toBeCloseTo(1 / 3, 2)
    const shyBranch = head?.branches.find(b => b.state === 'shy')
    expect(shyBranch?.probability).toBeCloseTo(0.3, 6)
    expect(shyBranch?.stateMs).toBeGreaterThan(0)
    const acts = res.manifest.gameplay?.idleDirector?.acts ?? []
    expect(acts.some(a => ['shy', 'shy2', 'shy3'].includes(a.track))).toBe(false)
  })

  it('body-touch triggers shy2 at 30% (click-only)', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const zones = res.manifest.gameplay?.touch?.zones ?? []
    const body = zones.find(z => z.name === 'body')
    expect(body).toBeDefined()
    expect(body!.y1 - body!.y0).toBeCloseTo(1 / 3, 2)
    const shy2Branch = body?.branches.find(b => b.state === 'shy2')
    expect(shy2Branch?.probability).toBeCloseTo(0.3, 6)
    expect(shy2Branch?.stateMs).toBeGreaterThan(0)
  })

  it('legs-touch triggers shy3 at 30% (click-only)', () => {
    if (!res.ok) throw new Error('manifest rejected')
    const zones = res.manifest.gameplay?.touch?.zones ?? []
    const legs = zones.find(z => z.name === 'legs')
    expect(legs).toBeDefined()
    expect(legs!.y1 - legs!.y0).toBeCloseTo(1 / 3, 2)
    const shy3Branch = legs?.branches.find(b => b.state === 'shy3')
    expect(shy3Branch?.probability).toBeCloseTo(0.3, 6)
    expect(shy3Branch?.stateMs).toBeGreaterThan(0)
  })

  it('keeps on-disk frame counts stable', () => {
    const counts: Record<string, number> = {
      idle: 78, shy: 73, shy2: 73, shy3: 73,
      work: 70, 'work-success': 70, 'work-fail': 70,
      sleep: 51, sleeping: 77,
      'anyejinjin-idle': 77, 'anyejinjin-angry': 70,
      'lanhainishang-idle': 77, 'lanhainishang-lift-skirt': 73,
    }
    for (const [track, expected] of Object.entries(counts)) {
      const files = readdirSync(join(JYN_DIR, 'thumb', track)).filter(f => f.endsWith('.webp'))
      expect(files.length, `${track} webp frame count`).toBe(expected)
    }
  })
})