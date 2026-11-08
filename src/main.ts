import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { computeIntersections, normalCurves, structureLines } from './core/analysis'
import {
  type Doc,
  PALETTE,
  PRESETS,
  type RandomOptions,
  type Settings,
  boundsOf,
  defaultSettings,
  makeShape,
  newId,
  randomScene,
  sanitiseDoc,
} from './core/scene'
import { SHAPE_KINDS, SHAPE_LABELS, type ShapeKind, type ShapeSpec, type Solid, normaliseSize, sizeFields, solidOf, tubeOf } from './core/shapes'
import { type GizmoMode, LAYER_STYLES, Viewport } from './render/viewport'
import { button, h, section, segmented, slider, toggle } from './ui/controls'

registerSW({ immediate: true })

// ---------------------------------------------------------------- state

const STORE = 'dynamic-sketching:v1'

interface PracticeState {
  options: RandomOptions & { randomView: boolean }
  /** -1 when not in a practice round. */
  step: number
  seed: number
}

interface Store {
  doc: Doc
  practice: PracticeState['options']
  open: string[]
}

function load(): Partial<Store> {
  try {
    const raw = localStorage.getItem(STORE)
    if (!raw) return {}
    const s = JSON.parse(raw) as Partial<Store>
    return { ...s, doc: sanitiseDoc(s.doc) ?? undefined }
  } catch {
    return {}
  }
}

const saved = load()
let doc: Doc = saved.doc ?? { version: 1, shapes: PRESETS[0].shapes(), settings: withPreset(defaultSettings(), 0) }
let selected: string | null = null
let gizmoMode: GizmoMode = 'translate'
const practice: PracticeState = {
  options: { count: 2, kinds: ['box', 'sphere', 'cylinder', 'cone'], tilt: true, randomView: true, ...saved.practice },
  step: -1,
  seed: 0,
}
const openSections = new Set(saved.open ?? ['practice', 'lines'])
const undoStack: string[] = []
const redoStack: string[] = []
let editSnapshot: string | null = null
let solids: Solid[] = []

function withPreset(s: Settings, i: number) {
  PRESETS[i].settings?.(s)
  return s
}

let saveTimer = 0
function save() {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ doc, practice: practice.options, open: [...openSections] } satisfies Store))
    } catch {
      /* storage may be unavailable; the app works without it */
    }
  }, 300)
}

// Line recomputation is batched to one per frame; live (dragging) passes use a coarser grid.
const RES = { geom: { live: 14, full: 40 }, view: { live: 22, full: 52 } }
const pending = { geom: false, view: false, light: false }
const settlePending = { geom: false, view: false, light: false }
let pendingLive = true
let frameQueued = false
let settleTimer = 0

// ---------------------------------------------------------------- layout

const app = document.getElementById('app')!
// Sections remember whether they are open; the light marker shows while Light is open.
document.addEventListener(
  'toggle',
  () =>
    setTimeout(() => {
      view.showLightMarker(openSections.has('light'))
      save()
    }),
  true,
)
const stage = h('div', { class: 'stage' })
const panel = h('aside', { class: 'panel', 'aria-label': 'Controls' })
const topbar = h('div', { class: 'topbar' })
const hint = h('div', { class: 'hint' })
app.append(stage, topbar, panel, hint)

const view = new Viewport(stage, {
  select(id) {
    selected = id
    view.select(id)
    if (id) openSections.add('shapes')
    renderPanel()
  },
  transform(id, t) {
    beginEdit()
    const s = doc.shapes.find((x) => x.id === id)
    if (!s) return
    s.position = t.position
    s.rotation = t.rotation
    s.size = constrainScale(s, t.scale)
    shapesChanged(true)
  },
  transformEnd() {
    endEdit()
    renderPanel()
  },
  camera() {
    request({ view: true }, true)
  },
})

