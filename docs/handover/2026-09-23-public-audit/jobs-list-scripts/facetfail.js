const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const mode of ['500', 'slow']) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.route('**/api/job-filter-facets**', async r => { if (mode==='500') return r.fulfill({ status: 500, body: 'x' }); await new Promise(x=>setTimeout(x,8000)); return r.continue(); });
  await p.goto('http://localhost:3100/pl/oferty-pracy', { waitUntil: 'networkidle' });
  await p.locator('[aria-labelledby="cookie-banner-title"] button').first().click().catch(()=>{});
  await p.locator('#d-cat-construction').click();
  await p.waitForTimeout(1500);
  const btn = p.locator('[data-filter-passport="desktop"] button').last();
  console.log(mode, JSON.stringify(await btn.textContent()), 'disabled=', await btn.isDisabled(), 'alert=', await p.locator('[data-filter-passport="desktop"] [role=alert]').textContent().catch(()=>null));
  // retry
  if (mode==='500') { await p.locator('[data-filter-passport="desktop"] [role=alert] button').click(); await p.waitForTimeout(1500); console.log('after retry disabled=', await btn.isDisabled()); }
  // Enter in the location filter input?
  await p.close();
  }
  await b.close();
})();
