import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

/**
 * scene -> bloom -> lens -> tone mapping -> grain.
 * The lens pass is where "being under water" happens on screen: the whole
 * picture wobbles slowly, and a ring of refraction spreads from the cursor
 * whenever it moves.
 */
export class Post {
  composer: EffectComposer
  bloom: UnrealBloomPass
  private lens: ShaderPass
  private grain: ShaderPass

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 })
    this.composer = new EffectComposer(renderer, target)
    this.composer.addPass(new RenderPass(scene, camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.6, 1.0)
    this.composer.addPass(this.bloom)
    this.lens = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVel: { value: 0 }, uUnder: { value: 0 }, uCursor: { value: new THREE.Vector2(0.5, 0.5) }, uStir: { value: 0 }, uAspect: { value: 1 }, uVignette: { value: 0.6 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform float uTime, uVel, uUnder, uStir, uAspect, uVignette; uniform vec2 uCursor; varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          // slow refraction wobble of the whole view
          uv += vec2(sin(uv.y * 14.0 + uTime * 1.3), cos(uv.x * 11.0 + uTime * 1.1)) * 0.0016 * uUnder;
          // rings spreading from the cursor
          vec2 to = (uv - uCursor) * vec2(uAspect, 1.0);
          float d = length(to) + 1e-4;
          uv += (to / d) * sin(d * 46.0 - uTime * 9.0) * exp(-d * 7.5) * 0.011 * uStir * uUnder;
          vec2 c = vUv - 0.5; float r2 = dot(c, c);
          vec2 off = c * r2 * (0.008 + uVel * 0.1 + uUnder * 0.012);
          vec3 col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
          col *= 1.0 - r2 * uVignette;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
    this.composer.addPass(this.lens)
    this.composer.addPass(new OutputPass())
    this.grain = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
        float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() { vec3 col = texture2D(tDiffuse, vUv).rgb; col += (rnd(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.03; gl_FragColor = vec4(col, 1.0); }`,
    })
    this.composer.addPass(this.grain)
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(w, h)
    this.lens.uniforms.uAspect.value = w / h
  }

  /** under: 0 above water .. 1 submerged. cursor in 0..1 screen space. stir: how recently the pointer moved (0..1). */
  render(time: number, velocity: number, under: number, cursor: THREE.Vector2, stir: number, bloom: number, threshold: number) {
    const u = this.lens.uniforms
    u.uTime.value = time; u.uVel.value = Math.min(Math.abs(velocity), 1.5); u.uUnder.value = under
    u.uCursor.value.copy(cursor); u.uStir.value = stir; u.uVignette.value = 0.45 + under * 0.5
    this.bloom.strength = bloom; this.bloom.threshold = threshold
    this.grain.uniforms.uTime.value = time
    this.composer.render()
  }
}