/** Keeps round things round when sized with the gizmo: follows the axis that moved most. */
function constrainScale(s: ShapeSpec, next: [number, number, number]): [number, number, number] {
  const prev = s.size
  const ratio = next.map((v, i) => Math.abs(Math.log(v / prev[i])))
  const k = ratio.indexOf(Math.max(...ratio))
  if (s.kind === 'sphere' || s.kind === 'torus') return normaliseSize(s.kind, [next[k], next[k], next[k]])
  if (s.kind === 'cylinder' || s.kind === 'cone') {
    const d = k === 1 ? prev[0] : next[k]
    return normaliseSize(s.kind, [d, next[1], d])
  }
  return normaliseSize(s.kind, next)
}

// ---------------------------------------------------------------- recomputing lines


function request(what: Partial<typeof pending>, live: boolean) {
  Object.assign(pending, what)
  if (!live) pendingLive = false
  else {
    Object.assign(settlePending, what)
    clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => {
      const w = { ...settlePending }
      settlePending.geom = settlePending.view = settlePending.light = false
      request(w, false)
    }, 220)
  }
  if (!frameQueued) {
    frameQueued = true
    requestAnimationFrame(flush)
  }
}

function flush() {
  frameQueued = false
  const live = pendingLive
  pendingLive = true
  const L = doc.settings.lines
  if (pending.geom) {
    pending.geom = false
    const st = structureLines(solids)
    view.setLayer('edges', st.edges)
    view.setLayer('guides', L.guides ? st.guides : [])
    if (L.intersections || L.construction || L.sections) {
      const r = computeIntersections(solids, live ? RES.geom.live : RES.geom.full)
      view.setLayer('intersections', r.intersections)
      view.setLayer('construction', L.construction ? r.construction : [])
      view.setFills(L.sections ? r.fills : new Float32Array())
    } else {
      view.setLayer('intersections', [])
      view.setLayer('construction', [])
      view.setFills(new Float32Array())
    }
  }
  if (pending.view) {
    pending.view = false
    view.setLayer('silhouettes', L.outline ? normalCurves(solids, view.viewer(), live ? RES.view.live : RES.view.full) : [])
  }
  if (pending.light) {
    pending.light = false
    const Ls = doc.settings.light
    if (L.terminator && Ls.on) {
      const target = Ls.kind === 'lamp' ? { point: view.lightPosition() } : { dir: view.lightDir() }
      view.setLayer('terminator', normalCurves(solids, target, live ? RES.view.live : RES.view.full))
    } else view.setLayer('terminator', [])
  }
}

function shapesChanged(live = false) {
  solids = doc.shapes.map(solidOf)
  view.setShapes(doc.shapes, solids)
  request({ geom: true, view: true, light: true }, live)
  save()
}

function settingsChanged(live = false, what: Partial<typeof pending> = { geom: true, view: true, light: true }) {
  view.applySettings(doc.settings)
  request(what, live)
  save()
}

// ---------------------------------------------------------------- undo

function snapshot() {
  return JSON.stringify(doc.shapes)
}

function commit(change: () => void) {
  undoStack.push(snapshot())
  if (undoStack.length > 200) undoStack.shift()
  redoStack.length = 0
  change()
  shapesChanged()
  renderPanel()
}

function beginEdit() {
  if (editSnapshot === null) editSnapshot = snapshot()
}

function endEdit() {
  if (editSnapshot === null) return
  if (editSnapshot !== snapshot()) {
    undoStack.push(editSnapshot)
    redoStack.length = 0
  }
  editSnapshot = null
  shapesChanged()
  updateTopbar()
}

function undo() {
  const s = undoStack.pop()
  if (!s) return
  redoStack.push(snapshot())
  doc.shapes = JSON.parse(s)
  if (selected && !doc.shapes.some((x) => x.id === selected)) selected = null
  view.select(selected)
  shapesChanged()
  renderPanel()
}

function redo() {
  const s = redoStack.pop()
  if (!s) return
  undoStack.push(snapshot())
  doc.shapes = JSON.parse(s)
  shapesChanged()
  renderPanel()
}

