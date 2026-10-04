import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { hash } from '../core/math'
import type { Water } from './Water'

const FUNNELS = [new THREE.Vector3(-3.4, 14.5, 0), new THREE.Vector3(-10.4, 14.5, 0)]   // funnel tops in the model's own space
const COUNT = 520

/** The steamer: rides the swell, and trails smoke that the pointer can push around. */
export class Ship {
  group = new THREE.Group()
  smoke: THREE.Points
  private windows: THREE.MeshStandardMaterial
  private lamps: THREE.MeshStandardMaterial
  private pos: Float32Array
  private vel = new Float32Array(COUNT * 3)
  private age = new Float32Array(COUNT).fill(99)
  private life = new Float32Array(COUNT)
  private aAge: THREE.BufferAttribute
  private emit = 0
  private tmp = new THREE.Vector3()
  private smokeU = { uColor: { value: new THREE.Color() }, uLit: { value: new THREE.Color() }, uLightDir: { value: new THREE.Vector3() } }

  constructor(gltf: GLTF, private water: Water, at: THREE.Vector3, private heading: number) {
    // paint, not plastic: every surface carries the marks of salt, rust and work (all computed from the model's own coordinates)
    const NOISE = /* glsl */ `
      varying vec3 vShip; varying vec3 vShipN;
      float sh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float sn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(sh(i), sh(i + vec2(1, 0)), f.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), f.x), f.y); }
      float sfbm(vec2 p) { return sn(p) * 0.5 + sn(p * 2.1) * 0.3 + sn(p * 4.3) * 0.2; }`
    const worn = (mat: THREE.MeshStandardMaterial, body: string) => {
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vShip; varying vec3 vShipN;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShip = position; vShipN = normal;')
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + NOISE + '\nfloat gRough = 0.0;')
          .replace('#include <map_fragment>', '#include <map_fragment>\n{' + body + '\n}')
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + gRough, 0.05, 1.0);')
      }
      return mat
    }
    const C = (c: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o })
    this.windows = C('#0c1116', { roughness: 0.12, metalness: 0.2, emissive: '#ffcf8a', emissiveIntensity: 0 })
    this.lamps = C('#fff2d0', { emissive: '#ffe2a8', emissiveIntensity: 0 })
    const hull = worn(C('#ffffff', { roughness: 0.5, side: THREE.DoubleSide }), /* glsl */ `
      vec2 along = vec2(vShip.x, vShip.y);
      float y = vShip.y + (sn(vec2(vShip.x * 0.6, 3.0)) - 0.5) * 0.12;             // the paint lines are hand-cut, not ruled
      vec3 black = vec3(0.04, 0.045, 0.055), red = vec3(0.3, 0.06, 0.04), white = vec3(0.72, 0.71, 0.66);
      vec3 col = mix(red, white, smoothstep(0.42, 0.46, y)); col = mix(col, black, smoothstep(0.66, 0.7, y));
      // riveted plating: strakes 1.1 m high, plates 4 m long, staggered
      float row = floor(vShip.y / 1.1); vec2 pl = vec2(fract(vShip.x / 4.0 + row * 0.37), fract(vShip.y / 1.1));
      float seam = smoothstep(0.012, 0.0, min(pl.x, 1.0 - pl.x) * 4.0 / 4.0) + smoothstep(0.03, 0.0, min(pl.y, 1.0 - pl.y));
      float plate = sh(vec2(floor(vShip.x / 4.0 + row * 0.37), row));
      col *= 0.86 + 0.28 * plate; col = mix(col, col * 0.55, clamp(seam, 0.0, 1.0) * 0.6);
      // rust weeping down from seams and scuppers, heavier toward the waterline
      float streak = sfbm(vec2(vShip.x * 2.2, vShip.y * 0.22 + vShip.z * 0.2));
      float rust = smoothstep(0.52, 0.8, streak) * smoothstep(4.5, 0.6, y) * step(0.5, y);
      rust += smoothstep(0.6, 0.9, sfbm(along * 0.8 + 7.0)) * 0.5;
      col = mix(col, vec3(0.3, 0.13, 0.05) * (0.6 + 0.8 * sn(along * 5.0)), clamp(rust, 0.0, 1.0) * 0.75);
      // salt and scum at the waterline, weed below it
      float salt = smoothstep(1.5, 0.5, y) * smoothstep(0.1, 0.5, y) * sfbm(vec2(vShip.x * 1.5, y * 6.0));
      col = mix(col, vec3(0.55, 0.56, 0.52), salt * 0.5);
      col = mix(col, vec3(0.07, 0.12, 0.06), smoothstep(0.35, -0.6, y) * (0.35 + 0.5 * sfbm(along * 1.3)));
      diffuseColor.rgb = col; gRough = rust * 0.4 + salt * 0.3 - plate * 0.08;`)
    const paint = (base: string, rustAmt: number) => worn(C(base, { roughness: 0.45 }), /* glsl */ `
      vec2 f = abs(vShipN.z) > 0.5 ? vShip.xy : (abs(vShipN.x) > 0.5 ? vShip.zy : vShip.xz);
      float wall = 1.0 - step(0.5, abs(vShipN.y));
      float streak = sfbm(vec2(f.x * 3.0, f.y * 0.25));
      float rust = smoothstep(0.58, 0.85, streak) * wall * ${rustAmt.toFixed(2)};
      float grime = sfbm(f * 0.7) * 0.22 + (1.0 - wall) * sfbm(f * 2.0) * 0.2;
      float panel = smoothstep(0.02, 0.0, abs(fract(f.x / 2.4) - 0.5) - 0.49) * wall;
      diffuseColor.rgb *= 1.0 - grime - panel * 0.12;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.17, 0.07), rust * 0.6);
      gRough = rust * 0.4 + grime;`)
    const deck = worn(C('#8a6a48', { roughness: 0.85 }), /* glsl */ `
      float plank = vShip.z / 0.16; float id = floor(plank);
      float gap = smoothstep(0.08, 0.0, min(fract(plank), 1.0 - fract(plank)));
      float butt = smoothstep(0.02, 0.0, abs(fract(vShip.x / 3.2 + sh(vec2(id, 1.0))) - 0.5) - 0.49);
      diffuseColor.rgb *= (0.78 + 0.34 * sh(vec2(id, 7.0))) * (0.85 + 0.3 * sfbm(vec2(vShip.x * 0.9, vShip.z * 6.0)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.04, 0.03), max(gap, butt) * 0.8);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.44, 0.4), sfbm(vShip.xz * 0.5) * 0.3);        // bleached by salt and sun`)
    const mats: Record<string, THREE.Material> = {
      hull, white: paint('#d9d6cb', 1), deck, funnel: paint('#b98a45', 0.7), black: C('#0d0e10', { roughness: 0.7 }),
      glass: this.windows, metal: C('#5d6165', { metalness: 0.85, roughness: 0.55 }), brass: C('#a98548', { metalness: 1, roughness: 0.38 }),
      boat: paint('#cfcbbd', 0.5), canvas: C('#77705c', { roughness: 1 }), flag: C('#8e1d1a', { side: THREE.DoubleSide, roughness: 0.9 }), lamp: this.lamps,
    }
    const model = gltf.scene.clone()
    model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = mats[(m.material as THREE.Material).name] ?? mats.white })
    this.group.add(model)
    this.group.position.copy(at)

    this.pos = new Float32Array(COUNT * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.aAge = new THREE.BufferAttribute(new Float32Array(COUNT).fill(1), 1)
    geo.setAttribute('aAge', this.aAge)                       // 0 = just left the funnel, 1 = gone
    const seed = new Float32Array(COUNT); for (let i = 0; i < COUNT; i++) seed[i] = hash(i * 1.9)
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    this.smoke = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: this.smokeU,
      vertexShader: /* glsl */ `
        attribute float aAge, aSeed; varying float vAge; varying float vSeed;
        void main() {
          vAge = aAge; vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.6 + aAge * 13.0) * (0.7 + aSeed * 0.6) * 520.0 / -mv.z;      // puffs grow as they cool and spread
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor, uLit; varying float vAge; varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float puff = smoothstep(0.5, 0.12, d + 0.07 * sin(atan(c.y, c.x) * 5.0 + vSeed * 40.0));     // a slightly lumpy disc
          float a = puff * smoothstep(0.0, 0.06, vAge) * pow(1.0 - vAge, 1.5) * 0.55;
          vec3 col = mix(uColor, uLit, smoothstep(0.25, -0.35, c.y) * 0.8 + 0.1);                       // lit from above
          gl_FragColor = vec4(col, a);
        }`,
    }))
    this.smoke.frustumCulled = false
  }

  /** night: 0..1 lights the cabin windows; colours of the smoke follow the sky. */
  setLook(night: number, smoke: THREE.Color, lit: THREE.Color) {
    this.windows.emissiveIntensity = 0.25 + night * 2.4; this.lamps.emissiveIntensity = 0.6 + night * 5
    this.smokeU.uColor.value.copy(smoke); this.smokeU.uLit.value.copy(lit)
  }

  /** ray: the pointer's ray in world space (or null). Smoke near it is blown aside. */
  update(time: number, dt: number, ray: THREE.Ray | null) {
    // float: sample the swell under bow, stern and both beams
    const g = this.group, c = Math.cos(this.heading), s = Math.sin(this.heading)
    const at = (lx: number, lz: number) => this.water.heightAt(g.position.x + lx * c + lz * s, g.position.z - lx * s + lz * c, time)
    const bow = at(27, 0), stern = at(-27, 0), port = at(0, -4), star = at(0, 4)
    g.position.y = (bow + stern + port + star) / 4 * 0.6 - 0.75
    g.rotation.set((star - port) / 8 * 0.5, this.heading, (bow - stern) / 54 * 0.6, 'YXZ')
    g.updateMatrixWorld()

    // smoke
    this.emit += dt * 46
    for (let i = 0; i < COUNT; i++) {
      this.age[i] += dt
      if (this.age[i] > this.life[i]) {
        if (this.emit < 1) { this.aAge.array[i] = 1; continue }
        this.emit -= 1
        this.tmp.copy(FUNNELS[i % 2]).applyMatrix4(g.matrixWorld)
        this.pos.set([this.tmp.x + (hash(i + time) - 0.5), this.tmp.y, this.tmp.z + (hash(i * 3 + time) - 0.5)], i * 3)
        this.vel.set([-1.2 + (hash(i * 7 + time) - 0.5) * 1.2, 4.2 + hash(i * 5 + time) * 1.6, 1.0 + (hash(i * 11 + time) - 0.5) * 1.2], i * 3)
        this.age[i] = 0; this.life[i] = 7 + hash(i * 13 + time) * 4
      }
      const k = i * 3
      // rises fast while hot, then the wind takes it
      this.vel[k] += (-5.5 - this.vel[k]) * 0.35 * dt
      this.vel[k + 1] += (0.7 - this.vel[k + 1]) * 0.5 * dt
      this.vel[k + 2] += (2.2 - this.vel[k + 2]) * 0.3 * dt
      if (ray) {
        this.tmp.set(this.pos[k], this.pos[k + 1], this.pos[k + 2])
        const d2 = ray.distanceSqToPoint(this.tmp)
        if (d2 < 196) {                                                          // within 14 m of the pointer's line of sight
          ray.closestPointToPoint(this.tmp, PUSH).sub(this.tmp).negate()
          const d = Math.sqrt(d2) + 0.001, f = (1 - d / 14) * 60 * dt / d
          this.vel[k] += PUSH.x * f; this.vel[k + 1] += PUSH.y * f; this.vel[k + 2] += PUSH.z * f
        }
      }
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt
      this.aAge.array[i] = Math.min(1, this.age[i] / this.life[i])
    }
    this.smoke.geometry.attributes.position.needsUpdate = true
    this.aAge.needsUpdate = true
  }
}
const PUSH = new THREE.Vector3()
