import * as THREE from 'three'

/**
 * One description of the sky, shared by everything that needs to know what
 * the sky looks like: the dome you see, and the water that reflects it.
 * `skyColor(direction, discs)` returns the colour in that direction;
 * `discs` = 1 draws the sun and moon themselves, 0 leaves only their glow.
 */
export const skyUniforms = {
  uTime: { value: 0 },
  uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uHorizonSun: { value: new THREE.Color() },
  uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() }, uCover: { value: 0.5 },
  uSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoon: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uStars: { value: 0 },
}

export const SKY_GLSL = /* glsl */ `
uniform float uTime, uCover, uMoon, uStars;
uniform vec3 uZenith, uHorizon, uHorizonSun, uCloudLit, uCloudShade, uSun, uSunDir, uMoonDir;
float sH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sH(i), sH(i + vec2(1, 0)), f.x), mix(sH(i + vec2(0, 1)), sH(i + vec2(1, 1)), f.x), f.y); }
float sF(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * sN(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
float sCloud(vec2 p) {
  float base = sF(p * 0.55 + uTime * 0.006), detail = sF(p * 1.9 - uTime * 0.01);
  return smoothstep(1.0 - uCover, 1.0 - uCover + 0.22, base * 0.78 + detail * 0.28);
}
vec3 skyColor(vec3 d, float discs) {
  float up = max(d.y, 0.0);
  float toSun = max(dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz)), 0.0);
  vec3 hor = mix(uHorizon, uHorizonSun, pow(toSun, 3.0));
  vec3 col = mix(hor, uZenith, pow(smoothstep(0.0, 0.75, up), 0.55));
  // stars
  vec2 sg = d.xz / (up + 0.25) * 90.0;
  float star = step(0.996, sH(floor(sg))) * smoothstep(0.5, 0.0, length(fract(sg) - 0.5));
  col += star * uStars * smoothstep(0.1, 0.5, up) * 1.8 * discs;
  // sun: hard disc inside a wide glow
  float s = max(dot(d, uSunDir), 0.0);
  col += uSun * (smoothstep(0.99972, 0.9999, s) * 24.0 * discs + pow(s, 600.0) * 1.6 + pow(s, 24.0) * 0.3);
  // moon: a full disc with grey seas, and a halo
  float m = max(dot(d, uMoonDir), 0.0);
  if (uMoon > 0.0) {
    vec3 mz = normalize(uMoonDir), mx = normalize(cross(vec3(0.0, 1.0, 0.0), mz)), my = cross(mz, mx);
    vec2 mp = vec2(dot(d, mx), dot(d, my)) / 0.036;
    float r = length(mp), disc = smoothstep(1.0, 0.95, r) * step(0.0, dot(d, mz));
    float seas = 0.62 + 0.38 * sF(mp * 2.0 + 3.0);
    float limb = sqrt(max(1.0 - r * r, 0.0)) * 0.35 + 0.65;                    // slightly darker towards the edge
    col = mix(col, vec3(2.6, 2.5, 2.25) * seas * limb, disc * uMoon * discs);
    col += vec3(0.45, 0.55, 0.8) * (pow(m, 900.0) * 0.5 + pow(m, 40.0) * 0.10) * uMoon;
  }
  // clouds on a flat layer overhead, thinning into the haze at the horizon
  if (d.y > 0.015) {
    vec2 cp = d.xz / (d.y + 0.11) * 1.15;
    float c = sCloud(cp);
    vec2 lightXZ = normalize(mix(uSunDir.xz, uMoonDir.xz, uMoon));
    float light = clamp(0.62 + (c - sCloud(cp + lightXZ * 0.16)) * 1.6, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLit, light);
    cc += uSun * 0.5 * pow(s, 6.0) * (1.0 - c * 0.6) + vec3(0.35, 0.4, 0.55) * pow(m, 10.0) * uMoon * (1.0 - c * 0.5);   // silver lining
    col = mix(col, cc, c * smoothstep(0.015, 0.16, d.y) * 0.93);
  }
  return col;
}`

/** The dome itself: follows the camera, always behind everything. */
export function createSkyDome() {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: SKY_GLSL + /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyColor(vec3(d.x, abs(d.y), d.z), 1.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }))
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  return mesh
}
