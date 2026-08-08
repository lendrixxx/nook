import { $, shade, pts, cssVar, fetchAsset, stripSvgWrapper } from './utils.js';
import { todosDueOrOverdue } from './state.js';
import { drawCharacter } from './companion.js';
import { loadFurnitureLayout, saveFurnitureLayout } from './storage.js';

/* =========================================================================
   ISOMETRIC ROOM
   A simple 2:1 grid projection. Everything (walls, floor, furniture, the
   window, and the character's walk path) is placed in "grid units" via
   iso(gx,gy,gz) and converted to the SVG's 400x380 viewBox.

   Furniture placement is user-editable (see furniture.js). Every
   ROOM_LAYOUT item has a `role`:
     - 'surface'     — something other items can rest on (desk, shelf).
                       Carries a `surfaceTopZ` (the height children sit
                       at) and `surfaceBounds` (the placeable rectangle,
                       as {minX,maxX,minY,maxY} offsets from the
                       surface's own at[x,y]).
     - 'stackable'   — sits on top of a surface via `parentId`. Can be
                       re-parented by dragging it onto a different
                       surface's footprint.
     - 'freestanding'— sits on the floor on its own (stool), no parent,
                       nothing rests on it.
   This is what lets furniture.js guarantee a stackable can never be
   saved floating in mid-air: moving a surface moves its children with
   it, and a stackable dragged off every surface's footprint simply
   reverts instead of landing somewhere invalid.
   ========================================================================= */
export const TILE=30, ZSTEP=26, ORIGIN_X=200, ORIGIN_Y=150, ROOM_W=6, ROOM_D=6, WALL_H=5, VB_W=400, VB_H=380;
export const GRID_SNAP = 0.5; // grid-unit increment furniture snaps to while dragging

export function iso(gx,gy,gz){ return { x: ORIGIN_X+(gx-gy)*TILE, y: ORIGIN_Y+(gx+gy)*(TILE/2)-gz*ZSTEP }; }

/* Inverse of iso() for a known height plane (gz). Screen-space Y depends
   on both gx+gy AND gz, so gz has to be supplied — while dragging, we
   hold the item's own current height fixed and only solve for gx/gy.
   NOTE (known simplification): this means when a stackable is dragged
   from one surface toward a differently-tall surface (e.g. desk-height
   mug toward the higher shelf), the on-screen "aim point" is computed
   using the mug's ORIGINAL height the whole time, not the shelf's — so
   the drag can feel slightly off during the crossing, even though the
   final snap (once dropped inside the shelf's footprint) is correct.
   Recomputing against the hovered surface's height would fix this if
   it bothers you in practice. */
export function screenToIsoGrid(screenX, screenY, gz){
  const z = gz || 0;
  const adjX = screenX - ORIGIN_X;
  const adjY = screenY + z*ZSTEP - ORIGIN_Y;
  const gx = (adjX/TILE + 2*adjY/TILE) / 2;
  const gy = (2*adjY/TILE - adjX/TILE) / 2;
  return { gx, gy };
}

