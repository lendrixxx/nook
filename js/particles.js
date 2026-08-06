import { $ } from './utils.js';
import { VB_W, VB_H, WINDOW_VB } from './room.js';

const stageEl = $('stage');
const windowFogEl = $('windowFog');
const particlesCanvas = $('particles');
const ctx = particlesCanvas.getContext('2d');

/* ---------------- Particle system (rain/snow fall past the window) ---------------- */
let particles = [];
let particleMode = 'none';
let WINDOW_PX = null;

export function resizeCanvas(){
  particlesCanvas.width = stageEl.clientWidth * devicePixelRatio;
  particlesCanvas.height = stageEl.clientHeight * devicePixelRatio;
  particlesCanvas.style.width = stageEl.clientWidth+'px';
  particlesCanvas.style.height = stageEl.clientHeight+'px';
  if(WINDOW_VB){
    const scaleX = stageEl.clientWidth/VB_W, scaleY = stageEl.clientHeight/VB_H;
    WINDOW_PX = { x:WINDOW_VB.x*scaleX, y:WINDOW_VB.y*scaleY, w:WINDOW_VB.w*scaleX, h:WINDOW_VB.h*scaleY };
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
  const rect = WINDOW_PX || {x:0,y:0,w:stageEl.clientWidth,h:stageEl.clientHeight};
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
  ctx.clearRect(0,0,stageEl.clientWidth,stageEl.clientHeight);
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
