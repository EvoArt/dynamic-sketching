// Checks the built app works with no connection: loads it once online, then reloads offline
// and checks the scene, the view and the library all come back.
// Usage: npm run build && npx vite preview --port 5198, then node scripts/offline-check.mjs [url]
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? 'http://localhost:5198/'
await mkdir('shots', { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 412, height: 860 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(url)
await page.evaluate(() => navigator.serviceWorker.ready)
await page.waitForTimeout(1000)
const toast = await page.locator('.hint').textContent()

// Make a change, orbit the view and save to the library while online.
await page.getByRole('button', { name: 'Show or hide the controls' }).click()
await page.getByRole('button', { name: 'Cone through a slab', exact: true }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Show or hide the controls' }).click()
const box = await page.locator('canvas.gl').boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 8 })
await page.mouse.up()
await page.getByRole('button', { name: 'Save the scene and a picture of it to your library' }).click()
await page.waitForTimeout(800)
const cameraBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('dynamic-sketching:v1')).camera)

await context.setOffline(true)
await page.reload()
await page.waitForTimeout(2000)
const cameraAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('dynamic-sketching:v1')).camera)
await page.screenshot({ path: 'shots/offline-reloaded.png' })
await page.getByRole('button', { name: 'Your library of saved scenes' }).click()
await page.waitForTimeout(600)
const cards = await page.locator('.lib-card').count()
await page.screenshot({ path: 'shots/offline-library.png' })
await browser.close()

const flat = (c) => [...c.target, ...c.dir, c.distance]
const a = flat(cameraBefore)
const b = flat(cameraAfter)
const same = a.every((v, i) => Math.abs(v - b[i]) < 1e-6) && Math.abs(a[0] - 0) + Math.abs(a[3] - 0) > 0
console.log(`first-load notice: ${toast}`)
console.log(`offline reload kept the view: ${same}`)
console.log(`library items offline: ${cards}`)
console.log(errors.length ? errors.join('\n') : 'no console errors')
if (!same || cards !== 1 || errors.length) process.exit(1)
