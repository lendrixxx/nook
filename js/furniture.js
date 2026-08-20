import { $, fetchAsset, stripSvgWrapper, pts } from './utils.js';
import { clearFurnitureLayout } from './storage.js';
import {
  iso, screenToIsoGrid, snapToGrid, clampSnappedToRoom, ROOM_LAYOUT, VB_W, VB_H,
  ROOM_W, ROOM_D, resolveSnapParams, getFootprint, applyWallLock, currentRoomScale,
  currentThemeId, findItem, getChildren, findSupportingSurface, getItemDef,
  isFloorSpotBlocked, updateItemPosition, moveSurfaceGroup, validateLayout,
  setRoomLayout, persistRoomLayout, loadRoomDecorations,
  buildNewItem, commitNewItem, removeItem, rotateItem, countPlaced,
  ITEM_CATALOG, ITEM_CATEGORIES
} from './room.js';
import { isItemUnlocked, getUnlockLevel } from './unlocks.js';

/* =========================================================================
   FURNITURE — "edit room" mode.

   Tap #editRoomBtn to enter: the weather card is swapped out for a
   room-edit panel with an item catalog, and the room becomes tappable.

   Tapping a PLACED item opens a small Rotate / Move / Delete menu.
   Choosing "Move" arms it — or tapping "+" in the catalog arms a brand
   new, not-yet-real "ghost" item (see below). Once something is armed:

     - it goes translucent, and stays that way for as long as it's armed
       (and its children too, if it's a surface — everything resting on
       a desk should look like it's moving together, not just the desk)
     - a solid colored shape is drawn on the floor under it: green if
       the current spot is legal, red if not
     - a SWIPE ANYWHERE in the room moves it now — the touch doesn't
       have to start exactly on the (possibly small, translucent) item
       itself
     - releasing only PREVIEWS a position. A confirm (✓) and cancel (✕)
       button pair appears, well clear of the item so neither is easy
       to hit by accident. Confirm is blocked while the preview spot is
       invalid; cancel discards the preview and reverts.

   For a GHOST item (added via the catalog, never yet confirmed), it
   doesn't exist in ROOM_LAYOUT at all until confirmed — canceling it
   just removes the temporary preview, with nothing left behind. This
   matters: an earlier version inserted a new item into the real layout
   immediately on add, so canceling only reset the UI's "armed" state
   and left the (possibly overlapping) item permanently in the data.

   Part 2: catalog entries not yet unlocked (see unlocks.js) render
   greyed out with the level they unlock at, and have no "+" button —
   they're visible (so there's something to look forward to) but not
   addable. Nothing about placing/moving/deleting an *already-placed*
   item changes; unlocking only gates adding new ones from the catalog.
   ========================================================================= */

const stageEl = $('stage');
const roomSvgEl = $('roomSvg');
const appEl = $('app');

let editMode = false;
let savedSnapshot = null;
let dragging = null;
let activeCatalogCat = 'furniture';
let selectedItemId = null;
let armedMoveId = null;      // the one item, if any, currently armed for Move
let pendingPlacement = null; // { gx, gy, gz, parent, valid } — the armed item's unconfirmed preview
let pendingNewItem = null;   // the full candidate object while armed item is a not-yet-real ghost; else null

export function isEditMode(){ return editMode; }

