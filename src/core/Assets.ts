import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

export interface Manifest {
  models?: Record<string, string>   // glTF / GLB, Draco compressed
  images?: Record<string, string>   // jpg / png / webp
  ktx2?: Record<string, string>     // GPU-compressed textures (later stage)
  hdr?: Record<string, string>      // Radiance .hdr environment maps
}

/** Loads everything up front and reports progress, so a loader screen can sit on top. */
export class Assets {
  private gltf = new GLTFLoader()
  private ktx2 = new KTX2Loader()
  private image = new THREE.TextureLoader()
  private rgbe = new RGBELoader()
  private models = new Map<string, GLTF>()
  private textures = new Map<string, THREE.Texture>()

  constructor(renderer: THREE.WebGLRenderer) {
    const draco = new DRACOLoader().setDecoderPath('/decoders/draco/')
    this.ktx2.setTranscoderPath('/decoders/basis/').detectSupport(renderer)
    this.gltf.setDRACOLoader(draco).setKTX2Loader(this.ktx2)
  }

  async loadAll(manifest: Manifest, onProgress: (ratio: number) => void = () => {}) {
    const jobs: Promise<void>[] = []
    let done = 0
    const tick = () => onProgress(++done / Math.max(1, jobs.length))
    const tex = (loader: { loadAsync(url: string): Promise<THREE.Texture> }, group?: Record<string, string>) => {
      for (const [key, url] of Object.entries(group ?? {})) {
        jobs.push(loader.loadAsync(url).then((t) => { this.textures.set(key, t); tick() }))
      }
    }
    for (const [key, url] of Object.entries(manifest.models ?? {})) {
      jobs.push(this.gltf.loadAsync(url).then((g) => { this.models.set(key, g); tick() }))
    }
    tex(this.image, manifest.images)
    tex(this.ktx2, manifest.ktx2)
    tex(this.rgbe, manifest.hdr)
    await Promise.all(jobs)
    onProgress(1)
  }

  model(key: string) {
    const m = this.models.get(key)
    if (!m) throw new Error(`model not loaded: ${key}`)
    return m
  }
  texture(key: string) {
    const t = this.textures.get(key)
    if (!t) throw new Error(`texture not loaded: ${key}`)
    return t
  }

  /** A tiling PBR set: <name>_albedo, <name>_normal, <name>_rough. */
  pbr(name: string, repeat: number, anisotropy = 8) {
    const get = (suffix: string, srgb = false) => {
      const t = this.texture(`${name}_${suffix}`)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.setScalar(repeat)
      t.anisotropy = anisotropy
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      return t
    }
    return { map: get('albedo', true), normalMap: get('normal'), roughnessMap: get('rough') }
  }
}
