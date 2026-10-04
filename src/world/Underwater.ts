import * as THREE from 'three'
import { hash } from '../core/math'

/** Shared clock + light for everything under the surface. */
export const sea = { uTime: { value: 0 }, uCaustic: { value: 1 }, uGlowAt: { value: new THREE.Vector3(0, -9999, 0) } }

/**
 * Adds caustics to a standard material: the moving net of light that the
 * waves focus onto anything below them. Brightest on up-facing surfaces near
 * the surface, gone in the deep.
 */
export function addCaustics(mat: THREE.MeshStandardMaterial, extra?: (shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }) => void) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sea)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeaPos; varying vec3 vSeaN;')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vSeaPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz; vSeaN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
          vSeaPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vSeaN = normalize(mat3(modelMatrix) * normal);
        #endif`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vSeaPos; varying vec3 vSeaN; uniform float uTime, uCaustic;
        float causticNet(vec2 p) {
          float c = 0.0; float t = uTime * 0.55;
          for (int i = 0; i < 3; i++) {
            p = mat2(0.8, -0.6, 0.6, 0.8) * p * 1.35 + vec2(t * 0.6, -t * 0.4);
            vec2 q = sin(p + sin(p.yx * 0.9 + t));
            c += pow(abs(q.x * q.y), 0.45);
          }
          return pow(1.0 - c / 3.0, 5.0) * 6.0;
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        {
          float depthFade = smoothstep(-150.0, -8.0, vSeaPos.y) * step(vSeaPos.y, 0.0);
          float facing = clamp(vSeaN.y * 0.7 + 0.45, 0.0, 1.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(0.55, 0.95, 0.9) * causticNet(vSeaPos.xz * 0.11 + vSeaPos.y * 0.03) * depthFade * facing * uCaustic;
        }`)
    extra?.(shader)
  }
  return mat
}

/** Shafts of sunlight hanging from the surface around the camera. */
export class LightShafts {
  mesh: THREE.InstancedMesh
  private mat: THREE.ShaderMaterial
  constructor(count = 26) {
    const geo = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0)       // hangs down from y = 0
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: sea.uTime, uColor: { value: new THREE.Color(0.35, 0.75, 0.7) }, uStrength: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying float vSeed;
        void main() { vUv = uv; vSeed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uStrength; uniform vec3 uColor; varying vec2 vUv; varying float vSeed;
        void main() {
          float across = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
          float streaks = 0.55 + 0.45 * sin(vUv.x * 23.0 + vSeed * 9.0 + sin(uTime * 0.6 + vSeed) * 2.0);
          float flicker = 0.6 + 0.4 * sin(uTime * 0.9 + vSeed * 5.0);
          float down = pow(vUv.y, 1.6);                                   // bright at the surface, fading with depth
          gl_FragColor = vec4(uColor * across * streaks * flicker * down * 0.16 * uStrength, 1.0);
        }`,
    })
    this.mesh = new THREE.InstancedMesh(geo, this.mat, count)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    for (let i = 0; i < count; i++) {
      const a = hash(i * 3.1) * 6.283, r = 12 + hash(i * 5.7) * 85
      q.setFromEuler(e.set(0, hash(i * 9.3) * 3.14, 0.22))               // all lean the same way: the sun's angle
      m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, new THREE.Vector3(9 + hash(i) * 16, 90 + hash(i + 0.5) * 60, 1))
      this.mesh.setMatrixAt(i, m)
    }
    this.mesh.frustumCulled = false
  }
  /** Follows the camera sideways; strength fades out with depth. */
  update(camera: THREE.Camera, strength: number) {
    this.mesh.position.set(camera.position.x, -0.5, camera.position.z)
    this.mesh.visible = strength > 0.01
    this.mat.uniforms.uStrength.value = strength
  }
}

