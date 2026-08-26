import { $, shade, pts, cssVar, fetchAsset, stripSvgWrapper } from './utils.js';
import { todosDueOrOverdue } from './state.js';
import { drawCharacter } from './companion.js';
import { loadFurnitureLayout, saveFurnitureLayout } from './storage.js';

/* =========================================================================
   ISOMETRIC ROOM
   A simple 2:1 grid projection. Everything (walls, floor, furniture, the
   window, and the character's walk path) is placed in "grid units" via
   iso(gx,gy,gz) and converted to pixels.

   Part 2 (room-size milestones — see unlocks.js): ROOM_W/ROOM_D are
   mutable and grow via setRoomSize(). A grid cell's PIXEL size (TILE)
   stays fixed once established, so furniture never changes size as the
   room grows — but "once established" matters: before Part 2, the whole
   400×380 canvas was stretched (preserveAspectRatio="none" + CSS
   width:100%) to exactly fill whatever width the device's stage
   happened to render at, meaning a tile's actual on-screen pixel size
   always varied by device. Simply hardcoding TILE=30 broke that: on any
   device narrower or wider than exactly 400px, the base (pre-growth)
   room no longer filled the stage edge-to-edge, leaving a visible gap
   of bare background down one side.

   The fix: TILE (and everything measured in the same pixel space —
   ORIGIN_X/ORIGIN_Y/ZSTEP/SIDE_MARGIN/BOTTOM_MARGIN) is computed ONCE,
   at boot, scaled so the BASE room's natural width exactly matches the
   real measured stage width on THIS device — see computeTileScale().
   That reproduces the old edge-to-edge fit exactly. Once computed, the
   scale is never revisited (no re-scaling on resize, no re-scaling as
   the room grows) — growth past the base size only ever adds more
   (already-scaled) grid cells, which is what keeps existing furniture
   a stable size for the rest of the session, matching the original
   Part 2 design intent.
   ========================================================================= */
const BASE_TILE = 30, BASE_ZSTEP = 26, BASE_ORIGIN_X = 200, BASE_ORIGIN_Y = 150;
const BASE_SIDE_MARGIN = 20, BASE_BOTTOM_MARGIN = 50;
const BASE_NATURAL_WIDTH = 400; // the original hand-built room's width at TILE=30 — the scale reference point

export let TILE = BASE_TILE, ZSTEP = BASE_ZSTEP, ORIGIN_X = BASE_ORIGIN_X, ORIGIN_Y = BASE_ORIGIN_Y;
export const WALL_H = 5; // grid units, not a pixel length — never scales
export const BASE_ROOM_SIZE = 6;

// Fixed pixel margins around the floor's own bounding box — tuned so
// that at the base 6×6 size (and BASE_TILE), VB_MIN_X/VB_MIN_Y/VB_W/VB_H
// below reproduce exactly the original hand-built room (viewBox
// "0 0 400 380"). Scale along with everything else in computeTileScale().
let SIDE_MARGIN = BASE_SIDE_MARGIN;
let BOTTOM_MARGIN = BASE_BOTTOM_MARGIN;

let tileScaleComputed = false;
// Called once, early in boot (see app.js), before the room is ever
// built — measures the real available stage width on this device and
// scales TILE (and its dependent constants) so the base room's natural
// width matches it exactly, reproducing the old "always fills the
// stage" fit. Safe to call more than once; only the first call (the one
// that runs before anything's been drawn at the default scale) has any
// effect, so an accidental duplicate call can't rescale an already-
// visible room out from under the person.
export function computeTileScale(stageWidthPx){
  if(tileScaleComputed || !stageWidthPx) return;
  const scale = stageWidthPx / BASE_NATURAL_WIDTH;
  TILE = BASE_TILE * scale;
  ZSTEP = BASE_ZSTEP * scale;
  ORIGIN_X = BASE_ORIGIN_X * scale;
  ORIGIN_Y = BASE_ORIGIN_Y * scale;
  SIDE_MARGIN = BASE_SIDE_MARGIN * scale;
  BOTTOM_MARGIN = BASE_BOTTOM_MARGIN * scale;
  tileScaleComputed = true;
}

