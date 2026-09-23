const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 // offline CTA per locale at 320
 for (const l of ['pl','nl','fr','en']) {
  const p=await br.newPage({viewport:{width:320,height:700}});
  const r=await p.goto(`${B}/${l}/offline`);
  const info=await p.evaluate(()=>{const a=document.querySelector('main a');const b=a.getBoundingClientRect();return {h:b.height,w:b.width,text:a.textContent,sw:document.documentElement.scrollWidth,h1:document.querySelector('h1')?.textContent,hasHeader:!!document.querySelector('header'),title:document.title}});
  console.log('offline',l,r.status(),JSON.stringify(info));
  await p.close();
 }
 // not-found
 for (const u of ['/pl/nie-istnieje','/en/oferty-pracy/xyz-nonexist','/xx/abc','/pl/praca/miasto/zzz']) {
  const p=await br.newPage({viewport:{width:320,height:700}});
  const r=await p.goto(B+u);
  const info=await p.evaluate(()=>({h1:document.querySelector('h1')?.textContent,lang:document.documentElement.lang,header:!!document.querySelector('header'),footer:!!document.querySelector('footer'),mains:document.querySelectorAll('main').length,title:document.title,btn:[...document.querySelectorAll('main a,main button')].map(e=>e.textContent+':'+Math.round(e.getBoundingClientRect().height)),skip:!!document.querySelector('a[href="#main-content"]'),sw:document.documentElement.scrollWidth}));
  console.log('404',u,r.status(),JSON.stringify(info));
  await p.close();
 }
 await br.close();
})();
