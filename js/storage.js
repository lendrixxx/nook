/* ---------------- localStorage — every key Nook uses, in one place ----------------
   Keeping all reads/writes here means the storage format for a given
   feature only has to be gotten right once, and it's easy to see the
   full list of keys Nook persists. */

const KEY_CHARACTER = 'nook_character';
const KEY_FORECAST_MODE = 'nook_forecast_mode';
const KEY_TODOS = 'nook_todos';
const KEY_GCAL = 'nook_gcal';
const KEY_FURNITURE_PREFIX = 'nook_furniture_'; // one key per theme, so switching
                                                  // themes doesn't clobber other layouts

/* Companion stats (feeding/playing) — added for the hunger/thirst/energy/
   happiness feature. Each log is a small array of {timestamp, amount}
   entries; stats.js recomputes the current meter levels on demand from
   these logs (decay + accumulation) rather than storing a snapshot, so
   there's nothing here that can drift out of sync with "now". */
const KEY_FOOD_LOG = 'nook_food_log';
const KEY_WATER_LOG = 'nook_water_log';
const KEY_WORKOUT_LOG = 'nook_workout_log';
const KEY_STATS_GOALS = 'nook_stats_goals';

/* Daily Quests + XP. XP total is permanent and never resets. The quest
   awards record is the *only* piece of quest state that's actually
   stored — everything else (today's progress) is recomputed on demand
   from the logs above, same as stats.js does for the meters. See
   quests.js for how the awards record resets at the calendar-day
   boundary while xp_total is left untouched.

   Part 2 (level-based unlocks — see unlocks.js) deliberately persists
   nothing of its own here: item/character unlock status and room size
   are pure, live functions of this same XP total, recomputed on every
   read rather than tracked as a separate record. That's what makes
   clearProgressionStorage() below only need to touch these two keys. */
const KEY_XP_TOTAL = 'nook_xp_total';
const KEY_QUEST_AWARDS = 'nook_quest_awards';

export function loadSavedCharacter(){
  try{ return JSON.parse(localStorage.getItem(KEY_CHARACTER)); }
  catch(e){ return null; }
}
export function saveCharacter(character){
  try{ localStorage.setItem(KEY_CHARACTER, JSON.stringify(character)); }
  catch(e){}
}

export function loadForecastMode(){
  return localStorage.getItem(KEY_FORECAST_MODE) || 'weekly';
}
export function saveForecastMode(mode){
  try{ localStorage.setItem(KEY_FORECAST_MODE, mode); } catch(e){}
}

export function loadTodos(){
  try{
    const raw = localStorage.getItem(KEY_TODOS);
    return raw ? JSON.parse(raw) : [];
  } catch(e){ return []; }
}
export function saveTodos(todos){
  try{ localStorage.setItem(KEY_TODOS, JSON.stringify(todos)); } catch(e){}
}

export function loadGcalState(defaults){
  try{
    const raw = localStorage.getItem(KEY_GCAL);
    return raw ? Object.assign(defaults, JSON.parse(raw)) : defaults;
  } catch(e){ return defaults; }
}
export function saveGcalState(gcal){
  try{
    localStorage.setItem(KEY_GCAL, JSON.stringify({
      connected: gcal.connected, sessionId: gcal.sessionId,
      calendars: gcal.calendars, selectedIds: gcal.selectedIds, rangeDays: gcal.rangeDays,
      events: gcal.events, lastUpdated: gcal.lastUpdated
    }));
  } catch(e){}
}

/* ---------------- Furniture layout (per theme) ---------------- */
export function loadFurnitureLayout(themeId){
  try{
    const raw = localStorage.getItem(KEY_FURNITURE_PREFIX + themeId);
    return raw ? JSON.parse(raw) : null;
  } catch(e){ return null; }
}
export function saveFurnitureLayout(themeId, layout){
  try{ localStorage.setItem(KEY_FURNITURE_PREFIX + themeId, JSON.stringify(layout)); }
  catch(e){}
}
export function clearFurnitureLayout(themeId){
  try{ localStorage.removeItem(KEY_FURNITURE_PREFIX + themeId); } catch(e){}
}

/* ---------------- Companion stats: food / water / workout logs ---------------- */
export function loadFoodLog(){
  try{
    const raw = localStorage.getItem(KEY_FOOD_LOG);
    return raw ? JSON.parse(raw) : [];
  } catch(e){ return []; }
}
export function saveFoodLog(log){
  try{ localStorage.setItem(KEY_FOOD_LOG, JSON.stringify(log)); } catch(e){}
}

export function loadWaterLog(){
  try{
    const raw = localStorage.getItem(KEY_WATER_LOG);
    return raw ? JSON.parse(raw) : [];
  } catch(e){ return []; }
}
export function saveWaterLog(log){
  try{ localStorage.setItem(KEY_WATER_LOG, JSON.stringify(log)); } catch(e){}
}

export function loadWorkoutLog(){
  try{
    const raw = localStorage.getItem(KEY_WORKOUT_LOG);
    return raw ? JSON.parse(raw) : [];
  } catch(e){ return []; }
}
export function saveWorkoutLog(log){
  try{ localStorage.setItem(KEY_WORKOUT_LOG, JSON.stringify(log)); } catch(e){}
}

/* ---------------- Companion stats: user-editable daily goals ---------------- */
export function loadStatsGoals(defaults){
  try{
    const raw = localStorage.getItem(KEY_STATS_GOALS);
    return raw ? Object.assign({}, defaults, JSON.parse(raw)) : Object.assign({}, defaults);
  } catch(e){ return Object.assign({}, defaults); }
}
export function saveStatsGoals(goals){
  try{ localStorage.setItem(KEY_STATS_GOALS, JSON.stringify(goals)); } catch(e){}
}

/* ---------------- Daily Quests + XP ---------------- */
export function loadXpTotal(){
  try{
    const raw = localStorage.getItem(KEY_XP_TOTAL);
    const n = raw != null ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch(e){ return 0; }
}
export function saveXpTotal(total){
  try{ localStorage.setItem(KEY_XP_TOTAL, String(total)); } catch(e){}
}

export function loadQuestAwards(){
  try{
    const raw = localStorage.getItem(KEY_QUEST_AWARDS);
    return raw ? JSON.parse(raw) : null;
  } catch(e){ return null; }
}
export function saveQuestAwards(record){
  try{ localStorage.setItem(KEY_QUEST_AWARDS, JSON.stringify(record)); } catch(e){}
}

// Dev-only "Reset progression" tool (unlocks.js). Deliberately does NOT
// touch character/todos/furniture/weather/calendar state — this resets
// *progression*, not the whole app.
export function clearProgressionStorage(){
  try{
    localStorage.removeItem(KEY_XP_TOTAL);
    localStorage.removeItem(KEY_QUEST_AWARDS);
  } catch(e){}
}
