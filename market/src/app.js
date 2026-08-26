// ====================================================================
// 创意工坊 · market/src/app.js
// 视觉层：液态噪波流体背景（WebGL，源自市场首版视觉语言）
// 数据层：manifest/*.json（market-build 产物）+ /api/stats（投票计数）
// 交互：点赞（每设备一票、可撤销）、热度/默认排序、顶部颁奖台、
//       插件分类筛选、搜索、皮肤实时预览（preview.html 模拟器）。
// ====================================================================
(function () {
  'use strict'

  // ---------- 背景特效层（WebGL，不可用时静默回退） ----------
  var canvas = document.getElementById('bgCanvas')
  var bgSeed = Math.random() * 1000
  var gl = null
  if (canvas) {
    try {
      gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' })
    } catch (err) { gl = null }
  }
  if (gl) {
    var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    var W = 0, H = 0, time = 0, last = 0, raf = 0, running = false, contextLost = false
    var scroll = { target: window.scrollY || 0, smooth: window.scrollY || 0 }
    var clicks = []
    var CLICK_MAX = 3, CLICK_FADE = 0.5
    var fx = { brightThreshold: 0.50, stretch: 3.20, scale: 3.20, contrast: 1.08, brightness: 0.96, speed: 0.95 }
    var prog, uRes, uTime, uClicks, uClicksT, uClicksFade, uScroll, uFxA, uFxB, uMeteor, uSeed

    var VERT = [
      'attribute vec2 aPos;',
      'void main() { gl_Position = vec4(aPos, 0.0, 1.0); }',
    ].join('\n')

    var FRAG = [
      '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
      'uniform vec2 uRes;', 'uniform float uTime;', 'uniform vec2 uClicks[3];', 'uniform float uClicksT[3];',
      'uniform float uClicksFade[3];', 'uniform float uScroll;', 'uniform float uMeteor;', 'uniform float uSeed;',
      'uniform vec4 uFxA;', 'uniform vec2 uFxB;', '',
      'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
      'vec2 hash2(vec2 p) { return vec2(hash(p + 17.17), hash(p + 71.53)); }',
      'vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
      'vec4 mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
      'vec4 permute(vec4 x) { return mod289v4(((x * 34.0) + 1.0) * x); }',
      'vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }',
      'float snoise(vec3 v) { const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0); vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx); vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy); vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy; i = mod289v3(i); vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0)); float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx; vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_); vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y); vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw); vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0)); vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww; vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w); vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3))); p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w; vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0); m *= m; return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3))); }',
      'float fluidNoise(vec2 p, float t) { float n1 = snoise(vec3(p * 0.60, t * 0.060)); float n2 = snoise(vec3(p * 0.60 + 5.2, t * 0.060 + 1.3)); vec2 w1 = vec2(n1, n2) * 0.60; float n3 = snoise(vec3((p + w1) * 0.70 + 1.7, t * 0.050 + 3.1)); float n4 = snoise(vec3((p + w1) * 0.70 + 9.2, t * 0.050 + 5.7)); vec2 w2 = vec2(n3, n4) * 0.50; return snoise(vec3((p + w1 + w2) * 0.50, t * 0.040)); }',
      'vec2 curlish(vec2 p, float t) { float eps = 0.020; float n = snoise(vec3(p * 0.80, t)); float nx = snoise(vec3((p + vec2(eps, 0.0)) * 0.80, t)); float ny = snoise(vec3((p + vec2(0.0, eps)) * 0.80, t)); return vec2(-(ny - n), nx - n) / eps * 0.003; }',
      'vec3 starLayer(vec2 p, float scale, float seed, float t, float threshold, float softness, vec2 flowDir, float flowSignal) { vec2 grid = p * scale; grid += vec2(sin(grid.y * 0.41 + seed), sin(grid.x * 0.37 + seed * 1.7)) * 0.18; vec2 id = floor(grid); vec2 rnd = hash2(id + seed); float sizeRnd = hash(id + seed + 9.1); float sizeWeight = smoothstep(0.0, 1.0, sizeRnd); float speedRank = hash(id + seed + 27.4); float motionPhase = t * mix(0.12, 0.52, speedRank) + flowSignal * mix(0.55, 2.20, sizeWeight) + hash(id + seed + 61.8) * 6.28318; vec2 driftDir = normalize(flowDir + vec2(0.0001)); vec2 driftNormal = vec2(-driftDir.y, driftDir.x); float driftAmp = mix(0.010, 0.065, speedRank) * mix(0.22, 1.0, sizeWeight); vec2 drift = driftDir * sin(motionPhase) * driftAmp + driftNormal * cos(motionPhase * 0.73 + rnd.y * 3.1) * driftAmp * 0.45; vec2 point = (rnd - 0.5) * 0.86 + drift; vec2 d = fract(grid) - 0.5 - point; float dist = abs(d.x) + abs(d.y); float size = mix(0.009, 0.050, pow(sizeRnd, 1.65)); float edge = mix(0.023, mix(0.045, 0.080, softness), sqrt(sizeRnd)); float occupancy = step(threshold, rnd.x); float sizeGain = mix(0.38, 1.0, sizeWeight); float star = (1.0 - smoothstep(size, size + edge, dist)) * occupancy * sizeGain; float twinkleCandidate = step(0.948, hash(id + seed + 83.2)); float twinkleCycle = fract(t * mix(0.035, 0.072, hash(id + seed + 91.6)) + hash(id + seed + 47.1)); float twinklePulse = pow(max(0.0, 1.0 - abs(twinkleCycle - 0.18) * 10.0), 3.0); float randomTwinkle = star * twinkleCandidate * twinklePulse * mix(0.10, 0.68, sizeWeight); float fastFlare = 0.0; if (occupancy > 0.5 && speedRank >= 0.90) { vec2 a = abs(d); float horizontal = exp(-a.y * 76.0) * exp(-a.x * 3.0); float vertical = exp(-a.x * 104.0) * exp(-a.y * 1.75); float core = 1.0 - smoothstep(0.012, 0.050, length(d)); float flashCycle = fract(t * mix(0.060, 0.105, speedRank) + flowSignal * 0.20 + hash(id + seed + 41.7)); float flash = pow(max(0.0, 1.0 - abs(flashCycle - 0.17) * 5.0), 5.0); fastFlare = flash * mix(0.55, 1.0, sizeWeight) * (core * 0.40 + vertical * 0.76 + horizontal * 0.20); } return vec3(star, randomTwinkle, fastFlare); }',
      'void main() { vec2 uv = gl_FragCoord.xy / uRes; vec2 aspect = vec2(uRes.x / uRes.y, 1.0); vec2 p = (uv - 0.5) * aspect; float t = uTime * uFxB.y; float scrollOffset = uScroll * 0.000018; vec2 flowDir = normalize(vec2(1.0, 0.28)); vec2 flowNormal = vec2(-flowDir.y, flowDir.x); float transport = t * 0.019 + scrollOffset; float morphTime = t * 0.30 + uSeed * 0.7;',
      '  vec2 rippleCdir = vec2(0.0); vec2 rippleCdirN = vec2(0.0); float totalRing = 0.0; float totalInner = 0.0;',
      '  for (int i = 0; i < 3; i++) { vec2 cpos = uClicks[i]; float ct = uClicksT[i]; float cf = uClicksFade[i]; vec2 cd = p - (cpos - 0.5) * aspect; float cdist = length(cd); vec2 cdir = cd / max(cdist, 0.0008); float fadeK = 1.0 - smoothstep(0.0, 0.5, cf); float rippleAttack = smoothstep(0.0, 0.18, ct); float rippleR = ct * 0.22; float rippleLife = rippleAttack * exp(-ct * 0.78) * fadeK; float ring = exp(-pow((cdist - rippleR) * 13.0, 2.0)) * rippleLife; float innerRing = exp(-pow((cdist - rippleR * 0.72) * 9.0, 2.0)) * rippleLife * exp(-ct * 0.14); totalRing += ring; totalInner += innerRing; rippleCdir += cdir * ring; rippleCdirN += vec2(-cdir.y, cdir.x) * innerRing; }',
      '  vec2 flowSpace = vec2(dot(p, flowDir) / uFxA.y, dot(p, flowNormal)); vec2 advected = (flowDir * flowSpace.x + flowNormal * flowSpace.y) * uFxA.z - flowDir * transport; vec2 localCurl = curlish(advected, morphTime * 0.040); vec2 fluidUv = advected + localCurl * 12.0; fluidUv += rippleCdir * 0.30 + rippleCdirN * 0.14; float f = fluidNoise(fluidUv, morphTime); float swirl = snoise(vec3(fluidUv * 0.80 + f * 1.50, morphTime * 0.035)) * 0.50 + 0.50; float n = f * 0.50 + 0.50; float brightStart = uFxA.x; float tone1 = smoothstep(brightStart - 0.24, brightStart + 0.05, n); float tone2 = smoothstep(brightStart - 0.08, brightStart + 0.20, n + (swirl - 0.5) * 0.18); float tone3 = smoothstep(brightStart + 0.10, brightStart + 0.28, n * 0.72 + swirl * 0.28) * 0.48; float tone4 = smoothstep(0.56, 0.84, n * swirl) * 0.22;',
      '  vec3 c1 = vec3(0.070, 0.152, 0.312); vec3 c2 = vec3(0.156, 0.306, 0.562); vec3 c3 = vec3(0.224, 0.448, 0.712); vec3 c4 = vec3(0.348, 0.596, 0.844); vec3 c5 = vec3(0.096, 0.196, 0.388); vec3 col = mix(c1, c2, tone1); col = mix(col, c3, tone2); col = mix(col, c4, tone3); col = mix(col, c5, tone4); col = (col - vec3(0.18)) * uFxA.w + vec3(0.18); col *= uFxB.x; col += vec3(0.20, 0.42, 0.82) * totalRing * (0.28 + tone2 * 0.48); col += vec3(0.10, 0.24, 0.54) * totalInner * 0.28;',
      '  vec2 rippleShift = rippleCdir * 0.15 + rippleCdirN * 0.07; vec2 flowFollow = localCurl * 7.0; vec2 dustP = p - flowDir * (t * 0.0045 + scrollOffset * 0.70); dustP += flowFollow * 0.30 + flowNormal * (f * 0.024) + rippleShift; vec2 starP = p - flowDir * (t * 0.0070 + scrollOffset * 0.42); starP += flowFollow * 0.21 + flowNormal * (swirl * 0.019) + rippleShift * 0.82;',
      '  float nebula = clamp(tone1 * 0.30 + tone2 * 0.56 + (1.0 - tone4) * 0.14, 0.0, 1.0); float rippleDust = clamp(max(totalRing, totalInner * 0.88), 0.0, 1.0); vec3 dustLayer = starLayer(dustP, 66.0, 4.7 + uSeed, t * 0.68, 0.816 - rippleDust * 0.176, 0.10, flowDir, f); vec3 brightLayer = starLayer(starP, 37.0, 19.3 + uSeed, t * 0.78, 0.904 - rippleDust * 0.272, 0.08, flowDir, swirl * 2.0 - 1.0); vec3 rippleLayer = starLayer(starP - rippleCdir * 0.12, 48.0, 52.6 + uSeed, t * 0.74, 0.976 - rippleDust * 0.576, 0.08, flowDir, f);',
      '  col += vec3(0.64, 0.80, 1.00) * dustLayer.x * nebula * (0.28 + tone2 * 0.44); col += vec3(0.76, 0.88, 1.00) * brightLayer.x * nebula * (0.42 + swirl * 0.36); col += vec3(0.82, 0.92, 1.00) * rippleLayer.x * rippleDust * 1.46; float randomTwinkle = dustLayer.y * 0.48 + brightLayer.y * 0.92 + rippleLayer.y * rippleDust * 1.05; col += vec3(0.78, 0.94, 1.00) * randomTwinkle; float flareMask = clamp(tone2 * 0.76 + tone3 * 0.24, 0.0, 1.0); float fastFlare = dustLayer.z * 0.62 + brightLayer.z * 1.12 + rippleLayer.z * rippleDust * 1.28; col += vec3(0.94, 1.08, 1.24) * fastFlare * (0.52 + flareMask * 0.82);',
      '  float mSlot = floor(t / 10.5); float meteor = 0.0; for (int sj = 0; sj < 3; sj++) { float slotF = mSlot - float(sj); float mCount = 1.0 + floor(hash2(vec2(slotF + uSeed, 1.7)).x * 2.5); for (int mk = 0; mk < 3; mk++) { float kf = float(mk); if (kf >= mCount) break; float appear = slotF * 10.5 + hash2(vec2(slotF + uSeed, 3.1 + kf * 7.7)).x * 9.0; float mT = t - appear; float ySeed = hash2(vec2(slotF + uSeed, 5.3 + kf * 9.1)).x; float xSeed = hash2(vec2(slotF + uSeed, 11.1 + kf * 5.5)).x; float vSeed = hash2(vec2(slotF + uSeed, 7.9 + kf * 3.3)).x; float aSeed = hash2(vec2(slotF + uSeed, 13.7 + kf * 3.9)).x; vec2 mStart = vec2(-0.2 + xSeed * 0.18, 0.08 + ySeed * 0.62); float angOff = (aSeed - 0.5) * 0.6; vec2 mDir = vec2(flowDir.x * cos(angOff) - flowDir.y * sin(angOff), flowDir.x * sin(angOff) + flowDir.y * cos(angOff)); float needX = (1.12 - mStart.x) / mDir.x; float needY = mDir.y > 0.02 ? (1.08 - mStart.y) / mDir.y : -1.0; float mLen = max(needX, needY); float mSpeed = 0.135 + vSeed * 0.365; float mFlight = mLen / mSpeed; float mProg = mT / mFlight; if (mProg < 0.0 || mProg >= 1.0) continue; vec2 mPos = mStart + mDir * mProg * mLen; vec2 md = uv - mPos; vec2 mPerpDir = vec2(-mDir.y, mDir.x); float mAlong = dot(md, mDir); float mPerp = dot(md, mPerpDir); float mHead = exp(-dot(md, md) * 1000000.0); float mTrailLen = 0.12 + (mSpeed - 0.135) * 0.904; float mTrail = exp(-mPerp * mPerp * 2000000.0) * smoothstep(-mTrailLen, -0.015, mAlong) * step(mAlong, 0.0); float mFade = smoothstep(0.0, 0.08, mProg) * (1.0 - smoothstep(0.88, 1.0, mProg)); meteor += (mHead * 0.7 + mTrail * 0.35) * mFade; } } meteor *= uMeteor; float mLum = dot(col, vec3(0.299, 0.587, 0.114)); float mDarkMask = 1.0 - smoothstep(0.10, 0.24, mLum); col += vec3(0.85, 0.95, 1.05) * meteor * mDarkMask;',
      '  float vignette = 1.0 - smoothstep(0.48, 1.06, length((uv - 0.5) * vec2(0.86, 1.0))); col *= 0.88 + vignette * 0.12; col = pow(max(col, 0.0), vec3(0.94)); gl_FragColor = vec4(col, 1.0); }',
    ].join('\n')

    function compileSh(type, src) {
      var shader = gl.createShader(type)
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
      return shader
    }

    function buildResources() {
      var vs = compileSh(gl.VERTEX_SHADER, VERT)
      var fs = compileSh(gl.FRAGMENT_SHADER, FRAG)
      prog = gl.createProgram()
      gl.attachShader(prog, vs)
      gl.attachShader(prog, fs)
      gl.linkProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
      gl.useProgram(prog)
      var buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      var aPos = gl.getAttribLocation(prog, 'aPos')
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
      uRes = gl.getUniformLocation(prog, 'uRes'); uTime = gl.getUniformLocation(prog, 'uTime')
      uClicks = gl.getUniformLocation(prog, 'uClicks'); uClicksT = gl.getUniformLocation(prog, 'uClicksT')
      uClicksFade = gl.getUniformLocation(prog, 'uClicksFade'); uMeteor = gl.getUniformLocation(prog, 'uMeteor')
      uSeed = gl.getUniformLocation(prog, 'uSeed'); uScroll = gl.getUniformLocation(prog, 'uScroll')
      uFxA = gl.getUniformLocation(prog, 'uFxA'); uFxB = gl.getUniformLocation(prog, 'uFxB')
    }

    var buildOk = true
    try { buildResources() } catch (err) { buildOk = false }
    if (buildOk) {
      var softwareRenderer = (function () {
        var info = gl.getExtension('WEBGL_debug_renderer_info')
        var name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''
        return /swiftshader|llvmpipe|software/i.test(name)
      })()

      function resize() {
        W = canvas.clientWidth || window.innerWidth
        H = canvas.clientHeight || window.innerHeight
        var nativeDpr = Math.min(window.devicePixelRatio || 1, 1.5)
        var maxPixels = softwareRenderer ? 400000 : 2400000
        var renderDpr = Math.min(nativeDpr, Math.sqrt(maxPixels / Math.max(1, W * H)))
        canvas.width = Math.max(1, Math.round(W * renderDpr))
        canvas.height = Math.max(1, Math.round(H * renderDpr))
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.uniform2f(uRes, canvas.width, canvas.height)
        if (reduceMotion) draw()
      }
      window.addEventListener('resize', resize)
      window.addEventListener('pointerdown', function (e) {
        if (clicks.length >= CLICK_MAX) return
        clicks.push({ x: e.clientX, y: e.clientY, t: 0, fade: -1 })
        for (var i = 0; i < clicks.length - 1; i++) clicks[i].fade = 0
      }, { passive: true })

      function draw() {
        if (contextLost || !prog || !W || !H) return
        gl.useProgram(prog)
        gl.uniform1f(uTime, time)
        var cA = [], tA = [], fA = []
        for (var i = 0; i < 3; i++) {
          var c = clicks[i] || { x: -10, y: -10, t: 1e4, fade: -1 }
          cA.push(c.x / W, 1 - c.y / H); tA.push(c.t); fA.push(c.fade)
        }
        gl.uniform2fv(uClicks, cA); gl.uniform1fv(uClicksT, tA); gl.uniform1fv(uClicksFade, fA)
        gl.uniform1f(uScroll, reduceMotion ? 0 : scroll.smooth)
        gl.uniform1f(uMeteor, reduceMotion ? 0 : 1)
        gl.uniform1f(uSeed, bgSeed)
        gl.uniform4f(uFxA, fx.brightThreshold, fx.stretch, fx.scale, fx.contrast)
        gl.uniform2f(uFxB, fx.brightness, fx.speed)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }

      function stop() { running = false; cancelAnimationFrame(raf) }

      function frame(now) {
        if (!running) return
        raf = requestAnimationFrame(frame)
        var dt = Math.min((now - last) / 1000, 0.05)
        if (!(dt > 0)) dt = 0.016
        last = now
        time += dt
        clicks.forEach(function (c) {
          c.t += dt
          if (c.fade >= 0) c.fade = Math.min(CLICK_FADE, c.fade + dt)
        })
        clicks = clicks.filter(function (c) { return c.fade < CLICK_FADE })
        scroll.target = window.scrollY || 0
        scroll.smooth += (scroll.target - scroll.smooth) * Math.min(1, dt * 2.4)
        draw()
      }

      function start() {
        if (running || reduceMotion || document.hidden || contextLost) return
        running = true
        last = performance.now()
        raf = requestAnimationFrame(frame)
      }

      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop(); else start()
      })
      canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); contextLost = true; stop() })
      canvas.addEventListener('webglcontextrestored', function () {
        contextLost = false
        try { buildResources(); resize(); draw(); start() } catch (err) { contextLost = true }
      })
      resize()
      if (reduceMotion) { time = 7.2; draw() } else { draw(); start() }
      canvas.classList.add('ready')
    }
  }

  // ====================================================================
  // 市场应用
  // ====================================================================
  var KIND_LABEL = { skin: '皮肤', pet: '宠物', plugin: '插件' }
  var CAT_LABEL = {
    agent: 'Agent', ui: '界面', tools: '工具', knowledge: '知识',
    integration: '集成', security: '安全', utility: '实用', other: '其他'
  }
  // 二级分类（category → subcategory）：词表与合法集合见 community-index 的同名映射。
  var SUB_ORDER = {
    ui: ['terminal', 'chat', 'render', 'panel'],
    agent: ['preset'],
    tools: ['context', 'browser', 'api', 'model', 'dev'],
    knowledge: ['memory', 'reading', 'qa'],
    integration: ['remote', 'bridge', 'sync', 'external-ai'],
    security: ['access', 'policy'],
    utility: ['cleanup', 'stats', 'notify', 'net'],
  }
  var SUB_LABEL = {
    terminal: '终端界面', chat: '对话增强', render: '回复内容渲染', panel: '侧栏面板',
    preset: 'Agent 预设', context: '上下文洞察', browser: '浏览器自动化',
    api: '接口与网络调试', model: '模型与多模态', dev: '开发工作流',
    memory: '记忆', reading: '深度阅读', qa: '知识库问答',
    remote: '远程访问', bridge: '跨系统桥', sync: '云同步', 'external-ai': '外部 AI 接入',
    access: '访问控制', policy: '审批策略', cleanup: '系统整理',
    stats: '统计', notify: '通知', net: '网络与传输',
  }
  var state = {
    kind: 'skin',
    sort: 'hot',
    query: '',
    cat: 'all',
    subcat: 'all',
    data: { skin: [], pet: [], plugin: [] },
    votes: { skin: {}, pet: {}, plugin: {} },
    installs: { skin: {}, pet: {}, plugin: {} },
    npmDownloads: {},
    apiOk: false,
  }

  function $(sel) { return document.querySelector(sel) }
  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  function deviceFp() {
    var KEY = 'dsh-market-fp'
    var fp = null
    try { fp = window.localStorage.getItem(KEY) } catch (e) { fp = null }
    if (!fp || !/^[A-Za-z0-9_-]{16,64}$/.test(fp)) {
      fp = window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : 'fp-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
      try { window.localStorage.setItem(KEY, fp) } catch (e) { }
    }
    return fp
  }
  function loadMyVotes() {
    try { return JSON.parse(window.localStorage.getItem('dsh-market-votes') || '{}') } catch (e) { return {} }
  }
  function saveMyVotes(v) {
    try { window.localStorage.setItem('dsh-market-votes', JSON.stringify(v)) } catch (e) { }
  }
  var myVotes = loadMyVotes()

  function votesFor(kind, id) { return (state.votes[kind] && state.votes[kind][id]) || 0 }
  function installsFor(kind, id) { return (state.installs[kind] && state.installs[kind][id]) || 0 }
  function npmDownloadsFor(item) { return (item.npm && state.npmDownloads[item.npm]) || null }
  function hasMyVote(kind, id) { return !!myVotes[kind + ':' + id] }
  function thumbSrc(kind, item) {
    if (kind === 'skin') return item.preview && item.preview.light
    if (kind === 'pet') return (item.previews && item.previews[0]) || item.spritesheet
    return ''
  }

  function fetchJson(url) {
    return fetch(url, { headers: { accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    })
  }
  function load() {
    function safe(p) { return p.then(function (r) { return r }).catch(function () { return null }) }
    return Promise.all([
      safe(fetchJson('manifest/skins.json')).then(function (x) { state.data.skin = x ? x.items : [] }),
      safe(fetchJson('manifest/pets.json')).then(function (x) { state.data.pet = x ? x.items : [] }),
      safe(fetchJson('manifest/plugins.json')).then(function (x) { state.data.plugin = x ? x.items : [] }),
      safe(fetchJson('/api/stats')).then(function (s) {
        state.apiOk = !!s
        if (s && s.skin) state.votes = { skin: s.skin || {}, pet: s.pet || {}, plugin: s.plugin || {} }
        if (s && s.installs) state.installs = { skin: s.installs.skin || {}, pet: s.installs.pet || {}, plugin: s.installs.plugin || {} }
      }),
      safe(fetchJson('/api/npm-downloads')).then(function (d) {
        state.npmDownloads = (d && d.downloads) || {}
      }),
    ]).then(function () { renderTabCounts(); renderAll() })
  }

  function sortedFor(kind) {
    var items = state.data[kind].slice()
    items.sort(function (a, b) {
      if (state.sort === 'rank') return (a.rank || 999) - (b.rank || 999)
      var va = votesFor(kind, a.id), vb = votesFor(kind, b.id)
      if (va !== vb) return vb - va
      return (a.rank || 999) - (b.rank || 999)
    })
    return items
  }
  function podiumTop(kind) {
    var items = state.data[kind].slice()
    items.sort(function (a, b) {
      var va = votesFor(kind, a.id), vb = votesFor(kind, b.id)
      if (va !== vb) return vb - va
      return (a.rank || 999) - (b.rank || 999)
    })
    return items.slice(0, 3)
  }
  function matches(item) {
    if (state.cat !== 'all' && item.category !== state.cat) return false
    if (state.cat !== 'all' && state.subcat !== 'all' && item.subcategory !== state.subcat) return false
    if (!state.query) return true
    var q = state.query.toLowerCase()
    var parts = [item.name, item.nameEn, item.displayName, item.author, item.description, item.descriptionEn, item.tagline]
    if (item.tags) parts = parts.concat(item.tags)
    parts.push(CAT_LABEL[item.category] || '', SUB_LABEL[item.subcategory] || '')
    var hay = parts.filter(Boolean).join(' ').toLowerCase()
    return hay.indexOf(q) !== -1
  }

  function renderTabCounts() {
    var counts = { skin: state.data.skin.length, pet: state.data.pet.length, plugin: state.data.plugin.length }
    document.querySelectorAll('.mk-tab').forEach(function (t) {
      var k = t.getAttribute('data-kind')
      var span = t.querySelector('.mk-tab-count')
      if (!span) { span = el('span', 'mk-tab-count'); t.appendChild(span) }
      span.textContent = String(counts[k] || 0)
    })
  }

  function renderPodium() {
    var root = $('#podium')
    root.innerHTML = ''
    // 冠军台只展示当前 tab 类别；布局为经典阶梯：第 1 名居中最高，
    // 第 2 名在左、略低，第 3 名在右、更低（DOM 按 1/2/3 顺序，
    // 视觉顺序由 CSS order 重排为 2/1/3）。
    var kind = state.kind
    var group = el('div', 'mk-podium-group')
    var title = el('div', 'mk-podium-title', KIND_LABEL[kind])
    title.appendChild(el('span', 'mk-podium-kind', 'TOP 3'))
    group.appendChild(title)
    var list = el('div', 'mk-podium-list')
    var top = podiumTop(kind)
    if (!top.length) {
      list.appendChild(el('div', 'mk-podium-empty', '暂无条目'))
    } else {
      top.forEach(function (item, i) {
        var rank = i + 1
        var votes = votesFor(kind, item.id)
        var pending = votes === 0
        var slot = el('button', 'mk-podium-slot rank-' + rank + (pending ? ' pending' : ''))
        slot.type = 'button'
        slot.setAttribute('aria-label', KIND_LABEL[kind] + ' 第 ' + rank + ' 名: ' + (item.name || item.displayName))
        slot.appendChild(el('span', 'mk-medal', String(rank)))
        var src = thumbSrc(kind, item)
        if (src) {
          var img = el('img', 'mk-podium-thumb')
          img.src = src
          img.alt = ''
          img.loading = 'lazy'
          slot.appendChild(img)
        }
        slot.appendChild(el('div', 'mk-podium-name', item.name || item.displayName))
        slot.appendChild(el('div', 'mk-podium-votes', pending ? '待点亮' : votes + ' 票'))
        slot.addEventListener('click', function () { openDetail(kind, item.id) })
        list.appendChild(slot)
      })
    }
    group.appendChild(list)
    root.appendChild(group)
  }

  function renderCatFilter() {
    var box = $('#catFilter')
    var subBox = $('#subCatFilter')
    box.innerHTML = ''
    subBox.innerHTML = ''
    if (state.kind !== 'plugin') { box.style.display = 'none'; subBox.style.display = 'none'; return }
    box.style.display = ''
    var cats = {}
    state.data.plugin.forEach(function (p) { var c = p.category || 'other'; cats[c] = (cats[c] || 0) + 1 })
    box.appendChild(mkChipKey('all', '全部', state.data.plugin.length))
    Object.keys(cats).sort().forEach(function (c) { box.appendChild(mkChipKey(c, CAT_LABEL[c] || c, cats[c])) })
    // 二级行只在选中具体一级分类时出现；切换一级分类时复位二级。
    if (state.cat === 'all') { subBox.style.display = 'none'; return }
    subBox.style.display = ''
    var subs = {}
    state.data.plugin.forEach(function (p) {
      if (p.category !== state.cat || !p.subcategory) return
      subs[p.subcategory] = (subs[p.subcategory] || 0) + 1
    })
    var subTotal = 0
    Object.keys(subs).forEach(function (k) { subTotal += subs[k] })
    subBox.appendChild(mkSubChipKey('all', '全部', subTotal))
    var order = SUB_ORDER[state.cat] || []
    var keys = order.filter(function (k) { return subs[k] })
    Object.keys(subs).sort().forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k) })
    keys.forEach(function (k) { subBox.appendChild(mkSubChipKey(k, SUB_LABEL[k] || k, subs[k])) })
    function mkSubChipKey(key, label, count) {
      var b = el('button', 'mk-chip mk-chip-sub' + (state.subcat === key ? ' on' : ''), label + (count ? ' ' + count : ''))
      b.type = 'button'
      b.addEventListener('click', function () { state.subcat = key; renderCatFilter(); renderGrid() })
      return b
    }
    function mkChipKey(key, label, count) {
      var b = el('button', 'mk-chip' + (state.cat === key ? ' on' : ''), label + (count ? ' ' + count : ''))
      b.type = 'button'
      b.addEventListener('click', function () { state.cat = key; state.subcat = 'all'; renderCatFilter(); renderGrid() })
      return b
    }
  }

  function metricLabel(kind, item) {
    var parts = []
    var installs = installsFor(kind, item.id)
    if (installs > 0) parts.push('安装 ' + installs)
    var npmDownload = npmDownloadsFor(item)
    if (npmDownload !== null) parts.push('npm 近 30 天 ' + npmDownload)
    return parts.join(' · ')
  }

  function renderCard(kind, item) {
    var card = el('article', 'mk-card')
    // Community plugins carry no artwork: skip the media block so the card
    // renders text only; classification labels live in the meta line.
    var media = null
    if (kind !== 'plugin') {
      media = el('div', 'mk-card-media')
      // (plugin branch removed; skins and pets keep their media below)
      var src = thumbSrc(kind, item)
      if (src) {
        var img = el('img')
        img.src = src
        img.alt = ''
        img.loading = 'lazy'
        media.appendChild(img)
      }
      if (kind === 'pet') media.classList.add('mk-card-media-pet')
      if (kind === 'skin') {
        media.classList.add('mk-card-media-skin')
        if (item.accent) {
          var bar = el('div', 'mk-accent-bar')
          bar.style.background = item.accent
          media.appendChild(bar)
        }
      }
    }
    if (media) card.appendChild(media)
    var body = el('div', 'mk-card-body')
    var name = (kind !== 'pet' && item.repo)
      ? el('a', 'mk-card-name', item.name || item.displayName)
      : el('div', 'mk-card-name', item.name || item.displayName)
    if (item.nameEn && item.nameEn !== item.name) name.appendChild(el('span', 'mk-card-name-en', item.nameEn))
    if (name.tagName === 'A') {
      name.href = item.repo
      name.target = '_blank'
      name.rel = 'noopener'
    }
    body.appendChild(name)
    var meta = []
    if (item.author) meta.push(item.author)
    if (kind === 'skin' && item.version) meta.push('v' + item.version)
    if (kind === 'plugin') meta.push(CAT_LABEL[item.category] || item.category)
    if (kind === 'plugin' && item.subcategory) meta.push(SUB_LABEL[item.subcategory] || item.subcategory)
    if (kind === 'pet' && item.renderer) meta.push(item.renderer)
    body.appendChild(el('div', 'mk-card-meta', meta.join(' · ')))
    var metric = metricLabel(kind, item)
    if (metric) body.appendChild(el('div', 'mk-card-metric', metric))
    var desc = item.tagline || item.description || item.descriptionEn || (kind === 'pet' ? '' : '')
    body.appendChild(el('div', 'mk-card-desc', desc))
    var actions = el('div', 'mk-card-actions')
    var liked = hasMyVote(kind, item.id)
    var like = el('button', 'mk-like' + (liked ? ' on' : ''))
    like.type = 'button'
    like.appendChild(el('span', 'mk-like-ico', liked ? '已赞' : '赞'))
    like.appendChild(el('span', null, String(votesFor(kind, item.id))))
    like.addEventListener('click', function () { toggleLike(kind, item.id) })
    actions.appendChild(like)
    var detail = el('button', 'mk-detail', '详情')
    detail.type = 'button'
    detail.addEventListener('click', function () { openDetail(kind, item.id) })
    actions.appendChild(detail)
    body.appendChild(actions)
    card.appendChild(body)
    return card
  }

  function renderGrid() {
    var grid = $('#grid')
    grid.innerHTML = ''
    var items = sortedFor(state.kind).filter(matches)
    if (!items.length) {
      grid.appendChild(el('div', 'mk-empty', '没有匹配的条目'))
    } else {
      items.forEach(function (it) { grid.appendChild(renderCard(state.kind, it)) })
    }
    $('#toolbarInfo').textContent = '共 ' + items.length + ' 个条目'
  }

  function renderAll() {
    renderPodium()
    renderCatFilter()
    renderGrid()
    $('#apiState').textContent = state.apiOk ? '' : '离线模式：点赞暂不可用'
  }

  var likeSeq = {}
  function toggleLike(kind, id) {
    if (!state.apiOk) { toast('点赞服务暂时不可用，请稍后再试'); return }
    var key = kind + ':' + id
    var seq = (likeSeq[key] || 0) + 1
    likeSeq[key] = seq
    var wasLiked = !!myVotes[key]
    var prevVotes = votesFor(kind, id)
    var nextLiked = !wasLiked
    myVotes[key] = nextLiked
    saveMyVotes(myVotes)
    state.votes[kind][id] = Math.max(0, prevVotes + (nextLiked ? 1 : -1))
    renderAll()
    turnstileToken().then(function (token) {
      return fetch('/api/like', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: kind, asset_id: id, device_fp: deviceFp(), unlike: !nextLiked, turnstile_token: token }),
      })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    }).then(function (d) {
      if (likeSeq[key] !== seq) return
      if (typeof d.votes === 'number') state.votes[kind][id] = d.votes
      renderAll()
    }).catch(function () {
      if (likeSeq[key] !== seq) return
      myVotes[key] = wasLiked
      saveMyVotes(myVotes)
      state.votes[kind][id] = prevVotes
      renderAll()
      toast('点赞失败，请稍后再试')
    })
  }

  // ---------- 详情弹层 ----------
  function openDetail(kind, id) {
    var item = null
    state.data[kind].forEach(function (it) { if (it.id === id) item = it })
    if (!item) return
    var dlg = $('#detail')
    dlg.innerHTML = ''
    var close = el('button', 'mk-dialog-close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', '关闭')
    close.addEventListener('click', function () { dlg.close() })
    var inner = el('div', 'mk-dialog-inner')
    var media = el('div', 'mk-dialog-media')
    var info = el('div', 'mk-dialog-info')
    var head = el('div', 'mk-dialog-head')
    head.appendChild(el('div', 'mk-dialog-title', item.name || item.displayName))
    if (item.nameEn && item.nameEn !== item.name) head.appendChild(el('span', 'mk-tag', item.nameEn))
    info.appendChild(head)

    if (kind === 'skin') {
      // 预览用 manifest 的完整截图（1440x900），contain 完整展示；
      // 实时试穿独立在新标签页打开完整模拟器（视口足够大，不会裁剪）。
      var modes = el('div', 'mk-skin-modes')
      var skinImg = el('img', 'mk-skin-img')
      skinImg.alt = (item.name || item.displayName) + ' 皮肤预览'
      skinImg.loading = 'lazy'
      var tryon = el('a', 'mk-skin-tryon', '实时试穿 ↗')
      tryon.rel = 'noopener'
      tryon.target = '_blank'
      tryon.href = 'tryon/?skin=' + encodeURIComponent(item.id) + '&theme=light'
      function skinSrc(theme) {
        var p = item.preview || {}
        return p[theme] || p.light || p.dark || ''
      }
      skinImg.src = skinSrc('light')
      function mkMode(theme, label) {
        var b = el('button', 'mk-chip' + (theme === 'light' ? ' on' : ''), label)
        b.type = 'button'
        b.addEventListener('click', function () {
          skinImg.src = skinSrc(theme)
          modes.querySelectorAll('button').forEach(function (o) { o.classList.remove('on') })
          b.classList.add('on')
          tryon.href = 'tryon/?skin=' + encodeURIComponent(item.id) + '&theme=' + theme
        })
        modes.appendChild(b)
      }
      mkMode('light', '亮色预览')
      mkMode('dark', '暗色预览')
      modes.appendChild(tryon)
      media.appendChild(modes)
      media.appendChild(skinImg)
      if (item.tagline) info.appendChild(el('div', 'mk-dialog-tagline', item.tagline))
      if (item.description) info.appendChild(el('div', 'mk-dialog-text', item.description))
      if (item.tags && item.tags.length) {
        var tags = el('div', 'mk-dialog-tags')
        item.tags.forEach(function (t) { tags.appendChild(el('span', 'mk-tag', t)) })
        info.appendChild(tags)
      }
      var install = el('div', 'mk-install')
      install.appendChild(el('div', 'mk-install-title', '安装方式'))
      var steps = el('ol', 'mk-install-steps')
      steps.appendChild(el('li', null, '运行 dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center'))
      steps.appendChild(el('li', null, '在设置页 Skin Center 的内置集合中启用该皮肤'))
      steps.appendChild(el('li', null, '社区皮肤可放入 $DSH_HOME/skins/<id>/ 目录，无需重启'))
      install.appendChild(steps)
      info.appendChild(install)
      if (item.repo) {
        var skinSource = el('div', null)
        var skinSourceLink = el('a', null, '源码仓库')
        skinSourceLink.href = item.repo
        skinSourceLink.target = '_blank'
        skinSourceLink.rel = 'noopener'
        skinSource.appendChild(skinSourceLink)
        skinSource.style.marginTop = '10px'
        info.appendChild(skinSource)
      }
    } else if (kind === 'pet') {
      var petMedia = el('div', 'mk-pet-media')
      var previews = item.previews || []
      var mainImg = el('img', 'mk-pet-main')
      mainImg.src = previews[0] || item.spritesheet
      mainImg.alt = item.displayName
      petMedia.appendChild(mainImg)
      if (previews.length > 1) {
        var thumbs = el('div', 'mk-pet-thumbs')
        previews.forEach(function (pv, i) {
          var t = el('img')
          t.src = pv
          t.alt = ''
          if (i === 0) t.className = 'on'
          t.addEventListener('click', function () {
            mainImg.src = pv
            thumbs.querySelectorAll('img').forEach(function (o) { o.className = '' })
            t.className = 'on'
          })
          thumbs.appendChild(t)
        })
        petMedia.appendChild(thumbs)
      }
      if (item.spritesheet) {
        var sheet = el('img', 'mk-pet-sheet')
        sheet.src = item.spritesheet
        sheet.alt = '精灵表'
        sheet.style.maxHeight = '170px'
        sheet.style.objectFit = 'contain'
        petMedia.appendChild(sheet)
      }
      media.appendChild(petMedia)
      var petMeta = '渲染器: ' + (item.renderer || 'sprite2d')
      if (item.tracks && item.tracks.length) petMeta += ' · 状态: ' + item.tracks.join(', ')
      info.appendChild(el('div', 'mk-dialog-text', petMeta))
      var install2 = el('div', 'mk-install')
      install2.appendChild(el('div', 'mk-install-title', '安装方式'))
      var steps2 = el('ol', 'mk-install-steps')
      steps2.appendChild(el('li', null, '运行 dsh plugin --profile web add @linxin666/dsh-pet'))
      steps2.appendChild(el('li', null, '内置鲸鱼娘开箱即用；自定义宠物目录放入 $DSH_HOME/pets/<id>/'))
      install2.appendChild(steps2)
      info.appendChild(install2)
    } else {
      // Plugin detail is text only: no artwork block, the classification and
      // author line opens the info column.
      var metaParts = [CAT_LABEL[item.category] || item.category]
      if (item.subcategory) metaParts.push(SUB_LABEL[item.subcategory] || item.subcategory)
      if (item.author) metaParts.push(item.author)
      info.appendChild(el('div', 'mk-dialog-tagline', metaParts.join(' · ')))
      if (item.description) info.appendChild(el('div', 'mk-dialog-text', item.description))
      if (item.descriptionEn) {
        var enBlock = el('div', 'mk-dialog-text')
        enBlock.style.marginTop = '8px'
        enBlock.textContent = item.descriptionEn
        info.appendChild(enBlock)
      }
      if (item.repo) {
        var rl = el('div', null)
        var a = el('a', null, '源码仓库')
        a.href = item.repo
        a.target = '_blank'
        a.rel = 'noopener'
        rl.appendChild(a)
        rl.style.marginTop = '10px'
        info.appendChild(rl)
      }
      var install3 = el('div', 'mk-install')
      install3.appendChild(el('div', 'mk-install-title', '安装方式'))
      var cmd = item.npm ? ('dsh plugin --profile web add ' + item.npm) : (item.repo ? ('dsh plugin --profile web add ' + item.repo) : '')
      var steps3 = el('ol', 'mk-install-steps')
      steps3.appendChild(el('li', null, '复制命令到 dsh host 终端执行，安装后重启 dsh web 生效'))
      install3.appendChild(steps3)
      if (cmd) {
        var code = el('div', 'mk-code')
        code.appendChild(el('span', null, cmd))
        var cp = el('button', null, '复制')
        cp.type = 'button'
        cp.addEventListener('click', function () { copyText(cmd, cp) })
        code.appendChild(cp)
        install3.appendChild(code)
      } else {
        install3.appendChild(el('div', 'mk-dialog-tagline', '该条目未提供 npm 包或仓库地址，请从社区获取更多信息。'))
      }
      info.appendChild(install3)
    }

    if (kind !== 'plugin') inner.appendChild(media)
    inner.appendChild(info)
    dlg.appendChild(close)
    dlg.appendChild(inner)
    if (dlg.showModal) dlg.showModal()
    else dlg.setAttribute('open', '')
  }

  function copyText(t, btn) {
    function done() {
      var old = btn.textContent
      btn.textContent = '已复制'
      setTimeout(function () { btn.textContent = old }, 1200)
    }
    function fallback() {
      var ta = document.createElement('textarea')
      ta.value = t
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch (e) { }
      ta.remove()
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done).catch(function () { fallback(); done() })
    } else {
      fallback(); done()
    }
  }

  var toastTimer = 0
  function toast(msg) {
    var t = $('#toast')
    t.textContent = msg
    t.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { t.classList.remove('show') }, 2200)
  }

  // ---------- 事件绑定 ----------
  function bind() {
    document.querySelectorAll('.mk-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        state.kind = tab.getAttribute('data-kind')
        state.cat = 'all'
        state.subcat = 'all'
        document.querySelectorAll('.mk-tab').forEach(function (t) {
          var on = t === tab
          t.classList.toggle('on', on)
          t.setAttribute('aria-selected', String(on))
        })
        renderAll()
      })
    })
    document.querySelectorAll('[data-sort]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        state.sort = chip.getAttribute('data-sort')
        document.querySelectorAll('[data-sort]').forEach(function (c) { c.classList.toggle('on', c === chip) })
        renderGrid()
      })
    })
    var search = $('#search')
    search.addEventListener('input', function () { state.query = search.value.trim(); renderGrid() })
    var dlg = $('#detail')
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close() })
    dlg.addEventListener('close', function () { dlg.innerHTML = '' })
  }

  // ---------- Turnstile (invisible) for public-site likes ----------
  var TURNSTILE_SITEKEY = '0x4AAAAAAEYeoSRJRjgCOiZI'
  var tsWidgetId = null
  var tsResolve = null
  var tsChain = Promise.resolve()
  var tsError = false
  window.__dshTsCallback = function (token) {
    if (tsResolve) { var resolve = tsResolve; tsResolve = null; resolve(token) }
  }
  function loadTurnstile() {
    if (tsError) return Promise.resolve(false)
    if (window.turnstile) return Promise.resolve(true)
    return new Promise(function (resolve) {
      var s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true
      s.onload = function () { resolve(true) }
      s.onerror = function () { tsError = true; resolve(false) }
      document.head.appendChild(s)
    })
  }
  function renderTurnstile() {
    return loadTurnstile().then(function (ok) {
      if (!ok || !window.turnstile) return false
      var div = document.getElementById('ts-anchor')
      if (!div) {
        div = document.createElement('div')
        div.id = 'ts-anchor'
        div.style.display = 'none'
        document.body.appendChild(div)
      }
      try {
        tsWidgetId = window.turnstile.render(div, {
          sitekey: TURNSTILE_SITEKEY,
          callback: window.__dshTsCallback,
          action: 'market-like',
        })
        return true
      } catch (e) { return false }
    })
  }
  function turnstileToken() {
    if (tsWidgetId === null || !window.turnstile) return Promise.resolve('')
    var attempt = tsChain.then(function () {
      return new Promise(function (resolve) {
        var settled = false
        var timer = 0
        function done(token) {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          if (tsResolve === done) tsResolve = null
          resolve(token)
        }
        timer = window.setTimeout(function () { done('') }, 8000)
        tsResolve = done
        try { window.turnstile.reset(tsWidgetId) } catch (e) { }
        try { window.turnstile.execute(tsWidgetId) } catch (e) { done('') }
      })
    })
    tsChain = attempt.then(function () {}, function () {})
    return attempt
  }

  // ---------- 右上角 GitHub 仓库按钮（仓库 + Star 数） ----------
  var GITHUB_REPO = 'zhu1090093659/dsh-web'
  function formatStars(n) {
    if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
    return String(n)
  }
  function loadGitHubStars() {
    var host = document.querySelector('.mk-github-star')
    if (!host) return
    fetch('https://api.github.com/repos/' + GITHUB_REPO)
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json() })
      .then(function (data) {
        if (typeof data.stargazers_count === 'number') {
          host.textContent = formatStars(data.stargazers_count)
          host.parentElement.setAttribute('aria-label', 'GitHub 仓库 · ' + data.stargazers_count + ' stars')
          host.parentElement.title = 'GitHub 仓库 · ' + data.stargazers_count + ' stars'
        }
      })
      .catch(function () { host.textContent = '' })
  }

  // ---------- 匿名访问统计（PV） ----------
  // 仅上报随机访客 ID（localStorage 持久化）与当前路径，不含任何内容或身份信息。
  var VID_KEY = 'dsh-market-vid'
  function visitorId() {
    try {
      var vid = localStorage.getItem(VID_KEY)
      if (vid && /^[A-Za-z0-9_-]{16,64}$/.test(vid)) return vid
      vid = crypto.randomUUID().replace(/-/g, '')
      localStorage.setItem(VID_KEY, vid)
      return vid
    } catch (e) { return '' }
  }
  function sendPageview() {
    // Automated browsers (headless QA, webdriver-driven crawlers) never count.
    if (navigator.webdriver) return
    var vid = visitorId()
    if (!vid) return
    var payload = JSON.stringify({ kind: 'pageview', path: location.pathname + location.search, visitor: vid })
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/telemetry/event', new Blob([payload], { type: 'application/json' }))
        return
      }
    } catch (e) { }
    fetch('/api/telemetry/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(function () { })
  }

  function boot() {
    bind()
    renderAll()
    renderTurnstile()
    load()
    loadGitHubStars()
    sendPageview()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
