// Small DOM helpers for the control panel. No framework: the panel is rebuilt
// when its structure changes, and sliders update state directly while dragged.

type Child = Node | string | null | undefined | false
type Props = Record<string, unknown> & { class?: string; style?: string }

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else if (k === 'class') el.className = String(v)
    else if (k === 'html') el.innerHTML = String(v)
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void, swatch?: { colour: string; dashed?: boolean }) {
  const input = h('input', { type: 'checkbox', checked: value, onchange: () => onChange(input.checked) })
  return h(
    'label',
    { class: 'row toggle' },
    swatch ? h('span', { class: `swatch${swatch.dashed ? ' dashed' : ''}`, style: `--c:${swatch.colour}` }) : null,
    h('span', { class: 'label' }, label),
    input,
    h('span', { class: 'switch', 'aria-hidden': 'true' }),
  )
}

export function slider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (v: number, final: boolean) => void,
  fmt: (v: number) => string = (v) => String(Math.round(v * 100) / 100),
) {
  const out = h('output', {}, fmt(value))
  const input = h('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    oninput: () => {
      out.textContent = fmt(Number(input.value))
      onInput(Number(input.value), false)
    },
    onchange: () => onInput(Number(input.value), true),
  })
  return h('label', { class: 'row slider' }, h('span', { class: 'label' }, label), out, input)
}

export function segmented<T extends string | number>(options: { value: T; label: string; title?: string }[], value: T, onChange: (v: T) => void, cls = '') {
  return h(
    'div',
    { class: `segmented ${cls}`, role: 'radiogroup' },
    ...options.map((o) =>
      h(
        'button',
        {
          type: 'button',
          class: o.value === value ? 'on' : '',
          role: 'radio',
          'aria-checked': String(o.value === value),
          title: o.title,
          onclick: () => onChange(o.value),
        },
        o.label,
      ),
    ),
  )
}

export function button(label: string, onClick: () => void, cls = '', title?: string) {
  return h('button', { type: 'button', class: cls, title, onclick: onClick }, label)
}

export function section(id: string, title: string, open: Set<string>, ...children: Child[]) {
  const d = h('details', { class: 'section', open: open.has(id) }, h('summary', {}, title), h('div', { class: 'body' }, ...children))
  d.addEventListener('toggle', () => {
    if (d.open) open.add(id)
    else open.delete(id)
  })
  return d
}
