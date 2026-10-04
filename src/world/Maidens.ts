import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { addCaustics, sea } from './Underwater'

// which part of the figure a vertex belongs to (the shader moves and colours each differently)
const BODY = 0, HEAD = 1, ARM = 2, HAIR = 3, FLUKE = 4

/** Tags a geometry with its part and a 0..1 "how far along" value (root → tip). */
function tag(geo: THREE.BufferGeometry, part: number, along: (i: number, g: THREE.BufferGeometry) => number) {
  const g = geo.index ? geo.toNonIndexed() : geo
  const n = g.attributes.position.count, a = new Float32Array(n), p = new Float32Array(n).fill(part)
  for (let i = 0; i < n; i++) a[i] = along(i, g)
  g.setAttribute('aPart', new THREE.BufferAttribute(p, 1)); g.setAttribute('aAlong', new THREE.BufferAttribute(a, 1))
  g.deleteAttribute('uv')
  return g
}

/** One sea maiden, nose toward +z, back toward +y: torso, arms, long hair and a fish tail ending in a wide fluke. */
function buildFigure() {
  // ---- torso and tail: one tube whose cross-section changes along the spine ----
  const S: [number, number, number][] = [   // z, half-width, half-thickness
    [0.80, 0.045, 0.045], [0.74, 0.05, 0.05], [0.70, 0.12, 0.07], [0.66, 0.185, 0.085], [0.58, 0.165, 0.11], [0.47, 0.135, 0.095], [0.36, 0.115, 0.085],
    [0.26, 0.14, 0.10], [0.14, 0.17, 0.115], [-0.05, 0.155, 0.115], [-0.35, 0.125, 0.105], [-0.7, 0.085, 0.08], [-1.0, 0.05, 0.055], [-1.2, 0.028, 0.035], [-1.3, 0.02, 0.02],
  ]
  const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)
  const rings: [number, number, number][] = []
  for (let i = 0; i < S.length - 1; i++) for (let k = 0; k < 4; k++) {
    const a = S[Math.max(i - 1, 0)], b = S[i], c = S[i + 1], d = S[Math.min(i + 2, S.length - 1)], t = k / 4
    rings.push([cr(a[0], b[0], c[0], d[0], t), Math.max(0.01, cr(a[1], b[1], c[1], d[1], t)), Math.max(0.01, cr(a[2], b[2], c[2], d[2], t))])
  }
  rings.push(S[S.length - 1])
  const SEG = 14, pos: number[] = [], idx: number[] = []
  rings.forEach(([z, rx, ry]) => { for (let s = 0; s <= SEG; s++) { const a = (s / SEG) * Math.PI * 2; pos.push(Math.sin(a) * rx, Math.cos(a) * ry, z) } })
  for (let r = 0; r < rings.length - 1; r++) for (let s = 0; s < SEG; s++) { const a = r * (SEG + 1) + s, b = a + SEG + 1; idx.push(a, a + 1, b, a + 1, b + 1, b) }
  const tube = new THREE.BufferGeometry()
  tube.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tube.setIndex(idx); tube.computeVertexNormals()
  const parts = [tag(tube, BODY, () => 0)]

  // ---- head, and the hair that covers the back of it ----
  parts.push(tag(new THREE.SphereGeometry(0.115, 16, 12).scale(0.92, 1.05, 1.0).translate(0, 0.02, 0.9), HEAD, () => 0))
  parts.push(tag(new THREE.SphereGeometry(0.126, 16, 12).translate(0, 0.05, 0.872), HAIR, () => 0))
  for (let h = 0; h < 18; h++) {
    const phi = ((h + 0.5) / 18 - 0.5) * 3.7, len = 0.5 + ((h * 7) % 5) * 0.12, lift = 0.13 + ((h * 3) % 4) * 0.02
    const hp: number[] = [], hi: number[] = [], al: number[] = []
    const N = 9
    for (let k = 0; k <= N; k++) {
      const t = k / N, w = 0.045 * (1 - t * 0.7)
      const cx = Math.sin(phi) * 0.115 * (1 + t * 1.5), cy = THREE.MathUtils.lerp(0.05 + Math.cos(phi) * 0.115, lift + Math.abs(Math.sin(phi)) * -0.06, Math.min(1, t * 2.2)), cz = 0.86 - t * len
      hp.push(cx - Math.cos(phi) * w, cy + Math.sin(phi) * w, cz, cx + Math.cos(phi) * w, cy - Math.sin(phi) * w, cz); al.push(t, t)
      if (k < N) { const o = k * 2; hi.push(o, o + 1, o + 2, o + 1, o + 3, o + 2) }
    }
    const strand = new THREE.BufferGeometry()
    strand.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); strand.setAttribute('aTmp', new THREE.Float32BufferAttribute(al, 1)); strand.setIndex(hi); strand.computeVertexNormals()
    const flat = strand.toNonIndexed(), tmp = flat.attributes.aTmp
    flat.deleteAttribute('aTmp')
    parts.push(tag(flat, HAIR, (i) => tmp.getX(i)))
  }

  // ---- arms, trailing back along the body ----
  for (const s of [1, -1]) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 0.175, 0, 0.665), new THREE.Vector3(s * 0.265, -0.02, 0.5), new THREE.Vector3(s * 0.3, -0.035, 0.31), new THREE.Vector3(s * 0.275, -0.02, 0.12)])
    const arm = new THREE.TubeGeometry(curve, 12, 0.036, 7, false)
    const flat = arm.toNonIndexed(), uv = flat.attributes.uv.clone()
    parts.push(tag(flat, ARM, (i) => uv.getX(i)))
    parts.push(tag(new THREE.SphereGeometry(0.04, 8, 6).scale(0.8, 0.6, 1.5).translate(s * 0.272, -0.02, 0.08), ARM, () => 1))
  }

  // ---- fluke: a wide crescent ----
  const fp: number[] = [], fi: number[] = [], fa: number[] = []
  const FU = 14, FV = 6
  for (let j = 0; j <= FV; j++) for (let i = 0; i <= FU; i++) {
    const u = (i / FU) * 2 - 1, vv = j / FV
    fp.push(u * 0.46 * vv ** 0.7 + u * 0.015, 0, -1.27 - vv * (0.2 + 0.36 * Math.abs(u) ** 1.4)); fa.push(vv)
  }
  for (let j = 0; j < FV; j++) for (let i = 0; i < FU; i++) { const a = j * (FU + 1) + i, b = a + FU + 1; fi.push(a, b, a + 1, a + 1, b, b + 1) }
  const fl = new THREE.BufferGeometry()
  fl.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fl.setAttribute('aTmp', new THREE.Float32BufferAttribute(fa, 1)); fl.setIndex(fi); fl.computeVertexNormals()
  const flFlat = fl.toNonIndexed(), ftmp = flFlat.attributes.aTmp
  flFlat.deleteAttribute('aTmp')
  parts.push(tag(flFlat, FLUKE, (i) => ftmp.getX(i)))

  return mergeGeometries(parts)!
}

