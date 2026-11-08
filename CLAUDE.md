# Dynamic Sketching

A drawing-practice app: combine basic 3D forms, light them, and reveal hidden edges,
intersection curves, full conic sections, core shadow lines and vanishing points. It's for
an adult artist practising construction drawing on desktop and on an Android phone.

## Stack

- TypeScript, Vite, three.js. No UI framework: [src/ui/controls.ts](src/ui/controls.ts) has small DOM helpers.
- PWA via vite-plugin-pwa, deployed to GitHub Pages by [.github/workflows/deploy.yml](.github/workflows/deploy.yml).
- Android APK: Capacitor 8 wraps `dist/` ([capacitor.config.ts](capacitor.config.ts), [android/](android/)); built and signed by
  [.github/workflows/android.yml](.github/workflows/android.yml). Needs JDK 21. Code that differs between web and the
  app (file saving, sharing, no service worker) lives in [src/platform.ts](src/platform.ts): the Android WebView has no
  `<a download>` or Web Share, so anything that saves or shares a file must go through it.
- Version name comes from package.json; bump it for a release.
- Vitest for `src/core`. `npm run shots` (with `npm run dev` on port 5199, or pass a URL)
  saves Playwright screenshots of key states to `shots/` at desktop and phone sizes. Look at
  them after visual changes. `npm run offline` checks the built app (via `vite preview --port 5198`)
  reloads offline with its view and library intact.
- The service worker uses prompt mode: updates wait for the user, never auto-reload mid-drawing.

## Architecture

```
src/core/     geometry and document model. Pure TypeScript: may import three's maths classes, never the DOM.
  shapes.ts     unit primitives as patches (parametrisation + implicit + trim)
  contour.ts    marching squares over a patch, crossing refinement, chaining, clipping
  analysis.ts   intersections, full sections, section fills, silhouettes, terminators
  scene.ts      Doc/Settings, presets, random practice scenes
src/render/   viewport.ts (three passes: solids, depth-only, lines visible/hidden), overlay.ts (2D horizon/VPs)
src/library.ts           saved scenes + pictures in IndexedDB, backup files
src/ui/library-view.ts   the library screen (back button closes it)
src/main.ts   app state, undo, persistence (doc, camera, practice step), recompute scheduling, panel
```

- Every shape is a unit primitive scaled by its world matrix. Only zero sets are used, so
  non-uniform scale is safe.
- Line layers are recomputed in [src/main.ts](src/main.ts) `flush()`: coarse grids while dragging, full after a
  220 ms pause. Geometry (intersections) depends on shapes. Silhouettes depend on the camera.
  Terminators depend on light.
- Adding a shape kind means adding a primitive in `shapes.ts` (patches with exact implicit
  and trim functions), a mesh in `viewport.ts` `geometryFor`, and size rules in
  `normaliseSize`/`sizeFields`/`boundingRadius`.

## Rules

- Lines must be geometrically exact (they are what is being practised). Add a test in
  `src/core/*.test.ts` against an analytic answer for any new curve type.
- Touch first: targets at least 40–44 px, nothing depends on hover or keyboard. Shortcuts are extras.
- The full intersection pass must stay well under 100 ms on desktop for four shapes
  (`perf.test.ts` prints timings), because phones are several times slower.
- British English in interface text.
