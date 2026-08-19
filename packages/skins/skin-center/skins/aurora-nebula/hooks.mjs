/**
 * Aurora Nebula (aurora-nebula) — v2 SkinHooks.
 * The scene is mounted into the skin-center-owned background decoration layer;
 * the loader owns html[data-dsh-skin="aurora-nebula"] scoping.
 */
const SCENE_HTML = '<div class="dsh-bg-orb dsh-bg-orb-1"></div><div class="dsh-bg-orb dsh-bg-orb-2"></div><div class="dsh-bg-orb dsh-bg-orb-3"></div><div class="dsh-bg-orb dsh-bg-orb-4"></div><div class="dsh-bg-grid"></div><div class="dsh-bg-stars" data-dsh-skin-stars></div><div class="dsh-bg-ring"></div><div class="dsh-bg-hud"><i class="dsh-hud-tl"></i><i class="dsh-hud-tr"></i><i class="dsh-hud-bl"></i><i class="dsh-hud-br"></i></div><div class="dsh-bg-line"></div><div class="dsh-bg-scanlines"></div>'
const STAR_COUNT = 64
const STAR_SEED = 7

function starsFor(dark) {
  const palette = dark ? '200, 226, 255' : '37, 74, 140'
  const layers = []
  let seed = STAR_SEED
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const x = (random() * 96 + 2).toFixed(2)
    const y = (random() * 92 + 4).toFixed(2)
    const size = random() > 0.72 ? 2 : 1
    const alpha = (random() * 0.4 + 0.6).toFixed(2)
    layers.push(`radial-gradient(circle ${size}px at ${x}% ${y}%, rgba(${palette}, ${alpha}), rgba(${palette}, 0) 100%)`)
  }
  return layers.join(',')
}

export default function defineSkinHooks() {
  return {
    apply(ctx) {
      const layer = ctx.layers.background
      layer.innerHTML = SCENE_HTML
      const stars = layer.querySelector('[data-dsh-skin-stars]')
      const update = (theme) => {
        if (stars) stars.style.backgroundImage = starsFor(theme === 'dark')
      }
      update(ctx.theme.get())
      const unsubscribe = ctx.theme.subscribe(update)
      ctx.onCleanup(() => {
        unsubscribe()
        layer.replaceChildren()
      })
    },
  }
}
