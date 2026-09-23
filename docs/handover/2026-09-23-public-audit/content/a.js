const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const { AxeBuilder } = require('/workspace/pracujbe/node_modules/@axe-core/playwright');
const B='http://localhost:3100';
const paths=['/poradniki','/poradniki/praca-w-belgii-bez-znajomosci-jezyka','/poradniki/nie-istnieje','/o-nas','/faq','/kontakt','/pomoc','/regulamin','/polityka-prywatnosci','/polityka-cookies'];
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const vw of [320,1280]) {
 const ctx=await br.newContext({viewport:{width:vw,height:800}});
 const pg=await ctx.newPage();
 for (const l of ['pl','nl','fr','en']) for (const p of paths) {
  const r=await pg.goto(B+'/'+l+p,{waitUntil:'networkidle'});
  const info=await pg.evaluate(()=>({lang:document.documentElement.lang,title:document.title,sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,
   h:[...document.querySelectorAll('h1,h2,h3')].map(e=>e.tagName+':'+e.textContent.trim().slice(0,40)),
   main:document.querySelectorAll('main').length, header:!!document.querySelector('header'), footer:!!document.querySelector('footer'),
   robots:document.querySelector('meta[name=robots]')?.content,
   over:[...document.querySelectorAll('body *')].filter(e=>{const b=e.getBoundingClientRect();return b.right>document.documentElement.clientWidth+1&&b.width>0}).slice(0,3).map(e=>e.tagName+'.'+String(e.className).slice(0,40)+':'+e.textContent.trim().slice(0,30))}));
  let ax=[];
  if (vw===1280 || true) { const res=await new AxeBuilder({page:pg}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze(); ax=res.violations.map(v=>v.id+'('+v.impact+','+v.nodes.length+')'); }
  console.log(vw,l,p,r.status(),JSON.stringify(info),ax.join(' '));
 }
 await ctx.close();}
 await br.close();
})();
