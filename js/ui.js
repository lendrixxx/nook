import { $ } from './utils.js';
import { closeSettingsSheet } from './weather.js';
import { closeTodoSheet } from './todos.js';
import { closeCalSheet } from './calendar.js';
import { closeCharacterSheet } from './companion.js';

/* ---------------- Swipe-down-to-close for bottom sheets ---------------- */
export function enableSwipeToClose(sheetEl, closeFn){
  let startY = null, currentY = 0, dragging = false;
  const threshold = 90; // px of downward drag before it counts as "close"

  sheetEl.addEventListener('touchstart', (e) => {
    if(!sheetEl.classList.contains('open')) return;
    // Only start the gesture from the top of the sheet (handle + header
    // area), so scrolling a long list inside the sheet still works normally.
    if(e.touches[0].clientY - sheetEl.getBoundingClientRect().top > 90) return;
    startY = e.touches[0].clientY;
    dragging = true;
    sheetEl.style.transition = 'none';
  }, { passive:true });

  sheetEl.addEventListener('touchmove', (e) => {
    if(!dragging || startY === null) return;
    currentY = e.touches[0].clientY - startY;
    if(currentY < 0) currentY = 0;
    sheetEl.style.transform = `translateY(${currentY}px)`;
  }, { passive:true });

  sheetEl.addEventListener('touchend', () => {
    if(!dragging) return;
    dragging = false;
    sheetEl.style.transition = '';
    sheetEl.style.transform = '';
    if(currentY > threshold) closeFn();
    currentY = 0;
    startY = null;
  });
}

export function initUI(){
  $('sheetBackdrop').onclick = () => {
    closeSettingsSheet();
    closeTodoSheet();
    closeCalSheet();
    closeCharacterSheet();
  };

  enableSwipeToClose($('sheet'), closeSettingsSheet);
  enableSwipeToClose($('todoSheet'), closeTodoSheet);
  enableSwipeToClose($('calSheet'), closeCalSheet);
  enableSwipeToClose($('characterSheet'), closeCharacterSheet);
}
