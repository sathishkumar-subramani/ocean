import * as THREE from 'three'
import { hash, smoothstep, vnoise } from '../core/math'
import { sea } from './Underwater'

const CONE_R = 78, CONE_H = 64, CRATER_R = 10
const SMOKE = 620, EMBERS = 420

/**
 * The deep: an undersea volcano. No sunlight reaches here, so the only light
 * is its own — lava in the crater and in the channels down its flanks, a
 * plume of ash, and sparks that the pointer can push around.
 */
export class Deep {
  group = new THREE.Group()
  crater = new THREE.Vector3()
  /** Lives in the scene itself (not in the group), so hiding the volcano never changes the number of lights. */
  lamp: THREE.PointLight
  private halo: THREE.Sprite
  private smoke: THREE.Points
  private embers: THREE.Points
  private sPos = new Float32Array(SMOKE * 3); private sVel = new Float32Array(SMOKE * 3); private sAge = new Float32Array(SMOKE).fill(99); private sLife = new Float32Array(SMOKE).fill(1)
  private ePos = new Float32Array(EMBERS * 3); private eVel = new Float32Array(EMBERS * 3); private eAge = new Float32Array(EMBERS).fill(99); private eLife = new Float32Array(EMBERS).fill(1)
  private sA: THREE.BufferAttribute; private eA: THREE.BufferAttribute
  private emitS = 0; private emitE = 0; private burst = 0
  private tmp = new THREE.Vector3(); private push = new THREE.Vector3()