// The stage's visible height is capped in CSS now (main.css — a
// viewport-relative max-height), not here. A fixed pixel number
// couldn't account for how big a room might grow (a custom milestone
// well past the built-in ones, e.g. 11×11) or how tall the actual
// device viewport is — on a big room + a normal-height phone, a fixed
// cap that was comfortably in bounds for the built-in milestones could
// still end up taller than the visible screen, pushing the infocard
// below it out of view entirely. A percentage-of-viewport CSS cap
// degrades gracefully regardless of how big either number gets: the
// stage always leaves room for the infocard, and anything beyond the
// visible area simply scrolls (see #stageViewport) exactly like a
// too-wide room already does horizontally.

export let ROOM_W = BASE_ROOM_SIZE, ROOM_D = BASE_ROOM_SIZE;
export let VB_MIN_X = 0, VB_MIN_Y = 0, VB_W = 400, VB_H = 380;

export function setRoomSize(cols, rows){
  ROOM_W = cols;
  ROOM_D = rows;
  // Leftmost floor point is corner (0, ROOM_D); rightmost is (ROOM_W, 0).
  // Topmost point is always the wall-top corner at the origin (0,0,WALL_H)
  // — constant, independent of room size, which is why VB_MIN_Y is
  // always 0. Bottommost point is corner (ROOM_W, ROOM_D).
  VB_MIN_X = ORIGIN_X - ROOM_D*TILE - SIDE_MARGIN;
  VB_MIN_Y = 0;
  VB_W = (ROOM_W + ROOM_D) * TILE + SIDE_MARGIN * 2;
  VB_H = ORIGIN_Y + (ROOM_W + ROOM_D) * (TILE/2) + BOTTOM_MARGIN;
}

export const GRID_SNAP = 0.5; // grid-unit increment furniture snaps to while dragging

export function iso(gx,gy,gz){ return { x: ORIGIN_X+(gx-gy)*TILE, y: ORIGIN_Y+(gx+gy)*(TILE/2)-gz*ZSTEP }; }

export function screenToIsoGrid(screenX, screenY, gz){
  const z = gz || 0;
  const adjX = screenX - ORIGIN_X;
  const adjY = screenY + z*ZSTEP - ORIGIN_Y;
  const gx = (adjX/TILE + 2*adjY/TILE) / 2;
  const gy = (2*adjY/TILE - adjX/TILE) / 2;
  return { gx, gy };
}

export function snapToGrid(v, step = GRID_SNAP, offset = 0){
  return Math.round((v - offset) / step) * step + offset;
}

export function clampSnappedToRoom(v, step, offset, margin, roomExtent){
  const minValid = offset + Math.ceil((margin - offset) / step) * step;
  const maxValid = offset + Math.floor((roomExtent - margin - offset) / step) * step;
  return Math.min(Math.max(v, minValid), maxValid);
}

/* Resolves an asset's effective snap step/offset/clamp margin, filling
   in the same defaults furniture.js's drag logic has always used. Both
   dragging AND building a new item's spawn point (buildNewItem, below)
   go through this now, so a freshly-added item lands exactly where a
   drag would have snapped it. */
export function resolveSnapParams(def){
  const snapStep = def.snapStep || GRID_SNAP;
  const snapOffset = def.snapOffset != null ? def.snapOffset : snapStep / 2;
  const clampMargin = def.clampMargin != null ? def.clampMargin : snapStep / 2;
  return { snapStep, snapOffset, clampMargin };
}

