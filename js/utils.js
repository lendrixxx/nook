/* ---------------- Generic helpers shared across modules ---------------- */

export const $ = id => document.getElementById(id);

/* Local calendar-day key (YYYY-MM-DD) — deliberately NOT toISOString(),
   since that converts to UTC and can mislabel early-morning/late-night
   events depending on the person's timezone offset. */
export function localDateKey(d){
  const dt = (d instanceof Date) ? d : new Date(d);
  return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
}

export function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

export function shade(hex, percent){
  const num = parseInt(hex.replace('#',''),16);
  let r=(num>>16)+Math.round(255*percent/100);
  let g=((num>>8)&0xff)+Math.round(255*percent/100);
  let b=(num&0xff)+Math.round(255*percent/100);
  r=Math.min(255,Math.max(0,r)); g=Math.min(255,Math.max(0,g)); b=Math.min(255,Math.max(0,b));
  return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
}

export function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

export function pts(arr){ return arr.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' '); }

/* ---------------- Shared asset fetch cache ----------------
   Used by both room.js (furniture/decorations) and companion.js
   (character + accessory SVGs) — a single cache means switching
   themes/characters back and forth doesn't re-fetch the same file. */
const assetCache = {};
export function fetchAsset(url){
  if(assetCache[url]) return assetCache[url];
  const p = fetch(url).then(r => {
    if(!r.ok) throw new Error('Asset not found: ' + url);
    return r.text();
  });
  assetCache[url] = p;
  return p;
}

/* Strips the outer <svg ...> wrapper so a fetched asset's inner markup
   can be re-wrapped in a positioned/sized <svg> or <g> at the call site. */
export function stripSvgWrapper(svgText){
  return svgText.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}
