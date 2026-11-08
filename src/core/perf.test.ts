import { describe, expect, it } from 'vitest'
import { computeIntersections, normalCurves } from './analysis'
import { randomScene } from './scene'
import { solidOf } from './shapes'
import { Vector3 } from 'three'

describe('speed', () => {
  it('works out a busy four-shape scene quickly enough for a phone', () => {
    let worst = 0
    for (let seed = 1; seed <= 6; seed++) {
      const solids = randomScene(seed, { count: 4, kinds: ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'prism', 'torus'], tilt: true }).map(solidOf)
      const t0 = performance.now()
      computeIntersections(solids, 40)
      const t1 = performance.now()
      computeIntersections(solids, 14)
      const t2 = performance.now()
      normalCurves(solids, { point: new Vector3(5, 4, 6) }, 52)
      const t3 = performance.now()
      worst = Math.max(worst, t1 - t0)
      console.log(`seed ${seed}: full ${(t1 - t0).toFixed(0)} ms, live ${(t2 - t1).toFixed(0)} ms, silhouettes ${(t3 - t2).toFixed(0)} ms`)
    }
    expect(worst).toBeLessThan(1500)
  })
})
