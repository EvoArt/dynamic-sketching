// Saved scenes with their pictures, kept on the device in IndexedDB.
import { type Doc, newId, sanitiseDoc } from './core/scene'
import { type CameraState, isCameraState } from './render/viewport'

export interface SavedItem {
  id: string
  name: string
  created: number
  doc: Doc
  camera: CameraState
  /** Reveal step when saved during practice, so the answers can still be revealed; -1 otherwise. */
  practiceStep: number
  picture: Blob
  thumb: Blob
}

const DB = 'dynamic-sketching'
const STORE = 'library'

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = tx.onabort = () => reject(tx.error ?? req.error)
  })
}

/** Newest first. */
export async function listItems(): Promise<SavedItem[]> {
  const all = await run('readonly', (s) => s.getAll() as IDBRequest<SavedItem[]>)
  return all.sort((a, b) => b.created - a.created)
}

export const putItem = (item: SavedItem) => run('readwrite', (s) => s.put(item)).then(() => undefined)
export const deleteItem = (id: string) => run('readwrite', (s) => s.delete(id)).then(() => undefined)

/** Asks the browser not to clear the library when space runs low. Harmless if refused. */
export async function keepStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    /* not supported */
  }
}

// ---------------------------------------------------------------- backup files

interface BackupItem extends Omit<SavedItem, 'picture' | 'thumb'> {
  picture: string
  thumb: string
}

const toDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })

export async function backupBlob(items: SavedItem[]): Promise<Blob> {
  const out: BackupItem[] = []
  for (const it of items) out.push({ ...it, picture: await toDataUrl(it.picture), thumb: await toDataUrl(it.thumb) })
  return new Blob([JSON.stringify({ app: 'dynamic-sketching', kind: 'library', version: 1, items: out })], { type: 'application/json' })
}

/** Reads a backup file; returns the valid items in it (an empty list if it isn't one). */
export async function readBackup(text: string): Promise<SavedItem[]> {
  const data = JSON.parse(text) as { kind?: string; items?: unknown[] }
  if (data?.kind !== 'library' || !Array.isArray(data.items)) return []
  const items: SavedItem[] = []
  for (const raw of data.items as Partial<BackupItem>[]) {
    const doc = sanitiseDoc(raw?.doc)
    if (!doc || !isCameraState(raw.camera) || typeof raw.picture !== 'string' || typeof raw.thumb !== 'string') continue
    if (!raw.picture.startsWith('data:image/') || !raw.thumb.startsWith('data:image/')) continue
    items.push({
      id: typeof raw.id === 'string' ? raw.id : newId(),
      name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : 'Scene',
      created: Number.isFinite(raw.created) ? raw.created! : Date.now(),
      doc,
      camera: raw.camera,
      practiceStep: Number.isInteger(raw.practiceStep) ? raw.practiceStep! : -1,
      picture: await (await fetch(raw.picture)).blob(),
      thumb: await (await fetch(raw.thumb)).blob(),
    })
  }
  return items
}