/** Drifting specks ("marine snow") in a box that wraps around the camera. */
export class Snow {
  points: THREE.Points
  private mat: THREE.ShaderMaterial
  constructor(count = 2600) {
    const pos = new Float32Array(count * 3), seed = new Float32Array(count)
    for (let i = 0; i < count; i++) { pos.set([hash(i), hash(i + 0.33), hash(i + 0.66)], i * 3); seed[i] = hash(i * 3.3) }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: sea.uTime, uGlowAt: sea.uGlowAt, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(0.6, 0.85, 0.9) }, uGlow: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime, uGlow; uniform vec3 uGlowAt; varying float vA; varying float vLit;
        const vec3 BOX = vec3(60.0, 40.0, 60.0);
        void main() {
          vec3 p = position * BOX + vec3(sin(uTime * 0.2 + aSeed * 30.0) * 0.6, -uTime * (0.15 + aSeed * 0.25), cos(uTime * 0.17 + aSeed * 20.0) * 0.6);
          p = mod(p - cameraPosition + BOX * 0.5, BOX) - BOX * 0.5 + cameraPosition;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          // in the deep, plankton near the pointer lights up
          vLit = uGlow * smoothstep(9.0, 0.0, distance(p, uGlowAt)) * (0.6 + 0.4 * sin(uTime * 6.0 + aSeed * 50.0));
          gl_PointSize = (6.0 + aSeed * 12.0 + vLit * 40.0) / -mv.z * 6.0;
          vA = smoothstep(30.0, 14.0, -mv.z) * smoothstep(0.4, 2.0, -mv.z) * step(p.y, -0.5);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; varying float vA; varying float vLit;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          vec3 col = mix(uColor, vec3(0.3, 1.0, 0.9) * 3.0, clamp(vLit, 0.0, 1.0));
          gl_FragColor = vec4(col * (uAlpha * 0.5 + vLit * 1.5), smoothstep(0.5, 0.0, d) * vA);
        }`,
    })
    this.points = new THREE.Points(geo, this.mat)
    this.points.frustumCulled = false
  }
  update(alpha: number, glow: number) { this.points.visible = alpha > 0.01; this.mat.uniforms.uAlpha.value = alpha; this.mat.uniforms.uGlow.value = glow }
}

/** Bubbles released where the pointer stirs the water; they wobble upwards and fade. */
export class Bubbles {
  points: THREE.Points
  private pos: Float32Array
  private age: Float32Array
  private aAge: THREE.BufferAttribute
  private next = 0
  constructor(private count = 260) {
    this.pos = new Float32Array(count * 3)
    this.age = new Float32Array(count).fill(99)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.aAge = new THREE.BufferAttribute(new Float32Array(count).fill(1), 1)
    geo.setAttribute('aAge', this.aAge)
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `attribute float aAge; varying float vAge;
        void main() { vAge = aAge; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (0.10 + 0.12 * fract(position.x * 7.3)) * 700.0 / -mv.z; }`,
      fragmentShader: /* glsl */ `varying float vAge;
        void main() { vec2 c = gl_PointCoord - 0.5; float d = length(c);
          float ring = smoothstep(0.5, 0.42, d) * smoothstep(0.28, 0.44, d) + smoothstep(0.12, 0.0, length(c - vec2(-0.14, -0.16))) * 0.9;   // rim + highlight
          gl_FragColor = vec4(vec3(0.7, 0.95, 1.0) * ring, (1.0 - vAge) * 0.8); }`,
    }))
    this.points.frustumCulled = false
  }
  emit(at: THREE.Vector3, n = 2) {
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.count
      this.pos.set([at.x + (Math.random() - 0.5) * 1.4, at.y + (Math.random() - 0.5) * 1.4, at.z + (Math.random() - 0.5) * 1.4], i * 3)
      this.age[i] = 0
    }
  }
  update(time: number, dt: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.age[i] > 4) { this.aAge.array[i] = 1; continue }
      this.age[i] += dt
      const k = i * 3
      this.pos[k] += Math.sin(time * 5 + i) * 0.5 * dt; this.pos[k + 1] += (1.6 + (i % 5) * 0.25) * dt; this.pos[k + 2] += Math.cos(time * 4 + i * 2) * 0.5 * dt
      this.aAge.array[i] = this.pos[k + 1] > -0.3 ? 1 : this.age[i] / 4          // a bubble that reaches the surface is gone
    }
    this.points.geometry.attributes.position.needsUpdate = true
    this.aAge.needsUpdate = true
  }
}
