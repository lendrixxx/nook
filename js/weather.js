import { $, localDateKey } from './utils.js';
import { loadForecastMode, saveForecastMode } from './storage.js';
import { state } from './state.js';
import { updateBackground } from './background.js';
import { seedParticles } from './particles.js';
import { drawCharacter } from './companion.js';
import { resolveIdleState } from './movement.js';
import { hydrateIcons } from './icons.js';

const stageEl = $('stage');
const flashEl = $('flash');
const windowFogEl = $('windowFog');

/* ---------------- Weather classification (Open-Meteo WMO codes) ---------------- */
function classify(code, windKph){
  let base;
  if(code === 0) base='sunny';
  else if(code === 1 || code === 2) base='partly';
  else if(code === 3) base='cloudy';
  else if(code === 45 || code === 48) base='foggy';
  else if((code>=51&&code<=67) || (code>=80&&code<=82)) base='rainy';
  else if((code>=71&&code<=77) || code===85 || code===86) base='snowy';
  else if(code>=95) base='thunder';
  else base='cloudy';
  return { base, windy: windKph >= 28 };
}
const CONDITION_LABEL = { sunny:'Clear sky', partly:'Partly cloudy', cloudy:'Overcast', foggy:'Foggy', rainy:'Rainy', snowy:'Snowy', thunder:'Thunderstorm' };
const WINDOW_SKY = {
  sunny:   { day:['#8FCBEA','#FFE8B8'], night:['#0F1B3C','#5C4B7A'] },
  partly:  { day:['#9FCBE0','#F3E9D2'], night:['#16203F','#5A5178'] },
  cloudy:  { day:['#B7C2C2','#E6E1D2'], night:['#232A33','#565049'] },
  foggy:   { day:['#C9CFCB','#EDE7DA'], night:['#2B3130','#5A544A'] },
  rainy:   { day:['#6E8CA0','#B9C2B4'], night:['#141B2A','#3C4A52'] },
  snowy:   { day:['#C9DCE8','#F5F1E8'], night:['#1C2536','#57596A'] },
  thunder: { day:['#4A5568','#8B8C7A'], night:['#0B0E1A','#333243'] }
};

const FORECAST_GLYPH = { sunny:'sunny', partly:'partly', cloudy:'cloudy', foggy:'foggy', rainy:'rainy', snowy:'snowy', thunder:'thunder' };
function weatherIconSVG(base, cls){ return '<svg class="'+(cls||'fd-icon')+'" viewBox="0 0 24 24" data-icon="weather/'+(FORECAST_GLYPH[base]||'cloudy')+'"></svg>'; }
let forecastMode = loadForecastMode();
export function renderForecast(){
  const el = $('forecastRow');
  if(!el) return;
  el.classList.toggle('hourly-mode', forecastMode === 'hourly');
  if(forecastMode === 'hourly') renderHourlyForecast(el);
  else renderWeeklyForecast(el);
  hydrateIcons(el);
}
function renderWeeklyForecast(el){
  if(!state.forecast) return;
  const todayKey = localDateKey(new Date());
  el.innerHTML = state.forecast.map(d => {
    const isToday = d.date === todayKey;
    const label = isToday ? 'Today' : new Date(d.date+'T00:00:00').toLocaleDateString([], { weekday:'short' });
    return '<div class="forecast-day'+(isToday?' fd-now':'')+'">'
      + '<span class="fd-name">'+label+'</span>'
      + weatherIconSVG(d.base)
      + '<span class="fd-max">'+Math.round(d.max)+'°</span>'
      + '<span class="fd-min">'+Math.round(d.min)+'°</span>'
      + '</div>';
  }).join('');
}
function renderHourlyForecast(el){
  if(!state.hourly || state.hourly.length === 0){ el.innerHTML = '<div class="todo-empty">Hourly data unavailable</div>'; return; }
  el.innerHTML = state.hourly.map((h, idx) => {
    const isNow = idx === 0;
    const label = isNow ? 'Now' : new Date(h.time).toLocaleTimeString([], { hour:'numeric' });
    return '<div class="forecast-day'+(isNow?' fd-now':'')+'">'
      + '<span class="fd-name">'+label+'</span>'
      + weatherIconSVG(h.base)
      + '<span class="fd-max">'+Math.round(h.temp)+'°</span>'
      + '</div>';
  }).join('');
}

/* ---------------- Scene / weather rendering ---------------- */
export function renderScene(){
  if(!state.weather) return;
  const w = state.weather;
  updateBackground(w);
  const wp = WINDOW_SKY[w.base] || WINDOW_SKY.cloudy;
  const stops = w.isDay ? wp.day : wp.night;
  const s0 = $('winStop0'), s1 = $('winStop1');
  if(s0) s0.setAttribute('stop-color', stops[0]);
  if(s1) s1.setAttribute('stop-color', stops[1]);
  windowFogEl.style.opacity = w.base==='foggy' ? 0.85 : 0;
  stageEl.classList.toggle('windy', w.windy);

  if(w.base==='rainy'){ seedParticles('rain'); }
  else if(w.base==='thunder'){ seedParticles('rain'); flickerLightning(); }
  else if(w.base==='snowy'){ seedParticles('snow'); }
  else { seedParticles('none'); }

  drawCharacter();

  $('condVal').textContent = CONDITION_LABEL[w.base] + (w.windy ? ' · Breezy' : '');
  $('feelVal').textContent = 'Feels like ' + Math.round(w.feels) + '°';
  $('tempVal').innerHTML = Math.round(w.temp) + '<sup>°C</sup>';
  $('windVal').textContent = Math.round(w.windKph) + ' km/h';
  $('humVal').textContent = w.humidity + '%';
  $('updVal').textContent = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  renderForecast();

  resolveIdleState();
}

