import { $, escapeHtml } from './utils.js';
import * as storage from './storage.js';
import { state, todosDueOrOverdue } from './state.js';
import { isCharAsleep, drawCharacter, setCompanionState } from './companion.js';
import { updatePlantMood } from './room.js';
import { goToDesk, leaveDesk } from './movement.js';
import { evaluateCalendarBusy } from './calendar.js';
import { hydrateIcons } from './icons.js';

/* ---------------- To-dos ---------------- */
state.todos = [];
function loadTodos(){
  state.todos = storage.loadTodos();
}
function saveTodos(){
  storage.saveTodos(state.todos);
}
function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString([], { month:'short', day:'numeric' });
}
export function renderTodos(){
  const active = state.todos.filter(t=>!t.done).sort((a,b)=>{
    if(!a.date && !b.date) return 0;
    if(!a.date) return 1;
    if(!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
  const done = state.todos.filter(t=>t.done).sort((a,b)=> (b.completedAt||'').localeCompare(a.completedAt||''));

  const activeEl = $('todoActiveList');
  activeEl.innerHTML = active.length ? active.map(t =>
    '<div class="todo-row">'
    + '<div class="todo-check" data-id="'+t.id+'"><svg class="icon" viewBox="0 0 24 24" data-icon="check"></svg></div>'
    + '<div class="todo-text">'+escapeHtml(t.text)+'</div>'
    + (t.date ? '<div class="todo-date">'+fmtDate(t.date)+'</div>' : '')
    + '<button class="todo-del" data-id="'+t.id+'"><svg class="icon" viewBox="0 0 24 24" data-icon="trash"></svg></button>'
    + '</div>'
  ).join('') : '<div class="todo-empty">Nothing on the list yet — add something above.</div>';

  const histEl = $('todoHistoryList');
  histEl.innerHTML = done.length ? done.map(t =>
    '<div class="hist-row">'
    + '<div class="todo-check checked" data-id="'+t.id+'"><svg class="icon" viewBox="0 0 24 24" data-icon="check"></svg></div>'
    + '<div class="todo-text">'+escapeHtml(t.text)+'</div>'
    + '<div class="hist-when">'+(t.completedAt ? new Date(t.completedAt).toLocaleDateString([], {month:'short', day:'numeric'}) : '')+'</div>'
    + '</div>'
  ).join('') : '<div class="todo-empty">Completed tasks will show up here.</div>';

  activeEl.querySelectorAll('.todo-check').forEach(el => el.onclick = () => toggleTodo(el.dataset.id));
  activeEl.querySelectorAll('.todo-del').forEach(el => el.onclick = () => deleteTodo(el.dataset.id));
  histEl.querySelectorAll('.todo-check').forEach(el => el.onclick = () => toggleTodo(el.dataset.id));
  hydrateIcons(activeEl);
  hydrateIcons(histEl);
  updateTodoBadge();
  updatePlantMood();
  drawCharacter();
}
function toggleTodo(id){
  const t = state.todos.find(x=>x.id===id);
  if(!t) return;
  t.done = !t.done;
  t.completedAt = t.done ? new Date().toISOString() : null;
  saveTodos();
  renderTodos();
  if(t.done && !isCharAsleep()){
    setCompanionState('celebrate');
    setTimeout(() => { if(!isCharAsleep()) drawCharacter(); }, 1600);
  }
}
function deleteTodo(id){
  state.todos = state.todos.filter(x=>x.id!==id);
  saveTodos();
  renderTodos();
}

/* ---------------- Due-date awareness ---------------- */
/* iOS Safari does not support scheduled background push notifications for
   a plain static site like this (that needs a push server + native app).
   What we CAN do reliably: (1) always show a badge dot on the to-do button
   when something is due today or overdue, and (2) fire a real OS
   notification the moment the app is opened, if the person has granted
   permission. It won't wake your phone while the app is closed — but
   it will greet you the next time you open it. */
function updateTodoBadge(){
  const due = todosDueOrOverdue();
  $('todoProp').classList.toggle('has-due', due.length > 0);
}
export function notifyDueTodos(){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const due = todosDueOrOverdue();
  if(due.length === 0) return;
  const title = due.length === 1 ? 'One task waiting' : due.length + ' tasks waiting';
  const body = due.slice(0,3).map(t => t.text).join(', ') + (due.length > 3 ? '…' : '');
  try{ new Notification(title, { body, icon:'icon-192.png' }); } catch(e){}
}
function requestNotifyPermission(){
  if(!('Notification' in window)){ alert('Notifications are not supported in this browser.'); return; }
  Notification.requestPermission().then(p => {
    $('notifyBtn').textContent = p === 'granted' ? 'Reminders on' : 'Enable reminders';
  });
}

/* ---------------- Todo sheet ---------------- */
function openTodoSheet(){
  $('todoSheet').classList.add('open');
  $('sheetBackdrop').classList.add('open');
  goToDesk('todo');
}
export function closeTodoSheet(){
  const wasOpen = $('todoSheet').classList.contains('open');
  $('todoSheet').classList.remove('open');
  $('sheetBackdrop').classList.remove('open');
  if(wasOpen){ leaveDesk('todo'); evaluateCalendarBusy(); }
}

export function loadTodosAndRender(){
  loadTodos();
  renderTodos();
}

export function initTodos(){
  $('todoProp').onclick = () => {
    openTodoSheet();
  };
  $('closeTodoBtn').onclick = closeTodoSheet;

  $('addTodoBtn').onclick = () => {
    const text = $('todoText').value.trim();
    if(!text) return;
    state.todos.push({ id:'t'+Date.now(), text, date: $('todoDate').value || null, done:false, completedAt:null });
    $('todoText').value=''; $('todoDate').value=''; $('dateDisplay').textContent='';
    saveTodos();
    renderTodos();
  };
  $('historyToggle').onclick = () => {
    const el = $('todoHistoryList');
    const open = el.style.display !== 'none';
    el.style.display = open ? 'none' : 'block';
    $('historyCaret').classList.toggle('open', !open);
  };
  $('dateDisplay').onclick = () => {
    const input = $('todoDate');
    input.focus();
    if (input.showPicker) {
      try { input.showPicker(); } catch(e) { input.click(); }
    } else {
      input.click();
    }
  };

  $('todoDate').onchange = () => {
    const input = $('todoDate');
    if (input.value) {
      const d = new Date(input.value + 'T00:00:00');
      $('dateDisplay').textContent = d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
    } else {
      $('dateDisplay').textContent = '';
    }
  };

  $('notifyBtn')?.addEventListener('click', requestNotifyPermission);
}
