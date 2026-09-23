const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const AxeBuilder = require('/workspace/pracujbe/node_modules/@axe-core/playwright').default;
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for(const u of ['/nl/oferty-pracy/nope-999','/fr/poradniki/nope','/en/praca/kategoria/nope','/fr/nie-istnieje-xyz']){const c=await br.newContext({viewport:{width:320,height:800}});const p=await c.newPage();const r=await p.goto('http://localhost:3100'+u);await p.waitForTimeout(800);
 const a=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 console.log(u,r.status(),await p.evaluate(()=>document.documentElement.lang+' | h1='+(document.querySelector('h1')||{}).textContent+' | header='+!!document.querySelector('header')+' | skip='+!!document.querySelector('a[href="#main-content"]')),a.violations.map(v=>v.id).join(','));await p.close()}
await br.close()})();
