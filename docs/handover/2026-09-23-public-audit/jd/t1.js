const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const { AxeBuilder } = require('/workspace/pracujbe/node_modules/@axe-core/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:900}});
 const p=await ctx.newPage();
 p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,200))});
 for (const loc of ['pl','nl','fr','en']) {
  const r=await p.goto(`${B}/${loc}/oferty-pracy/bricklayer-brussels-1002`,{waitUntil:'networkidle'});
  const lang=await p.getAttribute('html','lang');
  const title=await p.title();
  const raw=await p.evaluate(()=>document.body.innerText.match(/\b[a-z]+\.[a-zA-Z]+\.[a-zA-Z.]+\b/g));
  const ax=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  console.log(loc,r.status(),lang,title, 'raw?',raw&&raw.slice(0,5));
  ax.violations.forEach(v=>console.log('  AXE',v.id,v.impact,v.nodes.length,v.nodes.slice(0,3).map(n=>n.target.join(' ')+' | '+(n.failureSummary||'').slice(0,160).replace(/\n/g,' '))));
 }
 // headings / buttons
 await p.goto(`${B}/pl/oferty-pracy/bricklayer-brussels-1002`,{waitUntil:'networkidle'});
 console.log(await p.evaluate(()=>[...document.querySelectorAll('h1,h2,h3')].map(h=>h.tagName+':'+h.textContent.trim().slice(0,50)).join('\n')));
 console.log(await p.evaluate(()=>[...document.querySelectorAll('button,a[href]')].filter(e=>e.offsetParent).map(e=>e.tagName+'['+(e.getAttribute('aria-label')||e.textContent.trim().slice(0,40))+'] '+e.getAttribute('href')).slice(0,80).join('\n')));
 await br.close();
})();
