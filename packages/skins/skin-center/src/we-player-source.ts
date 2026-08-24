/**
 * @license MIT
 * Self-contained WebGL Scene Player runtime page for Wallpaper Engine scenes.
 * Renders 2D layered scenes, post-processing shaders (reflection, waterwaves,
 * foliagesway, tint), and GPU/CPU particle systems (shooting stars, fireflies).
 */

export const WE_SCENE_PLAYER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>Wallpaper Engine Scene Player</title>
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
  }
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<script>
(function() {
  'use strict';

  const canvas = document.getElementById('canvas');
  const gl = canvas.getContext('webgl', { alpha: true, depth: true, antialias: true, premultipliedAlpha: false }) ||
             canvas.getContext('experimental-webgl', { alpha: true, depth: true });
  if (!gl) return;

  let sceneData = null;
  let isPaused = false;
  let contextLost = false;
  let fitMode = 'cover';
  let startTime = performance.now();
  let lastTime = performance.now();
  let textureCache = new Map();
  let videoTextureCache = new Map();
  let activeParticles = [];
  let mouseX = 0.5, mouseY = 0.5;
  let curRotX = 0, curRotY = 0;

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX / window.innerWidth;
    mouseY = e.clientY / window.innerHeight;
  });

  // 3D Shaders
  const vs3D = \`
    attribute vec3 a_pos;
    attribute vec3 a_norm;
    attribute vec2 a_uv;
    attribute vec2 a_uv2;
    uniform mat4 u_proj;
    uniform mat4 u_view;
    uniform mat4 u_model;
    uniform mat3 u_normMat;
    uniform float u_time;
    uniform int u_isJet;
    uniform int u_isAurora;
    uniform int u_isThunder;
    uniform int u_isBg;
    uniform int u_isNeonSun;
    varying vec3 v_norm;
    varying vec3 v_worldPos;
    varying vec2 v_uv;
    varying vec2 v_uv2;
    varying vec4 v_uv4;
    varying float v_alpha;
    void main() {
      v_uv = a_uv;
      v_uv2 = a_uv2;
      v_uv4 = a_uv.xyxy;
      v_alpha = 1.0;
      vec3 pos = a_pos;
      // WE ricepodjet shader: flame pulse along the jet cone.
      if (u_isJet == 1) {
        float outside = step(0.5, a_uv.x);
        float pulseSpeed = 5.0 + outside * 10.0;
        float pulseAmount = 1.0 - a_uv.y;
        float pulseStrong = sin(u_time * pulseSpeed);
        pos.xy *= mix(1.0, pulseStrong * 0.05 + 1.0, pulseAmount);
        pos.z += pulseAmount * (cos(u_time * pulseSpeed) * 0.02 + 0.02);
        v_alpha = pulseStrong * 0.25 + 0.75;
      }
      // WE ricepodorbitalaurora: swaying curtain with scrolled multi-sample UVs.
      if (u_isAurora == 1) {
        pos.x += sin(0.1 * u_time + a_uv.x * 5.0) * 0.05;
        pos.y += sin(0.1 * u_time + a_uv.x * 3.0) * 0.02;
        v_uv4.xy = a_uv;
        v_uv4.x *= 5.7;
        v_uv4.x += fract(u_time * 0.05);
        v_uv4.zw = a_uv.xx;
        v_uv4.z *= 0.5;
        v_uv4.w *= 8.3;
        v_uv4.z += fract(u_time * 0.04);
        v_uv4.w -= fract(u_time * 0.03);
        v_alpha = smoothstep(0.0, 0.1, a_uv.x) * smoothstep(1.0, 0.9, a_uv.x) * 0.6;
      }
      // WE ricepodorbitalthunder: sparkle cells with drifting sample offsets.
      if (u_isThunder == 1) {
        v_uv4.xy = a_uv * 0.777;
        v_uv4.wz = a_uv * 0.3; // wz swizzle: w = x*0.3, z = y*0.3
        v_uv4.z += sin((1.7 + u_time) * 0.1);
        v_uv4.w += cos(u_time * 0.22);
      }
      // WE bg.vert: fullscreen background quad, position from UV directly.
      if (u_isBg == 1) {
        v_uv4 = vec4(a_uv + u_time * 0.03, a_uv.x * 2.0 - u_time * 0.0111, a_uv.y * 2.0 - u_time * 0.0111);
        gl_Position = vec4(a_uv * 2.0 - 1.0, 0.5, 1.0);
        return;
      }
      // WE neonsun.vert: procedural sun, uv remapped to a small disc space.
      if (u_isNeonSun == 1) {
        v_uv = (a_uv * 2.0 - 1.0) * 0.3;
      }
      vec4 worldPos = u_model * vec4(pos, 1.0);
      v_worldPos = worldPos.xyz;
      v_norm = normalize(u_normMat * a_norm);
      gl_Position = u_proj * u_view * worldPos;
    }
  \`;

  const fs3D = \`
    precision mediump float;
    varying vec3 v_norm;
    varying vec3 v_worldPos;
    varying vec2 v_uv;
    varying vec2 v_uv2;
    varying vec4 v_uv4;
    varying float v_alpha;
    uniform sampler2D u_tex;
    uniform int u_hasTex;
    uniform int u_isCarBody;
    uniform int u_isGlass;
    uniform int u_isDome;
    uniform int u_isShadow;
    uniform int u_isGrid;
    uniform int u_isSkybox;
    uniform int u_isSelfIllum;
    uniform highp int u_isJet;
    uniform highp int u_isAurora;
    uniform highp int u_isThunder;
    uniform highp int u_isBg;
    uniform highp int u_isNeonSun;
    uniform int u_gradFade;
    uniform int u_sceneStd;
    uniform vec3 u_jetPos[4];
    uniform int u_jetCount;
    uniform vec3 u_color;
    uniform vec3 u_paintColor;
    uniform vec3 u_stripeColor;
    uniform vec3 u_ambientColor;
    uniform vec3 u_cameraPos;
    uniform vec3 u_lightDir;
    uniform float u_specStrength;
    uniform float u_specPower;
    uniform highp float u_time;
    uniform int u_hasTint;
    uniform vec3 u_tint;
    uniform vec3 u_tint2;
    uniform sampler2D u_tex2;
    uniform sampler2D u_lightmap;
    uniform int u_hasLightmap;
    uniform vec3 u_lightPos[4];
    uniform vec4 u_lightColorRadius[4];
    uniform int u_lightCount;
    uniform vec3 u_skyLightColor;
    uniform sampler2D u_reflTex;
    uniform vec2 u_resolution;
    uniform int u_hasReflTex;
    void main() {
      // Skybox: textured background sphere (no lighting)
      if (u_isSkybox == 1) {
        vec3 col = u_hasTex == 1 ? texture2D(u_tex, v_uv).rgb : u_ambientColor * 0.5;
        gl_FragColor = vec4(col, 1.0);
        return;
      }
      // Dome: gradient sphere background (car scenes)
      if (u_isDome == 1) {
        vec3 tint = u_ambientColor;
        float h = normalize(v_worldPos).y * 0.5 + 0.5;
        vec3 col = mix(tint * 0.35, tint, h);
        gl_FragColor = vec4(col, 1.0);
        return;
      }
      // Shadow: smooth radial gradient under car
      if (u_isShadow == 1) {
        float d = length(v_worldPos.xz);
        float radial = 1.0 - smoothstep(0.0, 1.8, d);
        float yFade = pow(clamp(1.0 - v_uv.y, 0.0, 1.0), 1.5);
        float a = radial * yFade * 0.65;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a);
        return;
      }
      // Grid floor: screen-space reflection from FBO
      if (u_isGrid == 1) {
        vec3 norm = normalize(v_norm);
        vec3 lightDir = normalize(u_lightDir);
        vec3 viewDir = normalize(u_cameraPos - v_worldPos);
        // Base grid color
        vec3 gridColor = u_ambientColor * 0.6;
        // Screen-space reflection from the mirrored-camera FBO
        vec3 reflColor = vec3(0.0);
        if (u_hasReflTex == 1) {
          vec2 screenUV = gl_FragCoord.xy / u_resolution;
          reflColor = texture2D(u_reflTex, screenUV).rgb;
        }
        // Distance-based fade for reflection
        float dist = length(v_worldPos.xz);
        float fade = 1.0 - smoothstep(0.0, 3.5, dist);
        // Fresnel for reflectivity at grazing angles
        float fresnel = 1.0 - max(dot(norm, viewDir), 0.0);
        fresnel = pow(fresnel, 2.0);
        // Specular highlight
        vec3 halfDir = normalize(lightDir + viewDir);
        float gridSpec = pow(max(dot(norm, halfDir), 0.0), 100.0) * 0.2;
        // Mix reflection with base color
        float reflStrength = fade * 0.55 + fresnel * 0.3;
        vec3 result = mix(gridColor, reflColor, reflStrength) + gridSpec;
        float alpha = 0.9 * fade + 0.1;
        gl_FragColor = vec4(result, alpha);
        return;
      }
      // Self-illuminated: emissive glow (jet engines, taillights with selfillum combo)
      if (u_isSelfIllum == 1) {
        vec3 col = u_hasTex == 1 ? texture2D(u_tex, v_uv).rgb : u_color;
        if (u_hasTint == 1) {
          // WE tinted-glow shaders (technoglow): pow falloff, scheme-color
          // tint, gentle pulse.
          float pulse = sin(u_time) * 0.25 + 0.75;
          col = col * col * u_tint * 3.0 * pulse;
          gl_FragColor = vec4(col, u_hasTex == 1 ? texture2D(u_tex, v_uv).a : 1.0);
        } else {
          gl_FragColor = vec4(col * 1.5, 1.0);
        }
        return;
      }
      // WE neonsun fragment: procedural retrowave sun (gradient disc, scanline
      // cutouts, glow halo). u_tint = colorsuntop, u_tint2 = colorsunbottom.
      if (u_isNeonSun == 1) {
        float sunSize = 0.05;
        float sunSizeSqrt = sqrt(sunSize);
        float blendSunColor = (v_uv.y + sunSize * 2.5) / sunSizeSqrt;
        vec4 colorSun = vec4(mix(u_tint, u_tint2, blendSunColor), 0.0);
        float sunRadius = dot(v_uv.xy, v_uv.xy);
        colorSun.a = 1.0 - step(0.05, sunRadius);
        float glowAlpha = pow(smoothstep(0.08, 0.045, sunRadius), 2.0);
        float barPos = v_uv.y + 0.1;
        float sunCutOut = 1.0 - clamp(smoothstep(0.0, 0.005, barPos) * smoothstep(1.0 - barPos * 9.0, 1.0 - barPos * 8.0, sin(barPos * 200.0 + u_time)), 0.0, 1.0);
        float sunCutOutSmooth = 1.0 - clamp(smoothstep(0.0, 0.05, barPos) * smoothstep(-1.0 - barPos * 8.0, 1.0 - barPos * 8.0, sin(barPos * 200.0 + u_time)), 0.0, 1.0);
        vec3 rgb = mix(u_tint2, colorSun.rgb, colorSun.a * sunCutOut);
        float sunA = max(glowAlpha * sunCutOutSmooth, colorSun.a * sunCutOut);
        gl_FragColor = vec4(rgb, sunA);
        return;
      }
      // WE ricepodjet fragment: flame texture fades along uv.y with pulse alpha.
      if (u_isJet == 1) {
        vec3 col = u_hasTex == 1 ? texture2D(u_tex, v_uv).rgb : u_color;
        col *= v_uv.y * v_alpha;
        gl_FragColor = vec4(col, 1.0);
        return;
      }
      // WE bg fragment: fullscreen tinted clouds + pattern background.
      if (u_isBg == 1) {
        float clouds = texture2D(u_tex, v_uv4.xy).a * texture2D(u_tex, v_uv4.zw).a * 1.4;
        clouds = clouds * clouds;
        float vignette = smoothstep(1.2, 0.0, length(v_uv - 0.5)) * 2.0;
        float pattern = texture2D(u_tex2, v_uv * 50.0).a * 0.1;
        pattern *= smoothstep(0.1, 0.7, length(v_uv - 0.5));
        vec3 albedo = mix(u_tint, u_tint2, v_uv.y * v_uv.y) * (clouds + pattern) * vignette;
        float bgAlpha = 1.0;
        if (u_gradFade == 1) {
          bgAlpha = smoothstep(0.2, 0.45, abs(v_uv.y - 0.5));
        }
        gl_FragColor = vec4(albedo, bgAlpha);
        return;
      }
      // WE ricepodorbitalaurora fragment: layered scrolling aurora curtains.
      if (u_isAurora == 1) {
        vec3 color = texture2D(u_tex, v_uv4.xy).rgb;
        vec3 color2 = texture2D(u_tex, v_uv4.wy).rgb;
        vec3 blend = texture2D(u_tex, v_uv4.zy).rgb;
        color = mix(color * color2, blend, blend.r);
        gl_FragColor = vec4(color, v_alpha);
        return;
      }
      // WE ricepodorbitalthunder fragment: sparkling blue cells.
      if (u_isThunder == 1) {
        float amt = texture2D(u_tex, v_uv4.xy).r;
        amt *= texture2D(u_tex, v_uv4.zw).r;
        vec3 color = mix(vec3(0.6, 0.5, 0.4), vec3(0.1, 0.3, 1.0), amt);
        gl_FragColor = vec4(color, amt);
        return;
      }

      vec4 baseColor = u_hasTex == 1 ? texture2D(u_tex, v_uv) : vec4(u_color, 1.0);
      float alpha = 1.0;

      // Car body paintwork: mix(paintColor, stripesColor, R) * G
      if (u_isCarBody == 1 && u_hasTex == 1) {
        vec3 bodyColor = mix(u_paintColor, u_stripeColor, baseColor.r) * baseColor.g;
        baseColor = vec4(bodyColor, 1.0);
      } else if (u_isGlass == 1) {
        alpha = u_hasTex == 1 ? baseColor.a * 0.6 : 0.3;
        baseColor.rgb = u_hasTex == 1 ? baseColor.rgb : vec3(0.15, 0.2, 0.28);
      }

      vec3 norm = normalize(v_norm);
      vec3 lightDir = normalize(u_lightDir);
      vec3 viewDir = normalize(u_cameraPos - v_worldPos);
      vec3 halfDir = normalize(lightDir + viewDir);

      if (u_sceneStd == 1) {
        // Wallpaper Engine generic.frag: authored point lights, black-capable
        // ambient/skylight, and the first light attenuated by the baked map.
        vec3 lighting = u_ambientColor;
        vec3 specularResult = vec3(0.0);
        for (int li = 0; li < 4; li++) {
          if (li < u_lightCount) {
            vec3 delta = u_lightPos[li] - v_worldPos;
            float distanceToLight = length(delta);
            vec3 pointDir = delta / max(distanceToLight, 0.0001);
            float attenuation = clamp((u_lightColorRadius[li].w - distanceToLight) / u_lightColorRadius[li].w, 0.0, 1.0);
            vec3 pointColor = u_lightColorRadius[li].rgb;
            float diffuse = max(dot(norm, pointDir), 0.0) * attenuation * attenuation;
            vec3 diffuseLight = pointColor * diffuse;
            if (li == 0 && u_hasLightmap == 1) {
              diffuseLight *= texture2D(u_lightmap, v_uv2).rgb;
            }
            lighting += diffuseLight;
            vec3 pointHalf = normalize(pointDir + viewDir);
            specularResult += pointColor * pow(max(dot(norm, pointHalf), 0.0), u_specPower) * u_specStrength * attenuation;
          }
        }
        lighting += max(dot(norm, vec3(0.0, -1.0, 0.0)), 0.0) * u_skyLightColor;
        float boostAmt = 0.0;
        for (int i = 0; i < 4; i++) {
          if (i < u_jetCount) {
            boostAmt += 1.0 - min(1.0, 2.0 * length(u_jetPos[i] - v_worldPos));
          }
        }
        vec3 boost = vec3(3.0, 1.2, 0.2) * boostAmt;
        gl_FragColor = vec4(baseColor.rgb * (lighting + boost) + specularResult, alpha);
        return;
      }

      // Key light (squared falloff for car, linear for generic)
      float NdotL = max(dot(norm, lightDir), 0.0);
      float lighting = u_isCarBody == 1 ? NdotL * NdotL * 0.9 : NdotL * 1.1;

      // Fill light from opposite side
      vec3 fillDir = normalize(vec3(-lightDir.x, 0.3, -lightDir.z));
      float fillNdotL = max(dot(norm, fillDir), 0.0);
      lighting += fillNdotL * 0.25;

      // Sky light from below for generic scenes
      float skyLight = max(dot(norm, vec3(0.0, -1.0, 0.0)), 0.0);
      lighting += skyLight * 0.15;

      // Rim light
      float rim = 1.0 - max(dot(norm, viewDir), 0.0);
      rim = pow(rim, 3.0) * 0.3;

      // Specular
      float specBase = max(dot(halfDir, norm), 0.0);
      float spec = pow(specBase, u_specPower);
      if (u_isCarBody == 1) {
        spec = spec * smoothstep(0.0, 0.1, sin(spec * 12.0));
      }
      float specular = spec * u_specStrength;

      // Ricepod shader: specular += pow(specBase, 25 + 100 * smoothstep(0.3, 0.15, color.r)) * 2
      // Generic scenes get extra specular for metallic look
      if (u_isCarBody == 0 && u_isGlass == 0) {
        float extraSpec = pow(specBase, 25.0 + 100.0 * smoothstep(0.3, 0.15, baseColor.r)) * 2.0;
        specular += extraSpec * u_specStrength;
      }

      vec3 result = (u_ambientColor * 0.5 + lighting) * baseColor.rgb + specular + rim * u_ambientColor * 0.5;

      gl_FragColor = vec4(result, alpha);
    }
  \`;

  // Vertex shader for basic 2D quads
  const vsBasic = \`
    attribute vec2 a_pos;
    attribute vec2 a_uv;
    uniform mat4 u_proj;
    uniform mat4 u_model;
    uniform vec4 u_uvRect;
    varying vec2 v_uv;
    void main() {
      v_uv = u_uvRect.xy + a_uv * (u_uvRect.zw - u_uvRect.xy);
      gl_Position = u_proj * u_model * vec4(a_pos, 0.0, 1.0);
    }
  \`;

  // Fragment shader for standard textures
  const fsBasic = \`
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform float u_alpha;
    uniform vec3 u_tint;
    uniform float u_bright;
    uniform float u_power;
    void main() {
      vec4 col = texture2D(u_tex, v_uv);
      col.rgb *= u_tint;
      col.rgb *= u_bright;
      col.rgb = pow(col.rgb, vec3(u_power));
      col.a *= u_alpha;
      gl_FragColor = col;
    }
  \`;

  // Fragment shader for water reflection
  const fsReflection = \`
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_fbo;
    uniform sampler2D u_mask;
    uniform float u_time;
    uniform float u_alpha;
    // Scene-uv rect of the reflection quad: (leftU, topV, scaleU, scaleV);
    // (0,0,1,1) for a fullscreen layer. Scene v grows downward (0 at the top).
    uniform vec4 u_rect;
    // Data-driven water surface from the scene object (legacy default 0.65).
    uniform float u_waterLine;
    // Reflection sample window: start + puddleDepth * span (legacy 0.42/0.38).
    uniform vec2 u_reflectRange;
    void main() {
      float mask = texture2D(u_mask, v_uv).r;
      vec2 sceneUv = u_rect.xy + v_uv * u_rect.zw;
      if (mask < 0.05 || sceneUv.y < u_waterLine) {
        discard;
      }
      float puddleDepth = (sceneUv.y - u_waterLine) / max(1.0 - u_waterLine, 0.0001);
      vec2 uvReflect = vec2(sceneUv.x, u_reflectRange.x + puddleDepth * u_reflectRange.y);
      // water wave ripple perturbation
      float wave = sin(v_uv.y * 120.0 + u_time * 2.8) * 0.002 +
                   cos(v_uv.x * 90.0 + u_time * 1.9) * 0.0015;
      uvReflect.x += wave * mask;
      uvReflect.y += wave * mask;
      vec4 reflected = texture2D(u_fbo, clamp(uvReflect, 0.0, 1.0));
      reflected.rgb *= vec3(0.70, 0.75, 0.90);
      gl_FragColor = vec4(reflected.rgb, mask * u_alpha * 0.28);
    }
  \`;

  // WE flag shader (TINT combo): rippling cloth via two scrolling normal
  // samples, region colors remapped through texture channels.
  const fsFlag = \`
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform sampler2D u_normal;
    uniform sampler2D u_cloth;
    uniform float u_time;
    uniform float u_speed;
    uniform float u_strength;
    uniform vec3 u_color1;
    uniform vec3 u_color2;
    uniform vec3 u_color3;
    void main() {
      vec2 nc1 = v_uv * vec2(1.0, 0.3) * 0.7;
      nc1.x -= u_time * u_speed;
      nc1.x -= ((0.5 - v_uv.x) * (1.0 - v_uv.y)) * 3.0;
      nc1.x += 2.0 * pow(v_uv.y - 0.1, 3.0) * pow(v_uv.x, 2.0);
      vec2 nc2 = v_uv * vec2(1.0, 0.7) * 0.3;
      nc2.x -= u_time * u_speed * 0.5;
      nc2.x -= ((1.0 - v_uv.x) * (1.0 - v_uv.y)) * 2.0;
      vec3 normal = texture2D(u_normal, nc1).rgb * 2.0 - 1.0;
      normal *= texture2D(u_normal, nc2).rgb * 2.0 - 1.0;
      normal = mix(vec3(0.0, 0.0, 1.0), normal, u_strength);
      normal = normalize(normal);
      vec2 baseCoords = v_uv + normal.xy * 0.02;
      vec3 albedo = texture2D(u_tex, baseCoords).rgb;
      float cloth = texture2D(u_cloth, baseCoords * 4.0).r;
      vec3 color = mix(u_color1, u_color2, albedo.r);
      color = mix(color, u_color3, albedo.g);
      color *= albedo.b * cloth;
      color += cloth * 0.1;
      float light = 0.2 + dot(vec3(0.707, 0.707, 0.0), normal) * 0.5 + 0.5;
      light += pow(light, 5.0) * 0.5;
      color *= light + light * clamp(cloth * 2.0 - 1.0, 0.0, 1.0);
      gl_FragColor = vec4(color, 1.0);
    }
  \`;

  // Fragment shader for particles
  const fsParticle = \`
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform vec4 u_color;
    void main() {
      vec4 tex = texture2D(u_tex, v_uv);
      gl_FragColor = tex * u_color;
    }
  \`;

  // WE flowimage shader: 3 content layers cross-faded while their UVs drift
  // along the flow mask (deep_space nebula background).
  const fsFlow = \`
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_mask;
    uniform sampler2D u_l1;
    uniform sampler2D u_l2;
    uniform sampler2D u_l3;
    uniform float u_time;
    uniform vec3 u_speeds;
    uniform float u_amp;
    uniform float u_bright;
    void main() {
      vec3 flowColors = texture2D(u_mask, v_uv).rgb;
      vec2 flowMask = (flowColors.rg - vec2(0.5, 0.5)) * 2.0;
      float c0 = fract(u_time * u_speeds.x);
      float c0b = fract(u_time * u_speeds.x + 0.5);
      float c1 = fract(u_time * u_speeds.y);
      float c1b = fract(u_time * u_speeds.y + 0.5);
      float c2 = fract(u_time * u_speeds.z);
      float c2b = fract(u_time * u_speeds.z + 0.5);
      float b0 = 2.0 * abs(c0 - 0.5);
      float b1 = 2.0 * abs(c1 - 0.5);
      float b2 = 2.0 * abs(c2 - 0.5);
      vec2 cuv = v_uv;
      vec4 albedo = mix(texture2D(u_l1, cuv + flowMask * u_amp * 0.1 * c0),
                        texture2D(u_l1, cuv + flowMask * u_amp * 0.1 * c0b), b0);
      vec4 s1 = mix(texture2D(u_l2, cuv + flowMask * u_amp * 0.1 * c1),
                    texture2D(u_l2, cuv + flowMask * u_amp * 0.1 * c1b), b1);
      albedo.rgb = mix(albedo.rgb, s1.rgb, s1.a);
      albedo.a = max(albedo.a, s1.a);
      vec4 s2 = mix(texture2D(u_l3, cuv + flowMask * u_amp * 0.1 * c2),
                    texture2D(u_l3, cuv + flowMask * u_amp * 0.1 * c2b), b2);
      albedo.rgb = mix(albedo.rgb, s2.rgb, s2.a);
      albedo.a = max(albedo.a, s2.a);
      albedo.rgb *= u_bright;
      gl_FragColor = albedo;
    }
  \`;

  function createShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('we-scene-player shader compile failed:', gl.getShaderInfoLog(s));
    }
    return s;
  }

  function createProgram(vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, createShader(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, createShader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('we-scene-player program link failed:', gl.getProgramInfoLog(p));
    }
    return p;
  }

  const progBasic = createProgram(vsBasic, fsBasic);
  const progReflection = createProgram(vsBasic, fsReflection);
  const progParticle = createProgram(vsBasic, fsParticle);
  const progFlow = createProgram(vsBasic, fsFlow);
  const progFlag = createProgram(vsBasic, fsFlag);
  const prog3D = createProgram(vs3D, fs3D);

  // Camera-facing 3D billboard (sun sprites, 3D particle streaks). The quad is
  // offset in view space along two CPU-computed axes so streaks can stretch
  // along the velocity direction (WE spritetrail renderer).
  const vsSprite = \`
    attribute vec2 a_corner;
    attribute vec2 a_uv;
    uniform mat4 u_proj;
    uniform mat4 u_view;
    uniform vec3 u_center;
    uniform vec2 u_axisX;
    uniform vec2 u_axisY;
    varying vec2 v_uv;
    void main() {
      v_uv = a_uv;
      vec4 centerView = u_view * vec4(u_center, 1.0);
      gl_Position = u_proj * vec4(centerView.xy + a_corner.x * u_axisX + a_corner.y * u_axisY, centerView.zw);
    }
  \`;
  const fsSprite = \`
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform int u_hasTex;
    uniform vec4 u_color;
    void main() {
      vec4 t = u_hasTex == 1 ? texture2D(u_tex, v_uv) : vec4(1.0);
      gl_FragColor = vec4(t.rgb * u_color.rgb, t.a * u_color.a);
    }
  \`;
  const progSprite = createProgram(vsSprite, fsSprite);

  // WE neongrid shader: procedural scrolling retrowave grid with fbm mountains.
  // Needs OES_standard_derivatives for the screen-space normal.
  const derivExt = gl.getExtension('OES_standard_derivatives');
  const vsNeonGrid = \`
    attribute vec3 a_pos;
    attribute vec2 a_uv;
    uniform mat4 u_proj;
    uniform mat4 u_view;
    uniform mat4 u_model;
    uniform float u_time;
    uniform float u_mountainScale;
    varying vec4 v_tc;
    varying vec4 v_vars;
    varying vec3 v_pos;
    float rand2(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }
    float noise2(vec2 p) {
      vec2 ip = floor(p);
      vec2 u = fract(p);
      u = u * u * (3.0 - 2.0 * u);
      float res = mix(mix(rand2(ip), rand2(ip + vec2(1.0, 0.0)), u.x), mix(rand2(ip + vec2(0.0, 1.0)), rand2(ip + vec2(1.0, 1.0)), u.x), u.y);
      return res * res;
    }
    float fbm(vec2 x) {
      float v = 0.0;
      float a = 0.5;
      vec2 shift = vec2(100.0);
      mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
      for (int i = 0; i < 5; ++i) {
        v += a * noise2(x);
        x = x * rot * 2.0 + shift;
        a *= 0.5;
      }
      return v;
    }
    void main() {
      v_vars = vec4(0.0);
      float speed = u_time * 2.0;
      vec3 localPos = a_pos;
      vec2 gridPos = floor(a_uv * 50.0 + vec2(0.0, speed));
      float dampenDistance = abs(a_uv.x * 2.0 - 1.0);
      float fallOffSides = pow(1.05 - dampenDistance, 0.5);
      float fallOffCenter = (0.2 + 0.8 * pow(dampenDistance, 2.0));
      float speedFrac = fract(speed) / 50.0;
      v_vars.x = a_uv.y - speedFrac;
      float dampenY = a_uv.y - speedFrac;
      float clipCenter = clamp(0.8 - dampenDistance, 0.0, 1.0);
      float offsetY = max(0.0, fbm(gridPos * 0.1) * 2.0 - clipCenter) * fallOffCenter * u_mountainScale;
      float maskUVSmoothing = step(0.005, offsetY);
      offsetY = offsetY * fallOffSides * dampenY + pow(dampenDistance, 2.0) * 0.02;
      localPos.z -= speedFrac * 2.0;
      localPos.y += offsetY;
      vec4 worldPos = u_model * vec4(localPos, 1.0);
      v_pos = worldPos.xyz;
      gl_Position = u_proj * u_view * worldPos;
      v_tc.xy = a_uv;
      v_tc.zw = a_uv * 50.0;
      float dampenUVSmoothing = clamp(abs(a_uv.x - 0.5) * 2.0 + maskUVSmoothing, 0.0, 1.0);
      v_vars.yz = vec2(0.45) - v_tc.y * vec2(0.05, 0.75 - dampenUVSmoothing * 0.7);
    }
  \`;
  const fsNeonGrid = (derivExt ? '#extension GL_OES_standard_derivatives : enable\\n' : '') + \`
    precision mediump float;
    varying vec4 v_tc;
    varying vec4 v_vars;
    varying vec3 v_pos;
    uniform vec3 u_gridNear;
    uniform vec3 u_gridFar;
    uniform vec3 u_gridBg;
    void main() {
      vec3 n = vec3(0.0, 1.0, 0.0);
      #ifdef GL_OES_standard_derivatives
      vec3 dx = dFdx(v_pos);
      vec3 dy = dFdy(v_pos);
      n = normalize(cross(dy, dx));
      #endif
      vec3 lightDir = normalize(vec3(0.0, -0.15, -2.0) - v_pos);
      vec2 grid = abs(fract(v_tc.zw) - 0.5);
      vec2 gridBlend = smoothstep(v_vars.yz, vec2(0.5), grid);
      float gridAlpha = gridBlend.x + gridBlend.y;
      gridBlend = smoothstep(vec2(0.0), vec2(1.0), grid);
      gridAlpha += (gridBlend.x + gridBlend.y) * clamp(0.3 - v_tc.y, 0.0, 1.0);
      float alphaDistanceFade = smoothstep(1.0, 0.9, v_vars.x);
      float colorDistanceBlend = pow(v_tc.y, 0.8);
      float shadingNear = dot(vec3(0.0, 0.0, 1.0), n);
      float shadingFar = dot(lightDir, n);
      vec3 shadingColor = clamp(shadingNear, 0.0, 1.0) * u_gridNear * (1.0 - colorDistanceBlend)
                        + clamp(shadingFar, 0.0, 1.0) * u_gridFar;
      vec3 colorGrid = u_gridBg + shadingColor;
      vec3 resultColor = mix(colorGrid, mix(u_gridNear, u_gridFar, colorDistanceBlend), gridAlpha * alphaDistanceFade);
      gl_FragColor = vec4(resultColor, alphaDistanceFade);
    }
  \`;
  const progNeonGrid = createProgram(vsNeonGrid, fsNeonGrid);

  function drawNeonGrid(model, mesh, proj, view, elapsed) {
    const uc = mesh.userColors || {};
    const un = mesh.userNums || {};
    gl.useProgram(progNeonGrid);
    gl.uniformMatrix4fv(gl.getUniformLocation(progNeonGrid, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(progNeonGrid, 'u_view'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(progNeonGrid, 'u_model'), false, mat4Transform3D(model.origin, model.angles, model.scale));
    gl.uniform1f(gl.getUniformLocation(progNeonGrid, 'u_time'), elapsed);
    gl.uniform1f(gl.getUniformLocation(progNeonGrid, 'u_mountainScale'), un.mountainscale != null ? un.mountainscale : 1);
    const near = uc.gridnear || [1, 0, 0.2];
    const far = uc.gridfar || [0, 0, 1];
    const bgc = uc.gridbackground || [0.1, 0, 0.1];
    gl.uniform3f(gl.getUniformLocation(progNeonGrid, 'u_gridNear'), near[0], near[1], near[2]);
    gl.uniform3f(gl.getUniformLocation(progNeonGrid, 'u_gridFar'), far[0], far[1], far[2]);
    gl.uniform3f(gl.getUniformLocation(progNeonGrid, 'u_gridBg'), bgc[0], bgc[1], bgc[2]);
    const gpu = getGpuMesh(mesh);
    const gPos = gl.getAttribLocation(progNeonGrid, 'a_pos');
    const gUv = gl.getAttribLocation(progNeonGrid, 'a_uv');
    gl.enableVertexAttribArray(gPos);
    gl.enableVertexAttribArray(gUv);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
    gl.vertexAttribPointer(gPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uvBuf);
    gl.vertexAttribPointer(gUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.idxBuf);
    gl.drawElements(gl.TRIANGLES, gpu.iCount, gpu.idxType, 0);
  }

  // WE cloudsbg shader: fullscreen scrolling clouds + horizon glow.
  const vsCloudsBg = \`
    attribute vec2 a_corner;
    attribute vec2 a_uv;
    uniform float u_time;
    uniform float u_aspect;
    varying vec2 v_uv;
    varying vec4 v_tcClouds;
    void main() {
      gl_Position = vec4(a_corner * 2.0, 0.0, 1.0);
      v_uv = a_uv;
      v_tcClouds.xy = (a_uv + u_time * 0.0007) * vec2(1.1, 1.1);
      v_tcClouds.zw = (a_uv - u_time * 0.0011) * vec2(0.7, 0.7);
      v_tcClouds.xz *= u_aspect;
      v_tcClouds.zw = vec2(-v_tcClouds.w, v_tcClouds.z);
    }
  \`;
  const fsCloudsBg = \`
    precision mediump float;
    varying vec2 v_uv;
    varying vec4 v_tcClouds;
    uniform sampler2D u_tex;
    uniform int u_hasTex;
    uniform vec3 u_color1;
    uniform vec3 u_colorHorizon;
    void main() {
      float cloud0 = u_hasTex == 1 ? texture2D(u_tex, v_tcClouds.xy).r : 0.0;
      float cloud1 = u_hasTex == 1 ? texture2D(u_tex, v_tcClouds.zw).r : 0.0;
      float cloudBlend = cloud0 * cloud1;
      vec3 albedo = u_color1 * cloudBlend;
      albedo += (u_color1 * 0.5 + albedo) * pow(smoothstep(0.5, 0.0, v_uv.y), 2.0) * 2.0;
      float horizonBend = 1.0 - cos(clamp(v_uv.x * 2.0 - 0.5, 0.0, 1.0) * 2.0 * 3.14159265);
      vec2 horizonDelta = (v_uv - vec2(0.5, 0.6)) * vec2(0.5, 1.5 - horizonBend * 0.3);
      albedo += u_colorHorizon * pow(smoothstep(0.5, 0.0, length(horizonDelta)), 2.0) * 2.0;
      gl_FragColor = vec4(albedo, 1.0);
    }
  \`;
  const progCloudsBg = createProgram(vsCloudsBg, fsCloudsBg);

  function drawCloudsBgLayer(layer, elapsed, width, height) {
    gl.useProgram(progCloudsBg);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
    const cPos = gl.getAttribLocation(progCloudsBg, 'a_corner');
    const cUv = gl.getAttribLocation(progCloudsBg, 'a_uv');
    gl.enableVertexAttribArray(cPos);
    gl.enableVertexAttribArray(cUv);
    gl.vertexAttribPointer(cPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(cUv, 2, gl.FLOAT, false, 16, 8);
    gl.uniform1f(gl.getUniformLocation(progCloudsBg, 'u_time'), elapsed);
    gl.uniform1f(gl.getUniformLocation(progCloudsBg, 'u_aspect'), width / Math.max(height, 1));
    const uc = layer.userColors || {};
    const c1 = uc.clouds || [0.05, 0.15, 0.4];
    const ch = uc.horizon || [0.05, 0.15, 0.4];
    gl.uniform3f(gl.getUniformLocation(progCloudsBg, 'u_color1'), c1[0], c1[1], c1[2]);
    gl.uniform3f(gl.getUniformLocation(progCloudsBg, 'u_colorHorizon'), ch[0], ch[1], ch[2]);
    if (layer.texUrl) {
      const texRec = loadTexture(layer.texUrl, true);
      if (texRec.loaded) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texRec.texture);
        gl.uniform1i(gl.getUniformLocation(progCloudsBg, 'u_tex'), 0);
        gl.uniform1i(gl.getUniformLocation(progCloudsBg, 'u_hasTex'), 1);
      } else {
        gl.uniform1i(gl.getUniformLocation(progCloudsBg, 'u_hasTex'), 0);
      }
    } else {
      gl.uniform1i(gl.getUniformLocation(progCloudsBg, 'u_hasTex'), 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  const spriteBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -0.5, -0.5, 0.0, 0.0,
     0.5, -0.5, 1.0, 0.0,
    -0.5,  0.5, 0.0, 1.0,
     0.5,  0.5, 1.0, 1.0,
  ]), gl.STATIC_DRAW);

  function drawBillboard(center, axisX, axisY, texUrl, color, proj, view) {
    gl.useProgram(progSprite);
    gl.uniformMatrix4fv(gl.getUniformLocation(progSprite, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(progSprite, 'u_view'), false, view);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
    const cPos = gl.getAttribLocation(progSprite, 'a_corner');
    const cUv = gl.getAttribLocation(progSprite, 'a_uv');
    gl.enableVertexAttribArray(cPos);
    gl.enableVertexAttribArray(cUv);
    gl.vertexAttribPointer(cPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(cUv, 2, gl.FLOAT, false, 16, 8);
    gl.uniform3f(gl.getUniformLocation(progSprite, 'u_center'), center[0], center[1], center[2]);
    gl.uniform2f(gl.getUniformLocation(progSprite, 'u_axisX'), axisX[0], axisX[1]);
    gl.uniform2f(gl.getUniformLocation(progSprite, 'u_axisY'), axisY[0], axisY[1]);
    gl.uniform4f(gl.getUniformLocation(progSprite, 'u_color'), color[0], color[1], color[2], color[3]);
    if (texUrl) {
      const texRec = loadTexture(texUrl);
      if (texRec.loaded) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texRec.texture);
        gl.uniform1i(gl.getUniformLocation(progSprite, 'u_tex'), 0);
        gl.uniform1i(gl.getUniformLocation(progSprite, 'u_hasTex'), 1);
      } else {
        gl.uniform1i(gl.getUniformLocation(progSprite, 'u_hasTex'), 0);
      }
    } else {
      gl.uniform1i(gl.getUniformLocation(progSprite, 'u_hasTex'), 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // 3D particle system state, seeded from manifest.particles3d
  const particles3dState = new Map();
  function getParticles3d(sys) {
    if (!particles3dState.has(sys)) particles3dState.set(sys, { list: [], acc: 0 });
    return particles3dState.get(sys);
  }
  function updateParticles3d(sys, dt) {
    const st = getParticles3d(sys);
    st.acc += sys.rate * dt;
    while (st.acc >= 1 && st.list.length < sys.maxCount) {
      st.acc -= 1;
      // Random point on a sphere shell around the emitter origin.
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const r = sys.distMin + Math.random() * (sys.distMax - sys.distMin);
      const lerp = (a, b) => a + Math.random() * (b - a);
      st.list.push({
        x: sys.origin[0] + r * Math.sin(ph) * Math.cos(th),
        y: sys.origin[1] + r * Math.sin(ph) * Math.sin(th),
        z: sys.origin[2] + r * Math.cos(ph),
        vx: lerp(sys.velMin[0], sys.velMax[0]),
        vy: lerp(sys.velMin[1], sys.velMax[1]),
        vz: lerp(sys.velMin[2], sys.velMax[2]),
        size: lerp(sys.sizeMin, sys.sizeMax),
        life: 0,
        maxLife: lerp(sys.lifeMin, sys.lifeMax),
        color: [lerp(sys.colorMin[0], sys.colorMax[0]), lerp(sys.colorMin[1], sys.colorMax[1]), lerp(sys.colorMin[2], sys.colorMax[2])],
      });
    }
    st.acc = Math.min(st.acc, 4);
    for (let i = st.list.length - 1; i >= 0; i--) {
      const p = st.list[i];
      p.life += dt;
      if (p.life >= p.maxLife) { st.list.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
  }

  // Shared unit quad geometry (-0.5 to 0.5)
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -0.5, -0.5, 0.0, 1.0,
     0.5, -0.5, 1.0, 1.0,
    -0.5,  0.5, 0.0, 0.0,
     0.5,  0.5, 1.0, 0.0,
  ]), gl.STATIC_DRAW);

  function loadTexture(url, repeat) {
    const key = repeat ? url + '|repeat' : url;
    if (textureCache.has(key)) return textureCache.get(key);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,0]));
    const record = { texture: tex, loaded: false, width: 1, height: 1 };
    textureCache.set(key, record);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      record.loaded = true;
      record.width = img.width;
      record.height = img.height;
    };
    img.src = url;
    return record;
  }

  function activeTimePeriod(schedule, date) {
    if (!schedule) return null;
    const hour = date.getHours() + date.getMinutes() / 60;
    if (hour >= schedule.morning && hour < schedule.day) return 'morning';
    if (hour >= schedule.day && hour < schedule.dusk) return 'day';
    if (hour >= schedule.dusk && hour < schedule.night) return 'dusk';
    return 'night';
  }

  function layerEnabledByTime(layer, period) {
    return !layer.timePeriod || layer.timePeriod === period || (layer.timePeriod === 'manual' && period === null);
  }

  function loadVideoTexture(layer, enabled) {
    let record = videoTextureCache.get(layer.videoUrl);
    if (!record) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,0]));
      const video = document.createElement('video');
      // The player iframe is sandboxed without allow-same-origin, so every
      // texture load is a cross-origin fetch from an opaque origin. Without
      // CORS mode the video taints the WebGL texture and texImage2D throws a
      // SecurityError, leaving the canvas blank (the scene-resource route
      // answers Origin: null with access-control-allow-origin: null).
      video.crossOrigin = 'anonymous';
      video.src = layer.videoUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      record = { texture, video, loaded: false };
      video.addEventListener('loadeddata', () => { record.loaded = true; });
      videoTextureCache.set(layer.videoUrl, record);
    }
    if (enabled && !isPaused) { void record.video.play().catch(() => {}); }
    else record.video.pause();
    if (enabled && record.loaded && record.video.readyState >= 2) {
      gl.bindTexture(gl.TEXTURE_2D, record.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, record.video);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return record;
  }

  // FBO setup for reflection passes
  let fbo = null, fboTex = null, fboWidth = 0, fboHeight = 0;
  function ensureFbo(w, h) {
    if (fbo && fboWidth === w && fboHeight === h) return;
    fboWidth = w; fboHeight = h;
    if (fbo) gl.deleteFramebuffer(fbo);
    if (fboTex) gl.deleteTexture(fboTex);
    fbo = gl.createFramebuffer();
    fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function mat4Ortho(left, right, bottom, top, near, far) {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    return new Float32Array([
      -2 * lr, 0, 0, 0,
      0, -2 * bt, 0, 0,
      0, 0, 2 * nf, 0,
      (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1
    ]);
  }

  function mat4Perspective(fovRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovRad / 2);
    const nf = 1.0 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  function mat4LookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;

    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xy /= len; xz /= len;

    let yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;

    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1
    ]);
  }

  function mat4Transform3D(origin, angles, scale) {
    const ox = origin[0] || 0, oy = origin[1] || 0, oz = origin[2] || 0;
    const sx = scale[0] || 1, sy = scale[1] || 1, sz = scale[2] || 1;
    const ax = (angles[0] || 0) * Math.PI / 180;
    const ay = (angles[1] || 0) * Math.PI / 180;
    const az = (angles[2] || 0) * Math.PI / 180;

    const cx = Math.cos(ax), sxn = Math.sin(ax);
    const cy = Math.cos(ay), syn = Math.sin(ay);
    const cz = Math.cos(az), szn = Math.sin(az);

    const m00 = (cy * cz) * sx;
    const m01 = (cx * szn + sxn * syn * cz) * sx;
    const m02 = (sxn * szn - cx * syn * cz) * sx;

    const m10 = (-cy * szn) * sy;
    const m11 = (cx * cz - sxn * syn * szn) * sy;
    const m12 = (sxn * cz + cx * syn * szn) * sy;

    const m20 = syn * sz;
    const m21 = (-sxn * cy) * sz;
    const m22 = (cx * cy) * sz;

    return new Float32Array([
      m00, m01, m02, 0,
      m10, m11, m12, 0,
      m20, m21, m22, 0,
      ox,  oy,  oz,  1
    ]);
  }

  function mat3NormalMatrix(m4) {
    return new Float32Array([
      m4[0], m4[1], m4[2],
      m4[4], m4[5], m4[6],
      m4[8], m4[9], m4[10]
    ]);
  }

  const modelGpuCache = new Map();
  function getGpuMesh(mesh) {
    if (modelGpuCache.has(mesh)) return modelGpuCache.get(mesh);
    
    function b64ToF32(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Float32Array(bytes.buffer);
    }
    function b64ToU16(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Uint16Array(bytes.buffer);
    }
    function b64ToU32(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Uint32Array(bytes.buffer);
    }
    // Meshes above 65535 vertices carry u32 indices (mesh.idx32), which
    // WebGL1 only exposes via OES_element_index_uint.
    const uintIndexExt = gl.getExtension('OES_element_index_uint');

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, b64ToF32(mesh.posB64), gl.STATIC_DRAW);

    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, b64ToF32(mesh.normB64), gl.STATIC_DRAW);

    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, b64ToF32(mesh.uvB64), gl.STATIC_DRAW);

    const uv2Buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uv2Buf);
    gl.bufferData(gl.ARRAY_BUFFER, b64ToF32(mesh.uv2B64 || mesh.uvB64), gl.STATIC_DRAW);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    const idx32 = Boolean(mesh.idx32) && uintIndexExt;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx32 ? b64ToU32(mesh.indicesB64) : b64ToU16(mesh.indicesB64), gl.STATIC_DRAW);

    const gpu = { posBuf, normBuf, uvBuf, uv2Buf, idxBuf, iCount: mesh.iCount, idxType: idx32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    modelGpuCache.set(mesh, gpu);
    return gpu;
  }

  function mat4Transform2D(x, y, w, h, angleRad) {
    const c = Math.cos(angleRad || 0);
    const s = Math.sin(angleRad || 0);
    return new Float32Array([
      w * c,  w * s,  0, 0,
     -h * s,  h * c,  0, 0,
      0,      0,      1, 0,
      x,      y,      0, 1
    ]);
  }

  function spawnParticle(emitter, system) {
    const lifeMin = system.lifeMin || 3;
    const lifeMax = system.lifeMax || 5;
    const lifetime = lifeMin + Math.random() * (lifeMax - lifeMin);
    
    // Position
    let x = 0, y = 0, vx = 0, vy = 0;
    if (system.type === 'meteor') {
      x = 500 + Math.random() * 3000;
      y = 1200 + Math.random() * 800;
      const speed = 700 + Math.random() * 500;
      vx = -speed * 0.85;
      vy = -speed * 0.52;
    } else { // fireflies / sparkles
      x = 200 + Math.random() * 3440;
      y = 100 + Math.random() * 900;
      vx = (Math.random() - 0.5) * 25;
      vy = 10 + Math.random() * 20;
    }
    
    const size = system.size || (15 + Math.random() * 20);
    activeParticles.push({
      system,
      x, y, vx, vy,
      size,
      life: 0,
      maxLife: lifetime,
      color: system.color || [1, 1, 0.8, 1],
      trail: []
    });
  }

  function updateParticles(dt) {
    for (let i = activeParticles.length - 1; i >= 0; i--) {
      const p = activeParticles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        activeParticles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.system.type === 'meteor') {
        p.trail.push({ x: p.x, y: p.y, life: p.life });
        if (p.trail.length > 8) p.trail.shift();
      } else {
        // Floating wander
        p.vx += (Math.random() - 0.5) * 15 * dt;
        p.vy += (Math.random() - 0.5) * 15 * dt;
      }
    }
  }
  // FBO for screen-space reflection (grid floor)
  let reflFbo = null;
  let reflTex = null;
  let reflDepth = null;
  let reflW = 0, reflH = 0;
  function ensureReflFbo(w, h) {
    if (reflW === w && reflH === h && reflFbo) return;
    if (reflFbo) { gl.deleteFramebuffer(reflFbo); gl.deleteTexture(reflTex); gl.deleteRenderbuffer(reflDepth); }
    reflFbo = gl.createFramebuffer();
    reflTex = gl.createTexture();
    reflDepth = gl.createRenderbuffer();
    gl.bindTexture(gl.TEXTURE_2D, reflTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, reflDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, reflFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, reflTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, reflDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    reflW = w; reflH = h;
  }

  function renderFrame(now) {
    if (!sceneData) {
      requestAnimationFrame(render);
      return;
    }

    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    const elapsed = (now - startTime) / 1000;

    if (!isPaused) {
      // Spawn particles periodically
      if (sceneData.hasMeteors && Math.random() < dt * 1.8) {
        spawnParticle({}, { type: 'meteor', lifeMin: 1.2, lifeMax: 2.2, size: 28, color: [1, 0.95, 0.85, 1], texUrl: sceneData.meteorTex });
      }
      if (sceneData.hasFireflies && activeParticles.filter(p => p.system.type === 'firefly').length < 35) {
        spawnParticle({}, { type: 'firefly', lifeMin: 4, lifeMax: 8, size: 14, color: [0.8, 1.0, 0.5, 0.85], texUrl: sceneData.sparkleTex });
      }
      updateParticles(dt);
    }

    // Size the backing store in device pixels: on HiDPI displays a CSS-pixel
    // canvas is upscaled by the compositor and the wallpaper looks soft
    // (capped at 2x to bound GPU cost on very high DPR screens).
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    // Some WE scenes mark the project as 3D solely because they contain 3D
    // particle systems while their visual base is still ordinary image layers.
    // Route those mixed scenes through the 2D compositor and draw the decoded
    // artwork; the 3D-only branch otherwise clears an opaque canvas and shows
    // only particles over a gradient.
    if (sceneData.is3D && sceneData.models && sceneData.models.length > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      const bg = sceneData.clearColor || [0.1, 0.1, 0.15];
      gl.clearColor(bg[0] * 0.4, bg[1] * 0.4, bg[2] * 0.4, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);

      const isCarScene = Boolean(sceneData.carBodyColor);
      const aspect = width / height;
      const cam = sceneData.camera || { eye: [2.18, 1.98, 4.63], center: [0, 0.45, 0], up: [0, 1, 0], fov: 50 };
      const proj3D = mat4Perspective((cam.fov || 50) * Math.PI / 180, aspect, 0.1, 1000.0);

      // Camera animation: use scene-specific paths if available, otherwise slow orbit
      const camPaths = sceneData.cameraPaths;
      let eye, center, upVec;
      if (camPaths && camPaths.length > 0) {
        const totalDur = camPaths.reduce((s, p) => s + p.d, 0);
        const cycleTime = elapsed % totalDur;
        let accum = 0, seg = camPaths[0], segT = 0;
        for (const p of camPaths) {
          if (cycleTime < accum + p.d) { seg = p; segT = (cycleTime - accum) / p.d; break; }
          accum += p.d;
        }
        segT = segT * segT * (3 - 2 * segT);
        const lerp3 = (a, b, t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
        eye = lerp3(seg.e0, seg.e1, segT);
        center = lerp3(seg.c0, seg.c1, segT);
        upVec = lerp3(seg.u0, seg.u1, segT);
      } else if (sceneData.cameraStatic) {
        // Fixed scene camera (no animation paths)
        eye = [cam.eye[0], cam.eye[1], cam.eye[2]];
        center = [cam.center[0], cam.center[1], cam.center[2]];
        upVec = [cam.up[0], cam.up[1], cam.up[2]];
      } else {
        const cx = cam.center[0], cy = cam.center[1], cz = cam.center[2];
        const dx = cam.eye[0] - cx, dy = cam.eye[1] - cy, dz = cam.eye[2] - cz;
        const radius = Math.hypot(dx, dy, dz) || 4.5;
        const baseAngle = Math.atan2(dx, dz);
        const pitchAngle = Math.atan2(dy, Math.hypot(dx, dz));
        const yaw = baseAngle + elapsed * 0.05;
        const pitch = pitchAngle;
        eye = [cx + Math.sin(yaw) * Math.cos(pitch) * radius, cy + Math.sin(pitch) * radius, cz + Math.cos(yaw) * Math.cos(pitch) * radius];
        center = [cx, cy, cz];
        upVec = [0, 1, 0];
      }
      // Mouse parallax
      const targetYaw = (mouseX - 0.5) * 0.6;
      const targetPitch = (mouseY - 0.5) * 0.3;
      curRotY += (targetYaw - curRotY) * 0.04;
      curRotX += (targetPitch - curRotX) * 0.04;
      eye[0] += curRotY * 0.5;
      eye[1] += curRotX * 0.3;

      const view3D = mat4LookAt(eye, center, upVec);
      // Planar reflection: the FBO pass renders from a camera mirrored below
      // the floor plane (y=0), so the grid can sample it 1:1 by screen UV.
      const view3DRefl = mat4LookAt(
        [eye[0], -eye[1], eye[2]],
        [center[0], -center[1], center[2]],
        [upVec[0], -upVec[1], upVec[2]]);
      const bodyCol = sceneData.carBodyColor || [1, 0, 0];

      // (Re-)bind prog3D with all scene uniforms. Must be re-invoked after any
      // pass that switches to another program (bgLayers, billboards).
      function bindProg3D(viewOverride) {
        gl.useProgram(prog3D);
        gl.uniformMatrix4fv(gl.getUniformLocation(prog3D, 'u_proj'), false, proj3D);
        gl.uniformMatrix4fv(gl.getUniformLocation(prog3D, 'u_view'), false, viewOverride || view3D);
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_cameraPos'), eye[0], eye[1], eye[2]);
        gl.uniform1f(gl.getUniformLocation(prog3D, 'u_time'), elapsed);
        // WE-standard scene shading for generic scenes; car scenes keep their
        // dedicated paint/grid pipeline.
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_sceneStd'), isCarScene ? 0 : 1);
        // Engine-glow boost positions: origins of jet models (ricepod.vert).
        const jetPos = [];
        for (const model of sceneData.models) {
          const mName = (model.name || '').toLowerCase();
          const jetLike = mName.includes('jet') || (model.meshes || []).some((mm) => (mm.shader || '').toLowerCase().includes('jet'));
          if (jetLike && jetPos.length < 4) jetPos.push(model.origin || [0, 0, 0]);
        }
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_jetCount'), jetPos.length);
        for (let ji = 0; ji < 4; ji++) {
          const jp = jetPos[ji] || [0, 0, 0];
          gl.uniform3f(gl.getUniformLocation(prog3D, 'u_jetPos[' + ji + ']'), jp[0], jp[1], jp[2]);
        }
        const pointLights = sceneData.pointLights || [];
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_lightCount'), pointLights.length);
        for (let li = 0; li < 4; li++) {
          const light = pointLights[li] || { origin: [0, 0, 0], color: [0, 0, 0], radius: 1 };
          gl.uniform3f(gl.getUniformLocation(prog3D, 'u_lightPos[' + li + ']'), light.origin[0], light.origin[1], light.origin[2]);
          gl.uniform4f(gl.getUniformLocation(prog3D, 'u_lightColorRadius[' + li + ']'), light.color[0], light.color[1], light.color[2], light.radius);
        }
        const sky = sceneData.skyLightColor || [0, 0, 0];
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_skyLightColor'), sky[0], sky[1], sky[2]);
        // Ricepod uses lightDir (-0.577, 0.577, 0.577), car uses (0.577, 0.577, 0.577)
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_lightDir'), isCarScene ? 0.577 : -0.577, 0.577, 0.577);
        const amb = sceneData.clearColor || [0.1, 0.1, 0.15];
        // Generic scenes must preserve authored black ambient. Artificially
        // lifting it illuminated distant geometry that WE intentionally hides.
        const ambColor = isCarScene ? amb : (sceneData.ambientColor || [0, 0, 0]);
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_ambientColor'), ambColor[0], ambColor[1], ambColor[2]);
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_paintColor'), bodyCol[0], bodyCol[1], bodyCol[2]);
      }
      bindProg3D();

      const locPos = gl.getAttribLocation(prog3D, 'a_pos');
      const locNorm = gl.getAttribLocation(prog3D, 'a_norm');
      const locUv = gl.getAttribLocation(prog3D, 'a_uv');
      const locUv2 = gl.getAttribLocation(prog3D, 'a_uv2');
      gl.enableVertexAttribArray(locPos);
      gl.enableVertexAttribArray(locNorm);
      gl.enableVertexAttribArray(locUv);
      gl.enableVertexAttribArray(locUv2);

      // Per-submesh specular params (from WE material JSONs)
      const specMap = {
        body: [0.4, 6], glass: [5, 50], interior: [0.2, 15],
        matte: [0.5, 10], taillights: [0.25, 10], wheel: [1, 10],
      };
      function getSpecParams(texUrl) {
        if (!texUrl) return [0.3, 10];
        for (const [k, v] of Object.entries(specMap)) {
          if (texUrl.includes(k)) return v;
        }
        return [0.3, 10];
      }

      // Render in correct order: skybox/dome, opaque, shadow, grid, glass/additive
      const skyboxModels = [];
      const domeModels = [];
      const opaqueModels = [];
      const shadowModels = [];
      const gridModels = [];
      const glassQueue = [];
      const additiveQueue = [];
      const translucentQueue = [];
      const neonGridQueue = [];

      for (const model of sceneData.models) {
        const mName = (model.name || '').toLowerCase();
        if (mName === 'skybox') { skyboxModels.push(model); continue; }
        if (mName === 'dome') { domeModels.push(model); continue; }
        if (mName === 'shadow') { shadowModels.push(model); continue; }
        if (mName === 'grid') { gridModels.push(model); continue; }
        // Material blending flags decide the queue per mesh; the model name
        // 'jet' heuristic stays as a fallback for legacy manifests.
        const opaqueMeshes = [];
        for (const mesh of model.meshes) {
          const shName = (mesh.shader || '').toLowerCase();
          if (shName === 'neongrid') neonGridQueue.push({ model, mesh });
          else if (mesh.additive || mName.includes('jet')) additiveQueue.push({ model, mesh });
          else if (mesh.translucent) translucentQueue.push({ model, mesh });
          else opaqueMeshes.push(mesh);
        }
        if (opaqueMeshes.length > 0) opaqueModels.push({ ...model, meshes: opaqueMeshes });
      }

      // Helper to draw a mesh with given uniforms
      function drawMesh(model, mesh, flags) {
        let modelMat = mat4Transform3D(model.origin, model.angles, model.scale);
        // Skybox/aurora/thunder follow the camera position (WE shaders add
        // g_EyePosition to the vertex instead of a model transform).
        if (flags.skybox || flags.followEye) {
          modelMat = mat4Transform3D([eye[0], eye[1], eye[2]], model.angles, model.scale);
        }
        gl.uniformMatrix4fv(gl.getUniformLocation(prog3D, 'u_model'), false, modelMat);
        const normMat = mat3NormalMatrix(modelMat);
        gl.uniformMatrix3fv(gl.getUniformLocation(prog3D, 'u_normMat'), false, normMat);

        const gpu = getGpuMesh(mesh);
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
        gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.normBuf);
        gl.vertexAttribPointer(locNorm, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uvBuf);
        gl.vertexAttribPointer(locUv, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uv2Buf);
        gl.vertexAttribPointer(locUv2, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.idxBuf);

        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isDome'), flags.dome ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isShadow'), flags.shadow ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isGrid'), flags.grid ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isSkybox'), flags.skybox ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isSelfIllum'), flags.selfIllum ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isCarBody'), flags.body ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isGlass'), flags.glass ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isJet'), flags.jet ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isAurora'), flags.aurora ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isThunder'), flags.thunder ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isBg'), flags.bg ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isNeonSun'), flags.neonSun ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_gradFade'), mesh.gradFade ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasTint'), mesh.tint || flags.neonSun ? 1 : 0);
        const uc = mesh.userColors || {};
        let tintCol = mesh.tint || [1, 1, 1];
        let tint2Col = mesh.tint2 || tintCol;
        if (flags.neonSun) {
          tintCol = uc.colorsuntop || tintCol;
          tint2Col = uc.colorsunbottom || tint2Col;
        }
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_tint'), tintCol[0], tintCol[1], tintCol[2]);
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_tint2'), tint2Col[0], tint2Col[1], tint2Col[2]);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasLightmap'), 0);
        if (mesh.lightmapUrl) {
          const lightmapRec = loadTexture(mesh.lightmapUrl, false);
          if (lightmapRec.loaded) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, lightmapRec.texture);
            gl.uniform1i(gl.getUniformLocation(prog3D, 'u_lightmap'), 2);
            gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasLightmap'), 1);
            gl.activeTexture(gl.TEXTURE0);
          }
        }
        // Second pass texture (normal/pattern slot), repeat-wrapped like bg clouds.
        if (mesh.texUrl2) {
          const tex2Rec = loadTexture(mesh.texUrl2, true);
          if (tex2Rec.loaded) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tex2Rec.texture);
            gl.uniform1i(gl.getUniformLocation(prog3D, 'u_tex2'), 1);
            gl.activeTexture(gl.TEXTURE0);
          }
        }

        // WE material depth flags (orbital glows disable both).
        if (mesh.noDepthTest) gl.disable(gl.DEPTH_TEST);
        if (mesh.noDepthWrite) gl.depthMask(false);

        const sp = getSpecParams(mesh.texUrl);
        gl.uniform1f(gl.getUniformLocation(prog3D, 'u_specStrength'), sp[0]);
        gl.uniform1f(gl.getUniformLocation(prog3D, 'u_specPower'), sp[1]);

        if (flags.body) {
          const strCol = sceneData.carStripesColor || [0, 0, 0];
          gl.uniform3f(gl.getUniformLocation(prog3D, 'u_paintColor'), bodyCol[0], bodyCol[1], bodyCol[2]);
          gl.uniform3f(gl.getUniformLocation(prog3D, 'u_stripeColor'), strCol[0], strCol[1], strCol[2]);
        }

        // Load texture for all meshes that have one (including skybox)
        if (mesh.texUrl && !flags.dome && !flags.shadow && !flags.grid) {
          const texRec = loadTexture(mesh.texUrl, Boolean(mesh.repeatBase || flags.aurora || flags.bg));
          if (texRec.loaded) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texRec.texture);
            gl.uniform1i(gl.getUniformLocation(prog3D, 'u_tex'), 0);
            gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasTex'), 1);
          } else {
            gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasTex'), 0);
            gl.uniform3f(gl.getUniformLocation(prog3D, 'u_color'), 0.7, 0.7, 0.75);
          }
        } else {
          gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasTex'), 0);
          gl.uniform3f(gl.getUniformLocation(prog3D, 'u_color'), 0.65, 0.68, 0.72);
        }

        gl.drawElements(gl.TRIANGLES, gpu.iCount, gpu.idxType, 0);

        if (mesh.noDepthTest) gl.enable(gl.DEPTH_TEST);
        if (mesh.noDepthWrite) gl.depthMask(true);
      }

      // --- Pass 1: Render to FBO for reflection source (if car scene with grid) ---
      const hasGrid = isCarScene && gridModels.length > 0;
      if (hasGrid) {
        bindProg3D(view3DRefl); // mirrored camera for the reflection pass
        ensureReflFbo(width, height);
        // Unbind the reflection texture before rendering into its own FBO
        // (avoids a framebuffer/texture feedback loop from the last frame).
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, reflFbo);
        gl.viewport(0, 0, width, height);
        gl.clearColor(bg[0] * 0.4, bg[1] * 0.4, bg[2] * 0.4, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Dome to FBO
        gl.depthMask(false);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasReflTex'), 0);
        for (const model of domeModels) {
          for (const mesh of model.meshes) drawMesh(model, mesh, { dome: true });
        }
        gl.depthMask(true);

        // Opaque car to FBO
        gl.disable(gl.BLEND);
        for (const model of opaqueModels) {
          for (const mesh of model.meshes) {
            const isBody = Boolean(isCarScene && mesh.texUrl && mesh.texUrl.includes('body'));
            const isGlass = Boolean(mesh.texUrl && mesh.texUrl.includes('glass'));
            if (!isGlass) drawMesh(model, mesh, { body: isBody });
          }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      // --- Pass 2: Render to screen ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.clearColor(bg[0] * 0.4, bg[1] * 0.4, bg[2] * 0.4, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      bindProg3D(); // restore the real camera after the reflection pass

      // 0. Fullscreen background layers (cloudsbg etc.), no depth
      const bgLayers = sceneData.bgLayers || [];
      if (bgLayers.length > 0) {
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        for (const layer of bgLayers) {
          if ((layer.shader || '') === 'cloudsbg') drawCloudsBgLayer(layer, elapsed, width, height);
        }
        gl.enable(gl.DEPTH_TEST);
        bindProg3D(); // drawCloudsBgLayer switched the bound program
      }

      // 1. Skybox / Dome: render first, no depth write
      gl.depthMask(false);
      gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasReflTex'), 0);
      for (const model of skyboxModels) {
        for (const mesh of model.meshes) drawMesh(model, mesh, { skybox: true });
      }
      for (const model of domeModels) {
        for (const mesh of model.meshes) drawMesh(model, mesh, { dome: true });
      }
      gl.depthMask(true);

      // 2. Opaque parts (bg shader meshes render as fullscreen background)
      gl.disable(gl.BLEND);
      for (const model of opaqueModels) {
        for (const mesh of model.meshes) {
          const isBody = Boolean(isCarScene && mesh.texUrl && mesh.texUrl.includes('body'));
          const isGlass = Boolean(mesh.texUrl && mesh.texUrl.includes('glass'));
          if (isGlass) {
            glassQueue.push({ model, mesh });
            continue;
          }
          drawMesh(model, mesh, { body: isBody, bg: (mesh.shader || '') === 'bg' });
        }
      }

      // 2b. Translucent overlays, far-to-near: neongrid floor first, then
      // bgfade/neonsun on top. Translucent passes never write depth so their
      // transparent pixels cannot occlude later geometry.
      if (translucentQueue.length > 0 || neonGridQueue.length > 0) {
        gl.enable(gl.BLEND);
        gl.depthMask(false);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        for (const { model, mesh } of neonGridQueue) {
          drawNeonGrid(model, mesh, proj3D, view3D, elapsed);
        }
        gl.useProgram(prog3D);
        for (const { model, mesh } of translucentQueue) {
          drawMesh(model, mesh, { bg: (mesh.shader || '') === 'bg', neonSun: (mesh.shader || '') === 'neonsun' });
        }
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

      // 3. Shadow (blended)
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      for (const model of shadowModels) {
        for (const mesh of model.meshes) drawMesh(model, mesh, { shadow: true });
      }

      // 4. Grid floor with FBO reflection
      if (hasGrid && reflTex) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, reflTex);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_reflTex'), 1);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasReflTex'), 1);
        gl.uniform2f(gl.getUniformLocation(prog3D, 'u_resolution'), width, height);
      }
      for (const model of gridModels) {
        for (const mesh of model.meshes) drawMesh(model, mesh, { grid: true });
      }
      gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasReflTex'), 0);

      // 5. Glass (blended)
      for (const { model, mesh } of glassQueue) {
        drawMesh(model, mesh, { glass: true });
      }

      // 6. Additive glow queue (jets, orbital effects, self-illuminated)
      // SRC_ALPHA, ONE: shaped by the shader's output alpha (aurora fade,
      // thunder sparkle); jets output alpha 1 so they behave as pure additive.
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      for (const { model, mesh } of additiveQueue) {
        const shaderName = (mesh.shader || '').toLowerCase();
        const jetLike = shaderName.includes('jet') || (mesh.texUrl || '').toLowerCase().includes('jet');
        const isAurora = !jetLike && shaderName.includes('aurora');
        const isThunder = !jetLike && shaderName.includes('thunder');
        drawMesh(model, mesh, {
          jet: jetLike,
          aurora: isAurora,
          thunder: isThunder,
          selfIllum: !jetLike && !isAurora && !isThunder,
          followEye: isAurora || isThunder,
        });
      }

      // 7. 3D sprites (sun glow billboards) and particle streaks (starfield)
      const sprites3d = sceneData.sprites || [];
      const systems3d = sceneData.particles3d || [];
      if (sceneData.models && sceneData.models.length > 0 && (sprites3d.length > 0 || systems3d.length > 0)) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive, texture-alpha shaped
        for (const sp of sprites3d) {
          // View-space offset = camera-facing quad (WE sprite.vert semantics:
          // right*(u-0.5) + up*(v-0.5), scaled by 0.5 * object scale).
          const w = 0.5 * (sp.scale ? sp.scale[0] : 1);
          const h = 0.5 * (sp.scale ? sp.scale[1] : 1);
          drawBillboard(sp.origin, [w, 0], [0, h], sp.texUrl, [1, 1, 1, 1], proj3D, view3D);
        }
        for (const sys of systems3d) {
          if (!isPaused) updateParticles3d(sys, dt);
          const st = getParticles3d(sys);
          for (const p of st.list) {
            const fade = Math.min(1, Math.min(p.life, p.maxLife - p.life) / (0.2 * p.maxLife));
            // Streak: stretch the quad along the view-space velocity.
            const vv = [
              view3D[0] * p.vx + view3D[4] * p.vy + view3D[8] * p.vz,
              view3D[1] * p.vx + view3D[5] * p.vy + view3D[9] * p.vz,
            ];
            const speed = Math.hypot(vv[0], vv[1]);
            const halfLen = p.size * 0.5 * (1 + Math.min(speed * 0.08, 4));
            const halfWid = p.size * 0.5;
            let px = 1, py = 0;
            if (speed > 0.001) { px = vv[0] / speed; py = vv[1] / speed; }
            const axisX = [px * halfLen * 2, py * halfLen * 2];
            const axisY = [-py * halfWid * 2, px * halfWid * 2];
            drawBillboard([p.x, p.y, p.z], axisX, axisY, sys.texUrl, [p.color[0], p.color[1], p.color[2], fade], proj3D, view3D);
          }
        }
      }

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      requestAnimationFrame(render);
      return;
    }

    const sceneW = sceneData.width || 3840;
    const sceneH = sceneData.height || 2160;

    let scale = 1;
    if (fitMode === 'cover') {
      scale = Math.max(width / sceneW, height / sceneH);
    } else if (fitMode === 'contain') {
      scale = Math.min(width / sceneW, height / sceneH);
    } // fill: viewport covers the whole canvas (non-uniform stretch)

    const vpW = fitMode === 'fill' ? width : Math.round(sceneW * scale);
    const vpH = fitMode === 'fill' ? height : Math.round(sceneH * scale);
    const vpX = fitMode === 'fill' ? 0 : Math.round((width - vpW) / 2);
    const vpY = fitMode === 'fill' ? 0 : Math.round((height - vpH) / 2);

    ensureFbo(Math.min(sceneW, 2048), Math.min(sceneH, 1080));

    // Projection matrix mapping scene coords (0..sceneW, 0..sceneH) to clip space (-1..1)
    const proj = mat4Ortho(0, sceneW, 0, sceneH, -1000, 1000);

    // WE serializes scene image objects in painter order: the base is first and
    // overlays/effect layers follow it. Preserve that order. Reversing it makes
    // an opaque base layer cover flow/sway shaders and every foreground component,
    // which presents live scenes as a wrongly cropped static texture.
    const currentPeriod = activeTimePeriod(sceneData.timeSchedule, new Date());
    const renderLayers = sceneData.layers.filter((layer) => layerEnabledByTime(layer, currentPeriod));
    // Pause inactive time-period videos immediately; only the author-selected
    // morning/day/dusk/night layer may consume decode resources.
    for (const layer of sceneData.layers) {
      if (layer.videoUrl) loadVideoTexture(layer, layerEnabledByTime(layer, currentPeriod));
    }

    // Pass 1: Render background and sky layers into FBO for reflections
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, fboWidth, fboHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(progBasic);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    const aPos = gl.getAttribLocation(progBasic, 'a_pos');
    const aUv = gl.getAttribLocation(progBasic, 'a_uv');
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    gl.uniformMatrix4fv(gl.getUniformLocation(progBasic, 'u_proj'), false, proj);
    gl.uniform1f(gl.getUniformLocation(progBasic, 'u_time'), elapsed);
    gl.uniform4f(gl.getUniformLocation(progBasic, 'u_uvRect'), 0, 0, 1, 1);
    gl.uniform1f(gl.getUniformLocation(progBasic, 'u_bright'), 1);
    gl.uniform1f(gl.getUniformLocation(progBasic, 'u_power'), 1);

    // Render sky & upper layers into FBO
    for (const layer of renderLayers) {
      if (layer.isGround || layer.isReflection) continue;
      const texRec = layer.videoUrl ? loadVideoTexture(layer, true) : loadTexture(layer.texUrl);
      if (!texRec.loaded) continue;

      const model = mat4Transform2D(layer.x, layer.y, layer.w, layer.h, layer.angle || 0);
      gl.uniformMatrix4fv(gl.getUniformLocation(progBasic, 'u_model'), false, model);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_alpha'), layer.alpha != null ? layer.alpha : 1.0);
      gl.uniform3f(gl.getUniformLocation(progBasic, 'u_tint'), 1, 1, 1);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_sway'), layer.sway || 0);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_sway_speed'), layer.swaySpeed || 1.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texRec.texture);
      gl.uniform1i(gl.getUniformLocation(progBasic, 'u_tex'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Pass 2: Render to screen viewport
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(vpX, vpY, vpW, vpH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Render all layers (Sky -> Ground -> Reflection -> Particles)
    for (const layer of renderLayers) {
      if (layer.isReflection) {
        // Water Reflection Pass
        const maskRec = loadTexture(layer.texUrl);
        if (!maskRec.loaded) continue;

        gl.useProgram(progReflection);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        const rPos = gl.getAttribLocation(progReflection, 'a_pos');
        const rUv = gl.getAttribLocation(progReflection, 'a_uv');
        gl.enableVertexAttribArray(rPos);
        gl.enableVertexAttribArray(rUv);
        gl.vertexAttribPointer(rPos, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(rUv, 2, gl.FLOAT, false, 16, 8);

        // Draw the reflection quad at the layer's own rect (fullscreen for
        // legacy scene-wide reflection layers).
        const model = mat4Transform2D(layer.x, layer.y, layer.w, layer.h, layer.angle || 0);
        gl.uniformMatrix4fv(gl.getUniformLocation(progReflection, 'u_proj'), false, proj);
        gl.uniformMatrix4fv(gl.getUniformLocation(progReflection, 'u_model'), false, model);
        gl.uniform4f(gl.getUniformLocation(progReflection, 'u_uvRect'), 0, 0, 1, 1);
        gl.uniform1f(gl.getUniformLocation(progReflection, 'u_time'), elapsed);
        gl.uniform1f(gl.getUniformLocation(progReflection, 'u_alpha'), 0.85);

        // Scene-uv rect of the quad (scene v grows downward, 0 at the top).
        const rectLeftU = (layer.x - layer.w / 2) / sceneW;
        const rectTopV = 1 - (layer.y + layer.h / 2) / sceneH;
        gl.uniform4f(gl.getUniformLocation(progReflection, 'u_rect'),
          rectLeftU, rectTopV, layer.w / sceneW, layer.h / sceneH);
        // Water line follows the scene data when the parser resolved one;
        // otherwise keep the legacy 0.65 / 0.42 / 0.38 window.
        const waterLine = typeof layer.waterLine === 'number' ? layer.waterLine : 0.65;
        const depthScale = (1 - waterLine) / 0.35;
        gl.uniform1f(gl.getUniformLocation(progReflection, 'u_waterLine'), waterLine);
        gl.uniform2f(gl.getUniformLocation(progReflection, 'u_reflectRange'),
          waterLine - 0.23 * depthScale, 0.38 * depthScale);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fboTex);
        gl.uniform1i(gl.getUniformLocation(progReflection, 'u_fbo'), 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, maskRec.texture);
        gl.uniform1i(gl.getUniformLocation(progReflection, 'u_mask'), 1);

        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        continue;
      }

      // WE flowimage layer (flowing nebula): mask + 3 cross-fading layers.
      // All four textures are sampled with the plain quad UV (WE stretches
      // mask and content over the whole quad); served PNGs are already
      // cropped to the image rect, and clamp wrapping matches clampuvs.
      if (layer.shader === 'flowimage' && layer.texUrls && layer.texUrls.length >= 4) {
        const recs = layer.texUrls.slice(0, 4).map((u) => loadTexture(u));
        if (!recs.every((r) => r.loaded)) continue;
        gl.useProgram(progFlow);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        const fPos = gl.getAttribLocation(progFlow, 'a_pos');
        const fUv = gl.getAttribLocation(progFlow, 'a_uv');
        gl.enableVertexAttribArray(fPos);
        gl.enableVertexAttribArray(fUv);
        gl.vertexAttribPointer(fPos, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(fUv, 2, gl.FLOAT, false, 16, 8);
        const model = mat4Transform2D(layer.x, layer.y, layer.w, layer.h, layer.angle || 0);
        gl.uniformMatrix4fv(gl.getUniformLocation(progFlow, 'u_proj'), false, proj);
        gl.uniformMatrix4fv(gl.getUniformLocation(progFlow, 'u_model'), false, model);
        const fcrop = layer.uvCrop || [0, 0, 1, 1];
        gl.uniform4f(gl.getUniformLocation(progFlow, 'u_uvRect'), fcrop[0], fcrop[1], fcrop[2], fcrop[3]);
        gl.uniform1f(gl.getUniformLocation(progFlow, 'u_time'), elapsed);
        const nums = layer.nums || {};
        gl.uniform3f(gl.getUniformLocation(progFlow, 'u_speeds'),
          nums.Speed0 ?? 0.01, nums.Speed1 ?? 0.01, nums.Speed2 ?? 0.01);
        gl.uniform1f(gl.getUniformLocation(progFlow, 'u_amp'), nums.Amount ?? 1);
        gl.uniform1f(gl.getUniformLocation(progFlow, 'u_bright'), nums.Bright ?? 1);
        const units = ['u_mask', 'u_l1', 'u_l2', 'u_l3'];
        for (let ui = 0; ui < 4; ui++) {
          gl.activeTexture(gl.TEXTURE0 + ui);
          gl.bindTexture(gl.TEXTURE_2D, recs[ui].texture);
          gl.uniform1i(gl.getUniformLocation(progFlow, units[ui]), ui);
        }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.activeTexture(gl.TEXTURE0);
        continue;
      }

      // WE flag layer (rippling tinted cloth): eagleflag
      if (layer.shader === 'flag' && layer.texUrls && layer.texUrls.length >= 3) {
        const recs = layer.texUrls.slice(0, 3).map((u) => loadTexture(u, true));
        if (!recs.every((r) => r.loaded)) continue;
        gl.useProgram(progFlag);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        const flPos = gl.getAttribLocation(progFlag, 'a_pos');
        const flUv = gl.getAttribLocation(progFlag, 'a_uv');
        gl.enableVertexAttribArray(flPos);
        gl.enableVertexAttribArray(flUv);
        gl.vertexAttribPointer(flPos, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(flUv, 2, gl.FLOAT, false, 16, 8);
        const model = mat4Transform2D(layer.x, layer.y, layer.w, layer.h, layer.angle || 0);
        gl.uniformMatrix4fv(gl.getUniformLocation(progFlag, 'u_proj'), false, proj);
        gl.uniformMatrix4fv(gl.getUniformLocation(progFlag, 'u_model'), false, model);
        const flcrop = layer.uvCrop || [0, 0, 1, 1];
        gl.uniform4f(gl.getUniformLocation(progFlag, 'u_uvRect'), flcrop[0], flcrop[1], flcrop[2], flcrop[3]);
        gl.uniform1f(gl.getUniformLocation(progFlag, 'u_time'), elapsed);
        const fnums = layer.nums || {};
        gl.uniform1f(gl.getUniformLocation(progFlag, 'u_speed'), fnums.Speed ?? 0.4);
        gl.uniform1f(gl.getUniformLocation(progFlag, 'u_strength'), fnums.Strength ?? 0.5);
        const fcols = layer.userColors || {};
        const fc1 = fcols.color1 || [0, 0, 0];
        const fc2 = fcols.color2 || [0, 0, 0];
        const fc3 = fcols.color3 || [1, 1, 1];
        gl.uniform3f(gl.getUniformLocation(progFlag, 'u_color1'), fc1[0], fc1[1], fc1[2]);
        gl.uniform3f(gl.getUniformLocation(progFlag, 'u_color2'), fc2[0], fc2[1], fc2[2]);
        gl.uniform3f(gl.getUniformLocation(progFlag, 'u_color3'), fc3[0], fc3[1], fc3[2]);
        const funits = ['u_tex', 'u_normal', 'u_cloth'];
        for (let ui = 0; ui < 3; ui++) {
          gl.activeTexture(gl.TEXTURE0 + ui);
          gl.bindTexture(gl.TEXTURE_2D, recs[ui].texture);
          gl.uniform1i(gl.getUniformLocation(progFlag, funits[ui]), ui);
        }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.activeTexture(gl.TEXTURE0);
        continue;
      }

      // Standard image or embedded-video layer.
      const texRec = layer.videoUrl ? loadVideoTexture(layer, true) : loadTexture(layer.texUrl);
      if (!texRec.loaded) continue;

      gl.useProgram(progBasic);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

      const crop = layer.uvCrop || [0, 0, 1, 1];
      gl.uniform4f(gl.getUniformLocation(progBasic, 'u_uvRect'), crop[0], crop[1], crop[2], crop[3]);
      const lnums = layer.nums || {};
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_bright'), lnums.Bright ?? 1);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_power'), lnums.Power ?? 1);

      const model = mat4Transform2D(layer.x, layer.y, layer.w, layer.h, layer.angle || 0);
      gl.uniformMatrix4fv(gl.getUniformLocation(progBasic, 'u_proj'), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(progBasic, 'u_model'), false, model);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_time'), elapsed);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_alpha'), layer.alpha != null ? layer.alpha : 1.0);
      gl.uniform3f(gl.getUniformLocation(progBasic, 'u_tint'), 1, 1, 1);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_sway'), layer.sway || 0);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_sway_speed'), layer.swaySpeed || 1.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texRec.texture);
      gl.uniform1i(gl.getUniformLocation(progBasic, 'u_tex'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Render Particles (Shooting Stars, Fireflies)
    if (activeParticles.length > 0) {
      gl.useProgram(progParticle);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      const pPos = gl.getAttribLocation(progParticle, 'a_pos');
      const pUv = gl.getAttribLocation(progParticle, 'a_uv');
      gl.enableVertexAttribArray(pPos);
      gl.enableVertexAttribArray(pUv);
      gl.vertexAttribPointer(pPos, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(pUv, 2, gl.FLOAT, false, 16, 8);
      gl.uniformMatrix4fv(gl.getUniformLocation(progParticle, 'u_proj'), false, proj);
      gl.uniform4f(gl.getUniformLocation(progParticle, 'u_uvRect'), 0, 0, 1, 1);

      gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive luminous particles

      for (const p of activeParticles) {
        const progress = p.life / p.maxLife;
        const alpha = Math.sin(progress * Math.PI); // Fade in & out
        const texRec = p.system.texUrl ? loadTexture(p.system.texUrl) : null;
        if (texRec && texRec.loaded) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texRec.texture);
          gl.uniform1i(gl.getUniformLocation(progParticle, 'u_tex'), 0);
        }

        // Draw trail if meteor
        if (p.trail && p.trail.length > 1) {
          for (let ti = 0; ti < p.trail.length; ti++) {
            const tp = p.trail[ti];
            const tRatio = (ti + 1) / p.trail.length;
            const tAlpha = alpha * tRatio * 0.6;
            const tModel = mat4Transform2D(tp.x, tp.y, p.size * tRatio * 1.5, p.size * 0.4, Math.atan2(p.vy, p.vx));
            gl.uniformMatrix4fv(gl.getUniformLocation(progParticle, 'u_model'), false, tModel);
            gl.uniform4f(gl.getUniformLocation(progParticle, 'u_color'), p.color[0], p.color[1], p.color[2], tAlpha);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          }
        }

        const model = mat4Transform2D(p.x, p.y, p.size * (p.system.type === 'meteor' ? 3 : 1), p.size, Math.atan2(p.vy, p.vx));
        gl.uniformMatrix4fv(gl.getUniformLocation(progParticle, 'u_model'), false, model);
        gl.uniform4f(gl.getUniformLocation(progParticle, 'u_color'), p.color[0], p.color[1], p.color[2], alpha * p.color[3]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    requestAnimationFrame(render);
  }

  // Crash guard: a render exception must not freeze the wallpaper silently.
  function render(now) {
    try {
      if (contextLost) { requestAnimationFrame(render); return; }
      renderFrame(now);
    } catch (e) {
      if (!window.__weRenderErr) {
        window.__weRenderErr = 1;
        console.error('we-scene-player render error:', e && e.stack || String(e));
      }
      requestAnimationFrame(render);
    }
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    // WebGL objects are invalid after restoration. Ask the embedding
    // controller to rebuild this isolated renderer instead of drawing with
    // stale programs/textures. The player frame is sandboxed without
    // allow-same-origin, so the embedding page's origin is unknown here;
    // '*' delivers to the window the event source check identifies.
    window.parent.postMessage({ type: 'dsh-scene-needs-reload' }, '*');
  });

  // Load manifest
  const token = window.location.pathname.split('/').filter(Boolean).pop();
  fetch('/api/skin-center/we/scene-manifest/' + token)
    .then(res => res.json())
    .then(data => {
      if (data.ok && data.manifest) {
        sceneData = data.manifest;
      }
    })
    .catch(err => console.error('Failed to load scene manifest', err));

  // Listen for controller messages; only the embedding parent may steer the
  // player. Origin cannot filter here: the player runs sandboxed without
  // allow-same-origin, so an origin compare would be browser-dependent and
  // the parent's messages carry its real origin. Only the identity of the
  // sender (the exact embedding window) is trustworthy.
  window.addEventListener('message', (ev) => {
    if (ev.source !== window.parent) return;
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'dsh-set-fit' && msg.fit) {
      fitMode = msg.fit;
    } else if (msg.type === 'dsh-set-pause') {
      isPaused = !!msg.paused;
    } else if (msg.type === 'dsh-recover-renderer') {
      if (gl.isContextLost()) {
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.restoreContext();
        else window.parent.postMessage({ type: 'dsh-scene-needs-reload' }, '*');
      } else {
        // Force an immediate fresh frame after compositor/theme changes.
        renderFrame(performance.now());
      }
    }
  });

  requestAnimationFrame(render);
})();
</script>
</body>
</html>
`;
