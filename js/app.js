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
import { initCompanion } from './companion.js';
import { initIcons } from './icons.js';
import { loadTheme, currentThemeId } from './room.js';
import { resizeCanvas } from './particles.js';
import {
  initWeatherUI, applyInitialForecastToggleState, locate, fetchWeather
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

/* ---------------- Wire up every module's buttons/inputs/gestures ---------------- */
initIcons();
initCompanion();
initWeatherUI();
initTodos();
initCalendar();
initMovement();
initFurniture();
initUI();
initStatsPanel();

// TODO: once todos.js's completion-rate shape is settled, wire the real
// value in here instead of the neutral default stats.js falls back to —
// something like:
//   import { setTodoCompletionRateProvider } from './stats.js';
//   setTodoCompletionRateProvider(() => todaysDoneCount / todaysTotalCount);
// Left as a stub for now so this feature doesn't block on that.

/* ---------------- Boot ---------------- */
applyInitialForecastToggleState();
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
setInterval(() => { if(state.lat!=null) fetchWeather(state.lat, state.lon); }, 30*60000);
// Meters decay continuously — re-render every minute so the bars visibly
// creep down even if you never touch the app, not just after a log/tap.
setInterval(renderStatsPanel, 60000);
resolveIdleState();
locate();

/* ---------------- Offline app shell ---------------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
