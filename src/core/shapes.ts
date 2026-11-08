// Shape definitions. Every shape is a unit primitive (fits in a 1x1x1 cube
// centred on the origin) placed in the world by a matrix that also scales it to
// its size. Non-uniform scaling keeps the zero set of an implicit function, so
// every test below can be done in the unit space of the primitive.
//
// A primitive is made of patches. A patch is a piece of smooth surface that has
//  - a parametrisation (u, v) in [0,1]^2 -> point, used to march over it,
//  - an implicit function that is zero on the whole untrimmed surface the patch
//    lies on (the infinite plane, the infinite cylinder, ...),
//  - a trim function that is <= 0 on the part of that surface the patch covers.
// Intersections, full conic sections, silhouettes and shadow lines are all
// found by contouring a function over a patch's (u, v) square.

import { Euler, MathUtils, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'

export type ShapeKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'pyramid' | 'prism' | 'torus'

export const SHAPE_KINDS: ShapeKind[] = ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'prism', 'torus']

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  box: 'Box',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  pyramid: 'Pyramid',
  prism: 'Wedge',
  torus: 'Torus',
}

export interface ShapeSpec {
  id: string
  kind: ShapeKind
  /** World extents along the shape's own x, y, z axes. */
  size: [number, number, number]
  position: [number, number, number]
  /** Degrees, applied in XYZ order. */
  rotation: [number, number, number]
  color: string
  opacity: number
  visible: boolean
  /** Torus only: tube radius as a fraction of the outer diameter (0.05 to 0.25). */
  tube?: number
}

export interface Patch {
  /** Index within its primitive. */
  index: number
  eval(u: number, v: number, out: Vector3): Vector3
  implicit(p: Vector3): number
  trim(p: Vector3): number
  planar: boolean
  wrapU: boolean
  wrapV: boolean
  /** Grid cells along u and v, as multiples of the base resolution. */
  cells: [number, number]
  /** Planar patches only: unit-space outward normal. */
  normal?: Vector3
}

export interface Primitive {
  patches: Patch[]
  /** Sharp edges (box edges, cylinder rims) as unit-space polylines. */
  edges: Vector3[][]
  /** Draw-through guides: axes and cross-section rings, unit-space polylines. */
  guides: Vector3[][]
  /** Straight edges grouped by direction, for vanishing points (polyhedra only). */
  edgeGroups: { dir: Vector3; edges: [Vector3, Vector3][] }[]
}

const TAU = Math.PI * 2
const radial = (p: Vector3) => Math.hypot(p.x, p.z)

// ---------------------------------------------------------------- polylines

function circle(radius: number, y: number, n = 128, axis: 'y' | 'x' | 'z' = 'y', centre = new Vector3()): Vector3[] {
  const pts: Vector3[] = []
  for (let i = 0; i <= n; i++) {
    const t = (TAU * i) / n
    const a = radius * Math.cos(t)
    const b = radius * Math.sin(t)
    if (axis === 'y') pts.push(new Vector3(a, y, b).add(centre))
    else if (axis === 'x') pts.push(new Vector3(y, a, b).add(centre))
    else pts.push(new Vector3(a, b, y).add(centre))
  }
  return pts
}

const seg = (a: [number, number, number], b: [number, number, number]) => [new Vector3(...a), new Vector3(...b)]

// ---------------------------------------------------------------- polyhedra

function polygonPatch(index: number, verts: Vector3[]): Patch {
  const n = new Vector3()
    .subVectors(verts[1], verts[0])
    .cross(new Vector3().subVectors(verts[2], verts[0]))
    .normalize()
  const d = n.dot(verts[0])
  // In-plane outward normals of each edge, for the trim function.
  const edgeNormals = verts.map((v, i) => {
    const e = new Vector3().subVectors(verts[(i + 1) % verts.length], v)
    return e.cross(n).normalize()
  })
  const tmp = new Vector3()
  const [a, b, c, dd] = verts
  return {
    index,
    planar: true,
    wrapU: false,
    wrapV: false,
    cells: [1, 1],
    normal: n,
    eval(u, v, out) {
      if (verts.length === 3) {
        // Collapsed bilinear patch: the v = 1 edge is the third vertex.
        return out
          .copy(a)
          .multiplyScalar(1 - u)
          .addScaledVector(b, u)
          .multiplyScalar(1 - v)
          .addScaledVector(c, v)
      }
      out.copy(a).multiplyScalar((1 - u) * (1 - v))
      out.addScaledVector(b, u * (1 - v))
      out.addScaledVector(c, u * v)
      out.addScaledVector(dd, (1 - u) * v)
      return out
    },
    implicit: (p) => n.dot(p) - d,
    trim(p) {
      let m = -Infinity
      for (let i = 0; i < verts.length; i++) m = Math.max(m, tmp.subVectors(p, verts[i]).dot(edgeNormals[i]))
      return m
    },
  }
}

