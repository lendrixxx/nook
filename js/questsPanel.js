/* =========================================================================
   DAILY QUESTS PANEL — renders the quests + XP page of the infocard,
   third swipe page alongside weather and companion stats.

   Pure UI layer: all quest logic (progress, completion, XP awarding,
   daily reset) lives in quests.js / xp.js. This file only reads that
   state and paints it, same division of responsibility statsPanel.js
   uses for the meters.
   ========================================================================= */

import { $ } from './utils.js';
import { getQuestsView, evaluateQuests } from './quests.js';
import { getLevelInfo } from './xp.js';
import { loadXpTotal } from './storage.js';

export function initQuestsPanel(){
  // Catches anything logged before this module was mounted, and applies
  // the daily reset if it's a new day since the app was last opened.
  evaluateQuests();
  renderQuestsPanel();

  // Fired by stats.js the instant a food/water/workout log completes a
  // quest — lets the panel update immediately rather than waiting for
  // the next periodic render tick.
  window.addEventListener('nook:quests-evaluated', (e) => {
    renderQuestList(e.detail && e.detail.quests ? e.detail.quests : getQuestsView());
    renderXpBar();
    (e.detail && e.detail.newlyAwarded || []).forEach(showQuestToast);
  });
}

export function renderQuestsPanel(){
  renderXpBar();
  renderQuestList(getQuestsView());
}

function renderXpBar(){
  const levelEl = $('xpLevel');
  if(!levelEl) return; // panel markup not present (or not yet mounted)

  const info = getLevelInfo(loadXpTotal());
  levelEl.textContent = info.level;
  $('xpTotalVal').textContent = info.totalXp;
  $('xpFill').style.width = Math.round(info.progress * 100) + '%';
  $('xpRemaining').textContent = info.xpRemaining > 0
    ? `${info.xpRemaining} XP to level ${info.level + 1}`
    : 'Max level reached';
}

function renderQuestList(quests){
  const list = $('questList');
  if(!list) return;

  list.innerHTML = '';
  quests.forEach(q => {
    const pct = Math.round((q.progress / q.target) * 100);
    const el = document.createElement('div');
    el.className = 'quest' + (q.done ? ' done' : '');
    el.innerHTML = `
      <div class="quest-icon"><img src="${q.icon}" alt=""></div>
      <div class="quest-body">
        <div class="quest-row1">
          <span class="quest-label">${q.label}</span>
          <span class="quest-xp">+${q.xp} XP</span>
        </div>
        <div class="quest-desc">${q.desc} · ${q.progress}/${q.target}</div>
        <div class="quest-track"><div class="quest-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="quest-check">✓</div>
    `;
    list.appendChild(el);
  });
}

// A dedicated toast (#questToast, added in index.html) rather than
// reusing #statusMsg — that element already has its own behavior
// elsewhere (room-editing validation etc.) and quests shouldn't risk
// interfering with it.
function showQuestToast(quest){
  const toast = $('questToast');
  if(!toast) return;
  toast.textContent = `${quest.label} complete — +${quest.xp} XP`;
  toast.classList.add('show');
  clearTimeout(showQuestToast._t);
  showQuestToast._t = setTimeout(() => toast.classList.remove('show'), 2200);
}
