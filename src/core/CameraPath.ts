import * as THREE from 'three'

export interface Shot {
  /** Scroll progress (in sections) at which the camera is exactly here. */
  at: number
  position: [number, number, number]
  lookAt: [number, number, number]
}

/**
 * Camera keyframes joined by Catmull-Rom splines. Keys sit at whole sections
 * (where the scroll snaps) and anywhere in between ("fly through the door").
 */
export class CameraPath {
  private pos: THREE.CatmullRomCurve3
  private look: THREE.CatmullRomCurve3
  private tmp = new THREE.Vector3()

  constructor(public shots: Shot[]) {
    this.pos = new THREE.CatmullRomCurve3(shots.map((s) => new THREE.Vector3(...s.position)), false, 'catmullrom', 0.3)
    this.look = new THREE.CatmullRomCurve3(shots.map((s) => new THREE.Vector3(...s.lookAt)), false, 'catmullrom', 0.3)
  }

  apply(camera: THREE.PerspectiveCamera, p: number, pointer: THREE.Vector2) {
    const s = this.shots
    let i = 0
    while (i < s.length - 2 && p > s[i + 1].at) i++
    const local = THREE.MathUtils.clamp((p - s[i].at) / (s[i + 1].at - s[i].at), 0, 1)
    const t = (i + local) / (s.length - 1)
    this.pos.getPoint(t, camera.position)
    camera.position.x += pointer.x * 0.35 // small pointer parallax so the frame never feels frozen
    camera.position.y += pointer.y * 0.2
    this.look.getPoint(t, this.tmp)
    camera.lookAt(this.tmp)
  }
}
