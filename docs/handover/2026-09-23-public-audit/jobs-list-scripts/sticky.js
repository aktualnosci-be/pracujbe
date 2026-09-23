const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const h of [800, 1024]) {
  const p = await b.newPage({ viewport: { width: 1280, height: h } });
  await p.goto('http://localhost:3100/pl/oferty-pracy', { waitUntil: 'networkidle' });
  await p.locator('[aria-labelledby="cookie-banner-title"] button').first().click().catch(()=>{});
  const res = await p.evaluate(async () => {
    const side = document.querySelector('[data-filter-passport=desktop]'); const btn = side.querySelector('button:last-of-type');
    const btnEl = [...side.querySelectorAll('button')].pop();
    const out = { sideH: Math.round(side.getBoundingClientRect().height), docH: document.documentElement.scrollHeight, visibleAt: [] };
    for (let y = 0; y < document.documentElement.scrollHeight; y += 200) { window.scrollTo(0, y); await new Promise(r=>setTimeout(r,30)); const r = btnEl.getBoundingClientRect(); if (r.bottom <= innerHeight && r.top >= 0) out.visibleAt.push(y); }
    out.maxScroll = document.documentElement.scrollHeight - innerHeight;
    return out; });
  console.log(h, JSON.stringify(res));
  await p.close(); }
  await b.close();
})();
