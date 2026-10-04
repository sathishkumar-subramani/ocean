import * as THREE from 'three'
import { VirtualScroll } from './core/VirtualScroll'
import { CameraPath, type Shot } from './core/CameraPath'
import { Assets } from './core/Assets'
import { Post } from './core/Post'
import { smoothstep } from './core/math'
import { createSkyDome, skyUniforms } from './world/skyGlsl'
import { Water } from './world/Water'
import { Ship } from './world/Ship'
import { createIslands } from './world/Islands'
import { City, seabedHeight } from './world/City'
import { Maidens } from './world/Maidens'
import { FishSchools, Giants } from './world/Fish'
import { Deep } from './world/Deep'
import { Bubbles, LightShafts, Snow, sea } from './world/Underwater'

// --------------------------------------------------------------- content ---
const SECTIONS = [
  { title: 'The surface', text: 'Open water, a ship under way, mountains on the horizon. Everything you know about the sea is this thin skin on top of it.', hint: 'Move the pointer across the water' },
  { title: 'The ship', text: 'She has crossed this stretch a hundred times. Nobody on board has seen what lies under her keel.', hint: 'Sweep the pointer through the smoke' },
  { title: 'Below', text: 'One step down and the horizon is gone. The sky shrinks to a bright window overhead; everything else is blue.', hint: 'Move the pointer to stir the water' },
  { title: 'The drowned city', text: 'Domes, arches and a great stair, ninety metres down. Nobody lit these lanterns, and nobody has put them out.', hint: 'Fish keep clear of the pointer' },
  { title: 'The avenue', text: 'The old processional way still runs to the palace. Its keepers swim it now, between the lamps and the white tree.', hint: 'Reach for a sea maiden and she twirls' },
  { title: 'The edge', text: 'Behind the palace the seabed simply ends. Far down the slope, something is glowing red.', hint: 'Keep going' },
  { title: 'The volcano', text: 'No sunlight has ever reached this far. The mountain makes its own: lava in the crater, and rivers of it down the flanks.', hint: 'The plankton wakes near the pointer' },
  { title: 'Fire under water', text: 'Most of the planet\u2019s eruptions happen like this, in the dark, with nobody watching. Tonight you are.', hint: 'Sweep the pointer through the ash and sparks' },
]
const SHIP_AT = new THREE.Vector3(24, 0, -95)
const VOLCANO = new THREE.Vector3(0, 0, -735)
const VY = seabedHeight(VOLCANO.x, VOLCANO.z)                              // the trench floor under the volcano
const SHOTS: Shot[] = [
  { at: 0, position: [0, 5.5, 40], lookAt: [14, 7, -95] },
  { at: 1, position: [-26, 4.6, -46], lookAt: [22, 8, -95] },
  { at: 1.55, position: [-14, 1.4, -72], lookAt: [10, -6, -110] },        // skimming the surface, about to go under
  { at: 2, position: [-8, -10, -82], lookAt: [22, -1, -97] },             // looking up at the hull
  { at: 3, position: [0, -36, -80], lookAt: [0, -80, -240] },              // the whole city from above
  { at: 4, position: [2, -84, -120], lookAt: [0, -77, -270] },             // at lamp height, on the avenue
  { at: 4.5, position: [0, -76, -287], lookAt: [0, -90, -400] },           // through the rotunda, under its dome
  { at: 5, position: [0, -99, -404], lookAt: [0, -190, -570] },            // on the lip of the trench, looking down the slope
  { at: 5.5, position: [12, -150, -500], lookAt: [0, VY + 40, -700] },
  { at: 6, position: [44, VY + 40, -612], lookAt: [0, VY + 32, -735] },
  { at: 7, position: [-32, VY + 80, -672], lookAt: [0, VY + 50, -735] },
]

// -------------------------------------------------------------- renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
renderer.toneMapping = THREE.ACESFilmicToneMapping
const canvas = renderer.domElement
document.getElementById('webgl')!.appendChild(canvas)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 5000)

const assets = new Assets(renderer)
await assets.loadAll({ hdr: { env: '/assets/env_sunset.hdr' }, models: { ship: '/assets/ship.glb' }, images: { kelp: '/assets/kelp.png' } })

// ----------------------------------------------------------------- world ---
const env = assets.texture('env')
env.mapping = THREE.EquirectangularReflectionMapping
scene.environment = env
const fog = new THREE.FogExp2(0xffffff, 0.0005)
scene.fog = fog
const bg = new THREE.Color()
scene.background = bg

const sun = new THREE.DirectionalLight(0xffffff, 3)
const fill = new THREE.HemisphereLight(0xffffff, 0x000000, 0.4)
scene.add(sun, sun.target, fill)

