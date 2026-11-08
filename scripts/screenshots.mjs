// Opens the app in a headless browser and saves screenshots for checking.
// Usage: node scripts/screenshots.mjs [url]   (default http://localhost:5199/)
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? 'http://localhost:5199/'
await mkdir('shots', { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const errors = []
async function shot(name, viewport, actions = async () => {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(url)
  await page.waitForTimeout(1500)
  await actions(page)
  await page.waitForTimeout(900)
  await page.screenshot({ path: `shots/${name}.png` })
  await page.close()
}
const click = (text) => async (page) => {
  await page.getByRole('button', { name: text, exact: true }).first().click()
  await page.waitForTimeout(500)
}
await shot('desktop-default', { width: 1400, height: 860 })
await shot('desktop-preset-cone', { width: 1400, height: 860 }, click('Cone through a slab'))
await shot('desktop-preset-cylinders', { width: 1400, height: 860 }, async (p) => {
  await click('Two crossing cylinders')(p)
  await p.getByText('Full sections (whole ellipses)').click()
  await p.getByText('Core shadow line').click()
})
await shot('desktop-ring', { width: 1400, height: 860 }, async (p) => {
  await click('Ring on a pyramid')(p)
  await p.locator('summary', { hasText: 'View' }).click()
  await p.getByText('Vanishing points').click()
  await p.waitForTimeout(200)
  await p.getByText('Lines to them').click()
})
await shot('desktop-practice', { width: 1400, height: 860 }, click('New scene'))
await shot('desktop-lines-only', { width: 1400, height: 860 }, async (p) => {
  await click('Cylinder through a box')(p)
  await p.locator('summary', { hasText: 'View' }).click()
  await p.getByRole('radio', { name: 'Lines' }).click()
  await p.getByText('Draw-through guides').click()
})
await shot('desktop-selected', { width: 1400, height: 860 }, async (p) => {
  await p.locator('summary', { hasText: 'Shapes' }).click()
  await p.getByRole('button', { name: 'Box 2' }).click()
})
await shot('desktop-tones-lamp', { width: 1400, height: 860 }, async (p) => {
  await click('Sphere on a wedge')(p)
  await p.locator('summary', { hasText: 'View' }).click()
  await p.getByRole('radio', { name: 'Tones' }).click()
  await p.locator('summary', { hasText: 'Light' }).click()
  await p.getByRole('radio', { name: 'Lamp (point)' }).click()
  await p.getByText('Core shadow line').click()
})
await shot('desktop-all-kinds-revealed', { width: 1400, height: 860 }, async (p) => {
  await p.locator('summary', { hasText: 'Shapes' }).click()
  for (const k of ['Box', 'Sphere', 'Cylinder', 'Cone', 'Pyramid', 'Wedge', 'Torus']) await click('+ ' + k)(p)
  await p.keyboard.press('Control+z')
  await p.keyboard.press('Control+y')
  await p.keyboard.press('Escape')
  await click('New scene')(p)
  for (let i = 0; i < 4; i++) {
    await p.keyboard.press('Space')
    await p.waitForTimeout(300)
  }
})
await shot('phone', { width: 412, height: 860 })
await shot('phone-panel', { width: 412, height: 860 }, async (p) => {
  await p.getByRole('button', { name: 'Show or hide the controls' }).click()
})
const saveAndOpenLibrary = async (p) => {
  await p.getByRole('button', { name: 'Save the scene and a picture of it to your library' }).click()
  await p.waitForTimeout(600)
  await click('Two crossing cylinders')(p)
  await p.getByRole('button', { name: 'Save the scene and a picture of it to your library' }).click()
  await p.waitForTimeout(600)
  await p.getByRole('button', { name: 'Your library of saved scenes' }).click()
  await p.waitForTimeout(400)
}
await shot('desktop-library', { width: 1400, height: 860 }, saveAndOpenLibrary)
await shot('phone-library', { width: 412, height: 860 }, async (p) => {
  await p.getByRole('button', { name: 'Show or hide the controls' }).click()
  await saveAndOpenLibrary(p)
})
await shot('phone-library-item', { width: 412, height: 860 }, async (p) => {
  await p.getByRole('button', { name: 'Show or hide the controls' }).click()
  await saveAndOpenLibrary(p)
  await p.locator('.lib-card').nth(1).click()
})
await shot('phone-library-reopened', { width: 412, height: 860 }, async (p) => {
  await p.getByRole('button', { name: 'Show or hide the controls' }).click()
  await saveAndOpenLibrary(p)
  await p.locator('.lib-card').nth(1).click()
  await click('Open scene')(p)
})
await browser.close()
console.log(errors.length ? errors.join('\n') : 'no console errors')
