// Everything the line layers show, worked out from the placed solids.
//
// Intersections: for each pair of patches (pA on A, pB on B), contour B's
// untrimmed surface over pA, keep the parts inside pB's trim. Exact at corners
// on both sides, because pA's boundary and pB's trim are both hit exactly.
//
// Construction (full sections): where pB really cuts A, the whole of pB's
// surface through A is shown, e.g. the full circle a cube face cuts from a
// sphere when only its corner is inside. Likewise for pA through B.
//
// Section fills: those full sections by planar faces, filled in.

import { Box3, ShapeUtils, Vector2, Vector3 } from 'three'
import { type Curve, type Field, clip, contour, joinByEnds, Sampler } from './contour'
import type { Patch, Solid } from './shapes'

export type Polyline = Vector3[]

export interface Intersections {
  intersections: Polyline[]
  construction: Polyline[]
  /** Triangles (x, y, z per vertex) of the planar sections. */
  fills: Float32Array
}

const toLines = (curves: Curve[]): Polyline[] => curves.map((c) => c.map((pt) => pt.p))

function gridFor(patch: Patch, res: number): [number, number] {
  return [Math.max(4, Math.ceil(res * patch.cells[0])), Math.max(3, Math.ceil(res * patch.cells[1]))]
}

/** World bounding box of a patch, padded for curvature between samples. */
export function patchBox(solid: Solid, patch: Patch): Box3 {
  const s = new Sampler(patch, solid.matrix)
  const box = new Box3()
  const n = 10
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) box.expandByPoint(s.at(i / n, j / n))
  const size = box.getSize(new Vector3())
  return box.expandByScalar(Math.max(size.x, size.y, size.z) * 0.06 + 1e-6)
}

export function solidBox(solid: Solid): Box3 {
  const box = new Box3()
  for (const p of solid.prim.patches) box.union(patchBox(solid, p))
  return box
}

function implicitOf(solid: Solid, patch: Patch): Field {
  const tmp = new Vector3()
  return (_local, world) => patch.implicit(tmp.copy(world).applyMatrix4(solid.inverse))
}

function trimOf(solid: Solid, patch: Patch): (world: Vector3) => number {
  const tmp = new Vector3()
  return (world) => patch.trim(tmp.copy(world).applyMatrix4(solid.inverse))
}

export function computeIntersections(solids: Solid[], res: number): Intersections {
  const visible = solids.filter((s) => s.spec.visible)
  const boxes = visible.map((s) => s.prim.patches.map((p) => patchBox(s, p)))
  const whole = boxes.map((bs) => bs.reduce((acc, b) => acc.union(b), new Box3()))

  const intersections: Polyline[] = []
  const construction: Polyline[] = []
  const fills: number[] = []

  // contour of (surface of patch q on solid b) over patch p of solid a
  const cache = new Map<string, Curve[]>()
  const cut = (a: number, p: number, b: number, q: number) => {
    const key = `${a}.${p}.${b}.${q}`
    let c = cache.get(key)
    if (!c) {
      const A = visible[a]
      const pa = A.prim.patches[p]
      const [nu, nv] = gridFor(pa, res)
      c = contour(pa, A.matrix, implicitOf(visible[b], visible[b].prim.patches[q]), nu, nv)
      cache.set(key, c)
    }
    return c
  }

  for (let a = 0; a < visible.length; a++) {
    for (let b = a + 1; b < visible.length; b++) {
      if (!whole[a].intersectsBox(whole[b])) continue
      const A = visible[a]
      const B = visible[b]
      const cutsA = new Set<number>() // patches of B whose surface really cuts A
      const cutsB = new Set<number>() // patches of A whose surface really cuts B
      for (let p = 0; p < A.prim.patches.length; p++) {
        for (let q = 0; q < B.prim.patches.length; q++) {
          if (!boxes[a][p].intersectsBox(boxes[b][q])) continue
          const pb = B.prim.patches[q]
          const { inside } = clip(cut(a, p, b, q), A.prim.patches[p], A.matrix, trimOf(B, pb))
          if (!inside.length) continue
          intersections.push(...toLines(inside))
          cutsA.add(q)
          cutsB.add(p)
        }
      }
      sections(a, b, cutsA)
      sections(b, a, cutsB)
    }
  }

  /** The full sections of solid `a` by the surfaces of the patches `qs` of solid `b`. */
  function sections(a: number, b: number, qs: Set<number>) {
    const A = visible[a]
    const B = visible[b]
    for (const q of qs) {
      const pb = B.prim.patches[q]
      const trim = trimOf(B, pb)
      const whole: Polyline[] = []
      for (let p = 0; p < A.prim.patches.length; p++) {
        const curves = cut(a, p, b, q)
        if (!curves.length) continue
        whole.push(...toLines(curves))
        construction.push(...toLines(clip(curves, A.prim.patches[p], A.matrix, trim).outside))
      }
      if (pb.planar && pb.normal) {
        const n = pb.normal.clone().applyMatrix3(B.normalMatrix).normalize()
        fillPlanar(whole, n, fills)
      }
    }
  }

  return { intersections, construction, fills: new Float32Array(fills) }
}

