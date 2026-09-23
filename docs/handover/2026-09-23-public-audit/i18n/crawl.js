const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await b.newContext(); const p=await ctx.newPage();
 // discover dynamic slugs
 await p.goto(B+'/pl/oferty-pracy'); const job=await p.locator('a[href*="/oferty-pracy/"]').first().getAttribute('href');
 await p.goto(B+'/pl/praca'); const links=await p.$$eval('a',as=>as.map(a=>a.getAttribute('href')));
 const cat=links.find(h=>h&&h.includes('/praca/kategoria/')); const city=links.find(h=>h&&h.includes('/praca/miasto/'));
 await p.goto(B+'/pl/poradniki'); const guide=(await p.$$eval('a',as=>as.map(a=>a.getAttribute('href')))).find(h=>h&&/\/poradniki\/.+/.test(h));
 const strip=h=>h.replace(/^\/pl/,'');
 const paths=['','/oferty-pracy',strip(job),'/praca',strip(cat),strip(city),'/poradniki',strip(guide),'/o-nas','/faq','/kontakt','/pomoc','/regulamin','/polityka-prywatnosci','/polityka-cookies','/logowanie','/rejestracja','/rejestracja-pracodawca','/reset-hasla','/ustaw-nowe-haslo','/potwierdzenie','/offline','/nie-istnieje','/oferty-pracy/nie-istnieje-xyz','/oferty-pracy?keyword=zzzqqq','/poradniki/nie-ma','/praca/miasto/xyz','/praca/kategoria/xyz'];
 console.log('paths',paths.join(' '));
 const polish=/[ąćęłńśźżĄĆĘŁŃŚŹŻ]|\b(Szukaj|Oferty|Praca|pracy|Zaloguj|Zarejestruj|Wyślij|oraz|Pracodawca|Kandydat)\b/;
 for(const l of ['pl','nl','fr','en']){
  for(const path of paths){
   const r=await p.goto(`${B}/${l}${path}`,{waitUntil:'networkidle'}).catch(e=>null);
   const st=r?r.status():'ERR';
   const info=await p.evaluate(()=>{
     const txt=document.body.innerText;
     const attrs=[...document.querySelectorAll('[aria-label],[placeholder],[alt],[title]')].map(e=>[e.getAttribute('aria-label'),e.getAttribute('placeholder'),e.getAttribute('alt'),e.getAttribute('title')].filter(Boolean).join(' | '));
     return {txt,attrs,lang:document.documentElement.lang,title:document.title,robots:document.querySelector('meta[name=robots]')?.content, h1:document.querySelector('h1')?.innerText};
   });
   const rawKeys=(info.txt+' '+info.attrs.join(' ')+' '+info.title).match(/\b[a-z][a-zA-Z]+\.[a-z][a-zA-Z_]+(\.[a-zA-Z_]+)*\b/g)?.filter(k=>!/\.(be|com|png|jpg|pdf|eu|nl|fr|js)$/.test(k)&&!/^(pracuj|www)/.test(k))||[];
   let pl=[];
   if(l!=='pl'){
     const lines=(info.txt+'\n'+info.attrs.join('\n')+'\n'+info.title).split('\n').map(s=>s.trim()).filter(Boolean);
     pl=[...new Set(lines.filter(s=>polish.test(s)&&!/Polski|Pracuj\.be|Łódź/.test(s)))];
   }
   console.log(`${l}${path} ${st} lang=${info.lang} robots=${info.robots||'-'} title="${info.title}" h1="${(info.h1||'').slice(0,50)}"${rawKeys.length?' RAWKEYS='+JSON.stringify([...new Set(rawKeys)]):''}${pl.length?' PL='+JSON.stringify(pl.slice(0,6)).slice(0,400):''}`);
  }
 }
 await b.close();
})();
