import { $ } from './utils.js';
import { getStats, logFood, logWater, logWorkout, getGoals, setGoals } from './stats.js';
import { drawCharacter } from './companion.js';

/* ---------------- Swipeable "now"+forecast <-> stats page ----------------
   Two pages live inside #infocardTrack (see index.html): page 0 is
   .weather-now (temp/place/condition) + the forecast, page 1 is this
   stats panel. The dots always work; drag-to-swipe is suppressed while
   page 0 is showing AND the hourly forecast's own horizontal scroller
   is active, since two nested horizontal touch regions fighting for the
   same gesture is worse than just falling back to the dots in that one
   case. */
const PAGE_FORECAST = 0;
const PAGE_STATS = 1;
let currentPage = PAGE_FORECAST;
let pageEls = [];

function syncSwipeHeight(){
  const swipeEl = $('infocardSwipe');
  const activeEl = pageEls[currentPage];
  if(!swipeEl || !activeEl) return;
  swipeEl.style.height = activeEl.offsetHeight + 'px';
}

function goToPage(i){
  currentPage = i;
  const track = $('infocardTrack');
  if(track) track.style.transform = 'translateX(-' + (i * 50) + '%)';
  document.querySelectorAll('.infocard-dot').forEach((dot, di) => {
    dot.classList.toggle('active', di === i);
  });
  syncSwipeHeight();
}

function initSwipe(){
  const swipeEl = $('infocardSwipe');
  const track = $('infocardTrack');
  if(!swipeEl || !track) return;

  pageEls = Array.from(document.querySelectorAll('.infocard-page'));

  document.querySelectorAll('.infocard-dot').forEach(dot => {
    dot.onclick = () => goToPage(Number(dot.dataset.page));
  });

  // Both pages sit side-by-side in the track at all times (only
  // translateX moves between them), so the inactive page's content can
  // change size — e.g. the forecast row loading in, or the overfull
  // flag appearing on the stats page — without ever being the active
  // page. ResizeObserver catches that and keeps .infocard-swipe's
  // height matched to whichever page is actually showing, instead of
  // the height only updating on the next manual page switch.
  if('ResizeObserver' in window){
    const ro = new ResizeObserver(() => syncSwipeHeight());
    pageEls.forEach(p => ro.observe(p));
  }
  syncSwipeHeight();

  // Live drag tracking — same shape as enableSwipeToClose in ui.js:
  // transition off while dragging so the track follows the finger 1:1,
  // then either commit to the other page or snap back, with the
  // transition restored so that settling move is animated either way.
  let startX = null;
  let dragDX = 0;
  let dragging = false;

  swipeEl.addEventListener('touchstart', (e) => {
    const forecastEl = $('forecastRow');
    if(currentPage === PAGE_FORECAST && forecastEl && forecastEl.classList.contains('hourly-mode')){
      startX = null; // let the hourly row's own scroller have the gesture
      return;
    }
    startX = e.touches[0].clientX;
    dragging = true;
    track.style.transition = 'none';
  }, { passive:true });

  swipeEl.addEventListener('touchmove', (e) => {
    if(!dragging || startX === null) return;
    dragDX = e.touches[0].clientX - startX;
    // No rubber-banding past either end of the track.
    if(currentPage === PAGE_FORECAST && dragDX > 0) dragDX = 0;
    if(currentPage === PAGE_STATS && dragDX < 0) dragDX = 0;
    const basePercent = currentPage * -50;
    const dragPercent = (dragDX / (swipeEl.offsetWidth || 1)) * 50;
    track.style.transform = 'translateX(' + (basePercent + dragPercent) + '%)';
  }, { passive:true });

  swipeEl.addEventListener('touchend', () => {
    if(!dragging){ startX = null; return; }
    dragging = false;
    track.style.transition = '';
    const dx = dragDX;
    startX = null;
    dragDX = 0;
    if(dx < -40 && currentPage === PAGE_FORECAST) goToPage(PAGE_STATS);
    else if(dx > 40 && currentPage === PAGE_STATS) goToPage(PAGE_FORECAST);
    else goToPage(currentPage); // didn't clear the threshold — snap back
  });
}

/* ---------------- Meter rendering ---------------- */
function renderMeter(key, value, overfull){
  const fill = $('stat' + key + 'Fill');
  const pct = $('stat' + key + 'Pct');
  if(fill){
    fill.style.width = Math.min(value, 100) + '%';
    fill.classList.toggle('overfull', !!overfull);
  }
  if(pct) pct.textContent = Math.round(value) + '%';
}

export function renderStatsPanel(){
  const stats = getStats();

  renderMeter('Food', stats.food, stats.overfull);
  renderMeter('Water', stats.water, false);
  renderMeter('Energy', stats.energy, false);
  renderMeter('Happy', stats.happiness, false);

  const moodEl = $('statsMood');
  if(moodEl) moodEl.textContent = stats.mood;

  // Toggling display on the pre-rendered span (rather than rebuilding
  // it via innerHTML each call) means the <img> inside it is only ever
  // created once — rebuilding it on every log tap was destroying and
  // recreating that element each time, and tapping fast enough could
  // catch it mid-recreation while the image was still decoding, making
  // it flicker/disappear.
  const flagInner = $('statFoodFlagInner');
  if(flagInner) flagInner.style.display = stats.overfull ? '' : 'none';
}

/* ---------------- Quick-log buttons ---------------- */
function initQuickActions(){
  const foodBtn = $('logFoodBtn');
  const waterBtn = $('logWaterBtn');
  const workoutBtn = $('logWorkoutBtn');
  // drawCharacter() runs alongside renderStatsPanel() here rather than
  // only from the periodic refresh in app.js, so mood (e.g. tipping
  // into 'bloated') updates the moment you log, not up to a minute
  // later on the next interval tick.
  if(foodBtn) foodBtn.onclick = () => { logFood(); renderStatsPanel(); drawCharacter(); };
  if(waterBtn) waterBtn.onclick = () => { logWater(); renderStatsPanel(); drawCharacter(); };
  if(workoutBtn) workoutBtn.onclick = () => { logWorkout(); renderStatsPanel(); drawCharacter(); };
}

/* ---------------- Companion goals (Settings sheet) ---------------- */
function initGoalsForm(){
  const foodInput = $('goalFood');
  const waterInput = $('goalWater');
  const workoutInput = $('goalWorkout');
  const saveBtn = $('saveGoalsBtn');
  if(!foodInput || !waterInput || !workoutInput || !saveBtn) return;

  const goals = getGoals();
  foodInput.value = goals.foodTarget;
  waterInput.value = goals.waterTarget;
  workoutInput.value = goals.workoutMinutesTarget;

  saveBtn.onclick = () => {
    const current = getGoals();
    setGoals({
      foodTarget: Math.max(1, Number(foodInput.value) || current.foodTarget),
      waterTarget: Math.max(1, Number(waterInput.value) || current.waterTarget),
      workoutMinutesTarget: Math.max(5, Number(workoutInput.value) || current.workoutMinutesTarget)
    });
    renderStatsPanel();
  };
}

/* ---------------- Boot ---------------- */
export function initStatsPanel(){
  initSwipe();
  initQuickActions();
  initGoalsForm();
  renderStatsPanel();
}