/* ---------------- Stage sizing (Part 2) ----------------
   Applies the current room's natural pixel size to the actual DOM.

   #roomSvg keeps its existing CSS width:100%/height:100% (room.css) —
   since its containing block (#stageScroll) is now explicitly sized to
   VB_W×VB_H below, "100%" already resolves to exactly that, and because
   the viewBox attribute set here declares the SAME VB_W×VB_H, the
   SVG-to-box scale factor works out to exactly 1:1 with no stretching
   needed — that's what keeps grid cells a fixed size as the room grows.

   #bgScene is deliberately handled differently and its viewBox is
   NEVER touched here. Its content (hills/sun/moon/clouds — see
   background.js) is fixed, pre-authored artwork sized for a single
   400×380 canvas, not something that gets redrawn per room size the
   way buildRoomStructure() redraws walls/floor. If it were given the
   same growing viewBox as #roomSvg, that artwork would only ever fill
   a shrinking corner of an increasingly bigger box as the room grows
   (exactly what happened before this comment was written). Instead it
   keeps its static "0 0 400 380" viewBox (set once in index.html, with
   preserveAspectRatio="none") and simply stretches to fill however big
   #stageScroll currently is — a backdrop is fine to stretch slightly;
   grid furniture is not, which is the whole reason #roomSvg is handled
   the opposite way.

   #stage's own visible height is capped in CSS (main.css) now, relative
   to the viewport rather than a fixed pixel number — see the comment
   above the old STAGE_MAX_HEIGHT constant (removed) for why. Its WIDTH
   isn't set here either — it's already 100% of #app (capped by #app's
   own max-width), so once the room's natural width exceeds that,
   #stageViewport's horizontal scroll takes over on its own with no
   extra math needed.

   Because everything uses box-sizing:border-box (main.css), setting
   #stage's height directly to VB_H would set its BORDER-BOX height —
   its actual content area (where #stageViewport lives) would then be
   VB_H minus its own border width, consistently a few pixels short of
   the room's real natural size and cropping it by exactly that much.
   #stage's width doesn't have this problem because computeTileScale()
   above reads clientWidth (which already excludes border by
   definition) rather than writing a raw value — but height is a write,
   not a read, so it needs the same border compensation added back in
   explicitly. Measured dynamically via getComputedStyle rather than a
   hardcoded number so this can't quietly drift out of sync if the
   border width in room.css ever changes.

   Pinch-zoom (see pinchZoom.js): #stageScroll's OWN size here always
   stays the natural, unscaled VB_W×VB_H — everything inside it (the
   SVGs, the character, drop indicators, etc.) keeps working in plain
   unscaled coordinates with zero awareness of zoom, exactly like it
   has zero awareness of scrolling. Only #stageZoomSizer's size
   reflects the current zoom level; it's what #stageViewport actually
   measures for scroll bounds, while #stageScroll is visually stretched
   to fill it via a CSS transform (applyZoom, below). #stage's own
   height has to be finalized BEFORE applyZoom() runs, since it computes
   its zoom-out floor from the viewport's actual visible size (see
   computeMinZoom) — calling it any earlier would have it reading a
   stale or not-yet-set height. Re-applying the current zoom here (not
   just on an explicit pinch gesture) keeps #stageZoomSizer's size, and
   the zoom-out floor itself, correct whenever the room changes size —
   e.g. growing to a new milestone while already zoomed out. */
function applyStageDimensions(){
  const stageEl = $('stage');
  const stageScrollEl = $('stageScroll');
  const roomSvgEl = $('roomSvg');
  const viewBoxAttr = VB_MIN_X+' '+VB_MIN_Y+' '+VB_W+' '+VB_H;

  if(roomSvgEl) roomSvgEl.setAttribute('viewBox', viewBoxAttr);
  if(stageScrollEl){
    stageScrollEl.style.width = VB_W + 'px';
    stageScrollEl.style.height = VB_H + 'px';
  }
  if(stageEl){
    const cs = getComputedStyle(stageEl);
    const borderVertical = (parseFloat(cs.borderTopWidth)||0) + (parseFloat(cs.borderBottomWidth)||0);
    stageEl.style.height = (VB_H + borderVertical) + 'px'; // CSS max-height (main.css) is what actually caps this visually
  }
  applyZoom(zoomLevel);
}

const ABSOLUTE_MIN_ZOOM = 0.4, MAX_ZOOM = 2.2;
let zoomLevel = 1;

// Current zoom factor — 1 = natural size. Used by furniture.js/
// movement.js to convert between screen pixels and the room's own
// (always-unscaled) coordinate space.
export function getZoom(){ return zoomLevel; }

// The floor zoom is allowed to go to isn't a flat constant — it's
// whatever scale keeps the room fully covering the visible viewport in
// BOTH dimensions (the same math CSS background-size:cover uses).
// Without this, zooming out on a room that's already at or near
// viewport size (nothing grown yet, or not grown by much) could shrink
// it small enough to reveal #stage's own background beyond its edges —
// zooming out is only meaningful, and only ever allowed, in proportion
// to how much BIGGER than the viewport the room currently is.
// ABSOLUTE_MIN_ZOOM is just a last-resort floor for a degenerate read
// (e.g. a 0-size viewport before first layout).
function computeMinZoom(){
  const stageViewportEl = $('stageViewport');
  if(!stageViewportEl) return ABSOLUTE_MIN_ZOOM;
  const vw = stageViewportEl.clientWidth, vh = stageViewportEl.clientHeight;
  if(!vw || !vh) return ABSOLUTE_MIN_ZOOM;
  return Math.max(ABSOLUTE_MIN_ZOOM, vw / VB_W, vh / VB_H);
}

