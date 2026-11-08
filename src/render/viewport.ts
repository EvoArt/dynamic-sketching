// The 3D view. Drawn in three passes each frame:
//  1. the solids, ground and shadows, as you would see them;
//  2. the solids again into the depth buffer only, so that every line can be
//     tested against the nearest surface even through see-through solids;
//  3. the lines, each layer twice: in front of the nearest surface (solid) and
//     behind it (dashed and faint, when hidden lines are on).

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  GreaterDepth,
  GridHelper,
  Group,
  HemisphereLight,
  LessEqualDepth,
  Line,
  LineDashedMaterial,
  type Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Raycaster,
  RedFormat,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import type { Polyline } from '../core/analysis'
import type { Settings } from '../core/scene'
import { type ShapeSpec, type Solid, boundingRadius, primitiveFor, tubeOf } from '../core/shapes'
import { drawOverlay } from './overlay'

export type LayerName = 'edges' | 'silhouettes' | 'guides' | 'intersections' | 'construction' | 'terminator'
export type GizmoMode = 'translate' | 'rotate' | 'scale'

interface LayerStyle {
  color: string
  width: number
  dashed?: [number, number]
  hiddenOpacity: number
  hiddenWidth: number
  hiddenDash: [number, number]
}

export const LAYER_STYLES: Record<LayerName, LayerStyle> = {
  edges: { color: '#1d1d1f', width: 2, hiddenOpacity: 0.4, hiddenWidth: 1.3, hiddenDash: [0.07, 0.05] },
  silhouettes: { color: '#1d1d1f', width: 2, hiddenOpacity: 0.4, hiddenWidth: 1.3, hiddenDash: [0.07, 0.05] },
  guides: { color: '#2f6db5', width: 1.2, hiddenOpacity: 0.35, hiddenWidth: 1, hiddenDash: [0.05, 0.05] },
  intersections: { color: '#d1203a', width: 3.2, hiddenOpacity: 0.6, hiddenWidth: 2.2, hiddenDash: [0.08, 0.05] },
  construction: { color: '#e08a00', width: 1.8, dashed: [0.12, 0.06], hiddenOpacity: 0.45, hiddenWidth: 1.3, hiddenDash: [0.05, 0.06] },
  terminator: { color: '#7b3fb5', width: 2.2, dashed: [0.04, 0.035], hiddenOpacity: 0.3, hiddenWidth: 1.4, hiddenDash: [0.03, 0.05] },
}

const PAPER = '#f3efe6'
const GROUND = '#e7e1d4'

interface Layer {
  vis: LineSegments2
  hid: LineSegments2
  empty: boolean
}

export interface ViewportEvents {
  select(id: string | null): void
  transform(id: string, t: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }): void
  transformEnd(id: string): void
  camera(): void
}

