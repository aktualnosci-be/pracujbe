const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const [w,fs] of [[640,null],[768,'200%'],[1024,'200%'],[1280,'200%'],[640,'200%']]) for (const loc of ['pl','nl','fr','en']) for (const p of ['/praca','/praca/kategoria/seasonal','/praca/miasto/antwerp']) {
 const pg=await br.newPage({viewport:{width:w,height:800}});
 await pg.goto('http://localhost:3100/'+loc+p,{waitUntil:'networkidle'});
 await pg.evaluate((fs)=>{document.querySelector('[aria-labelledby=cookie-banner-title]')?.remove();if(fs)document.documentElement.style.fontSize=fs},fs); await pg.waitForTimeout(150);
 const r=await pg.evaluate(()=>{const o=[];document.querySelectorAll('main h3, main p, main a, main li').forEach(e=>{ if(e.scrollWidth>e.clientWidth+1) o.push(e.tagName+'"'+e.textContent.trim().slice(0,14)+'"')});return {sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,o:[...new Set(o)].slice(0,6)}});
 if(r.sw>r.cw||r.o.length) console.log(w,fs,loc+p,JSON.stringify(r));
 await pg.close();}
 await br.close();
})();