// Applies a zoom level to the DOM (clamped between the dynamic
// zoom-out floor above and MAX_ZOOM). Pure DOM application only — no
// scroll-position adjustment, since only the caller knows what point
// (if any) should stay visually anchored while zooming (see
// pinchZoom.js). Returns the actual clamped value applied, since a
// caller computing a scroll adjustment needs to know the REAL zoom that
// took effect, not the raw value it asked for.
export function applyZoom(z){
  const minZoom = computeMinZoom();
  zoomLevel = Math.min(MAX_ZOOM, Math.max(minZoom, z));
  const stageScrollEl = $('stageScroll');
  const zoomSizerEl = $('stageZoomSizer');
  if(stageScrollEl) stageScrollEl.style.transform = 'scale('+zoomLevel+')';
  if(zoomSizerEl){
    zoomSizerEl.style.width = (VB_W * zoomLevel) + 'px';
    zoomSizerEl.style.height = (VB_H * zoomLevel) + 'px';
  }
  return zoomLevel;
}

function roomPalette(){
  return {
    wallA: cssVar('--room-wall-a'), wallB: cssVar('--room-wall-b'),
    floor: cssVar('--room-floor'), floorDark: cssVar('--room-floor-dark'),
    rug: cssVar('--room-rug'), rugLine: cssVar('--room-rug-line'),
    wood: cssVar('--room-wood'), woodDark: cssVar('--room-wood-dark'),
    outline: cssVar('--room-outline'),
    lamp: cssVar('--room-lamp'), lampDark: cssVar('--room-lamp-dark'),
    mug: cssVar('--room-mug'),
    leafA: cssVar('--room-leaf-a'), leafB: cssVar('--room-leaf-b')
  };
}
function boundingBox(quad){
  const xs=quad.map(p=>p.x), ys=quad.map(p=>p.y);
  return { x:Math.min.apply(null,xs), y:Math.min.apply(null,ys), w:Math.max.apply(null,xs)-Math.min.apply(null,xs), h:Math.max.apply(null,ys)-Math.min.apply(null,ys) };
}
function isoEllipsePts(cx,cy,z,rx,ry,segments){
  const n = segments||28, out=[];
  for(let i=0;i<n;i++){
    const a = (i/n)*Math.PI*2;
    out.push(iso(cx+Math.cos(a)*rx, cy+Math.sin(a)*ry, z));
  }
  return out;
}
function isoEllipse(cx,cy,z,rx,ry,fill,extra,segments){
  return '<polygon points="'+pts(isoEllipsePts(cx,cy,z,rx,ry,segments))+'" fill="'+fill+'"'+(extra||'')+'/>';
}

// WINDOW_VB stays permanently null now that the room no longer draws a
// built-in window — kept exported (rather than removed outright) since
// particles.js imports it and already has a graceful fallback for a
// null value (rain/snow spans the whole visible room instead of being
// clipped to a window-shaped area). If a window ever comes back as a
// placeable catalog item instead, this is the hook a decoration-driven
// version of it would need to set.
export let WINDOW_VB = null;

function buildRoomStructure(){
  const P = roomPalette();
  const rightWall = [iso(0,0,0), iso(ROOM_W,0,0), iso(ROOM_W,0,WALL_H), iso(0,0,WALL_H)];
  const leftWall  = [iso(0,0,0), iso(0,ROOM_D,0), iso(0,ROOM_D,WALL_H), iso(0,0,WALL_H)];
  const floor     = [iso(0,0,0), iso(ROOM_W,0,0), iso(ROOM_W,ROOM_D,0), iso(0,ROOM_D,0)];

  let svg = '';
  svg += '<polygon points="'+pts(rightWall)+'" fill="'+P.wallB+'"/>';
  svg += '<polygon points="'+pts(leftWall)+'" fill="'+P.wallA+'"/>';
  svg += '<polygon points="'+pts(floor)+'" fill="'+P.floor+'"/>';
  svg += '<polygon points="'+pts(floor)+'" fill="none" stroke="'+shade(P.floor,-20)+'" stroke-width="1.5" opacity="0.5"/>';

  svg += '<g id="floorGrid" class="floor-grid">';
  for(let gx=0; gx<=ROOM_W; gx++){
    const a = iso(gx,0,0), b = iso(gx,ROOM_D,0);
    svg += '<line x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'" stroke="'+P.outline+'" stroke-width="1"/>';
  }
  for(let gy=0; gy<=ROOM_D; gy++){
    const a = iso(0,gy,0), b = iso(ROOM_W,gy,0);
    svg += '<line x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'" stroke="'+P.outline+'" stroke-width="1"/>';
  }
  svg += '</g>';

  svg += '<g id="floorSubGrid" class="floor-subgrid">';
  for(let gx=0.5; gx<ROOM_W; gx+=1){
    const a = iso(gx,0,0), b = iso(gx,ROOM_D,0);
    svg += '<line x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'" stroke="'+P.outline+'" stroke-width="0.75" stroke-dasharray="3 3"/>';
  }
  for(let gy=0.5; gy<ROOM_D; gy+=1){
    const a = iso(0,gy,0), b = iso(ROOM_W,gy,0);
    svg += '<line x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'" stroke="'+P.outline+'" stroke-width="0.75" stroke-dasharray="3 3"/>';
  }
  svg += '</g>';

  svg += '<g id="roomDecorations"></g>';

  return svg;
}