interface Route { centre: [number, number, number]; radius: [number, number, number]; speed: number; phase: number; dir: 1 | -1 }

/** Five sea maidens swimming their own loops through the city. Brush one with the pointer and she twirls. */
export class Maidens {
  mesh: THREE.InstancedMesh
  private routes: Route[] = [
    { centre: [0, -83.5, -143], radius: [9, 1.6, 12], speed: 2.3, phase: 0.4, dir: 1 },
    { centre: [1, -81, -150], radius: [14, 2.4, 19], speed: 2.6, phase: 3.3, dir: -1 },
    { centre: [-13.5, -80, -156], radius: [8.5, 3, 8.5], speed: 2.0, phase: 1.7, dir: 1 },
    { centre: [0, -79, -206], radius: [7, 3, 42], speed: 2.8, phase: 5.0, dir: 1 },
    { centre: [0, -72, -246], radius: [19, 3.5, 9], speed: 2.4, phase: 2.2, dir: -1 },
  ]
  private angle: number[]
  private twirl = [0, 0, 0, 0, 0]
  private roll = [0, 0, 0, 0, 0]
  private m = new THREE.Matrix4()
  private p = new THREE.Vector3()
  private ahead = new THREE.Vector3()
  private q = new THREE.Quaternion()
  private qr = new THREE.Quaternion()
  private tmp = new THREE.Vector3()
  private s = new THREE.Vector3(1.2, 1.2, 1.2)

