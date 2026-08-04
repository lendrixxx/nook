# Nook asset system

Nook is an **asset-driven app**: `index.html` loads, positions, and animates
SVG files — it does not draw art. If you want different art (a new
companion, a new theme, new furniture), you generally don't need to touch
JavaScript at all. This doc is the spec you can hand to another AI model
(or a human illustrator) to produce assets that drop straight in.

```
assets/
  companions/
    cat/            8 pose SVGs (see "Companion states" below)
    bunny/          same 8 states
    bear/           same 8 states
    _accessories/   sunglasses.svg, umbrella.svg, scarf-hat.svg
  room/
    decorations/    desk.svg, lamp.svg, mug.svg, shelf.svg,
                     plant-pot.svg, book.svg, stool.svg
    themes/         cozy-cream.json (design tokens + room layout)
  icons/            UI glyphs (gear, calendar, notebook, ...)
    weather/        7 forecast condition icons
  weather/          reserved for future atmospheric layers (rain/snow/
                     lightning sprites) — not yet populated
  animations/       reserved for future animation timing/definitions —
                     not yet populated
```

## How JS uses these (the loader contract)

- `drawCharacter()` fetches `assets/companions/<species>/<state>.svg`
  (+ an accessory overlay if the weather calls for one), caches the text,
  and drops it into the companion's wrapper element.
