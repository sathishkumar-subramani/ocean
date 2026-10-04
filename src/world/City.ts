import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { hash, smoothstep, vnoise } from '../core/math'
import { addCaustics, sea } from './Underwater'

export const SEABED = -92          // depth of the city's ground
export const CITY_Z = -210         // centre of the city along the route
const G = SEABED
const PALACE_Z = -287              // centre of the rotunda the camera flies through
const P0 = G + 8                   // top of the palace platform
const LAMP_Z0 = -138, LAMP_STEP = 18, LAMP_N = 6, LAMP_X = 10.5

/** Seabed height: flat under the city, rolling beyond it, then falling away into the trench behind. */
export function seabedHeight(x: number, z: number) {
  const dunes = vnoise(x * 0.02 + 3, z * 0.02) * 5 + vnoise(x * 0.08, z * 0.08 + 9) * 1.2
  const inCity = 1 - smoothstep(150, 240, Math.hypot(x, (z - CITY_Z) * 0.8))
  const trench = smoothstep(-400, -640, z)                                   // the drop into the deep
  return SEABED + dunes * (1 - inCity * 0.85) - trench * 190 - trench * vnoise(x * 0.01, z * 0.01) * 30
}

// ------------------------------------------------------------ city light ---
// The city makes its own light. Rather than dozens of real lamps (slow), every
// stone surface works out the glow of the nearby lanterns itself, in its shader.
const GLOW_N = 12
const glow = { uGlowPos: { value: [] as THREE.Vector4[] }, uGlowCol: { value: [] as THREE.Vector3[] } }
const GLOW_GLSL = /* glsl */ `
  uniform vec4 uGlowPos[${GLOW_N}]; uniform vec3 uGlowCol[${GLOW_N}];
  float ch(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float cn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(ch(i), ch(i + vec2(1, 0)), f.x), mix(ch(i + vec2(0, 1)), ch(i + vec2(1, 1)), f.x), f.y); }
  float cfbm(vec2 p) { return cn(p) * 0.5 + cn(p * 2.1) * 0.3 + cn(p * 4.3) * 0.2; }
  vec3 onePoint(vec3 p, vec3 n, vec3 at, float r, vec3 col, float wrap) {
    vec3 L = at - p; float d2 = dot(L, L); float a = 1.0 / (1.0 + d2 / (r * r)); a *= a;
    float lam = dot(n, L * inversesqrt(d2 + 0.001));
    return col * a * mix(max(lam, 0.0), abs(lam), wrap) * 0.75 + col * a * 0.25;
  }
  vec3 cityGlow(vec3 p, vec3 n, float wrap) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${GLOW_N}; i++) sum += onePoint(p, n, uGlowPos[i].xyz, uGlowPos[i].w, uGlowCol[i], wrap);
    // the avenue's lantern rows are regular, so the nearest one is found by arithmetic
    float k = clamp(floor((${LAMP_Z0.toFixed(1)} - p.z) / ${LAMP_STEP.toFixed(1)} + 0.5), 0.0, ${(LAMP_N - 1).toFixed(1)});
    vec3 lamp = vec3(p.x >= 0.0 ? ${LAMP_X.toFixed(1)} : -${LAMP_X.toFixed(1)}, ${(G + 6.4).toFixed(1)}, ${LAMP_Z0.toFixed(1)} - k * ${LAMP_STEP.toFixed(1)});
    sum += onePoint(p, n, lamp, 5.5, vec3(1.9, 1.45, 0.6), wrap);
    return sum;
  }`

