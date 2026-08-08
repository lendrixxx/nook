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
