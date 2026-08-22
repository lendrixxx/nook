import { $, fetchAsset, stripSvgWrapper } from './utils.js';
import {
  devAddXp, devSetLevel, devUnlockAllItems, devResetProgression
} from './unlocks.js';
import { initRoom } from './room.js';
import { resizeCanvas } from './particles.js';
import { drawCharacter } from './companion.js';
import { renderQuestsPanel } from './questsPanel.js';
import { renderStatsPanel } from './statsPanel.js';
import { refreshCatalog } from './furniture.js';

/* =========================================================================
   UNLOCK NOTIFICATIONS + DEV-ONLY PROGRESSION CONTROLS

   Two responsibilities live here together because they share the exact
   same "something about level/unlocks just changed, now react" logic:

   1. A global toast for real, XP-earned unlocks. Global rather than
      scoped to one page because a quest can complete (and cross an
      unlock threshold) while the person is looking at the weather page,
      not the quests or room-edit page. Shows the item's own icon (from
      the same room/decorations SVG the catalog and the room itself use)
      rather than a generic glyph, so the notification reads as "you got
      *this*" rather than just "something unlocked." Toasts are queued
      so multiple unlocks from one action (e.g. a level-up that crosses
      two thresholds at once) show one at a time instead of stomping
      each other.

   2. Dev-only testing controls (Settings sheet) — every one of them
      calls the exact same evaluateUnlocksSince() a real level-up would,
      including in the DOWNWARD direction (lower level -> relock items,
      shrink the room), so this is also the fastest way to check any of
      that actually looks right without waiting days to reach it
      legitimately or having no way to test relocking at all.
   ========================================================================= */

/* ---------------- Toast queue ---------------- */
let toastChain = Promise.resolve();
function queueToast(renderFn){
  toastChain = toastChain.then(async () => {
    await renderFn();
    await new Promise(r => setTimeout(r, 1700)); // hold before the next one can show
  });
}

function showTextToast(msg){
  queueToast(async () => {
    const toast = $('unlockToast');
    if(!toast) return;
    toast.innerHTML = '<span>'+msg+'</span>';
    toast.classList.add('show');
    await new Promise(r => setTimeout(r, 1400));
    toast.classList.remove('show');
  });
}

// unlock: one entry from ITEM_UNLOCKS/CHARACTER_UNLOCKS ({ id, label, icon }).
function showUnlockToast(unlock){
  queueToast(async () => {
    const toast = $('unlockToast');
    if(!toast) return;
    let iconHtml = '';
    try{
      const svgText = await fetchAsset(unlock.icon);
      // stripSvgWrapper removes the outer <svg> tag (it's meant to be
      // re-wrapped by the caller into whatever context it's being
      // dropped into) — same pattern furniture.js's catalog thumbnails
      // use, including re-extracting the original viewBox so the art
      // keeps its own proportions rather than being force-fit into a
      // square.
      const vb = svgText.match(/<svg[^>]*\sviewBox="([^"]+)"/);
      iconHtml = '<span class="unlock-toast-icon"><svg viewBox="'+(vb ? vb[1] : '0 0 64 64')+'">'+stripSvgWrapper(svgText)+'</svg></span>';
    } catch(e){ /* no icon asset — the toast still shows with just the label */ }
    toast.innerHTML = iconHtml + '<span>Unlocked: '+unlock.label+'</span>';
    toast.classList.add('show');
    await new Promise(r => setTimeout(r, 1400));
    toast.classList.remove('show');
  });
}

/* ---------------- Shared reaction to a level change ---------------- */
// Shared by both the real (event-driven) and dev-triggered paths so
// they can never drift apart in what "level changed" actually does.
async function handleUnlockResult(result){
  if(!result) return;
  if(result.roomSizeChanged){
    // Walls/floor/rug/window and the room's own on-screen size all
    // depend on ROOM_W/ROOM_D (see room.js) — any size change (growth
    // OR a dev-triggered shrink) needs a full rebuild, not just a
    // decorations refresh. resizeCanvas() (particles.js) has to run
    // after initRoom() completes, since it reads the freshly-rebuilt
    // window position.
    await initRoom();
    resizeCanvas();
    if(result.roomGrew){
      showTextToast(`✨ The room grew — ${result.roomGrew.cols}×${result.roomGrew.rows} now`);
    }
  }
  result.newlyUnlockedItems.forEach(showUnlockToast);
  result.newlyUnlockedCharacter.forEach(showUnlockToast);
  refreshCatalog();
  renderQuestsPanel();
  renderStatsPanel();
  drawCharacter();
}

// The real path: stats.js dispatches this the instant a log completes a
// quest that grants XP (see notifyQuestsOfLog there) — this is what a
// mounted UI reacts to, regardless of which page happens to be showing.
export function initUnlockNotifications(){
  window.addEventListener('nook:unlocks-evaluated', (e) => { handleUnlockResult(e.detail); });
}

/* ---------------- Dev-only progression controls (Settings sheet) ---------------- */
export function initDevTools(){
  $('devXpMinusBtn')?.addEventListener('click', () => handleUnlockResult(devAddXp(-10)));
  $('devXpPlusBtn')?.addEventListener('click', () => handleUnlockResult(devAddXp(10)));

  $('devSetLevelBtn')?.addEventListener('click', () => {
    const input = $('devLevelInput');
    const lvl = Number(input.value);
    if(!lvl || lvl < 1) return;
    handleUnlockResult(devSetLevel(lvl));
    input.value = '';
  });

  $('devUnlockAllBtn')?.addEventListener('click', () => {
    handleUnlockResult(devUnlockAllItems());
  });

  $('devResetProgressBtn')?.addEventListener('click', () => {
    if(!confirm('Reset all XP, quests, and unlocks? This cannot be undone.')) return;
    const result = devResetProgression();
    handleUnlockResult(result).then(() => showTextToast('Progression reset'));
  });
}
