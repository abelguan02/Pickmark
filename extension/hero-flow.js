// Decorative title artwork only: no storage, browser data or network access.
import {createLiquidRenderer} from './liquid-art.js';
const shapes={workspace:'folder',folders:'folder',history:'history',smart:'spark'};

export function mountHeroFlow(host,view){
 if(!host||!shapes[view])return ()=>{};
 const canvas=document.createElement('canvas');
 canvas.className='hero-flow';canvas.width=canvas.height=288;
 canvas.setAttribute('aria-hidden','true');canvas.dataset.shape=shapes[view];
 const ctx=canvas.getContext('2d');
 if(!ctx)return ()=>{};
 const render=createLiquidRenderer(ctx,shapes[view]);
 if(!render)return ()=>{}; // Keep the SVG fallback if canvas is unavailable.
 host.replaceChildren(canvas);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let visible=false,disposed=false,painted=false,raf=0,last=0,time=0;
 const draw=()=>{render(time);painted=true;};
 const active=()=>!disposed&&visible&&!document.hidden&&!reduced.matches&&canvas.isConnected;
 const tick=now=>{
  raf=0;if(!active())return;
  if(!last||now-last>=33){time+=last?Math.min((now-last)/1000,.1):0;last=now;draw();}
  raf=requestAnimationFrame(tick);
 };
 const sync=()=>{
  cancelAnimationFrame(raf);raf=0;last=0;
  if(disposed||!visible||document.hidden||!canvas.isConnected)return;
  if(!painted)draw();
  if(active())raf=requestAnimationFrame(tick);
 };
 const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();});
 intersection.observe(canvas);
 document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
 return ()=>{
  disposed=true;cancelAnimationFrame(raf);intersection.disconnect();
  document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);
 };
}
