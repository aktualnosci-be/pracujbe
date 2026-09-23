const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto('http://localhost:3100/pl/oferty-pracy', { waitUntil: 'networkidle' });
  await p.locator('[aria-labelledby="cookie-banner-title"] button').first().click().catch(()=>{});
  await p.route(/oferty-pracy\?/, async r => { if (r.request().headers()['rsc']) await new Promise(x=>setTimeout(x,4000)); r.continue(); });
  await p.locator('#d-cat-transport').click(); await p.waitForTimeout(700);
  const apply = p.locator('[data-filter-passport="desktop"] button').last();
  await apply.click(); await p.waitForTimeout(1200);
  console.log('during nav: url', p.url(), 'btn', await apply.textContent(), 'disabled', await apply.isDisabled(), 'busy', await p.evaluate(()=>document.querySelectorAll('[aria-busy=true]').length), 'count', await p.locator('p[aria-live]').last().textContent());
  await b.close();
})();
