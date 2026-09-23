const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
const act=p=>p.evaluate(()=>{const e=document.activeElement;return e?(e.tagName+'|'+(e.getAttribute('role')||'')+'|'+(e.getAttribute('aria-label')||e.textContent.trim().slice(0,30))):null});
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 // real zoom-equivalent 640x400 banner
 {const ctx=await br.newContext({viewport:{width:640,height:400}});const p=await ctx.newPage();await p.goto(B+'/pl');await p.waitForTimeout(1000);
  console.log('640x400 banner',await p.evaluate(()=>{const b=document.querySelector('[aria-labelledby=cookie-banner-title]').getBoundingClientRect();return [Math.round(b.top),Math.round(b.height)]}));
  await p.screenshot({path:'banner-640x400.png'});
  await p.evaluate(()=>document.documentElement.style.fontSize='200%');await p.waitForTimeout(200);
  await p.screenshot({path:'banner-640x400-text200.png'});
  const t=await p.evaluate(()=>{const b=document.querySelector('[aria-labelledby=cookie-banner-title]');return [...b.querySelectorAll('p,button,a')].map(e=>{const r=e.getBoundingClientRect();return e.textContent.trim().slice(0,15)+':'+Math.round(r.top)+'-'+Math.round(r.bottom)})});console.log('text200 items',t, await p.evaluate(()=>getComputedStyle(document.querySelector('[aria-labelledby=cookie-banner-title]')).overflowY));
  await ctx.close();}
 for (const vp of [{width:320,height:640},{width:640,height:400}]) {
  const ctx=await br.newContext({viewport:vp});const p=await ctx.newPage();await p.goto(B+'/pl');await p.waitForTimeout(1000);
  const cust=p.getByRole('button',{name:'Dostosuj'});await cust.focus();await p.keyboard.press('Enter');await p.waitForTimeout(400);
  console.log(JSON.stringify(vp),'open focus',await act(p));
  const d=await p.evaluate(()=>{const d=document.querySelector('[role=dialog]');const r=d.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom),h:Math.round(r.height),scroll:[d.scrollHeight,d.clientHeight],name:document.getElementById(d.getAttribute('aria-labelledby'))?.textContent,sw:document.getElementById(d.getAttribute('aria-describedby'))?.textContent?.slice(0,20),switches:[...d.querySelectorAll('[role=switch]')].map(s=>{const r=s.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)+':'+s.getAttribute('aria-checked')}),btn:[...d.querySelectorAll('button,a')].map(e=>(e.getAttribute('aria-label')||e.textContent.trim().slice(0,18))+':'+Math.round(e.getBoundingClientRect().top)+'/'+Math.round(e.getBoundingClientRect().height))}});
  console.log(JSON.stringify(d));
  await p.screenshot({path:`dialog-${vp.width}.png`});
  const seq=[];for(let i=0;i<10;i++){await p.keyboard.press('Tab');seq.push(await act(p));}console.log(seq);
  // toggle via space
  await p.locator('[role=switch]').first().focus();await p.keyboard.press('Space');console.log('after space',await p.locator('[role=switch]').first().getAttribute('aria-checked'));
  await p.keyboard.press('Escape');await p.waitForTimeout(400);console.log('after esc focus',await act(p),'banner still',await p.locator('#cookie-banner-title').count());
  await ctx.close();
 }
 // reopen from footer, after consent
 {const ctx=await br.newContext({viewport:{width:1280,height:800}});const p=await ctx.newPage();await p.goto(B+'/pl');await p.waitForTimeout(800);
  await p.getByRole('button',{name:'Odrzuć opcjonalne'}).first().click();await p.waitForTimeout(300);
  console.log('after reject focus',await act(p));
  const fb=p.locator('footer button',{hasText:'cookies'});console.log('footer btn count',await fb.count(), await fb.first().evaluate(e=>{const r=e.getBoundingClientRect();return r.width+'x'+r.height}));
  await fb.first().focus();await p.keyboard.press('Enter');await p.waitForTimeout(400);console.log('dialog',await p.locator('[role=dialog]').count(),await act(p));
  await p.keyboard.press('Escape');await p.waitForTimeout(400);console.log('return focus',await act(p));
  await ctx.close();}
 await br.close();
})();
