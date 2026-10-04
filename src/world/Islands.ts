import * as THREE from 'three'
import { smoothstep, vnoise } from '../core/math'

const fbm = (x: number, z: number) => vnoise(x, z) * 0.5 + vnoise(x * 2.1, z * 2.1) * 0.25 + vnoise(x * 4.3, z * 4.3) * 0.125 + vnoise(x * 8.7, z * 8.7) * 0.0625

/** A chain of mountainous islands on the horizon: ridged peaks, forest below, bare rock above, snow on the highest. */
export function createIslands() {
  const W = 3800, D = 1100, geo = new THREE.PlaneGeometry(W, D, 260, 90)
  geo.rotateX(-Math.PI / 2)
  geo.translate(-150, 0, -1500)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i)
    // islands: where a slow noise is high; the range also falls away to the sea at the front, back and sides
    const land = smoothstep(0.42, 0.62, vnoise(x * 0.0011 + 5, z * 0.0006)) * smoothstep(-1000, -1250, z) * smoothstep(-2050, -1750, z) * smoothstep(1900, 1500, Math.abs(x + 150))
    const ridged = 1 - Math.abs(fbm(x * 0.0032 + 20, z * 0.0032) * 2 - 1)
    p.setY(i, land * (ridged * ridged * 420 + fbm(x * 0.012, z * 0.012) * 60) - 14)
  }
  geo.computeVertexNormals()
  const n = geo.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color()
  const forest = new THREE.Color('#2c3b22'), rock = new THREE.Color('#5c544c'), snow = new THREE.Color('#e8ecf2'), shore = new THREE.Color('#7b6e58')
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), slope = n.getY(i)
    c.copy(shore).lerp(forest, smoothstep(2, 22, y))
    c.lerp(rock, Math.max(smoothstep(110, 210, y + vnoise(p.getX(i) * 0.02, p.getZ(i) * 0.02) * 60), smoothstep(0.8, 0.6, slope)))
    c.lerp(snow, smoothstep(270, 330, y) * smoothstep(0.55, 0.8, slope))
    col.set([c.r, c.g, c.b], i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))
}
