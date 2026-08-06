import { $, shade } from './utils.js';

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
export function updateBackground(w){
  const sky = SKY_BG[w.base] || SKY_BG.cloudy;
  $('skyBg').style.background = w.isDay ? sky.day : sky.night;

  const hill = HILL_COLOR[w.base] || HILL_COLOR.cloudy;
  const hillBack = shade(hill, w.isDay ? 12 : -20);
  const hillFront = shade(hill, w.isDay ? -6 : -34);

  let sun = '';
  if(w.base==='sunny' || w.base==='partly'){
    sun = w.isDay
      ? '<circle cx="345" cy="55" r="22" fill="#FFE9A8"/><circle cx="345" cy="55" r="34" fill="#FFE9A8" opacity="0.35"/>'
      : '<circle cx="345" cy="55" r="16" fill="#F1EAFB"/><circle cx="345" cy="55" r="26" fill="#F1EAFB" opacity="0.25"/>';
  }
  let clouds = '';
  if(w.base==='cloudy' || w.base==='partly' || w.base==='foggy'){
    clouds = '<ellipse cx="330" cy="45" rx="28" ry="11" fill="#fff" opacity="0.55"/><ellipse cx="355" cy="52" rx="20" ry="9" fill="#fff" opacity="0.45"/>';
  }

  $('bgScene').innerHTML =
    sun + clouds +
    '<path d="M0 380 L0 300 Q100 250 200 300 T400 290 L400 380 Z" fill="'+hillBack+'"/>' +
    '<path d="M0 380 L0 335 Q120 300 220 335 T400 325 L400 380 Z" fill="'+hillFront+'"/>';
}
