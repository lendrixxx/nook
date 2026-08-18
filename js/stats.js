/* =========================================================================
   COMPANION STATS — hunger/thirst/energy/happiness meters.

   Design: every meter is *recomputed on demand* from a small log of
   {timestamp, amount} entries (loadFoodLog/loadWaterLog/loadWorkoutLog in
   storage.js) rather than stored as a snapshot number. That mirrors the
   same "recompute-on-demand" approach the furniture occupancy system
   uses — there's nothing here that can drift out of sync with the
   current time, and the cost is bounded by how many logs happened
   recently (pruned below), not by how long the app has existed.

   Each meter rises when you log (food/water/workout) and decays
   continuously toward 0 the longer it's been since the last log — like
   a tamagotchi hunger meter, but with no hard reset at midnight, so a
   meal logged at 11pm still matters at 1am.

   Happiness is different: it's not built from its own log. It's derived
   live from today's to-do completion rate (via a provider function the
   app wires up — see setTodoCompletionRateProvider) plus a small penalty
   if the companion is currently overfull.
   ========================================================================= */

import {
  loadFoodLog, saveFoodLog,
  loadWaterLog, saveWaterLog,
  loadWorkoutLog, saveWorkoutLog,
  loadStatsGoals, saveStatsGoals
} from './storage.js';

/* ---------------- Tunables ---------------- */

// How many "units" per day fill a meter to 100%. Food/water units are
// just "number of times logged" (each tap = 1 unit unless a caller passes
// a bigger amount); workout units are minutes.
const DEFAULT_GOALS = {
  foodTarget: 3,            // meals/snacks per day
  waterTarget: 8,           // glasses per day
  workoutMinutesTarget: 20  // minutes of activity for a "full" energy refill
};

// Hours for a meter to fully drain to 0 with no further logging.
const FOOD_DECAY_HOURS = 6;
const WATER_DECAY_HOURS = 8;
const ENERGY_DECAY_HOURS = 30;

// Food is allowed to rise above 100 (that's what "overfull" means); the
// others are clamped at 100 since there's no equivalent concept for them.
const FOOD_CAP = 150;
const OVERFULL_THRESHOLD = 100;

// How much being overfull drags down energy vs. happiness. Energy takes
// the bigger hit — per Lendrix: "energy slightly more than happiness."
const OVERFULL_ENERGY_PENALTY_PER_PCT = 0.5;
const OVERFULL_HAPPINESS_PENALTY_PER_PCT = 0.3;

// Logs older than this are dropped on save — once an entry is old enough
// that its contribution has fully decayed away for every meter, keeping
// it around only costs storage/compute for no visual difference. Set well
// past the longest decay window (energy, 30h) for safety margin.
const PRUNE_HOURS = 60;

/* ---------------- Core decay math ---------------- */

// entries: [{timestamp, amount}], sorted or not.
// targetUnits: how many "amount" units add up to a full (100%) meter.
// decayHours: how long a full meter takes to drain to 0 with no new entries.
// capMax: highest value the level is allowed to reach (100, or 150 for food).
function computeLevel(entries, targetUnits, decayHours, capMax, now){
  if(!entries || !entries.length || targetUnits <= 0) return 0;
  const perUnit = 100 / targetUnits;
  const decayPerMs = 100 / (decayHours * 3600000);
  const sorted = entries.slice().sort((a, b) => a.timestamp - b.timestamp);

  let level = 0;
  let last = sorted[0].timestamp;
  for(const entry of sorted){
    const gap = entry.timestamp - last;
    level = Math.max(0, level - decayPerMs * gap);
    level += (entry.amount || 1) * perUnit;
    last = entry.timestamp;
  }
  // Decay from the last log up to now.
  level = Math.max(0, level - decayPerMs * (now - last));
  return Math.min(level, capMax);
}

function pruneLog(entries, now){
  const cutoff = now - PRUNE_HOURS * 3600000;
  return entries.filter(e => e.timestamp >= cutoff);
}

/* ---------------- Happiness source (todo completion) ----------------
   stats.js deliberately doesn't import todos.js directly — todo item
   shape lives over there and can change independently. The app wires up
   how to compute "today's completion rate" once at boot; until then this
   falls back to a neutral default so the meters still render sensibly. */
let todoCompletionRateProvider = () => 0.7;
export function setTodoCompletionRateProvider(fn){
  todoCompletionRateProvider = fn;
}

/* ---------------- Public API ---------------- */

export function getGoals(){
  return loadStatsGoals(DEFAULT_GOALS);
}
export function setGoals(partialGoals){
  const goals = Object.assign({}, getGoals(), partialGoals);
  saveStatsGoals(goals);
  return goals;
}

export function logFood(amount = 1){
  const now = Date.now();
  const log = pruneLog(loadFoodLog(), now);
  log.push({ timestamp: now, amount });
  saveFoodLog(log);
  return getStats();
}
export function logWater(amount = 1){
  const now = Date.now();
  const log = pruneLog(loadWaterLog(), now);
  log.push({ timestamp: now, amount });
  saveWaterLog(log);
  return getStats();
}
export function logWorkout(durationMinutes){
  const goals = getGoals();
  const now = Date.now();
  const log = pruneLog(loadWorkoutLog(), now);
  log.push({ timestamp: now, amount: durationMinutes != null ? durationMinutes : goals.workoutMinutesTarget });
  saveWorkoutLog(log);
  return getStats();
}

// Returns the current meter levels. Safe to call as often as you like —
// it's a pure read (aside from the todo-completion provider call), no
// storage writes happen here.
export function getStats(){
  const now = Date.now();
  const goals = getGoals();

  const foodLevel = computeLevel(loadFoodLog(), goals.foodTarget, FOOD_DECAY_HOURS, FOOD_CAP, now);
  const waterLevel = computeLevel(loadWaterLog(), goals.waterTarget, WATER_DECAY_HOURS, 100, now);
  let energyLevel = computeLevel(loadWorkoutLog(), goals.workoutMinutesTarget, ENERGY_DECAY_HOURS, 100, now);

  const overfull = foodLevel > OVERFULL_THRESHOLD;
  const overfullAmount = overfull ? (foodLevel - OVERFULL_THRESHOLD) : 0;

  if(overfull){
    energyLevel = Math.max(0, energyLevel - overfullAmount * OVERFULL_ENERGY_PENALTY_PER_PCT);
  }

  let happiness = clamp(todoCompletionRateProvider() * 100, 0, 100);
  if(overfull){
    happiness = Math.max(0, happiness - overfullAmount * OVERFULL_HAPPINESS_PENALTY_PER_PCT);
  }

  return {
    food: round1(foodLevel),
    water: round1(waterLevel),
    energy: round1(energyLevel),
    happiness: round1(happiness),
    overfull,
    mood: deriveMood(overfull, happiness)
  };
}

function deriveMood(overfull, happiness){
  if(overfull) return 'bloated';
  if(happiness > 75) return 'delighted';
  if(happiness < 35) return 'gloomy';
  return 'content';
}

function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }
function round1(n){ return Math.round(n * 10) / 10; }