let lightningTimer = null;
function flickerLightning(){
  clearTimeout(lightningTimer);
  const loop = () => {
    if(state.weather && state.weather.base==='thunder'){
      flashEl.style.transition='none';
      flashEl.style.opacity = 0.35;
      requestAnimationFrame(()=>{ flashEl.style.transition='opacity .5s ease'; flashEl.style.opacity = 0; });
    }
    lightningTimer = setTimeout(loop, 4000+Math.random()*5000);
  };
  loop();
}

/* ---------------- Weather fetching (Open-Meteo, no key needed) ---------------- */
export async function fetchWeather(lat, lon){
  const url = 'https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=7'
    + '&hourly=temperature_2m,weather_code&timezone=auto';
  const res = await fetch(url);
  const data = await res.json();
  const cur = data.current;
  const cls = classify(cur.weather_code, cur.wind_speed_10m);
  state.weather = {
    temp: cur.temperature_2m, feels: cur.apparent_temperature, humidity: cur.relative_humidity_2m,
    windKph: cur.wind_speed_10m, isDay: cur.is_day === 1, base: cls.base, windy: cls.windy
  };
  if(data.daily){
    state.forecast = data.daily.time.map((d,i) => ({
      date: d,
      base: classify(data.daily.weather_code[i], 0).base,
      max: data.daily.temperature_2m_max[i],
      min: data.daily.temperature_2m_min[i]
    }));
  }
  if(data.hourly){
    const now = new Date();
    const all = data.hourly.time.map((t,i) => ({
      time: t,
      base: classify(data.hourly.weather_code[i], 0).base,
      temp: data.hourly.temperature_2m[i]
    }));
    // find the last hourly entry at/before now — that's the current hour's bucket
    let startIdx = 0;
    for(let i = 0; i < all.length; i++){
      if(new Date(all[i].time) <= now) startIdx = i;
      else break;
    }
    state.hourly = all.slice(startIdx, startIdx + 24);
  }

  renderScene();
}
async function reverseGeocodeName(lat, lon){
  try{
    const url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude='+lat+'&longitude='+lon+'&localityLanguage=en';
    const res = await fetch(url);
    const data = await res.json();
    state.locationName = data.city || data.locality || data.principalSubdivision || 'Your location';
    state.locationSub = [data.principalSubdivision, data.countryName].filter(Boolean).join(', ');
  } catch(e){
    state.locationName = 'Your location';
    state.locationSub = lat.toFixed(2) + ', ' + lon.toFixed(2);
  }
  $('placeName').textContent = state.locationName;
  $('placeSub').textContent = state.locationSub;
}
async function searchCity(query){
  const url = 'https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(query)+'&count=5&language=en&format=json';
  const res = await fetch(url);
  const data = await res.json();
  return data.results || [];
}
function setLocationFromResult(r){
  state.lat = r.latitude; state.lon = r.longitude;
  state.locationName = r.name;
  state.locationSub = [r.admin1, r.country].filter(Boolean).join(', ');
  $('placeName').textContent = state.locationName;
  $('placeSub').textContent = state.locationSub;
  fetchWeather(state.lat, state.lon);
  closeSettingsSheet();
}

/* ---------------- Geolocation bootstrap ---------------- */
export function locate(){
  $('statusMsg').textContent = 'Finding your weather…';
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.lat = pos.coords.latitude; state.lon = pos.coords.longitude;
        reverseGeocodeName(state.lat, state.lon);
        fetchWeather(state.lat, state.lon).then(()=>{ $('statusMsg').textContent=''; });
      },
      err => {
        $('statusMsg').textContent = 'Location off — search a city in Settings.';
        $('placeName').textContent = 'Set a location';
        $('placeSub').textContent = 'Tap settings to search';
      },
      { timeout:8000 }
    );
  } else { $('statusMsg').textContent = 'Search a city in Settings.'; }
}

/* ---------------- Settings sheet ---------------- */
export function openSettingsSheet(){ $('sheet').classList.add('open'); $('sheetBackdrop').classList.add('open'); }
export function closeSettingsSheet(){ $('sheet').classList.remove('open'); $('sheetBackdrop').classList.remove('open'); }

export function initWeatherUI(){
  $('settingsBtn').onclick = openSettingsSheet;
  $('closeSheetBtn').onclick = closeSettingsSheet;
  $('refreshBtn').onclick = () => { if(state.lat!=null) fetchWeather(state.lat, state.lon); };
  document.querySelectorAll('.forecast-toggle').forEach(t => {
    t.onclick = () => {
      forecastMode = t.dataset.mode;
      saveForecastMode(forecastMode);
      document.querySelectorAll('.forecast-toggle').forEach(x => x.classList.toggle('active', x===t));
      renderForecast();
    };
  });

  let searchDebounce;
  $('citySearch').addEventListener('input', e=>{
    clearTimeout(searchDebounce);
    const q = e.target.value.trim();
    if(q.length < 2){ $('cityResults').innerHTML=''; return; }
    searchDebounce = setTimeout(async ()=>{
      const results = await searchCity(q);
      $('cityResults').innerHTML = '';
      results.forEach(r=>{
        const div = document.createElement('div');
        div.textContent = r.name + (r.admin1 ? ', '+r.admin1:'') + (r.country ? ', '+r.country:'');
        div.onclick = () => setLocationFromResult(r);
        $('cityResults').appendChild(div);
      });
    }, 350);
  });
}

/* Sets the initial active class on the Hourly/Weekly toggle at boot,
   matching whatever forecastMode was loaded from storage. */
export function applyInitialForecastToggleState(){
  document.querySelectorAll('.forecast-toggle').forEach(x => x.classList.toggle('active', x.dataset.mode===forecastMode));
}
