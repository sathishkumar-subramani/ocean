import * as THREE from 'three'
import { SKY_GLSL, skyUniforms } from './skyGlsl'

/** Wave trains: direction x, direction z, steepness, wavelength (m). Shared by the shader and by `heightAt`. */
const WAVES: [number, number, number, number][] = [
  [1.0, 0.3, 0.1, 64], [0.8, -0.55, 0.09, 39], [0.4, 0.9, 0.08, 25], [0.95, 0.1, 0.07, 15.5], [0.6, -0.8, 0.06, 9.5], [0.2, 1.0, 0.05, 5.7],
]
const RIPPLES = 10

/**
 * The sea surface. Shape: a sum of Gerstner waves (points move in circles, so
 * crests sharpen and troughs flatten, like real swell) plus rings spreading
 * from wherever the pointer touched. Colour: reflected sky by Fresnel, the
 * water's own body colour, sun glitter, light glowing through thin crests,
 * foam. Seen from below, the same mesh shows the bright circle of sky
 * ("Snell's window") surrounded by mirror-dark water.
 */
export class Water {
  mesh: THREE.Mesh
  uniforms: Record<string, THREE.IUniform>
  private ripples: THREE.Vector4[] = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0))
  private next = 0

  constructor() {
    // a grid that is fine under the camera and coarse at the horizon
    const N = 320, S = 1700
    const geo = new THREE.PlaneGeometry(2, 2, N, N)
    geo.rotateX(-Math.PI / 2)
    const p = geo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i)
      p.setXYZ(i, Math.sign(x) * x * x * S, 0, Math.sign(z) * z * z * S)
    }
    this.uniforms = {
      ...skyUniforms,
      uWaves: { value: WAVES.map((w) => new THREE.Vector4(...w)) },
      uRip: { value: this.ripples },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightCol: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uScatter: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() }, uFogD: { value: 0.0006 },
      uUnderFog: { value: new THREE.Color() }, uUnderFogD: { value: 0.02 },
    }
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec4 uWaves[6]; uniform vec4 uRip[${RIPPLES}];
        varying vec3 vW; varying vec3 vN; varying float vH;
        void main() {
          vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
          float dist = distance(p.xz, cameraPosition.xz);
          vec3 off = vec3(0.0), tan = vec3(1.0, 0.0, 0.0), bin = vec3(0.0, 0.0, 1.0);
          for (int i = 0; i < 6; i++) {
            vec4 w = uWaves[i];
            float k = 6.28318 / w.w, c = sqrt(9.8 / k);
            vec2 d = normalize(w.xy);
            float f = k * (dot(d, p.xz) - c * uTime);
            float st = w.z * (1.0 - smoothstep(w.w * 9.0, w.w * 30.0, dist));     // short waves fade out far away, where the grid is too coarse for them
            float a = st / k;
            off += vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
            tan += vec3(-d.x * d.x * st * sin(f), d.x * st * cos(f), -d.x * d.y * st * sin(f));
            bin += vec3(-d.x * d.y * st * sin(f), d.y * st * cos(f), -d.y * d.y * st * sin(f));
          }
          // pointer ripples: a ring that spreads at 3 m/s and dies in a few seconds
          for (int i = 0; i < ${RIPPLES}; i++) {
            vec4 r = uRip[i];
            float age = uTime - r.z;
            if (age < 0.0 || age > 7.0) continue;
            vec2 to = p.xz - r.xy; float dd = length(to) + 1e-4;
            float front = age * 3.0;
            float env = r.w * exp(-age * 0.55) * exp(-pow((dd - front) / 3.5, 2.0)) / (1.0 + dd * 0.04);
            float ph = dd * 1.7 - age * 5.1;
            off.y += env * sin(ph);
            float slope = env * 1.7 * cos(ph);
            tan.y += slope * to.x / dd; bin.y += slope * to.y / dd;
          }
          p += off;
          vW = p; vH = off.y; vN = normalize(cross(bin, tan));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: SKY_GLSL + /* glsl */ `
        uniform vec3 uLightDir, uLightCol, uDeep, uShallow, uScatter, uFog, uUnderFog;
        uniform float uFogD, uUnderFogD;
        varying vec3 vW; varying vec3 vN; varying float vH;
        // small wind ripples: the slope of two drifting noise layers
        vec2 chop(vec2 p) {
          float e = 0.35;
          float a = sN(p * 0.9 + uTime * vec2(0.35, 0.2)) + 0.5 * sN(p * 2.3 - uTime * vec2(0.3, 0.45));
          float ax = sN((p + vec2(e, 0.0)) * 0.9 + uTime * vec2(0.35, 0.2)) + 0.5 * sN((p + vec2(e, 0.0)) * 2.3 - uTime * vec2(0.3, 0.45));
          float az = sN((p + vec2(0.0, e)) * 0.9 + uTime * vec2(0.35, 0.2)) + 0.5 * sN((p + vec2(0.0, e)) * 2.3 - uTime * vec2(0.3, 0.45));
          return vec2(a - ax, a - az) / e;
        }
        void main() {
          vec3 toCam = cameraPosition - vW;
          float dist = length(toCam);
          vec3 V = toCam / dist;
          vec2 c2 = chop(vW.xz) * (0.32 / (1.0 + dist * 0.012));
          vec3 N = normalize(vN + vec3(c2.x, 0.0, c2.y));
          vec3 L = normalize(uLightDir);
          vec3 col;
          if (cameraPosition.y >= vH - 0.3) {
            // ---- from above ----
            float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
            vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.02;
            vec3 refl = skyColor(normalize(R), 0.0);
            vec3 body = mix(uDeep, uShallow, smoothstep(-0.6, 1.8, vH) * 0.55);
            body += uScatter * pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 3.0) * smoothstep(0.1, 1.7, vH);      // light through the crests
            col = mix(body, refl, F);
            vec3 Hh = normalize(L + V);
            float nh = max(dot(N, Hh), 0.0);
            col += uLightCol * (pow(nh, 700.0) * 60.0 + pow(nh, 90.0) * 0.9);                                       // glitter + its soft halo
            float foam = smoothstep(1.25, 2.1, vH + sN(vW.xz * 0.7 + uTime * 0.2) * 0.9) * sN(vW.xz * 3.0 - uTime * 0.3);
            col = mix(col, (uLightCol * 0.5 + refl * 0.3 + 0.25), foam * 0.75);
            col = mix(col, uFog, 1.0 - exp(-pow(dist * uFogD, 2.0)));
          } else {
            // ---- from below: sky through Snell's window, mirror outside it ----
            vec3 I = -V;
            vec3 T = refract(I, -N, 1.33);
            float window = smoothstep(0.0, 0.25, length(T));
            vec3 sky = skyColor(normalize(vec3(T.x, abs(T.y) + 0.02, T.z)), 1.0) * 1.15 + uLightCol * pow(max(dot(normalize(T), L), 0.0), 60.0) * 3.0;
            col = mix(uUnderFog * 0.55, sky, window);
            col = mix(col, uUnderFog, 1.0 - exp(-dist * uUnderFogD));
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    }))
    this.mesh.frustumCulled = false
  }

  /** Start a ring of ripples at a point on the surface. */
  touch(x: number, z: number, time: number, strength = 0.32) {
    this.ripples[this.next].set(x, z, time, strength)
    this.next = (this.next + 1) % RIPPLES
  }

  /** Height of the swell at a point (same maths as the shader, without the sideways drift). Used to float the ship. */
  heightAt(x: number, z: number, time: number) {
    let h = 0
    for (const [dx, dz, st, len] of WAVES) {
      const k = (Math.PI * 2) / len, c = Math.sqrt(9.8 / k), n = Math.hypot(dx, dz)
      h += (st / k) * Math.sin(k * ((dx * x + dz * z) / n - c * time))
    }
    return h
  }

  update(camera: THREE.Camera) {
    this.mesh.position.set(camera.position.x, 0, camera.position.z)
  }
}