export function snapToGrid(v){
  return Math.round(v / GRID_SNAP) * GRID_SNAP;
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
function isoBox(gx,gy,gz,w,d,h, baseColor, outline, strokeW){
  const top   = [iso(gx,gy,gz+h), iso(gx+w,gy,gz+h), iso(gx+w,gy+d,gz+h), iso(gx,gy+d,gz+h)];
  const right = [iso(gx+w,gy,gz), iso(gx+w,gy+d,gz), iso(gx+w,gy+d,gz+h), iso(gx+w,gy,gz+h)];
  const front = [iso(gx,gy+d,gz), iso(gx+w,gy+d,gz), iso(gx+w,gy+d,gz+h), iso(gx,gy+d,gz+h)];
  const so = outline ? ' stroke="'+outline+'" stroke-width="'+(strokeW||2.5)+'" stroke-linejoin="round"' : '';
  return '<polygon points="'+pts(front)+'" fill="'+shade(baseColor,-16)+'"'+so+'/>'
       + '<polygon points="'+pts(right)+'" fill="'+shade(baseColor,-7)+'"'+so+'/>'
       + '<polygon points="'+pts(top)+'" fill="'+shade(baseColor,12)+'"'+so+'/>';
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

  const winY0=0.85, winY1=3.35, winZ0=1.75, winZ1=4.0;
  const windowQuad = [iso(0,winY0,winZ0), iso(0,winY1,winZ0), iso(0,winY1,winZ1), iso(0,winY0,winZ1)];
  WINDOW_VB = boundingBox(windowQuad);

  let svg = '';
  svg += '<polygon points="'+pts(rightWall)+'" fill="'+P.wallB+'"/>';
  svg += '<polygon points="'+pts(leftWall)+'" fill="'+P.wallA+'"/>';
  svg += '<polygon points="'+pts(floor)+'" fill="'+P.floor+'"/>';
  svg += '<polygon points="'+pts(floor)+'" fill="none" stroke="'+shade(P.floor,-20)+'" stroke-width="1.5" opacity="0.5"/>';

  svg += isoEllipse(3.05,2.55,0.02, 1.55,1.35, P.rug, ' stroke="'+shade(P.rug,-14)+'" stroke-width="2"');
  svg += isoEllipse(3.05,2.55,0.03, 1.05,0.9, 'none', ' stroke="'+P.rugLine+'" stroke-width="2.5" opacity="0.75"');

  // Floor grid guide — invisible except during edit mode (room.css)
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

  svg += '<g id="roomDecorations"></g>';

  svg += '<polygon id="windowPane" points="'+pts(windowQuad)+'" fill="url(#windowSkyGrad)"/>';
  svg += '<polygon points="'+pts(windowQuad)+'" fill="none" stroke="'+P.outline+'" stroke-width="7" stroke-linejoin="round"/>';
  const midY=(winY0+winY1)/2, midZ=(winZ0+winZ1)/2;
  const mv0=iso(0,midY,winZ0), mv1=iso(0,midY,winZ1), mh0=iso(0,winY0,midZ), mh1=iso(0,winY1,midZ);
  svg += '<line x1="'+mv0.x+'" y1="'+mv0.y+'" x2="'+mv1.x+'" y2="'+mv1.y+'" stroke="'+P.outline+'" stroke-width="3.5" stroke-linecap="round"/>';
  svg += '<line x1="'+mh0.x+'" y1="'+mh0.y+'" x2="'+mh1.x+'" y2="'+mh1.y+'" stroke="'+P.outline+'" stroke-width="3.5" stroke-linecap="round"/>';

  return svg;
}

/* Default prop placement for the current room theme. Overwritten by
   loadTheme() if the theme file defines its own roomLayout, then
   overwritten AGAIN by any saved custom layout for that theme.

   surfaceBounds are rough footprints estimated from the original static
   offsets (e.g. plant-pot sat at +0.68/+0.06 relative to the shelf) —
   tune these if they don't match your actual asset art once you see it
   dragging in practice. */
export let ROOM_LAYOUT = [
  { id:'shelf-1', asset:'shelf', at:[3.7, 0, 3.05], rotate:0,
    role:'surface', surfaceTopZ:3.14,
    surfaceBounds:{ minX:-0.05, maxX:0.85, minY:-0.05, maxY:0.15 } },
  { id:'plant-pot-1', asset:'plant-pot', at:[4.38, 0.06, 3.14], rotate:0,
    role:'stackable', parentId:'shelf-1' },
  { id:'book-1', asset:'book', at:[3.88, 0.05, 3.14], rotate:0,
    role:'stackable', parentId:'shelf-1' },
  { id:'desk-1', asset:'desk', at:[2.15, 0.55, 0], rotate:30,
    role:'surface', surfaceTopZ:0.58,
    surfaceBounds:{ minX:-0.10, maxX:1.00, minY:-0.10, maxY:0.60 } },
  { id:'lamp-1', asset:'lamp', at:[2.43, 0.69, 0.58], rotate:30,
    role:'stackable', parentId:'desk-1' },
  { id:'mug-1', asset:'mug', at:[2.95, 0.93, 0.58], rotate:30, scale:0.7,
    role:'stackable', parentId:'desk-1' },
  { id:'stool-1', asset:'stool', at:[2.70, 1.47, 0], rotate:30,
    role:'freestanding' }
];

/* The room floor itself counts as an always-available surface at
   ground level — this is what lets a stackable (lamp, mug, etc.) be
   placed directly on the floor, not just on a piece of furniture. It's
   a plain object, not a ROOM_LAYOUT entry (nothing drags "the floor"),
   so validateLayout() and findSupportingSurface() special-case its id. */
export const FLOOR_SURFACE = { id:'floor', surfaceTopZ:0 };

export function findItem(id){ return ROOM_LAYOUT.find(i => i.id === id); }
export function getSurfaces(){ return ROOM_LAYOUT.filter(i => i.role === 'surface'); }
export function getChildren(surfaceId){ return ROOM_LAYOUT.filter(i => i.parentId === surfaceId); }

/* Shared bounds clamp — used for freestanding/surface drags AND for
   children being carried along by a surface drag.

   The room is NOT symmetric: gx=0/gy=0 are backed by actual walls (an
   item's edge can safely get quite close, since the wall visually
   covers any slight overhang), while gx=ROOM_W/gy=ROOM_D are the OPEN
   front of the room — the floor just ends into the exterior background
   there, so a wide item needs a much bigger margin to avoid visually
   hanging off the edge. A single symmetric inset was fighting itself:
   loose enough to stop escape on the open side meant needlessly
   trapping items far from the walls on the other side.

   `insetNear` = margin from the wall-backed sides (gx=0, gy=0).
   `insetFar`  = margin from the open front sides (gx=ROOM_W, gy=ROOM_D). */
export function clampToRoom(gx, gy, insetNear = 0.35, insetFar = 0.35){
  return {
    gx: Math.min(Math.max(gx, insetNear), ROOM_W - insetFar),
    gy: Math.min(Math.max(gy, insetNear), ROOM_D - insetFar)
  };
}

export const DEFAULT_DRAG_INSET = 0.35;
export function getDragInsetNear(item){
  return (item && item.dragInsetNear != null) ? item.dragInsetNear : DEFAULT_DRAG_INSET;
}
export function getDragInsetFar(item){
  return (item && item.dragInsetFar != null) ? item.dragInsetFar : DEFAULT_DRAG_INSET;
}

export function isWithinSurface(surface, gx, gy){
  const b = surface.surfaceBounds;
  if(!b) return false;
  const dx = gx - surface.at[0], dy = gy - surface.at[1];
  return dx >= b.minX && dx <= b.maxX && dy >= b.minY && dy <= b.maxY;
}

/* Which surface a stackable dropped at (gx,gy) would rest on. A real
   furniture surface (desk/shelf) wins if its footprint matches;
   otherwise it always falls back to the floor, so a stackable is never
   actually "invalid" to drop anywhere within the room bounds — the
   room-bounds clamp (see furniture.js) is the only real constraint. */
export function findSupportingSurface(gx, gy){
  return getSurfaces().find(s => isWithinSurface(s, gx, gy)) || FLOOR_SURFACE;
}

/* Repositions a freestanding/surface item, OR a stackable being
   re-parented onto `newParent` (adopts newParent's surfaceTopZ so it
   doesn't float at its old height on a new surface). */
export function updateItemPosition(id, gx, gy, newParent){
  const item = findItem(id);
  if(!item) return false;
  if(item.role === 'stackable' && newParent){
    item.parentId = newParent.id;
    item.at = [gx, gy, newParent.surfaceTopZ];
  } else {
    item.at = [gx, gy, item.at[2]];
  }
  return true;
}

/* Moves a surface and carries every item resting on it along by the
   same delta — this is what guarantees a plant/book/mug can never be
   left floating after its desk or shelf gets dragged. */
export function moveSurfaceGroup(surfaceId, gx, gy){
  const surface = findItem(surfaceId);
  if(!surface) return;
  const dx = gx - surface.at[0], dy = gy - surface.at[1];
  surface.at = [gx, gy, surface.at[2]];
  const childInsetNear = 0.4, childInsetFar = 0.6; // small stackables still need more than the wall-side default for their own visible size
  getChildren(surfaceId).forEach(child => {
    const moved = clampToRoom(child.at[0]+dx, child.at[1]+dy, childInsetNear, childInsetFar);
    child.at = [moved.gx, moved.gy, child.at[2]];
  });
}

/* Defensive check run right before persisting: every stackable must
   actually sit within its declared parent's footprint. In normal use
   furniture.js's drag logic never lets an invalid position happen in
   the first place (see the revert-on-invalid-drop in onPointerUp), but
   this is the hard backstop that guarantees a broken layout is never
   the thing that gets written to storage. */
export function validateLayout(layout){
  const problems = [];
  layout.forEach(item => {
    if(item.role !== 'stackable') return;
    if(item.parentId === FLOOR_SURFACE.id) return; // resting on the floor is always valid
    const parent = layout.find(i => i.id === item.parentId);
    if(!parent){ problems.push(item.id + ' has no parent surface'); return; }
    if(!isWithinSurface(parent, item.at[0], item.at[1])){
      problems.push(item.id + ' is not resting on ' + parent.id);
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

export async function loadRoomDecorations(){
  const host = $('roomDecorations');
  if(!host) return;
  const placed = await Promise.all(ROOM_LAYOUT.map(async item => {
    let svgText;
    try{ svgText = await fetchAsset('assets/room/decorations/'+item.asset+'.svg'); }
    catch(e){ return ''; }
    const p = iso(item.at[0], item.at[1], item.at[2]);
    const scale = item.scale || 1;
    const rotate = item.rotate || 0;
    const inner = stripSvgWrapper(svgText);
    const transform = 'translate('+p.x.toFixed(1)+','+p.y.toFixed(1)+') rotate('+rotate+') scale('+scale+')';
    return '<g class="deco" data-asset="'+item.asset+'" data-id="'+item.id+'" data-gz="'+item.at[2]+'" transform="'+transform+'">'+inner+'</g>';
  }));
  host.innerHTML = placed.join('');
  updatePlantMood();
}

export async function initRoom(){
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
  if(Array.isArray(saved) && saved.length){
    ROOM_LAYOUT = saved;
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
