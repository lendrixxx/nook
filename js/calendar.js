import { $, escapeHtml, localDateKey } from './utils.js';
import * as storage from './storage.js';
import { goToDesk, leaveDesk, getBusyReason } from './movement.js';

/* =========================================================================
   GOOGLE CALENDAR (optional — Nook works exactly as before without it)

   Auth approach: a real Authorization Code flow, but the code exchange
   (which needs a client_secret) happens in a small Cloudflare Worker you
   deploy yourself — see /worker in the repo. Nook never sees a Google
   client_secret, access_token, or refresh_token. It only ever holds an
   opaque "session id" the Worker hands back after sign-in, which is
   meaningless outside that Worker's KV store. This is what makes staying
   signed in actually work, unlike the earlier in-page popup flow: the
   Worker holds a real refresh_token and mints fresh access tokens on
   Nook's behalf whenever asked.
   ========================================================================= */
export let gcal = { connected:false, workerUrl:'https://nook-calendar-auth.lendrixlim.workers.dev', sessionId:null, calendars:[], selectedIds:['primary'], rangeDays:1, events:[], lastUpdated:null };

/* ---- state ---- */
export function loadGcalState(){
  gcal = storage.loadGcalState(gcal);
}
function saveGcalState(){
  storage.saveGcalState(gcal);
}
function gcalShowError(msg){ const el=$('gcalError'); if(el) el.textContent = msg; }

/* ---- UI toggling (hides all calendar UI when disconnected, per spec) ---- */
export function initGcalUI(){
  $('calDisconnected').style.display = gcal.connected ? 'none' : 'block';
  $('calConnected').style.display = gcal.connected ? 'block' : 'none';
  $('calProp').style.display = gcal.connected ? 'flex' : 'none';
  $('gcalUpdatedHint').textContent = gcal.lastUpdated
    ? 'Last updated ' + new Date(gcal.lastUpdated).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
    : '';
  if(gcal.connected) renderCalendarPicker();
  $('calRangePicker').querySelectorAll('.range-chip').forEach(c => {
    c.classList.toggle('active', parseInt(c.dataset.days,10) === gcal.rangeDays);
  });
  $('calSheetTitle').innerHTML = '<svg class="icon"><use href="#icon-calendar"/></svg>' + (gcal.rangeDays === 1 ? 'Today' : gcal.rangeDays === 3 ? 'Next 3 days' : 'Next 7 days');
}

/* ---- auth: redirect to the Worker, which redirects to Google, which
   redirects back to the Worker, which redirects back here with either
   ?nook_session=... (success) or ?gcal_error=... (failure) ---- */
function gcalConnect(){
  const returnTo = window.location.origin + window.location.pathname;
  window.location.href = gcal.workerUrl + '/auth/start?return_to=' + encodeURIComponent(returnTo);
}
function gcalDisconnect(){
  if(gcal.workerUrl && gcal.sessionId){
    fetch(gcal.workerUrl + '/auth/logout?session=' + encodeURIComponent(gcal.sessionId)).catch(()=>{});
  }
  gcal = { connected:false, workerUrl:gcal.workerUrl, sessionId:null, events:[], lastUpdated:null };
  saveGcalState();
  initGcalUI();
  renderCalendarList();
  evaluateCalendarBusy();
}

/* Check the URL for a session id or error coming back from the Worker.
   Runs once on boot, before anything else touches the calendar UI. */
export function consumeGcalRedirectParams(){
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('nook_session');
  const errorParam = params.get('gcal_error');
  if(!sessionId && !errorParam) return;

  history.replaceState({}, '', window.location.pathname);

  if(errorParam === 'access_denied'){
    gcalShowError('Calendar permission was not granted.');
  } else if(errorParam === 'no_refresh_token'){
    gcalShowError('Google didn\'t return a refresh token — try disconnecting Nook\'s access in your Google Account settings, then connect again.');
  } else if(errorParam){
    gcalShowError('Connection failed (' + errorParam + '). Double check the Worker URL and its Google redirect URI.');
  }
  if(sessionId){
    gcal.connected = true;
    gcal.sessionId = sessionId;
    saveGcalState();
  }
}

/* ---- calendar picker ---- */
export async function fetchCalendarList(){
  if(!gcal.connected || !gcal.workerUrl || !gcal.sessionId) return;
  try{
    const res = await fetch(gcal.workerUrl + '/calendar/list?session=' + encodeURIComponent(gcal.sessionId));
    if(!res.ok) return;
    const data = await res.json();
    gcal.calendars = data.items || [];
    saveGcalState();
    renderCalendarPicker();
  } catch(e){ /* stay with whatever calendar list we already had cached */ }
}
function renderCalendarPicker(){
  const el = $('gcalCalendarPicker');
  if(!el) return;
  if(!gcal.calendars || gcal.calendars.length === 0){
    el.innerHTML = '<p class="hint">Loading your calendars…</p>';
    return;
  }
  el.innerHTML = gcal.calendars.map(c => {
    const checked = gcal.selectedIds.includes(c.id) ? 'checked' : '';
    return '<label class="cal-pick-row">'
      + '<input type="checkbox" data-cal-id="'+escapeHtml(c.id)+'" '+checked+'>'
      + '<span class="cal-pick-dot" style="background:'+(c.backgroundColor||'#7E9B7E')+'"></span>'
      + '<span>'+escapeHtml(c.summary || c.id)+(c.primary ? ' (primary)' : '')+'</span>'
      + '</label>';
  }).join('');
  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.onchange = () => {
      const id = cb.dataset.calId;
      if(cb.checked){ if(!gcal.selectedIds.includes(id)) gcal.selectedIds.push(id); }
      else{ gcal.selectedIds = gcal.selectedIds.filter(x => x !== id); }
      saveGcalState();
      fetchCalendarEvents();
    };
  });
}

