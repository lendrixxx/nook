/* =========================================================================
   DAILY QUESTS — predefined, not user-editable.

   Design mirrors stats.js: progress is *recomputed on demand* from the
   same food/water/workout logs stats.js already maintains (storage.js),
   rather than tracked as a separate running counter — so quest progress
   can never drift out of sync with what's actually been logged today.

   The only thing actually persisted here is (a) total XP, which is
   permanent, and (b) which quests have already paid out XP today, which
   resets at the local calendar-day boundary. That's what prevents
   duplicate XP without needing to touch the logs themselves.

   Add a new quest by adding one object to QUEST_DEFINITIONS — everything
   else (progress display, completion, XP award, daily reset) is generic.
   ========================================================================= */

import {
  loadFoodLog, loadWaterLog, loadWorkoutLog,
  loadXpTotal, saveXpTotal,
  loadQuestAwards, saveQuestAwards
} from './storage.js';

/* ---------------- Quest catalog ---------------- */

export const QUEST_DEFINITIONS = [
  {
    id: 'hydrated',
    icon: 'assets/icons/water.svg',
    label: 'Hydrated',
    desc: 'Drink 8 glasses of water',
    target: 8,
    xp: 20,
    getTodayCount: (logs) => sumToday(logs.water)
  },
  {
    id: 'active',
    icon: 'assets/icons/workout.svg',
    label: 'Active',
    desc: 'Log 1 workout',
    target: 1,
    xp: 25,
    getTodayCount: (logs) => countToday(logs.workout)
  },
  {
    id: 'wellfed',
    icon: 'assets/icons/food.svg',
    label: 'Well Fed',
    desc: 'Log 3 meals',
    target: 3,
    xp: 20,
    getTodayCount: (logs) => sumToday(logs.food)
  }
];

/* ---------------- Local calendar-day helpers ---------------- */

function dateKeyFor(timestamp){
  const d = new Date(timestamp);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function todayKey(){
  return dateKeyFor(Date.now());
}
function sumToday(log){
  const key = todayKey();
  return (log || []).reduce((sum, e) => dateKeyFor(e.timestamp) === key ? sum + (e.amount || 1) : sum, 0);
}
function countToday(log){
  const key = todayKey();
  return (log || []).filter(e => dateKeyFor(e.timestamp) === key).length;
}

/* ---------------- Awards (the only persisted, non-recomputable state) ----------------
   { date: 'YYYY-MM-DD', awarded: { questId: true, ... } }
   A stored record from a previous day is treated as stale and replaced
   with a fresh one — this *is* the daily reset, and it happens lazily
   the next time anything asks for quest state rather than needing a
   midnight timer. */
function getAwardsForToday(){
  const key = todayKey();
  const stored = loadQuestAwards();
  if(!stored || stored.date !== key){
    const fresh = { date: key, awarded: {} };
    saveQuestAwards(fresh);
    return fresh;
  }
  return stored;
}

function loadTodayLogs(){
  return { food: loadFoodLog(), water: loadWaterLog(), workout: loadWorkoutLog() };
}

/* ---------------- Public API ---------------- */

// Read-only view of today's quests — safe to call as often as you like,
// same contract as stats.js's getStats(). No writes happen here.
export function getQuestsView(){
  const logs = loadTodayLogs();
  const awardsRecord = getAwardsForToday();
  return QUEST_DEFINITIONS.map(q => {
    const rawCount = q.getTodayCount(logs);
    return {
      id: q.id,
      icon: q.icon,
      label: q.label,
      desc: q.desc,
      target: q.target,
      xp: q.xp,
      progress: Math.min(rawCount, q.target),
      done: !!awardsRecord.awarded[q.id]
    };
  });
}

// Call this whenever a food/water/workout log happens (stats.js does
// this automatically — see logFood/logWater/logWorkout there). Checks
// every quest against today's logs and pays out XP once per quest per
// day. Safe to call redundantly (e.g. on app boot, on a render tick) —
// quests that already paid out today are skipped via the awards record,
// so XP is never granted twice.
export function evaluateQuests(){
  const logs = loadTodayLogs();
  const awardsRecord = getAwardsForToday();
  const newlyAwarded = [];

  QUEST_DEFINITIONS.forEach(q => {
    const complete = q.getTodayCount(logs) >= q.target;
    if(complete && !awardsRecord.awarded[q.id]){
      awardsRecord.awarded[q.id] = true;
      saveXpTotal(loadXpTotal() + q.xp);
      newlyAwarded.push(q);
    }
  });

  if(newlyAwarded.length){
    saveQuestAwards(awardsRecord);
  }

  return { quests: getQuestsView(), newlyAwarded };
}
