const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const vp of [{width:1280,height:900},{width:320,height:640}]) {
 const pg=await br.newPage({viewport:vp});
 await pg.goto(B+'/pl/praca/miasto/brussels',{waitUntil:'networkidle'});
 await pg.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
 const r=await pg.evaluate(()=>{const t=document.querySelector('footer [role=combobox]');const b=t.getBoundingClientRect();const ban=document.querySelector('[aria-labelledby=cookie-banner-title]').getBoundingClientRect();
  const el=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {trig:[b.top,b.bottom,b.height],banner:[ban.top,ban.bottom],hit:el.closest('footer')?'footer':'other', vh:innerHeight, padBottom:getComputedStyle(document.body).paddingBottom}});
 console.log(vp.width, JSON.stringify(r));
 await pg.screenshot({path:`banner-${vp.width}.png`});
 }
 await br.close();
})();
