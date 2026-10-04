import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { hash } from '../core/math'
import { addCaustics, sea } from './Underwater'

/** A fish, nose along +X: a tapered body, a forked tail, a dorsal fin. Coloured by vertex (dark back, pale belly). */
function fishGeometry() {
  const body = new THREE.SphereGeometry(0.5, 10, 6).scale(1.0, 0.36, 0.2)
  const bp = body.attributes.position
  for (let i = 0; i < bp.count; i++) { const x = bp.getX(i); if (x < 0) { const t = 1 + x * 1.1; bp.setY(i, bp.getY(i) * t); bp.setZ(i, bp.getZ(i) * t) } }   // taper to the tail
  const tail = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.45, 0, 0), new THREE.Vector3(-0.85, 0.28, 0), new THREE.Vector3(-0.7, 0, 0), new THREE.Vector3(-0.85, -0.28, 0)])
  tail.setIndex([0, 1, 2, 0, 2, 3]); tail.computeVertexNormals()
  tail.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2))
  const fin = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.15, 0.16, 0), new THREE.Vector3(-0.2, 0.34, 0), new THREE.Vector3(-0.25, 0.14, 0)])
  fin.setIndex([0, 1, 2]); fin.computeVertexNormals(); fin.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2))
  const g = mergeGeometries([body, tail, fin].map((x) => x.toNonIndexed()))!
  const p = g.attributes.position, col = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) { const k = THREE.MathUtils.smoothstep(p.getY(i), -0.15, 0.15); col.set([1.0 - k * 0.55, 1.0 - k * 0.45, 1.0 - k * 0.35], i * 3) }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

interface School { centre: THREE.Vector3; radius: THREE.Vector3; speed: number; phase: number; tint: THREE.Color; size: number; first: number; count: number }

/**
 * Schools of fish. Each school circles its own patch of the city; each fish
 * holds a slot in the school, wanders a little, and veers away from the
 * pointer. Bodies wriggle in the vertex shader, so the CPU only moves 500
 * matrices a frame.
 */
export class FishSchools {
  mesh: THREE.InstancedMesh
  private schools: School[] = []
  private offset: THREE.Vector3[] = []
  shove: THREE.Vector3[] = []
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private p = new THREE.Vector3()
  private ahead = new THREE.Vector3()
  private d = new THREE.Vector3()
  private s = new THREE.Vector3()
  private look = new THREE.Matrix4()
  private near = new THREE.Vector3()

