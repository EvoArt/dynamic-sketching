import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { computeIntersections, normalCurves } from './analysis'
import { type ShapeKind, type ShapeSpec, solidOf } from './shapes'

let n = 0
function shape(kind: ShapeKind, size: [number, number, number], position: [number, number, number], rotation: [number, number, number] = [0, 0, 0]): ShapeSpec {
  return { id: `s${n++}`, kind, size, position, rotation, color: '#fff', opacity: 1, visible: true }
}

const pts = (lines: Vector3[][]) => lines.flat()

function triArea(f: Float32Array) {
  let a = 0
  for (let i = 0; i < f.length; i += 9) {
    const p = new Vector3(f[i], f[i + 1], f[i + 2])
    const q = new Vector3(f[i + 3], f[i + 4], f[i + 5]).sub(p)
    const r = new Vector3(f[i + 6], f[i + 7], f[i + 8]).sub(p)
    a += q.cross(r).length() / 2
  }
  return a
}

describe('cube corner pushed into a sphere', () => {
  const sphere = solidOf(shape('sphere', [2, 2, 2], [0, 0, 0]))
  const cube = solidOf(shape('box', [2, 2, 2], [1.2, 1.2, 1.2])) // corner at (0.2, 0.2, 0.2)
  const r = computeIntersections([sphere, cube], 40)

  it('finds intersection points on both surfaces', () => {
    const p = pts(r.intersections)
    expect(p.length).toBeGreaterThan(30)
    for (const q of p) {
      expect(q.length()).toBeCloseTo(1, 4)
      const onFace = [q.x, q.y, q.z].some((c) => Math.abs(c - 0.2) < 1e-6)
      expect(onFace).toBe(true)
      for (const c of [q.x, q.y, q.z]) expect(c).toBeGreaterThan(0.2 - 1e-6)
    }
  })

  it('shows the full circle each face plane cuts from the sphere', () => {
    const all = pts(r.construction).concat(pts(r.intersections))
    for (const axis of ['x', 'y', 'z'] as const) {
      const onPlane = all.filter((q) => Math.abs(q[axis] - 0.2) < 1e-6 && Math.abs(q.length() - 1) < 1e-4)
      // Points all the way round the circle, including the far side.
      const others = (['x', 'y', 'z'] as const).filter((a) => a !== axis)
      const quadrants = new Set(onPlane.map((q) => `${q[others[0]] > 0}${q[others[1]] > 0}`))
      expect(quadrants.size).toBe(4)
    }
  })

  it('fills the three section discs', () => {
    expect(triArea(r.fills)).toBeCloseTo(3 * Math.PI * (1 - 0.04), 1)
  })
})

describe('cylinder pushed through a box', () => {
  const box = solidOf(shape('box', [2, 1, 2], [0, 0, 0]))
  const cyl = solidOf(shape('cylinder', [1, 3, 1], [0, 0, 0], [90, 0, 0])) // axis along z
  const r = computeIntersections([box, cyl], 40)

  it('makes a circle where it enters and where it leaves', () => {
    const p = pts(r.intersections)
    const front = p.filter((q) => Math.abs(q.z - 1) < 1e-6)
    const back = p.filter((q) => Math.abs(q.z + 1) < 1e-6)
    expect(front.length).toBeGreaterThan(20)
    expect(back.length).toBeGreaterThan(20)
    for (const q of [...front, ...back]) expect(Math.hypot(q.x, q.y)).toBeCloseTo(0.5, 4)
  })
})

describe('box face slicing a cone at a slant', () => {
  const cone = solidOf(shape('cone', [2, 2, 2], [0, 0, 0]))
  const slab = solidOf(shape('box', [4, 1, 4], [0, 0.6, 0], [0, 0, 20]))
  const r = computeIntersections([cone, slab], 48)

  it('gives a closed conic lying on the cone', () => {
    const p = pts(r.intersections)
    expect(p.length).toBeGreaterThan(30)
    // On the cone: radius = (1 - y) / 2 * 2 / 2 ... base radius 1 at y = -1, apex at y = 1.
    for (const q of p) expect(Math.hypot(q.x, q.z)).toBeCloseTo((1 - q.y) / 2, 3)
  })
})

describe('silhouette of a sphere', () => {
  it('is the circle of tangency from the eye', () => {
    const sphere = solidOf(shape('sphere', [2, 2, 2], [0, 0, 0]))
    const eye = new Vector3(0, 0, 10)
    const lines = normalCurves([sphere], { point: eye }, 32)
    const p = pts(lines)
    expect(p.length).toBeGreaterThan(30)
    for (const q of p) {
      expect(q.z).toBeCloseTo(0.1, 3)
      expect(Math.hypot(q.x, q.y)).toBeCloseTo(Math.sqrt(1 - 0.01), 3)
    }
  })
})