/* =========================================================================
   ITEM CATALOG — one entry per ASSET TYPE (not per placed item).

   `footprint` is the half-width/half-height (in grid units) of the
   asset's actual floor footprint, used for real rectangle-overlap
   collision (see isFloorSpotBlocked below).
   ========================================================================= */
export const ITEM_CATALOG = {
  desk: {
    label:'Desk', category:'furniture', role:'surface', defaultZ:0,
    surfaceTopZ:0.58, surfaceBounds:{ minX:-0.42, maxX:0.42, minY:-0.42, maxY:0.42 },
    snapStep:0.5, snapOffset:0, clampMargin:0.4, anchor:[22,30],
    footprint:{ halfX:0.42, halfY:0.42 }
  },
  shelf: {
    label:'Shelf', category:'furniture', role:'surface', defaultZ:3.05,
    surfaceTopZ:3.17, surfaceBounds:{ minX:-0.05, maxX:0.95, minY:-0.05, maxY:0.2 },
    footprint:{ halfX:0.5, halfY:0.25 }, // not currently checked — shelf is wall-mounted, see isFloorLevel()
    // Locked to the back wall (gy=0, the wall WITHOUT the window — see
    // buildRoomStructure()'s rightWall) rather than freely draggable
    // across the floor like the desk/stool. Only gx varies.
    wallLock:{ axis:'y', value:0 }
  },
  stool: {
    label:'Stool', category:'seating', role:'freestanding', defaultZ:0,
    // The floor's dashed sub-grid (buildRoomStructure's #floorSubGrid)
    // draws full LINES at every half-integer gx/gy, splitting each
    // 1-unit cell into four 0.5×0.5 visible squares — it does NOT mark
    // cell centers. That's the actual root cause of the tint bug: any
    // snap config that can land ON a half-integer is landing on one of
    // those sub-grid LINES, same as landing on an integer lands on a
    // main grid line. The true center of one of those 0.5×0.5 squares
    // is a QUARTER-integer (0.25, 0.75, 1.25, ...) — step 0.5, offset
    // 0.25 — which is exactly what resolveSnapParams() already
    // defaults to when nothing overrides it (offset = snapStep/2).
    // Two earlier attempts (0.5/0, then 1/0.5) both explicitly
    // overrode this default and both landed on a line intersection as
    // a result, just at different granularities. No override needed —
    // clampMargin is kept explicit since 0.35 (vs. the 0.25 default)
    // leaves a bit more buffer against the room edge for this
    // footprint size.
    scale:1.5, clampMargin:0.35, anchor:[0,8],
    footprint:{ halfX:0.3, halfY:0.3 }
  },
  'plant-pot': {
    label:'Plant pot', category:'plants', role:'stackable',
    scale:0.7,
    footprint:{ halfX:0.22, halfY:0.22 }
    // Same reasoning as the stool above — reverting the (0,8) guess
    // rather than risk the same kind of regression here untested.
  },
  lamp: {
    label:'Desk lamp', category:'decor', role:'stackable', anchor:[32,48], scale:0.55
  },
  mug: {
    label:'Mug', category:'decor', role:'stackable', anchor:[29,50], scale:0.4
  },
  book: {
    label:'Book', category:'decor', role:'stackable', scale:0.65,
    // The source comment claims (0,0) is already correct, but the
    // actual drawn geometry doesn't back that up: averaging the four
    // corners of the book's own bottom-face polygon — (-7.2,3.6),
    // (3.6,9.0), (10.8,5.4), (0,-0.8) — comes out to roughly (1.8,4.3),
    // not (0,0). Trying that instead of the comment's claim. Given the
    // stool result above, treat this as unconfirmed too until you've
    // actually seen it.
    anchor:[1.8,4.3]
  }
};

