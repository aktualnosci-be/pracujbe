const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100'; const {dismiss}=require('./common');
const sizes = async p => p.evaluate(()=>[...document.querySelectorAll('a,button,input,[role=checkbox]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0 && getComputedStyle(e).visibility!=='hidden'}).map(e=>{const r=e.getBoundingClientRect();return {t:(e.getAttribute('aria-label')||e.textContent||e.id||e.name||'').trim().slice(0,40),w:Math.round(r.width),h:Math.round(r.height),inMain:!!e.closest('main')}}).filter(x=>x.h<44||x.w<24));
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const [w,fs] of [[320,null],[640,'200%']]) for (const l of ['pl','nl','fr','en']) {
  const ctx=await br.newContext({viewport:{width:w,height:800},hasTouch:true,isMobile:w===320}); const p=await ctx.newPage();
  await p.goto(`${B}/${l}/rejestracja-pracodawca`); const bt=await dismiss(p); if(l==='pl'&&w===320) console.log('banner',bt);
  if(fs) await p.evaluate(f=>document.documentElement.style.fontSize=f,fs);
  await p.click('button[type=submit]'); await p.waitForTimeout(300);
  const o=await p.evaluate(()=>{const d=document.documentElement;const over=[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.right>d.clientWidth+1||r.left< -1}).map(e=>e.tagName+'.'+(e.className||'').toString().slice(0,40)+':'+(e.textContent||'').slice(0,30));return {sw:d.scrollWidth,cw:d.clientWidth,over:over.slice(0,5)}});
  console.log(w,fs,l,JSON.stringify(o));
  if(w===320 && l==='pl') console.log(' small targets', JSON.stringify(await sizes(p)));
  await p.screenshot({path:`reg-${w}-${l}.png`,fullPage:true});
  await ctx.close();
 }
 await br.close();
})();