/* ---- fetching (pulls each selected calendar in parallel, merges + sorts) ---- */
export async function fetchCalendarEvents(){
  if(!gcal.connected || !gcal.sessionId || !gcal.workerUrl) return;
  if(gcal.selectedIds.length === 0){ gcal.events = []; saveGcalState(); renderCalendarList(); evaluateCalendarBusy(); return; }

  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);
  const endOfRange = new Date(startOfDay);
  endOfRange.setDate(endOfRange.getDate() + (gcal.rangeDays - 1));
  endOfRange.setHours(23,59,59,999);
  const timeMin = encodeURIComponent(startOfDay.toISOString());
  const timeMax = encodeURIComponent(endOfRange.toISOString());

  try{
    const results = await Promise.all(gcal.selectedIds.map(async (calId) => {
      const url = gcal.workerUrl + '/calendar/events'
        + '?session=' + encodeURIComponent(gcal.sessionId)
        + '&calendarId=' + encodeURIComponent(calId)
        + '&timeMin=' + timeMin + '&timeMax=' + timeMax;
      const res = await fetch(url);
      if(res.status === 401){ throw { code:401 }; }
      if(!res.ok) return []; // one calendar failing shouldn't blank out the others
      const data = await res.json();
      const calMeta = gcal.calendars.find(c => c.id === calId);
      return (data.items||[]).map(ev => ({
        id: calId + ':' + ev.id,
        title: ev.summary || '(untitled event)',
        start: ev.start && (ev.start.dateTime || ev.start.date),
        end: ev.end && (ev.end.dateTime || ev.end.date),
        allDay: !(ev.start && ev.start.dateTime),
        color: calMeta ? calMeta.backgroundColor : '#7E9B7E'
      }));
    }));

    gcal.events = results.flat().sort((a,b) => {
      const ta = a.start ? new Date(a.start).getTime() : 0;
      const tb = b.start ? new Date(b.start).getTime() : 0;
      return ta - tb;
    });
    gcal.lastUpdated = Date.now();
    saveGcalState();
    initGcalUI();
    renderCalendarList();
    evaluateCalendarBusy();
  } catch(e){
    if(e && e.code === 401){
      gcal.connected = false; gcal.sessionId = null;
      saveGcalState(); initGcalUI();
      gcalShowError('Your calendar connection expired or was revoked. Reconnect to keep seeing your schedule.');
      return;
    }
    // Offline, or the Worker/API is unreachable — fall back to whatever
    // was last cached, and say so.
    $('gcalUpdatedHint').textContent = gcal.lastUpdated
      ? 'Offline — showing schedule from ' + new Date(gcal.lastUpdated).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
      : 'Could not reach your calendar Worker right now.';
    renderCalendarList();
  }
}

/* ---- rendering ---- */
function fmtEventTime(iso){
  if(!iso) return '';
  return new Date(iso).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}
function dayLabel(dateKey){
  if(dateKey.startsWith('Ongoing')) return dateKey;

  const today = new Date();
  today.setHours(0,0,0,0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate()+1);

  const d = new Date(dateKey + 'T00:00:00');

  const dateText = d.toLocaleDateString([], {
    month:'short',
    day:'numeric'
  });

  if(dateKey === localDateKey(today)) return `Today, ${dateText}`;
  if(dateKey === localDateKey(tomorrow)) return `Tomorrow, ${dateText}`;

  return d.toLocaleDateString([], {
    weekday:'long',
    month:'short',
    day:'numeric'
  });
}

