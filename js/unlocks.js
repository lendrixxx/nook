/* =========================================================================
   LEVEL-BASED UNLOCKS — Part 2.

   Three centralized lists define everything this system unlocks:
     ITEM_UNLOCKS      — room/furniture catalog entries (ITEM_CATALOG keys)
     CHARACTER_UNLOCKS — character-customization parts, empty for now but
                         wired through the exact same pipeline so a future
                         character-unlocks feature only has to add entries
                         here, not build its own evaluate/persist/notify
                         system
     ROOM_SIZE_MILESTONES — level thresholds where the room grid grows

   Design mirrors quests.js: the current level (via xp.js's getLevelInfo)
   is a live, derived value, but what's actually been unlocked is a
   separate persisted record (storage.js) that only ever grows — it must
   never re-lock something because XP/level was later reduced (the dev
   "set level" tool, in particular), especially room size, since furniture
   may already be placed in space that only exists because it unlocked.

   evaluateUnlocks() is the one function that checks current level against
   all three lists and permanently records anything newly reached — same
   "safe to call redundantly, no double-processing" contract quests.js's
   evaluateQuests() has.
   ========================================================================= */

import { getLevelInfo, xpForLevel } from './xp.js';
import {
  loadXpTotal, saveXpTotal,
  loadUnlockedItems, saveUnlockedItems,
  loadUnlockedCharacterParts, saveUnlockedCharacterParts,
  loadRoomSizeLevel, saveRoomSizeLevel,
  clearProgressionStorage
} from './storage.js';
import { ROOM_LAYOUT, setRoomSize } from './room.js';

/* ---------------- Catalogs ---------------- */

// id must match an ITEM_CATALOG key in room.js. Levels are spread out
// to roughly track the existing quest XP economy (~65 XP/day at most),
// so unlocks land every few days rather than all at once or never.
export const ITEM_UNLOCKS = [
  { id:'desk', level:1, label:'Desk' },
  { id:'stool', level:1, label:'Stool' },
  { id:'plant-pot', level:1, label:'Plant Pot' },
  { id:'lamp', level:4, label:'Desk Lamp' },
  { id:'mug', level:4, label:'Mug' },
  { id:'book', level:7, label:'Book' },
  { id:'shelf', level:10, label:'Shelf' }
];

// Empty for now — character customization has no unlockable parts yet.
// When it does, entries go here in the exact same {id, level, label}
// shape and everything below (evaluate, persist, notify) already works.
export const CHARACTER_UNLOCKS = [];

// Deliberately infrequent — see the requirement this was built against.
// cols/rows are square today but don't have to stay that way.
export const ROOM_SIZE_MILESTONES = [
  { level:1, cols:6, rows:6 },
  { level:10, cols:7, rows:7 },
  { level:20, cols:8, rows:8 }
];

function currentLevel(){
  return getLevelInfo(loadXpTotal()).level;
}

/* ---------------- Reads (grandfathering happens lazily, on first read) ----------------
   loadUnlockedItems() returns null only when this player's storage
   predates Part 2. That's the one-time signal to seed the record with
   whatever's already placed in ROOM_LAYOUT (plus the level-1 defaults),
   so nothing already in active use suddenly reads as locked. Every
   other read/write after that first call goes through the normal
   persisted list. */
function getUnlockedItemIds(){
  let unlocked = loadUnlockedItems();
  if(unlocked === null){
    const placedAssets = ROOM_LAYOUT.map(i => i.asset);
    const defaults = ITEM_UNLOCKS.filter(u => u.level <= 1).map(u => u.id);
    unlocked = Array.from(new Set([...defaults, ...placedAssets]));
    saveUnlockedItems(unlocked);
  }
  return unlocked;
}
function getUnlockedCharacterIds(){
  let unlocked = loadUnlockedCharacterParts();
  if(unlocked === null){
    unlocked = CHARACTER_UNLOCKS.filter(u => u.level <= 1).map(u => u.id);
    saveUnlockedCharacterParts(unlocked);
  }
  return unlocked;
}