  constructor(centre: THREE.Vector3, floorY: (x: number, z: number) => number) {
    // ---- the cone: a disc of rings pulled up into a mountain with a crater ----
    const RINGS = 90, SEG = 144, R = CONE_R * 1.5
    const pos: number[] = [], loc: number[] = [], idx: number[] = []
    const heightAt = (lx: number, lz: number) => {
      const r = Math.hypot(lx, lz), k = Math.max(0, 1 - r / CONE_R)
      let h = CONE_H * k ** 1.35
      h -= 15 * Math.max(0, 1 - (r / CRATER_R) ** 2)                                         // the crater
      h += smoothstep(4, 13, r) * smoothstep(20, 11, r) * 2.5                                  // its raised rim
      const mask = smoothstep(CONE_R * 1.3, CONE_R * 0.5, r) * smoothstep(6, 20, r)
      const ang = Math.atan2(lz, lx)
      h += (vnoise(lx * 0.07 + 20, lz * 0.07) - 0.5) * 9 * mask + (vnoise(lx * 0.2, lz * 0.2 + 9) - 0.5) * 3 * mask
      h += Math.sin(ang * 13 + vnoise(r * 0.05, ang) * 4) * 1.6 * mask * k                    // gullies running down the flanks
      return h
    }
    for (let i = 0; i <= RINGS; i++) for (let s = 0; s <= SEG; s++) {
      const r = (i / RINGS) ** 1.25 * R, a = (s / SEG) * Math.PI * 2
      const lx = Math.cos(a) * r, lz = Math.sin(a) * r, h = heightAt(lx, lz)
      pos.push(centre.x + lx, floorY(centre.x + lx, centre.z + lz) + h - smoothstep(R * 0.8, R, r) * 2, centre.z + lz)
      loc.push(lx, h, lz)
    }
    for (let i = 0; i < RINGS; i++) for (let s = 0; s < SEG; s++) { const a = i * (SEG + 1) + s, b = a + SEG + 1; idx.push(a, a + 1, b, a + 1, b + 1, b) }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aLocal', new THREE.Float32BufferAttribute(loc, 3))
    geo.setIndex(idx); geo.computeVertexNormals()
    const floorAt = floorY(centre.x, centre.z)
    this.crater.set(centre.x, floorAt + CONE_H - 9, centre.z)

    const rock = new THREE.MeshStandardMaterial({ color: '#1b1a1c', roughness: 0.95 })
    rock.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = sea.uTime
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aLocal; varying vec3 vL;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvL = aLocal;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
          varying vec3 vL; uniform float uTime; float gHeat = 0.0;
          float vh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(vh(i), vh(i + vec2(1, 0)), f.x), mix(vh(i + vec2(0, 1)), vh(i + vec2(1, 1)), f.x), f.y); }
          float vfbm(vec2 p) { return vn(p) * 0.5 + vn(p * 2.03) * 0.25 + vn(p * 4.1) * 0.125 + vn(p * 8.3) * 0.0625; }`)
        .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
          {
            float r = length(vL.xz); vec2 dir = vL.xz / max(r, 0.001);
            // lava channels: thin bright lines that run downhill (so mostly along "dir") and wander a little
            float wander = vfbm(vL.xz * 0.045) * 1.6;
            float lines = 1.0 - abs(vfbm(dir * 3.2 + wander + 11.0) * 2.0 - 1.0);
            float reach = smoothstep(${(CONE_R * 0.95).toFixed(1)}, 14.0, r) * (0.55 + 0.45 * vfbm(dir * 1.5 + 3.0));
            float channel = smoothstep(0.86 - reach * 0.12, 0.99, lines) * reach;
            // a crust that forms, cracks and is carried down the flow
            float crust = vfbm(vec2(dot(dir, vec2(37.0, 17.0)), r * 0.35 - uTime * 0.6)) ;
            channel *= 0.45 + 0.9 * crust;
            float lake = smoothstep(${(CRATER_R + 1).toFixed(1)}, ${(CRATER_R - 4).toFixed(1)}, r) * (0.55 + 0.6 * vfbm(vL.xz * 0.5 + vec2(uTime * 0.15, -uTime * 0.11)));
            float cracks = pow(1.0 - abs(vfbm(vL.xz * 0.16 + 5.0) * 2.0 - 1.0), 14.0) * smoothstep(${(CONE_R * 1.2).toFixed(1)}, 30.0, r) * 0.7;   // fissures in the skirt
            gHeat = clamp(max(max(channel, lake), cracks), 0.0, 1.0);
            // rock: basalt, ash in the hollows, a warm stain beside every channel
            float ash = vfbm(vL.xz * 0.3);
            diffuseColor.rgb = mix(vec3(0.035, 0.033, 0.036), vec3(0.13, 0.12, 0.115), ash * ash) * (0.7 + 0.6 * vfbm(vL.xz * 1.7));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.008), smoothstep(0.0, 0.35, gHeat) * 0.9);
          }`)
        .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
          {
            float flick = 0.85 + 0.15 * sin(uTime * 3.0 + vL.x * 0.3 + vL.z * 0.2);
            vec3 hot = vec3(1.0, 0.14, 0.02) * smoothstep(0.0, 0.5, gHeat) * 1.3 + vec3(1.0, 0.5, 0.08) * smoothstep(0.4, 0.85, gHeat) * 1.6 + vec3(1.0, 0.85, 0.5) * smoothstep(0.8, 1.0, gHeat) * 1.6;
            totalEmissiveRadiance += hot * flick;
            // the glow lava throws on the rock beside it, and the crater's light on the upper cone
            float near = smoothstep(0.0, 1.0, vfbm(vL.xz * 0.09 + 2.0)) * smoothstep(${CONE_R.toFixed(1)}, 10.0, length(vL.xz));
            totalEmissiveRadiance += vec3(0.5, 0.09, 0.015) * near * 0.16;
          }`)
    }
    this.group.add(new THREE.Mesh(geo, rock))

    // ---- light: one real lamp in the crater for the rock and seabed, and a big soft glow in the water ----
    this.lamp = new THREE.PointLight(new THREE.Color(1.0, 0.36, 0.1), 3200, 260, 1.8)
    this.lamp.position.copy(this.crater).y += 10
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: new THREE.Color(1.0, 0.3, 0.08), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.55,
    }))
    this.halo.position.copy(this.crater).y += 12
    this.halo.scale.setScalar(150)
    this.group.add(this.halo)

    // ---- ash plume ----
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3))
    this.sA = new THREE.BufferAttribute(new Float32Array(SMOKE).fill(1), 1); sg.setAttribute('aAge', this.sA)
    const seed = new Float32Array(SMOKE); for (let i = 0; i < SMOKE; i++) seed[i] = hash(i * 2.3)
    sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    this.smoke = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `attribute float aAge, aSeed; varying float vAge, vSeed;
        void main() { vAge = aAge; vSeed = aSeed; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = (5.0 + aAge * 30.0) * (0.7 + aSeed * 0.6) * 520.0 / -mv.z; }`,
      fragmentShader: /* glsl */ `varying float vAge, vSeed;
        void main() {
          vec2 c = gl_PointCoord - 0.5; float d = length(c);
          float puff = smoothstep(0.5, 0.1, d + 0.08 * sin(atan(c.y, c.x) * 5.0 + vSeed * 40.0));
          float a = puff * smoothstep(0.0, 0.05, vAge) * pow(1.0 - vAge, 1.3) * 0.34;
          // lit from below by the crater while young, then just a grey shape in the dark
          vec3 col = mix(vec3(0.85, 0.2, 0.04), vec3(0.07, 0.06, 0.06), smoothstep(0.0, 0.3, vAge + c.y * -0.25));
          gl_FragColor = vec4(col, a);
        }`,
    }))
    // ---- sparks ----
    const eg = new THREE.BufferGeometry()
    eg.setAttribute('position', new THREE.BufferAttribute(this.ePos, 3))
    this.eA = new THREE.BufferAttribute(new Float32Array(EMBERS).fill(1), 1); eg.setAttribute('aAge', this.eA)
    this.embers = new THREE.Points(eg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `attribute float aAge; varying float vAge;
        void main() { vAge = aAge; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (1.0 - aAge * 0.6) * 620.0 / -mv.z; }`,
      fragmentShader: /* glsl */ `varying float vAge;
        void main() { float d = length(gl_PointCoord - 0.5);
          vec3 col = mix(vec3(1.0, 0.85, 0.5), vec3(1.0, 0.2, 0.02), smoothstep(0.0, 0.5, vAge));
          gl_FragColor = vec4(col * (smoothstep(0.5, 0.0, d) * 0.5 + smoothstep(0.14, 0.0, d) * 3.0) * (1.0 - vAge), 1.0); }`,
    }))
    this.smoke.frustumCulled = this.embers.frustumCulled = false
    this.group.add(this.smoke, this.embers)
  }

  /** ray: the pointer's line of sight (or null); ash and sparks near it are pushed aside. */
  update(time: number, dt: number, ray: THREE.Ray | null) {
    const c = this.crater
    const flick = 0.8 + 0.2 * Math.sin(time * 7.3) * Math.sin(time * 3.1) + this.burst * 0.6
    this.lamp.intensity = 3200 * flick
    ;(this.halo.material as THREE.SpriteMaterial).opacity = 0.26 * flick
    // now and then the crater coughs: a burst of sparks
    this.burst = Math.max(0, this.burst - dt * 0.8)
    if (Math.sin(time * 0.7) > 0.985 && this.burst < 0.1) this.burst = 1
    this.emitS += dt * 46; this.emitE += dt * (26 + this.burst * 240)

    const step = (n: number, pos: Float32Array, vel: Float32Array, age: Float32Array, life: Float32Array, out: THREE.BufferAttribute, smoke: boolean) => {
      for (let i = 0; i < n; i++) {
        age[i] += dt
        const k = i * 3
        if (age[i] > life[i]) {
          const budget = smoke ? this.emitS : this.emitE
          if (budget < 1) { out.array[i] = 1; continue }
          if (smoke) this.emitS -= 1; else this.emitE -= 1
          const a = hash(i + time) * 6.283, r = Math.sqrt(hash(i * 3 + time)) * (smoke ? 6 : 5)
          pos[k] = c.x + Math.cos(a) * r; pos[k + 1] = c.y + (smoke ? 2 : 0); pos[k + 2] = c.z + Math.sin(a) * r
          const sp = smoke ? 0.8 : 3 + hash(i * 9 + time) * 6 + this.burst * 5
          vel[k] = Math.cos(a) * sp; vel[k + 1] = smoke ? 7 + hash(i * 5 + time) * 4 : 9 + hash(i * 5 + time) * 13 + this.burst * 8; vel[k + 2] = Math.sin(a) * sp
          age[i] = 0; life[i] = smoke ? 9 + hash(i * 13 + time) * 6 : 2.2 + hash(i * 13 + time) * 3
        }
        if (smoke) {                                          // hot water rises, slows, spreads and leans with the current
          vel[k] += (1.6 + Math.sin(time * 0.3 + pos[k + 1] * 0.05) * 1.2 - vel[k]) * 0.2 * dt
          vel[k + 1] += (3.2 - vel[k + 1]) * 0.22 * dt
          vel[k + 2] += (Math.cos(time * 0.23 + pos[k + 1] * 0.04) * 1.2 - vel[k + 2]) * 0.2 * dt
        } else {                                              // sparks: thrown up, dragged to a stop by the water, then sinking
          const drag = Math.exp(-1.1 * dt)
          vel[k] *= drag; vel[k + 2] *= drag; vel[k + 1] = vel[k + 1] * drag - 2.4 * dt
        }
        if (ray) {
          this.tmp.set(pos[k], pos[k + 1], pos[k + 2])
          const d2 = ray.distanceSqToPoint(this.tmp)
          if (d2 < 144) {
            ray.closestPointToPoint(this.tmp, this.push).sub(this.tmp).negate()
            const d = Math.sqrt(d2) + 0.001, f = (1 - d / 12) * 55 * dt / d
            vel[k] += this.push.x * f; vel[k + 1] += this.push.y * f; vel[k + 2] += this.push.z * f
          }
        }
        pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt
        out.array[i] = Math.min(1, age[i] / life[i])
      }
      out.needsUpdate = true
    }
    step(SMOKE, this.sPos, this.sVel, this.sAge, this.sLife, this.sA, true)
    step(EMBERS, this.ePos, this.eVel, this.eAge, this.eLife, this.eA, false)
    this.smoke.geometry.attributes.position.needsUpdate = true
    this.embers.geometry.attributes.position.needsUpdate = true
  }
}

/** A soft round glow, drawn once on a canvas. */
function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128
  const ctx = cv.getContext('2d')!, g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(0.6, 'rgba(255,255,255,0.1)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace
  return t
}
