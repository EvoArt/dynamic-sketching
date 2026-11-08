// Contouring a scalar field over a patch's (u, v) square: marching squares,
// with each crossing refined against the real field, then joined into curves.

import { Matrix4, Vector3 } from 'three'
import type { Patch } from './shapes'

/** A point on a patch: its parameters and its world position. */
export interface CPoint {
  u: number
  v: number
  p: Vector3
}
export type Curve = CPoint[]

/** A field over the patch, given the point in the patch's unit space and in the world. */
export type Field = (local: Vector3, world: Vector3) => number

/** Evaluates a patch in world space. */
export class Sampler {
  readonly local = new Vector3()
  readonly world = new Vector3()
  constructor(
    readonly patch: Patch,
    readonly matrix: Matrix4,
  ) {}
  at(u: number, v: number): Vector3 {
    this.patch.eval(u, v, this.local)
    return this.world.copy(this.local).applyMatrix4(this.matrix)
  }
}

export function contour(patch: Patch, matrix: Matrix4, field: Field, nu: number, nv: number): Curve[] {
  const s = new Sampler(patch, matrix)
  const F = (u: number, v: number) => {
    s.at(u, v)
    return field(s.local, s.world)
  }
  const W = nu + 1
  const vals = new Float64Array(W * (nv + 1))
  let anyPos = false
  let anyNeg = false
  let maxAbs = 0
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      let f: number
      if (patch.wrapU && i === nu) f = vals[j * W]
      else if (patch.wrapV && j === nv) f = vals[i]
      else f = F(i / nu, j / nv)
      vals[j * W + i] = f
      if (f > 0) anyPos = true
      else anyNeg = true
      maxAbs = Math.max(maxAbs, Math.abs(f))
    }
  }
  // No crossing, or a surface lying in the patch (coplanar faces).
  if (!anyPos || !anyNeg || maxAbs < 1e-7) return []

  const val = (i: number, j: number) => vals[j * W + i]
  const hId = (i: number, j: number) => 2 * ((patch.wrapV && j === nv ? 0 : j) * W + i)
  const vId = (i: number, j: number) => 2 * (j * W + (patch.wrapU && i === nu ? 0 : i)) + 1

  const points = new Map<number, CPoint>()
  const crossing = (id: number, i0: number, j0: number, i1: number, j1: number) => {
    let pt = points.get(id)
    if (pt) return id
    const u0 = i0 / nu
    const v0 = j0 / nv
    const du = (i1 - i0) / nu
    const dv = (j1 - j0) / nv
    // Illinois false position between the two grid points.
    let a = 0
    let b = 1
    let fa = val(i0, j0)
    let fb = val(i1, j1)
    let side = 0
    let t = fa / (fa - fb)
    for (let k = 0; k < 6; k++) {
      t = (a * fb - b * fa) / (fb - fa)
      const ft = F(u0 + t * du, v0 + t * dv)
      if (Math.abs(ft) < 1e-12) break
      if (ft > 0 === fa > 0) {
        a = t
        fa = ft
        if (side === -1) fb /= 2
        side = -1
      } else {
        b = t
        fb = ft
        if (side === 1) fa /= 2
        side = 1
      }
    }
    const u = u0 + t * du
    const v = v0 + t * dv
    pt = { u, v, p: s.at(u, v).clone() }
    points.set(id, pt)
    return id
  }

  const segs: number[] = []
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = val(i, j)
      const b = val(i + 1, j)
      const c = val(i + 1, j + 1)
      const d = val(i, j + 1)
      const idx = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0)
      if (idx === 0 || idx === 15) continue
      const e0 = a > 0 !== b > 0 ? crossing(hId(i, j), i, j, i + 1, j) : -1
      const e1 = b > 0 !== c > 0 ? crossing(vId(i + 1, j), i + 1, j, i + 1, j + 1) : -1
      const e2 = d > 0 !== c > 0 ? crossing(hId(i, j + 1), i, j + 1, i + 1, j + 1) : -1
      const e3 = a > 0 !== d > 0 ? crossing(vId(i, j), i, j, i, j + 1) : -1
      if (idx === 5 || idx === 10) {
        const centre = (a + b + c + d) / 4 > 0
        if ((idx === 5) === centre) segs.push(e0, e1, e2, e3)
        else segs.push(e0, e3, e1, e2)
      } else {
        const es = [e0, e1, e2, e3].filter((e) => e >= 0)
        segs.push(es[0], es[1])
      }
    }
  }

  // Join segments that share a crossing.
  const n = segs.length / 2
  const adj = new Map<number, number[]>()
  for (let k = 0; k < n; k++) {
    for (const id of [segs[2 * k], segs[2 * k + 1]]) {
      const list = adj.get(id)
      if (list) list.push(k)
      else adj.set(id, [k])
    }
  }
  const used = new Uint8Array(n)
  const nextFrom = (id: number) => {
    for (const k of adj.get(id) ?? []) {
      if (!used[k]) {
        used[k] = 1
        return segs[2 * k] === id ? segs[2 * k + 1] : segs[2 * k]
      }
    }
    return -1
  }
  const curves: Curve[] = []
  for (let k = 0; k < n; k++) {
    if (used[k]) continue
    used[k] = 1
    const chain = [segs[2 * k], segs[2 * k + 1]]
    for (let id = nextFrom(chain[1]); id >= 0; id = nextFrom(id)) chain.push(id)
    for (let id = nextFrom(chain[0]); id >= 0; id = nextFrom(id)) chain.unshift(id)
    curves.push(chain.map((id) => points.get(id)!))
  }
  return curves
}

