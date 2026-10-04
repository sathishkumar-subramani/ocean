// Copies the Draco and Basis (KTX2) decoders out of three.js into /public
// so the loaders can fetch them at runtime.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
const libs = 'node_modules/three/examples/jsm/libs'
if (existsSync(libs)) {
  mkdirSync('public/decoders', { recursive: true })
  cpSync(`${libs}/draco/gltf`, 'public/decoders/draco', { recursive: true })
  cpSync(`${libs}/basis`, 'public/decoders/basis', { recursive: true })
  console.log('decoders copied to public/decoders')
}
