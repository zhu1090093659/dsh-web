/**
 * Live2D vendor bundle entry (pet-center M3) — builds pixi.js plus the
 * untitled-pixi-live2d-engine Cubism stack into lib/live2d-vendor.js, an IIFE
 * exposing 'window.__dshPetLive2d'. The sprite-only client bundle never pays
 * for this stack: the live2d renderer lazy-loads the vendor file through the
 * plugin's own runtime route, after the user-supplied Cubism Core script
 * ('window.Live2DCubismCore') is already present.
 *
 * Redistribution: pixi.js and untitled-pixi-live2d-engine are MIT-licensed
 * and may ship inside this plugin; the proprietary Cubism Core is NEVER
 * bundled (issue #623, milestone M1 §0).
 */
export { Application, Point, extensions } from 'pixi.js'
export { configureCubismSDK, Live2DModel, Live2DPlugin } from 'untitled-pixi-live2d-engine/cubism'