- `loadRoomDecorations()` fetches each file listed in `ROOM_LAYOUT` (or a
  theme's `roomLayout`) and positions it with a single CSS-space
  translate computed from its grid coordinate.
- `loadTheme(id)` fetches `assets/room/themes/<id>.json` and applies its
  `tokens` as CSS custom properties, and its `roomLayout` as the active
  furniture placement.

JS's job is: **load, position, animate, react** — not draw. See the
`ASSETS.md` header comment in each generated file for the exact
convention it follows.

---

## Companion assets

**File:** `assets/companions/<species>/<state>.svg`

**Format:**
- `viewBox="-100 -150 200 240"`, rendered at 66×82px
- Head: circle at `(0, -34)`, radius `50`
- Body: ellipse at `(0, 52)`, rx `30`, ry `36`
- **Never hardcode colors.** Every fill/stroke that should be
  recolorable uses one of these CSS custom properties, which the app
  sets on the companion's wrapper element (not on the SVG itself):
  `var(--body)`, `var(--belly)`, `var(--cheek)`, `var(--accent)`,
  `var(--earfill)`, `var(--ink)` (outline color)
- Legs, if present, should carry `class="leg leg-left"` / `class="leg
  leg-right"` — the app's CSS applies a walking swing animation to
  these classes automatically, regardless of which state file is
  loaded.

**Companion states (all 8 required per species):**

| file | when it's used |
|---|---|
| `idle.svg` | neutral/default mood |
| `happy.svg` | sunny or partly-cloudy weather |
| `sad.svg` | rainy/thunder weather, or 3+ overdue to-dos |
| `cozy.svg` | snowy weather |
| `asleep.svg` | user puts the companion to sleep |
| `celebrate.svg` | briefly shown when a to-do is completed |
| `walk_1.svg` / `walk_2.svg` | reserved for a future sprite-swap walk cycle (currently the CSS leg-swing animation handles walking on top of whichever state is loaded, so these aren't required for walking to work — but keep them for future use) |

**Species currently defined:** `cat` (pointy ears, whiskers, straight
tail), `bunny` (long ears, fluffy tail, no whiskers), `bear` (round
ears, no tail, no whiskers). Adding a fourth species is just adding a
fourth folder with the same 8 filenames — no JS changes needed. Update
the `<select id="cSpecies">` options in `index.html` if you want it
selectable in the "New character" sheet.

### Prompt template for another AI model

> Generate an SVG asset for the Nook app's companion character.
>
> - `viewBox="-100 -150 200 240"`, output as a standalone `<svg
>   xmlns="http://www.w3.org/2000/svg" viewBox="-100 -150 200 240"
>   width="66" height="82">...</svg>`
> - Species: **{cat / bunny / bear / your new species}**
> - Pose/state: **{idle / happy / sad / cozy / asleep / celebrate /
>   walk_1 / walk_2}**
> - Style: big round head (circle, center `(0,-34)`, radius `50`)
>   sitting on a small rounded body (ellipse, center `(0,52)`, rx `30`
>   ry `36`) — matching Animal Crossing / Tsuki Odyssey style: rounded
>   shapes, thick consistent outlines, no gradients, no texture, no
>   emoji.
> - Do NOT hardcode fill colors. Use `var(--body)` for the main fur/skin
>   color, `var(--belly)` for the lighter belly patch, `var(--cheek)`
>   for cheek blush and nose, `var(--accent)`/`var(--earfill)` for
>   ear/tail accents, and `var(--ink)` for all outlines.
> - Legs (if visible) need `class="leg leg-left"` and `class="leg
>   leg-right"` so the app's built-in walk animation can target them.
> - Keep the silhouette readable at 66×82px — avoid fine detail that
>   disappears at that size.
> - [attach the app icon and/or an existing state file like
>   `assets/companions/cat/idle.svg` as a style reference]

Drop the result at `assets/companions/<species>/<state>.svg`. No code
changes needed — the loader picks it up automatically.

---

## Accessory overlays

**File:** `assets/companions/_accessories/<name>.svg`

Same viewBox/coordinate convention as companion assets, composited on
top of whichever base pose is currently loaded. Anchor points already
in use: eye line sits at `y = -38` (sunglasses), umbrella canopy is
centered around `(50, -74)`, hat/scarf sit at the head rim (`y ≈ -84`)
and neck seam (`y ≈ 16`). Currently wired to weather: `sunglasses.svg`
(sunny), `umbrella.svg` (rainy/thunder), `scarf-hat.svg` (snowy) — see
`accessoryFor()` in `index.html` to add more triggers.

---

## Room decoration assets

**File:** `assets/room/decorations/<name>.svg`

These are **position-agnostic**: each is authored once at local grid
origin `(0,0,0)` using the same 2:1 isometric projection as the room,
just without the global screen offset. Because that projection is
affine, a piece's shape never depends on where it sits — only its
on-screen offset does. The runtime places each one with a single
translate computed from a world grid coordinate (see `ROOM_LAYOUT` in
`index.html` or a theme's `roomLayout`).

- Colors must use the room design tokens (`var(--room-wood)`,
  `var(--room-wood-hi)`, `var(--room-wood-lo)`, `var(--room-mug)`, etc.
  — see `:root` in `index.html` for the full list), never hardcoded hex.
  Box-style pieces use three shades per surface — `-hi` (top face),
  base (side face), `-lo` (front face) — as separate tokens rather than
  a runtime color function, so shading works reliably on every
  browser/WebKit version. (`color-mix()` was tried first and dropped:
  it silently produced solid-black fills in older WebKit renderers used
  to test this, which is exactly the kind of failure you can't see until
  it's already shipped.)
- If a piece needs a live-updated part (like the plant's leaves, which
  the app recolors based on to-do load), mark that element with a
  `data-role="..."` attribute — don't rely on `id`, since decorations
  could in principle be placed more than once.
- Walls, floor, the rug base, and the window frame are **not** asset
  files — they stay procedurally drawn in `index.html` because the app
  reasons about them directly (tap-to-move bounds, particle clipping
  against the window, live weather-driven window gradient). Everything
  that sits ON TOP of that structure is a swappable asset.

### Prompt template for another AI model

> Generate an SVG asset for a piece of furniture/decoration in the Nook
> app's isometric room.
>
> - Item: **{desk / lamp / mug / shelf / plant-pot / book / stool / a
>   new item}**
> - Author it as if placed at local grid origin `(0,0,0)` — do not
>   offset it to any particular position in the room, the app positions
>   it.
> - If it's a true 3D box shape, use an isometric 2:1 projection: the
>   grid-to-screen transform is `x = (gx-gy)*30`, `y = (gx+gy)*15 -
>   gz*26`. Draw three faces (top/right/front) per box; top should be
>   the lightest shade, front the darkest.
> - If it's a small prop (like a mug or lamp) drawn flatter/more
>   iconographic, that's fine — screen-space "sprite" art is used for
>   several existing pieces (see `mug.svg`, `lamp.svg`) rather than true
>   3D extrusion.
> - Colors: use the existing room design tokens (see `:root` in
>   `index.html`) — do not hardcode hex. Use `var(--room-outline)` for
>   all outline strokes (thick, ~2–2.5px, rounded joins).
> - Tight viewBox around just this object (no fixed canvas size needed
>   — the app crops to content).
> - [attach `assets/room/decorations/desk.svg` as a style/technique
>   reference]

Drop the result at `assets/room/decorations/<name>.svg`, then add an
entry to `ROOM_LAYOUT` (or a theme's `roomLayout`) in the shape
`{ "asset": "<name>", "at": [gx, gy, gz] }` to place it. Reasonable
room bounds: `gx`/`gy` roughly `0–6`, `gz` (height) roughly `0–5`.

---

## Themes

**File:** `assets/room/themes/<id>.json`

```json
{
  "id": "ocean-breeze",
  "name": "Ocean Breeze",
  "tokens": { "--room-wall-a": "#...", "--room-wood": "#...", ... },
  "roomLayout": [ { "asset": "desk", "at": [1.85, 0.55, 0] }, ... ]
}
```

`tokens` can include any subset of the CSS custom properties defined in
`index.html`'s `:root` — `--cream`/`--ink`/`--sage`/`--clay` (general
UI), `--room-*` (room/furniture), `--char-*` (default companion
palette, if you want a theme to nudge the default character's colors
too). Anything you omit falls back to the current value. `roomLayout`
is optional — omit it to keep the current furniture arrangement and
only change colors.

Call `loadTheme('ocean-breeze')` to switch. `cozy-cream.json` is the
only theme shipped today; it mirrors the built-in CSS defaults so the
app looks correct even if the fetch fails offline.

---

## Icons

**Files:** `assets/icons/*.svg`, `assets/icons/weather/*.svg`

Plain 24×24 viewBox line icons (`fill="none" stroke="currentColor"`) or
filled icons (elements marked `class="filled"`). These are the source
files; `index.html` currently still ships its own inline `<symbol>`
sprite for instant, flicker-free first paint (icons are UI chrome, not
content — an empty gear icon for one network round-trip is a worse
trade than the architectural purity of fetching them). If you regenerate
an icon, update both this file and the matching `<symbol id="icon-...">`
block in `index.html`'s sprite.

---

## What's NOT asset-driven yet

Being upfront about the boundary so nobody's surprised:

- **Walls, floor, rug outline, window frame** — procedural (see "Room
  decoration assets" above for why).
- **Weather particles** (rain/snow droplets, lightning flash) — still a
  JS canvas particle system, not SVG assets. `assets/weather/` is
  reserved for this but not yet populated.
- **Animation timing/easing** — still CSS keyframes and inline JS,
  not data files. `assets/animations/` is reserved but not yet
  populated.
