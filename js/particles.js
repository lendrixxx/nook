import { $ } from './utils.js';
import { VB_MIN_X, VB_MIN_Y, VB_W, VB_H, WINDOW_VB } from './room.js';

const windowFogEl = $('windowFog');
const particlesCanvas = $('particles');
const ctx = particlesCanvas.getContext('2d');

/* ---------------- Particle system (rain/snow fall past the window) ----------------
   Part 2: the canvas (and #windowFog) now live inside #stageScroll (see
   index.html), sized to the room's full natural pixel footprint
   (VB_W×VB_H) rather than just the visible #stage viewport — the room
   can be bigger than the stage and scrollable now, and this way rain
   stays correctly aligned with the window regardless of scroll
   position, instead of needing to track scroll offset separately.

   WINDOW_VB (room.js) is already in that same natural-pixel space, so
   positioning it is just a min-x/min-y offset — no more scaleX/scaleY
   stretch factor, since nothing here is stretched to fit a differently-
   sized box anymore (that stretching is exactly what used to make grid
   cells resize with the room, which Part 2 deliberately moved away
   from). */
let particles = [];
let particleMode = 'none';
let WINDOW_PX = null;

export function resizeCanvas(){
  particlesCanvas.width = VB_W * devicePixelRatio;
  particlesCanvas.height = VB_H * devicePixelRatio;
  particlesCanvas.style.width = VB_W+'px';
  particlesCanvas.style.height = VB_H+'px';
  if(WINDOW_VB){
    WINDOW_PX = { x:WINDOW_VB.x-VB_MIN_X, y:WINDOW_VB.y-VB_MIN_Y, w:WINDOW_VB.w, h:WINDOW_VB.h };
    windowFogEl.style.left = WINDOW_PX.x+'px';
    windowFogEl.style.top = WINDOW_PX.y+'px';
    windowFogEl.style.width = WINDOW_PX.w+'px';
    windowFogEl.style.height = WINDOW_PX.h+'px';
  }
  seedParticles(particleMode);
}
window.addEventListener('resize', resizeCanvas);

export function seedParticles(mode){
  particleMode = mode;
  const rect = WINDOW_PX || {x:0,y:0,w:VB_W,h:VB_H};
  const count = mode==='rain' ? 26 : mode==='snow' ? 20 : 0;
  particles = [];
  for(let i=0;i<count;i++){
    if(mode==='rain'){
      particles.push({ x:rect.x+Math.random()*rect.w, y:rect.y+Math.random()*rect.h, len:7+Math.random()*8, speed:5+Math.random()*4, drift:-1 });
    } else if(mode==='snow'){
      particles.push({ x:rect.x+Math.random()*rect.w, y:rect.y+Math.random()*rect.h, r:1+Math.random()*1.6, speed:0.5+Math.random()*0.8, sway:Math.random()*Math.PI*2 });
    }
  }
}
function animateParticles(){
  requestAnimationFrame(animateParticles);
  const rect = WINDOW_PX;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  ctx.clearRect(0,0,VB_W,VB_H);
  if(!rect || particleMode==='none') return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x,rect.y,rect.w,rect.h);
  ctx.clip();
  if(particleMode==='rain'){
    ctx.strokeStyle='rgba(255,255,255,0.6)';
    ctx.lineWidth=1.2;
    particles.forEach(p=>{
      ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x+p.drift, p.y+p.len); ctx.stroke();
      p.y += p.speed;
      if(p.y > rect.y+rect.h){ p.y=rect.y; p.x=rect.x+Math.random()*rect.w; }
    });
  } else if(particleMode==='snow'){
    ctx.fillStyle='rgba(255,255,255,0.95)';
    particles.forEach(p=>{
      ctx.beginPath(); ctx.arc(p.x+Math.sin(p.sway)*4, p.y, p.r, 0, Math.PI*2); ctx.fill();
      p.y += p.speed; p.sway += 0.03;
      if(p.y > rect.y+rect.h){ p.y=rect.y; p.x=rect.x+Math.random()*rect.w; }
    });
  }
  ctx.restore();
}
animateParticles();
