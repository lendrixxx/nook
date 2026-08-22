import { $ } from './utils.js';
import { state } from './state.js';
import { iso, screenToIsoGrid, TILE, ORIGIN_X, ORIGIN_Y, VB_MIN_X, VB_MIN_Y, VB_H, ROOM_W, ROOM_D } from './room.js';
import { getCharWrapEl, isCharAsleep, setCharAsleep, drawCharacter } from './companion.js';
import { isEditMode } from './furniture.js';

const stageEl = $('stage');
const stageViewportEl = $('stageViewport');
const charWrapEl = getCharWrapEl();

/* ---------------- Character wandering (walks the open floor area) ---------------- */
/* =========================================================================
   FURNITURE REGISTRY
   The single source of truth for "where does the character go to do X."
   This is deliberately separate from buildRoom()'s actual SVG drawing —
   buildRoom() decides what furniture looks like; this decides what it
   *means* (where to stand, what activities it offers). When the room's
   art gets redesigned later, only the numbers here (and the matching
   draw calls in buildRoom) need updating — none of the interaction code
   below (goToDesk, resolveIdleState, tap-to-move, future furniture taps)
   has to change, since it all reads from this registry rather than
   hardcoded spots of its own.

   NOTE: these stand spots are independent of ROOM_LAYOUT in room.js, so
   dragging the desk/bed via furniture.js's edit mode moves the art but
   NOT where the character parks itself. Worth reconciling later if you
   want drag to fully relocate a piece of furniture's function along
   with its appearance.
   ========================================================================= */
const FURNITURE = {
  desk:  { standSpot:{ x:2.53, y:1.55 }, activities:['todo','calendar'] },
  bed:   { standSpot:{ x:0.78, y:1.55 }, activities:['sleep'] },
  plant: { standSpot:{ x:1.05, y:4.35 }, activities:['water'] } // not wired up yet — reserved for later
};
const WALK_GRID = { xMin:1.8, xMax:3.6, yMin:2.4, yMax:4.2 };
let lastGX = 2.6;
let wanderTimer = null;
let busyReason = null; // null | 'todo' | 'calendar' | 'night' — whoever "claims" the character
export function getBusyReason(){ return busyReason; }

function placeCharAt(gx, gy){
  const p = iso(gx, gy, 0);
  charWrapEl.classList.toggle('facing-left', gx < lastGX);
  charWrapEl.classList.add('walking');
  // Direct pixel positioning within #stageScroll (the character lives
  // there now, not directly in #stage — see index.html) rather than a
  // percentage of the stage's own box, since the room can be bigger
  // than the visible stage and scrollable (Part 2). VB_MIN_X/VB_MIN_Y
  // convert from iso()'s raw viewBox-space coordinate to a position
  // relative to #stageScroll's own (0,0) corner.
  charWrapEl.style.left = (p.x - VB_MIN_X) + 'px';
  charWrapEl.style.top = Math.min(p.y - VB_MIN_Y, VB_H*0.78) + 'px'; // never past the room's visible floor edge
  lastGX = gx;
}
charWrapEl.addEventListener('transitionend', (e) => {
  if(e.propertyName === 'left'){ charWrapEl.classList.remove('walking'); }
});
function wander(){
  if(busyReason) return;
  const nx = WALK_GRID.xMin + Math.random()*(WALK_GRID.xMax-WALK_GRID.xMin);
  const ny = WALK_GRID.yMin + Math.random()*(WALK_GRID.yMax-WALK_GRID.yMin);
  placeCharAt(nx, ny);
  wanderTimer = setTimeout(wander, 2800 + Math.random()*2600);
}
function stopWander(){ clearTimeout(wanderTimer); }
export function goToDesk(reason){
  busyReason = reason;
  stopWander();
  if(isCharAsleep()){ setCharAsleep(false); drawCharacter(); }
  charWrapEl.classList.remove('facing-left', 'asleep');
  placeCharAt(FURNITURE.desk.standSpot.x, FURNITURE.desk.standSpot.y);
}
/* Whatever the character should default to when nothing else has a claim
   on it — asleep in the daybed at night, wandering the floor by day. */
export function resolveIdleState(){
  if(busyReason === 'todo' || busyReason === 'calendar') return;
  const isNight = state.weather && !state.weather.isDay;
  if(isNight){
    stopWander();
    busyReason = 'night';
    charWrapEl.classList.remove('facing-left');
    placeCharAt(FURNITURE.bed.standSpot.x, FURNITURE.bed.standSpot.y);
    charWrapEl.classList.add('asleep');
    if(!isCharAsleep()){ setCharAsleep(true); drawCharacter(); }
  } else {
    if(isCharAsleep()){ setCharAsleep(false); drawCharacter(); }
    charWrapEl.classList.remove('asleep');
    busyReason = null;
    wander();
  }
}
export function leaveDesk(reason){
  if(busyReason !== reason) return;
  resolveIdleState();
}

/* ---------------- Tap to move ---------------- */
/* Uses room.js's screenToIsoGrid (the same inverse-projection now shared
   with furniture dragging) at gz=0, since the character always walks on
   the floor plane. Rejects taps that clearly landed outside the room
   (e.g. on the sky background), and clamps anything close to the edges
   so the character can never be walked into a wall or off the visible
   floor. */
function screenToGrid(clientX, clientY){
  const rect = stageViewportEl.getBoundingClientRect();
  const localX = clientX - rect.left + stageViewportEl.scrollLeft;
  const localY = clientY - rect.top + stageViewportEl.scrollTop;
  return screenToIsoGrid(VB_MIN_X + localX, VB_MIN_Y + localY, 0);
}
let tapIdleTimer = null;
function moveCharacterToTap(gx, gy){
  clearTimeout(tapIdleTimer);
  busyReason = 'tapped';
  stopWander();
  if(isCharAsleep()){ setCharAsleep(false); drawCharacter(); }
  charWrapEl.classList.remove('asleep');
  placeCharAt(gx, gy);
  // After a little while with nothing else claiming it, the character
  // goes back to living its normal life (wandering, or asleep at night).
  tapIdleTimer = setTimeout(() => {
    if(busyReason === 'tapped'){ busyReason = null; resolveIdleState(); }
  }, 8000);
}

export function initMovement(){
  stageEl.addEventListener('click', (e) => {
    if(document.querySelector('.sheet.open')) return; // don't fight with an open sheet
    if(e.target.closest('.scene-btn')) return; // the calendar/todo buttons handle their own taps
    if(isEditMode()) return; // furniture drag mode owns taps on the room right now
    const { gx, gy } = screenToGrid(e.clientX, e.clientY);
    const margin = 0.5;
    if(gx < -margin || gx > ROOM_W+margin || gy < -margin || gy > ROOM_D+margin) return; // tapped outside the room entirely
    const inset = 0.35;
    const clampedX = Math.min(Math.max(gx, inset), ROOM_W - inset);
    const clampedY = Math.min(Math.max(gy, inset), ROOM_D - inset);
    moveCharacterToTap(clampedX, clampedY);
  });
}