const dome = createSkyDome()
const water = new Water()
const ship = new Ship(assets.model('ship'), water, SHIP_AT, 0.62)
const islands = createIslands()
const city = new City(assets.texture('kelp'))
const fish = new FishSchools([
  { centre: [0, -80, -172], radius: [8, 3, 22], count: 150, tint: '#c9d6e0', size: 0.6 },      // this one works the avenue, right past the street camera
  { centre: [-34, -58, -215], radius: [26, 6, 34], count: 140, tint: '#f0a43c', size: 0.7 },
  { centre: [0, -77, -236], radius: [11, 3, 13], count: 130, tint: '#8fd9cf', size: 0.6 },      // over the great stair
  { centre: [0, -34, -100], radius: [40, 6, 40], count: 90, tint: '#b8c6d8', size: 1.5 },
])
const giants = new Giants(new THREE.Vector3(0, -80, -175))
const maidens = new Maidens()
const deep = new Deep(VOLCANO, seabedHeight)
const shafts = new LightShafts()
const snow = new Snow()
const bubbles = new Bubbles()
const cityLife = new THREE.Group()
cityLife.add(city.group, fish.mesh, giants.group, maidens.mesh)
scene.add(dome, water.mesh, ship.group, ship.smoke, islands, cityLife, deep.group, deep.lamp, shafts.mesh, snow.points, bubbles.points)

const post = new Post(renderer, scene, camera)

// ----------------------------------------------------------------- looks ---
type Theme = 'sun' | 'moon'
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b)
/** Everything that differs between sunset and a moonlit night. */
const LOOKS = {
  sun: {
    lightDir: new THREE.Vector3(0.14, 0.1, -1).normalize(), lightCol: C(1.0, 0.58, 0.28), lightPower: 3.4, env: 1.0,
    zenith: C(0.1, 0.17, 0.4), horizon: C(0.72, 0.44, 0.36), horizonSun: C(2.0, 0.85, 0.3), cloudLit: C(1.5, 0.72, 0.45), cloudShade: C(0.26, 0.2, 0.32), cover: 0.5,
    sunDisc: C(1.0, 0.6, 0.28), moon: 0, stars: 0,
    waterDeep: C(0.012, 0.06, 0.09), waterShallow: C(0.03, 0.2, 0.22), scatter: C(0.1, 0.45, 0.34), glitter: C(1.0, 0.6, 0.3), fogAbove: C(0.62, 0.42, 0.36),
    underTop: C(0.03, 0.27, 0.33), underMid: C(0.01, 0.125, 0.15), caustic: 1, shafts: 1, shaftCol: C(0.4, 0.8, 0.7), night: 0, smoke: C(0.1, 0.09, 0.1), smokeLit: C(0.75, 0.42, 0.3), exposure: 1.0,
  },
  moon: {
    lightDir: new THREE.Vector3(-0.1, 0.34, -1).normalize(), lightCol: C(0.55, 0.66, 0.9), lightPower: 0.55, env: 0.1,
    zenith: C(0.008, 0.013, 0.035), horizon: C(0.035, 0.055, 0.11), horizonSun: C(0.05, 0.075, 0.14), cloudLit: C(0.2, 0.24, 0.33), cloudShade: C(0.02, 0.026, 0.05), cover: 0.44,
    sunDisc: C(0, 0, 0), moon: 1, stars: 1,
    waterDeep: C(0.002, 0.008, 0.018), waterShallow: C(0.006, 0.03, 0.05), scatter: C(0.01, 0.04, 0.06), glitter: C(0.5, 0.62, 0.9), fogAbove: C(0.035, 0.055, 0.11),
    underTop: C(0.006, 0.04, 0.075), underMid: C(0.003, 0.03, 0.045), caustic: 0.35, shafts: 0.45, shaftCol: C(0.3, 0.45, 0.8), night: 1, smoke: C(0.02, 0.025, 0.035), smokeLit: C(0.14, 0.17, 0.25), exposure: 1.15,
  },
}
const DEEP_COLOR = C(0.0, 0.003, 0.01)
let theme: Theme = 'sun'
let look = LOOKS.sun

