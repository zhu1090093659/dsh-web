import {
  VIOLET_BACKGROUND,
  VIOLET_SHAKE_FLOW,
  VIOLET_SUBJECT,
  VIOLET_WATER_MASK,
} from './scene-art.ts'

const SCENE_WIDTH = 6208
const SCENE_HEIGHT = 3520
const SUBJECT_WIDTH = 2156
const SUBJECT_HEIGHT = 3291

const VERTEX_SHADER = `
attribute vec2 a_Position;
uniform vec2 u_Resolution;
uniform vec4 u_Rect;
varying vec2 v_Uv;
void main() {
  vec2 pixel = u_Rect.xy + a_Position * u_Rect.zw;
  vec2 clip = vec2(pixel.x / u_Resolution.x * 2.0 - 1.0, 1.0 - pixel.y / u_Resolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_Uv = a_Position;
}`

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_Uv;
uniform sampler2D u_Image;
uniform sampler2D u_WaterMask;
uniform sampler2D u_ShakeFlow;
uniform float u_Time;
uniform float u_Animate;
void main() {
  if (u_Animate > 1.5) {
    if (v_Uv.y > 0.335) discard;
    float columns = 28.0;
    float cell = fract(v_Uv.x * columns);
    float shade = mod(floor(v_Uv.x * columns), 4.0) * 0.018;
    vec3 warm = vec3(0.70, 0.64, 0.57);
    vec3 cool = vec3(0.54, 0.56, 0.58);
    vec3 stripe = mix(warm, cool, v_Uv.x) + shade;
    vec3 color = mix(stripe, vec3(0.95, 0.92, 0.80), step(0.93, cell));
    gl_FragColor = vec4(color, 0.82);
    return;
  }
  vec2 uv = v_Uv;
  if (u_Animate > 0.5) {
    vec2 direction = vec2(0.0174524, 0.9998477);
    float waveMask = texture2D(u_WaterMask, v_Uv).r;
    float distance = u_Time * 1.53 + dot(v_Uv, direction) * 20.33;
    vec2 waveOffset = sin(distance) * vec2(direction.y, -direction.x) * 0.0049 * waveMask;
    vec2 flow = (texture2D(u_ShakeFlow, v_Uv).rg - vec2(0.498)) * 2.0;
    vec2 shakeOffset = sin(u_Time) * 0.004225 * flow;
    uv += waveOffset + shakeOffset;
  }
  gl_FragColor = texture2D(u_Image, uv);
}`

const loadImage = async (source: string): Promise<HTMLImageElement> => await new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Failed to load Violet scene asset'))
  image.src = source
})

const compileShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Unable to create WebGL shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown shader error'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

const createProgram = (gl: WebGLRenderingContext): WebGLProgram => {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (!program) throw new Error('Unable to create WebGL program')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Unknown program error'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

const createTexture = (gl: WebGLRenderingContext, image: HTMLImageElement, unit: number): WebGLTexture => {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Unable to create WebGL texture')
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  return texture
}

/** Mount the extracted Wallpaper Engine scene without audio-responsive passes. */
export function mountVioletScene(body: HTMLElement): () => void {
  const wrapper = document.createElement('div')
  wrapper.className = 'dsh-violet-scene'
  wrapper.setAttribute('aria-hidden', 'true')
  const sceneCanvas = document.createElement('canvas')
  wrapper.append(sceneCanvas)
  body.prepend(wrapper)

  const gl = sceneCanvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true })
  if (!gl) {
    wrapper.remove()
    return () => undefined
  }

  let disposed = false
  let animationFrame = 0
  let width = 0
  let height = 0
  let ratio = 1
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const resize = (): void => {
    width = window.innerWidth
    height = window.innerHeight
    ratio = Math.min(window.devicePixelRatio || 1, 1.35)
    sceneCanvas.width = Math.round(width * ratio)
    sceneCanvas.height = Math.round(height * ratio)
    sceneCanvas.style.width = `${width}px`
    sceneCanvas.style.height = `${height}px`
  }

  resize()
  window.addEventListener('resize', resize)

  void Promise.all([
    loadImage(VIOLET_BACKGROUND),
    loadImage(VIOLET_SUBJECT),
    loadImage(VIOLET_WATER_MASK),
    loadImage(VIOLET_SHAKE_FLOW),
  ]).then(([background, subject, waterMask, shakeFlow]) => {
    if (disposed) return
    const program = createProgram(gl)
    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('Unable to create WebGL buffer')
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW)
    gl.useProgram(program)
    const position = gl.getAttribLocation(program, 'a_Position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const imageTexture = createTexture(gl, background, 0)
    const subjectTexture = createTexture(gl, subject, 1)
    const waterTexture = createTexture(gl, waterMask, 2)
    const shakeTexture = createTexture(gl, shakeFlow, 3)
    const resolutionLocation = gl.getUniformLocation(program, 'u_Resolution')
    const rectLocation = gl.getUniformLocation(program, 'u_Rect')
    const imageLocation = gl.getUniformLocation(program, 'u_Image')
    const waterLocation = gl.getUniformLocation(program, 'u_WaterMask')
    const shakeLocation = gl.getUniformLocation(program, 'u_ShakeFlow')
    const timeLocation = gl.getUniformLocation(program, 'u_Time')
    const animateLocation = gl.getUniformLocation(program, 'u_Animate')
    gl.uniform1i(waterLocation, 2)
    gl.uniform1i(shakeLocation, 3)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    const render = (now: number): void => {
      gl.viewport(0, 0, sceneCanvas.width, sceneCanvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const scale = Math.max(width / SCENE_WIDTH, height / SCENE_HEIGHT)
      const sceneX = (width - SCENE_WIDTH * scale) / 2
      const sceneY = (height - SCENE_HEIGHT * scale) / 2
      gl.uniform2f(resolutionLocation, width, height)
      gl.uniform1f(timeLocation, now / 1000)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, imageTexture)
      gl.uniform1i(imageLocation, 0)
      gl.uniform1f(animateLocation, 0)
      gl.uniform4f(rectLocation, sceneX, sceneY, SCENE_WIDTH * scale, SCENE_HEIGHT * scale)
      gl.drawArrays(gl.TRIANGLES, 0, 6)

      gl.uniform1f(animateLocation, 2)
      gl.uniform4f(rectLocation, 0, 0, width, height)
      gl.drawArrays(gl.TRIANGLES, 0, 6)

      const subjectHeight = height * 1.12
      const subjectWidth = subjectHeight * SUBJECT_WIDTH / SUBJECT_HEIGHT
      const subjectX = (width - subjectWidth) / 2
      const subjectY = height * 0.115
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, subjectTexture)
      gl.uniform1i(imageLocation, 0)
      gl.uniform1f(animateLocation, reducedMotion ? 0 : 1)
      gl.uniform4f(rectLocation, subjectX, subjectY, subjectWidth, subjectHeight)
      gl.drawArrays(gl.TRIANGLES, 0, 6)

      if (!document.hidden && !disposed) animationFrame = window.requestAnimationFrame(render)
    }

    const onVisibilityChange = (): void => {
      if (document.hidden) {
        window.cancelAnimationFrame(animationFrame)
        animationFrame = 0
      } else if (!animationFrame && !disposed) {
        animationFrame = window.requestAnimationFrame(render)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    animationFrame = window.requestAnimationFrame(render)

    wrapper.addEventListener('violet-dispose', () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      gl.deleteTexture(imageTexture)
      gl.deleteTexture(subjectTexture)
      gl.deleteTexture(waterTexture)
      gl.deleteTexture(shakeTexture)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }, { once: true })
  }).catch(() => {
    wrapper.remove()
  })

  return () => {
    disposed = true
    window.cancelAnimationFrame(animationFrame)
    window.removeEventListener('resize', resize)
    wrapper.dispatchEvent(new Event('violet-dispose'))
    wrapper.remove()
  }
}
