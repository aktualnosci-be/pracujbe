const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
const paths=['/poradniki','/poradniki/praca-w-belgii-bez-znajomosci-jezyka','/poradniki/numer-niss-i-podatki','/poradniki/bezpieczenstwo-na-budowie-vca','/polityka-cookies','/regulamin','/poradniki/xyz'];
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const [vw,fs] of [[320,'100%'],[320,'200%'],[640,'200%']]) {
 const pg=await br.newPage({viewport:{width:vw,height:800}});
 for (const l of ['pl','nl','fr','en']) for (const p of paths) {
  await pg.goto(B+'/'+l+p,{waitUntil:'networkidle'});
  await pg.evaluate(f=>document.documentElement.style.fontSize=f,fs);
  await pg.waitForTimeout(100);
  const info=await pg.evaluate(()=>{const cw=document.documentElement.clientWidth;return {sw:document.documentElement.scrollWidth,cw,
   over:[...document.querySelectorAll('main *')].filter(e=>{if(!e.getClientRects().length)return false;const b=e.getBoundingClientRect();return (b.right>cw+1)||(e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflowX!=='visible'&&!/truncate/.test(e.className))}).slice(0,4).map(e=>e.tagName+'['+String(e.className).slice(0,50)+']:'+e.textContent.trim().slice(0,40)+' r='+Math.round(e.getBoundingClientRect().right)),
   trunc:[...document.querySelectorAll('.truncate')].filter(e=>e.scrollWidth>e.clientWidth).map(e=>e.textContent.trim().slice(0,50)+' '+e.clientWidth+'/'+e.scrollWidth)}});
  if (info.sw>info.cw||info.over.length||info.trunc.length) console.log(vw,fs,l,p,JSON.stringify(info));
 }
 await pg.close();}
 await br.close();
})();
