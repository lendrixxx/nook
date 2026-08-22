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
   mutable and grow via setRoomSize(). TILE stays fixed always — a grid
   cell is exactly TILE px both before and after a room grows, so
   furniture never changes size. What changes is the room's own natural
   pixel footprint (VB_W/VB_H below), which grows right along with it —
   the stage visibly gets bigger, up to a cap (see STAGE_MAX_HEIGHT),
   past which the extra room becomes scrollable rather than the stage
   growing indefinitely. See index.html's #stageViewport/#stageScroll
   structure and applyStageDimensions() below for how that's wired up.
   ========================================================================= */
export const TILE=30, ZSTEP=26, ORIGIN_X=200, ORIGIN_Y=150, WALL_H=5;
export const BASE_ROOM_SIZE = 6;

// Fixed pixel margins around the floor's own bounding box — tuned so
// that at the base 6×6 size, VB_MIN_X/VB_MIN_Y/VB_W/VB_H below reproduce
// exactly the original hand-built room (viewBox "0 0 400 380").
const SIDE_MARGIN = 20;
const BOTTOM_MARGIN = 50;

// The stage visibly grows with the room up to this height; beyond it,
// #stageViewport (index.html) scrolls instead of the stage growing
// further. Comfortably covers every current room-size milestone (8×8 is
// 440px) with room to spare for a couple more before scrolling actually
// kicks in for height — width is already naturally bounded by #app's
// max-width (480px in main.css), so it's the one more likely to need
// scrolling first (8×8 is 520px wide).
const STAGE_MAX_HEIGHT = 480;

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
   way buildRoomStructure() redraws walls/floor/window. If it were
   given the same growing viewBox as #roomSvg, that artwork would only
   ever fill a shrinking corner of an increasingly bigger box as the
   room grows (exactly what happened before this comment was written).
   Instead it keeps its static "0 0 400 380" viewBox (set once in
   index.html, with preserveAspectRatio="none") and simply stretches to
   fill however big #stageScroll currently is — a backdrop is fine to
   stretch slightly; grid furniture is not, which is the whole reason
   #roomSvg is handled the opposite way.

   #stage's own visible height grows with the room up to
   STAGE_MAX_HEIGHT; its WIDTH isn't set here — it's already 100% of
   #app (capped by #app's own max-width), so once the room's natural
   width exceeds that, #stageViewport's horizontal scroll takes over on
   its own with no extra math needed. */
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
    stageEl.style.height = Math.min(VB_H, STAGE_MAX_HEIGHT) + 'px';
  }
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

export let WINDOW_VB = null;

function buildRoomStructure(){
  const P = roomPalette();
  const rightWall = [iso(0,0,0), iso(ROOM_W,0,0), iso(ROOM_W,0,WALL_H), iso(0,0,WALL_H)];
  const leftWall  = [iso(0,0,0), iso(0,ROOM_D,0), iso(0,ROOM_D,WALL_H), iso(0,0,WALL_H)];
  const floor     = [iso(0,0,0), iso(ROOM_W,0,0), iso(ROOM_W,ROOM_D,0), iso(0,ROOM_D,0)];

  // winZ0/winZ1 (height) are untouched by room-size milestones — only
  // the floor footprint (ROOM_W/ROOM_D) changes, wall height (WALL_H)
  // never does. winY0/winY1 are expressed as a fraction of ROOM_D
  // (matching the original hand-tuned 6-deep numbers: 0.85/6≈0.1417,
  // 3.35/6≈0.5583) rather than fixed grid units, so the window keeps
  // the same relative position/size on the back wall as the room grows,
  // instead of shrinking toward one corner of a now-deeper wall.
  const winY0=ROOM_D*0.1417, winY1=ROOM_D*0.5583, winZ0=1.75, winZ1=4.0;
  const windowQuad = [iso(0,winY0,winZ0), iso(0,winY1,winZ0), iso(0,winY1,winZ1), iso(0,winY0,winZ1)];
  WINDOW_VB = boundingBox(windowQuad);

  let svg = '';
  svg += '<polygon points="'+pts(rightWall)+'" fill="'+P.wallB+'"/>';
  svg += '<polygon points="'+pts(leftWall)+'" fill="'+P.wallA+'"/>';
  svg += '<polygon points="'+pts(floor)+'" fill="'+P.floor+'"/>';
  svg += '<polygon points="'+pts(floor)+'" fill="none" stroke="'+shade(P.floor,-20)+'" stroke-width="1.5" opacity="0.5"/>';

  // Rug center/radii are likewise expressed as a fraction of ROOM_W/
  // ROOM_D (matching the original hand-tuned 6×6 numbers — center
  // 3.05,2.55 ≈ 0.508,0.425 of 6; outer radii 1.55,1.35 ≈ 0.258,0.225;
  // inner radii 1.05,0.9 ≈ 0.175,0.15) so it stays centered and
  // proportionally sized at any room size setRoomSize() sets, rather
  // than drifting off-center as the room grows.
  const rugCx = ROOM_W*0.508, rugCy = ROOM_D*0.425;
  svg += isoEllipse(rugCx,rugCy,0.02, ROOM_W*0.258,ROOM_D*0.225, P.rug, ' stroke="'+shade(P.rug,-14)+'" stroke-width="2"');
  svg += isoEllipse(rugCx,rugCy,0.03, ROOM_W*0.175,ROOM_D*0.15, 'none', ' stroke="'+P.rugLine+'" stroke-width="2.5" opacity="0.75"');

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

  svg += '<polygon id="windowPane" points="'+pts(windowQuad)+'" fill="url(#windowSkyGrad)"/>';
  svg += '<polygon points="'+pts(windowQuad)+'" fill="none" stroke="'+P.outline+'" stroke-width="7" stroke-linejoin="round"/>';
  const midY=(winY0+winY1)/2, midZ=(winZ0+winZ1)/2;
  const mv0=iso(0,midY,winZ0), mv1=iso(0,midY,winZ1), mh0=iso(0,winY0,midZ), mh1=iso(0,winY1,midZ);
  svg += '<line x1="'+mv0.x+'" y1="'+mv0.y+'" x2="'+mv1.x+'" y2="'+mv1.y+'" stroke="'+P.outline+'" stroke-width="3.5" stroke-linecap="round"/>';
  svg += '<line x1="'+mh0.x+'" y1="'+mh0.y+'" x2="'+mh1.x+'" y2="'+mh1.y+'" stroke="'+P.outline+'" stroke-width="3.5" stroke-linecap="round"/>';

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
    scale:1.5, snapStep:0.5, snapOffset:0, clampMargin:0.35,
    footprint:{ halfX:0.3, halfY:0.3 }
    // Anchor removed — [0,7], calculated from the legs' bottom points,
    // made the actual on-screen position measurably worse rather than
    // better. That means my read of what "anchor" means for this
    // pipeline (bottom-most point of the geometry) doesn't match how it
    // actually resolves in practice, and I don't have a way to verify
    // a replacement value without seeing the live render. Back to no
    // override (defaults to [0,0]) — the known, previously-reported
    // "somewhat off" state rather than a worse, unverified guess.
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
