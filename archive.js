/* Animate newly visible records once; never affect drag transforms or data. */
(() => {
 const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
 const seen = new WeakSet();
 const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
   if (!entry.isIntersecting) return;
   const card = entry.target;
   observer.unobserve(card);
   if (reduce.matches || card.closest('.manage-mode')) return;
   card.classList.add('archive-reveal');
   card.addEventListener('animationend', () => card.classList.remove('archive-reveal'), {once:true});
  });
 }, {threshold:0.06});
 const scan = () => document.querySelectorAll('#cardsGrid .card').forEach((card,i) => {
  if (seen.has(card)) return;
  seen.add(card);
  card.style.setProperty('--reveal-delay', `${Math.min(i % 8, 5) * 35}ms`);
  observer.observe(card);
 });
 const grid = document.getElementById('cardsGrid');
 new MutationObserver(scan).observe(grid, {childList:true,subtree:true});
 scan();
 document.querySelectorAll('button[title]').forEach(button => {
  if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label',button.title);
 });
 const nav=document.querySelector('.side-nav .view-toggle');
 if(!nav)return;
 const buttons=[...nav.querySelectorAll('.view-btn')];
 const capsule=document.createElement('div');
 capsule.className='nav-glass-capsule';capsule.setAttribute('aria-hidden','true');capsule.hidden=true;
 nav.prepend(capsule);
 let animation=null,selected=null,frame=null;
 function align(animate=true){
  const active=buttons.find(button=>button.classList.contains('active'));if(!active)return;
  buttons.forEach(button=>button.setAttribute('aria-pressed',String(button===active)));
  const base=nav.getBoundingClientRect(),target=active.getBoundingClientRect();
  if(!target.width||!target.height)return;
  const vertical=getComputedStyle(nav).flexDirection==='column';
  const inset=vertical?16:0;
  const destination={x:target.left-base.left-inset,y:target.top-base.top,width:target.width+inset,height:target.height};
  const previous=capsule.hidden?null:capsule.getBoundingClientRect();
  const changed=selected!==active;selected=active;
  animation?.cancel();animation=null;
  capsule.hidden=false;capsule.style.width=destination.width+'px';capsule.style.height=destination.height+'px';
  const cx=destination.x+destination.width/2,cy=destination.y+destination.height/2;
  const transform=(x,y,sx=1,sy=1)=>`translate(${x-destination.width/2}px,${y-destination.height/2}px) scale(${sx},${sy})`;
  const final=transform(cx,cy);capsule.style.transform=final;
  if(!animate||!changed||!previous||reduce.matches||!capsule.animate)return;
  const ox=previous.left-base.left+previous.width/2,oy=previous.top-base.top+previous.height/2;
  const dx=cx-ox,dy=cy-oy,distance=Math.hypot(dx,dy);if(distance<1)return;
  const stretch=1+Math.min(.42,distance/380),axisY=Math.abs(dy)>=Math.abs(dx);
  const ux=dx/distance,uy=dy/distance;
  animation=capsule.animate([
   {transform:transform(ox,oy,previous.width/destination.width,previous.height/destination.height),offset:0},
   {transform:transform(ox+dx*.64,oy+dy*.64,axisY?.93:stretch,axisY?stretch:.93),offset:.44},
   {transform:transform(cx+ux*5,cy+uy*5,axisY?1.06:.91,axisY?.91:1.06),offset:.74},
   {transform:transform(cx-ux*2,cy-uy*2,axisY?.98:1.04,axisY?1.04:.98),offset:.88},
   {transform:final,offset:1}
  ],{duration:Math.min(560,420+distance*.45),easing:'cubic-bezier(.22,.65,.3,1)'});
 }
 const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>align());};
 new MutationObserver(schedule).observe(nav,{subtree:true,attributes:true,attributeFilter:['class']});
 if('ResizeObserver' in window){const resize=new ResizeObserver(()=>align(false));resize.observe(nav);buttons.forEach(button=>resize.observe(button));}
 window.addEventListener('resize',()=>align(false));
 reduce.addEventListener('change',()=>align(false));
 align(false);
})();

/* Pointer lighting follows the cursor without transforming dashboard cards. */
(() => {
 const dashboard=document.getElementById('dashboardView');if(!dashboard)return;
 const fine=matchMedia('(hover:hover) and (pointer:fine)');
 const reduce=matchMedia('(prefers-reduced-motion:reduce)');
 const shells=[...dashboard.querySelectorAll('#dashGrid .grid-stack-item-content')];
 const resets=[];
 for(const shell of shells){
  if(!shell.querySelector('.dash-card'))continue;
  shell.dataset.glassCard='';let frame=null;
  const reset=()=>{
   cancelAnimationFrame(frame);frame=null;shell.classList.remove('glass-card-hover');
   shell.style.setProperty('--card-light','0');
  };
  resets.push(reset);
  const follow=e=>{
   if(!fine.matches||reduce.matches||e.pointerType==='touch'||e.buttons||shell.parentElement.matches('.ui-draggable-dragging,.ui-resizable-resizing')){reset();return;}
   cancelAnimationFrame(frame);
   const clientX=e.clientX,clientY=e.clientY;
   frame=requestAnimationFrame(()=>{
    const box=shell.parentElement.getBoundingClientRect();
    const width=shell.offsetWidth,height=shell.offsetHeight;if(!width||!height)return;
    const x=Math.max(0,Math.min(width,clientX-box.left-shell.offsetLeft));
    const y=Math.max(0,Math.min(height,clientY-box.top-shell.offsetTop));
    shell.style.setProperty('--light-x',x+'px');shell.style.setProperty('--light-y',y+'px');
    shell.style.setProperty('--card-light','1');shell.classList.add('glass-card-hover');
   });
  };
  shell.addEventListener('pointerenter',follow);shell.addEventListener('pointermove',follow);
  shell.addEventListener('pointerleave',reset);shell.addEventListener('pointercancel',reset);shell.addEventListener('pointerdown',reset);
 }
 const resetAll=()=>resets.forEach(reset=>reset());
 window.addEventListener('blur',resetAll);
 fine.addEventListener('change',resetAll);reduce.addEventListener('change',resetAll);
 new MutationObserver(()=>{if(dashboard.style.display==='none')resetAll();}).observe(dashboard,{attributes:true,attributeFilter:['style']});
})();
