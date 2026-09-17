/**
 * hooks.mjs — 「万象镜」的取景器。
 *
 * 这套皮肤自己不会画画：它的地面是一张**每次都不一样的随机二次元立绘**，来自
 * https://api.elaina.cat/random/ （实测：200 image/jpeg、约 0.4 MB、多为 16:9、
 * 2000–4000px 宽、无重定向、无 Cache-Control / ETag）。这个模块做四件事：
 *
 *   1. **取画。** `new Image()` 预载一张带 `?v=<时间戳>` 的随机图（接口忽略查询串，
 *      所以 `?v=` 只用来劈开浏览器缓存，不劈的话第二次打开很可能还是上一张）。
 *   2. **首张直接出现，不淡入。** 实测（_audit/probe-timeline.mjs）一次刷新的时间线：
 *        底片首次可见 39ms · hooks 写入 --kl-art 744ms · 随机图下载 764→1878ms
 *        壁纸首次画出 1889ms · 完全淡入 2411ms
 *      也就是说那张画最早也要 ~1.9s 才可能存在（地址只能由这里注入）。原先首张还
 *      额外走了一条 420ms 的淡入 —— 那是「先看见默认背景」的观感来源之一。
 *      现在首张把 URL 直接放上去（fade 一直是 1，URL 一变没有过渡），预载过的图
 *      下一帧就画出来；过渡只留给**换画**，而且是真交叉淡入：旧画垫在 body::before
 *      上（`--kl-prev`），新画在 body::after 上从 0 淡到 1，中间没有一帧只有底色。
 *   3. **按节奏续抽。** 每 4 分钟一张；标签页离开超过 45 秒再回来时也抽一张
 *      （回来时最想看见的是「新的」）。另外 `Ctrl+Alt+K` 可以手动抽一张。
 *   4. **取不到画时把底片叫出来。** 连错三次就清掉 `--kl-art` 的覆盖并打上
 *      `data-kaleido-plate` —— CSS 的默认底是**一层素底**（不是那张棱镜底片），
 *      只有这个属性出现时底片才铺。于是正常刷新的路径上永远不会看到「另一个背景」，
 *      而接口挂掉时也不会只剩一块空白。轮换计时器不动，下一轮还会再试。
 *
 * 三个刻意的选择：
 *   · **写值写在 body 上，不写在 html 上。** `--kl-art` 由样式表声明在 body 上，
 *     html 上的继承值会被 body 自己的声明盖掉 —— 写 html 等于什么都没发生。
 *   · **apply 里不写 `--kl-art: none` / `--kl-art-fade: 0`。** 样式表的默认值本来
 *     就是 none；把 fade 按到 0 只会给首张加一条没有意义的淡入。
 *   · **加载中不铺任何「图案」。** 皮肤的壁纸最早 1.9s 才可能出现，在这之前铺什么
 *     读者都会读成「默认背景」—— 所以铺一层跟着明暗走的素色，读起来是「还在加载」。
 *
 * 契约见 contracts/hooks-api.d.ts：默认导出 defineSkinHooks()、无顶层副作用、
 * 无模块级可变状态、cleanup 幂等。
 */

const API = 'https://api.elaina.cat/random/'
/** 轮换间隔。4 分钟是「会注意到」和「被打断」之间的分界。 */
const ROTATE_MS = 4 * 60 * 1000
/** 取图失败后的重试间隔。 */
const RETRY_MS = 6000
/** 标签页离开多久算「离开过」，回来时值得换一张。 */
const AWAY_MS = 45 * 1000
/** 手动抽卡的冷却，防止连按。 */
const COOLDOWN_MS = 2500
const ATTR = 'data-kaleido-drawing'
/** 「取不到画」的兜底开关：打上之后 CSS 才铺那张棱镜底片。 */
const PLATE = 'data-kaleido-plate'
/** 临时关掉 body::after 的过渡，用来把 opacity 瞬间按到 0。 */
const INSTANT = 'data-kaleido-instant'
const ART = '--kl-art'
const FADE = '--kl-art-fade'
/** 上一张画的 URL —— 换画时垫在下面，这样才是交叉淡入而不是闪一下。 */
const PREV = '--kl-prev'

