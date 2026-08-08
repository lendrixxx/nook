import { $ } from './utils.js';
import { hydrateIcons } from './icons.js';
import { clearFurnitureLayout } from './storage.js';
import {
  iso, screenToIsoGrid, snapToGrid, ROOM_LAYOUT, VB_W, VB_H,
  currentThemeId, findItem, getChildren, findSupportingSurface,
  updateItemPosition, moveSurfaceGroup, validateLayout, setRoomLayout,
  persistRoomLayout, loadRoomDecorations, clampToRoom, getDragInsetNear, getDragInsetFar
} from './room.js';

/* =========================================================================
   FURNITURE — drag-to-place "edit room" mode.

   Edit/Save is a single toggle button (#editRoomBtn):
     - tap once -> enters edit mode, snapshots the current (saved) layout
     - drag things around -> all changes are LIVE in ROOM_LAYOUT but NOT
       persisted yet
     - tap again -> validates the layout; if valid, persists + exits; if
       invalid, shows why and stays in edit mode so you can fix it
   #editResetBtn (visible only while editing) reverts any in-progress
   changes back to that snapshot without leaving edit mode.

   Drag behavior by role (see room.js for the role model):
     - 'surface'    drags freely on the floor; every stackable resting on
                    it (via parentId) is carried along by the same delta,
                    live, so nothing is ever left visually floating.
     - 'stackable'  drags freely and always lands somewhere valid: if
                    released within a surface's footprint it rests on
                    (and re-parents to) that surface; otherwise it rests
                    directly on the floor. There's no "invalid" drop
                    location for a stackable anymore — see FLOOR_SURFACE
                    in room.js.
     - 'freestanding' (e.g. the stool) drags freely on the floor, no
                    parent/child concerns.
   ========================================================================= */

const stageEl = $('stage');
const roomSvgEl = $('roomSvg');

let editMode = false;
let savedSnapshot = null; // deep clone of ROOM_LAYOUT as of last save / edit-mode entry
let dragging = null;

export function isEditMode(){ return editMode; }

function cloneLayout(layout){
  return layout.map(item => ({
    ...item,
    at: [...item.at],
    surfaceBounds: item.surfaceBounds ? { ...item.surfaceBounds } : undefined
  }));
}

function clientToViewBox(clientX, clientY){
  const rect = stageEl.getBoundingClientRect();
  const px = clientX - rect.left, py = clientY - rect.top;
  return { x: px/rect.width*VB_W, y: py/rect.height*VB_H };
}

function applyTransform(el, gx, gy, gz){
  const p = iso(gx, gy, gz);
  const current = el.getAttribute('transform') || '';
  const rest = current.replace(/translate\([^)]*\)\s*/, '');
  el.setAttribute('transform', 'translate('+p.x.toFixed(1)+','+p.y.toFixed(1)+') '+rest);
}

/* ---------------- status banner (validation messages) ---------------- */
function showEditStatus(msg){
  const el = $('roomEditStatus');
  if(el){ el.textContent = msg; el.classList.add('visible'); }
}
function clearEditStatus(){
  const el = $('roomEditStatus');
  if(el){ el.textContent = ''; el.classList.remove('visible'); }
}

/* ---------------- drag handlers ---------------- */
function onPointerDown(e){
  if(!editMode) return;
  const target = e.target.closest('.deco');
  if(!target) return;
  const id = target.dataset.id;
  const item = findItem(id);
  if(!item) return;

  const childEls = item.role === 'surface'
    ? getChildren(id).map(c => ({ id:c.id, el: roomSvgEl.querySelector('[data-id="'+c.id+'"]') })).filter(c => c.el)
    : [];

  dragging = {
    id, role: item.role, gz: item.at[2],
    insetNear: getDragInsetNear(item), insetFar: getDragInsetFar(item),
    startGx: item.at[0], startGy: item.at[1],
    el: target, childEls,
    previewGx: item.at[0], previewGy: item.at[1],
    validDrop: true, resolvedParent: null
  };
  target.classList.add('dragging');
  target.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}