export function isItemUnlocked(id){
  return getUnlockedItemIds().includes(id);
}
export function isCharacterPartUnlocked(id){
  return getUnlockedCharacterIds().includes(id);
}
export function getUnlockLevel(id){
  const def = ITEM_UNLOCKS.find(u => u.id === id) || CHARACTER_UNLOCKS.find(u => u.id === id);
  return def ? def.level : 1;
}

export function getRoomSizeMilestoneForLevel(level){
  return ROOM_SIZE_MILESTONES.reduce((best, m) => (m.level <= level ? m : best), ROOM_SIZE_MILESTONES[0]);
}

// Applies whatever room size the permanently-recorded room-size level
// already entitles — reads storage only, no level check, no persisting.
// Call this before the room SVG is first built each boot (app.js), so
// it renders at the right grid size from the very first paint rather
// than building small and immediately resizing.
export function applyRoomSize(){
  const milestone = getRoomSizeMilestoneForLevel(loadRoomSizeLevel());
  setRoomSize(milestone.cols, milestone.rows);
}

/* ---------------- The main evaluate/persist pass ---------------- */
export function evaluateUnlocks(){
  const level = currentLevel();
  const newlyUnlockedItems = [];
  const newlyUnlockedCharacter = [];
  let roomGrew = null;

  const unlockedItems = getUnlockedItemIds();
  ITEM_UNLOCKS.forEach(u => {
    if(level >= u.level && !unlockedItems.includes(u.id)){
      unlockedItems.push(u.id);
      newlyUnlockedItems.push(u);
    }
  });
  if(newlyUnlockedItems.length) saveUnlockedItems(unlockedItems);

  const unlockedCharacter = getUnlockedCharacterIds();
  CHARACTER_UNLOCKS.forEach(u => {
    if(level >= u.level && !unlockedCharacter.includes(u.id)){
      unlockedCharacter.push(u.id);
      newlyUnlockedCharacter.push(u);
    }
  });
  if(newlyUnlockedCharacter.length) saveUnlockedCharacterParts(unlockedCharacter);

  const recordedMilestone = getRoomSizeMilestoneForLevel(loadRoomSizeLevel());
  const reachableMilestone = getRoomSizeMilestoneForLevel(level);
  if(reachableMilestone.level > recordedMilestone.level){
    saveRoomSizeLevel(reachableMilestone.level);
    setRoomSize(reachableMilestone.cols, reachableMilestone.rows);
    roomGrew = reachableMilestone;
  }

  return { newlyUnlockedItems, newlyUnlockedCharacter, roomGrew };
}

/* ---------------- Dev-only progression controls ----------------
   Thin wrappers so devTools.js doesn't need to know storage.js/xp.js
   directly — every path here still funnels through evaluateUnlocks(),
   so a dev-triggered level change unlocks/grows the room exactly like a
   real one would. */
export function devAddXp(delta){
  saveXpTotal(Math.max(0, loadXpTotal() + delta));
  return evaluateUnlocks();
}
export function devSetLevel(level){
  const lvl = Math.max(1, Math.floor(level) || 1);
  saveXpTotal(xpForLevel(lvl));
  return evaluateUnlocks();
}
// Scoped to items/character only, deliberately not XP/level/room size —
// a fast way to preview every catalog entry without grinding, without
// also silently levelling the player up.
export function devUnlockAllItems(){
  saveUnlockedItems(ITEM_UNLOCKS.map(u => u.id));
  saveUnlockedCharacterParts(CHARACTER_UNLOCKS.map(u => u.id));
}
export function devResetProgression(){
  clearProgressionStorage();
  const base = ROOM_SIZE_MILESTONES[0];
  setRoomSize(base.cols, base.rows);
}