/**
 * Splits curves on a patch into the parts where `trim(world) <= 0` (inside) and
 * the rest (outside). Crossing points are found by bisection on the patch.
 */
export function clip(
  curves: Curve[],
  patch: Patch,
  matrix: Matrix4,
  trim: (world: Vector3) => number,
): { inside: Curve[]; outside: Curve[] } {
  const inside: Curve[] = []
  const outside: Curve[] = []
  const s = new Sampler(patch, matrix)
  const tol = 1e-9
  for (const curve of curves) {
    if (curve.length < 2) continue
    const ins = curve.map((pt) => trim(pt.p) <= tol)
    if (ins.every((x) => x)) {
      inside.push(curve)
      continue
    }
    if (ins.every((x) => !x)) {
      outside.push(curve)
      continue
    }
    const runs: { inside: boolean; pts: Curve }[] = []
    let run: Curve = [curve[0]]
    for (let k = 1; k < curve.length; k++) {
      if (ins[k] === ins[k - 1]) {
        run.push(curve[k])
        continue
      }
      const a = curve[k - 1]
      const b = curve[k]
      let du = b.u - a.u
      let dv = b.v - a.v
      if (patch.wrapU && Math.abs(du) > 0.5) du -= Math.sign(du)
      if (patch.wrapV && Math.abs(dv) > 0.5) dv -= Math.sign(dv)
      let lo = 0
      let hi = 1
      for (let it = 0; it < 18; it++) {
        const mid = (lo + hi) / 2
        const inMid = trim(s.at(wrap(a.u + mid * du, patch.wrapU), wrap(a.v + mid * dv, patch.wrapV))) <= tol
        if (inMid === ins[k - 1]) lo = mid
        else hi = mid
      }
      const t = (lo + hi) / 2
      const u = wrap(a.u + t * du, patch.wrapU)
      const v = wrap(a.v + t * dv, patch.wrapV)
      const cross: CPoint = { u, v, p: s.at(u, v).clone() }
      run.push(cross)
      runs.push({ inside: ins[k - 1], pts: run })
      run = [cross, b]
    }
    runs.push({ inside: ins[curve.length - 1], pts: run })
    // A closed curve: join the last run onto the first.
    const closed = curve[0].p.distanceToSquared(curve[curve.length - 1].p) < 1e-12
    if (closed && runs.length > 1 && runs[0].inside === runs[runs.length - 1].inside) {
      const last = runs.pop()!
      runs[0].pts = last.pts.concat(runs[0].pts.slice(1))
    }
    for (const r of runs) if (r.pts.length >= 2) (r.inside ? inside : outside).push(r.pts)
  }
  return { inside, outside }
}

function wrap(x: number, on: boolean): number {
  if (!on) return Math.min(1, Math.max(0, x))
  return x - Math.floor(x)
}

/** Joins polylines whose ends meet (within `tol`) into longer chains. */
export function joinByEnds(lines: Vector3[][], tol: number): Vector3[][] {
  const pool = lines.filter((l) => l.length >= 2).map((l) => l.slice())
  const out: Vector3[][] = []
  const t2 = tol * tol
  while (pool.length) {
    let chain = pool.pop()!
    let grew = true
    while (grew) {
      grew = false
      if (chain[0].distanceToSquared(chain[chain.length - 1]) < t2 && chain.length > 2) break
      for (let k = 0; k < pool.length; k++) {
        const l = pool[k]
        const head = chain[0]
        const tail = chain[chain.length - 1]
        if (tail.distanceToSquared(l[0]) < t2) chain = chain.concat(l.slice(1))
        else if (tail.distanceToSquared(l[l.length - 1]) < t2) chain = chain.concat(l.slice(0, -1).reverse())
        else if (head.distanceToSquared(l[l.length - 1]) < t2) chain = l.concat(chain.slice(1))
        else if (head.distanceToSquared(l[0]) < t2) chain = l.slice(1).reverse().concat(chain)
        else continue
        pool.splice(k, 1)
        grew = true
        break
      }
    }
    out.push(chain)
  }
  return out
}
