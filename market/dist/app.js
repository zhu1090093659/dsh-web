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
    var bgEnabled = !reduceMotion
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
        if (running || !bgEnabled || document.hidden || contextLost) return
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
      // 背景动效开关：关闭时停止 RAF（保留静态帧），恢复时重新绘制。
      window.marketWave = {
        setEnabled: function (on) {
          bgEnabled = !!on
          if (bgEnabled) { draw(); start() } else { stop() }
        },
      }
    }
  }

  // ====================================================================
  // 市场应用
  // ====================================================================
  var KINDS = ['skin', 'pet', 'plugin', 'preset']
  var KIND_LABEL = { picks: '编辑推荐', all: '探索', skin: '皮肤', pet: '宠物', plugin: '插件', preset: '预设' }
  var LIST_LABEL = { picks: '编辑推荐', all: '发现更多', skin: '皮肤画廊', pet: '桌面伙伴', plugin: '扩展你的工具', preset: '找到你的 Agent' }
  var KIND_ICON = { plugin: '</>', preset: 'Aa' }
  var CAT_LABEL = {
    agent: 'Agent', ui: '界面', tools: '工具', knowledge: '知识',
    integration: '集成', security: '安全', utility: '实用', other: '其他',
    // 预设分类（词表见 scripts/market-build 的 PRESET_CATEGORIES）。
    roleplay: '角色扮演'
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
  // 标签筛选只用带中文名的词条；皮肤 tag 与插件/预设分类共用同一行筛选。
  var TAG_LABEL = Object.assign({
    ocean: '海洋', whale: '鲸鱼', dark: '深色', light: '浅色', anime: '二次元',
    workflow: '工作流', coding: '编程', sprite2d: '像素伙伴', frames2d: '动态伙伴',
  }, CAT_LABEL, SUB_LABEL)

  var state = {
    kind: 'all',
    sort: 'popular',
    query: '',
    tag: 'all',
    cat: 'all',
    subcat: 'all',
    savedOnly: false,
    limit: 12,
    motionOn: true,
    item: null,
    data: { skin: [], pet: [], plugin: [], preset: [] },
    // 编辑推荐固定清单（{ kind, id } 引用），由 manifest/editor-picks.json 提供。
    picks: [],
    votes: { skin: {}, pet: {}, plugin: {}, preset: {} },
    installs: { skin: {}, pet: {}, plugin: {}, preset: {} },
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
  function entryOf(kind, item) { return { kind: kind, item: item } }
  function entryKey(kind, item) { return kind + ':' + item.id }

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

  // 我的收藏：仅存本机，不参与任何服务端统计。
  var SAVED_KEY = 'dsh-market-saved'
  var savedKeys = (function () {
    try {
      var arr = JSON.parse(window.localStorage.getItem(SAVED_KEY) || '[]')
      return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === 'string' }) : []
    } catch (e) { return [] }
  })()
  function persistSaved() {
    try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(savedKeys)) } catch (e) { }
  }
  function isSaved(kind, id) { return savedKeys.indexOf(kind + ':' + id) !== -1 }

  function votesFor(kind, id) { return (state.votes[kind] && state.votes[kind][id]) || 0 }
  function installsFor(kind, id) { return (state.installs[kind] && state.installs[kind][id]) || 0 }
  function npmDownloadsFor(item) { return (item.npm && state.npmDownloads[item.npm]) || null }
  function hasMyVote(kind, id) { return !!myVotes[kind + ':' + id] }
  function thumbSrc(kind, item) {
    if (kind === 'skin') return item.preview && item.preview.light
    if (kind === 'pet') return (item.previews && item.previews[0]) || item.spritesheet
    return ''
  }
  function tagsFor(entry) {
    var item = entry.item
    var out = Array.isArray(item.tags) ? item.tags.slice() : []
    if (item.category) out.push(item.category)
    if (item.subcategory) out.push(item.subcategory)
    return out
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
      safe(fetchJson('manifest/presets.json')).then(function (x) { state.data.preset = x ? x.items : [] }),
      safe(fetchJson('manifest/editor-picks.json')).then(function (x) { state.picks = (x && x.items) || [] }),
      safe(fetchJson('/api/stats')).then(function (s) {
        state.apiOk = !!s
        if (s && s.skin) state.votes = { skin: s.skin || {}, pet: s.pet || {}, plugin: s.plugin || {}, preset: s.preset || {} }
        if (s && s.installs) state.installs = { skin: s.installs.skin || {}, pet: s.installs.pet || {}, plugin: s.installs.plugin || {}, preset: s.installs.preset || {} }
      }),
      safe(fetchJson('/api/npm-downloads')).then(function (d) {
        state.npmDownloads = (d && d.downloads) || {}
      }),
    ]).then(function () {
      renderAll()
      openFromHash()
    })
  }

  // 编辑推荐：把固定引用解析成真实类别条目（保持清单顺序，丢弃重复 / 越界 / 解析不到的引用）。
  function pickEntries() {
    var out = [], seen = {}
    state.picks.forEach(function (pick) {
      var kind = pick && pick.kind, id = pick && pick.id
      if (kind !== 'skin' && kind !== 'pet' && kind !== 'plugin') return
      if (!id || seen[kind + ':' + id]) return
      var item = (state.data[kind] || []).filter(function (it) { return it.id === id })[0]
      if (!item) return
      seen[kind + ':' + id] = true
      out.push(entryOf(kind, item))
    })
    return out
  }
  function entriesOf(kind) {
    if (kind === 'picks') return pickEntries()
    return state.data[kind].map(function (it) { return entryOf(kind, it) })
  }
  function allEntries() {
    var out = []
    KINDS.forEach(function (k) { state.data[k].forEach(function (it) { out.push(entryOf(k, it)) }) })
    return out
  }
  function matchesQuery(entry, q) {
    var item = entry.item
    var parts = [item.name, item.nameEn, item.displayName, item.author,
      item.description, item.descriptionEn, item.tagline]
    if (Array.isArray(item.tags)) parts = parts.concat(item.tags)
    parts.push(CAT_LABEL[item.category] || '', SUB_LABEL[item.subcategory] || '')
    tagsFor(entry).forEach(function (t) { parts.push(TAG_LABEL[t] || '') })
    return parts.filter(Boolean).join(' ').toLowerCase().indexOf(q) !== -1
  }
  // baseEntries 只做「浏览上下文」过滤（分类 / 收藏 / 搜索），供标签计数使用。
  function baseEntries() {
    var list = state.kind === 'all' ? allEntries() : entriesOf(state.kind)
    var q = state.query.toLowerCase()
    return list.filter(function (entry) {
      if (state.savedOnly && !isSaved(entry.kind, entry.item.id)) return false
      if (q && !matchesQuery(entry, q)) return false
      return true
    })
  }
  function compareEntries(a, b) {
    var A = a.item, B = b.item
    if (state.sort === 'rank') return (A.rank || 999) - (B.rank || 999)
    if (state.sort === 'name') {
      return String(A.name || A.displayName || '').localeCompare(String(B.name || B.displayName || ''), 'zh-CN')
    }
    if (state.sort === 'installs') {
      var d = installsFor(b.kind, B.id) - installsFor(a.kind, A.id)
      if (d) return d
    }
    var va = votesFor(a.kind, A.id), vb = votesFor(b.kind, B.id)
    if (va !== vb) return vb - va
    return (A.rank || 999) - (B.rank || 999)
  }
  function visibleEntries() {
    var list = baseEntries()
    // 编辑推荐只固定展示清单本身：保持清单顺序，不做分类 / 标签筛选，也不参与排序。
    if (state.kind === 'picks') return list
    if (state.kind === 'plugin' || state.kind === 'preset') {
      if (state.cat !== 'all') list = list.filter(function (e) { return e.item.category === state.cat })
      if (state.subcat !== 'all') list = list.filter(function (e) { return e.item.subcategory === state.subcat })
    }
    if (state.tag !== 'all') list = list.filter(function (e) { return tagsFor(e).indexOf(state.tag) !== -1 })
    return list.sort(compareEntries)
  }

  function metricLabel(kind, item) {
    var installs = installsFor(kind, item.id)
    if (installs > 0) return installs + ' 次安装'
    var npm = npmDownloadsFor(item)
    if (npm !== null && npm !== undefined) return 'npm 近 30 天 ' + npm
    return ''
  }

  // ---------- 卡片 ----------
  function pictureButton(kind, item) {
    var media = el('button', 'picture')
    media.type = 'button'
    media.setAttribute('data-open', entryKey(kind, item))
    if (kind === 'pet') media.classList.add('mk-card-media-pet')
    var src = thumbSrc(kind, item)
    if (src) {
      var img = el('img')
      img.src = src
      img.alt = ''
      img.loading = 'lazy'
      media.appendChild(img)
    }
    if (kind !== 'pet') media.appendChild(el('span', 'preview-hint', '查看作品 ↗'))
    return media
  }
  function heartButton(kind, item) {
    var liked = hasMyVote(kind, item.id)
    var label = item.name || item.displayName || ''
    var b = el('button', 'like' + (liked ? ' is-liked' : ''))
    b.type = 'button'
    b.setAttribute('data-like', entryKey(kind, item))
    b.setAttribute('aria-pressed', String(liked))
    b.setAttribute('aria-label', (liked ? '取消点赞 ' : '点赞 ') + label)
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg><span></span>'
    b.querySelector('span').textContent = String(votesFor(kind, item.id))
    return b
  }
  function cardName(kind, item) {
    var text = item.name || item.displayName || ''
    // 皮肤、插件与预设都可回链源码仓库；宠物没有独立仓库，渲染为纯文本。
    var name
    if (kind !== 'pet' && item.repo) {
      name = el('a', 'mk-card-name', text)
      name.href = item.repo
      name.target = '_blank'
      name.rel = 'noopener'
    } else {
      name = el('div', 'mk-card-name', text)
    }
    return name
  }
  function renderCard(entry) {
    var kind = entry.kind, item = entry.item
    var card = el('article', 'card')
    if (kind === 'plugin' || kind === 'preset') {
      var body = el('button', 'picture card-text')
      body.type = 'button'
      body.setAttribute('data-open', entryKey(kind, item))
      body.appendChild(el('span', 'code-icon', KIND_ICON[kind] || 'Aa'))
      body.appendChild(el('span', 'category-label', CAT_LABEL[item.category] || KIND_LABEL[kind]))
      body.appendChild(el('p', null, item.description || item.descriptionEn || ''))
      card.appendChild(body)
    } else {
      card.appendChild(pictureButton(kind, item))
    }
    var info = el('div', 'info')
    var h3 = el('h3')
    h3.appendChild(cardName(kind, item))
    info.appendChild(h3)
    var sub = item.nameEn && item.nameEn !== item.name ? item.nameEn : (item.author || '')
    if (kind === 'plugin' || kind === 'preset') sub = item.author || CAT_LABEL[item.category] || ''
    info.appendChild(el('div', 'sub', sub))
    var meta = el('div', 'meta')
    meta.appendChild(el('span', null, metricLabel(kind, item)))
    meta.appendChild(heartButton(kind, item))
    info.appendChild(meta)
    card.appendChild(info)
    return card
  }

  // ---------- 人气推荐陈列 ----------
  function featureCard(item, main) {
    var card = el('article', 'feature ' + (main ? 'main-feature' : 'small-feature'))
    card.appendChild(pictureButton('skin', item))
    var bottom = el('div', 'feature-bottom')
    var left = el('div')
    if (main) {
      left.appendChild(el('div', 'label', '人气推荐'))
      left.appendChild(el('h2', null, item.name))
    } else {
      left.appendChild(el('h3', null, item.name))
    }
    left.appendChild(el('div', 'sub', item.nameEn || item.author || ''))
    bottom.appendChild(left)
    if (main) {
      var actions = el('div', 'feature-actions')
      var preview = el('button', 'primary', '预览作品 ↗')
      preview.type = 'button'
      preview.setAttribute('data-open', entryKey('skin', item))
      actions.appendChild(preview)
      actions.appendChild(heartButton('skin', item))
      bottom.appendChild(actions)
    } else {
      bottom.appendChild(heartButton('skin', item))
    }
    card.appendChild(bottom)
    return card
  }
  function renderShowcase() {
    var box = $('#showcase')
    box.innerHTML = ''
    var show = state.kind === 'all' && !state.query && !state.savedOnly
    box.hidden = !show
    if (!show) return
    var picks = state.data.skin.slice().sort(function (a, b) {
      var va = votesFor('skin', a.id), vb = votesFor('skin', b.id)
      if (va !== vb) return vb - va
      return (a.rank || 999) - (b.rank || 999)
    }).slice(0, 3)
    if (!picks.length) { box.hidden = true; return }
    box.appendChild(featureCard(picks[0], true))
    var side = el('div', 'side')
    picks.slice(1).forEach(function (item) { side.appendChild(featureCard(item, false)) })
    box.appendChild(side)
  }

  // ---------- 筛选 ----------
  function filterChip(label, selected, attr, value, sub) {
    var b = el('button', 'filter-chip' + (sub ? ' sub' : '') + (selected ? ' selected' : ''), label)
    b.type = 'button'
    b.setAttribute(attr, value)
    b.setAttribute('aria-pressed', String(!!selected))
    return b
  }
  function renderFilters() {
    var box = $('#filters')
    box.innerHTML = ''
    if (state.kind === 'picks') { state.tag = 'all'; return }
    if (state.kind === 'plugin' || state.kind === 'preset') {
      var items = state.data[state.kind]
      var cats = {}
      items.forEach(function (p) { var c = p.category || 'other'; cats[c] = (cats[c] || 0) + 1 })
      box.appendChild(filterChip('全部', state.cat === 'all', 'data-cat', 'all', false))
      Object.keys(cats).sort().forEach(function (c) {
        box.appendChild(filterChip(CAT_LABEL[c] || c, state.cat === c, 'data-cat', c, false))
      })
      if (state.cat === 'all') return
      var subs = {}
      items.forEach(function (p) {
        if (p.category !== state.cat || !p.subcategory) return
        subs[p.subcategory] = (subs[p.subcategory] || 0) + 1
      })
      var keys = (SUB_ORDER[state.cat] || []).filter(function (k) { return subs[k] })
      Object.keys(subs).sort().forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k) })
      if (keys.length) {
        var total = keys.reduce(function (n, k) { return n + subs[k] }, 0)
        box.appendChild(filterChip('全部', state.subcat === 'all', 'data-subcat', 'all', true))
        keys.forEach(function (k) {
          box.appendChild(filterChip(SUB_LABEL[k] || k, state.subcat === k, 'data-subcat', k, true))
        })
      }
      return
    }
    if (state.kind === 'all' && !state.query && !state.savedOnly) { state.tag = 'all'; return }
    var counts = {}
    baseEntries().forEach(function (e) {
      tagsFor(e).forEach(function (t) { counts[t] = (counts[t] || 0) + 1 })
    })
    var tagKeys = Object.keys(counts)
      .filter(function (t) { return TAG_LABEL[t] && counts[t] > 1 })
      .sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b) })
      .slice(0, 6)
    if (!tagKeys.length) { state.tag = 'all'; return }
    box.appendChild(filterChip('全部', state.tag === 'all', 'data-tag', 'all', false))
    tagKeys.forEach(function (t) {
      box.appendChild(filterChip(TAG_LABEL[t], state.tag === t, 'data-tag', t, false))
    })
  }

  // ---------- 列表 ----------
  function renderEmpty() {
    var box = el('div', 'empty')
    box.appendChild(el('div', 'empty-symbol', '⌕'))
    box.appendChild(el('h3', null, state.savedOnly ? '还没有匹配的收藏' : '没有找到这件灵感'))
    box.appendChild(el('p', null, state.savedOnly
      ? '打开作品详情，将喜欢的作品加入收藏。'
      : '试试作品名称、作者，或者换一个关键词。'))
    var reset = el('button', null, '浏览全部作品')
    reset.type = 'button'
    reset.setAttribute('data-reset', '')
    box.appendChild(reset)
    return box
  }
  function renderList() {
    var grid = $('#grid')
    grid.innerHTML = ''
    var list = visibleEntries()
    if (!list.length) {
      grid.appendChild(renderEmpty())
    } else {
      list.slice(0, state.limit).forEach(function (entry) { grid.appendChild(renderCard(entry)) })
    }
    $('#listTitle').textContent = state.savedOnly ? '我的收藏' : LIST_LABEL[state.kind]
    $('#count').textContent = list.length + ' 件作品'
    var more = $('#loadMore')
    more.innerHTML = ''
    if (list.length > state.limit) {
      var btn = el('button', 'secondary')
      btn.type = 'button'
      btn.id = 'more'
      btn.appendChild(document.createTextNode('探索更多作品'))
      btn.appendChild(el('span', null, state.limit + ' / ' + list.length))
      more.appendChild(btn)
    } else if (list.length) {
      more.appendChild(el('span', null, '你已经看完这些作品了'))
    }
  }
  function renderTabs() {
    document.querySelectorAll('nav [data-kind]').forEach(function (tab) {
      var on = tab.getAttribute('data-kind') === state.kind
      tab.classList.toggle('on', on)
      tab.setAttribute('aria-pressed', String(on))
    })
    var sort = $('#sort')
    // 编辑推荐的顺序由清单固定，排序下拉在该分区禁用。
    if (sort) { sort.value = state.sort; sort.disabled = state.kind === 'picks' }
    var saved = $('#savedFilter')
    if (saved) saved.setAttribute('aria-pressed', String(state.savedOnly))
  }
  function renderAll() {
    renderTabs()
    renderShowcase()
    renderFilters()
    renderList()
    $('#apiState').textContent = state.apiOk ? '' : '离线模式：点赞暂不可用'
    applyMotion()
  }

  // ---------- 点赞 ----------
  var likeSeq = {}
  function resyncDetail() {
    var dlg = $('#detail')
    if (dlg.open && state.item) openDetail(state.item.kind, state.item.id)
  }
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
    resyncDetail()
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
      resyncDetail()
    }).catch(function () {
      if (likeSeq[key] !== seq) return
      myVotes[key] = wasLiked
      saveMyVotes(myVotes)
      state.votes[kind][id] = prevVotes
      renderAll()
      resyncDetail()
      toast('点赞失败，请稍后再试')
    })
  }
  function toggleSave(kind, id) {
    var key = kind + ':' + id
    var idx = savedKeys.indexOf(key)
    if (idx === -1) savedKeys.push(key)
    else savedKeys.splice(idx, 1)
    persistSaved()
    renderList()
    resyncDetail()
    toast(idx === -1 ? '已加入我的收藏' : '已取消收藏')
  }

  // ---------- 详情弹层 ----------
  function openDetail(kind, id) {
    var item = null
    state.data[kind].forEach(function (it) { if (it.id === id) item = it })
    if (!item) return
    state.item = { kind: kind, id: id }
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
    var title = el('div', 'mk-dialog-title', item.name || item.displayName)
    title.id = 'detail-title'
    head.appendChild(title)
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
        var b = el('button', 'mk-skin-mode' + (theme === 'light' ? ' on' : ''), label)
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
        item.tags.forEach(function (t) { tags.appendChild(el('span', 'mk-tag', TAG_LABEL[t] || t)) })
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
    } else if (kind === 'preset') {
      // Preset detail is text only, exactly like a community plugin: no
      // artwork block, the author line opens the info column.
      var presetMeta = []
      presetMeta.push(CAT_LABEL[item.category] || item.category)
      if (item.author) presetMeta.push(item.author)
      if (item.version) presetMeta.push('v' + item.version)
      if (presetMeta.length) info.appendChild(el('div', 'mk-dialog-tagline', presetMeta.join(' · ')))
      if (item.description) info.appendChild(el('div', 'mk-dialog-text', item.description))
      if (item.descriptionEn) {
        var presetEn = el('div', 'mk-dialog-text')
        presetEn.style.marginTop = '8px'
        presetEn.textContent = item.descriptionEn
        info.appendChild(presetEn)
      }
      if (item.tags && item.tags.length) {
        var presetTags = el('div', 'mk-dialog-tags')
        item.tags.forEach(function (t) { presetTags.appendChild(el('span', 'mk-tag', TAG_LABEL[t] || t)) })
        info.appendChild(presetTags)
      }
      if (item.repo) {
        var presetSource = el('div', null)
        var presetRepo = el('a', null, '源码仓库')
        presetRepo.href = item.repo
        presetRepo.target = '_blank'
        presetRepo.rel = 'noopener'
        presetSource.appendChild(presetRepo)
        presetSource.style.marginTop = '10px'
        info.appendChild(presetSource)
      }
      var install4 = el('div', 'mk-install')
      install4.appendChild(el('div', 'mk-install-title', '安装方式'))
      var steps4 = el('ol', 'mk-install-steps')
      steps4.appendChild(el('li', null, '运行 dsh plugin --profile web add @linxin666/dsh-client-ui-preset-center'))
      steps4.appendChild(el('li', null, '在设置页创意工坊的预设分区安装并启用该预设；启用前不会出现在新会话的预设列表'))
      install4.appendChild(steps4)
      info.appendChild(install4)
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

    var actions = el('div', 'mk-dialog-actions')
    actions.appendChild(heartButton(kind, item))
    var saved = isSaved(kind, item.id)
    var saveBtn = el('button', 'secondary' + (saved ? ' is-saved' : ''), saved ? '已收藏' : '收藏作品')
    saveBtn.type = 'button'
    saveBtn.setAttribute('data-save', entryKey(kind, item))
    saveBtn.setAttribute('aria-pressed', String(saved))
    actions.appendChild(saveBtn)
    info.appendChild(actions)

    if (kind !== 'plugin' && kind !== 'preset') inner.appendChild(media)
    inner.appendChild(info)
    dlg.appendChild(close)
    dlg.appendChild(inner)
    if (!dlg.open) {
      if (dlg.showModal) dlg.showModal()
      else dlg.setAttribute('open', '')
    }
    history.replaceState(null, '', '#' + encodeURIComponent(kind + ':' + id))
  }
  function openFromHash() {
    var raw = ''
    try { raw = decodeURIComponent((location.hash || '').replace(/^#/, '')) } catch (e) { return }
    var parts = raw.split(':')
    if (parts.length !== 2 || KINDS.indexOf(parts[0]) === -1) return
    var kind = parts[0], id = parts[1]
    var found = state.data[kind].some(function (it) { return it.id === id })
    if (found) openDetail(kind, id)
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
    t.hidden = false
    t.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { t.classList.remove('show'); t.hidden = true }, 2200)
  }

  // ---------- 背景动效开关 ----------
  var reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  if (reduceQuery && reduceQuery.matches) state.motionOn = false
  function applyMotion() {
    var ocean = document.querySelector('.ocean')
    if (ocean) ocean.classList.toggle('paused', !state.motionOn)
    if (window.marketWave && window.marketWave.setEnabled) window.marketWave.setEnabled(state.motionOn)
    var btn = $('#motion')
    if (!btn) return
    var forced = !!(reduceQuery && reduceQuery.matches)
    btn.disabled = forced
    btn.setAttribute('aria-pressed', String(state.motionOn))
    btn.textContent = forced ? '背景动效：已遵循系统设置' : '背景动效：' + (state.motionOn ? '开启' : '关闭')
  }

  // ---------- 事件绑定 ----------
  function resetView() {
    state.kind = 'all'
    state.query = ''
    state.tag = 'all'
    state.cat = 'all'
    state.subcat = 'all'
    state.savedOnly = false
    state.limit = 12
    var search = $('#search')
    if (search) search.value = ''
    var dlg = $('#detail')
    if (dlg.open) dlg.close()
    renderAll()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function onDocumentClick(e) {
    var target = e.target
    if (!target || !target.closest) return
    var b = target.closest('button')
    if (!b) return
    if (b.dataset.open) { var p = b.dataset.open.split(':'); openDetail(p[0], p[1]); return }
    if (b.dataset.like) { var q = b.dataset.like.split(':'); toggleLike(q[0], q[1]); return }
    if (b.dataset.save) { var s = b.dataset.save.split(':'); toggleSave(s[0], s[1]); return }
    if (b.dataset.tag) { state.tag = b.dataset.tag; state.limit = 12; renderFilters(); renderList(); return }
    if (b.dataset.cat) { state.cat = b.dataset.cat; state.subcat = 'all'; state.limit = 12; renderFilters(); renderList(); return }
    if (b.dataset.subcat) { state.subcat = b.dataset.subcat; state.limit = 12; renderFilters(); renderList(); return }
    if (b.id === 'more') { state.limit += 12; renderList(); return }
    if (b.hasAttribute('data-reset')) { resetView(); return }
  }
  function bind() {
    document.querySelectorAll('nav [data-kind]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var kind = tab.getAttribute('data-kind')
        if (kind === state.kind) return
        state.kind = kind
        state.cat = 'all'
        state.subcat = 'all'
        state.tag = 'all'
        state.limit = 12
        renderAll()
      })
    })
    var brand = document.querySelector('.brand')
    if (brand) brand.addEventListener('click', function (e) { e.preventDefault(); resetView() })
    var search = $('#search')
    search.addEventListener('input', function () {
      state.query = search.value.trim()
      state.tag = 'all'
      state.limit = 12
      renderAll()
    })
    $('#sort').addEventListener('change', function (e) { state.sort = e.target.value; renderList() })
    $('#savedFilter').addEventListener('click', function () {
      state.savedOnly = !state.savedOnly
      state.tag = 'all'
      state.cat = 'all'
      state.subcat = 'all'
      state.limit = 12
      renderAll()
    })
    $('#motion').addEventListener('click', function () {
      if (reduceQuery && reduceQuery.matches) return
      state.motionOn = !state.motionOn
      applyMotion()
    })
    if (reduceQuery && reduceQuery.addEventListener) {
      reduceQuery.addEventListener('change', function (e) { state.motionOn = !e.matches; applyMotion() })
    }
    document.addEventListener('click', onDocumentClick)
    var dlg = $('#detail')
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close() })
    dlg.addEventListener('close', function () {
      dlg.innerHTML = ''
      state.item = null
      if (location.hash) history.replaceState(null, '', location.pathname + location.search)
    })
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
