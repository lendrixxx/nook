import { $, cssVar, fetchAsset, stripSvgWrapper } from './utils.js';
import { state, getCharacter, todosDueOrOverdue } from './state.js';
import { saveCharacter as persistCharacter } from './storage.js';

/* ---------------- Companion rendering (asset-driven state engine) ----
   The companion is no longer drawn in JS. Each species/state pair is a
   pre-authored SVG file at assets/companions/<species>/<state>.svg (see
   ASSETS.md for the coordinate/palette convention and a ready-to-use
   prompt for generating new ones with another AI model). JS's job here
   is just: pick the right state, fetch it (cached), composite an
   accessory on top if the weather calls for one, and apply the
   character's palette as CSS custom properties on the wrapper element.
   That wrapper never gets replaced, so the palette persists across
   state swaps automatically. */

const charWrapEl = $('stageChar');
const charEl = charWrapEl.querySelector('.charInner');

export function getCharWrapEl(){ return charWrapEl; }

function updateSpeciesPicker(){
  const species = getCharacter().species || 'cat';

  document.querySelectorAll('.species-option').forEach(btn => {
    btn.classList.toggle(
      'active',
      btn.dataset.species === species
    );
  });
}

function saveCharacter(){
  persistCharacter(getCharacter());
}

function moodFor(base, todoLoad){
  if(todoLoad >= 3) return 'sad'; // things are piling up, regardless of weather
  if(base==='sunny' || base==='partly') return 'happy';
  if(base==='snowy') return 'cozy';
  if(base==='rainy' || base==='thunder') return 'sad';
  return 'neutral';
}
function accessoryFor(base){
  if(base==='sunny') return 'sunglasses';
  if(base==='rainy' || base==='thunder') return 'umbrella';
  if(base==='snowy') return 'scarf-hat';
  return null;
}
function applyCompanionPalette(character){
  const p = character.palette;
  charWrapEl.style.setProperty('--body', p.body);
  charWrapEl.style.setProperty('--belly', p.belly);
  charWrapEl.style.setProperty('--cheek', p.cheek);
  charWrapEl.style.setProperty('--accent', p.accent);
  charWrapEl.style.setProperty('--earfill', p.accent);
  charWrapEl.style.setProperty('--ink', cssVar('--ink'));
}

let charAsleep = false;
export function isCharAsleep(){ return charAsleep; }
export function setCharAsleep(v){ charAsleep = v; }

let companionRenderToken = 0; // guards against a slow fetch clobbering a newer state
export async function drawCharacter(){
  const myToken = ++companionRenderToken;
  const c = getCharacter();
  applyCompanionPalette(c);
  const w = state.weather;
  const base = w ? w.base : 'sunny';
  const todoLoad = todosDueOrOverdue().length;
  const poseState = charAsleep ? 'asleep' : moodFor(base, todoLoad);
  const accessory = charAsleep ? null : accessoryFor(base);

  let baseSVG, accSVG = '';
  try{
    baseSVG = await fetchAsset('assets/companions/'+c.species+'/'+poseState+'.svg');
  } catch(e){
    try{ baseSVG = await fetchAsset('assets/companions/'+c.species+'/happy.svg'); }
    catch(e2){ return; } // truly nothing to render
  }
  try{
    if(accessory) accSVG = await fetchAsset('assets/companions/_accessories/'+accessory+'.svg');
  } catch(e){ accSVG = ''; }
  if(myToken !== companionRenderToken) return;

  charEl.innerHTML = '<svg viewBox="0 0 256 218" width="66" height="82" preserveAspectRatio="xMidYMax meet">'
    + stripSvgWrapper(baseSVG)
    + (accSVG ? stripSvgWrapper(accSVG) : '')
    + '</svg>';
}

export async function setCompanionState(poseState){
  // Small helper for one-off poses driven by user actions (e.g. celebrate
  // on completing a to-do) that aren't purely a function of weather/mood.
  const c = getCharacter();
  applyCompanionPalette(c);
  const myToken = ++companionRenderToken;
  let svgText;
  try{ svgText = await fetchAsset('assets/companions/'+c.species+'/'+poseState+'.svg'); }
  catch(e){ return; }
  if(myToken !== companionRenderToken) return;
  charEl.innerHTML = '<svg viewBox="0 0 256 218" width="66" height="82" preserveAspectRatio="xMidYMax meet">'+stripSvgWrapper(svgText)+'</svg>';
}

/* ---------------- Character sheet ---------------- */
export function openCharacterSheet(){
  $('characterSheet').classList.add('open');
  $('sheetBackdrop').classList.add('open');

  const c = getCharacter();

  $('cName').value = c.name;
  $('cSpecies').value = c.species || 'cat';
  $('cBody').value = c.palette.body;
  $('cBelly').value = c.palette.belly;
  $('cCheek').value = c.palette.cheek;
  $('cAccent').value = c.palette.accent;
}

export function closeCharacterSheet(){
  $('characterSheet').classList.remove('open');
  $('sheetBackdrop').classList.remove('open');
}

export function initCompanion(){
  document.querySelectorAll('.species-option').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.species-option')
        .forEach(b => b.classList.remove('selected'));

      btn.classList.add('selected');
      $('cSpecies').value = btn.dataset.species;
    };
  });

  $('customizeProp').onclick = openCharacterSheet;
  $('customizeCharBtn').onclick = () => {
    const c = getCharacter();

    c.name = $('cName').value.trim() || c.name;
    c.species = $('cSpecies').value;
    c.palette.body = $('cBody').value;
    c.palette.belly = $('cBelly').value;
    c.palette.cheek = $('cCheek').value;
    c.palette.accent = $('cAccent').value;

    saveCharacter();
    companionRenderToken++;
    drawCharacter();

    $('cName').value = '';
    closeCharacterSheet();
  };
  $('characterSheetCloseBtn').onclick = closeCharacterSheet;
}