// ---------------------------------------------------------------- actions

const selectedShape = () => doc.shapes.find((s) => s.id === selected) ?? null

function select(id: string | null) {
  selected = id
  view.select(id)
  renderPanel()
}

function addShape(kind: ShapeKind) {
  const s = makeShape(kind)
  // Put it where it will overlap what is already there.
  if (doc.shapes.length) {
    const last = doc.shapes[doc.shapes.length - 1]
    s.position = [last.position[0] + last.size[0] * 0.45, s.size[1] / 2 + 0.1, last.position[2] + last.size[2] * 0.3]
  }
  s.color = PALETTE[doc.shapes.length % PALETTE.length]
  commit(() => doc.shapes.push(s))
  select(s.id)
}

function duplicate(s: ShapeSpec) {
  const c: ShapeSpec = { ...structuredClone(s), id: newId(), position: [s.position[0] + 0.4, s.position[1], s.position[2] + 0.4] }
  commit(() => doc.shapes.push(c))
  select(c.id)
}

function remove(s: ShapeSpec) {
  commit(() => (doc.shapes = doc.shapes.filter((x) => x.id !== s.id)))
  select(null)
}

function restOnGround(s: ShapeSpec) {
  commit(() => {
    const b = boundsOf(s)
    s.position = [s.position[0], s.position[1] - b.min.y, s.position[2]]
  })
}

function loadPreset(i: number) {
  practice.step = -1
  const settings = defaultSettings()
  settings.view = { ...doc.settings.view }
  settings.light = { ...doc.settings.light }
  PRESETS[i].settings?.(settings)
  commit(() => {
    doc.shapes = PRESETS[i].shapes()
    doc.settings = settings
  })
  select(null)
  settingsChanged()
  view.frame(doc.shapes)
  renderPanel()
}

// Practice: a fresh random scene with the answers hidden, then revealed in steps.
const REVEAL: { label: string; apply: (s: Settings) => void }[] = [
  { label: 'Hidden edges', apply: (s) => (s.lines.hidden = true) },
  { label: 'Intersections', apply: (s) => (s.lines.intersections = true) },
  { label: 'Full sections', apply: (s) => (s.lines.construction = true) },
  { label: 'Shadow line', apply: (s) => ((s.lines.terminator = true), (s.lines.guides = true)) },
]

function hideAnswers(s: Settings) {
  Object.assign(s.lines, { outline: true, hidden: false, intersections: false, construction: false, sections: false, guides: false, terminator: false })
}

function newPracticeScene() {
  practice.seed = Math.floor(Math.random() * 1e9)
  practice.step = 0
  commit(() => (doc.shapes = randomScene(practice.seed, practice.options)))
  selected = null
  view.select(null)
  hideAnswers(doc.settings)
  if (practice.options.randomView) {
    const r = Math.random
    if (doc.settings.view.perspective) doc.settings.view.fov = Math.round(35 + r() * 35)
    const az = r() * 360
    view.setView(az, 6 + r() * 24)
    // Light from the viewer's side, off to the left or right, so the forms read.
    const side = r() < 0.5 ? -1 : 1
    doc.settings.light.azimuth = Math.round((az + side * (30 + r() * 60) + 360) % 360)
    doc.settings.light.elevation = Math.round(30 + r() * 35)
  }
  settingsChanged()
  view.frame(doc.shapes)
  renderPanel()
}

function revealNext() {
  if (practice.step < 0) practice.step = 0
  if (practice.step >= REVEAL.length) return
  REVEAL[practice.step].apply(doc.settings)
  practice.step++
  settingsChanged()
  renderPanel()
}

function hideAll() {
  hideAnswers(doc.settings)
  practice.step = 0
  settingsChanged()
  renderPanel()
}