export const ITEM_CATEGORIES = [
  { key:'furniture', label:'Furniture' },
  { key:'seating', label:'Seating' },
  { key:'plants', label:'Plants' },
  { key:'decor', label:'Decor' },
  { key:'rugs', label:'Rugs' } // no catalog entries yet — the rug is still
                                 // hardcoded geometry in buildRoomStructure()
];

export function getItemDef(item){
  return (item && ITEM_CATALOG[item.asset]) || {};
}

export const DEFAULT_FOOTPRINT = { halfX:0.18, halfY:0.18 };
export function getFootprint(def){
  return (def && def.footprint) || DEFAULT_FOOTPRINT;
}

/* Every player starts with a bare room — no default furniture. This is
   also what "reset" now falls back to (see the settings-sheet button in
   index.html): there's no separate "theme default" layout to restore
   to anymore, so resetting and clearing are the same operation. */
export let ROOM_LAYOUT = [];

export const FLOOR_SURFACE = { id:'floor', surfaceTopZ:0 };

export function findItem(id){ return ROOM_LAYOUT.find(i => i.id === id); }
export function getSurfaces(){ return ROOM_LAYOUT.filter(i => getItemDef(i).role === 'surface'); }
export function getChildren(surfaceId){ return ROOM_LAYOUT.filter(i => i.parentId === surfaceId); }

export function clampToRoom(gx, gy, insetNear = 0.35, insetFar = 0.35){
  return {
    gx: Math.min(Math.max(gx, insetNear), ROOM_W - insetFar),
    gy: Math.min(Math.max(gy, insetNear), ROOM_D - insetFar)
  };
}

export function isWithinSurface(surface, gx, gy){
  const b = getItemDef(surface).surfaceBounds;
  if(!b) return false;
  const dx = gx - surface.at[0], dy = gy - surface.at[1];
  return dx >= b.minX && dx <= b.maxX && dy >= b.minY && dy <= b.maxY;
}

export function findSupportingSurface(gx, gy){
  const hit = getSurfaces().find(s => isWithinSurface(s, gx, gy));
  if(!hit) return FLOOR_SURFACE;
  return { id: hit.id, surfaceTopZ: getItemDef(hit).surfaceTopZ };
}

/* ---------------- floor-level collision (freestanding / surface items) ----------------
   Real axis-aligned rectangle overlap, sized to each item's own
   footprint. Scoped to floor-level items only (z ≈ 0) so a floor desk
   under the wall-mounted shelf is never wrongly treated as colliding
   with it. */
function isFloorLevel(item){
  return (item.at[2] || 0) < 0.1;
}

// Small extra buffer on top of the two items' combined footprint half-
// extents, so a position right at the mathematical boundary reads as
// blocked rather than just barely sneaking through.
const COLLISION_PADDING = 0.05;

export function isFloorSpotBlocked(movingDef, gx, gy, excludeId){
  const fp = getFootprint(movingDef);
  return ROOM_LAYOUT.some(i => {
    if(i.id === excludeId) return false;
    const otherDef = getItemDef(i);
    if(otherDef.role !== 'freestanding' && otherDef.role !== 'surface') return false;
    if(!isFloorLevel(i)) return false;
    const otherFp = getFootprint(otherDef);
    const dx = Math.abs(i.at[0] - gx);
    const dy = Math.abs(i.at[1] - gy);
    return dx < (fp.halfX + otherFp.halfX + COLLISION_PADDING) && dy < (fp.halfY + otherFp.halfY + COLLISION_PADDING);
  });
}

export function updateItemPosition(id, gx, gy, newParent){
  const item = findItem(id);
  if(!item) return false;
  const def = getItemDef(item);
  if(def.role === 'stackable' && newParent){
    item.parentId = newParent.id;
    item.at = [gx, gy, newParent.surfaceTopZ];
  } else {
    item.at = [gx, gy, item.at[2]];
  }
  return true;
}

