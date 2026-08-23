// For debugging errors on mobile
window.onerror = function(msg, url, line) {
  // WebKit's share-sheet preview generation (and other cross-origin
  // contexts) sometimes trips this with zero useful detail — genuine
  // bugs in our own code always come with a real message + line number.
  if (msg === 'Script error.' && line === 0) return;
  alert("ERROR:\n" + msg + "\nLine: " + line);
};

window.addEventListener('unhandledrejection', function(e) {
  alert("PROMISE ERROR:\n" + (e.reason && e.reason.message ? e.reason.message : e.reason));
});

// Belt-and-suspenders pinch-zoom prevention: the viewport meta's
// user-scalable=no/maximum-scale=1 and the touch-action:pan-x pan-y in
// main.css cover most cases, but Safari's own WebKit-specific pinch
// events (fired regardless of touch-action) need to be caught
// separately.
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());

/* =========================================================================
   NOOK — a cozy weather companion, living in a small isometric room.
   No build step. Add to Home Screen on iPhone to use as an app.

   This file's only job is to wire up each module's event listeners (in
   roughly the same order the original single-file script did) and then
   run the boot sequence — loading saved state, kicking off the first
   weather fetch, and registering the service worker.
   ========================================================================= */

import { $ } from './utils.js';
import { state } from './state.js';
import { initCompanion, drawCharacter } from './companion.js';
import { initIcons } from './icons.js';
import { loadTheme, currentThemeId, computeTileScale } from './room.js';
import { resizeCanvas } from './particles.js';
import {
  initWeatherUI, applyInitialForecastToggleState, locate, fetchWeather, showWeatherFetchError
} from './weather.js';
import { initTodos, loadTodosAndRender, notifyDueTodos } from './todos.js';
import {
  gcal, initCalendar, loadGcalState, consumeGcalRedirectParams,
  initGcalUI, renderCalendarList, evaluateCalendarBusy,
  fetchCalendarList, fetchCalendarEvents
} from './calendar.js';
import { initMovement, resolveIdleState } from './movement.js';
import { initFurniture } from './furniture.js';
import { initUI } from './ui.js';
import { initStatsPanel, renderStatsPanel } from './statsPanel.js';
import { initQuestsPanel, renderQuestsPanel } from './questsPanel.js';
import { applyRoomSize } from './unlocks.js';
import { initDevTools, initUnlockNotifications } from './devTools.js';
import { initPinchZoom } from './pinchZoom.js';

/* ---------------- Wire up every module's buttons/inputs/gestures ---------------- */
initIcons();
initCompanion();
initWeatherUI();
initTodos();
initCalendar();
initMovement();
initFurniture();
initPinchZoom();
initUI();
// Isolated in its own try/catch: this is the newest, least battle-tested
// part of the app, and everything below it in the boot sequence (theme
// load, weather fetch, geolocation) is much more important to keep
// running than this one feature. Re-alerting (rather than swallowing
// silently) keeps this consistent with the alert-based error surfacing
// above — a bug here should still be loud and visible on a device with
// no console, just not able to take the rest of the app down with it.
try{
  initStatsPanel();
} catch(e){
  alert("STATS PANEL INIT ERROR:\n" + e.message + "\n" + (e.stack || ""));
}

// Same isolation as the stats panel above — quests/XP is layered on top
// of the stats logs and shouldn't be able to take down boot if something
// here breaks.
try{
  initQuestsPanel();
} catch(e){
  alert("QUESTS PANEL INIT ERROR:\n" + e.message + "\n" + (e.stack || ""));
}

// Same isolation again — Part 2's unlock notifications + dev tools sit
// on top of everything above and shouldn't be able to take boot down.
try{
  initUnlockNotifications();
  initDevTools();
} catch(e){
  alert("DEV TOOLS INIT ERROR:\n" + e.message + "\n" + (e.stack || ""));
}

// TODO: once todos.js's completion-rate shape is settled, wire the real
// value in here instead of the neutral default stats.js falls back to —
// something like:
//   import { setTodoCompletionRateProvider } from './stats.js';
//   setTodoCompletionRateProvider(() => todaysDoneCount / todaysTotalCount);
// Left as a stub for now so this feature doesn't block on that.

/* ---------------- Boot ---------------- */
applyInitialForecastToggleState();

// computeTileScale() has to run before ANYTHING about the room is
// built (setRoomSize/applyStageDimensions/buildRoomStructure all read
// TILE and its dependents) — it measures #stage's actual rendered
// width on this device and scales the whole grid to match, so the base
// room fills the stage edge-to-edge exactly like it did before Part 2,
// regardless of device width. #stage's width comes purely from CSS
// (100% of #app, set unconditionally, independent of any JS) so by the
// time this module runs its clientWidth already reflects its final
// layout width — only its HEIGHT is still pending (that's set by
// applyStageDimensions() a moment later, inside loadTheme()).
computeTileScale($('stage').clientWidth);

// applyRoomSize() (unlocks.js) sets ROOM_W/ROOM_D from the current XP
// level — has to run before loadTheme() builds the room SVG for the
// first time, so it renders at the right grid size from the very first
// paint. Unlike Part 2's first draft, there's no separate "evaluate and
// notify" step needed after loadTheme() anymore: unlock/room-size status
// is purely live off current level now (see unlocks.js), so there's
// nothing to catch up on at boot — only an actual XP change (a quest
// completing, or a dev tool) ever needs the evaluate/notify pipeline,
// and neither of those happens during boot itself.
applyRoomSize();
loadTheme(currentThemeId);

resizeCanvas();
loadTodosAndRender();
notifyDueTodos();
loadGcalState();
consumeGcalRedirectParams();
initGcalUI();
renderCalendarList();
evaluateCalendarBusy();
if(gcal.connected){ fetchCalendarList(); fetchCalendarEvents(); }
setInterval(evaluateCalendarBusy, 60000);
setInterval(() => { if(gcal.connected) fetchCalendarEvents(); }, 15*60000);
setInterval(() => { if(state.lat!=null) fetchWeather(state.lat, state.lon).catch(showWeatherFetchError); }, 30*60000);
// Meters decay continuously — re-render every minute so the bars visibly
// creep down even if you never touch the app, not just after a log/tap.
// drawCharacter() runs alongside it so mood (e.g. dropping out of
// 'bloated' as food digests back under the threshold) stays in sync too,
// not just right after a log button is tapped. Same isolation as the
// init call above: a bug in this feature should never be able to take
// the interval loop (or anything else) down.
//
// renderQuestsPanel() rides the same tick — it's also what catches the
// once-a-day quest reset if the app is just left open across midnight,
// since evaluateQuests() re-derives the "today" record lazily on read.
setInterval(() => {
  try{ renderStatsPanel(); drawCharacter(); }
  catch(e){ alert("STATS PANEL RENDER ERROR:\n" + e.message + "\n" + (e.stack || "")); }
  try{ renderQuestsPanel(); }
  catch(e){ alert("QUESTS PANEL RENDER ERROR:\n" + e.message + "\n" + (e.stack || "")); }
}, 60000);
resolveIdleState();
locate();

/* ---------------- Offline app shell ---------------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