function polyhedron(vertices: [number, number, number][], faces: number[][], guides: Vector3[][]): Primitive {
  const verts = vertices.map((v) => new Vector3(...v))
  const centre = verts.reduce((acc, v) => acc.add(v), new Vector3()).divideScalar(verts.length)
  const patches = faces.map((f, i) => {
    let loop = f.map((k) => verts[k])
    const fc = loop.reduce((acc, v) => acc.clone().add(v), new Vector3()).divideScalar(loop.length)
    const n = new Vector3().subVectors(loop[1], loop[0]).cross(new Vector3().subVectors(loop[2], loop[0]))
    if (n.dot(fc.sub(centre)) < 0) loop = loop.slice().reverse()
    return polygonPatch(i, loop)
  })
  // Unique edges.
  const seen = new Set<string>()
  const edgePairs: [Vector3, Vector3][] = []
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i]
      const b = f[(i + 1) % f.length]
      const key = a < b ? `${a},${b}` : `${b},${a}`
      if (seen.has(key)) continue
      seen.add(key)
      edgePairs.push([verts[a], verts[b]])
    }
  }
  // Group parallel edges (two or more) for vanishing points.
  const edgeGroups: Primitive['edgeGroups'] = []
  for (const [a, b] of edgePairs) {
    const dir = new Vector3().subVectors(b, a).normalize()
    const g = edgeGroups.find((g) => Math.abs(Math.abs(g.dir.dot(dir)) - 1) < 1e-6)
    if (g) g.edges.push([a, b])
    else edgeGroups.push({ dir, edges: [[a, b]] })
  }
  return {
    patches,
    edges: edgePairs.map(([a, b]) => [a.clone(), b.clone()]),
    guides,
    edgeGroups: edgeGroups.filter((g) => g.edges.length >= 2),
  }
}

function box(): Primitive {
  const v: [number, number, number][] = []
  for (let i = 0; i < 8; i++) v.push([i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5])
  const faces = [
    [0, 1, 3, 2],
    [4, 5, 7, 6],
    [0, 2, 6, 4],
    [1, 3, 7, 5],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
  ]
  const guides = [
    seg([-0.65, 0, 0], [0.65, 0, 0]),
    seg([0, -0.65, 0], [0, 0.65, 0]),
    seg([0, 0, -0.65], [0, 0, 0.65]),
    // Centre lines on every face: how to find the middle of a face in perspective.
    seg([-0.5, -0.5, -0.5], [0.5, 0.5, -0.5]),
    seg([0.5, -0.5, -0.5], [-0.5, 0.5, -0.5]),
    seg([-0.5, -0.5, 0.5], [0.5, 0.5, 0.5]),
    seg([0.5, -0.5, 0.5], [-0.5, 0.5, 0.5]),
    seg([-0.5, 0.5, -0.5], [0.5, 0.5, 0.5]),
    seg([0.5, 0.5, -0.5], [-0.5, 0.5, 0.5]),
  ]
  return polyhedron(v, faces, guides)
}

function pyramid(): Primitive {
  const v: [number, number, number][] = [
    [-0.5, -0.5, -0.5],
    [0.5, -0.5, -0.5],
    [0.5, -0.5, 0.5],
    [-0.5, -0.5, 0.5],
    [0, 0.5, 0],
  ]
  const faces = [
    [0, 1, 2, 3],
    [0, 1, 4],
    [1, 2, 4],
    [2, 3, 4],
    [3, 0, 4],
  ]
  const guides = [
    seg([0, -0.65, 0], [0, 0.6, 0]),
    seg([-0.5, -0.5, -0.5], [0.5, -0.5, 0.5]),
    seg([0.5, -0.5, -0.5], [-0.5, -0.5, 0.5]),
  ]
  return polyhedron(v, faces, guides)
}