function setTheme(next: Theme) {
  theme = next
  look = LOOKS[next]
  document.documentElement.dataset.theme = next
  themeBtn.textContent = next === 'sun' ? 'Moon' : 'Sun'
  const u = skyUniforms
  u.uZenith.value.copy(look.zenith); u.uHorizon.value.copy(look.horizon); u.uHorizonSun.value.copy(look.horizonSun)
  u.uCloudLit.value.copy(look.cloudLit); u.uCloudShade.value.copy(look.cloudShade); u.uCover.value = look.cover
  u.uSun.value.copy(look.sunDisc); u.uSunDir.value.copy(LOOKS.sun.lightDir); u.uMoon.value = look.moon; u.uMoonDir.value.copy(LOOKS.moon.lightDir); u.uStars.value = look.stars
  const w = water.uniforms
  w.uLightDir.value.copy(look.lightDir); w.uLightCol.value.copy(look.glitter)
  w.uDeep.value.copy(look.waterDeep); w.uShallow.value.copy(look.waterShallow); w.uScatter.value.copy(look.scatter); w.uFog.value.copy(look.fogAbove)
  sun.color.copy(look.lightCol)
  sun.position.copy(look.lightDir).multiplyScalar(100)
  scene.environmentRotation.y = Math.atan2(-look.lightDir.z, look.lightDir.x)
  ship.setLook(look.night, look.smoke, look.smokeLit)
  ;(shafts.mesh.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(look.shaftCol)
  sea.uCaustic.value = look.caustic
  renderer.toneMappingExposure = look.exposure
  try { localStorage.setItem('theme', next) } catch { /* storage can be blocked */ }
}

// -------------------------------------------------------------------- ui ---
const $ = (id: string) => document.getElementById(id)!
const copy = $('copy'), ticks = $('ticks'), hud = $('hud'), fadeEl = $('fade'), depthEl = $('depth').firstElementChild as HTMLElement
const [idxEl, titleEl, textEl, hintEl] = Array.from(copy.children) as HTMLElement[]
const themeBtn = $('theme') as HTMLButtonElement
SECTIONS.forEach(() => ticks.appendChild(document.createElement('i')))
let shown = -1
function setSection(i: number) {
  if (i === shown) return
  shown = i
  copy.classList.add('out')
  setTimeout(() => {
    if (i !== shown) return
    idxEl.textContent = `${String(i + 1).padStart(2, '0')} / ${String(SECTIONS.length).padStart(2, '0')}`
    titleEl.textContent = SECTIONS[i].title; textEl.textContent = SECTIONS[i].text; hintEl.textContent = SECTIONS[i].hint
    copy.classList.remove('out')
  }, 380)
  Array.from(ticks.children).forEach((t, k) => t.classList.toggle('on', k === i))
}
let busy = false
themeBtn.addEventListener('click', () => {
  if (busy) return
  busy = true; fadeEl.classList.add('on')                                  // the whole sky changes: hide the cut
  setTimeout(() => { setTheme(theme === 'sun' ? 'moon' : 'sun'); fadeEl.classList.remove('on'); busy = false }, 460)
})
window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 't') themeBtn.click() })

// ----------------------------------------------------------------- input ---
const scroll = new VirtualScroll(canvas, SECTIONS.length)
const path = new CameraPath(SHOTS)
const pointer = new THREE.Vector2(), pointerSmooth = new THREE.Vector2(), cursorUv = new THREE.Vector2(0.5, 0.5)
const raycaster = new THREE.Raycaster()
const surface = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const hit = new THREE.Vector3(), stirAt = new THREE.Vector3()
let W = 1, H = 1, moved = false, stir = 0, lastTouch = 0, hasPointer = false
window.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / W) * 2 - 1, -((e.clientY / H) * 2 - 1))
  cursorUv.set(e.clientX / W, 1 - e.clientY / H)
  moved = true; hasPointer = true
})

