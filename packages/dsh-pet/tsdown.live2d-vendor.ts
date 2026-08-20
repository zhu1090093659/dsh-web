/**
 * Live2D vendor bundle config (pet-center M3) — the pixi.js + Cubism engine
 * stack ships as ONE self-contained IIFE (lib/live2d-vendor.js) exposed as
 * 'window.__dshPetLive2d'. It rides the companions slot of both tsdown
 * configs so git installs (prepare) and dev builds emit the identical
 * artifact. The main client bundle stays untouched: sprite2d-only
 * installations never download or parse this stack.
 */
import type { UserConfig } from 'tsdown'

export function live2dVendorBundle(): UserConfig {
  return {
    name: '@linxin666/dsh-pet/live2d-vendor',
    entry: { 'live2d-vendor': 'src/client/renderers/live2d/vendor-entry.ts' },
    outDir: 'lib',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    // Third-party stable code: minify to keep the published tarball lean
    // (unlike first-party bundles, vendor internals have no profiling value).
    minify: true,
    clean: false,
    // Self-contained: the vendor file loads as a plain script tag with no
    // module table, so every dependency inlines (both are MIT).
    external: [],
    noExternal: [/.*/],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      name: 'dsh-pixi-sound-absent',
      resolveId(source: string): string | null {
        return source === '@pixi/sound' ? '\0dsh-pixi-sound-absent' : null
      },
      load(id: string): string | null {
        if (id !== '\0dsh-pixi-sound-absent') return null
        // The engine dynamic-imports @pixi/sound for motion sounds / lip sync
        // only. An import-time throw surfaces as a rejected promise on the
        // engine's documented 'not available' path (it catches and degrades).
        return 'throw new Error("@pixi/sound is not bundled: motion sounds and lip sync land post-M3 (pet-center M3)")'
      },
    }],
    outputOptions: {
      entryFileNames: 'live2d-vendor.js',
      // Classic-script top-level var: becomes window.__dshPetLive2d.
      name: '__dshPetLive2d',
    },
  }
}
