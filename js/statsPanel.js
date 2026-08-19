import { $ } from './utils.js';
import { getStats, logFood, logWater, logWorkout, getGoals, setGoals } from './stats.js';
import { drawCharacter } from './companion.js';

/* ---------------- Swipeable infocard pages ----------------
   Pages live inside #infocardTrack (see index.html) in order: page 0 is
   .weather-now (temp/place/condition) + forecast, page 1 is the
   companion stats panel, page 2 is Daily Quests. Generalized to however
   many .infocard-page elements actually exist rather than a hardcoded
   pair, so adding/removing a page never requires touching this math —
   just add/remove the markup + a matching .infocard-dot.

   Drag-to-swipe is suppressed on page 0 while the hourly forecast's own
   horizontal scroller is active, since two nested horizontal touch
   regions fighting for the same gesture is worse than just falling back
   to the dots in that one case. */
let currentPage = 0;
let pageEls = [];

function pageCount(){ return pageEls.length || 1; }
function pagePercent(){ return 100 / pageCount(); }

function syncSwipeHeight(){
  const swipeEl = $('infocardSwipe');
  const activeEl = pageEls[currentPage];
  if(!swipeEl || !activeEl) return;
  swipeEl.style.height = activeEl.offsetHeight + 'px';
}

function goToPage(i){
  currentPage = Math.max(0, Math.min(pageCount() - 1, i));
  const track = $('infocardTrack');
  if(track) track.style.transform = 'translateX(-' + (currentPage * pagePercent()) + '%)';
  document.querySelectorAll('.infocard-dot').forEach((dot, di) => {
    dot.classList.toggle('active', di === currentPage);
  });
  syncSwipeHeight();
}

function initSwipe(){
  const swipeEl = $('infocardSwipe');
  const track = $('infocardTrack');
  if(!swipeEl || !track) return;

  pageEls = Array.from(document.querySelectorAll('.infocard-page'));

  // Track/page sizing is set here rather than relied on from CSS, so
  // this stays correct no matter how many .infocard-page elements exist
  // — a track sized for N pages needs to be N*100% wide with each page
  // at 100/N% of the track.
  //
  // Setting `flex` (not just `width`) matters: the original 2-page CSS
  // almost certainly pins each .infocard-page at a fixed flex-basis
  // (e.g. "flex: 0 0 50%"), and flex-basis wins over width on a flex
  // item. Overriding width alone left every page at 150% of the
  // viewport once the track grew to 300% for 3 pages — pages overlapping
  // and the wrong one showing per dot. Setting flex-basis explicitly
  // here removes that dependency on whatever the stylesheet happens to
  // hardcode.
  track.style.display = 'flex';
  track.style.width = (pageCount() * 100) + '%';
  pageEls.forEach(p => {
    p.style.flex = '0 0 ' + pagePercent() + '%';
    p.style.width = pagePercent() + '%';
    p.style.boxSizing = 'border-box';
  });

  document.querySelectorAll('.infocard-dot').forEach(dot => {
    dot.onclick = () => goToPage(Number(dot.dataset.page));
  });

  // All pages sit side-by-side in the track at all times (only
  // translateX moves between them), so an inactive page's content can
  // change size — e.g. the forecast row loading in, the overfull flag
  // appearing, a quest completing — without ever being the active page.
  // ResizeObserver catches that and keeps .infocard-swipe's height
  // matched to whichever page is actually showing, instead of the
  // height only updating on the next manual page switch.
  if('ResizeObserver' in window){
    const ro = new ResizeObserver(() => syncSwipeHeight());
    pageEls.forEach(p => ro.observe(p));
  }
  syncSwipeHeight();

  // Live drag tracking — same shape as enableSwipeToClose in ui.js:
  // transition off while dragging so the track follows the finger 1:1,
  // then either commit to the neighboring page or snap back, with the
  // transition restored so that settling move is animated either way.
  let startX = null;
  let dragDX = 0;
  let dragging = false;

  swipeEl.addEventListener('touchstart', (e) => {
    const forecastEl = $('forecastRow');
    if(currentPage === 0 && forecastEl && forecastEl.classList.contains('hourly-mode')){
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
    if(currentPage === 0 && dragDX > 0) dragDX = 0;
    if(currentPage === pageCount() - 1 && dragDX < 0) dragDX = 0;
    const pct = pagePercent();
    const basePercent = currentPage * -pct;
    const dragPercent = (dragDX / (swipeEl.offsetWidth || 1)) * pct;
    track.style.transform = 'translateX(' + (basePercent + dragPercent) + '%)';
  }, { passive:true });

  swipeEl.addEventListener('touchend', () => {
    if(!dragging){ startX = null; return; }
    dragging = false;
    track.style.transition = '';
    const dx = dragDX;
    startX = null;
    dragDX = 0;
    // goToPage clamps at either end, so swiping past the first/last
    // page just settles back in place — same as before, but no longer
    // needs to know which page index happens to be "the last one".
    if(dx < -40) goToPage(currentPage + 1);
    else if(dx > 40) goToPage(currentPage - 1);
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