  constructor() {
    const geo = buildFigure()
    const N = this.routes.length
    const tails = [[0.05, 0.62, 0.45], [0.42, 0.2, 0.75], [0.05, 0.5, 0.8], [0.85, 0.3, 0.42], [0.8, 0.6, 0.15]]
    const hairs = [[0.55, 0.16, 0.08], [0.9, 0.88, 0.82], [0.05, 0.05, 0.07], [0.12, 0.35, 0.4], [0.75, 0.55, 0.2]]
    const skins = [[0.78, 0.56, 0.45], [0.62, 0.42, 0.32], [0.8, 0.62, 0.52], [0.5, 0.33, 0.25], [0.72, 0.52, 0.42]]
    const flat = (a: number[][]) => new THREE.InstancedBufferAttribute(new Float32Array(a.flat()), 3)
    geo.setAttribute('aTail', flat(tails)); geo.setAttribute('aHair', flat(hairs)); geo.setAttribute('aSkin', flat(skins))
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array([0, 1.7, 3.1, 4.4, 5.6]), 1))
    const mat = addCaustics(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, side: THREE.DoubleSide }), (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */ `#include <common>
          attribute float aPart, aAlong, aPhase; attribute vec3 aTail, aHair, aSkin; uniform float uTime;
          varying vec3 vFig; varying float vPart, vAlong; varying vec3 vTail, vHair, vSkin;`)
        .replace('#include <begin_vertex>', /* glsl */ `
          vec3 transformed = vec3(position);
          {
            vFig = position; vPart = aPart; vAlong = aAlong; vTail = aTail; vHair = aHair; vSkin = aSkin;
            float t = uTime * 4.2 + aPhase;
            // the kick: a wave that starts small at the shoulders and grows all the way to the fluke
            float amp = 0.012 + 0.2 * pow(smoothstep(0.55, -1.8, position.z), 1.35);
            transformed.y += sin(t + position.z * 2.5) * amp;
            if (aPart > 3.5) transformed.y += sin(t + position.z * 2.5 - 0.9) * 0.1 * aAlong;                 // the fluke lags and flexes
            if (aPart > 1.5 && aPart < 2.5) { transformed.y += sin(t * 0.5 + 1.0) * 0.07 * aAlong; transformed.x += sign(position.x) * (0.03 + 0.03 * sin(t * 0.5)) * aAlong; }
            if (aPart > 2.5 && aPart < 3.5) {                                                                  // hair streams and ripples
              transformed.y += sin(t * 0.8 + aAlong * 5.0 + position.x * 9.0) * 0.06 * aAlong + 0.03 * aAlong;
              transformed.x += cos(t * 0.6 + aAlong * 4.0 + position.x * 5.0) * 0.045 * aAlong;
            }
          }`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
          varying vec3 vFig; varying float vPart, vAlong; varying vec3 vTail, vHair, vSkin; float gTail = 0.0;`)
        .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
          {
            float ang = atan(vFig.x, vFig.y);
            // scales: staggered rows of overlapping arcs, darker at the root of each
            vec2 sc = vec2(ang / 6.2832 * 16.0, vFig.z * 26.0); float row = floor(sc.y);
            vec2 cell = fract(vec2(sc.x + 0.5 * mod(row, 2.0), sc.y));
            float scale = 0.55 + 0.6 * cell.y - 0.5 * smoothstep(0.25, 0.5, abs(cell.x - 0.5)) * (1.0 - cell.y);
            float tailMask = smoothstep(0.25, 0.17, vFig.z + 0.035 * sin(ang * 5.0));
            float band = smoothstep(0.49, 0.515, vFig.z) * smoothstep(0.65, 0.625, vFig.z + 0.02 * cos(ang * 2.0)) * step(abs(vFig.x), 0.172);
            vec3 tail = mix(vTail, vTail * 0.35 + vec3(0.0, 0.05, 0.1), smoothstep(-0.2, -1.3, vFig.z)) * scale;
            vec3 col = vSkin;
            if (vPart < 0.5) { gTail = max(tailMask, band); col = mix(vSkin, tail, gTail); }
            else if (vPart > 3.5) { gTail = 1.0; col = mix(vTail * 0.5, vTail * 1.3 + 0.15, vAlong) * (0.75 + 0.25 * sin(vFig.x * 90.0)); }   // fin rays
            else if (vPart > 2.5) col = vHair * (0.65 + 0.5 * sin(vFig.x * 160.0 + vFig.y * 90.0) * 0.5 + 0.35 * vAlong);
            diffuseColor.rgb = col;
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, gTail);')
        .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * (0.16 + gTail * 0.3);                                   // so they read against the dark water`)
    })
    this.mesh = new THREE.InstancedMesh(geo, mat, N)
    this.mesh.frustumCulled = false
    this.angle = this.routes.map((r) => r.phase)
  }

  private at(r: Route, a: number, out: THREE.Vector3) {
    return out.set(r.centre[0] + Math.cos(a) * r.radius[0], r.centre[1] + Math.sin(a * 2 + r.phase) * r.radius[1], r.centre[2] + Math.sin(a) * r.radius[2])
  }

  /** ray: the pointer's line of sight (or null). */
  update(time: number, dt: number, ray: THREE.Ray | null) {
    this.routes.forEach((r, i) => {
      const rate = r.speed / Math.hypot(r.radius[0], r.radius[2]) * 1.35
      this.angle[i] += r.dir * rate * dt * (1 + this.twirl[i] * 0.8)
      this.at(r, this.angle[i], this.p)
      this.at(r, this.angle[i] + r.dir * 0.06, this.ahead)
      if (ray && this.twirl[i] < 0.05 && ray.distanceSqToPoint(this.p) < 9 && this.p.distanceToSquared(ray.origin) < 70 * 70) this.twirl[i] = 1
      this.twirl[i] = Math.max(0, this.twirl[i] - dt * 0.55)
      this.roll[i] += dt * this.twirl[i] * 7
      this.m.lookAt(this.ahead, this.p, THREE.Object3D.DEFAULT_UP)
      this.q.setFromRotationMatrix(this.m)
      // bank into the turn, plus the twirl
      this.qr.setFromAxisAngle(this.tmp.set(0, 0, 1), -r.dir * 0.35 + this.roll[i] + Math.sin(time * 0.4 + i) * 0.1)
      this.q.multiply(this.qr)
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s))
    })
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
// keep the shared clock referenced so tree-shaking never drops the uniform link
void sea