export function moveSurfaceGroup(surfaceId, gx, gy){
  const surface = findItem(surfaceId);
  if(!surface) return;
  const dx = gx - surface.at[0], dy = gy - surface.at[1];
  surface.at = [gx, gy, surface.at[2]];
  getChildren(surfaceId).forEach(child => {
    child.at = [child.at[0]+dx, child.at[1]+dy, child.at[2]];
  });
}

/* Defensive check run right before persisting — the hard backstop that
   guarantees a broken layout is never the thing that gets written to
   storage, regardless of what the drag/drop UI already prevented.

   Deliberately does NOT check "is this item within ROOM_W/ROOM_D" —
   dev tools can shrink the room back down (see unlocks.js), and
   existing furniture is intentionally left wherever it is rather than
   deleted or flagged as broken; it just visually sits outside the
   smaller floor until the room grows again. */
export function validateLayout(layout){
  const problems = [];
  layout.forEach(item => {
    const def = getItemDef(item);
    if(def.role === 'stackable'){
      if(item.parentId === FLOOR_SURFACE.id) return; // resting on the floor is always valid
      const parent = layout.find(i => i.id === item.parentId);
      if(!parent){ problems.push(item.id + ' has no parent surface'); return; }
      if(!isWithinSurface(parent, item.at[0], item.at[1])){
        problems.push(item.id + ' is not resting on ' + parent.id);
      }
      return;
    }
    if((def.role === 'freestanding' || def.role === 'surface') && isFloorSpotBlocked(def, item.at[0], item.at[1], item.id)){
      problems.push(item.id + ' is overlapping another item');
    }
  });
  return { valid: problems.length === 0, problems };
}

export function setRoomLayout(newLayout){
  ROOM_LAYOUT = newLayout;
}

export function persistRoomLayout(){
  saveFurnitureLayout(currentThemeId, ROOM_LAYOUT);
}

/* ---------------- catalog operations: build (preview) / commit / remove / rotate ----------------
   Adding an item is now two-phase: buildNewItem() only computes a
   candidate object (id, asset, spawn position) — it does NOT touch
   ROOM_LAYOUT. The candidate is rendered as a temporary "ghost" by
   furniture.js and behaves exactly like any other armed item (drag to
   reposition, confirm to place). Only commitNewItem() actually inserts
   it into ROOM_LAYOUT, and that only happens if the person taps the
   confirm checkmark. If they cancel instead, there's nothing to clean
   up — the candidate was never real to begin with. (An earlier version
   inserted immediately on add, which meant canceling could leave a
   newly-added item permanently overlapping something else, since
   "cancel" only reset the UI's armed state, not the underlying data.) */
const SPAWN_BASE = { gx: 1.1, gy: 5.0 };
const SPAWN_RADIUS = 0.5;
const SPAWN_POSITIONS = 8;
let spawnIndex = 0;

/* For assets that only make sense mounted to a specific wall (the
   shelf) rather than freely draggable across the whole floor like the
   desk/stool. Pins one axis to a fixed value; the other stays free.
   Applied both at spawn time (below) and continuously during drag (see
   furniture.js's resolveClamped()). */
export function applyWallLock(def, gx, gy){
  if(!def.wallLock) return { gx, gy };
  const { axis, value } = def.wallLock;
  return axis === 'y' ? { gx, gy: value } : { gx: value, gy };
}

function nextSpawnPoint(def){
  const angle = (spawnIndex % SPAWN_POSITIONS) / SPAWN_POSITIONS * Math.PI * 2;
  spawnIndex++;
  const rawGx = SPAWN_BASE.gx + Math.cos(angle) * SPAWN_RADIUS;
  const rawGy = SPAWN_BASE.gy + Math.sin(angle) * SPAWN_RADIUS;
  const { snapStep, snapOffset, clampMargin } = resolveSnapParams(def);
  const gx = clampSnappedToRoom(snapToGrid(rawGx, snapStep, snapOffset), snapStep, snapOffset, clampMargin, ROOM_W);
  const gy = clampSnappedToRoom(snapToGrid(rawGy, snapStep, snapOffset), snapStep, snapOffset, clampMargin, ROOM_D);
  return applyWallLock(def, gx, gy);
}

