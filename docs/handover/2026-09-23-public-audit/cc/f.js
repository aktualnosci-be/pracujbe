const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
const paths=['/praca','/praca/kategoria/technical','/praca/miasto/charleroi','/praca/kategoria/xyz'];
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const mode of ['320','640+200%']) for (const loc of ['pl','nl','fr','en']) for (const p of paths){
  const pg=await br.newPage({viewport: mode==='320'?{width:320,height:700}:{width:640,height:800}});
  await pg.goto(B+'/'+loc+p,{waitUntil:'networkidle'});
  if(mode!=='320') await pg.evaluate(()=>document.documentElement.style.fontSize='200%');
  await pg.waitForTimeout(200);
  const r=await pg.evaluate(()=>{
   const d=document.documentElement; const over=[];
   document.querySelectorAll('main *').forEach(e=>{const b=e.getBoundingClientRect(); if(b.width>0&&(b.right>d.clientWidth+1||b.left<-1)) over.push(e.tagName+'.'+(e.className+'').slice(0,40)+':'+Math.round(b.right))});
   const clipped=[];document.querySelectorAll('main h1,main h2,main h3,main a,main p').forEach(e=>{if(e.scrollWidth>e.clientWidth+1 && getComputedStyle(e).overflow!=='visible') clipped.push(e.tagName+':'+e.textContent.trim().slice(0,30))});
   const small=[];document.querySelectorAll('main a, main button').forEach(e=>{const b=e.getBoundingClientRect(); if(b.width&&(b.height<24||b.width<24)) small.push(e.textContent.trim().slice(0,20)+'('+Math.round(b.width)+'x'+Math.round(b.height)+')')});
   const under44=[];document.querySelectorAll('main nav a, main section a.rounded-full, main a.text-accent, main ul[aria-label] a').forEach(e=>{const b=e.getBoundingClientRect(); if(b.height<44) under44.push(e.textContent.trim().slice(0,18)+'('+Math.round(b.width)+'x'+Math.round(b.height)+')')});
   return {sw:d.scrollWidth,cw:d.clientWidth,over:over.slice(0,4),clipped:clipped.slice(0,4),small,under44:under44.slice(0,14)};});
  console.log(mode,loc+p,JSON.stringify(r));
  if(loc==='fr'&&p.includes('technical')) await pg.screenshot({path:`s-${mode.replace(/[^0-9]/g,'')}-fr-cat.png`,fullPage:true});
  await pg.close();
 }
 await br.close();
})();