type Shader = { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }
/** Old cut stone: courses of blocks on walls, slabs on floors, silt and algae, lit by caustics and by the city's lanterns. */
function stone(color: string, opts: { blocks?: boolean; wrap?: number; side?: THREE.Side; rough?: number; metal?: number } = {}) {
  const { blocks = true, wrap = 0, side = THREE.FrontSide, rough = 0.92, metal = 0 } = opts
  return addCaustics(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side }), (shader: Shader) => {
    Object.assign(shader.uniforms, glow)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLOW_GLSL)
      .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
        {
          vec3 an = abs(vSeaN);
          float flat_ = step(0.6, an.y);
          vec2 f = flat_ > 0.5 ? vSeaPos.xz : (an.x > an.z ? vSeaPos.zy : vSeaPos.xy);
          ${blocks ? /* glsl */ `
          vec2 size = flat_ > 0.5 ? vec2(2.2, 2.2) : vec2(2.4, 1.2);
          float row = floor(f.y / size.y);
          vec2 cell = vec2(f.x / size.x + row * 0.5 * (1.0 - flat_), f.y / size.y), id = floor(cell), g = fract(cell);
          float joint = smoothstep(0.05, 0.0, min(min(g.x, 1.0 - g.x) * size.x, min(g.y, 1.0 - g.y) * size.y));
          float tone = ch(id);
          diffuseColor.rgb *= 0.9 + 0.16 * tone;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.4, joint * 0.85);
          // worn edges: each block is a little lighter toward its middle
          diffuseColor.rgb *= 0.9 + 0.14 * smoothstep(0.0, 0.3, min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y)));` : ''}
          float grain = cfbm(f * 1.7);
          diffuseColor.rgb *= 0.82 + 0.36 * grain;
          // centuries under water: weed in the damp corners, silt on every ledge
          float algae = smoothstep(0.42, 0.75, cfbm(f * 0.23 + 4.0)) * 0.75 + flat_ * 0.15;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.2, 0.15), clamp(algae, 0.0, 0.8));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.44, 0.36), flat_ * smoothstep(0.35, 0.8, cfbm(f * 0.5)) * 0.5);
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * cityGlow(vSeaPos, normalize(vSeaN), ${wrap.toFixed(1)});`)
  })
}

// ---------------------------------------------------------------- pieces ---
const M = (x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ry), new THREE.Vector3(sx, sy, sz))

/** Collects many small pieces and bakes them into one mesh per material. */
class Kit {
  parts: Record<string, THREE.BufferGeometry[]> = {}
  put(key: string, geo: THREE.BufferGeometry, m: THREE.Matrix4, tint?: THREE.Color) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    g.applyMatrix4(m)
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name)
    if (tint) {
      const n = g.attributes.position.count, c = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) c.set([tint.r, tint.g, tint.b], i * 3)
      g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    }
    ;(this.parts[key] ??= []).push(g)
  }
  box(key: string, w: number, h: number, d: number, m: THREE.Matrix4) { this.put(key, new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), m) }
  mesh(key: string, mat: THREE.Material) {
    const mesh = new THREE.Mesh(mergeGeometries(this.parts[key])!, mat)
    this.parts[key].forEach((g) => g.dispose())
    return mesh
  }
}

const paneCache = new Map<string, THREE.BufferGeometry>()
/** A window: a rectangle with a round head, facing +z, its sill at y = 0. */
function pane(w: number, h: number) {
  const key = `${w}:${h}`
  if (!paneCache.has(key)) {
    const s = new THREE.Shape()
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w / 2); s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); s.lineTo(-w / 2, 0)
    paneCache.set(key, new THREE.ShapeGeometry(s, 6))
  }
  return paneCache.get(key)!
}
/** A wall with an arched opening cut out of it, standing on y = 0, centred on x, `t` thick. */
function archWall(w: number, h: number, open: number, spring: number, t: number) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2, 0); s.lineTo(-open / 2, 0); s.lineTo(-open / 2, spring); s.absarc(0, spring, open / 2, Math.PI, 0, true)
  s.lineTo(open / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.lineTo(-w / 2, 0)
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -t / 2)
}
/** A slightly bulbous dome, open underneath, rim at y = 0. */
function domeGeo(r: number, seg = 28) {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI / 2; pts.push(new THREE.Vector2(r * Math.cos(a) * (1 + 0.1 * Math.sin(2 * a)) + 0.001, r * 1.12 * Math.sin(a) ** 0.92)) }
  return new THREE.LatheGeometry(pts, seg)
}
function columnGeo(h: number) {
  const p = [[0.95, 0], [0.95, 0.35], [0.72, 0.5], [0.62, 0.9], [0.55, h - 1.1], [0.7, h - 0.8], [0.95, h - 0.45], [0.95, h], [0.001, h]]
  return new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), 12)
}

const WARM = new THREE.Color(2.6, 1.75, 0.75), TEAL = new THREE.Color(0.75, 2.3, 1.75)
const windowTint = (base: THREE.Color, k: number) => new THREE.Color().copy(base).multiplyScalar(0.55 + hash(k) * 0.9)

/** The drowned city: a palace of domes and arches at the end of a lantern-lit avenue, with ruins and kelp around it. */
export class City {
  group = new THREE.Group()
  private halos: THREE.Points

  constructor(kelpTex: THREE.Texture) {
    const kit = new Kit()
    const blocked: { x: number; z: number; r: number }[] = []      // footprints, so kelp and rubble keep off the buildings
    const orbs: { p: THREE.Vector3; c: THREE.Color; s: number }[] = []
    const lights: { p: THREE.Vector3; r: number; c: THREE.Color }[] = []
    let seed = 1
    const rnd = () => hash(seed++ * 1.37)

    // ---- seabed -------------------------------------------------------------------
    const bed = new THREE.PlaneGeometry(900, 1300, 180, 260)
    bed.rotateX(-Math.PI / 2); bed.translate(0, 0, -420)
    const bp = bed.attributes.position
    for (let i = 0; i < bp.count; i++) bp.setY(i, seabedHeight(bp.getX(i), bp.getZ(i)))
    bed.computeVertexNormals()
    const sand = addCaustics(new THREE.MeshStandardMaterial({ color: '#8f8a72', roughness: 1 }), (shader: Shader) => {
      Object.assign(shader.uniforms, glow)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLOW_GLSL)
        .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
          float rip = sin(vSeaPos.x * 1.9 + sin(vSeaPos.z * 0.35) * 2.5) * 0.5 + 0.5;
          diffuseColor.rgb *= 0.78 + 0.22 * rip;
          diffuseColor.rgb *= 0.8 + 0.4 * ch(floor(vSeaPos.xz * 3.0));`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * cityGlow(vSeaPos, normalize(vSeaN), 0.0);')
    })
    this.group.add(new THREE.Mesh(bed, sand))

    // ---- reusable buildings -----------------------------------------------------------
    const finial = (x: number, y: number, z: number, s: number) => {
      kit.put('gold', new THREE.SphereGeometry(0.5 * s, 10, 8), M(x, y + 0.3 * s, z))
      kit.put('gold', new THREE.ConeGeometry(0.2 * s, 2.4 * s, 8).translate(0, 1.6 * s, 0), M(x, y, z))
    }
    const dome = (x: number, y: number, z: number, r: number) => {
      kit.put('stone', new THREE.CylinderGeometry(r * 1.04, r * 1.08, r * 0.3, 24).translate(0, r * 0.15, 0), M(x, y, z))
      kit.put('dome', domeGeo(r), M(x, y + r * 0.3, z))
      finial(x, y + r * 0.3 + r * 1.12, z, r * 0.22 + 0.25)
    }
    /** Arched windows along one wall: `at` puts the wall's local frame (x along the wall, z outwards) into the world. */
    const windows = (at: THREE.Matrix4, width: number, height: number, tint: THREE.Color, lit: number, door = false) => {
      const n = Math.floor((width - 2.2) / 3.2)
      const rows: [number, number, number][] = height >= 8 ? [[2.0, 1.5, 3.8]] : [[1.6, 1.2, 2.6]]
      for (let y = height >= 8 ? 7.6 : 99; y + 3.6 < height; y += 5.0) rows.push([y, 1.2, 2.8])
      rows.forEach(([y, w, h], r) => {
        for (let k = 0; k < n; k++) {
          const u = (k - (n - 1) / 2) * 3.2
          if (door && r === 0 && Math.abs(u) < 2.6) continue
          const on = rnd() < lit
          kit.put(on ? 'win' : 'dark', pane(w, h), new THREE.Matrix4().multiplyMatrices(at, M(u, y, 0.07)), on ? windowTint(tint, seed) : undefined)
          kit.put('stone', new THREE.BoxGeometry(w + 0.5, 0.25, 0.35), new THREE.Matrix4().multiplyMatrices(at, M(u, y - 0.12, 0.1)))
        }
      })
      if (door) kit.put('win', pane(3.2, 5.6), new THREE.Matrix4().multiplyMatrices(at, M(0, 0.4, 0.07)), windowTint(tint, 3).multiplyScalar(1.2))
    }
    const hall = (x: number, z: number, w: number, d: number, h: number, o: { y?: number; ry?: number; tint?: THREE.Color; roof?: 'dome' | 'turrets' | 'flat'; lit?: number; lean?: [number, number] } = {}) => {
      const { y = G - 0.6, ry = 0, tint = WARM, roof = 'dome', lit = 0.62, lean } = o
      const at = M(x, y, z, ry)
      if (lean) at.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(lean[0], 0, lean[1])))
      const P = (m: THREE.Matrix4) => new THREE.Matrix4().multiplyMatrices(at, m)
      kit.box('stone', w + 1.4, 1.2, d + 1.4, P(M(0, 0, 0)))
      kit.box('stone', w, h, d, P(M(0, 0, 0)))
      kit.box('stone', w + 0.5, 0.45, d + 0.5, P(M(0, h * 0.5, 0)))
      kit.box('stone', w + 1.2, 0.9, d + 1.2, P(M(0, h - 0.2, 0)))
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) kit.box('stone', 1.3, h + 1.6, 1.3, P(M(sx * w / 2, 0, sz * d / 2)))
      for (let f = 0; f < 4; f++) {
        const wide = f % 2 === 0 ? w : d, out = f % 2 === 0 ? d / 2 : w / 2
        windows(P(new THREE.Matrix4().makeRotationY(f * Math.PI / 2).multiply(M(0, 0.6, out))), wide, h - 0.6, tint, lit, f === 0)
      }
      const top = new THREE.Vector3(0, h + 0.7, 0).applyMatrix4(at)
      if (roof === 'dome') dome(top.x, top.y, top.z, Math.min(w, d) * 0.34)
      if (roof === 'turrets') for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const c = new THREE.Vector3(sx * (w / 2 - 1), h + 0.7, sz * (d / 2 - 1)).applyMatrix4(at); dome(c.x, c.y, c.z, 1.7) }
      blocked.push({ x, z, r: Math.hypot(w, d) / 2 + 1.5 })
    }
    const tower = (x: number, z: number, r: number, h: number, y = G - 0.6, tint = TEAL) => {
      kit.put('stone', new THREE.CylinderGeometry(r * 1.25, r * 1.35, 1.6, 16).translate(0, 0.8, 0), M(x, y, z))
      kit.put('stone', new THREE.CylinderGeometry(r * 0.88, r, h, 16).translate(0, h / 2, 0), M(x, y, z))
      kit.put('stone', new THREE.CylinderGeometry(r * 1.45, r * 0.95, 0.9, 16).translate(0, h * 0.72, 0), M(x, y, z))       // balcony
      kit.put('stone', new THREE.CylinderGeometry(r * 1.2, r * 0.9, 0.8, 16).translate(0, h - 0.4, 0), M(x, y, z))
      for (const [lv, n] of [[0.36, 5], [0.8, 6]] as const) for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + lv * 3, rr = r * (1 - 0.12 * lv) + 0.06
        kit.put('win', pane(Math.min(1.0, r * 0.5), 2.4), M(x + Math.sin(a) * rr, y + h * lv, z + Math.cos(a) * rr, a), windowTint(tint, seed++))
      }
      dome(x, y + h, z, r * 1.08)
      blocked.push({ x, z, r: r + 2 })
    }
    const lantern = (x: number, z: number, y = G, c = new THREE.Color(1.0, 0.78, 0.32), post = 5.6) => {
      kit.put('metal', new THREE.CylinderGeometry(0.42, 0.55, 0.7, 8).translate(0, 0.35, 0), M(x, y, z))
      kit.put('metal', new THREE.CylinderGeometry(0.1, 0.16, post, 8).translate(0, post / 2, 0), M(x, y, z))
      kit.put('metal', new THREE.TorusGeometry(0.5, 0.05, 6, 16).rotateX(Math.PI / 2), M(x, y + post + 0.35, z))
      kit.put('orb', new THREE.SphereGeometry(0.46, 14, 10), M(x, y + post + 0.75, z), c.clone().multiplyScalar(3.2))
      orbs.push({ p: new THREE.Vector3(x, y + post + 0.75, z), c, s: 1 })
    }
    const light = (x: number, y: number, z: number, r: number, c: THREE.Color, orb = 0) => {
      lights.push({ p: new THREE.Vector3(x, y, z), r, c })
      if (orb > 0) {
        kit.put('orb', new THREE.SphereGeometry(orb, 16, 12), M(x, y, z), c.clone().multiplyScalar(2.2))
        orbs.push({ p: new THREE.Vector3(x, y, z), c: c.clone().multiplyScalar(0.6), s: orb * 2.4 })
      }
    }

    // ---- the avenue ---------------------------------------------------------------------
    kit.box('stone', 20, 0.5, 126, M(0, G - 0.25, -190))
    for (const s of [1, -1]) kit.box('stone', 1.2, 0.5, 126, M(s * 10.4, G - 0.05, -190))
    for (let k = 0; k < LAMP_N; k++) for (const s of [1, -1]) lantern(s * LAMP_X, LAMP_Z0 - k * LAMP_STEP)
    // colonnades: some columns still carry their lintel, some have fallen
    const colGeo = columnGeo(9)
    const cols: THREE.Matrix4[] = []
    for (const s of [1, -1]) {
      let prev = false
      for (let k = 0; k < 13; k++) {
        const z = -164 - k * 6
        if (Math.abs(z + 200) < 9) { prev = false; continue }
        const fate = hash(k * 7.3 + s * 3.1)
        if (fate < 0.14) { cols.push(M(s * 14.5, G + 0.6, z + 2).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(1.45, hash(k) * 3, 0)))); prev = false; continue }
        const broken = fate > 0.8
        cols.push(M(s * 14, G - 0.3, z, hash(k) * 6, 1, broken ? 0.3 + hash(k * 3) * 0.3 : 1, 1))
        if (!broken && prev) kit.box('stone', 1.7, 1.0, 6.6, M(s * 14, G + 8.7, z + 3))
        prev = !broken
      }
    }
    // the gate: an arched bridge between two piers, lanterns hanging under it
    kit.put('stone', archWall(38, 21, 22, 8, 5.5), M(0, G - 0.5, -200))
    kit.box('stone', 40, 1.0, 7.5, M(0, G + 20.5, -200))
    for (const s of [1, -1]) {
      kit.box('stone', 9, 24, 9, M(s * 15.5, G - 0.5, -200))
      kit.box('stone', 10.2, 1.0, 10.2, M(s * 15.5, G + 23.5, -200))
      dome(s * 15.5, G + 24.5, -200, 3.6)
      for (const f of [0, 2]) windows(M(s * 15.5, G + 9, -200, f * Math.PI / 2).multiply(M(0, 0, 4.5)), 8.8, 13, TEAL, 0.9)
      for (let k = -1; k <= 1; k++) for (const sz of [1, -1]) kit.box('stone', 0.5, 1.5, 0.5, M(s * (4 + (k + 1) * 3.2), G + 21.5, -200 + sz * 3.4))
      light(s * 15.5, G + 27.5, -200, 9, new THREE.Color(0.5, 1.5, 1.1))
      blocked.push({ x: s * 15.5, z: -200, r: 8 })
    }
    light(0, G + 17.6, -200, 9, new THREE.Color(0.7, 1.6, 1.2), 0.7)

    // ---- the palace: a platform, a great stair, and a rotunda open on all four sides ----
    kit.box('stone', 96, 2.7, 66, M(0, G - 0.5 + 0.5, PALACE_Z))
    kit.box('stone', 88, 5.3, 58, M(0, G, PALACE_Z))
    kit.box('stone', 80, 8, 50, M(0, G, PALACE_Z))
    for (const dir of [1, -1]) for (let i = 0; i < 20; i++) {               // front stair (toward the avenue) and its twin behind
      const z0 = PALACE_Z + dir * (47 - 1.1 * i), z1 = PALACE_Z + dir * 25
      kit.box('stone', i < 6 ? 44 - i * 2 : 25, 0.4 * (i + 1), Math.abs(z1 - z0), M(0, G, (z0 + z1) / 2))
    }
    for (const s of [1, -1]) for (const dir of [1, -1]) {
      kit.box('stone', 3.2, 5.5, 3.2, M(s * 14.2, G, PALACE_Z + dir * 40)); kit.box('stone', 3.8, 0.6, 3.8, M(s * 14.2, G + 5.5, PALACE_Z + dir * 40))
      kit.box('stone', 3.2, 11.5, 3.2, M(s * 14.2, G, PALACE_Z + dir * 27)); kit.box('stone', 3.8, 0.6, 3.8, M(s * 14.2, G + 11.5, PALACE_Z + dir * 27))
      kit.box('stone', 1.4, 7, 13, M(s * 14.2, G, PALACE_Z + dir * 33.5))
      if (dir > 0) {
        light(s * 14.2, G + 7.2, PALACE_Z + 40, 7, new THREE.Color(1.7, 1.15, 0.5), 0.75)
        light(s * 14.2, G + 13.2, PALACE_Z + 27, 7, new THREE.Color(1.7, 1.15, 0.5), 0.75)
      }
    }
    const R = 13                                                              // rotunda: half the distance between its piers
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      kit.box('stone', 7, 25, 7, M(sx * R, P0, PALACE_Z + sz * R))
      kit.box('stone', 8.2, 1.2, 8.2, M(sx * R, P0, PALACE_Z + sz * R)); kit.box('stone', 8, 1, 8, M(sx * R, P0 + 11.4, PALACE_Z + sz * R))
    }
    for (let f = 0; f < 4; f++) kit.put('stone', archWall(2 * R, 25, 19, 11.5, 5), new THREE.Matrix4().makeTranslation(0, P0, PALACE_Z).multiply(new THREE.Matrix4().makeRotationY(f * Math.PI / 2)).multiply(M(0, 0, R)))
    const ring = new THREE.Shape(); ring.moveTo(-18, -18); ring.lineTo(18, -18); ring.lineTo(18, 18); ring.lineTo(-18, 18); ring.lineTo(-18, -18)
    ring.holes.push(new THREE.Path().absarc(0, 0, 12.6, 0, Math.PI * 2, true))
    kit.put('stone', new THREE.ExtrudeGeometry(ring, { depth: 2.2, bevelEnabled: false, curveSegments: 20 }).rotateX(-Math.PI / 2), M(0, P0 + 25, PALACE_Z))
    kit.put('domeIn', new THREE.CylinderGeometry(13.6, 13.6, 6.5, 32, 1, true).translate(0, 3.25, 0), M(0, P0 + 27, PALACE_Z))
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; kit.put('win', pane(1.5, 3.6), M(Math.sin(a) * 13.68, P0 + 28.4, PALACE_Z + Math.cos(a) * 13.68, a), windowTint(TEAL, k + 40)); kit.put('win', pane(1.5, 3.6), M(Math.sin(a) * 13.5, P0 + 28.4, PALACE_Z + Math.cos(a) * 13.5, a + Math.PI), windowTint(TEAL, k + 40)) }
    kit.put('stone', new THREE.TorusGeometry(13.9, 0.55, 8, 32).rotateX(Math.PI / 2), M(0, P0 + 33.5, PALACE_Z))
    kit.put('domeIn', domeGeo(13.8, 36), M(0, P0 + 33.5, PALACE_Z))
    finial(0, P0 + 33.5 + 15.4, PALACE_Z, 2.6)
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) dome(sx * 15.2, P0 + 27.2, PALACE_Z + sz * 15.2, 2.6)
    light(0, P0 + 21, PALACE_Z, 17, new THREE.Color(0.9, 2.1, 1.6), 1.5)                                                // the lamp under the dome
    kit.put('metal', new THREE.CylinderGeometry(0.06, 0.06, 12, 5).translate(0, 6, 0), M(0, P0 + 22.4, PALACE_Z))
    // wings and towers
    for (const s of [1, -1]) {
      hall(s * 28.5, PALACE_Z, 22, 38, 17, { y: P0, tint: WARM, roof: 'dome', lit: 0.85 })
      tower(s * 40.5, PALACE_Z + 21.5, 3.6, 31, P0, TEAL); tower(s * 40.5, PALACE_Z - 21.5, 3.6, 31, P0, TEAL)
      tower(s * 19.5, PALACE_Z + 29, 1.9, 30, G + 5, WARM)
      light(s * 28, P0 + 5, PALACE_Z + 24, 10, new THREE.Color(1.3, 0.9, 0.4))
    }
    light(0, G + 6, PALACE_Z - 52, 9, new THREE.Color(0.5, 1.4, 1.1), 0.6)
    blocked.push({ x: 0, z: PALACE_Z, r: 62 })

    // ---- the town around it ---------------------------------------------------------------
    const town: [number, number, number, number, number, 'dome' | 'turrets' | 'flat', number][] = [
      [-35, -172, 18, 20, 14, 'dome', 0.1], [-37, -206, 15, 15, 21, 'turrets', -0.05], [-34, -238, 19, 17, 12, 'dome', 0.08],
      [-63, -190, 22, 24, 17, 'dome', 0.2], [-66, -232, 17, 19, 22, 'turrets', -0.1], [-60, -150, 16, 17, 10, 'flat', 0.3], [-76, -280, 17, 22, 14, 'dome', 0],
      [34, -166, 17, 18, 12, 'dome', -0.12], [37, -203, 16, 18, 19, 'dome', 0.06], [35, -236, 18, 16, 13, 'turrets', -0.04],
      [62, -178, 20, 22, 16, 'turrets', -0.2], [66, -220, 18, 20, 23, 'dome', 0.12], [61, -146, 15, 16, 9, 'flat', -0.3], [77, -272, 18, 22, 15, 'dome', 0],
      [-34, -356, 16, 16, 11, 'dome', 0.2], [32, -360, 17, 15, 12, 'flat', -0.15], [-96, -215, 18, 18, 13, 'dome', 0.4], [98, -200, 18, 20, 14, 'dome', -0.4],
    ]
    town.forEach(([x, z, w, d, h, roof, ry], i) => hall(x, z, w, d, h, { ry: ry + (x < 0 ? Math.PI / 2 : -Math.PI / 2), roof, tint: i % 3 === 1 ? TEAL : WARM, lit: 0.45 + hash(i * 3.3) * 0.4, lean: i % 6 === 5 ? [0.09, -0.06] : undefined }))
    for (const [x, z, r, h] of [[-24, -186, 2.3, 22], [25, -150, 2.6, 18], [-49, -220, 2.8, 26], [50, -247, 2.6, 24], [-50, -160, 2.4, 19], [48, -190, 2.2, 21], [-88, -250, 3, 27], [90, -240, 3, 25]]) tower(x, z, r, h, G - 0.6, hash(x) > 0.5 ? TEAL : WARM)

    // ---- the white tree: a coral that grew where a fountain stood ---------------------------
    const TREE = new THREE.Vector3(-13.5, G, -156)
    kit.put('stone', new THREE.CylinderGeometry(4.6, 5.0, 1.0, 20).translate(0, 0.5, 0), M(TREE.x, G - 0.3, TREE.z))
    const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
      const to = from.clone().addScaledVector(dir, len)
      const seg = new THREE.CylinderGeometry(rad * 0.7, rad, len, 6, 1, true).translate(0, len / 2, 0)
      kit.put('coral', seg, new THREE.Matrix4().compose(from, new THREE.Quaternion().setFromUnitVectors(THREE.Object3D.DEFAULT_UP, dir), new THREE.Vector3(1, 1, 1)))
      if (depth === 0) { kit.put('coral', new THREE.SphereGeometry(rad * 1.5, 6, 5), new THREE.Matrix4().makeTranslation(to.x, to.y, to.z)); return }
      const kids = depth > 3 ? 3 : 2 + (rnd() > 0.5 ? 1 : 0)
      for (let k = 0; k < kids; k++) {
        const a = (k / kids) * Math.PI * 2 + rnd() * 2, spread = 0.45 + rnd() * 0.4
        const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
        const d = dir.clone().multiplyScalar(1 - spread * 0.5).addScaledVector(side, spread).add(new THREE.Vector3(0, 0.12, 0)).normalize()
        grow(to, d, len * (0.68 + rnd() * 0.14), rad * 0.68, depth - 1)
      }
    }
    grow(new THREE.Vector3(TREE.x, G + 0.5, TREE.z), new THREE.Vector3(0.05, 1, 0).normalize(), 4.2, 0.55, 5)
    light(TREE.x, G + 9, TREE.z, 12, new THREE.Color(1.1, 1.7, 1.9))
    orbs.push({ p: new THREE.Vector3(TREE.x, G + 9.5, TREE.z), c: new THREE.Color(0.35, 0.6, 0.7), s: 9 })
    blocked.push({ x: TREE.x, z: TREE.z, r: 7 })

    // ---- ruins: carved blocks and steps lying where they fell --------------------------------
    const blockM: THREE.Matrix4[] = []
    const e = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3()
    const free = (x: number, z: number, pad = 0) => !blocked.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + pad)
    for (let i = 0; i < 420; i++) {
      const near = i < 150
      const x = near ? (hash(i * 1.7) - 0.5) * 70 : (hash(i * 1.7) - 0.5) * 300, z = near ? -130 - hash(i * 2.3) * 44 : CITY_Z + (hash(i * 2.3) - 0.5) * 380
      if (Math.abs(x) < 10.5 || !free(x, z, 0.5)) continue
      const big = hash(i * 5.1) ** 2.2
      sc.set(1 + big * 3.5, 0.7 + hash(i * 6.7) * 1.6, 1 + hash(i * 8.9) * 2.4)
      const tilted = hash(i * 4.4) > 0.55
      q.setFromEuler(e.set(tilted ? (hash(i * 9.1) - 0.5) * 0.7 : 0, hash(i * 3.9) * 6.28, tilted ? (hash(i * 7.7) - 0.5) * 0.7 : 0))
      const y = seabedHeight(x, z)
      blockM.push(new THREE.Matrix4().compose(v.set(x, y + sc.y * 0.18, z), q, sc))
      if (hash(i * 12.3) > 0.72 && !tilted) {                                  // a flight of steps: slabs stacked back
        for (let s2 = 1; s2 < 4; s2++) blockM.push(new THREE.Matrix4().compose(v.set(x, y + sc.y * (0.18 + s2 * 0.75), z).add(new THREE.Vector3(0, 0, s2 * sc.z * 0.22).applyQuaternion(q)), q, new THREE.Vector3(sc.x, sc.y, sc.z * (1 - s2 * 0.22))))
      }
    }

    // ---- hand everything to the renderer -------------------------------------------------------
    lights.slice(0, GLOW_N).forEach((l) => { glow.uGlowPos.value.push(new THREE.Vector4(l.p.x, l.p.y, l.p.z, l.r)); glow.uGlowCol.value.push(new THREE.Vector3(l.c.r, l.c.g, l.c.b)) })
    while (glow.uGlowPos.value.length < GLOW_N) { glow.uGlowPos.value.push(new THREE.Vector4(0, 9999, 0, 1)); glow.uGlowCol.value.push(new THREE.Vector3()) }
    const stoneMat = stone('#93a096')
    const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true })
    this.group.add(
      kit.mesh('stone', stoneMat),
      kit.mesh('dome', stone('#2f8f86', { blocks: false, rough: 0.55, metal: 0.35 })),
      kit.mesh('domeIn', stone('#3f8f8a', { blocks: false, wrap: 1, side: THREE.DoubleSide, rough: 0.7 })),
      kit.mesh('gold', new THREE.MeshStandardMaterial({ color: '#c9a550', metalness: 1, roughness: 0.35, emissive: '#6a4a10', emissiveIntensity: 0.6 })),
      kit.mesh('metal', stone('#2c3a36', { blocks: false, rough: 0.7, metal: 0.4 })),
      kit.mesh('win', lightMat), kit.mesh('orb', lightMat),
      kit.mesh('dark', new THREE.MeshStandardMaterial({ color: '#04090a', roughness: 0.4 })),
      kit.mesh('coral', new THREE.MeshStandardMaterial({ color: '#dfeff2', roughness: 0.6, emissive: '#9fdcec', emissiveIntensity: 1.25 })),
    )
    const colMesh = new THREE.InstancedMesh(colGeo, stoneMat, cols.length)
    cols.forEach((m, i) => colMesh.setMatrixAt(i, m))
    const blockMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stoneMat, blockM.length)
    blockM.forEach((m, i) => blockMesh.setMatrixAt(i, m))
    colMesh.frustumCulled = blockMesh.frustumCulled = false
    this.group.add(colMesh, blockMesh)

    // ---- halos: the soft bloom of light around each lantern, and glowing growths on the ground ----
    const flora = 520, HN = orbs.length + flora
    const hp = new Float32Array(HN * 3), hc = new Float32Array(HN * 3), hs = new Float32Array(HN), hseed = new Float32Array(HN)
    orbs.forEach((o, i) => { hp.set([o.p.x, o.p.y, o.p.z], i * 3); hc.set([o.c.r, o.c.g, o.c.b], i * 3); hs[i] = 5.5 * o.s; hseed[i] = -1 })
    const palette = [[0.2, 1.0, 0.75], [1.0, 0.8, 0.3], [0.3, 0.8, 1.0], [0.75, 1.0, 0.5]]
    for (let i = 0, k = orbs.length; k < HN; i++, k++) {
      let x = (hash(i * 1.9) - 0.5) * 240, z = CITY_Z + (hash(i * 3.3) - 0.5) * 320
      if (hash(i * 7.1) < 0.4) { x = (hash(i * 1.9) - 0.5) * 60; z = -128 - hash(i * 3.3) * 110 }                    // thicker along the avenue
      const y = Math.abs(x) < 40 && z < -240 && z > -334 ? -9999 : seabedHeight(x, z) + 0.25 + hash(i * 9.9) * 0.5
      hp.set([x, y, z], k * 3); hc.set(palette[(i * 7) % 4], k * 3); hs[k] = 0.5 + hash(i * 4.7) * 0.7; hseed[k] = hash(i * 8.1) * 40
    }
    const hg = new THREE.BufferGeometry()
    hg.setAttribute('position', new THREE.BufferAttribute(hp, 3)); hg.setAttribute('color', new THREE.BufferAttribute(hc, 3))
    hg.setAttribute('aSize', new THREE.BufferAttribute(hs, 1)); hg.setAttribute('aSeed', new THREE.BufferAttribute(hseed, 1))
    this.halos = new THREE.Points(hg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, uniforms: { uTime: sea.uTime },
      vertexShader: /* glsl */ `attribute float aSize, aSeed; uniform float uTime; varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float pulse = aSeed < 0.0 ? 0.92 + 0.08 * sin(uTime * 2.3 + position.z) : 0.35 + 0.65 * pow(max(sin(uTime * 0.8 + aSeed), 0.0), 2.0);
          vC = color * pulse * exp(-pow(-mv.z * 0.0042, 2.0)) * (aSeed < 0.0 ? 0.5 : 0.8);
          gl_Position = projectionMatrix * mv; gl_PointSize = min(aSize * 620.0 / -mv.z, 220.0);
        }`,
      fragmentShader: /* glsl */ `varying vec3 vC;
        void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(1.0 - d, 0.0), 2.2); gl_FragColor = vec4(vC * a, 1.0); }`,
    }))
    this.halos.frustumCulled = false
    this.group.add(this.halos)

    // ---- kelp: tall swaying fronds between the buildings ----------------------------------------
    kelpTex.colorSpace = THREE.SRGBColorSpace
    const cards: THREE.BufferGeometry[] = []
    for (let i = 0; i < 2; i++) cards.push(new THREE.PlaneGeometry(1.6, 1, 1, 6).translate(0, 0.5, 0).rotateY((i / 2) * Math.PI))
    const kelpMat = new THREE.MeshStandardMaterial({ map: kelpTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 })
    kelpMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, sea)
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
          {
            vec3 at = instanceMatrix[3].xyz; float w = uv.y * uv.y;                        // the tip swings, the holdfast does not
            transformed.x += sin(uTime * 0.9 + at.x * 0.3 + uv.y * 3.0) * w * 0.28;
            transformed.z += cos(uTime * 0.7 + at.z * 0.3 + uv.y * 2.2) * w * 0.22;
          }`)
    }
    const COUNT = 2200
    const kelp = new THREE.InstancedMesh(mergeGeometries(cards)!, kelpMat, COUNT)
    const c = new THREE.Color(), m = new THREE.Matrix4()
    let n = 0
    for (let k = 0; n < COUNT && k < COUNT * 20; k++) {
      const x = (hash(k * 1.3) - 0.5) * 460, z = CITY_Z + (hash(k * 2.9) - 0.5) * 600
      if (vnoise(x * 0.04, z * 0.04) < 0.42 || Math.abs(x) < 17 || z < -395 || !free(x, z, 1)) continue
      const tall = 4 + hash(k * 6.1) * 10
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hash(k * 7.7) * 6.28)
      kelp.setMatrixAt(n, m.compose(v.set(x, seabedHeight(x, z) - 0.2, z), q, sc.set(1 + hash(k * 3.9), tall, 1 + hash(k * 3.9))))
      kelp.setColorAt(n, c.setRGB(0.55 + hash(k * 5.5) * 0.4, 0.75 + hash(k * 9.1) * 0.3, 0.4 + hash(k * 2.2) * 0.3))
      n++
    }
    kelp.count = n
    kelp.frustumCulled = false
    this.group.add(kelp)
  }
}
