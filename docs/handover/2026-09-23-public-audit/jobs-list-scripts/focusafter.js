const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 320, height: 640 } });
  await p.goto('http://localhost:3100/pl/oferty-pracy', { waitUntil: 'networkidle' });
  await p.locator('[aria-labelledby="cookie-banner-title"] button').first().click().catch(()=>{});
  const trig = p.locator('[data-filter-passport="mobile-trigger"]');
  await trig.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  // keyboard: tab to Close? use keyboard to toggle Budownictwo
  await p.locator('#m-cat-construction').focus(); await p.keyboard.press('Space'); await p.waitForTimeout(900);
  await p.locator('[role=dialog] button', { hasText: 'Pokaż' }).last().focus(); await p.keyboard.press('Enter');
  await p.waitForURL(/category/); await p.waitForTimeout(2000);
  console.log('focus after apply:', await p.evaluate(() => document.activeElement.tagName + ' ' + (document.activeElement.getAttribute('data-filter-passport')||'')));
  await p.keyboard.press('Tab');
  console.log('next Tab ->', await p.evaluate(() => (document.activeElement.textContent||'').slice(0,30)));
  console.log('headings', await p.evaluate(() => [...document.querySelectorAll('h1,h2,h3')].filter(h=>h.offsetParent).map(h=>h.tagName+':'+h.textContent.slice(0,30)).join(' | ')));
  await b.close();
})();
