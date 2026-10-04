import { clamp } from './math'

/**
 * There is no real page scroll. Wheel / touch / keys push a `target` value
 * measured in "sections" (0 = first section, 1 = second, ...).
 *
 * Two things make it feel smooth:
 *  1. `current` follows `target` through a critically damped spring, so the
 *     camera eases in AND out (a plain lerp starts with a jerk).
 *  2. When input stops, the target settles on a section. A small nudge returns
 *     to where you were; a real scroll gesture carries on to the next section
 *     instead of springing back.
 */
export class VirtualScroll {
  current = 0
  target = 0
  velocity = 0
  /** Several scrollers can share one canvas (tour, detail view); only the enabled one listens. */
  enabled = true

  private anchor = 0          // the section we were resting on before this gesture
  private idle = 0
  private settled = true
  private touchY: number | null = null

  constructor(
    private el: HTMLElement,
    private sections: number,
    private opts = {
      wheel: 0.0016,          // sections per wheel pixel (one mouse notch is about 100 px)
      touch: 0.004,           // sections per dragged pixel
      smoothTime: 0.6,        // seconds the spring needs to (almost) catch up
      settleDelay: 0.25,      // seconds without input before the target settles
      commit: 0.14,           // how far (in sections) a gesture must travel to move on
    },
  ) {
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    window.addEventListener('pointercancel', this.onUp)
    window.addEventListener('keydown', this.onKey)
  }

  private push(delta: number) {
    if (!this.enabled) return
    // one gesture travels at most one section past where it started; the anchor
    // moves on as the camera arrives, so a long scroll still flows section by section
    const lo = Math.max(0, this.anchor - 1), hi = Math.min(this.sections - 1, this.anchor + 1)
    this.target = clamp(this.target + delta, lo, hi)
    this.idle = 0
    this.settled = false
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    // normalise lines (Firefox) and pages to pixels, and cap a single event
    const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? window.innerHeight : 1
    this.push(clamp(e.deltaY * unit, -240, 240) * this.opts.wheel)
  }
  private onDown = (e: PointerEvent) => { if (this.enabled) this.touchY = e.clientY }
  private onMove = (e: PointerEvent) => {
    if (this.touchY === null) return
    this.push((this.touchY - e.clientY) * this.opts.touch)
    this.touchY = e.clientY
  }
  private onUp = () => { this.touchY = null }
  private onKey = (e: KeyboardEvent) => {
    const fwd = ['ArrowDown', 'PageDown', ' '].includes(e.key)
    const back = ['ArrowUp', 'PageUp'].includes(e.key)
    if (!this.enabled || (!fwd && !back)) return
    e.preventDefault()
    this.goTo(Math.round(this.target) + (fwd ? 1 : -1))
  }

  /** Jump without animation (used when a view opens). */
  reset(section = 0) { this.current = this.target = this.anchor = section; this.velocity = 0; this.settled = true; this.touchY = null }

  goTo(section: number) {
    this.target = this.anchor = clamp(Math.round(section), 0, this.sections - 1)
    this.settled = true
  }

  update(dt: number) {
    this.idle += dt
    if (!this.settled && this.idle > this.opts.settleDelay && this.touchY === null) {
      const d = this.target - this.anchor
      let to = this.anchor
      if (d > this.opts.commit) to = Math.max(this.anchor + 1, Math.round(this.target))
      else if (d < -this.opts.commit) to = Math.min(this.anchor - 1, Math.round(this.target))
      this.goTo(to)
    }
    const near = Math.round(this.current)
    if (near !== this.anchor && Math.abs(this.current - near) < 0.2) this.anchor = near

    // critically damped spring (same maths as Unity's SmoothDamp)
    const omega = 2 / this.opts.smoothTime
    const x = omega * dt
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
    const change = this.current - this.target
    const temp = (this.velocity + omega * change) * dt
    this.velocity = (this.velocity - omega * temp) * decay
    this.current = this.target + (change + temp) * decay
  }

  dispose() {
    this.el.removeEventListener('wheel', this.onWheel)
    this.el.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.onUp)
    window.removeEventListener('keydown', this.onKey)
  }
}
