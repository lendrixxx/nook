import { $, shade, fetchAsset, stripSvgWrapper } from './utils.js';

/* ---------------- Outdoor background scenery ---------------- */
const SKY_BG = {
  sunny:   { day:'linear-gradient(180deg,#8FCBEA 0%,#CDEAF7 55%,#FFE8B8 100%)', night:'linear-gradient(180deg,#0F1B3C 0%,#2B3A6B 60%,#5C4B7A 100%)' },
  partly:  { day:'linear-gradient(180deg,#9FCBE0 0%,#DCE9EC 60%,#F3E9D2 100%)', night:'linear-gradient(180deg,#16203F 0%,#33406A 60%,#5A5178 100%)' },
  cloudy:  { day:'linear-gradient(180deg,#B7C2C2 0%,#D6DAD3 60%,#E6E1D2 100%)', night:'linear-gradient(180deg,#232A33 0%,#3A414A 60%,#565049 100%)' },
  foggy:   { day:'linear-gradient(180deg,#C9CFCB 0%,#DEDED6 60%,#EDE7DA 100%)', night:'linear-gradient(180deg,#2B3130 0%,#454B48 60%,#5A544A 100%)' },
  rainy:   { day:'linear-gradient(180deg,#6E8CA0 0%,#93AAB2 60%,#B9C2B4 100%)', night:'linear-gradient(180deg,#141B2A 0%,#26344A 60%,#3C4A52 100%)' },
  snowy:   { day:'linear-gradient(180deg,#C9DCE8 0%,#E7EEF1 60%,#F5F1E8 100%)', night:'linear-gradient(180deg,#1C2536 0%,#3A455A 60%,#57596A 100%)' },
  thunder: { day:'linear-gradient(180deg,#4A5568 0%,#6B7686 60%,#8B8C7A 100%)', night:'linear-gradient(180deg,#0B0E1A 0%,#20263A 60%,#333243 100%)' }
};
const HILL_COLOR = {
  sunny:'#8FB88A', partly:'#8FB88A', cloudy:'#7C9A80', foggy:'#95A398',
  rainy:'#5F7B6C', snowy:'#EDF3F3', thunder:'#495A50'
};

/* Weather artwork (sun/moon/cloud/hills) lives in assets/icons/weather/ as
   plain files already positioned to match the 400x380 bgScene viewBox —
   this function's job is purely deciding WHICH pieces apply and, for the
   hills (the one piece whose color genuinely depends on weather + time of
   day), setting the CSS variables their fill is bound to. No path data
   is generated here. */
let renderToken = 0;
export async function updateBackground(w){
  const myToken = ++renderToken;
  const bgScene = $('bgScene');

  $('skyBg').style.background = w.isDay ? (SKY_BG[w.base]||SKY_BG.cloudy).day : (SKY_BG[w.base]||SKY_BG.cloudy).night;

  const hill = HILL_COLOR[w.base] || HILL_COLOR.cloudy;
  const hillBack = shade(hill, w.isDay ? 12 : -20);
  const hillFront = shade(hill, w.isDay ? -6 : -34);

  const pieces = [];
  if(w.base==='sunny' || w.base==='partly') pieces.push(w.isDay ? 'sun' : 'moon');
  if(w.base==='cloudy' || w.base==='partly' || w.base==='foggy') pieces.push('cloud');
  pieces.push('hill-back', 'hill-front');

  const fetched = await Promise.all(pieces.map(name => fetchAsset('assets/icons/weather/'+name+'.svg').catch(()=>null)));
  if(myToken !== renderToken) return; // a newer weather update started before this one finished

  bgScene.innerHTML = fetched.map(svgText => svgText ? stripSvgWrapper(svgText) : '').join('');
  bgScene.style.setProperty('--hill-back-color', hillBack);
  bgScene.style.setProperty('--hill-front-color', hillFront);
}
