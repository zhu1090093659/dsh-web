/**
 * Aurora Nebula skin — 极光星舰 (aurora-nebula)
 *
 * 热插拔 client 插件(与官方皮肤同范式): apply() 设置 body[data-dsh-aurora-nebula](CSS 作用域),
 * 注入背景场景层(.dsh-bg: 光球×4 / 透视网格 / 确定性星点 / 同心雷达环 / HUD 角标 /
 * 顶部能量线 / 扫描线), MutationObserver
 * 跟随 data-ds-dark-theme 实时切换深/浅底色与星点配色; ctx.effect 的 disposer
 * 完全还原(删除 body 属性、移除场景层、恢复 background-color)。
 * 场景裸类(.dsh-*)在 <id>.module.css 中以 :global() 声明, 与 apply() 注入的 DOM 匹配。
 * 不注入任何服务: 皮肤只需要 DOM。
 */
import type { Context } from '@deepseek-ai/cordis'
import './aurora-nebula.module.css'

/** 背景场景层 HTML(apply() 注入到 body)。 */
const SCENE_HTML = `<div class="dsh-bg-orb dsh-bg-orb-1"></div><div class="dsh-bg-orb dsh-bg-orb-2"></div><div class="dsh-bg-orb dsh-bg-orb-3"></div><div class="dsh-bg-orb dsh-bg-orb-4"></div><div class="dsh-bg-grid"></div><div class="dsh-bg-stars" id="dsh-bg-stars"></div><div class="dsh-bg-ring"></div><div class="dsh-bg-hud"><i class="dsh-hud-tl"></i><i class="dsh-hud-tr"></i><i class="dsh-hud-bl"></i><i class="dsh-hud-br"></i></div><div class="dsh-bg-line"></div><div class="dsh-bg-scanlines"></div>`
/** 深/浅模式底色(#dsh-bg 场景层之下, 光球未覆盖处露出)。 */
const BASE_DARK = '#04060c'
const BASE_LIGHT = '#eef2fb'
/** 星点配色(深/浅), 确定性伪随机布局, 刷新不跳动。 */
const STAR_DARK = '200, 226, 255'
const STAR_LIGHT = '37, 74, 140'
const STAR_COUNT = 64
const STAR_SEED = 7

function isDark(): boolean {
  return typeof document !== 'undefined' && document.body !== null && document.body.hasAttribute('data-ds-dark-theme')
}

function starsFor(dark: boolean): string {
  const pal = dark ? STAR_DARK : STAR_LIGHT
  const layers: string[] = []
  let seed = STAR_SEED
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = (rnd() * 96 + 2).toFixed(2)
    const y = (rnd() * 92 + 4).toFixed(2)
    const s = rnd() > 0.72 ? 2 : 1
    const a = (rnd() * 0.4 + 0.6).toFixed(2)
    layers.push(`radial-gradient(circle ${s}px at ${x}% ${y}%, rgba(${pal}, ${a}), rgba(${pal}, 0) 100%)`)
  }
  return layers.join(',')
}

/** 挂载 skin: body 属性 + 场景层 + 底色, 全部由 disposer 还原。 */
export function apply(ctx: Context): void {
  const body = document.body
  const previous = new Map<string, string>()
  previous.set('background-color', body.style.getPropertyValue('background-color'))

  body.dataset.dshAuroraNebula = ''
  const update = () => {
    body.style.setProperty('background-color', isDark() ? BASE_DARK : BASE_LIGHT)
    const stars = document.getElementById('dsh-bg-stars')
    if (stars) stars.style.backgroundImage = starsFor(isDark())
  }
  const stale = document.getElementById('dsh-bg')
  if (stale) stale.remove()
  const bg = document.createElement('div')
  bg.id = 'dsh-bg'
  bg.className = 'dsh-bg'
  bg.setAttribute('aria-hidden', 'true')
  bg.innerHTML = SCENE_HTML
  body.appendChild(bg)
  update()

  const observer = new MutationObserver(update)
  observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })

  ctx.effect(() => () => {
    delete body.dataset.dshAuroraNebula
    observer.disconnect()
    const scene = document.getElementById('dsh-bg')
    if (scene) scene.remove()
    for (const [prop, value] of previous) body.style.setProperty(prop, value)
  }, 'ui-skin-aurora-nebula: scene')
}
