const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const { AxeBuilder } = require('/workspace/pracujbe/node_modules/@axe-core/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3100/pl/oferty-pracy', { waitUntil: 'networkidle' });
  await p.locator('[aria-labelledby="cookie-banner-title"] button').first().click().catch(()=>{}); await p.waitForTimeout(300);
  console.log('banner', await p.locator('[aria-labelledby="cookie-banner-title"]').count());
  const trig = p.locator('[data-filter-passport="mobile-trigger"]');
  await trig.focus(); await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  const d = await p.evaluate(() => {
    const dlg = document.querySelector('[role=dialog]');
    const a = document.activeElement;
    const r = dlg.getBoundingClientRect();
    return { role: dlg.getAttribute('role'), modal: dlg.getAttribute('aria-modal'), labelledby: dlg.getAttribute('aria-labelledby'), title: document.getElementById(dlg.getAttribute('aria-labelledby'))?.textContent, active: a.tagName + ' ' + (a.getAttribute('aria-label')||a.textContent).slice(0,30), rect: [r.top, r.height], sw: dlg.scrollWidth, cw: dlg.clientWidth };
  });
  console.log('open', JSON.stringify(d));
  // tab through dialog
  const seq = [];
  for (let i = 0; i < 0; i++) {
    await p.keyboard.press('Tab');
    const s = await p.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); const inDlg = !!a.closest('[role=dialog]');
      const lab = a.getAttribute('aria-label') || (a.id && document.querySelector(`label[for="${CSS.escape(a.id)}"]`)?.textContent) || a.textContent;
      return `${inDlg?'D':'OUT'} ${a.tagName}${a.getAttribute('role')?'['+a.getAttribute('role')+']':''} "${(lab||'').trim().slice(0,30)}" ${Math.round(r.width)}x${Math.round(r.height)} y=${Math.round(r.top)} ring=${cs.boxShadow!=='none'||cs.outlineStyle!=='none'}`; });
    seq.push(s);
  }
  console.log(seq.join('\n'));
  const axe = await new AxeBuilder({ page: p }).include('[role=dialog]').analyze();
  console.log('axe', axe.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.length} ${v.nodes.slice(0,3).map(n=>n.target.join(' ')+' '+n.failureSummary.slice(0,150)).join(' || ')}`).join('\n'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  console.log('after esc', await p.evaluate(() => ({ dlg: !!document.querySelector('[role=dialog]'), active: document.activeElement.getAttribute('data-filter-passport') })));
  // open, check a checkbox, apply
  await trig.click(); await p.waitForTimeout(400);
  await p.locator('#m-cat-construction').click();
  await p.waitForTimeout(800);
  const btn = p.locator('[role=dialog] button', { hasText: /Pokaż|ofert/ }).last();
  console.log('apply btn', await btn.textContent(), await btn.isDisabled());
  await btn.click(); await p.waitForURL(/category/); await p.waitForLoadState('networkidle'); await p.waitForTimeout(500);
  console.log('after apply url', p.url(), 'focus', await p.evaluate(() => document.activeElement.tagName + ' ' + (document.activeElement.textContent||'').slice(0,40)));
  await b.close();
})();