  constructor(defs: { centre: [number, number, number]; radius: [number, number, number]; count: number; tint: string; size: number }[]) {
    const total = defs.reduce((n, d) => n + d.count, 0)
    const mat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.35 }), (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        {
          float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
          transformed.z += sin(uSwim * 9.0 + ph + position.x * 5.0) * 0.12 * (0.55 - position.x);     // the tail swings widest
        }`).replace('#include <common>', '#include <common>\nuniform float uSwim;')
      shader.uniforms.uSwim = sea.uTime
    })
    this.mesh = new THREE.InstancedMesh(fishGeometry(), mat, total)
    this.mesh.frustumCulled = false
    let first = 0
    defs.forEach((def, si) => {
      this.schools.push({ centre: new THREE.Vector3(...def.centre), radius: new THREE.Vector3(...def.radius), speed: 0.1 + hash(si * 3.3) * 0.06, phase: hash(si * 7.1) * 6.28, tint: new THREE.Color(def.tint), size: def.size, first, count: def.count })
      for (let i = 0; i < def.count; i++) {
        const k = first + i
        this.offset.push(new THREE.Vector3((hash(k * 1.1) - 0.5) * 9, (hash(k * 2.3) - 0.5) * 5, (hash(k * 3.7) - 0.5) * 9))
        this.shove.push(new THREE.Vector3())
        this.mesh.setColorAt(k, this.schools[si].tint.clone().multiplyScalar(0.8 + hash(k * 5.5) * 0.4))
      }
      first += def.count
    })
  }

  private at(sc: School, t: number, off: THREE.Vector3, out: THREE.Vector3) {
    const a = sc.phase + t * sc.speed
    return out.set(sc.centre.x + Math.cos(a) * sc.radius.x, sc.centre.y + Math.sin(a * 1.7) * sc.radius.y, sc.centre.z + Math.sin(a) * sc.radius.z)
      .add(off).add(this.d.set(Math.sin(t * 0.7 + off.x) * 0.8, Math.cos(t * 0.9 + off.y) * 0.5, Math.sin(t * 0.6 + off.z) * 0.8))
  }

  /** ray: the pointer's line of sight into the water (or null). Fish within a few metres of it, out to 70 m, dart aside. */
  update(time: number, dt: number, ray: THREE.Ray | null) {
    for (const sc of this.schools) {
      for (let i = 0; i < sc.count; i++) {
        const k = sc.first + i, off = this.offset[k], shove = this.shove[k]
        this.at(sc, time, off, this.p)
        this.at(sc, time + 0.25, off, this.ahead)
        if (ray) {
          this.d.copy(this.p).add(shove)
          ray.closestPointToPoint(this.d, this.near)
          if (this.near.distanceToSquared(ray.origin) < 4900) {
            this.d.sub(this.near)
            const dist = this.d.length()
            if (dist < 7) shove.addScaledVector(this.d, ((7 - dist) / 7) * 30 * dt / (dist + 0.01))      // dart away
          }
        }
        shove.multiplyScalar(Math.exp(-1.1 * dt))                                                       // ...and drift back to the school
        this.p.add(shove); this.ahead.add(shove)
        this.look.lookAt(this.p, this.ahead, THREE.Object3D.DEFAULT_UP)
        this.q.setFromRotationMatrix(this.look).multiply(NOSE)                                          // model's nose is +X; lookAt aims -Z
        const sz = sc.size * (0.8 + hash(k * 9.9) * 0.5)
        this.mesh.setMatrixAt(k, this.m.compose(this.p, this.q, this.s.set(sz, sz, sz)))
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
const NOSE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)

/** Large slow animals for scale: rays that fly over the avenue, and one whale far off in the haze. */
export class Giants {
  group = new THREE.Group()
  private rays: { mesh: THREE.Mesh; phase: number; y: number; r: number }[] = []
  private whale: THREE.Mesh
  private flap = { uFlap: { value: 0 } }

  constructor(centre: THREE.Vector3) {
    // ray: a flat diamond whose wing tips beat (vertex shader)
    const wing = new THREE.PlaneGeometry(1, 1, 16, 6).rotateX(-Math.PI / 2)
    const wp = wing.attributes.position
    for (let i = 0; i < wp.count; i++) {
      const x = wp.getX(i) * 2, z = wp.getZ(i) * 2                    // -1..1
      const span = 1 - Math.abs(z)                                    // narrow at nose and tail
      wp.setXYZ(i, x * 3.2 * Math.max(span, 0.04) ** 0.7, (1 - Math.abs(x)) * 0.28 * span, z * 2.0 - Math.abs(x) * 0.9)
    }
    wing.computeVertexNormals()
    const tailG = new THREE.CylinderGeometry(0.03, 0.01, 3.4, 5).rotateX(Math.PI / 2).translate(0, 0.05, 3.4)
    const rayGeo = mergeGeometries([wing.toNonIndexed(), tailG.toNonIndexed()])!
    const rayMat = addCaustics(new THREE.MeshStandardMaterial({ color: '#2a3138', roughness: 0.6, side: THREE.DoubleSide }), (shader) => {
      Object.assign(shader.uniforms, this.flap)
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uFlap;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(uFlap * 1.6 - abs(position.x) * 0.9) * abs(position.x) * abs(position.x) * 0.16 * step(position.z, 2.2);')
    })
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(rayGeo, rayMat)
      mesh.scale.setScalar(1.3 + i * 0.35)
      this.rays.push({ mesh, phase: i * 2.1, y: centre.y + 22 + i * 9, r: 38 + i * 16 })
      this.group.add(mesh)
    }
    // whale: a long body with flukes, only ever seen as a shape in the blue
    const body = new THREE.SphereGeometry(1, 20, 12).scale(11, 2.6, 2.5)
    const bp = body.attributes.position
    for (let i = 0; i < bp.count; i++) { const x = bp.getX(i) / 11; const t = x < 0 ? 1 + x * 0.9 : 1 - x * x * 0.35; bp.setY(i, bp.getY(i) * t + (x < 0 ? x * x * 1.2 : 0)); bp.setZ(i, bp.getZ(i) * t) }
    const fluke = new THREE.BoxGeometry(2.6, 0.25, 7).translate(-11.6, 1.2, 0)
    const fins = [1, -1].map((sd) => new THREE.BoxGeometry(3.4, 0.25, 1.4).rotateY(sd * 0.7).translate(4.5, -1.6, sd * 2.6))
    const whaleGeo = mergeGeometries([body, fluke, ...fins].map((g) => g.toNonIndexed()))!
    whaleGeo.computeVertexNormals()
    this.whale = new THREE.Mesh(whaleGeo, addCaustics(new THREE.MeshStandardMaterial({ color: '#39424c', roughness: 0.7 })))
    this.group.add(this.whale)
    this.centre = centre
  }
  private centre: THREE.Vector3

  update(time: number) {
    this.flap.uFlap.value = time
    for (const r of this.rays) {
      const a = r.phase + time * 0.09
      r.mesh.position.set(this.centre.x + Math.cos(a) * r.r, r.y + Math.sin(time * 0.3 + r.phase) * 2, this.centre.z + Math.sin(a) * r.r * 1.4)
      r.mesh.rotation.set(0, -a + Math.PI, Math.sin(time * 0.3 + r.phase) * 0.12)
    }
    const w = time * 0.02
    // the whale patrols the lip of the trench, just past the last block
    this.whale.position.set(this.centre.x - 110 + ((w * 160) % 220), this.centre.y - 38 + Math.sin(time * 0.15) * 4, this.centre.z - 300)
    this.whale.rotation.z = Math.sin(time * 0.4) * 0.05
  }
}