function eventRowHtml(ev, now){
  const startMs = ev.start ? new Date(ev.start).getTime() : null;
  const endMs = ev.end ? new Date(ev.end).getTime() : null;
  const isNow = !ev.allDay && startMs!=null && endMs!=null && now>=startMs && now<endMs;
  const isSoon = !ev.allDay && !isNow && startMs!=null && (startMs-now) > 0 && (startMs-now) <= 30*60000;
  const badge = isNow ? '<div class="todo-date cal-now">now</div>' : isSoon ? '<div class="todo-date cal-soon">soon</div>' : '';
  const timeLabel = ev.allDay ? 'All day' : (fmtEventTime(ev.start) + (ev.end ? ' – ' + fmtEventTime(ev.end) : ''));
  return '<div class="todo-row">'
    + '<div class="todo-date">'+timeLabel+'</div>'
    + '<span class="cal-pick-dot" style="background:'+(ev.color||'#7E9B7E')+'"></span>'
    + '<div class="todo-text">'+escapeHtml(ev.title)+'</div>'
    + badge
    + '</div>';
}
export function renderCalendarList(){
  const el = $('calList');
  if(!el) return;
  if(!gcal.events || gcal.events.length === 0){
    el.innerHTML = '<div class="todo-empty" style="display:flex;align-items:center;justify-content:center;gap:6px;">Nothing on your calendar <svg class="icon" style="width:14px;height:14px;"><use href="#icon-mug"/></svg></div>';
  } else if(gcal.rangeDays <= 1){
    const now = Date.now();
    el.innerHTML = gcal.events.map(ev => eventRowHtml(ev, now)).join('');
  } else {
    const now = Date.now();
    const today = localDateKey(new Date());
    const groups = {};
    const ongoingEvents = [];
    gcal.events.forEach(ev => {
      const startDate = ev.start ? new Date(ev.start) : null;
      const endDate = ev.end ? new Date(ev.end) : null;
      if(!startDate) return;
      const startKey = localDateKey(startDate);
      // Google all-day end date is exclusive, so subtract 1 day
      const actualEndDate = endDate
        ? new Date(endDate.getTime() - 86400000)
        : startDate;
      const endKey = localDateKey(actualEndDate);
      const isMultiDayAllDay = ev.allDay && startKey !== endKey;
      // Only show as ongoing if today is inside the event range
      const isCurrentlyOngoing =
        isMultiDayAllDay &&
        today >= startKey &&
        today <= endKey;
      if(isCurrentlyOngoing){
        ongoingEvents.push(ev);
      } else {
        (groups[startKey] = groups[startKey] || []).push(ev);
      }
    });

    let html = '';
    // Ongoing events always appear first
    if(ongoingEvents.length > 0){
      ongoingEvents.forEach(ev => {
        const startDate = new Date(ev.start);
        const endDate = new Date(ev.end);
        endDate.setDate(endDate.getDate() - 1);
        html += '<div class="cal-day-header">'
          + 'Ongoing, '
          + startDate.toLocaleDateString([], {day:'2-digit', month:'short'})
          + ' - '
          + endDate.toLocaleDateString([], {day:'2-digit', month:'short'})
          + '</div>';
        html += eventRowHtml(ev, now);
      });
    }
    // Normal events grouped by start date
    const sortedKeys = Object.keys(groups).sort();
    html += sortedKeys.map(key =>
      '<div class="cal-day-header">' + dayLabel(key) + '</div>' +
      groups[key].map(ev => eventRowHtml(ev, now)).join('')
    ).join('');

    el.innerHTML = html;
  }
  $('calUpdatedInSheet').textContent = gcal.lastUpdated
    ? 'Last updated ' + new Date(gcal.lastUpdated).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
    : '';
}

/* ---- character interaction: head to the desk ~30 min before something starts ---- */
export function evaluateCalendarBusy(){
  if(!gcal.connected || !gcal.events || gcal.events.length === 0){
    leaveDesk('calendar');
    return;
  }
  const now = Date.now();
  const soon = gcal.events.some(ev => {
    if(!ev.start || ev.allDay) return false;
    const startMs = new Date(ev.start).getTime();
    const endMs = ev.end ? new Date(ev.end).getTime() : startMs;
    return (startMs - now) <= 30*60000 && now < endMs;
  });
  if(soon){ if(getBusyReason() !== 'todo') goToDesk('calendar'); }
  else leaveDesk('calendar');
}

/* ---- sheet open/close ---- */
function openCalSheet(){ $('calSheet').classList.add('open'); $('sheetBackdrop').classList.add('open'); renderCalendarList(); }
export function closeCalSheet(){ $('calSheet').classList.remove('open'); $('sheetBackdrop').classList.remove('open'); }

/* ---- wiring ---- */
export function initCalendar(){
  $('gcalConnectBtn').onclick = gcalConnect;
  $('gcalDisconnectBtn').onclick = gcalDisconnect;
  $('gcalRefreshBtn').onclick = fetchCalendarEvents;
  $('calProp').onclick = openCalSheet;
  $('closeCalBtn').onclick = closeCalSheet;
  $('calRangePicker').querySelectorAll('.range-chip').forEach(chip => {
    chip.onclick = () => {
      gcal.rangeDays = parseInt(chip.dataset.days, 10);
      saveGcalState();
      $('calRangePicker').querySelectorAll('.range-chip').forEach(c => c.classList.toggle('active', c===chip));
      $('calSheetTitle').innerHTML = '<svg class="icon"><use href="#icon-calendar"/></svg>' + (gcal.rangeDays === 1 ? 'Today' : gcal.rangeDays === 3 ? 'Next 3 days' : 'Next 7 days');
      fetchCalendarEvents();
    };
  });
}
