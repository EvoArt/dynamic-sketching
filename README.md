# Dynamic Sketching

**Android app:** download `dynamic-sketching.apk` from the [latest release](https://github.com/EvoArt/dynamic-sketching/releases/latest) on your phone and open it. It works offline from the first launch.
**In a browser:** https://evoart.github.io/dynamic-sketching/ (works offline once loaded; **Add to home screen** to keep it).

A drawing-practice tool for constructing 3D forms. Combine boxes, spheres, cylinders,
cones, pyramids, wedges and tori. Light them, see them in or out of perspective, and
reveal the lines you are practising:

- **Outlines and edges**, with **hidden lines** dashed through the solids (draw-through).
- **Intersections**, where two forms meet, worked out exactly rather than from the mesh.
- **Full sections**, the whole ellipse (or other conic) that a face's plane cuts from a curved
  form, even when only a corner of the box is inside. The part that isn't the real
  intersection is dashed orange.
- **Section planes**, those planar cuts filled in.
- **Draw-through guides**: axes, centre ellipses and face diagonals.
- **Core shadow line**, the edge between lit and shaded sides of curved forms.
- **Horizon** and **vanishing points**, with lines running to them (perspective only).

Each shape can be see-through, and shading can be smooth, banded tones (for value
studies), flat, or lines only.

## Practice

Press **New scene** (or `N`) for a random overlapping set of forms from a random viewpoint
with the answers hidden. Draw it, then press the reveal button (or `Space`) to show hidden
edges, then intersections, full sections and the core shadow line in turn.

The set pieces in the Practice panel are fixed scenes for particular problems, such as a
cube corner pushed into a sphere or two crossing cylinders.

## Your library

**Save** (top of the screen) keeps the scene, the exact view and a picture of it in your
library on the device. Open the library (the grid button) to look at the pictures full
size, draw from them, share or download them, rename or delete them, or **Open scene** to
carry on playing with it. A practice scene saved with its answers hidden can still have them
revealed after you open it.

**Back up library** saves everything to one file (on a phone it opens the share sheet, so
you can put it in Drive or send it to yourself). **Restore a backup** adds it back, on this
or another device.

## Offline

Once the page has loaded, the whole app is stored on the device and works with no
connection. The scene, the view and the practice round you are in are kept between
visits, so nothing is lost if the page or phone restarts. When a new version is published
you are asked before it loads, so it never reloads while you are drawing.

## Controls

| | Mouse | Touch |
|---|---|---|
| Orbit | left-drag | one finger |
| Zoom | scroll | pinch |
| Pan | right-drag | two fingers |
| Select a shape | click it | tap it |
| Move / turn / size | drag the gizmo handles; choose the mode at top left (`W` `E` `S`) | same |

Undo and redo are `Ctrl+Z` / `Ctrl+Y` or the arrows at top left. `Delete` removes the
selected shape, `Esc` deselects. Your scene and view are kept on the device between visits.
**Download picture** (under Save and share) saves the current view as a PNG without adding it to the library.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173, also on your network for a phone on the same Wi-Fi
npm test           # geometry tests
npm run shots      # screenshots of key states (with npm run dev on port 5199)
npm run offline    # checks the built app reloads offline (with vite preview on port 5198)
npm run build      # static site in dist/, installable as an app (PWA), works offline
```

To put it online, push to a GitHub repository with Pages enabled (Settings → Pages →
Source: GitHub Actions). [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds
and publishes every push to `main`. On Android, open the page in Chrome and choose
**Add to home screen** to install it like an app.

## Android app

The APK is the same site packaged with [Capacitor](https://capacitorjs.com), so everything is
inside it and nothing needs a connection. Inside the app, **Download** saves to
*Documents › Dynamic Sketching* and **Share** opens Android's share sheet.

```sh
npm run android:sync       # build the site and copy it into android/
cd android && ./gradlew assembleRelease   # needs JDK 21 and the Android SDK
```

[.github/workflows/android.yml](.github/workflows/android.yml) builds a signed APK on every push
(the `latest` pre-release) and attaches one to each published release. It signs with one fixed key
so new versions install over old ones and keep the library. The key is kept outside the
repository; CI reads it from the secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`
and `ANDROID_KEY_ALIAS`, and skips the APK when they aren't set. Launcher icons come from
`public/icon.svg` via `npm run android:icons`.

## How the lines are found

Every shape is a unit primitive placed by a matrix. Its surface is a set of patches. Each
patch has a (u, v) parametrisation, an implicit function for the untrimmed surface it lies
on (an infinite plane, cylinder or cone), and a trim function for the part it covers.

- An intersection between patches *p* and *q* is the zero set of *q*'s implicit function
  over *p*'s (u, v) square, found by marching squares with refined crossings, then clipped to
  *q*'s trim. Corners are exact on both sides.
- A full section is the same curve without the clip, wherever *q* really cuts the other shape.
- Silhouettes and core shadow lines are zero sets of *n · (eye − p)* and *n · light*.
- Hidden lines come from a depth-only pass of all solids, including see-through ones. Each
  line layer is then drawn twice, once in front of that depth and once behind it.

See [src/core/](src/core/) for the maths (no DOM, unit-tested) and [src/render/](src/render/) for drawing.
