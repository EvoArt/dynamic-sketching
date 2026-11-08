// Renders public/icon.svg into the Android launcher icons (legacy, round and adaptive).
// Usage: node scripts/make-android-icons.mjs  (after `npx cap add android`)
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8')
const PAPER = '#f3efe6'
const inner = svg.replace(/^[\s\S]*?<rect[^>]*\/>/, '').replace(/<\/svg>\s*$/, '')
// The drawing spans about x 113–447, y 143–427. Adaptive icons only promise the middle
// 66 of 108 dp, so frame it with that much margin.
const box = 556
const cx = 280
const cy = 285
const framed = (bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cx - box / 2} ${cy - box / 2} ${box} ${box}">${bg}${inner}</svg>`
const variants = {
  ic_launcher: { dp: 48, svg },
  ic_launcher_round: { dp: 48, svg: framed(`<circle cx="${cx}" cy="${cy}" r="${box / 2}" fill="${PAPER}"/>`) },
  ic_launcher_foreground: { dp: 108, svg: framed('') },
}
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

const browser = await chromium.launch()
for (const [density, k] of Object.entries(densities)) {
  for (const [name, v] of Object.entries(variants)) {
    const size = Math.round(v.dp * k)
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    await page.setContent(`<style>*{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${v.svg}`)
    await page.screenshot({ path: `android/app/src/main/res/mipmap-${density}/${name}.png`, omitBackground: true })
    await page.close()
  }
}
await browser.close()
console.log('android icons written')
