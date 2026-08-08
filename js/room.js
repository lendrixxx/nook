import { $, shade, pts, cssVar, fetchAsset, stripSvgWrapper } from './utils.js';
import { todosDueOrOverdue } from './state.js';
import { drawCharacter } from './companion.js';

/* =========================================================================
   ISOMETRIC ROOM
   A simple 2:1 grid projection. Everything (walls, floor, furniture, the
   window, and the character's walk path) is placed in "grid units" via
   iso(gx,gy,gz) and converted to the SVG's 400x380 viewBox.

   Room objects are still generated procedurally (not yet separate SVG
   files) but every color now comes from the CSS design tokens via
   roomPalette(), and iso(), TILE, ORIGIN etc. are unchanged — so this
   stays a drop-in replacement for tap-to-move, particle clipping, and
   the plant/window elements the rest of the app already updates live.
   Swapping a theme = swapping the --room-* tokens + calling initRoom()
   again; furniture position/layout is untouched by theme changes.
   ========================================================================= */
export const TILE=30, ZSTEP=26, ORIGIN_X=200, ORIGIN_Y=150, ROOM_W=6, ROOM_D=6, WALL_H=5, VB_W=400, VB_H=380;

export function iso(gx,gy,gz){ return { x: ORIGIN_X+(gx-gy)*TILE, y: ORIGIN_Y+(gx+gy)*(TILE/2)-gz*ZSTEP }; }

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
/* A rounded box in grid-space, drawn with a soft outline so furniture reads
   as chunky/hand-drawn rather than sharp-edged and technical. */
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
/* Circles/ellipses in grid-space stay smooth ellipses once projected
   (the iso transform is affine), which is what gives the rug, pots and
   mugs their soft rounded silhouette instead of diamond-hard corners. */
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

/* Structural room geometry (walls, floor, rug, window) stays procedural —
   it's load-bearing layout the app itself reasons about (tap-to-move
   bounds, particle clipping against the window, live weather-driven
   gradients) rather than replaceable art. Props on top of it are real
   asset files — see assets/room/decorations/ and loadRoomDecorations(). */
function buildRoomStructure(){
  const P = roomPalette();
  const rightWall = [iso(0,0,0), iso(ROOM_W,0,0), iso(ROOM_W,0,WALL_H), iso(0,0,WALL_H)];
  const leftWall  = [iso(0,0,0), iso(0,ROOM_D,0), iso(0,ROOM_D,WALL_H), iso(0,0,WALL_H)];
  const floor     = [iso(0,0,0), iso(ROOM_W,0,0), iso(ROOM_W,ROOM_D,0), iso(0,ROOM_D,0)];

  // Window sits high on the left wall, like the icon — a view outside
  // rather than a wall of storage, keeping the room feeling airy.
  const winY0=0.85, winY1=3.35, winZ0=1.75, winZ1=4.0;
  const windowQuad = [iso(0,winY0,winZ0), iso(0,winY1,winZ0), iso(0,winY1,winZ1), iso(0,winY0,winZ1)];
  WINDOW_VB = boundingBox(windowQuad);

  let svg = '';
  svg += '<polygon points="'+pts(rightWall)+'" fill="'+P.wallB+'"/>';
  svg += '<polygon points="'+pts(leftWall)+'" fill="'+P.wallA+'"/>';
  svg += '<polygon points="'+pts(floor)+'" fill="'+P.floor+'"/>';
  svg += '<polygon points="'+pts(floor)+'" fill="none" stroke="'+shade(P.floor,-20)+'" stroke-width="1.5" opacity="0.5"/>';

  // Soft round rug, centered under where the character spends most time
  svg += isoEllipse(3.05,2.55,0.02, 1.55,1.35, P.rug, ' stroke="'+shade(P.rug,-14)+'" stroke-width="2"');
  svg += isoEllipse(3.05,2.55,0.03, 1.05,0.9, 'none', ' stroke="'+P.rugLine+'" stroke-width="2.5" opacity="0.75"');

  svg += '<g id="roomDecorations"></g>'; // asset-driven props render here, see loadRoomDecorations()

  // Window frame + glass (the sky/night gradient is swapped live by weather)
  svg += '<polygon id="windowPane" points="'+pts(windowQuad)+'" fill="url(#windowSkyGrad)"/>';
  svg += '<polygon points="'+pts(windowQuad)+'" fill="none" stroke="'+P.outline+'" stroke-width="7" stroke-linejoin="round"/>';
  const midY=(winY0+winY1)/2, midZ=(winZ0+winZ1)/2;
  const mv0=iso(0,midY,winZ0), mv1=iso(0,midY,winZ1), mh0=iso(0,winY0,midZ), mh1=iso(0,winY1,midZ);
  svg += '<line x1="'+mv0.x+'" y1="'+mv0.y+'" x2="'+mv1.x+'" y2="'+mv1.y+'" stroke="'+P.outline+'" stroke-width="3.5" stroke-linecap="round"/>';
  svg += '<line x1="'+mh0.x+'" y1="'+mh0.y+'" x2="'+mh1.x+'" y2="'+mh1.y+'" stroke="'+P.outline+'" stroke-width="3.5" stroke-linecap="round"/>';

  return svg;
}