const QUALITY = [1.5, 1.25, 1.0, 0.8, 0.66]
let quality = 1, slow = 0
function resize() {
  W = window.innerWidth; H = window.innerHeight
  const pr = Math.min(window.devicePixelRatio, QUALITY[quality])
  renderer.setPixelRatio(pr); renderer.setSize(W, H); post.setSize(W, H, pr)
  camera.aspect = W / H
  camera.fov = W / H < 1 ? 62 : 42
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()
try { const saved = localStorage.getItem('theme'); setTheme(saved === 'moon' ? 'moon' : 'sun') } catch { setTheme('sun') }

// ------------------------------------------------------------------ loop ---
const clock = new THREE.Clock()
const tmpColor = new THREE.Color()
let fps = 60
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1)
  if (window.innerWidth !== W || window.innerHeight !== H) resize()          // self-heal: a missed resize event (window snap, maximise, devtools) must never leave a half-drawn frame
  const time = clock.elapsedTime
  scroll.update(dt)
  const p = scroll.current
  pointerSmooth.lerp(pointer, 1 - Math.exp(-4 * dt))
  path.apply(camera, p, pointerSmooth)
  const dbg = (window as unknown as { __cam?: number[] }).__cam                 // developer override: [x, y, z, lookX, lookY, lookZ]
  if (dbg) { camera.position.set(dbg[0], dbg[1], dbg[2]); camera.lookAt(dbg[3], dbg[4], dbg[5]) }
  camera.updateMatrixWorld()
  const y = camera.position.y
  const under = y < water.heightAt(camera.position.x, camera.position.z, time) - 0.2
  const depth = Math.max(0, -y)

  // ---- the medium: air above, water below, each with its own haze and light ----
  skyUniforms.uTime.value = sea.uTime.value = time
  if (under) {
    const toMid = smoothstep(5, 80, depth), toDeep = smoothstep(120, 200, depth)
    tmpColor.copy(look.underTop).lerp(look.underMid, toMid).lerp(DEEP_COLOR, toDeep)
    fog.color.copy(tmpColor); fog.density = 0.0065 - toMid * 0.0018 + toDeep * 0.0012   // clear water over the city: you can see the palace from the far end of the avenue
    bg.copy(tmpColor)
    const reach = Math.exp(-depth * 0.011) * (1 - toDeep)                    // how much surface light is left
    sun.intensity = look.lightPower * 0.8 * reach
    fill.color.copy(look.underTop); fill.intensity = (0.5 + look.env) * reach + 0.05
    scene.environmentIntensity = look.env * 0.25 * reach
  } else {
    fog.color.copy(look.fogAbove); fog.density = 0.00045
    bg.copy(look.fogAbove)
    sun.intensity = look.lightPower
    fill.color.copy(look.horizon); fill.intensity = 0.3 + look.env * 0.3
    scene.environmentIntensity = look.env
  }
  water.uniforms.uUnderFog.value.copy(fog.color); water.uniforms.uUnderFogD.value = fog.density * 1.4

  // ---- only what the camera can reach is drawn ----
  dome.visible = islands.visible = !under
  water.mesh.visible = depth < 170
  ship.group.visible = ship.smoke.visible = depth < 70
  cityLife.visible = under && depth < 235
  deep.group.visible = under && camera.position.z < -330

  // ---- the pointer: ripples above, a stir below ----
  raycaster.setFromCamera(pointer, camera)
  let scare: THREE.Vector3 | null = null
  stir = Math.max(0, stir - dt * 0.9)
  if (hasPointer) {
    if (under) {
      scare = stirAt.copy(raycaster.ray.direction).multiplyScalar(depth > 200 ? 14 : 20).add(raycaster.ray.origin)
      sea.uGlowAt.value.copy(scare)
      if (moved) { stir = 1; if (time - lastTouch > 0.07) { bubbles.emit(scare, 2); lastTouch = time } }
    } else if (moved && time - lastTouch > 0.11 && raycaster.ray.intersectPlane(surface, hit) && hit.distanceTo(camera.position) < 500) {
      water.touch(hit.x, hit.z, time)
      lastTouch = time
    }
  }
  moved = false

  water.update(camera)
  if (ship.group.visible) ship.update(time, dt, hasPointer && !under ? raycaster.ray : null)
  const waterRay = under && hasPointer ? raycaster.ray : null
  if (cityLife.visible) { fish.update(time, dt, waterRay); giants.update(time); maidens.update(time, dt, waterRay) }
  if (deep.group.visible) deep.update(time, dt, waterRay); else deep.lamp.intensity = 0
  shafts.update(camera, under ? smoothstep(150, 12, depth) * look.shafts : 0)
  snow.update(under ? 1 : 0, smoothstep(170, 235, depth))
  bubbles.update(time, dt)

  const dark = smoothstep(120, 200, depth)
  post.render(time, scroll.velocity, under ? 1 : 0, cursorUv, stir, under ? 0.4 - dark * 0.12 : 0.28, under ? 1.0 : 2.2)

  setSection(Math.round(p))
  depthEl.textContent = `${depth < 0.5 ? 0 : Math.round(depth)} m`
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05
  slow = fps < 40 && time > 4 ? slow + dt : 0
  if (slow > 2 && quality < QUALITY.length - 1) { quality++; slow = 0; resize() }
  hud.textContent = `fps ${fps.toFixed(0)}  scale ${Math.min(window.devicePixelRatio, QUALITY[quality]).toFixed(2)}`
  requestAnimationFrame(frame)
}
frame()
$('loader').classList.add('done')

// handy while developing: __app.scroll.goTo(4), __app.setTheme('moon')
;(window as unknown as Record<string, unknown>).__app = { scroll, camera, renderer, setTheme, water, bubbles, fish, maidens, THREE }
