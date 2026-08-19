import { $ } from './utils.js';
import { getStats, logFood, logWater, logWorkout, getGoals, setGoals } from './stats.js';
import { drawCharacter } from './companion.js';

/* ---------------- Swipeable infocard pages ----------------
   Pages live inside #infocardTrack (see index.html) in order: page 0 is
   .weather-now (temp/place/condition) + forecast, page 1 is the
   companion stats panel, page 2 is Daily Quests. Generalized to however
   many .infocard-page elements actually exist, so adding/removing a
   page never requires touching this math — just add/remove the markup
   + a matching .infocard-dot.

   Sizing is pixel-based (not percentage) so a real gap can sit between
   pages while dragging — percentage-based flex-basis math doesn't
   compose cleanly with a CSS `gap`, pixels do.

   Each .infocard-page is given its own max-height + overflow-y, capped
   to whatever space is actually available below #stage, and scrolls
   independently if its content is taller than that. This intentionally
   is NOT handled by scrolling #infocardSwipe/#infocardTrack as a whole
   — that would make the entire horizontally-swiping strip one shared
   vertical scroll area, which mixes badly with the drag gesture (a
   drag could show a blend of two pages' content, and .infocard-dots,
   which sits right after the track, could scroll out of view with it).
   Scoping the scroll to just the active page keeps the dots always
   visible and keeps a vertical scroll from ever visually touching a
   neighboring page.

   Dragging is axis-locked: the first ~8px of movement decides whether
   this gesture is a horizontal page-swipe or a vertical scroll, and it
   commits to only one for the rest of the gesture. Without that, a
   mostly-vertical touch could still nudge the track sideways (or vice
   versa), which is what produced the "two pages blended together"
   glitch. */
let currentPage = 0;
let pageEls = [];
let layout = { pageWidth: 0, gap: 14 };

const PAGE_GAP = 14;          // px of visible breathing room between pages while dragging
const RESERVED_BELOW_PAGE = 48; // rough allowance for the dots row + a little padding
const MIN_PAGE_HEIGHT = 160;

function pageCount(){ return pageEls.length || 1; }

function availablePageHeight(swipeEl){
  const top = swipeEl.getBoundingClientRect().top;
  return Math.max(MIN_PAGE_HEIGHT, window.innerHeight - top - RESERVED_BELOW_PAGE);
}

function applyPageLayout(swipeEl, track){
  const pageWidth = swipeEl.offsetWidth;
  const maxHeight = availablePageHeight(swipeEl);

  track.style.display = 'flex';
  track.style.gap = PAGE_GAP + 'px';
  track.style.width = (pageEls.length * pageWidth + (pageEls.length - 1) * PAGE_GAP) + 'px';

  pageEls.forEach(p => {
    p.style.flex = '0 0 ' + pageWidth + 'px';
    p.style.width = pageWidth + 'px';
    p.style.boxSizing = 'border-box';
    p.style.maxHeight = maxHeight + 'px';
    p.style.overflowY = 'auto';
    p.style.overscrollBehavior = 'contain';
    p.style.touchAction = 'pan-y';
  });

  return { pageWidth, gap: PAGE_GAP };
}

function syncSwipeHeight(){
  const swipeEl = $('infocardSwipe');
  const activeEl = pageEls[currentPage];
  if(!swipeEl || !activeEl) return;
  swipeEl.style.height = activeEl.offsetHeight + 'px';
}

function goToPage(i){
  currentPage = Math.max(0, Math.min(pageCount() - 1, i));
  const track = $('infocardTrack');
  const step = layout.pageWidth + layout.gap;
  if(track) track.style.transform = 'translateX(-' + (currentPage * step) + 'px)';
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
  layout = applyPageLayout(swipeEl, track);

  document.querySelectorAll('.infocard-dot').forEach(dot => {
    dot.onclick = () => goToPage(Number(dot.dataset.page));
  });

  // All pages sit side-by-side in the track at all times (only
  // translateX moves between them), so an inactive page's content can
  // change size — e.g. the forecast row loading in, the overfull flag
  // appearing, a quest completing — without ever being the active
  // page. ResizeObserver catches that and keeps .infocard-swipe's
  // height matched to whichever page is actually showing.
  if('ResizeObserver' in window){
    const ro = new ResizeObserver(() => syncSwipeHeight());
    pageEls.forEach(p => ro.observe(p));
  }

  goToPage(currentPage); // apply the initial transform now that layout is pixel-based

  // ---- Drag handling ----
  // transition off while dragging so the track follows the finger 1:1,
  // then either commit to the neighboring page or snap back, with the
  // transition restored so that settling move is animated either way.
  let startX = null, startY = null, dragDX = 0, dragging = false, axis = null;
  const AXIS_THRESHOLD = 8; // px of movement before committing to an axis

  swipeEl.addEventListener('touchstart', (e) => {
    const forecastEl = $('forecastRow');
    if(currentPage === 0 && forecastEl && forecastEl.classList.contains('hourly-mode')){
      startX = null; // let the hourly row's own scroller have the gesture
      return;
    }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = true;
    axis = null;
    track.style.transition = 'none';
  }, { passive:true });

  swipeEl.addEventListener('touchmove', (e) => {
    if(!dragging || startX === null) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if(axis === null){
      if(Math.abs(dx) < AXIS_THRESHOLD && Math.abs(dy) < AXIS_THRESHOLD) return; // not enough movement to tell yet
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if(axis === 'y'){
        // Vertical intent — hand this gesture entirely to the active
        // page's own overflow-y:auto scroll and stop touching the
        // track for the rest of it.
        dragging = false;
        track.style.transition = '';
        return;
      }
    }
    if(axis !== 'x') return;

    dragDX = dx;
    const step = layout.pageWidth + layout.gap;
    // No rubber-banding past either end of the track.
    if(currentPage === 0 && dragDX > 0) dragDX = 0;
    if(currentPage === pageCount() - 1 && dragDX < 0) dragDX = 0;
    track.style.transform = 'translateX(' + (-(currentPage * step) + dragDX) + 'px)';
  }, { passive:true });

  swipeEl.addEventListener('touchend', () => {
    const wasHorizontalDrag = dragging && axis === 'x';
    dragging = false;
    startX = null;
    startY = null;
    axis = null;
    track.style.transition = '';
    if(!wasHorizontalDrag) return; // vertical gesture — nothing here to settle
    const dx = dragDX;
    dragDX = 0;
    if(dx < -40) goToPage(currentPage + 1);
    else if(dx > 40) goToPage(currentPage - 1);
    else goToPage(currentPage); // didn't clear the threshold — snap back
  });

  // Viewport can change (rotation, keyboard, iOS URL bar show/hide) —
  // recompute pixel widths/heights and re-apply the current page's
  // transform so it stays aligned rather than drifting off pixel-based
  // math that was computed for a since-changed layout.
  window.addEventListener('resize', () => {
    layout = applyPageLayout(swipeEl, track);
    goToPage(currentPage);
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