function prism(): Primitive {
  const v: [number, number, number][] = [
    [-0.5, -0.5, -0.5],
    [0.5, -0.5, -0.5],
    [0, 0.5, -0.5],
    [-0.5, -0.5, 0.5],
    [0.5, -0.5, 0.5],
    [0, 0.5, 0.5],
  ]
  const faces = [
    [0, 1, 2],
    [3, 4, 5],
    [0, 1, 4, 3],
    [1, 2, 5, 4],
    [2, 0, 3, 5],
  ]
  const guides = [
    seg([0, -1 / 6, -0.65], [0, -1 / 6, 0.65]),
    [new Vector3(-0.5, -0.5, 0), new Vector3(0.5, -0.5, 0), new Vector3(0, 0.5, 0), new Vector3(-0.5, -0.5, 0)],
    seg([0, -0.5, -0.5], [0, -0.5, 0.5]),
  ]
  return polyhedron(v, faces, guides)
}

// ---------------------------------------------------------------- curved

function disc(index: number, y: number, up: boolean): Patch {
  const s = up ? 1 : -1
  return {
    index,
    planar: true,
    wrapU: true,
    wrapV: false,
    cells: [1.5, 0.5],
    normal: new Vector3(0, s, 0),
    eval: (u, v, out) => out.set(0.5 * v * Math.cos(TAU * u), y, 0.5 * v * Math.sin(TAU * u)),
    implicit: (p) => s * (p.y - y),
    trim: (p) => radial(p) - 0.5,
  }
}

function sphere(): Primitive {
  const patch: Patch = {
    index: 0,
    planar: false,
    wrapU: true,
    wrapV: false,
    cells: [2, 1],
    eval(u, v, out) {
      const t = TAU * u
      const f = Math.PI * (v - 0.5)
      return out.set(0.5 * Math.cos(f) * Math.cos(t), 0.5 * Math.sin(f), 0.5 * Math.cos(f) * Math.sin(t))
    },
    implicit: (p) => p.length() - 0.5,
    trim: () => -1,
  }
  return {
    patches: [patch],
    edges: [],
    guides: [circle(0.5, 0, 128, 'y'), circle(0.5, 0, 128, 'x'), circle(0.5, 0, 128, 'z'), seg([0, -0.65, 0], [0, 0.65, 0])],
    edgeGroups: [],
  }
}

function cylinder(): Primitive {
  const side: Patch = {
    index: 0,
    planar: false,
    wrapU: true,
    wrapV: false,
    cells: [2, 1],
    eval: (u, v, out) => out.set(0.5 * Math.cos(TAU * u), v - 0.5, 0.5 * Math.sin(TAU * u)),
    implicit: (p) => radial(p) - 0.5,
    trim: (p) => Math.abs(p.y) - 0.5,
  }
  return {
    patches: [side, disc(1, 0.5, true), disc(2, -0.5, false)],
    edges: [circle(0.5, 0.5), circle(0.5, -0.5)],
    guides: [seg([0, -0.65, 0], [0, 0.65, 0]), circle(0.5, 0), seg([-0.5, 0.5, 0], [0.5, 0.5, 0]), seg([0, 0.5, -0.5], [0, 0.5, 0.5])],
    edgeGroups: [],
  }
}

function cone(): Primitive {
  // Base radius 0.5 at y = -0.5, apex at y = 0.5.
  const side: Patch = {
    index: 0,
    planar: false,
    wrapU: true,
    wrapV: false,
    cells: [2, 1],
    eval(u, v, out) {
      const r = 0.5 * (1 - v)
      return out.set(r * Math.cos(TAU * u), v - 0.5, r * Math.sin(TAU * u))
    },
    // Divided by the slant factor so the gradient has unit length.
    implicit: (p) => (radial(p) - 0.5 * (0.5 - p.y)) / Math.sqrt(1.25),
    trim: (p) => -0.5 - p.y,
  }
  return {
    patches: [side, disc(1, -0.5, false)],
    edges: [circle(0.5, -0.5)],
    guides: [seg([0, -0.65, 0], [0, 0.6, 0]), circle(0.25, 0), seg([-0.5, -0.5, 0], [0.5, -0.5, 0]), seg([0, -0.5, -0.5], [0, -0.5, 0.5])],
    edgeGroups: [],
  }
}