export class Viewport {
  readonly renderer: WebGLRenderer
  readonly overlay: HTMLCanvasElement
  private readonly solidScene = new Scene()
  private readonly lineScene = new Scene()
  private readonly persp = new PerspectiveCamera(50, 1, 0.05, 200)
  private readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0.05, 400)
  camera: PerspectiveCamera | OrthographicCamera = this.persp
  private readonly controls: OrbitControls
  private readonly gizmo: TransformControls
  private readonly meshes = new Map<string, Mesh>()
  private readonly meshGroup = new Group()
  private readonly layers = {} as Record<LayerName, Layer>
  private readonly depthMaterial = new MeshBasicMaterial({
    colorWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  })
  private readonly fillVis: Mesh
  private readonly fillHid: Mesh
  private readonly ground: Mesh
  private readonly grid: GridHelper
  private readonly hemi = new HemisphereLight('#ffffff', '#b9ad98', 0.6)
  private readonly sun = new DirectionalLight('#ffffff', 2)
  private readonly lamp = new PointLight('#ffffff', 2, 0, 0)
  private readonly lightMarker: Mesh
  private readonly lightRay: Line
  private settings: Settings | null = null
  private solids: Solid[] = []
  private selected: string | null = null
  private shapes: ShapeSpec[] = []
  private needsRender = true
  private size = new Vector2(1, 1)
  private gradient: DataTexture | null = null
  private markerWanted = false

  constructor(
    private readonly container: HTMLElement,
    private readonly events: ViewportEvents,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.autoClear = false
    this.renderer.setClearColor(PAPER)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.classList.add('gl')

    this.overlay = document.createElement('canvas')
    this.overlay.className = 'overlay'
    container.appendChild(this.overlay)

    // Cameras
    this.persp.position.set(4.2, 3, 5.2)
    this.controls = new OrbitControls(this.persp, this.renderer.domElement)
    this.controls.target.set(0, 0.7, 0)
    this.controls.enableDamping = false
    this.controls.maxDistance = 60
    this.controls.minDistance = 0.5
    this.controls.addEventListener('change', () => {
      this.invalidate()
      this.events.camera()
    })
    this.controls.update()

    // Solids scene
    this.solidScene.add(this.meshGroup)
    this.ground = new Mesh(new PlaneGeometry(80, 80), new MeshStandardMaterial({ color: GROUND, roughness: 1 }))
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.solidScene.add(this.ground)
    this.grid = new GridHelper(20, 20, '#c8bfae', '#d6cebf')
    this.grid.position.y = 0.001
    this.solidScene.add(this.grid)
    this.solidScene.add(this.hemi)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0003
    this.sun.shadow.normalBias = 0.006
    this.solidScene.add(this.sun, this.sun.target)
    this.lamp.castShadow = true
    this.lamp.shadow.mapSize.set(1024, 1024)
    this.lamp.shadow.bias = -0.002
    this.solidScene.add(this.lamp)

    // Line scene
    for (const name of Object.keys(LAYER_STYLES) as LayerName[]) this.layers[name] = this.makeLayer(LAYER_STYLES[name])
    const fillMat = (opacity: number, depthFunc: typeof LessEqualDepth | typeof GreaterDepth) =>
      new MeshBasicMaterial({ color: '#0f8b8d', transparent: true, opacity, side: DoubleSide, depthWrite: false, depthFunc })
    this.fillVis = new Mesh(new BufferGeometry(), fillMat(0.32, LessEqualDepth))
    this.fillHid = new Mesh(new BufferGeometry(), fillMat(0.09, GreaterDepth))
    this.fillHid.geometry = this.fillVis.geometry
    this.lineScene.add(this.fillHid, this.fillVis)

    this.lightMarker = new Mesh(new SphereGeometry(0.09, 20, 12), new MeshBasicMaterial({ color: '#f2b705' }))
    this.lightRay = new Line(new BufferGeometry(), new LineDashedMaterial({ color: '#d39b00', dashSize: 0.08, gapSize: 0.06 }))
    this.lineScene.add(this.lightMarker, this.lightRay)

    // Gizmo
    this.gizmo = new TransformControls(this.persp, this.renderer.domElement)
    this.gizmo.setSize(matchMedia('(pointer: coarse)').matches ? 1.25 : 0.9)
    this.lineScene.add(this.gizmo.getHelper())
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value
      if (!e.value && this.selected) this.events.transformEnd(this.selected)
    })
    this.gizmo.addEventListener('objectChange', () => {
      const m = this.gizmo.object
      if (!m || !this.selected) return
      this.events.transform(this.selected, {
        position: [m.position.x, m.position.y, m.position.z],
        rotation: [MathUtils.radToDeg(m.rotation.x), MathUtils.radToDeg(m.rotation.y), MathUtils.radToDeg(m.rotation.z)],
        scale: [m.scale.x, m.scale.y, m.scale.z],
      })
    })
    this.gizmo.addEventListener('change', () => this.invalidate())

    this.setupPicking()
    new ResizeObserver(() => this.resize()).observe(container)
    this.resize()
    const loop = () => {
      if (this.needsRender) {
        this.needsRender = false
        this.render()
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  invalidate() {
    this.needsRender = true
  }

  // ------------------------------------------------------------ lines

  private makeLayer(style: LayerStyle): Layer {
    const geom = new LineSegmentsGeometry()
    const vis = new LineSegments2(
      geom,
      new LineMaterial({
        color: new Color(style.color).getHex(),
        linewidth: style.width,
        dashed: !!style.dashed,
        dashSize: style.dashed?.[0] ?? 1,
        gapSize: style.dashed?.[1] ?? 0,
        depthFunc: LessEqualDepth,
      }),
    )
    const hid = new LineSegments2(
      geom,
      new LineMaterial({
        color: new Color(style.color).getHex(),
        linewidth: style.hiddenWidth,
        dashed: true,
        dashSize: style.hiddenDash[0],
        gapSize: style.hiddenDash[1],
        transparent: true,
        opacity: style.hiddenOpacity,
        depthFunc: GreaterDepth,
        depthWrite: false,
      }),
    )
    vis.renderOrder = 2
    hid.renderOrder = 1
    vis.frustumCulled = false
    hid.frustumCulled = false
    this.lineScene.add(hid, vis)
    return { vis, hid, empty: true }
  }

  setLayer(name: LayerName, lines: Polyline[]) {
    const layer = this.layers[name]
    let n = 0
    for (const l of lines) n += Math.max(0, l.length - 1)
    layer.vis.geometry.dispose()
    const geom = new LineSegmentsGeometry()
    if (n) {
      const arr = new Float32Array(n * 6)
      let k = 0
      for (const l of lines) {
        for (let i = 0; i + 1 < l.length; i++) {
          const a = l[i]
          const b = l[i + 1]
          arr[k++] = a.x
          arr[k++] = a.y
          arr[k++] = a.z
          arr[k++] = b.x
          arr[k++] = b.y
          arr[k++] = b.z
        }
      }
      geom.setPositions(arr)
    }
    layer.vis.geometry = geom
    layer.hid.geometry = geom
    if (n) layer.vis.computeLineDistances()
    layer.empty = n === 0
    this.applyLayerVisibility()
    this.invalidate()
  }

  setFills(tris: Float32Array) {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(tris, 3))
    this.fillVis.geometry.dispose()
    this.fillVis.geometry = g
    this.fillHid.geometry = g
    this.invalidate()
  }

  private applyLayerVisibility() {
    const s = this.settings
    if (!s) return
    const on: Record<LayerName, boolean> = {
      edges: s.lines.outline,
      silhouettes: s.lines.outline,
      guides: s.lines.guides,
      intersections: s.lines.intersections,
      construction: s.lines.construction,
      terminator: s.lines.terminator && s.light.on,
    }
    for (const name of Object.keys(this.layers) as LayerName[]) {
      const layer = this.layers[name]
      layer.vis.visible = on[name] && !layer.empty
      layer.hid.visible = on[name] && !layer.empty && s.lines.hidden
    }
    this.fillVis.visible = s.lines.sections
    this.fillHid.visible = s.lines.sections && s.lines.hidden
  }

  // ------------------------------------------------------------ shapes

  setShapes(shapes: ShapeSpec[], solids: Solid[]) {
    this.shapes = shapes
    this.solids = solids
    const keep = new Set(shapes.map((s) => s.id))
    for (const [id, mesh] of this.meshes) {
      if (keep.has(id)) continue
      if (this.gizmo.object === mesh) this.gizmo.detach()
      this.meshGroup.remove(mesh)
      ;(mesh.material as Material).dispose()
      this.meshes.delete(id)
    }
    for (const s of shapes) {
      let mesh = this.meshes.get(s.id)
      const geomKey = s.kind === 'torus' ? `torus:${tubeOf(s)}` : s.kind
      if (!mesh || mesh.userData.geomKey !== geomKey) {
        if (mesh) this.meshGroup.remove(mesh)
        mesh = new Mesh(geometryFor(s), new MeshStandardMaterial())
        mesh.userData = { id: s.id, geomKey, matKey: '' }
        this.meshes.set(s.id, mesh)
        this.meshGroup.add(mesh)
      }
      mesh.position.set(...s.position)
      mesh.rotation.set(...(s.rotation.map((d) => MathUtils.degToRad(d)) as [number, number, number]), 'XYZ')
      mesh.scale.set(...s.size)
      mesh.visible = s.visible
      this.styleMesh(mesh, s)
    }
    this.attachGizmo()
    this.fitShadow()
    this.invalidate()
  }

  private styleMesh(mesh: Mesh, s: ShapeSpec) {
    const st = this.settings
    if (!st) return
    const shading = st.view.shading
    const key = `${shading}|${st.view.bands}|${s.color}|${s.opacity}`
    const castShadow = st.light.on && st.light.shadows && shading !== 'none' && shading !== 'flat'
    mesh.castShadow = castShadow
    mesh.receiveShadow = shading !== 'flat'
    if (mesh.userData.matKey === key) return
    mesh.userData.matKey = key
    ;(mesh.material as Material).dispose()
    const transparent = s.opacity < 0.999
    const common = {
      color: s.color,
      transparent,
      opacity: s.opacity,
      depthWrite: !transparent,
      side: transparent ? DoubleSide : FrontSide,
    }
    let m: Material
    switch (shading) {
      case 'bands':
        m = new MeshToonMaterial({ ...common, gradientMap: this.gradientMap(st.view.bands) })
        break
      case 'flat':
        m = new MeshBasicMaterial({ ...common, color: new Color(s.color).lerp(new Color('#ffffff'), 0.35) })
        break
      case 'none':
        m = new MeshBasicMaterial({ colorWrite: false, depthWrite: false })
        break
      default:
        m = new MeshStandardMaterial({ ...common, roughness: 0.82, metalness: 0 })
    }
    mesh.material = m
  }

  private gradientMap(n: number): DataTexture {
    if (this.gradient && this.gradient.image.width === n) return this.gradient
    this.gradient?.dispose()
    const data = new Uint8Array(n)
    for (let i = 0; i < n; i++) data[i] = Math.round(40 + (215 * i) / Math.max(1, n - 1))
    const t = new DataTexture(data, n, 1, RedFormat)
    t.minFilter = NearestFilter
    t.magFilter = NearestFilter
    t.generateMipmaps = false
    t.needsUpdate = true
    this.gradient = t
    return t
  }

  select(id: string | null) {
    this.selected = id
    this.attachGizmo()
    this.invalidate()
  }

  setGizmoMode(mode: GizmoMode) {
    this.gizmo.setMode(mode)
    this.gizmo.setSpace(mode === 'translate' ? 'world' : 'local')
    this.invalidate()
  }

  private attachGizmo() {
    const mesh = this.selected ? this.meshes.get(this.selected) : undefined
    if (mesh && mesh.visible) {
      if (this.gizmo.object !== mesh) this.gizmo.attach(mesh)
    } else if (this.gizmo.object) this.gizmo.detach()
  }

  private setupPicking() {
    const el = this.renderer.domElement
    const ray = new Raycaster()
    let down: { x: number; y: number; t: number } | null = null
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() }
    })
    el.addEventListener('pointerup', (e) => {
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 6 || this.gizmo.dragging) return
      if (this.gizmo.axis) return
      const rect = el.getBoundingClientRect()
      const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      ray.setFromCamera(ndc, this.camera)
      const hits = ray.intersectObjects([...this.meshes.values()].filter((m) => m.visible), false)
      this.events.select(hits.length ? (hits[0].object.userData.id as string) : null)
    })
  }

  // ------------------------------------------------------------ settings

  applySettings(s: Settings) {
    const prev = this.settings
    this.settings = s
    const v = s.view
    if (!prev || prev.view.perspective !== v.perspective) this.switchCamera(v.perspective)
    this.persp.fov = v.fov
    this.persp.updateProjectionMatrix()
    this.updateOrthoFrustum()
    this.ground.visible = v.ground
    this.grid.visible = v.ground

    const L = s.light
    const dir = this.lightDir()
    const centre = this.controls.target
    this.hemi.intensity = L.on ? L.ambient : 1.5
    this.sun.visible = L.on && L.kind === 'sun'
    this.lamp.visible = L.on && L.kind === 'lamp'
    this.sun.intensity = L.intensity
    this.lamp.intensity = L.intensity * 1.2
    this.sun.castShadow = L.shadows
    this.lamp.castShadow = L.shadows
    this.sun.target.position.copy(centre)
    this.sun.position.copy(centre).addScaledVector(dir, 12)
    this.lamp.position.copy(this.lightPosition())
    this.lightMarker.visible = L.on && this.markerWanted
    this.lightRay.visible = L.on && this.markerWanted
    const markerPos = L.kind === 'lamp' ? this.lamp.position.clone() : centre.clone().addScaledVector(dir, 3)
    this.lightMarker.position.copy(markerPos)
    this.lightRay.geometry.setFromPoints([markerPos, centre.clone()])
    this.lightRay.computeLineDistances()

    for (const sh of this.shapes) {
      const mesh = this.meshes.get(sh.id)
      if (mesh) this.styleMesh(mesh, sh)
    }
    const scale = s.lines.weight
    for (const name of Object.keys(this.layers) as LayerName[]) {
      const st = LAYER_STYLES[name]
      ;(this.layers[name].vis.material as LineMaterial).linewidth = st.width * scale
      ;(this.layers[name].hid.material as LineMaterial).linewidth = st.hiddenWidth * scale
    }
    this.applyLayerVisibility()
    this.fitShadow()
    this.invalidate()
  }

  /** Shows where the light is (while its controls are open). */
  showLightMarker(on: boolean) {
    if (on === this.markerWanted) return
    this.markerWanted = on
    if (this.settings) this.applySettings(this.settings)
  }

  /** Unit vector from the scene towards the light. */
  lightDir(): Vector3 {
    const L = this.settings!.light
    const az = MathUtils.degToRad(L.azimuth)
    const el = MathUtils.degToRad(L.elevation)
    return new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
  }

  lightPosition(): Vector3 {
    return this.controls.target.clone().addScaledVector(this.lightDir(), this.settings!.light.distance)
  }

  private fitShadow() {
    // Fit the sun's shadow camera around the shapes.
    let r = 3
    const c = this.controls.target
    for (const s of this.shapes) r = Math.max(r, new Vector3(...s.position).distanceTo(c) + Math.max(...s.size))
    const cam = this.sun.shadow.camera
    cam.left = -r
    cam.right = r
    cam.top = r
    cam.bottom = -r
    cam.near = 0.5
    cam.far = 12 + r * 2
    cam.updateProjectionMatrix()
  }

  // ------------------------------------------------------------ camera

  private switchCamera(perspective: boolean) {
    const target = this.controls.target
    if (perspective && this.camera === this.ortho) {
      const dir = this.ortho.position.clone().sub(target).normalize()
      const d = this.orthoDistance / this.ortho.zoom
      this.persp.position.copy(target).addScaledVector(dir, d)
      this.persp.quaternion.copy(this.ortho.quaternion)
      this.camera = this.persp
    } else if (!perspective && this.camera === this.persp) {
      this.orthoDistance = this.persp.position.distanceTo(target)
      const dir = this.persp.position.clone().sub(target).normalize()
      this.ortho.position.copy(target).addScaledVector(dir, Math.max(30, this.orthoDistance))
      this.ortho.quaternion.copy(this.persp.quaternion)
      this.ortho.zoom = 1
      this.camera = this.ortho
    }
    this.controls.object = this.camera
    this.gizmo.camera = this.camera
    this.updateOrthoFrustum()
    this.controls.update()
    this.events.camera()
  }

  private orthoDistance = 6

  private updateOrthoFrustum() {
    const halfH = this.orthoDistance * Math.tan(MathUtils.degToRad(this.persp.fov / 2))
    const aspect = this.size.x / this.size.y
    this.ortho.left = -halfH * aspect
    this.ortho.right = halfH * aspect
    this.ortho.top = halfH
    this.ortho.bottom = -halfH
    this.ortho.updateProjectionMatrix()
  }

  /** Where the viewer is, for silhouettes: an eye point, or a direction for parallel views. */
  viewer(): { point?: Vector3; dir?: Vector3 } {
    this.camera.updateMatrixWorld()
    if (this.camera === this.persp) return { point: this.camera.position.clone() }
    return { dir: this.camera.getWorldDirection(new Vector3()).negate() }
  }

  setView(azimuthDeg: number, elevationDeg: number, distance?: number) {
    const t = this.controls.target
    const d = distance ?? this.camera.position.distanceTo(t)
    const az = MathUtils.degToRad(azimuthDeg)
    const el = MathUtils.degToRad(elevationDeg)
    const dir = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
    if (this.camera === this.ortho) {
      this.ortho.position.copy(t).addScaledVector(dir, Math.max(30, d))
      this.orthoDistance = d
      this.ortho.zoom = 1
      this.updateOrthoFrustum()
    } else this.persp.position.copy(t).addScaledVector(dir, d)
    this.controls.update()
  }

  /** Points the camera at the shapes and backs off far enough to see them all. */
  frame(shapes: ShapeSpec[]) {
    if (!shapes.length) return
    this.resize() // the layout may have changed since the last resize event
    const c = new Vector3()
    for (const s of shapes) c.add(new Vector3(...s.position))
    c.divideScalar(shapes.length)
    let r = 0.5
    for (const s of shapes) r = Math.max(r, new Vector3(...s.position).distanceTo(c) + boundingRadius(s))
    const offset = this.camera.position.clone().sub(this.controls.target)
    this.controls.target.copy(c)
    // Fit the narrower of the two fields of view (phones in portrait).
    const vfov = MathUtils.degToRad(this.persp.fov)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (this.size.x / this.size.y))
    const d = Math.max(2, (r / Math.sin(Math.min(vfov, hfov) / 2)) * 1.12)
    if (this.camera === this.ortho) {
      this.orthoDistance = d
      this.ortho.zoom = 1
      this.ortho.position.copy(c).addScaledVector(offset.normalize(), Math.max(30, d))
      this.updateOrthoFrustum()
    } else this.persp.position.copy(c).addScaledVector(offset.normalize(), d)
    this.controls.update()
    if (this.settings) this.applySettings(this.settings)
  }

  // ------------------------------------------------------------ drawing

  private resize() {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.size.set(w, h)
    this.renderer.setSize(w, h)
    const dpr = Math.min(window.devicePixelRatio, 2)
    this.overlay.width = Math.round(w * dpr)
    this.overlay.height = Math.round(h * dpr)
    this.overlay.style.width = `${w}px`
    this.overlay.style.height = `${h}px`
    this.persp.aspect = w / h
    this.persp.updateProjectionMatrix()
    this.updateOrthoFrustum()
    for (const layer of Object.values(this.layers)) {
      ;(layer.vis.material as LineMaterial).resolution.set(w, h)
      ;(layer.hid.material as LineMaterial).resolution.set(w, h)
    }
    this.invalidate()
    this.events.camera()
  }

  private render() {
    const r = this.renderer
    r.clear()
    r.render(this.solidScene, this.camera)
    // Depth of the nearest surface, through see-through solids too.
    r.clearDepth()
    const gridVis = this.grid.visible
    this.grid.visible = false
    r.shadowMap.autoUpdate = false
    this.solidScene.overrideMaterial = this.depthMaterial
    r.render(this.solidScene, this.camera)
    this.solidScene.overrideMaterial = null
    r.shadowMap.autoUpdate = true
    this.grid.visible = gridVis
    r.render(this.lineScene, this.camera)

    const ctx = this.overlay.getContext('2d')!
    const dpr = this.overlay.width / this.size.x
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    if (this.settings) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawOverlay(ctx, this.camera, this.solids, this.settings, this.size.x, this.size.y, this.selected)
    }
  }

  /**
   * The current picture, lines and overlay included, without the gizmo or light marker.
   * `maxSide` scales it down (for thumbnails).
   */
  capture(maxSide = Infinity): HTMLCanvasElement {
    const helper = this.gizmo.getHelper()
    const hidden = [helper, this.lightMarker, this.lightRay].filter((o) => o.visible)
    for (const o of hidden) o.visible = false
    this.render()
    const src = this.renderer.domElement
    const k = Math.min(1, maxSide / Math.max(src.width, src.height))
    const out = document.createElement('canvas')
    out.width = Math.round(src.width * k)
    out.height = Math.round(src.height * k)
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, 0, 0, out.width, out.height)
    ctx.drawImage(this.overlay, 0, 0, out.width, out.height)
    for (const o of hidden) o.visible = true
    this.invalidate()
    return out
  }

  /** Where the camera is looking from, independent of perspective or parallel projection. */
  cameraState(): CameraState {
    const t = this.controls.target
    const dir = this.camera.position.clone().sub(t).normalize()
    const distance = this.camera === this.ortho ? this.orthoDistance / this.ortho.zoom : this.persp.position.distanceTo(t)
    return { target: [t.x, t.y, t.z], dir: [dir.x, dir.y, dir.z], distance }
  }

  setCameraState(c: CameraState) {
    this.resize()
    const t = this.controls.target.set(...c.target)
    const dir = new Vector3(...c.dir).normalize()
    const d = MathUtils.clamp(c.distance, this.controls.minDistance, this.controls.maxDistance)
    if (this.camera === this.ortho) {
      this.orthoDistance = d
      this.ortho.zoom = 1
      this.ortho.position.copy(t).addScaledVector(dir, Math.max(30, d))
      this.updateOrthoFrustum()
    } else this.persp.position.copy(t).addScaledVector(dir, d)
    this.controls.update()
    if (this.settings) this.applySettings(this.settings)
  }
}

