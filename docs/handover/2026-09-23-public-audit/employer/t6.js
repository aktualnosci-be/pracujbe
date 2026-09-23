const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100'; const {dismiss}=require('./common');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const l of ['pl','nl','fr','en']) {
 const ctx=await br.newContext({viewport:{width:1280,height:800}}); const p=await ctx.newPage();
 await p.goto(`${B}/${l}`); await dismiss(p);
 const links=await p.evaluate(()=>[...document.querySelectorAll('a')].map(a=>({t:a.textContent.trim().replace(/\s+/g,' ').slice(0,50),h:a.getAttribute('href')})).filter(a=>/pracodaw|dla-|werkgever|employ|offre|vacature|job|ofert/i.test(a.h+a.t)));
 const uniq=[...new Map(links.map(a=>[a.h+a.t,a])).values()];
 for (const a of uniq) { const r=await p.request.get(B+a.h,{maxRedirects:0}).catch(e=>({status:()=>'ERR'})); if (r.status()!==200) console.log(l,r.status(),JSON.stringify(a)); }
 if(l==='pl'){ await p.getByRole('link',{name:/Dodaj ofertę pracy/}).first().click(); await p.waitForLoadState(); console.log('clicked ->',p.url(), await p.title(), (await p.evaluate(()=>document.body.innerText.slice(0,300)+' | lang='+document.documentElement.lang+' main='+!!document.querySelector('main')+' h1='+document.querySelector('h1')?.textContent))); }
 await ctx.close();}
 await br.close();
})();