/** Triangulates closed loops lying in a plane with normal `n` (holes allowed). */
function fillPlanar(lines: Polyline[], n: Vector3, out: number[]) {
  const loops = joinByEnds(lines, 1e-3).filter((l) => l.length > 3 && l[0].distanceTo(l[l.length - 1]) < 1e-3)
  if (!loops.length) return
  const e1 = Math.abs(n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)
  e1.addScaledVector(n, -e1.dot(n)).normalize()
  const e2 = new Vector3().crossVectors(n, e1)
  const sorted = loops
    .map((l) => {
      const pts3 = l.slice(0, -1)
      const pts2 = pts3.map((p) => new Vector2(p.dot(e1), p.dot(e2)))
      return { pts3, pts2, area: Math.abs(ShapeUtils.area(pts2)) }
    })
    .sort((x, y) => y.area - x.area)
  const depth = sorted.map((f, i) => sorted.slice(0, i).filter((g) => pointInPolygon(f.pts2[0], g.pts2)).length)
  sorted.forEach((outer, i) => {
    if (depth[i] % 2) return
    const holes = sorted.filter((h, k) => k > i && depth[k] === depth[i] + 1 && pointInPolygon(h.pts2[0], outer.pts2))
    const all3 = outer.pts3.concat(...holes.map((h) => h.pts3))
    const tris = ShapeUtils.triangulateShape(
      outer.pts2,
      holes.map((h) => h.pts2),
    )
    for (const t of tris) for (const k of t) out.push(all3[k].x, all3[k].y, all3[k].z)
  })
}

function pointInPolygon(p: Vector2, poly: Vector2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// ---------------------------------------------------------------- view and light curves

function gradient(patch: Patch, p: Vector3, out: Vector3): Vector3 {
  const h = 1e-4
  const q = p.clone()
  const d = (axis: 'x' | 'y' | 'z') => {
    q.copy(p)
    q[axis] += h
    const f1 = patch.implicit(q)
    q[axis] -= 2 * h
    return (f1 - patch.implicit(q)) / (2 * h)
  }
  return out.set(d('x'), d('y'), d('z'))
}

/**
 * Curves on the curved patches where the normal is at right angles to a
 * direction: the outline seen from the eye (silhouette), or the edge between
 * lit and shaded sides (terminator, the core shadow line).
 *
 * `point` (an eye or a lamp position) or `dir` (towards a camera or the sun).
 */
export function normalCurves(solids: Solid[], target: { point?: Vector3; dir?: Vector3 }, res: number): Polyline[] {
  const out: Polyline[] = []
  const n = new Vector3()
  const to = new Vector3()
  for (const s of solids) {
    if (!s.spec.visible) continue
    for (const patch of s.prim.patches) {
      if (patch.planar) continue
      const field: Field = (local, world) => {
        gradient(patch, local, n).applyMatrix3(s.normalMatrix)
        if (target.point) to.subVectors(target.point, world)
        else to.copy(target.dir!)
        return n.dot(to)
      }
      const [nu, nv] = gridFor(patch, res)
      out.push(...toLines(contour(patch, s.matrix, field, nu, nv)))
    }
  }
  return out
}

/** Sharp edges and draw-through guides, in world space. */
export function structureLines(solids: Solid[]): { edges: Polyline[]; guides: Polyline[] } {
  const edges: Polyline[] = []
  const guides: Polyline[] = []
  for (const s of solids) {
    if (!s.spec.visible) continue
    for (const e of s.prim.edges) edges.push(e.map((p) => p.clone().applyMatrix4(s.matrix)))
    for (const g of s.prim.guides) guides.push(g.map((p) => p.clone().applyMatrix4(s.matrix)))
  }
  return { edges, guides }
}
