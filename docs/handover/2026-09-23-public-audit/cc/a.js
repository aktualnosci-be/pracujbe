const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const { default: AxeBuilder } = require('/workspace/pracujbe/node_modules/@axe-core/playwright');
const B='http://localhost:3100';
const paths=['/praca','/praca/kategoria/construction','/praca/miasto/brussels','/praca/kategoria/xyz'];
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const loc of ['pl','nl','fr','en']) for (const p of paths){
  const ctx=await br.newContext({viewport:{width:1280,height:900}}); const pg=await ctx.newPage();
  const r=await pg.goto(B+'/'+loc+p,{waitUntil:'networkidle'});
  const info=await pg.evaluate(()=>({lang:document.documentElement.lang,title:document.title,
    heads:[...document.querySelectorAll('h1,h2,h3')].map(h=>h.tagName+':'+h.textContent.trim().slice(0,50)),
    mains:document.querySelectorAll('main').length,
    bc:[...document.querySelectorAll('nav[aria-label] ol li')].map(l=>l.textContent.trim()+(l.querySelector('[aria-current]')?'[cur]':'')).join('|'),
    bcLabel:[...document.querySelectorAll('nav[aria-label]')].map(n=>n.getAttribute('aria-label')).join(','),
    count:[...document.querySelectorAll('[aria-live]')].map(e=>e.textContent.trim()).join('|'),
    items:document.querySelectorAll('main ul li article, main ul > li > a').length,
    raw:(document.body.innerText.match(/\b[a-z]+\.[a-zA-Z_]+\b/g)||[]).filter(s=>/^(landing|common|jobs|categories|locations|home|errors)\./.test(s))
  }));
  const ax=await new AxeBuilder({page:pg}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  console.log(loc+p, r.status(), JSON.stringify(info), 'AXE:', ax.violations.map(v=>v.id+'('+v.impact+')x'+v.nodes.length).join(','));
  await ctx.close();
 }
 await br.close();
})();