function onPointerMove(e){
  if(!dragging) return;
  const pt = clientToViewBox(e.clientX, e.clientY);
  const { gx, gy } = screenToIsoGrid(pt.x, pt.y, dragging.gz);
  const clamped = clampToRoom(snapToGrid(gx), snapToGrid(gy), dragging.insetNear, dragging.insetFar);

  if(dragging.role === 'stackable'){
    const surface = findSupportingSurface(clamped.gx, clamped.gy);
    dragging.validDrop = !!surface;
    dragging.resolvedParent = surface;
    dragging.el.classList.toggle('invalid-drop', !surface);
    applyTransform(dragging.el, clamped.gx, clamped.gy, dragging.gz);
  } else if(dragging.role === 'surface'){
    const dx = clamped.gx - dragging.startGx, dy = clamped.gy - dragging.startGy;
    applyTransform(dragging.el, clamped.gx, clamped.gy, dragging.gz);
    const childInsetNear = 0.4, childInsetFar = 0.6;
    dragging.childEls.forEach(({ id: cid, el: cel }) => {
      const child = findItem(cid);
      // Clamp each child independently — don't just trust the surface's
      // delta, since a child sitting far from the surface's anchor point
      // (e.g. the mug relative to the desk) can overshoot the room
      // bounds even when the surface itself is correctly clamped.
      const childClamped = clampToRoom(child.at[0]+dx, child.at[1]+dy, childInsetNear, childInsetFar);
      applyTransform(cel, childClamped.gx, childClamped.gy, child.at[2]);
    });
  } else {
    applyTransform(dragging.el, clamped.gx, clamped.gy, dragging.gz);
  }

  dragging.previewGx = clamped.gx;
  dragging.previewGy = clamped.gy;
}

function onPointerUp(){
  if(!dragging) return;
  const { id, role, previewGx, previewGy } = dragging;
  dragging.el.classList.remove('dragging', 'invalid-drop');

  if(role === 'stackable'){
    if(dragging.validDrop && dragging.resolvedParent){
      updateItemPosition(id, previewGx, previewGy, dragging.resolvedParent);
    }
    // invalid drop: ROOM_LAYOUT was never touched for this item, so the
    // re-render below simply snaps it back to its last valid position.
  } else if(role === 'surface'){
    moveSurfaceGroup(id, previewGx, previewGy);
  } else {
    updateItemPosition(id, previewGx, previewGy);
  }

  dragging = null;
  loadRoomDecorations(); // authoritative re-render from ROOM_LAYOUT
}

/* ---------------- edit / save / reset ---------------- */
function updateEditButton(){
  const btn = $('editRoomBtn');
  if(btn){
    btn.classList.toggle('active', editMode);
    btn.title = editMode ? 'Save room layout' : 'Move furniture';
    const icon = btn.querySelector('.icon');
    if(icon){
      icon.dataset.icon = editMode ? 'check' : 'move';
      hydrateIcons(btn);
    }
  }
  $('editResetBtn')?.classList.toggle('visible', editMode);
}

function enterEditMode(){
  savedSnapshot = cloneLayout(ROOM_LAYOUT);
  editMode = true;
  stageEl.classList.add('room-edit-mode');
  clearEditStatus();
  updateEditButton();
}

function trySaveAndExit(){
  const { valid, problems } = validateLayout(ROOM_LAYOUT);
  if(!valid){
    const extra = problems.length > 1 ? ' (+' + (problems.length-1) + ' more)' : '';
    showEditStatus("Can't save — " + problems[0] + extra + '. Drag it back onto a surface first.');
    return;
  }
  persistRoomLayout();
  savedSnapshot = cloneLayout(ROOM_LAYOUT);
  editMode = false;
  stageEl.classList.remove('room-edit-mode');
  clearEditStatus();
  updateEditButton();
}

function revertToSnapshot(){
  if(!savedSnapshot) return;
  setRoomLayout(cloneLayout(savedSnapshot));
  clearEditStatus();
  loadRoomDecorations();
}

export function initFurniture(){
  roomSvgEl.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  $('editRoomBtn')?.addEventListener('click', () => {
    if(editMode) trySaveAndExit();
    else enterEditMode();
  });

  $('editResetBtn')?.addEventListener('click', revertToSnapshot);

  // Separate, rarer action (lives in Settings, not the main scene UI):
  // wipes the saved custom layout entirely and falls back to the
  // current theme's built-in default arrangement.
  $('resetRoomLayoutBtn')?.addEventListener('click', () => {
    if(!confirm('Reset this room back to its default layout? This clears your saved custom layout.')) return;
    clearFurnitureLayout(currentThemeId);
    location.reload();
  });
}