function download(name: string, url: string) {
  const a = h('a', { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
}

function exportScene() {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  download('sketch-scene.json', url)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function importScene() {
  const input = h('input', { type: 'file', accept: '.json,application/json' })
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    try {
      const d = sanitiseDoc(JSON.parse(await f.text()))
      if (!d) throw new Error('not a scene')
      commit(() => (doc = d))
      settingsChanged()
      view.frame(doc.shapes)
      renderPanel()
    } catch {
      flash('That file is not a scene saved from here.')
    }
  }
  input.click()
}

let flashTimer = 0
function flash(msg: string) {
  hint.textContent = msg
  hint.classList.add('show')
  clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => hint.classList.remove('show'), 2600)
}

// ---------------------------------------------------------------- top bar

const ICONS = {
  move: '<svg viewBox="0 0 24 24"><path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3v4h-4"/></svg>',
  scale: '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="10" height="10"/><path d="M11 3h10v10M21 3l-9 9"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
  panel: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  dice: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2"/><circle cx="16" cy="16" r="1.2"/><circle cx="16" cy="8" r="1.2"/><circle cx="8" cy="16" r="1.2"/><circle cx="12" cy="12" r="1.2"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
}

function iconButton(icon: keyof typeof ICONS, label: string, onClick: () => void, opts: { on?: boolean; disabled?: boolean; text?: string } = {}) {
  return h(
    'button',
    {
      type: 'button',
      class: `icon${opts.on ? ' on' : ''}${opts.text ? ' with-text' : ''}`,
      title: label,
      'aria-label': label,
      disabled: opts.disabled,
      onclick: onClick,
    },
    h('span', { class: 'ico', html: ICONS[icon] }),
    opts.text ? h('span', {}, opts.text) : null,
  )
}

function updateTopbar() {
  const gizmo = h(
    'div',
    { class: 'group' },
    iconButton('move', 'Move', () => setGizmo('translate'), { on: gizmoMode === 'translate' }),
    iconButton('rotate', 'Turn', () => setGizmo('rotate'), { on: gizmoMode === 'rotate' }),
    iconButton('scale', 'Size', () => setGizmo('scale'), { on: gizmoMode === 'scale' }),
  )
  const history = h(
    'div',
    { class: 'group' },
    iconButton('undo', 'Undo', undo, { disabled: !undoStack.length }),
    iconButton('redo', 'Redo', redo, { disabled: !redoStack.length }),
  )
  const next = practice.step >= 0 && practice.step < REVEAL.length ? REVEAL[practice.step].label : null
  const practiceBar = h(
    'div',
    { class: 'group practice' },
    iconButton('dice', 'New practice scene', newPracticeScene, { text: 'New scene' }),
    next ? iconButton('eye', `Reveal ${next.toLowerCase()}`, revealNext, { text: next }) : null,
    practice.step > 0 ? button('Hide', hideAll, 'plain', 'Hide the answers again') : null,
  )
  const toggleBtn = iconButton('panel', 'Show or hide the controls', () => app.classList.toggle('panel-closed'), { text: 'Controls' })
  toggleBtn.classList.add('panel-toggle')
  topbar.replaceChildren(gizmo, history, practiceBar, toggleBtn)
}

function setGizmo(m: GizmoMode) {
  gizmoMode = m
  view.setGizmoMode(m)
  updateTopbar()
}

// ---------------------------------------------------------------- panel

function renderPanel() {
  const scroll = panel.scrollTop
  const S = doc.settings
  const setView = <K extends keyof Settings['view']>(k: K, v: Settings['view'][K], rerender = false) => {
    S.view[k] = v
    settingsChanged(false, { view: true })
    if (rerender) renderPanel()
  }
  const setLines = <K extends keyof Settings['lines']>(k: K, v: Settings['lines'][K]) => {
    S.lines[k] = v
    settingsChanged()
  }
  const setLight = <K extends keyof Settings['light']>(k: K, v: Settings['light'][K], live = false, rerender = false) => {
    S.light[k] = v
    settingsChanged(live, { light: true })
    if (rerender) renderPanel()
  }

  // Practice
  const opts = practice.options
  const practiceSection = section(
    'practice',
    'Practice',
    openSections,
    h('p', { class: 'note' }, 'Make a random scene, draw it, then reveal the answers one layer at a time.'),
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'label' }, 'Shapes'),
      segmented(
        [2, 3, 4].map((n) => ({ value: n, label: String(n) })),
        opts.count,
        (n) => {
          opts.count = n
          save()
          renderPanel()
        },
      ),
    ),
    h(
      'div',
      { class: 'chips' },
      ...SHAPE_KINDS.map((k) =>
        h(
          'button',
          {
            type: 'button',
            class: `chip${opts.kinds.includes(k) ? ' on' : ''}`,
            'aria-pressed': String(opts.kinds.includes(k)),
            onclick: () => {
              opts.kinds = opts.kinds.includes(k) ? opts.kinds.filter((x) => x !== k) : [...opts.kinds, k]
              save()
              renderPanel()
            },
          },
          SHAPE_LABELS[k],
        ),
      ),
    ),
    toggle('Tilted shapes', opts.tilt, (v) => ((opts.tilt = v), save())),
    toggle('Random viewpoint', opts.randomView, (v) => ((opts.randomView = v), save())),
    h('div', { class: 'buttons' }, button('New scene', newPracticeScene, 'primary')),
    h('h4', {}, 'Set pieces'),
    h('div', { class: 'presets' }, ...PRESETS.map((p, i) => button(p.name, () => loadPreset(i), 'preset'))),
  )

  // Shapes
  const sel = selectedShape()
  const shapeList = h(
    'ul',
    { class: 'shape-list' },
    ...doc.shapes.map((s, i) =>
      h(
        'li',
        { class: s.id === selected ? 'on' : '' },
        h(
          'button',
          { type: 'button', class: 'pick', onclick: () => select(s.id === selected ? null : s.id) },
          h('span', { class: 'dot', style: `--c:${s.color}` }),
          `${SHAPE_LABELS[s.kind]} ${i + 1}`,
        ),
        h(
          'button',
          {
            type: 'button',
            class: `icon small${s.visible ? '' : ' off'}`,
            title: s.visible ? 'Hide' : 'Show',
            'aria-label': s.visible ? 'Hide' : 'Show',
            onclick: () => commit(() => (s.visible = !s.visible)),
          },
          h('span', { class: 'ico', html: ICONS.eye }),
        ),
      ),
    ),
  )
  const editShape = (fn: (s: ShapeSpec, v: number) => void) => (v: number, final: boolean) => {
    if (!sel) return
    beginEdit()
    fn(sel, v)
    shapesChanged(!final)
    if (final) endEdit()
  }
  const shapeEditor = sel
    ? h(
        'div',
        { class: 'editor' },
        h('h4', {}, `${SHAPE_LABELS[sel.kind]} ${doc.shapes.indexOf(sel) + 1}`),
        ...sizeFields(sel.kind).map((f) =>
          slider(f.label, sel.size[f.axis], 0.2, 4, 0.01, editShape((s, v) => {
            const size = [...s.size] as [number, number, number]
            size[f.axis] = v
            s.size = normaliseSize(s.kind, size)
          })),
        ),
        sel.kind === 'torus'
          ? slider('Tube', tubeOf(sel), 0.05, 0.25, 0.005, (v, final) => {
              beginEdit()
              sel.tube = v
              shapesChanged(!final)
              if (final) endEdit()
            })
          : null,
        ...(['X', 'Y', 'Z'] as const).map((axis, k) =>
          slider(`Turn ${axis}`, wrapDeg(sel.rotation[k]), -180, 180, 1, (v, final) => {
            beginEdit()
            sel.rotation[k] = v
            shapesChanged(!final)
            if (final) endEdit()
          }, (v) => `${Math.round(v)}°`),
        ),
        slider('See-through', 1 - sel.opacity, 0, 0.9, 0.01, (v, final) => {
          beginEdit()
          sel.opacity = Math.round((1 - v) * 100) / 100
          shapesChanged(!final)
          if (final) endEdit()
        }, (v) => `${Math.round(v * 100)}%`),
        h(
          'div',
          { class: 'colours' },
          ...PALETTE.map((c) =>
            h('button', {
              type: 'button',
              class: `colour${sel.color === c ? ' on' : ''}`,
              style: `--c:${c}`,
              title: c,
              'aria-label': `Colour ${c}`,
              onclick: () => commit(() => (sel.color = c)),
            }),
          ),
          h('input', {
            type: 'color',
            value: sel.color,
            title: 'Any colour',
            onchange: (e: Event) => commit(() => (sel.color = (e.target as HTMLInputElement).value)),
          }),
        ),
        h(
          'div',
          { class: 'buttons' },
          button('Duplicate', () => duplicate(sel)),
          button('Rest on ground', () => restOnGround(sel)),
          button('Delete', () => remove(sel), 'danger'),
        ),
      )
    : h('p', { class: 'note' }, 'Tap a shape to select it, then drag the handles to move, turn or size it.')
  const shapesSection = section(
    'shapes',
    'Shapes',
    openSections,
    h('div', { class: 'add' }, ...SHAPE_KINDS.map((k) => button(`+ ${SHAPE_LABELS[k]}`, () => addShape(k), 'add-btn'))),
    shapeList,
    shapeEditor,
  )

  // View
  const viewSection = section(
    'view',
    'View',
    openSections,
    toggle('Perspective', S.view.perspective, (v) => setView('perspective', v, true)),
    S.view.perspective
      ? slider('Lens (field of view)', S.view.fov, 15, 100, 1, (v) => setView('fov', v), (v) => `${Math.round(v)}°`)
      : null,
    S.view.perspective ? toggle('Horizon line', S.view.horizon, (v) => setView('horizon', v), { colour: '#0f8b8d' }) : null,
    S.view.perspective ? toggle('Vanishing points', S.view.vanishing, (v) => setView('vanishing', v, true), { colour: '#d1203a' }) : null,
    S.view.perspective && S.view.vanishing ? toggle('Lines to them', S.view.vanishingLines, (v) => setView('vanishingLines', v), { colour: '#2f6db5', dashed: true }) : null,
    toggle('Ground', S.view.ground, (v) => setView('ground', v)),
    h('div', { class: 'row' }, h('span', { class: 'label' }, 'Shading')),
    segmented(
      [
        { value: 'smooth', label: 'Smooth' },
        { value: 'bands', label: 'Tones' },
        { value: 'flat', label: 'Flat' },
        { value: 'none', label: 'Lines' },
      ] as const,
      S.view.shading,
      (v) => setView('shading', v, true),
      'wide',
    ),
    S.view.shading === 'bands' ? slider('Tones', S.view.bands, 2, 6, 1, (v) => setView('bands', v), (v) => `${v}`) : null,
    h('div', { class: 'row' }, h('span', { class: 'label' }, 'Look from')),
    h(
      'div',
      { class: 'buttons' },
      button('Front', () => view.setView(0, 0)),
      button('Side', () => view.setView(90, 0)),
      button('Above', () => view.setView(0, 89.9)),
      button('Three-quarter', () => view.setView(40, 25)),
      button('Worm’s eye', () => view.setView(30, -12)),
      button('Fit all', () => view.frame(doc.shapes.filter((s) => s.visible))),
    ),
  )

  // Lines
  const sw = (n: keyof typeof LAYER_STYLES) => ({ colour: LAYER_STYLES[n].color, dashed: !!LAYER_STYLES[n].dashed })
  const linesSection = section(
    'lines',
    'Lines',
    openSections,
    toggle('Outlines and edges', S.lines.outline, (v) => setLines('outline', v), sw('edges')),
    toggle('Hidden lines (dashed)', S.lines.hidden, (v) => setLines('hidden', v), { colour: '#1d1d1f', dashed: true }),
    toggle('Intersections', S.lines.intersections, (v) => setLines('intersections', v), sw('intersections')),
    toggle('Full sections (whole ellipses)', S.lines.construction, (v) => setLines('construction', v), sw('construction')),
    toggle('Section planes', S.lines.sections, (v) => setLines('sections', v), { colour: '#0f8b8d' }),
    toggle('Draw-through guides', S.lines.guides, (v) => setLines('guides', v), sw('guides')),
    toggle('Core shadow line', S.lines.terminator, (v) => setLines('terminator', v), sw('terminator')),
    slider('Line weight', S.lines.weight, 0.5, 2.5, 0.05, (v) => {
      S.lines.weight = v
      view.applySettings(S)
      save()
    }),
  )

  // Light
  const lightSection = section(
    'light',
    'Light',
    openSections,
    toggle('Light', S.light.on, (v) => setLight('on', v, false, true)),
    S.light.on
      ? h(
          'div',
          {},
          segmented(
            [
              { value: 'sun', label: 'Sun (parallel)' },
              { value: 'lamp', label: 'Lamp (point)' },
            ] as const,
            S.light.kind,
            (v) => setLight('kind', v, false, true),
            'wide',
          ),
          slider('Direction', S.light.azimuth, 0, 360, 1, (v, f) => setLight('azimuth', v, !f), (v) => `${Math.round(v)}°`),
          slider('Height', S.light.elevation, 3, 90, 1, (v, f) => setLight('elevation', v, !f), (v) => `${Math.round(v)}°`),
          S.light.kind === 'lamp' ? slider('Distance', S.light.distance, 1.2, 8, 0.05, (v, f) => setLight('distance', v, !f)) : null,
          slider('Strength', S.light.intensity, 0.3, 5, 0.05, (v, f) => setLight('intensity', v, !f)),
          slider('Fill light', S.light.ambient, 0, 1.6, 0.02, (v, f) => setLight('ambient', v, !f)),
          toggle('Cast shadows', S.light.shadows, (v) => setLight('shadows', v)),
        )
      : null,
  )

  const fileSection = section(
    'file',
    'Save and share',
    openSections,
    h(
      'div',
      { class: 'buttons' },
      button('Save picture', () => download('sketch-reference.png', view.snapshot())),
      button('Export scene', exportScene),
      button('Import scene', importScene),
    ),
    h('p', { class: 'note' }, 'Your scene is kept on this device between visits.'),
  )

  const legend = h(
    'div',
    { class: 'legend' },
    h('strong', {}, 'Dynamic Sketching'),
    h('span', {}, 'Drag to orbit · pinch or scroll to zoom · two fingers or right-drag to pan'),
  )

  panel.replaceChildren(legend, practiceSection, shapesSection, viewSection, linesSection, lightSection, fileSection)
  view.showLightMarker(openSections.has('light'))
  panel.scrollTop = scroll
  updateTopbar()
  save()
}

function wrapDeg(d: number) {
  return ((((d + 180) % 360) + 360) % 360) - 180
}

// ---------------------------------------------------------------- keys (extras for keyboard users)

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, textarea, select')) return
  const k = e.key.toLowerCase()
  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
    e.preventDefault()
    redo()
  } else if (k === 'w' || k === 'g') setGizmo('translate')
  else if (k === 'e' || k === 'r') setGizmo('rotate')
  else if (k === 's') setGizmo('scale')
  else if ((k === 'delete' || k === 'backspace') && selectedShape()) remove(selectedShape()!)
  else if (k === 'escape') select(null)
  else if (k === 'n') newPracticeScene()
  else if (k === ' ' && practice.step >= 0) {
    e.preventDefault()
    revealNext()
  }
})

// ---------------------------------------------------------------- start

if (matchMedia('(max-width: 720px)').matches) app.classList.add('panel-closed')
view.applySettings(doc.settings)
shapesChanged()
view.frame(doc.shapes)
renderPanel()
