// The document: the shapes, plus view, line and light settings. Plain data, so
// it can be saved, undone and shared as JSON.

import { Box3, Vector3 } from 'three'
import { type ShapeKind, type ShapeSpec, matrixOf, normaliseSize, solidOf } from './shapes'

export type Shading = 'smooth' | 'bands' | 'flat' | 'none'

export interface LineSettings {
  outline: boolean
  hidden: boolean
  intersections: boolean
  construction: boolean
  sections: boolean
  guides: boolean
  terminator: boolean
  weight: number
}

export interface LightSettings {
  on: boolean
  kind: 'sun' | 'lamp'
  azimuth: number
  elevation: number
  distance: number
  intensity: number
  ambient: number
  shadows: boolean
}

export interface ViewSettings {
  perspective: boolean
  fov: number
  horizon: boolean
  vanishing: boolean
  vanishingLines: boolean
  ground: boolean
  shading: Shading
  bands: number
}

export interface Settings {
  view: ViewSettings
  lines: LineSettings
  light: LightSettings
}

export interface Doc {
  version: 1
  shapes: ShapeSpec[]
  settings: Settings
}

export const PALETTE = ['#e9e4da', '#c9d6e4', '#e8cfc4', '#d3dfc8', '#e5d7a9', '#d8cbe3', '#f0f0f0']

export function defaultSettings(): Settings {
  return {
    view: {
      perspective: true,
      fov: 50,
      horizon: true,
      vanishing: false,
      vanishingLines: false,
      ground: true,
      shading: 'smooth',
      bands: 3,
    },
    lines: {
      outline: true,
      hidden: true,
      intersections: true,
      construction: false,
      sections: false,
      guides: false,
      terminator: false,
      weight: 1,
    },
    light: {
      on: true,
      kind: 'sun',
      azimuth: 40,
      elevation: 50,
      distance: 4,
      intensity: 2.2,
      ambient: 0.6,
      shadows: true,
    },
  }
}

