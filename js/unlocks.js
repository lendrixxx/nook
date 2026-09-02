/* =========================================================================
   LEVEL-BASED UNLOCKS — Part 2.

   Three centralized lists define everything this system unlocks:
     ITEM_UNLOCKS      — room/furniture catalog entries (ITEM_CATALOG keys)
     CHARACTER_UNLOCKS — character-customization parts, empty for now but
                         wired through the exact same pipeline so a future
                         character-unlocks feature only has to add entries
                         here, not build its own evaluate/notify system
     ROOM_SIZE_MILESTONES — level thresholds where the room grid grows

   Design: unlock status is a PURE, LIVE function of current level (via
   xp.js's getLevelInfo) — nothing about "what's unlocked" is separately
   persisted. That's deliberate: it means the dev "set level" tool
   naturally relocks anything above the new level (and shrinks the room
   back down) on the very next read, with no separate bookkeeping that
   could drift out of sync with it, and it means there's no migration/
   grandfathering concern for existing storage — a player who's never
   touched this feature just reads as whatever their current level
   already entitles, same as a freshly-reset one would.

   Nothing here ever deletes anything from ROOM_LAYOUT — relocking only
   affects whether the CATALOG will let you add another one; an already-
   placed item stays exactly where it is (see furniture.js/room.js).

   evaluateUnlocksSince(beforeLevel) is the one function that detects a
   level CHANGE (comparing the level right before some XP-changing
   action to the level right after) and reports what became newly
   reachable — that transient before/after comparison is what drives the
   unlock toast, rather than any persisted "have I shown this" flag.
   ========================================================================= */

import { getLevelInfo, xpForLevel } from './xp.js';
import { loadXpTotal, saveXpTotal, clearProgressionStorage } from './storage.js';
import { setRoomSize, catalogThumbPath } from './room.js';

/* ---------------- Catalogs ---------------- */

// id must match an ITEM_CATALOG key in room.js; icon is the same asset
// path loadRoomDecorations() would fetch for it, reused by the unlock
// toast (see devTools.js) so the notification shows the actual item
// rather than a generic glyph. Levels are spread out to roughly track
// the existing quest XP economy (~65 XP/day at most), so unlocks land
// every few days rather than all at once or never.
export const ITEM_UNLOCKS = [
  { id:'desk', level:1, label:'Desk', icon:catalogThumbPath('desk') },
  { id:'stool', level:1, label:'Stool', icon:catalogThumbPath('stool') },
  { id:'plant-pot', level:1, label:'Plant Pot', icon:catalogThumbPath('plant-pot') },
  { id:'lamp', level:4, label:'Desk Lamp', icon:catalogThumbPath('lamp') },
  { id:'mug', level:4, label:'Mug', icon:catalogThumbPath('mug') },
  { id:'book', level:7, label:'Book', icon:catalogThumbPath('book') },
  { id:'shelf', level:10, label:'Shelf', icon:catalogThumbPath('shelf') }
];

// Empty for now — character customization has no unlockable parts yet.
// When it does, entries go here in the exact same shape and everything
// below (isUnlocked, evaluate, notify) already works.
export const CHARACTER_UNLOCKS = [];

// Deliberately infrequent — see the requirement this was built against.
// cols/rows are square today but don't have to stay that way.
export const ROOM_SIZE_MILESTONES = [
  { level:1, cols:6, rows:6 },
  { level:10, cols:7, rows:7 },
  { level:20, cols:8, rows:8 },
  { level:30, cols:9, rows:9 },
  { level:40, cols:10, rows:10 },
  { level:50, cols:11, rows:11 },
  { level:60, cols:12, rows:12 }
];

function currentLevel(){
  return getLevelInfo(loadXpTotal()).level;
}
// Exported so callers that are about to change XP (stats.js, dev tools)
// can snapshot "before" without needing to know getLevelInfo/xp.js
// themselves.
export function getCurrentLevel(){
  return currentLevel();
}

