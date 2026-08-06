import { loadSavedCharacter } from './storage.js';

/* Each character picks a species (assets/companions/<species>/) plus a
   palette applied as CSS custom properties at render time — see
   applyCompanionPalette() in companion.js. Adding a character = adding an
   id/name/species/palette entry here; adding a whole new LOOK = adding a
   new species folder of assets (see ASSETS.md). */
export const CHARACTERS = [
  { id:'mochi', name:'Mochi', species:'cat',
    palette:{ body:'#F6E9D3', belly:'#FFFBF2', cheek:'#F4A9A0', accent:'#C99A6E' } },
  { id:'ember', name:'Ember', species:'cat',
    palette:{ body:'#F2A65A', belly:'#FFF3E0', cheek:'#FF7A59', accent:'#8D5A2B' } },
  { id:'bramble', name:'Bramble', species:'bear',
    palette:{ body:'#A9C6A2', belly:'#F4EFDF', cheek:'#F6A9A0', accent:'#5F7B57' } },
  { id:'clover', name:'Clover', species:'bunny',
    palette:{ body:'#EDE6F5', belly:'#FFFFFF', cheek:'#F6A9A0', accent:'#B9A7D1' } }
];

const saved = loadSavedCharacter();
if(saved){
  CHARACTERS[0] = saved;
}

export const state = {
  lat:null, lon:null, locationName:'—', locationSub:'',
  weather:null, characterId: CHARACTERS[0].id,
  todos: []
};

export function getCharacter(){
  return CHARACTERS.find(c=>c.id===state.characterId) || CHARACTERS[0];
}

/* Any to-do that's due today or earlier and not yet done — read by the
   companion (mood + celebrate state), the to-do button badge, and the
   desk plant's health indicator. */
export function todosDueOrOverdue(){
  return state.todos.filter(t => !t.done && t.date && t.date <= localTodayKey());
}
function localTodayKey(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
