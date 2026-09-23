const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const p=await br.newPage({viewport:{width:1280,height:900}});
 for (const path of ['/pl/logowanie','/pl/rejestracja','/pl/reset-hasla','/pl/ustaw-nowe-haslo','/pl/potwierdzenie']){
  await p.goto(B+path); await p.waitForLoadState('networkidle');
  const info=await p.evaluate(()=>({title:document.title,lang:document.documentElement.lang,h1:[...document.querySelectorAll('h1,h2')].map(h=>h.tagName+':'+h.textContent),
   main:document.querySelectorAll('main').length, banner:!!document.querySelector('header'),
   inputs:[...document.querySelectorAll('input,button[role=checkbox]')].map(i=>({id:i.id,type:i.type,ac:i.autocomplete,req:i.required||i.getAttribute('aria-required'),label:i.labels?.[0]?.textContent})),
   robots:document.querySelector('meta[name=robots]')?.content, cookieBanner: !!document.querySelector('[role=dialog],[aria-modal]')}));
  console.log(path, JSON.stringify(info));
 }
 await br.close();
})();
