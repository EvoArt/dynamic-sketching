// The library screen: saved scenes as pictures, opened full size, shared, renamed or deleted.
import { type SavedItem, backupBlob, deleteItem, listItems, putItem, readBackup } from '../library'
import { button, h } from './controls'

export interface LibraryHost {
  /** Load the item's scene and view into the editor. */
  open(item: SavedItem): void
  flash(msg: string): void
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function fileName(name: string, ext: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sketch'
  return `${slug}.${ext}`
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Opens the share sheet with the file where the browser can (Android), otherwise downloads it. */
export async function shareOrDownload(blob: Blob, name: string, title: string) {
  const file = new File([blob], name, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
  }
  downloadBlob(blob, name)
}

let current: { close(): void } | null = null

export function openLibrary(host: LibraryHost, focus?: string) {
  current?.close()
  const urls: string[] = []
  const url = (b: Blob) => {
    const u = URL.createObjectURL(b)
    urls.push(u)
    return u
  }
  const root = h('div', { class: 'library', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Your library' })
  document.getElementById('app')!.append(root)

  // The phone's back button closes the library (or goes from a picture back to the list).
  let depth = 0
  const push = () => {
    history.pushState({ library: ++depth }, '')
  }
  const onPop = () => {
    depth = Math.max(0, depth - 1)
    if (depth === 0) teardown()
    else showList()
  }
  window.addEventListener('popstate', onPop)
  const teardown = () => {
    window.removeEventListener('popstate', onPop)
    for (const u of urls) URL.revokeObjectURL(u)
    root.remove()
    current = null
  }
  const close = () => {
    const d = depth
    teardown()
    if (d > 0) history.go(-d)
  }
  const back = () => history.back()
  current = { close }

  let items: SavedItem[] = []

  const header = (title: string, left: HTMLElement | null) =>
    h(
      'header',
      {},
      left ?? h('span', { class: 'spacer' }),
      h('h2', {}, title),
      h('button', { type: 'button', class: 'icon', 'aria-label': 'Close', title: 'Close', onclick: close }, '✕'),
    )

  function showList() {
    const grid = items.length
      ? h(
          'ul',
          { class: 'lib-grid' },
          ...items.map((it) =>
            h(
              'li',
              {},
              h(
                'button',
                { type: 'button', class: 'lib-card', onclick: () => (push(), showItem(it)) },
                h('img', { src: url(it.thumb), alt: '', loading: 'lazy' }),
                h('span', { class: 'lib-name' }, it.name),
                h('span', { class: 'lib-date' }, dateFmt.format(it.created)),
              ),
            ),
          ),
        )
      : h(
          'div',
          { class: 'lib-empty' },
          h('p', {}, 'Nothing saved yet.'),
          h('p', { class: 'note' }, 'Press Save at the top to keep the scene, the view and a picture of it here. Everything stays on this device and works offline.'),
        )
    root.replaceChildren(
      header('Your library', null),
      h('div', { class: 'lib-body' }, grid),
      h(
        'footer',
        {},
        button('Back up library', backup, '', 'Save every scene and picture to one file'),
        button('Restore a backup', restore),
      ),
    )
  }

  function showItem(it: SavedItem) {
    let confirmDelete = false
    const del = button('Delete', async () => {
      if (!confirmDelete) {
        confirmDelete = true
        del.textContent = 'Tap again to delete'
        return
      }
      await deleteItem(it.id)
      items = items.filter((x) => x.id !== it.id)
      host.flash('Deleted')
      back()
    }, 'danger')
    const nameInput = h('input', {
      type: 'text',
      value: it.name,
      maxlength: 80,
      'aria-label': 'Name',
      onchange: async () => {
        it.name = nameInput.value.trim() || it.name
        nameInput.value = it.name
        await putItem(it)
      },
    })
    root.replaceChildren(
      header(
        '',
        h('button', { type: 'button', class: 'icon with-text', onclick: back }, '‹ All'),
      ),
      h(
        'div',
        { class: 'lib-detail' },
        h('img', { src: url(it.picture), alt: it.name }),
        nameInput,
        h('p', { class: 'note' }, `Saved ${dateFmt.format(it.created)}${it.practiceStep >= 0 ? ' · practice scene, answers can still be revealed' : ''}`),
        h(
          'div',
          { class: 'buttons' },
          button('Open scene', () => {
            host.open(it)
            close()
          }, 'primary'),
          button('Share picture', () => shareOrDownload(it.picture, fileName(it.name, 'png'), it.name)),
          button('Download', () => downloadBlob(it.picture, fileName(it.name, 'png'))),
          del,
        ),
      ),
    )
  }

  async function backup() {
    if (!items.length) return host.flash('Nothing to back up yet')
    const blob = await backupBlob(items)
    const stamp = new Date().toISOString().slice(0, 10)
    await shareOrDownload(blob, `sketch-library-${stamp}.json`, 'Dynamic Sketching library')
  }

  function restore() {
    const input = h('input', { type: 'file', accept: '.json,application/json' })
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      try {
        const got = await readBackup(await f.text())
        if (!got.length) throw new Error('empty')
        const have = new Set(items.map((x) => x.id))
        const fresh = got.filter((x) => !have.has(x.id))
        for (const it of fresh) await putItem(it)
        items = await listItems()
        showList()
        host.flash(fresh.length ? `Added ${fresh.length} from the backup` : 'Everything in that backup is already here')
      } catch {
        host.flash('That file is not a library backup from here.')
      }
    }
    input.click()
  }

  push()
  root.replaceChildren(header('Your library', null), h('div', { class: 'lib-body' }, h('p', { class: 'note' }, 'Loading…')))
  listItems()
    .then((all) => {
      items = all
      const f = focus ? items.find((x) => x.id === focus) : undefined
      if (f) {
        showList()
        push()
        showItem(f)
      } else showList()
    })
    .catch(() => {
      root.replaceChildren(header('Your library', null), h('div', { class: 'lib-body' }, h('p', {}, 'This browser is not letting the app store anything (a private window, perhaps).')))
    })
}