/* ---------------- Reads — always live, never cached/persisted ---------------- */
export function isItemUnlocked(id){
  const def = ITEM_UNLOCKS.find(u => u.id === id);
  return def ? currentLevel() >= def.level : false;
}
export function isCharacterPartUnlocked(id){
  const def = CHARACTER_UNLOCKS.find(u => u.id === id);
  return def ? currentLevel() >= def.level : false;
}
export function getUnlockLevel(id){
  const def = ITEM_UNLOCKS.find(u => u.id === id) || CHARACTER_UNLOCKS.find(u => u.id === id);
  return def ? def.level : 1;
}

export function getRoomSizeMilestoneForLevel(level){
  return ROOM_SIZE_MILESTONES.reduce((best, m) => (m.level <= level ? m : best), ROOM_SIZE_MILESTONES[0]);
}

// Applies whatever room size the CURRENT level entitles — pure function
// of level, nothing persisted. Call at boot (before the room SVG first
// builds) and any time level might have changed.
export function applyRoomSize(){
  const m = getRoomSizeMilestoneForLevel(currentLevel());
  setRoomSize(m.cols, m.rows);
}

/* ---------------- The one function that detects a level change ---------------- */
// beforeLevel: whatever getCurrentLevel() returned right before the
// caller changed XP. Returns what's newly reachable as of right now,
// and applies (grows OR shrinks) the room size to match — see the
// module comment above for why nothing here is persisted separately
// from XP itself.
export function evaluateUnlocksSince(beforeLevel){
  const after = currentLevel();

  const newlyUnlockedItems = after > beforeLevel
    ? ITEM_UNLOCKS.filter(u => u.level > beforeLevel && u.level <= after)
    : [];
  const newlyUnlockedCharacter = after > beforeLevel
    ? CHARACTER_UNLOCKS.filter(u => u.level > beforeLevel && u.level <= after)
    : [];

  const beforeMilestone = getRoomSizeMilestoneForLevel(beforeLevel);
  const afterMilestone = getRoomSizeMilestoneForLevel(after);
  const roomSizeChanged = afterMilestone.level !== beforeMilestone.level;
  if(roomSizeChanged){
    setRoomSize(afterMilestone.cols, afterMilestone.rows);
  }

  return {
    level: after,
    newlyUnlockedItems,
    newlyUnlockedCharacter,
    roomSizeChanged,
    // Only set for an actual *growth* — a dev-triggered shrink still
    // needs the room rebuilt (roomSizeChanged handles that) but isn't
    // the kind of moment worth a celebratory toast for.
    roomGrew: (roomSizeChanged && afterMilestone.level > beforeMilestone.level) ? afterMilestone : null
  };
}

/* ---------------- Dev-only progression controls ----------------
   Every path here still funnels through evaluateUnlocksSince(), so a
   dev-triggered level change unlocks/grows/shrinks exactly like a real
   one would — including relocking anything above the new level, and
   shrinking the room back down, if the level goes down. Nothing here
   deletes placed furniture; see the module comment above. */
export function devAddXp(delta){
  const before = currentLevel();
  saveXpTotal(Math.max(0, loadXpTotal() + delta));
  return evaluateUnlocksSince(before);
}
export function devSetLevel(level){
  const before = currentLevel();
  const lvl = Math.max(1, Math.floor(level) || 1);
  saveXpTotal(xpForLevel(lvl));
  return evaluateUnlocksSince(before);
}
// "Unlock all" is just "set level to whatever the highest-level entry
// needs" — since unlock status is purely level-derived, that's the only
// mechanism that exists, and it's the same one devSetLevel already uses.
export function devUnlockAllItems(){
  const maxLevel = Math.max(1, ...ITEM_UNLOCKS.map(u => u.level), ...CHARACTER_UNLOCKS.map(u => u.level));
  return devSetLevel(maxLevel);
}
export function devResetProgression(){
  const before = currentLevel();
  clearProgressionStorage(); // XP total + quest awards — nothing else is persisted for unlocks anymore
  return evaluateUnlocksSince(before);
}