let counter = 0
export const newId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`

export function makeShape(kind: ShapeKind, overrides: Partial<ShapeSpec> = {}): ShapeSpec {
  const base: Record<ShapeKind, [number, number, number]> = {
    box: [1.2, 1.2, 1.2],
    sphere: [1.4, 1.4, 1.4],
    cylinder: [0.9, 1.6, 0.9],
    cone: [1.2, 1.6, 1.2],
    pyramid: [1.3, 1.3, 1.3],
    prism: [1.3, 1.1, 1.6],
    torus: [1.6, 1.6, 1.6],
  }
  const size = normaliseSize(kind, overrides.size ?? base[kind])
  return {
    id: newId(),
    kind,
    size,
    position: [0, size[1] / 2, 0],
    rotation: [0, 0, 0],
    color: PALETTE[counter % PALETTE.length],
    opacity: 1,
    visible: true,
    ...(kind === 'torus' ? { tube: 0.15 } : {}),
    ...overrides,
  }
}

/** Lifts the shapes together so the lowest one rests on the ground. */
export function restOnGround(shapes: ShapeSpec[]): ShapeSpec[] {
  const box = new Box3()
  for (const s of shapes) box.union(boundsOf(s))
  if (box.isEmpty()) return shapes
  const dy = -box.min.y
  return shapes.map((s) => ({ ...s, position: [s.position[0], s.position[1] + dy, s.position[2]] }))
}

/** World bounds from a fine sampling of every patch (exact for flat faces). */
export function boundsOf(s: ShapeSpec): Box3 {
  const solid = solidOf(s)
  const box = new Box3()
  const p = new Vector3()
  const n = 32
  for (const patch of solid.prim.patches) {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) box.expandByPoint(patch.eval(i / n, j / n, p).applyMatrix4(solid.matrix))
    }
  }
  return box
}

// ---------------------------------------------------------------- presets

/**
 * Where to put a box so that its corner nearest the sphere pokes `depth` into
 * it, with the box off in direction `dir` from the sphere's centre.
 */
function cornerInto(sphere: ShapeSpec, box: ShapeSpec, dir: Vector3, depth: number): [number, number, number] {
  const d = dir.clone().normalize()
  const m = matrixOf({ ...box, position: [0, 0, 0] })
  let best = new Vector3()
  let bestDot = Infinity
  for (let i = 0; i < 8; i++) {
    const c = new Vector3(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5).applyMatrix4(m)
    if (c.dot(d) < bestDot) {
      bestDot = c.dot(d)
      best = c
    }
  }
  const tip = new Vector3(...sphere.position).addScaledVector(d, sphere.size[0] / 2 - depth)
  const p = tip.sub(best)
  return [p.x, p.y, p.z]
}

export interface Preset {
  name: string
  shapes: () => ShapeSpec[]
  settings?: (s: Settings) => void
}

export const PRESETS: Preset[] = [
  {
    name: 'Cube corner into a sphere',
    shapes: () => {
      const sphere = makeShape('sphere', { size: [1.8, 1.8, 1.8], position: [0, 0, 0], color: '#c9d6e4' })
      const cube = makeShape('box', { size: [1.2, 1.2, 1.2], rotation: [30, 40, 15], color: '#e9e4da' })
      cube.position = cornerInto(sphere, cube, new Vector3(0.9, 0.5, -0.4), 0.42)
      return restOnGround([sphere, cube])
    },
    settings: (s) => {
      s.lines.construction = true
    },
  },
  {
    name: 'Cylinder through a box',
    shapes: () =>
      restOnGround([
        makeShape('box', { size: [1.6, 1.2, 1.6], position: [0, 0, 0], color: '#e9e4da' }),
        makeShape('cylinder', { size: [0.8, 2.6, 0.8], position: [0.1, 0.1, 0], rotation: [0, 0, 70], color: '#e8cfc4' }),
      ]),
  },
  {
    name: 'Two crossing cylinders',
    shapes: () =>
      restOnGround([
        makeShape('cylinder', { size: [1, 2.6, 1], position: [0, 0, 0], rotation: [90, 0, 0], color: '#c9d6e4' }),
        makeShape('cylinder', { size: [1, 2.6, 1], position: [0, 0, 0], rotation: [0, 0, 90], color: '#e5d7a9' }),
      ]),
  },
  {
    name: 'Cone through a slab',
    shapes: () =>
      restOnGround([
        makeShape('cone', { size: [1.4, 2, 1.4], position: [0, 0, 0], color: '#e8cfc4' }),
        makeShape('box', { size: [2.2, 0.35, 1.8], position: [0, -0.1, 0], rotation: [0, 0, 18], color: '#e9e4da', opacity: 0.6 }),
      ]),
    settings: (s) => {
      s.lines.construction = true
      s.lines.sections = true
    },
  },
  {
    name: 'Sphere on a wedge',
    shapes: () =>
      restOnGround([
        makeShape('prism', { size: [2, 1.2, 1.8], position: [0, 0, 0], rotation: [0, 25, 0], color: '#d3dfc8' }),
        makeShape('sphere', { size: [1, 1, 1], position: [0.25, 0.55, 0.1], color: '#c9d6e4' }),
      ]),
  },
  {
    name: 'Ring on a pyramid',
    shapes: () =>
      restOnGround([
        makeShape('pyramid', { size: [1.6, 1.6, 1.6], position: [0, 0, 0], rotation: [0, 20, 0], color: '#e5d7a9' }),
        makeShape('torus', { size: [1.3, 1.3, 1.3], position: [0, 0.15, 0], rotation: [15, 0, 0], tube: 0.12, color: '#d8cbe3' }),
      ]),
  },
]

// ---------------------------------------------------------------- random practice scenes

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface RandomOptions {
  count: number
  kinds: ShapeKind[]
  tilt: boolean
}

/**
 * Shapes that overlap: each new one is placed so its centre sits inside the
 * reach of an earlier one, near enough that their surfaces must cross.
 */
export function randomScene(seed: number, opts: RandomOptions): ShapeSpec[] {
  const r = rng(seed)
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const range = (a: number, b: number) => a + (b - a) * r()
  const kinds = opts.kinds.length ? opts.kinds : (['box', 'sphere', 'cylinder', 'cone'] as ShapeKind[])
  // Different kinds where possible: shuffle, then deal in order.
  const deck = kinds.slice()
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  const shapes: ShapeSpec[] = []
  for (let i = 0; i < opts.count; i++) {
    const kind = deck[i % deck.length]
    const big = range(0.9, 1.7)
    let size: [number, number, number]
    switch (kind) {
      case 'sphere':
      case 'torus':
        size = [big * 1.1, big * 1.1, big * 1.1]
        break
      case 'cylinder':
      case 'cone':
        size = [range(0.6, 1.3), range(1.2, 2.4), 0]
        break
      default:
        size = [big * range(0.7, 1.3), big * range(0.6, 1.3), big * range(0.7, 1.3)]
    }
    size = normaliseSize(kind, size)
    const tilt = opts.tilt || kind === 'cylinder' ? 1 : 0.25
    const rotation: [number, number, number] = [range(-50, 50) * tilt, range(0, 360), range(-50, 50) * tilt]
    let position: [number, number, number] = [0, 0, 0]
    if (shapes.length) {
      const other = pick(shapes)
      const reach = (Math.min(...other.size) + Math.min(...size)) / 2
      const dir = new Vector3(range(-1, 1), range(-0.6, 0.8), range(-1, 1)).normalize()
      const d = reach * range(0.35, 0.7)
      position = [other.position[0] + dir.x * d, other.position[1] + dir.y * d, other.position[2] + dir.z * d]
    }
    shapes.push(
      makeShape(kind, {
        size,
        position,
        rotation,
        color: PALETTE[i % PALETTE.length],
        ...(kind === 'torus' ? { tube: range(0.1, 0.2) } : {}),
      }),
    )
  }
  // Centre on the origin, then sit on the ground.
  const c = shapes.reduce((acc, s) => acc.add(new Vector3(...s.position)), new Vector3()).divideScalar(shapes.length)
  return restOnGround(shapes.map((s) => ({ ...s, position: [s.position[0] - c.x, s.position[1], s.position[2] - c.z] })))
}

export function sanitiseDoc(raw: unknown): Doc | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Partial<Doc>
  if (!Array.isArray(d.shapes)) return null
  const def = defaultSettings()
  const s = (d.settings ?? {}) as Partial<Settings>
  return {
    version: 1,
    shapes: d.shapes.filter((x) => x && typeof x.kind === 'string').map((x) => ({ ...x, size: normaliseSize(x.kind, x.size) })),
    settings: {
      view: { ...def.view, ...s.view },
      lines: { ...def.lines, ...s.lines },
      light: { ...def.light, ...s.light },
    },
  }
}
