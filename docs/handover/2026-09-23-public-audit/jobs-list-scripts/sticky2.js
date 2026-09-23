const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto('http://localhost:3100/pl/oferty-pracy', { waitUntil: 'networkidle' });
  await p.locator('[aria-labelledby="cookie-banner-title"] button').first().click().catch(()=>{});
  for (const y of [0, 800, 1600, 2400, 3200, 4000, 4896]) {
    await p.evaluate(y => window.scrollTo(0, y), y); await p.waitForTimeout(80);
    const vis = await p.evaluate(() => [...document.querySelectorAll('[data-filter-passport=desktop] h3, [data-filter-passport=desktop] > button')].map(h => { const r = h.getBoundingClientRect(); return (r.top >= 0 && r.bottom <= innerHeight) ? h.textContent.slice(0,14) : null; }).filter(Boolean).join(', '));
    console.log(y, vis);
  }
  await p.evaluate(() => window.scrollTo(0, 2000)); await p.screenshot({ path: 'sticky-2000.png' });
  await b.close();
})();