export default function defineSkinHooks() {
  /** 每次激活一套新的闭包状态 —— 契约要求模块级不存可变状态。 */
  const s = {
    body: null,
    disposed: true,
    rotate: 0,
    retry: 0,
    image: null,
    /** 当前正在显示的那张画的 URL（换画时它变成「上一张」）。 */
    current: null,
    drawnAt: 0,
    hiddenAt: 0,
    busy: false,
    failures: 0,
    onKey: null,
    onVisibility: null,
  }

  const clearTimers = () => {
    if (s.rotate) { clearInterval(s.rotate); s.rotate = 0 }
    if (s.retry) { clearTimeout(s.retry); s.retry = 0 }
  }

  const idle = () => {
    s.busy = false
    if (s.body) s.body.removeAttribute(ATTR)
  }

  /** 把预载好的那张画放上图层。首张直接放，换画做一次交叉淡入。 */
  const reveal = (url, first) => {
    if (s.disposed || !s.body) return
    /* 这一张到了 —— 兜底底片不再需要（重试成功时也要撤掉）。 */
    s.body.removeAttribute(PLATE)
    if (first) {
      /* 首张：fade 一直是 1，所以 URL 一变**没有过渡** —— 图是预载过的
         （在内存缓存里），下一帧就画出来了。 */
      s.body.style.setProperty(ART, 'url("' + url + '")')
      s.current = url
      s.drawnAt = Date.now()
      s.failures = 0
      idle()
      return
    }
    /* 交叉淡入：先把旧画垫到 body::before 上，再把 body::after 的 opacity
       瞬间按到 0、换成新画、淡回 1。中间没有任何一帧是「只有底色」的。 */
    s.body.setAttribute(INSTANT, '')
    if (s.current !== null) s.body.style.setProperty(PREV, 'url("' + s.current + '")')
    s.body.style.setProperty(FADE, '0')
    void s.body.offsetWidth
    s.body.style.setProperty(ART, 'url("' + url + '")')
    s.body.removeAttribute(INSTANT)
    /* 读一次布局，逼浏览器把新 URL 提交在 opacity 仍是 0 的那一帧上，
       再恢复过渡、升回 1 —— 这一步才是那 420ms 的交叉淡入。 */
    void s.body.offsetWidth
    s.body.style.setProperty(FADE, '1')
    s.current = url
    s.drawnAt = Date.now()
    s.failures = 0
    idle()
  }

  const fail = () => {
    if (s.disposed || !s.body) return
    s.failures += 1
    idle()
    if (s.failures >= 3) {
      /* 放手：把底片叫出来当失败画面，并清掉 --kl-art 的覆盖（回落到样式表的
         none，于是不会留着半张画）。轮换计时器不动，下一轮还会再试。 */
      s.body.style.removeProperty(ART)
      s.body.style.removeProperty(FADE)
      s.body.setAttribute(PLATE, '')
      return
    }
    s.retry = setTimeout(() => { s.retry = 0; draw() }, RETRY_MS)
  }

  /** 预载一张随机画，然后交给 CSS 图层。 */
  function draw() {
    if (s.disposed || !s.body || s.busy) return
    const first = s.drawnAt === 0
    if (!first && Date.now() - s.drawnAt < COOLDOWN_MS) return
    s.busy = true
    s.body.setAttribute(ATTR, '')
    const url = API + '?v=' + Date.now().toString(36)
    const img = new Image()
    s.image = img
    img.decoding = 'async'
    img.onload = () => {
      if (s.image === img) s.image = null
      reveal(url, first)
    }
    img.onerror = () => {
      if (s.image === img) s.image = null
      fail()
    }
    img.src = url
  }

  return {
    apply(ctx) {
      s.body = document.body
      s.disposed = false
      s.current = null
      s.drawnAt = 0
      s.hiddenAt = 0
      s.busy = false
      s.failures = 0
      s.image = null
      clearTimers()

      /* 接管：**不写 --kl-art: none / fade 0**。样式表的默认值本来就是 none，
         而把 fade 按到 0 只会给首张加一条没有意义的淡入。底片也由 CSS 默认不铺。 */
      s.body.style.removeProperty(ART)
      s.body.style.removeProperty(FADE)
      s.body.style.removeProperty(PREV)
      s.body.removeAttribute(PLATE)
      s.body.removeAttribute(INSTANT)

      s.onVisibility = () => {
        if (s.disposed) return
        if (document.hidden) {
          s.hiddenAt = Date.now()
          return
        }
        const away = s.hiddenAt === 0 ? 0 : Date.now() - s.hiddenAt
        s.hiddenAt = 0
        if (away > AWAY_MS) draw()
      }
      s.onKey = (event) => {
        if (s.disposed) return
        if (event.ctrlKey && event.altKey && !event.shiftKey && (event.key === 'k' || event.key === 'K')) {
          event.preventDefault()
          draw()
        }
      }
      document.addEventListener('visibilitychange', s.onVisibility)
      document.addEventListener('keydown', s.onKey, true)
      s.rotate = setInterval(draw, ROTATE_MS)

      draw()

      ctx.onCleanup(() => {
        s.disposed = true
        clearTimers()
        if (s.onVisibility) document.removeEventListener('visibilitychange', s.onVisibility)
        if (s.onKey) document.removeEventListener('keydown', s.onKey, true)
        s.onVisibility = null
        s.onKey = null
        s.image = null
        if (s.body) {
          s.body.removeAttribute(ATTR)
          s.body.removeAttribute(PLATE)
          s.body.removeAttribute(INSTANT)
          s.body.style.removeProperty(ART)
          s.body.style.removeProperty(FADE)
          s.body.style.removeProperty(PREV)
        }
      })
    },
    dispose() {
      s.disposed = true
      clearTimers()
      if (s.onVisibility) document.removeEventListener('visibilitychange', s.onVisibility)
      if (s.onKey) document.removeEventListener('keydown', s.onKey, true)
      s.onVisibility = null
      s.onKey = null
      s.image = null
      if (s.body) {
        s.body.removeAttribute(ATTR)
        s.body.removeAttribute(PLATE)
        s.body.removeAttribute(INSTANT)
        s.body.style.removeProperty(ART)
        s.body.style.removeProperty(FADE)
        s.body.style.removeProperty(PREV)
      }
    },
  }
}
