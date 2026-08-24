/**
 * Source-level guards for the WE scene player runtime (src/we-player-source.ts).
 * The player is a self-contained HTML string, so these tests pin the
 * reflection contract that pkg-extract's manifest feeds: the water line and
 * the reflection quad must follow scene data, not hard-coded constants (#742).
 * @module @linxin666/dsh-client-ui-skin-center/tests/we-player
 */

import { describe, expect, it } from 'vitest'

import { WE_SCENE_PLAYER_HTML } from '../src/we-player-source.ts'

describe('WE scene player reflection pass (#742)', () => {
  it('drives the water line and sample window from uniforms, not constants', () => {
    expect(WE_SCENE_PLAYER_HTML).toContain('uniform float u_waterLine;')
    expect(WE_SCENE_PLAYER_HTML).toContain('uniform vec2 u_reflectRange;')
    expect(WE_SCENE_PLAYER_HTML).toContain('uniform vec4 u_rect;')
    expect(WE_SCENE_PLAYER_HTML).not.toContain('v_uv.y < 0.65')
    expect(WE_SCENE_PLAYER_HTML).not.toContain('0.42 + puddleDepth * 0.38')
  })

  it('recovers explicitly after theme changes and reloads after context restoration', () => {
    expect(WE_SCENE_PLAYER_HTML).toContain("canvas.addEventListener('webglcontextlost'")
    expect(WE_SCENE_PLAYER_HTML).toContain("canvas.addEventListener('webglcontextrestored'")
    expect(WE_SCENE_PLAYER_HTML).toContain("msg.type === 'dsh-recover-renderer'")
    expect(WE_SCENE_PLAYER_HTML).toContain("type: 'dsh-scene-needs-reload'")
  })

  it('uses the 3D-only renderer only when the scene contains actual models', () => {
    expect(WE_SCENE_PLAYER_HTML).toContain('sceneData.is3D && sceneData.models && sceneData.models.length > 0')
    expect(WE_SCENE_PLAYER_HTML).toContain('sceneData.models && sceneData.models.length > 0 && (sprites3d.length > 0 || systems3d.length > 0)')
    expect(WE_SCENE_PLAYER_HTML).not.toContain('if (sceneData.is3D) {')
  })

  it('repeats model base textures when the manifest marks tiled UVs', () => {
    expect(WE_SCENE_PLAYER_HTML).toContain('Boolean(mesh.repeatBase || flags.aurora || flags.bg)')
  })

  it('uses authored point lights and baked lightmaps for generic 3D scenes', () => {
    expect(WE_SCENE_PLAYER_HTML).toContain('u_lightPos[4]')
    expect(WE_SCENE_PLAYER_HTML).toContain('u_lightColorRadius[4]')
    expect(WE_SCENE_PLAYER_HTML).toContain('texture2D(u_lightmap, v_uv2).rgb')
    expect(WE_SCENE_PLAYER_HTML).toContain('sceneData.ambientColor || [0, 0, 0]')
    expect(WE_SCENE_PLAYER_HTML).not.toContain('Math.max(amb[0], 0.3)')
  })

  it('uses Wallpaper Engine 50-degree projection defaults for 3D scenes', () => {
    expect(WE_SCENE_PLAYER_HTML).toContain('fov: 50')
    expect(WE_SCENE_PLAYER_HTML).toContain('(cam.fov || 50) * Math.PI / 180')
    expect(WE_SCENE_PLAYER_HTML).not.toContain('(cam.fov || 45) * Math.PI / 180')
  })

  it('preserves Wallpaper Engine painter order for image and effect layers', () => {
    expect(WE_SCENE_PLAYER_HTML).toContain('const renderLayers = sceneData.layers.filter((layer) => layerEnabledByTime(layer, currentPeriod));')
    expect(WE_SCENE_PLAYER_HTML).toContain('for (const layer of renderLayers)')
    expect(WE_SCENE_PLAYER_HTML).not.toContain('sceneData.layers.slice().reverse()')
  })

  it('selects and plays time-period video layers from the browser local clock', () => {
    expect(WE_SCENE_PLAYER_HTML).toContain('function activeTimePeriod(schedule, date)')
    expect(WE_SCENE_PLAYER_HTML).toContain('date.getHours() + date.getMinutes() / 60')
    expect(WE_SCENE_PLAYER_HTML).toContain('const currentPeriod = activeTimePeriod(sceneData.timeSchedule, new Date());')
    expect(WE_SCENE_PLAYER_HTML).toContain('sceneData.layers.filter((layer) => layerEnabledByTime(layer, currentPeriod))')
    expect(WE_SCENE_PLAYER_HTML).toContain("document.createElement('video')")
    expect(WE_SCENE_PLAYER_HTML).toContain('record.video.pause();')
  })

  it('loads video textures in CORS mode for the sandboxed opaque-origin player', () => {
    // The player iframe is sandboxed without allow-same-origin: a video
    // element without crossOrigin taints the WebGL texture, texImage2D throws
    // a SecurityError, and video-layer scenes (e.g. time-varying ones) render
    // as a blank canvas over the shell.
    expect(WE_SCENE_PLAYER_HTML).toContain("video.crossOrigin = 'anonymous';")
  })

  it('sizes the canvas backing store in device pixels for HiDPI displays', () => {
    // A CSS-pixel canvas is upscaled by the compositor on scaled displays,
    // which presents the live wallpaper at an abnormally low resolution.
    expect(WE_SCENE_PLAYER_HTML).toContain('window.devicePixelRatio || 1')
    expect(WE_SCENE_PLAYER_HTML).toContain('Math.round(window.innerWidth * dpr)')
    expect(WE_SCENE_PLAYER_HTML).not.toContain('canvas.width = window.innerWidth')
  })

  it('draws the reflection quad at the layer rect instead of forcing fullscreen', () => {
    expect(WE_SCENE_PLAYER_HTML).not.toContain('mat4Transform2D(sceneW / 2, sceneH / 2, sceneW, sceneH, 0)')
    expect(WE_SCENE_PLAYER_HTML).toContain("gl.getUniformLocation(progReflection, 'u_waterLine')")
    // Legacy manifests without a water line keep the historical default.
    expect(WE_SCENE_PLAYER_HTML).toContain("typeof layer.waterLine === 'number' ? layer.waterLine : 0.65")
  })

  it('talks to the embedding parent by sender identity and wildcard targets (sandboxed opaque origin)', () => {
    // The player frame is sandboxed without allow-same-origin, so it cannot
    // know the embedding page's origin: sends use '*' and the receive side
    // validates event.source instead of comparing origins.
    expect(WE_SCENE_PLAYER_HTML).toContain("window.parent.postMessage({ type: 'dsh-scene-needs-reload' }, '*')")
    expect(WE_SCENE_PLAYER_HTML).toContain('if (ev.source !== window.parent) return;')
    expect(WE_SCENE_PLAYER_HTML).not.toContain('ev.origin !== window.location.origin')
  })
})
