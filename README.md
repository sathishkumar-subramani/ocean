# Fathom — a descent in three parts

A scroll-driven WebGL journey: the surface of the sea with a ship and
mountains, a drowned modern city below it, and the lightless deep.

```
npm install
npm run dev
```

Controls
- Wheel / drag / arrow keys: move between the eight stops
- Pointer above water: ripples spread where it touches the sea; smoke from the funnels is blown aside
- Pointer under water: the view ripples around it, bubbles rise, fish dart away from it
- Pointer in the deep: plankton lights up near it, jellyfish drift aside
- Top-right button or `T`: sunset / moonlit night

Console helpers: `__app.scroll.goTo(4)`, `__app.setTheme('moon')`.

## Structure
- `src/main.ts` — the text, camera shots, the two looks (sun / moon), what is drawn at which depth, pointer handling, render loop
- `src/world/skyGlsl.ts` — one sky function (gradient, clouds, sun, moon, stars) shared by the dome and by the water's reflections
- `src/world/Water.ts` — the sea: Gerstner swell, pointer ripples, Fresnel reflection, glitter, foam; from below, Snell's window
- `src/world/Ship.ts` — the steamer floating on the swell, and its smoke particles
- `src/world/Islands.ts` — mountains on the horizon
- `src/world/City.ts` — seabed, towers with a procedural facade, the avenue, kelp
- `src/world/Fish.ts` — schools of fish (pointer avoidance), rays, a whale
- `src/world/Deep.ts` — jellyfish, lures, glowing growths
- `src/world/Underwater.ts` — caustics for any material, light shafts, marine snow / plankton, bubbles
- `src/core/*` — scroll spring, camera splines, asset loading, post-processing (underwater wobble + cursor ripple)

## Assets (all made for this project)
- `public/assets/ship.glb` — steamer modelled in Blender (`_blender/ship.blend`), Draco
- `public/assets/env_sunset.hdr` — sky panorama rendered in Blender, used for image-based lighting
- `public/assets/kelp.png` — kelp frond cut-out from `scripts/gen_kelp.py`
- Everything else (water, sky, mountains, city, fish, jellyfish) is generated in code.

## Ideas for the next stage
- Wreckage and detail in the city: bridges, signs, a sunken tram; coral on the roofs
- Sound: wind and hull above, muffled drone below, near silence in the deep
- A real wake behind the ship, spray at the bow
- Text drawn inside the canvas, loader with progress
