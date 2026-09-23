const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
const U='/pl/oferty-pracy/bricklayer-brussels-1002';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const [w,h,fs] of [[320,640,null],[375,740,null],[640,800,'200%'],[1280,800,'200%']]) {
  const ctx=await br.newContext({viewport:{width:w,height:h},hasTouch:w<700,isMobile:w<700});
  const p=await ctx.newPage();
  for (const loc of ['pl','fr']) {
  await p.goto(`${B}${U.replace('/pl/','/'+loc+'/')}`,{waitUntil:'networkidle'});
  await p.evaluate(()=>{document.querySelectorAll('[aria-label]').forEach(()=>{})});
  const cb=p.getByRole('button',{name:/Akceptuj wszystkie|Tout accepter|Accepter/}); if(await cb.count()) await cb.first().click().catch(()=>{});
  if(fs) await p.evaluate(f=>document.documentElement.style.fontSize=f,fs);
  await p.waitForTimeout(300);
  const r=await p.evaluate((vw)=>{
   const de=document.documentElement;
   const over=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>vw+1)&&getComputedStyle(e).position!=='fixed'&&!e.closest('[aria-hidden=true]')}).slice(0,6).map(e=>e.tagName+'.'+String(e.className).slice(0,60)+' r='+Math.round(e.getBoundingClientRect().right));
   const bar=[...document.querySelectorAll('div.fixed.inset-x-0.bottom-0')].find(e=>getComputedStyle(e).display!=='none');
   const targets=bar?[...bar.querySelectorAll('a,button')].map(e=>{const r=e.getBoundingClientRect();return (e.getAttribute('aria-label')||e.textContent.trim().slice(0,30))+' '+Math.round(r.width)+'x'+Math.round(r.height)}):null;
   const barH=bar?Math.round(bar.getBoundingClientRect().height):null;
   // clipped text: elements with overflow hidden and scrollWidth>clientWidth
   const clipped=[...document.querySelectorAll('h1,h2,a,button,span,p,dd,dt')].filter(e=>e.offsetParent&&e.scrollWidth>e.clientWidth+1&&['hidden','clip'].includes(getComputedStyle(e).overflowX)).slice(0,6).map(e=>e.tagName+':'+e.textContent.trim().slice(0,40)+' '+e.scrollWidth+'/'+e.clientWidth);
   // footer last content hidden behind bar?
   return {sw:de.scrollWidth,cw:de.clientWidth,over,targets,barH,clipped,bodyPB:getComputedStyle(document.querySelector('main')||document.body).paddingBottom};
  },w);
  console.log(w,fs||'',loc,JSON.stringify(r));
  await p.screenshot({path:`s-${w}-${fs?'200':'100'}-${loc}.png`,fullPage:false});
  }
  await ctx.close();
 }
 await br.close();
})();
