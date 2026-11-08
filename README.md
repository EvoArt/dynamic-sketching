# Dynamic Sketching

**Use it:** https://evoart.github.io/dynamic-sketching/ (on Android, open it in Chrome and choose **Add to home screen**; it then works offline).

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

## Controls

| | Mouse | Touch |
|---|---|---|
| Orbit | left-drag | one finger |
| Zoom | scroll | pinch |
| Pan | right-drag | two fingers |
| Select a shape | click it | tap it |
| Move / turn / size | drag the gizmo handles; choose the mode at top left (`W` `E` `S`) | same |

Undo and redo are `Ctrl+Z` / `Ctrl+Y` or the arrows at top left. `Delete` removes the
selected shape, `Esc` deselects. Your scene is kept on the device between visits.
**Save picture** downloads the current view as a PNG to draw from.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173, also on your network for a phone on the same Wi-Fi
npm test           # geometry tests
npm run build      # static site in dist/, installable as an app (PWA), works offline
```

To put it online, push to a GitHub repository with Pages enabled (Settings → Pages →
Source: GitHub Actions). [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds
and publishes every push to `main`. On Android, open the page in Chrome and choose
**Add to home screen** to install it like an app.

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
