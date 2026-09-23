const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext(); const p=await ctx.newPage();
 for (const l of ['pl','nl','fr','en']) for (const path of ['','/rejestracja-pracodawca','/logowanie','/oferty-pracy','/faq','/o-nas']) {
  await p.goto(`${B}/${l}${path}`);
  const hits=await p.evaluate(()=>{const t=document.body.innerText;return (t.match(/.{0,40}(€|premium|pakiet|abonnement|subscription|pricing|tarif|cennik|prijs|price|plan)\b.{0,40}/gi)||[]).filter(s=>!/€ ?\/|\d+ ?€ ?(\/|per|na|par)|brutto|bruto|brut|gross|\/h|\/godz|\/uur|\/heure|hour/i.test(s)).slice(0,5)});
  if(hits.length) console.log(l+path, JSON.stringify(hits));
 }
 await br.close();
})();
