import { $ } from './utils.js';
import {
  devAddXp, devSetLevel, devUnlockAllItems, devResetProgression,
  applyRoomSize
} from './unlocks.js';
import { initRoom } from './room.js';
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
      not the quests or room-edit page — the notification shouldn't be
      missable just because the wrong page was showing. Reuses the
      quest-toast's own CSS class (#unlockToast in index.html) rather
      than #questToast itself, so a rapid quest-completion-then-unlock
      moment can't have one toast's timeout cut the other one short.

   2. Dev-only testing controls (Settings sheet) — every one of them
      calls the exact same evaluateUnlocks() a real level-up would, so
      this is also the fastest way to check a new unlock or room-size
      milestone actually looks right before waiting days to reach it
      legitimately, rather than a separate, unverified code path.
   ========================================================================= */

function showUnlockToast(msg){
  const toast = $('unlockToast');
  if(!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showUnlockToast._t);
  showUnlockToast._t = setTimeout(() => toast.classList.remove('show'), 2400);
}

// Shared by both the real (event-driven) and dev-triggered paths so
// they can never drift apart in what "an unlock happened" actually
// does — rebuild the room if it grew, toast every new unlock, and
// refresh whatever UI might be showing stale state.
async function handleUnlockResult(result){
  if(!result) return;
  if(result.roomGrew){
    // Walls/floor/rug/window and every placed item's scale all depend
    // on ROOM_W/ROOM_D/TILE (see room.js) — a size change needs a full
    // rebuild, not just a decorations refresh.
    await initRoom();
    showUnlockToast(`✨ The room grew — ${result.roomGrew.cols}×${result.roomGrew.rows} now`);
  }
  result.newlyUnlockedItems.forEach(u => showUnlockToast(`🔓 Unlocked: ${u.label}`));
  result.newlyUnlockedCharacter.forEach(u => showUnlockToast(`🔓 Unlocked: ${u.label}`));
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
    devUnlockAllItems();
    refreshCatalog();
    showUnlockToast('🔓 All items unlocked (dev)');
  });

  $('devResetProgressBtn')?.addEventListener('click', () => {
    if(!confirm('Reset all XP, quests, and unlocks? This cannot be undone.')) return;
    devResetProgression();
    applyRoomSize();
    initRoom().then(() => {
      refreshCatalog();
      renderQuestsPanel();
      renderStatsPanel();
      drawCharacter();
      showUnlockToast('Progression reset');
    });
  });
}