export function buildNewItem(assetKey){
  const def = ITEM_CATALOG[assetKey];
  if(!def) return null;
  const id = assetKey + '-' + crypto.randomUUID();
  const { gx, gy } = nextSpawnPoint(def);
  return def.role === 'stackable'
    ? { id, asset:assetKey, at:[gx, gy, FLOOR_SURFACE.surfaceTopZ], rotate:0, parentId:FLOOR_SURFACE.id }
    : { id, asset:assetKey, at:[gx, gy, def.defaultZ || 0], rotate:0 };
}

export function commitNewItem(item){
  ROOM_LAYOUT = [...ROOM_LAYOUT, item];
}

export function removeItem(id){
  const item = findItem(id);
  if(!item) return false;
  if(getItemDef(item).role === 'surface'){
    getChildren(id).forEach(child => {
      child.parentId = FLOOR_SURFACE.id;
      child.at = [child.at[0], child.at[1], FLOOR_SURFACE.surfaceTopZ];
    });
  }
  ROOM_LAYOUT = ROOM_LAYOUT.filter(i => i.id !== id);
  return true;
}

export function rotateItem(id, deltaDeg = 90){
  const item = findItem(id);
  if(!item) return;
  item.rotate = ((item.rotate || 0) + deltaDeg + 360) % 360;
}

export function countPlaced(assetKey){
  return ROOM_LAYOUT.filter(i => i.asset === assetKey).length;
}

/* ---------------- rendering ---------------- */

export async function loadRoomDecorations(){
  const host = $('roomDecorations');
  if(!host) return;
  const placed = await Promise.all(ROOM_LAYOUT.map(async item => {
    const def = getItemDef(item);
    let svgText;
    try{ svgText = await fetchAsset('assets/room/decorations/'+item.asset+'.svg'); }
    catch(e){ return ''; }
    const p = iso(item.at[0], item.at[1], item.at[2]);
    const scale = def.scale || 1;
    const rotate = item.rotate || 0;
    const inner = stripSvgWrapper(svgText);
    const anchor = def.anchor || [0, 0];
    const transform = 'translate('+p.x.toFixed(1)+','+p.y.toFixed(1)+') rotate('+rotate+') scale('+scale+') translate('+(-anchor[0]).toFixed(1)+','+(-anchor[1]).toFixed(1)+')';
    return '<g class="deco" data-asset="'+item.asset+'" data-id="'+item.id+'" data-gz="'+item.at[2]+'" transform="'+transform+'">'+inner+'</g>';
  }));
  host.innerHTML = placed.join('');
  updatePlantMood();
}

export async function initRoom(){
  applyStageDimensions();

  const defs = '<defs><linearGradient id="windowSkyGrad" x1="0" y1="0" x2="0" y2="1">'
             + '<stop id="winStop0" offset="0" stop-color="#8FCBEA"/>'
             + '<stop id="winStop1" offset="1" stop-color="#FFE8B8"/>'
             + '</linearGradient></defs>';
  $('roomSvg').innerHTML = defs + buildRoomStructure();
  await loadRoomDecorations();
}

export let currentThemeId = 'cozy-cream';
export async function loadTheme(themeId){
  try{
    const res = await fetch('assets/room/themes/'+themeId+'.json');
    const theme = await res.json();
    Object.entries(theme.tokens || {}).forEach(([k,v]) => {
      document.documentElement.style.setProperty(k, v);
    });
    if(Array.isArray(theme.roomLayout)) ROOM_LAYOUT = theme.roomLayout;
    currentThemeId = themeId;
  } catch(e){
    console.warn('Theme "'+themeId+'" failed to load; using built-in defaults.', e);
  }

  const saved = loadFurnitureLayout(currentThemeId);
  if(Array.isArray(saved)){
    ROOM_LAYOUT = saved; // includes an explicitly-saved EMPTY layout, not just a non-empty one
  }

  await initRoom();
  drawCharacter();
}

export function updatePlantMood(){
  const overdue = todosDueOrOverdue().length;
  const healthy = overdue === 0;
  const a = document.querySelector('#roomDecorations [data-asset="plant-pot"] [data-role="leaf-a"]');
  const b = document.querySelector('#roomDecorations [data-asset="plant-pot"] [data-role="leaf-b"]');
  if(a) a.setAttribute('fill', healthy ? cssVar('--room-leaf-a') : cssVar('--room-leaf-dull-a'));
  if(b) b.setAttribute('fill', healthy ? cssVar('--room-leaf-b') : cssVar('--room-leaf-dull-b'));
}