export interface CameraState {
  target: [number, number, number]
  /** Unit vector from the target towards the eye. */
  dir: [number, number, number]
  distance: number
}

export function isCameraState(c: unknown): c is CameraState {
  const v = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every((x) => Number.isFinite(x))
  const o = c as CameraState | null
  return !!o && v(o.target, 3) && v(o.dir, 3) && Number.isFinite(o.distance) && o.distance > 0 && Math.hypot(...o.dir) > 0.5
}

// ---------------------------------------------------------------- geometry

function geometryFor(s: ShapeSpec): BufferGeometry {
  switch (s.kind) {
    case 'sphere':
      return new SphereGeometry(0.5, 96, 48)
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1, 96, 1)
    case 'cone':
      return new ConeGeometry(0.5, 1, 96, 1)
    case 'torus': {
      const t = tubeOf(s)
      return new TorusGeometry(0.5 - t, t, 48, 160).rotateX(Math.PI / 2)
    }
    default:
      return polyGeometry(s)
  }
}

/** Flat-shaded triangles from the planar patches of a polyhedron. */
function polyGeometry(s: ShapeSpec): BufferGeometry {
  const prim = primitiveFor(s)
  const pos: number[] = []
  const nrm: number[] = []
  const p = new Vector3()
  for (const patch of prim.patches) {
    const n = patch.normal!
    // A triangle patch collapses its v = 1 edge onto one vertex.
    const triangle = patch.eval(1, 1, new Vector3()).distanceTo(patch.eval(0, 1, p)) < 1e-9
    const corners = triangle
      ? [
          [0, 0],
          [1, 0],
          [0, 1],
        ]
      : [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ]
    const pts = corners.map(([u, v]) => patch.eval(u, v, p).clone())
    const tris = pts.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]
    for (const k of tris) {
      pos.push(pts[k].x, pts[k].y, pts[k].z)
      nrm.push(n.x, n.y, n.z)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3))
  return g
}
