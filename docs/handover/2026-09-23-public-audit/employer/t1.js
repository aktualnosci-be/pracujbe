const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const { AxeBuilder } = require('/workspace/pracujbe/node_modules/@axe-core/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const l of ['pl','nl','fr','en']) {
  const ctx=await br.newContext({viewport:{width:1280,height:800}}); const p=await ctx.newPage();
  await p.goto(`${B}/${l}/rejestracja-pracodawca`);
  const meta=await p.evaluate(()=>({lang:document.documentElement.lang,title:document.title,desc:document.querySelector('meta[name=description]')?.content,robots:document.querySelector('meta[name=robots]')?.content, h1:[...document.querySelectorAll('h1')].map(h=>h.textContent), h:[...document.querySelectorAll('h1,h2,h3')].map(h=>h.tagName+':'+h.textContent)}));
  console.log(l, JSON.stringify(meta));
  const r=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  console.log(' axe', r.violations.map(v=>v.id+'/'+v.impact+':'+v.nodes.length+' '+v.nodes.map(n=>n.target.join(' ')).slice(0,3).join('|')));
  // empty submit
  await p.click('button[type=submit]');
  await p.waitForTimeout(500);
  const st=await p.evaluate(()=>({focus:document.activeElement?.id, errs:[...document.querySelectorAll('p[id$=-error]')].map(e=>e.id+'='+e.textContent), invalid:[...document.querySelectorAll('[aria-invalid=true]')].map(e=>e.id+' db='+e.getAttribute('aria-describedby'))}));
  console.log(' empty', JSON.stringify(st));
  await ctx.close();
 }
 await br.close();
})();