function cloneLayout(layout){
  return layout.map(item => ({ ...item, at: [...item.at] }));
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

/* Unified accessor: the armed item's data, whether it's a real
   ROOM_LAYOUT entry or a not-yet-committed ghost candidate. */
function armedItemSnapshot(){
  return pendingNewItem || (armedMoveId ? findItem(armedMoveId) : null);
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

/* ---------------- drop validity ----------------
   Used for both the live indicator color AND the confirm-button gate. */
function computeDropValidity(id, def, gx, gy){
  if(def.role === 'stackable'){
    const surface = findSupportingSurface(gx, gy);
    if(surface.id === 'floor'){
      // Not landing on any real surface's clickable top — but the
      // floor spot itself can still be physically occupied by a desk's
      // legs or a stool sitting there. This used to be skipped
      // entirely (any floor spot was assumed free for a stackable),
      // which is how a lamp/mug/book could end up resting at floor
      // level directly under/inside a desk's footprint.
      const blocked = isFloorSpotBlocked(def, gx, gy, id);
      return { valid: !blocked, parent: blocked ? null : surface };
    }
    const step = 0.5, offset = 0.25; // fine enough to catch exact-cell duplicates
    const occupied = getChildren(surface.id).some(sib => {
      if(sib.id === id) return false;
      const sibGx = snapToGrid(sib.at[0], step, offset);
      const sibGy = snapToGrid(sib.at[1], step, offset);
      return Math.abs(sibGx - snapToGrid(gx, step, offset)) < 0.01 && Math.abs(sibGy - snapToGrid(gy, step, offset)) < 0.01;
    });
    return { valid: !occupied, parent: occupied ? null : surface };
  }
  return { valid: !isFloorSpotBlocked(def, gx, gy, id), parent: null };
}

/* ---------------- rotate/move/delete popup (existing items only) ---------------- */
function positionPopup(itemId){
  const item = findItem(itemId);
  const popupEl = $('itemPopup');
  if(!item || !popupEl) return;
  const p = iso(item.at[0], item.at[1], item.at[2]);
  const stageRect = stageEl.getBoundingClientRect();
  popupEl.style.left = ((p.x / VB_W) * stageRect.width) + 'px';
  popupEl.style.top = (((p.y / VB_H) * stageRect.height) + 16) + 'px';
}
function openPopup(itemId){
  positionPopup(itemId);
  $('itemPopup')?.classList.add('visible');
}
function closeItemPopup(){
  $('itemPopup')?.classList.remove('visible');
}

/* ---------------- confirm / cancel placement controls ----------------
   Positioned well above the item (not just barely clear of it) and
   split into two separate buttons on either side of that point, so
   neither is easy to hit by accident while trying to grab or inspect
   the item itself. Clamped so they can't render above the visible
   stage near the top edge. */
function positionPlacementControls(){
  if(!pendingPlacement) return;
  const p = iso(pendingPlacement.gx, pendingPlacement.gy, pendingPlacement.gz);
  const stageRect = stageEl.getBoundingClientRect();
  const baseLeft = (p.x / VB_W) * stageRect.width;
  const baseTop = Math.max(28, ((p.y / VB_H) * stageRect.height) - 76);
  const confirmBtn = $('itemConfirmBtn');
  const cancelBtn = $('itemCancelBtn');
  if(confirmBtn){ confirmBtn.style.left = (baseLeft + 30) + 'px'; confirmBtn.style.top = baseTop + 'px'; }
  if(cancelBtn){ cancelBtn.style.left = (baseLeft - 30) + 'px'; cancelBtn.style.top = baseTop + 'px'; }
}
function updateConfirmButtonState(){
  $('itemConfirmBtn')?.classList.toggle('blocked', !(pendingPlacement && pendingPlacement.valid));
}
function showPlacementControls(){
  positionPlacementControls();
  updateConfirmButtonState();
  $('itemConfirmBtn')?.classList.add('visible');
  $('itemCancelBtn')?.classList.add('visible');
}
function hidePlacementControls(){
  $('itemConfirmBtn')?.classList.remove('visible');
  $('itemCancelBtn')?.classList.remove('visible');
}

/* ---------------- drop indicator (guaranteed-visible floor tint) ---------------- */
function ensureDropIndicator(){
  let el = document.getElementById('dropIndicatorShape');
  if(!el){
    el = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    el.setAttribute('id', 'dropIndicatorShape');
    el.setAttribute('class', 'drop-indicator');
    roomSvgEl.appendChild(el);
  }
  return el;
}
function footprintQuad(gx, gy, gz, halfX, halfY){
  const z = (gz || 0) + 0.015;
  return [
    iso(gx-halfX, gy-halfY, z),
    iso(gx+halfX, gy-halfY, z),
    iso(gx+halfX, gy+halfY, z),
    iso(gx-halfX, gy+halfY, z)
  ];
}
function updateDropIndicator(){
  if(!pendingPlacement) return;
  const item = armedItemSnapshot();
  const def = item ? getItemDef(item) : {};
  const fp = getFootprint(def);
  const el = ensureDropIndicator();
  const quad = footprintQuad(pendingPlacement.gx, pendingPlacement.gy, pendingPlacement.gz, fp.halfX, fp.halfY);
  el.setAttribute('points', pts(quad));
  const color = pendingPlacement.valid ? 'rgba(92,122,92,' : 'rgba(193,81,45,';
  el.setAttribute('fill', color + '0.42)');
  el.setAttribute('stroke', color + '0.9)');
  el.classList.add('visible');
}
function hideDropIndicator(){
  document.getElementById('dropIndicatorShape')?.classList.remove('visible');
}

/* ---------------- ghost item (unconfirmed new item preview) ---------------- */
async function renderGhostItem(item){
  const def = getItemDef(item);
  let svgText;
  try{ svgText = await fetchAsset('assets/room/decorations/'+item.asset+'.svg'); }
  catch(e){ return; }
  const p = iso(item.at[0], item.at[1], item.at[2]);
  // Matches loadRoomDecorations()'s own scale math (room.js) — without
  // the room-size multiplier here, a ghost preview would render at a
  // different size than the real item does the instant it's confirmed.
  const scale = (def.scale || 1) * currentRoomScale();
  const anchor = def.anchor || [0, 0];
  const transform = 'translate('+p.x.toFixed(1)+','+p.y.toFixed(1)+') rotate(0) scale('+scale+') translate('+(-anchor[0]).toFixed(1)+','+(-anchor[1]).toFixed(1)+')';
  let el = document.getElementById('ghostDeco');
  if(!el){
    el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    el.setAttribute('id', 'ghostDeco');
    el.setAttribute('class', 'deco');
    roomSvgEl.appendChild(el); // sibling of #roomDecorations, survives its re-renders
  }
  el.dataset.id = item.id;
  el.dataset.asset = item.asset;
  el.innerHTML = stripSvgWrapper(svgText);
  el.setAttribute('transform', transform);
}
function removeGhostItem(){
  document.getElementById('ghostDeco')?.remove();
}

/* ---------------- selection / arm / highlight state ---------------- */
function armedGroupIds(){
  if(!armedMoveId) return [];
  const item = armedItemSnapshot();
  if(item && getItemDef(item).role === 'surface'){
    return [armedMoveId, ...getChildren(armedMoveId).map(c => c.id)];
  }
  return [armedMoveId];
}
function reapplyEditHighlights(){
  const armedIds = armedGroupIds();
  roomSvgEl.querySelectorAll('.deco').forEach(el => {
    const id = el.dataset.id;
    const isArmed = armedIds.includes(id);
    el.classList.toggle('item-armed', isArmed);
    el.classList.toggle('item-selected', id === selectedItemId && !isArmed);
  });
}

function cancelPendingMove(){
  if(!armedMoveId){ reapplyEditHighlights(); return; }
  const wasGhost = !!pendingNewItem;
  armedMoveId = null;
  pendingPlacement = null;
  pendingNewItem = null;
  hidePlacementControls();
  hideDropIndicator();
  clearEditStatus();
  if(wasGhost){
    removeGhostItem();
    reapplyEditHighlights();
  } else {
    loadRoomDecorations().then(reapplyEditHighlights);
  }
}

function selectItem(id){
  cancelPendingMove();
  selectedItemId = id;
  openPopup(id);
}

/* Arms an EXISTING (already-real) item for repositioning. */
function armMove(id){
  if(armedMoveId && armedMoveId !== id) cancelPendingMove();
  armedMoveId = id;
  pendingNewItem = null;
  selectedItemId = id;
  closeItemPopup();
  clearEditStatus();

  const item = findItem(id);
  if(!item){ armedMoveId = null; return; }
  const def = getItemDef(item);
  const { valid } = computeDropValidity(id, def, item.at[0], item.at[1]);
  const parent = def.role === 'stackable' ? { id:item.parentId, surfaceTopZ:item.at[2] } : null;
  pendingPlacement = { gx:item.at[0], gy:item.at[1], gz:item.at[2], parent, valid };

  reapplyEditHighlights();
  updateDropIndicator();
  showPlacementControls();
}

/* Arms a brand-new candidate item that doesn't exist in ROOM_LAYOUT yet. */
function armNewItem(candidate){
  cancelPendingMove();
  armedMoveId = candidate.id;
  pendingNewItem = candidate;
  selectedItemId = candidate.id;
  clearEditStatus();

  const def = getItemDef(candidate);
  const { valid } = computeDropValidity(candidate.id, def, candidate.at[0], candidate.at[1]);
  const parent = def.role === 'stackable' ? { id:candidate.parentId, surfaceTopZ:candidate.at[2] } : null;
  pendingPlacement = { gx:candidate.at[0], gy:candidate.at[1], gz:candidate.at[2], parent, valid };

  renderGhostItem(candidate).then(() => {
    reapplyEditHighlights();
    updateDropIndicator();
    showPlacementControls();
  });
}

function deselectAll(){
  selectedItemId = null;
  closeItemPopup();
  cancelPendingMove();
}

function confirmPlacement(){
  if(!armedMoveId || !pendingPlacement) return;
  if(!pendingPlacement.valid){
    showEditStatus("Can't place it there — drag it to a clear, aligned spot first.");
    return;
  }
  if(pendingNewItem){
    const finalItem = {
      ...pendingNewItem,
      at: [pendingPlacement.gx, pendingPlacement.gy, pendingPlacement.gz],
      parentId: pendingPlacement.parent ? pendingPlacement.parent.id : pendingNewItem.parentId
    };
    commitNewItem(finalItem);
    removeGhostItem();
    pendingNewItem = null;
  } else {
    const item = findItem(armedMoveId);
    const role = item ? getItemDef(item).role : null;
    if(role === 'surface'){
      moveSurfaceGroup(armedMoveId, pendingPlacement.gx, pendingPlacement.gy);
    } else {
      updateItemPosition(armedMoveId, pendingPlacement.gx, pendingPlacement.gy, pendingPlacement.parent);
    }
  }
  clearEditStatus();
  deselectAll();
  renderCatalogList();
}

/* ---------------- catalog panel ---------------- */
const catalogThumbCache = {};
async function getCatalogThumbHTML(assetKey){
  if(catalogThumbCache[assetKey]) return catalogThumbCache[assetKey];
  try{
    const svgText = await fetchAsset('assets/room/decorations/'+assetKey+'.svg');
    const vb = svgText.match(/<svg[^>]*\sviewBox="([^"]+)"/);
    const html = '<svg viewBox="'+(vb ? vb[1] : '0 0 64 64')+'">'+stripSvgWrapper(svgText)+'</svg>';
    catalogThumbCache[assetKey] = html;
    return html;
  } catch(e){
    return '';
  }
}
function hydrateCatalogThumbs(root){
  root.querySelectorAll('.catalog-thumb').forEach(async el => {
    el.innerHTML = await getCatalogThumbHTML(el.dataset.thumb);
  });
}

function renderCatalogCategories(){
  const el = $('catalogCategories');
  if(!el) return;
  el.innerHTML = ITEM_CATEGORIES.map(c =>
    '<div class="cat-chip'+(c.key===activeCatalogCat?' active':'')+'" data-cat="'+c.key+'">'+c.label+'</div>'
  ).join('');
  el.querySelectorAll('.cat-chip').forEach(chip => {
    chip.onclick = () => { activeCatalogCat = chip.dataset.cat; renderCatalogCategories(); renderCatalogList(); };
  });
}
function renderCatalogList(){
  const el = $('catalogList');
  if(!el) return;
  const entries = Object.entries(ITEM_CATALOG).filter(([,def]) => def.category === activeCatalogCat);
  if(entries.length === 0){
    el.innerHTML = '<div class="catalog-empty">Nothing here yet.</div>';
    return;
  }
  el.innerHTML = entries.map(([key, def]) => {
    // Locked entries stay visible (so there's something to look forward
    // to) but greyed out, with the level they unlock at instead of a
    // "+" button — nothing about an already-placed instance of a since-
    // relocked item (shouldn't normally happen, since unlocks never
    // reverse — see unlocks.js) is affected by this, it only gates
    // adding NEW ones.
    if(!isItemUnlocked(key)){
      return '<div class="catalog-row locked">'
        + '<div class="catalog-thumb" data-thumb="'+key+'"></div>'
        + '<div class="catalog-name">'+def.label+'</div>'
        + '<div class="catalog-lock">🔒 Lv. '+getUnlockLevel(key)+'</div>'
        + '</div>';
    }
    const n = countPlaced(key);
    return '<div class="catalog-row">'
      + '<div class="catalog-thumb" data-thumb="'+key+'"></div>'
      + '<div class="catalog-name">'+def.label+(n>0?' <span class="catalog-count">×'+n+'</span>':'')+'</div>'
      + '<button class="catalog-add" data-key="'+key+'">+</button>'
      + '</div>';
  }).join('');
  el.querySelectorAll('.catalog-add').forEach(btn => {
    btn.onclick = () => {
      const candidate = buildNewItem(btn.dataset.key);
      if(candidate) armNewItem(candidate); // arms a not-yet-real ghost — nothing is added to the room yet
    };
  });
  hydrateCatalogThumbs(el);
}

// Public: lets other modules (devTools.js, after a dev-triggered unlock)
// refresh the visible catalog without needing to know about editMode or
// activeCatalogCat internally. A no-op if the edit panel isn't open.
export function refreshCatalog(){
  if(editMode) renderCatalogList();
}

/* ---------------- drag handlers ---------------- */

/* Once something is armed, ANY touch inside the room drags it — not
   just one that happens to land exactly on its (possibly small,
   translucent) artwork. */
function beginArmedDrag(e){
  const id = armedMoveId;
  const item = armedItemSnapshot();
  if(!item) return;
  const def = getItemDef(item);
  const { snapStep, snapOffset, clampMargin } = resolveSnapParams(def);
  const el = roomSvgEl.querySelector('[data-id="'+id+'"]');
  if(!el) return;

  const childEls = def.role === 'surface'
    ? getChildren(id).map(c => ({ id:c.id, el: roomSvgEl.querySelector('[data-id="'+c.id+'"]') })).filter(c => c.el)
    : [];

  hidePlacementControls(); // don't leave a stale button pair floating mid-drag

  dragging = {
    id, def, role: def.role, gz: item.at[2],
    snapStep, snapOffset, clampMargin,
    startGx: item.at[0], startGy: item.at[1],
    el, childEls,
    previewGx: item.at[0], previewGy: item.at[1],
    validDrop: true, resolvedParent: null,
    moved: false, startClientX: e.clientX, startClientY: e.clientY,
    armed: true
  };
  e.target.setPointerCapture?.(e.pointerId);
}

function onPointerDown(e){
  if(!editMode) return;

  if(armedMoveId){
    beginArmedDrag(e);
    e.preventDefault();
    return;
  }

  const target = e.target.closest('.deco');
  if(!target){ deselectAll(); return; }
  const id = target.dataset.id;
  if(!findItem(id)) return; // shouldn't happen (a ghost only exists while armed), but stay safe

  // Not armed: a tap here only SELECTS (opens the Rotate/Move/Delete
  // popup) — it never repositions anything directly.
  dragging = {
    id, moved:false, armed:false,
    startClientX: e.clientX, startClientY: e.clientY,
    el: target
  };
  e.preventDefault();
}

function onPointerMove(e){
  if(!dragging) return;

  const dx0 = e.clientX - dragging.startClientX, dy0 = e.clientY - dragging.startClientY;
  if(!dragging.moved && (dx0*dx0 + dy0*dy0) > 16){
    dragging.moved = true;
    if(dragging.armed) dragging.el.classList.add('dragging');
  }
  if(!dragging.armed || !dragging.moved) return; // not cleared to reposition yet

  const pt = clientToViewBox(e.clientX, e.clientY);

  function resolveClamped(gz){
    const { gx, gy } = screenToIsoGrid(pt.x, pt.y, gz);
    const step = dragging.snapStep, offset = dragging.snapOffset, margin = dragging.clampMargin;
    const snapped = {
      gx: clampSnappedToRoom(snapToGrid(gx, step, offset), step, offset, margin, ROOM_W),
      gy: clampSnappedToRoom(snapToGrid(gy, step, offset), step, offset, margin, ROOM_D)
    };
    return applyWallLock(dragging.def, snapped.gx, snapped.gy);
  }

  let clamped = resolveClamped(dragging.gz);

  if(dragging.role === 'stackable'){
    let { valid, parent } = computeDropValidity(dragging.id, dragging.def, clamped.gx, clamped.gy);
    const hoverSurface = findSupportingSurface(clamped.gx, clamped.gy);
    if(hoverSurface.surfaceTopZ !== dragging.gz){
      dragging.gz = hoverSurface.surfaceTopZ;
      clamped = resolveClamped(dragging.gz);
      ({ valid, parent } = computeDropValidity(dragging.id, dragging.def, clamped.gx, clamped.gy));
    }
    dragging.validDrop = valid;
    dragging.resolvedParent = parent;
    applyTransform(dragging.el, clamped.gx, clamped.gy, dragging.gz);
  } else if(dragging.role === 'surface'){
      const { valid } = computeDropValidity(dragging.id, dragging.def, clamped.gx, clamped.gy);
      dragging.validDrop = valid;
      const dx = clamped.gx - dragging.startGx, dy = clamped.gy - dragging.startGy;
      applyTransform(dragging.el, clamped.gx, clamped.gy, dragging.gz);
      dragging.childEls.forEach(({ id: cid, el: cel }) => {
        const child = findItem(cid);
        applyTransform(cel, child.at[0]+dx, child.at[1]+dy, child.at[2]);
      });
  } else {
    const { valid } = computeDropValidity(dragging.id, dragging.def, clamped.gx, clamped.gy);
    dragging.validDrop = valid;
    applyTransform(dragging.el, clamped.gx, clamped.gy, dragging.gz);
  }

  pendingPlacement = { gx: clamped.gx, gy: clamped.gy, gz: dragging.gz, parent: dragging.resolvedParent, valid: dragging.validDrop };
  updateDropIndicator();

  dragging.previewGx = clamped.gx;
  dragging.previewGy = clamped.gy;
}

function onPointerUp(){
  if(!dragging) return;
  const { id, moved, armed } = dragging;
  dragging.el.classList.remove('dragging');

  if(!armed){
    dragging = null;
    selectItem(id);
    if(moved) showEditStatus('Choose "Move" from the menu, then drag to reposition.');
    return;
  }

  dragging = null;
  if(moved){
    if(pendingPlacement && !pendingPlacement.valid){
      showEditStatus("That spot's taken — drag it somewhere clear, then tap the check.");
    } else {
      clearEditStatus();
    }
  }
  showPlacementControls();
}

/* ---------------- edit / save / cancel / reset ---------------- */
function enterEditMode(){
  savedSnapshot = cloneLayout(ROOM_LAYOUT);
  editMode = true;
  stageEl.classList.add('room-edit-mode');
  appEl.classList.add('room-editing');
  clearEditStatus();
  deselectAll();
  renderCatalogCategories();
  renderCatalogList();
}

function saveAndExit(){
  const { valid, problems } = validateLayout(ROOM_LAYOUT);
  if(!valid){
    const extra = problems.length > 1 ? ' (+' + (problems.length-1) + ' more)' : '';
    showEditStatus("Can't save — " + problems[0] + extra + '.');
    return;
  }
  persistRoomLayout();
  savedSnapshot = cloneLayout(ROOM_LAYOUT);
  editMode = false;
  stageEl.classList.remove('room-edit-mode');
  appEl.classList.remove('room-editing');
  clearEditStatus();
  deselectAll();
}

function revertToSnapshot(){
  if(!savedSnapshot) return;
  deselectAll();
  setRoomLayout(cloneLayout(savedSnapshot));
  clearEditStatus();
  loadRoomDecorations().then(reapplyEditHighlights);
  renderCatalogList();
}

function cancelEdit(){
  revertToSnapshot();
  editMode = false;
  stageEl.classList.remove('room-edit-mode');
  appEl.classList.remove('room-editing');
}

export function initFurniture(){
  roomSvgEl.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  $('editRoomBtn')?.addEventListener('click', () => { if(!editMode) enterEditMode(); });
  $('reditResetBtn')?.addEventListener('click', revertToSnapshot);
  $('reditCancelBtn')?.addEventListener('click', cancelEdit);
  $('reditSaveBtn')?.addEventListener('click', saveAndExit);

  $('itemConfirmBtn')?.addEventListener('click', confirmPlacement);
  $('itemCancelBtn')?.addEventListener('click', cancelPendingMove);

  $('itemPopupRotate')?.addEventListener('click', () => {
    if(!selectedItemId) return;
    rotateItem(selectedItemId);
    loadRoomDecorations().then(() => { reapplyEditHighlights(); positionPopup(selectedItemId); });
  });
  $('itemPopupMove')?.addEventListener('click', () => {
    if(!selectedItemId) return;
    armMove(selectedItemId);
  });
  $('itemPopupDelete')?.addEventListener('click', () => {
    if(!selectedItemId) return;
    removeItem(selectedItemId);
    deselectAll();
    loadRoomDecorations();
    renderCatalogList();
  });

  $('resetRoomLayoutBtn')?.addEventListener('click', () => {
    if(!confirm('Clear everything from this room? This removes all placed furniture.')) return;
    clearFurnitureLayout(currentThemeId);
    location.reload();
  });
}
