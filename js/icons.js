import { fetchAsset, stripSvgWrapper } from './utils.js';

/* =========================================================================
   ICONS
   Every icon in Nook is a standalone file under assets/icons/ (UI chrome)
   or assets/icons/weather/ (forecast glyphs; species glyphs live in
   assets/icons/ too). This module's only job is finding <svg data-icon="name">
   placeholders and filling them in — it contains no path data of its own,
   so replacing an icon is purely a matter of swapping the file at
   assets/icons/<name>.svg, no code changes required.

   A placeholder looks like:
     <svg class="icon" viewBox="0 0 24 24" data-icon="calendar"></svg>
   "weather/sunny" etc. addresses the weather subfolder.
   ========================================================================= */

const failures = [];
let alertScheduled = false;

async function hydrateOne(el){
  const name = el.dataset.icon;
  if(!name) return;
  try{
    const svgText = await fetchAsset('assets/icons/' + name + '.svg');
    // The placeholder's viewBox in HTML/JS is just a sane default — the
    // fetched file's own viewBox is the source of truth, so icons can be
    // redrawn on a different canvas size without any code changes.
    const vb = svgText.match(/<svg[^>]*\sviewBox="([^"]+)"/);
    if(vb) el.setAttribute('viewBox', vb[1]);
    el.innerHTML = stripSvgWrapper(svgText);
  } catch(e){
    failures.push(name + ' — ' + e.message);
    // TEMPORARY DEBUG AID: surface failures via alert() since this device has
    // no console access (same pattern as the window.onerror handler in
    // app.js). Batches into one alert per animation frame instead of firing
    // one per icon. Safe to remove once icons are confirmed working.
    if(!alertScheduled){
      alertScheduled = true;
      requestAnimationFrame(() => {
        alert('Icon(s) failed to load:\n' + [...new Set(failures)].join('\n'));
        alertScheduled = false;
        failures.length = 0;
      });
    }
  }
}

/* Fills in every data-icon placeholder under root (default: whole
   document). Safe to call repeatedly on the same root — e.g. after
   re-rendering a list of to-dos or calendar rows — since fetchAsset caches
   by URL, so repeat calls resolve from cache rather than re-fetching. */
export function hydrateIcons(root){
  (root || document).querySelectorAll('[data-icon]').forEach(hydrateOne);
}

export function initIcons(){
  hydrateIcons(document);
}
