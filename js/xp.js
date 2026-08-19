/* =========================================================================
   XP / LEVEL — one centralized, tunable curve.

   Nothing else should hardcode level thresholds. Anything that needs
   "what level is this total XP" or "what unlocks at level N" — quests
   today, and per the Part 2 plan: room-item unlocks, character-part
   unlocks, room-size unlocks later — should import getLevelInfo() from
   here rather than computing its own thresholds.

   Formula: floor XP for level N = XP_CURVE_MULTIPLIER * (N - 1)^2
   (a simple quadratic, no manually-authored threshold table). Levels
   get further apart as you go, but the curve is shaped entirely by the
   one constant below — turn it down for faster leveling, up for slower.
   ========================================================================= */

// Lower = faster leveling. This is the only number to touch to retune
// the whole curve. (Started at 10, lowered to 4 — the original curve
// felt too slow given typical daily quest XP.)
const XP_CURVE_MULTIPLIER = 4;

// Cumulative XP required to *reach* a given level (level 1 = 0).
export function xpForLevel(level){
  return XP_CURVE_MULTIPLIER * Math.pow(level - 1, 2);
}

// Given a total XP amount, returns everything a UI (or a future unlock
// check) needs: current level, XP earned within that level, how much
// the level spans, and progress as a 0–1 fraction.
export function getLevelInfo(totalXp){
  totalXp = Math.max(0, totalXp || 0);

  let level = 1;
  while(xpForLevel(level + 1) <= totalXp) level++;

  const floor = xpForLevel(level);
  const nextFloor = xpForLevel(level + 1);
  const xpIntoLevel = totalXp - floor;
  const xpForNextLevel = nextFloor - floor;

  return {
    level,
    totalXp,
    xpIntoLevel,
    xpForNextLevel,
    xpRemaining: Math.max(0, xpForNextLevel - xpIntoLevel),
    progress: xpForNextLevel > 0 ? xpIntoLevel / xpForNextLevel : 1
  };
}