function torus(tube: number): Primitive {
  const r = tube
  const R = 0.5 - r
  const patch: Patch = {
    index: 0,
    planar: false,
    wrapU: true,
    wrapV: true,
    cells: [2.5, 1],
    eval(u, v, out) {
      const t = TAU * u
      const f = TAU * v
      const q = R + r * Math.cos(f)
      return out.set(q * Math.cos(t), r * Math.sin(f), q * Math.sin(t))
    },
    implicit: (p) => Math.hypot(radial(p) - R, p.y) - r,
    trim: () => -1,
  }
  const guides: Vector3[][] = [circle(R, 0), seg([0, -0.4, 0], [0, 0.4, 0])]
  for (let k = 0; k < 4; k++) {
    const t = (TAU * k) / 4
    const pts: Vector3[] = []
    for (let i = 0; i <= 48; i++) {
      const f = (TAU * i) / 48
      pts.push(new Vector3((R + r * Math.cos(f)) * Math.cos(t), r * Math.sin(f), (R + r * Math.cos(f)) * Math.sin(t)))
    }
    guides.push(pts)
  }
  return { patches: [patch], edges: [], guides, edgeGroups: [] }
}

const cache = new Map<string, Primitive>()

export function primitiveFor(spec: Pick<ShapeSpec, 'kind' | 'tube'>): Primitive {
  const key = spec.kind === 'torus' ? `torus:${tubeOf(spec)}` : spec.kind
  let p = cache.get(key)
  if (!p) {
    switch (spec.kind) {
      case 'box':
        p = box()
        break
      case 'sphere':
        p = sphere()
        break
      case 'cylinder':
        p = cylinder()
        break
      case 'cone':
        p = cone()
        break
      case 'pyramid':
        p = pyramid()
        break
      case 'prism':
        p = prism()
        break
      case 'torus':
        p = torus(tubeOf(spec))
        break
    }
    cache.set(key, p)
  }
  return p
}

export function tubeOf(spec: Pick<ShapeSpec, 'tube'>): number {
  return MathUtils.clamp(spec.tube ?? 0.15, 0.05, 0.25)
}

/** Keep sizes consistent with what the shape can be (round things stay round). */
export function normaliseSize(kind: ShapeKind, size: [number, number, number]): [number, number, number] {
  const [x, y, z] = size.map((s) => MathUtils.clamp(s, 0.05, 20)) as [number, number, number]
  switch (kind) {
    case 'sphere':
    case 'torus':
      return [x, x, x]
    case 'cylinder':
    case 'cone':
      return [x, y, x]
    default:
      return [x, y, z]
  }
}

/** Which size fields the interface offers, with their labels. */
export function sizeFields(kind: ShapeKind): { axis: 0 | 1 | 2; label: string }[] {
  switch (kind) {
    case 'sphere':
      return [{ axis: 0, label: 'Diameter' }]
    case 'torus':
      return [{ axis: 0, label: 'Diameter' }]
    case 'cylinder':
    case 'cone':
      return [
        { axis: 0, label: 'Diameter' },
        { axis: 1, label: 'Height' },
      ]
    default:
      return [
        { axis: 0, label: 'Width' },
        { axis: 1, label: 'Height' },
        { axis: 2, label: 'Depth' },
      ]
  }
}

// ---------------------------------------------------------------- placed solids

export interface Solid {
  spec: ShapeSpec
  prim: Primitive
  matrix: Matrix4
  inverse: Matrix4
  /** Takes unit-space normals (implicit gradients) to world space. */
  normalMatrix: Matrix3
}

export function matrixOf(spec: ShapeSpec): Matrix4 {
  const q = new Quaternion().setFromEuler(
    new Euler(...(spec.rotation.map((d) => MathUtils.degToRad(d)) as [number, number, number]), 'XYZ'),
  )
  return new Matrix4().compose(new Vector3(...spec.position), q, new Vector3(...spec.size))
}

export function solidOf(spec: ShapeSpec): Solid {
  const matrix = matrixOf(spec)
  return {
    spec,
    prim: primitiveFor(spec),
    matrix,
    inverse: matrix.clone().invert(),
    normalMatrix: new Matrix3().getNormalMatrix(matrix),
  }
}

/** Radius of a sphere about the shape's centre that contains it. */
export function boundingRadius(spec: ShapeSpec): number {
  const [x, y, z] = spec.size
  switch (spec.kind) {
    case 'sphere':
    case 'torus':
      return x / 2
    case 'cylinder':
    case 'cone':
      return Math.hypot(x / 2, y / 2)
    default:
      return Math.hypot(x, y, z) / 2
  }
}
