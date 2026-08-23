import { $ } from './utils.js';
import { getZoom, applyZoom } from './room.js';
import { isEditMode } from './furniture.js';

/* =========================================================================
   PINCH-TO-ZOOM

   A standard two-finger pinch on #stageViewport: track the distance
   between the two touches, and scale zoom proportionally to how that
   distance changes frame to frame. The pinch's midpoint (in screen
   space) is kept visually anchored under the fingers as zoom changes,
   by adjusting scroll position by exactly the same factor the content
   just grew/shrank by — the same trick any native pinch-zoom viewer
   uses, so the room doesn't appear to "slide" out from under a pinch
   that's centered off to one side.

   Deliberately scoped to when furniture edit mode is OFF. Edit mode
   already owns single-touch gestures on the exact same element for
   dragging/arming furniture (see furniture.js); teaching that system to
   also cleanly coexist with an in-progress two-finger pinch (aborting a
   drag the instant a second finger lands, resuming correctly if it
   lifts, etc.) is a lot of additional surface area for a feature whose
   main use case — getting a better look at a big, grown room — is
   already well served by normal browsing. Worth revisiting if editing
   a large room while zoomed out turns out to matter in practice.

   The zoom level itself lives in room.js (getZoom/applyZoom), not here
   — this module only detects the gesture and drives that state; DOM
   application (the #stageScroll transform, #stageZoomSizer's size) is
   entirely room.js's responsibility, same division as scrolling.
   ========================================================================= */

const stageViewportEl = $('stageViewport');

let pinch = null; // { startDist, startZoom } while exactly two touches are down

function touchDistance(t1, t2){
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

function onTouchStart(e){
  if(isEditMode() || e.touches.length !== 2) return;
  pinch = { startDist: touchDistance(e.touches[0], e.touches[1]), startZoom: getZoom() };
}

function onTouchMove(e){
  if(!pinch || e.touches.length !== 2) return;
  // Stop this from also being interpreted as a native pan/scroll —
  // once a pinch is underway it should exclusively drive zoom.
  e.preventDefault();

  const rect = stageViewportEl.getBoundingClientRect();
  const t0 = e.touches[0], t1 = e.touches[1];
  const midX = (t0.clientX + t1.clientX) / 2;
  const midY = (t0.clientY + t1.clientY) / 2;

  // The point under the pinch midpoint, in the scrollable content's own
  // (pre-this-frame) coordinate space — what we want to keep visually
  // fixed under the fingers as zoom changes.
  const contentX = stageViewportEl.scrollLeft + (midX - rect.left);
  const contentY = stageViewportEl.scrollTop + (midY - rect.top);
  const oldZoom = getZoom();

  const dist = touchDistance(t0, t1);
  const targetZoom = pinch.startZoom * (dist / pinch.startDist);
  const newZoom = applyZoom(targetZoom); // clamped internally to room.js's min/max

  const scaleRatio = newZoom / oldZoom;
  stageViewportEl.scrollLeft = contentX * scaleRatio - (midX - rect.left);
  stageViewportEl.scrollTop = contentY * scaleRatio - (midY - rect.top);
}

function onTouchEnd(e){
  if(e.touches.length < 2) pinch = null;
}

export function initPinchZoom(){
  if(!stageViewportEl) return;
  stageViewportEl.addEventListener('touchstart', onTouchStart, { passive:true });
  stageViewportEl.addEventListener('touchmove', onTouchMove, { passive:false });
  stageViewportEl.addEventListener('touchend', onTouchEnd, { passive:true });
  stageViewportEl.addEventListener('touchcancel', onTouchEnd, { passive:true });
}