/* Default prop placement for the current room theme. Overwritten by
   loadTheme() if the theme file defines its own roomLayout. Each entry
   is a world grid position; the runtime places the fetched,
   position-agnostic SVG with a single translate (see
   assets/room/decorations/*.svg headers). Swapping the room later =
   editing this list or loading a different theme, not touching art or
   draw code. */
export let ROOM_LAYOUT = [
  { asset:'shelf',     at:[3.7, 0, 3.05] },
  { asset:'plant-pot', at:[4.38, 0.06, 3.14] },
  { asset:'book',      at:[3.88, 0.05, 3.14] },
  { asset:'desk',      at:[2.15, 0.55, 0] },
  { asset:'lamp',      at:[2.43, 0.69, 0.58] },
  { asset:'mug',       at:[2.95, 0.93, 0.58], scale:0.7 },
  { asset:'stool',     at:[2.70, 1.47, 0] }
];

async function loadRoomDecorations(){
  const host = $('roomDecorations');
  if(!host) return;
  const placed = await Promise.all(ROOM_LAYOUT.map(async item => {
    let svgText;
    try{ svgText = await fetchAsset('assets/room/decorations/'+item.asset+'.svg'); }
    catch(e){ return ''; } // missing asset — skip it rather than break the room
    const p = iso(item.at[0], item.at[1], item.at[2]);
    const scale = item.scale || 1;
    const rotate = item.rotate || 0;
    // pull just the inner content of the fetched <svg> so we can wrap our
    // own positioned <g>, keeping data-role attributes (e.g. plant leaves) intact
    const inner = stripSvgWrapper(svgText);
    const transform = 'translate('+p.x.toFixed(1)+','+p.y.toFixed(1)+') rotate('+rotate+') scale('+scale+')';
    return '<g class="deco" data-asset="'+item.asset+'" transform="'+transform+'">'+inner+'</g>';
  }));
  host.innerHTML = placed.join('');
  updatePlantMood(); // re-apply leaf color now that the plant asset is in the DOM
}

export async function initRoom(){
  const defs = '<defs><linearGradient id="windowSkyGrad" x1="0" y1="0" x2="0" y2="1">'
             + '<stop id="winStop0" offset="0" stop-color="#8FCBEA"/>'
             + '<stop id="winStop1" offset="1" stop-color="#FFE8B8"/>'
             + '</linearGradient></defs>';
  $('roomSvg').innerHTML = defs + buildRoomStructure();
  await loadRoomDecorations();
}

/* Theme = a JSON file of design-token overrides + a room layout, nothing
   more. The CSS :root defaults already match "Cozy Cream" so the app
   looks right even if this fetch fails (offline, first paint before the
   network settles) — this only needs to succeed to enable OTHER themes.
   Switching themes later is just: loadTheme('ocean-breeze'). */
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
  await initRoom();
  drawCharacter();
}

/* The desk plant is a small "tended room" indicator: healthy green when
   nothing's overdue, a duller olive when things are piling up. Purely
   cosmetic, updates alongside the badge whenever todos change. */
export function updatePlantMood(){
  const overdue = todosDueOrOverdue().length;
  const healthy = overdue === 0;
  const a = document.querySelector('#roomDecorations [data-asset="plant-pot"] [data-role="leaf-a"]');
  const b = document.querySelector('#roomDecorations [data-asset="plant-pot"] [data-role="leaf-b"]');
  if(a) a.setAttribute('fill', healthy ? cssVar('--room-leaf-a') : cssVar('--room-leaf-dull-a'));
  if(b) b.setAttribute('fill', healthy ? cssVar('--room-leaf-b') : cssVar('--room-leaf-dull-b'));
}
