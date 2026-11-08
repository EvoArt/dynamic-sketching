// 2D overlay: horizon (eye level), vanishing points and the lines running to
// them. Drawn with the canvas API over the 3D view, in CSS pixels.

import { type Camera, PerspectiveCamera, Vector3, Vector4 } from 'three'
import type { Settings } from '../core/scene'
import type { Solid } from '../core/shapes'

const VP_COLOURS = ['#d1203a', '#2f6db5', '#2e8b57', '#b5642f', '#7b3fb5', '#0f8b8d']
const HORIZON = '#0f8b8d'

interface Pt {
  x: number
  y: number
}

/** Screen position of the vanishing point of a direction, or null if it is at infinity. */
function vanishing(cam: Camera, d: Vector3, w: number, h: number): Pt | null {
  const v = new Vector4(d.x, d.y, d.z, 0).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix)
  if (Math.abs(v.w) < 1e-4 * Math.hypot(v.x, v.y)) return null
  return { x: ((v.x / v.w + 1) / 2) * w, y: ((1 - v.y / v.w) / 2) * h }
}

/** Screen position of a point, or null if it is behind the eye. */
function project(cam: Camera, p: Vector3, w: number, h: number): Pt | null {
  const v = new Vector4(p.x, p.y, p.z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix)
  if (v.w <= 1e-6) return null
  return { x: ((v.x / v.w + 1) / 2) * w, y: ((1 - v.y / v.w) / 2) * h }
}

function onScreen(p: Pt, w: number, h: number, m = 0) {
  return p.x >= -m && p.x <= w + m && p.y >= -m && p.y <= h + m
}

/** Draws the full line through a and b across the canvas. */
function infiniteLine(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, w: number, h: number) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return
  const k = (w + h) * 4 / len
  ctx.beginPath()
  ctx.moveTo(a.x - dx * k, a.y - dy * k)
  ctx.lineTo(a.x + dx * k, a.y + dy * k)
  ctx.stroke()
}

/** A marker pinned to the screen edge pointing at an off-screen point. */
function edgeArrow(ctx: CanvasRenderingContext2D, p: Pt, w: number, h: number, colour: string) {
  const cx = w / 2
  const cy = h / 2
  const dx = p.x - cx
  const dy = p.y - cy
  const s = Math.min((w / 2 - 18) / Math.abs(dx || 1e-9), (h / 2 - 18) / Math.abs(dy || 1e-9))
  const x = cx + dx * s
  const y = cy + dy * s
  const ang = Math.atan2(dy, dx)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(ang)
  ctx.fillStyle = colour
  ctx.beginPath()
  ctx.moveTo(10, 0)
  ctx.lineTo(-6, -7)
  ctx.lineTo(-6, 7)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  solids: Solid[],
  settings: Settings,
  w: number,
  h: number,
  selected: string | null,
) {
  if (!(cam instanceof PerspectiveCamera)) return
  cam.updateMatrixWorld()
  const v = settings.view
  ctx.lineCap = 'round'
  ctx.font = '600 12px system-ui, sans-serif'

  if (v.horizon) {
    const f = cam.getWorldDirection(new Vector3())
    const fh = new Vector3(f.x, 0, f.z)
    if (fh.lengthSq() > 1e-6) {
      fh.normalize()
      const side = new Vector3(-fh.z, 0, fh.x)
      const a = vanishing(cam, fh, w, h)
      const b = vanishing(cam, fh.clone().add(side.multiplyScalar(0.3)), w, h)
      if (a && b) {
        ctx.strokeStyle = HORIZON
        ctx.lineWidth = 1.5
        ctx.setLineDash([])
        infiniteLine(ctx, a, b, w, h)
        // Label near the left edge.
        const t = (12 - a.x) / (b.x - a.x || 1e-9)
        const ly = a.y + (b.y - a.y) * t
        if (ly > 14 && ly < h - 4) {
          ctx.fillStyle = HORIZON
          ctx.fillText('horizon · eye level', 12, ly - 6)
        }
      }
    }
  }

  if (!v.vanishing) return
  // Selected shape only when one is selected, else every flat-sided shape.
  const chosen = solids.filter((s) => s.spec.visible && s.prim.edgeGroups.length && (!selected || s.spec.id === selected))
  const list = chosen.length ? chosen : solids.filter((s) => s.spec.visible && s.prim.edgeGroups.length)
  for (const s of list) {
    s.prim.edgeGroups.forEach((g, gi) => {
      const colour = VP_COLOURS[gi % VP_COLOURS.length]
      const dir = g.dir.clone().transformDirection(s.matrix)
      const vp = vanishing(cam, dir, w, h)
      ctx.strokeStyle = colour
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 1
      ctx.setLineDash([6, 5])
      if (v.vanishingLines) {
        for (const [a3, b3] of g.edges) {
          const a = project(cam, a3.clone().applyMatrix4(s.matrix), w, h)
          const b = project(cam, b3.clone().applyMatrix4(s.matrix), w, h)
          if (!a || !b) continue
          ctx.beginPath()
          if (vp) {
            // From the end further from the vanishing point, to it.
            const far = Math.hypot(a.x - vp.x, a.y - vp.y) > Math.hypot(b.x - vp.x, b.y - vp.y) ? a : b
            ctx.moveTo(far.x, far.y)
            ctx.lineTo(vp.x, vp.y)
            ctx.stroke()
          } else infiniteLine(ctx, a, b, w, h) // parallel on screen: no convergence
        }
      }
      ctx.globalAlpha = 1
      ctx.setLineDash([])
      if (!vp) return
      if (onScreen(vp, w, h)) {
        ctx.fillStyle = '#fff'
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(vp.x, vp.y, 6, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = colour
        ctx.beginPath()
        ctx.arc(vp.x, vp.y, 2.5, 0, Math.PI * 2)
        ctx.fill()
      } else edgeArrow(ctx, vp, w, h, colour)
    })
  }
}
