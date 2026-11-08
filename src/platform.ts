// What differs between the website and the Android app (a Capacitor WebView, which can't
// download files or use the Web Share API, so those go through native plugins).
import { Capacitor } from '@capacitor/core'
import { h } from './ui/controls'

export const isNative = Capacitor.isNativePlatform()

/** Folder under Documents where the Android app saves files. */
const FOLDER = 'Dynamic Sketching'

const base64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((r.result as string).split(',')[1])
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })

/** Saves a file to the device. Returns a message saying where it went (in the app), or null. */
export async function downloadBlob(blob: Blob, name: string): Promise<string | null> {
  if (isNative) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    // Only Android 10 and older ask; newer versions report it as granted.
    if ((await Filesystem.checkPermissions()).publicStorage !== 'granted') await Filesystem.requestPermissions()
    await Filesystem.writeFile({ path: `${FOLDER}/${name}`, data: await base64(blob), directory: Directory.Documents, recursive: true })
    return `Saved to Documents › ${FOLDER}`
  }
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return null
}

/** Opens the share sheet with the file; falls back to saving it. Returns a message, or null. */
export async function shareBlob(blob: Blob, name: string, title: string): Promise<string | null> {
  if (isNative) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const w = await Filesystem.writeFile({ path: `share/${name}`, data: await base64(blob), directory: Directory.Cache, recursive: true })
    try {
      await Share.share({ title, files: [w.uri] })
    } catch (e) {
      if (!/cancel/i.test(String((e as Error).message))) throw e
    }
    return null
  }
  const file = new File([blob], name, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return null
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null
    }
  }
  return downloadBlob(blob, name)
}
