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
