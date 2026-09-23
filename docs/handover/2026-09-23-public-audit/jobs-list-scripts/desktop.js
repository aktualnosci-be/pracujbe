const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto('http://localhost:3100/pl/oferty-pracy?keyword=a&category=construction', { waitUntil: 'networkidle' });
  await p.locator('[aria-labelledby="cookie-banner-title"] button').first().click().catch(()=>{}); await p.waitForTimeout(300);
  await p.goto('http://localhost:3100/pl/oferty-pracy?keyword=magazyn&category=warehouse', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.body.focus());
  const seq = [];
  for (let i = 0; i < 70; i++) {
    await p.keyboard.press('Tab');
    const s = await p.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);
      const hdr = document.querySelector('header.sticky')?.getBoundingClientRect();
      const lab = a.getAttribute('aria-label') || (a.id && document.querySelector(`label[for="${CSS.escape(a.id)}"]`)?.textContent) || a.textContent;
      const vis = cs.boxShadow!=='none' ? 'ring' : (cs.outlineStyle!=='none' && cs.outlineWidth!=='0px') ? 'outline:'+cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor : 'NONE';
      const offscreen = r.bottom > innerHeight || r.top < 0 ? ' OFFSCREEN' : '';
      const underHdr = hdr && r.top < hdr.bottom ? ' UNDER-HEADER' : '';
      return `${a.tagName}${a.getAttribute('role')?'['+a.getAttribute('role')+']':''} "${(lab||'').trim().replace(/\s+/g,' ').slice(0,35)}" ${Math.round(r.width)}x${Math.round(r.height)} y=${Math.round(r.top)} ${vis}${offscreen}${underHdr}`; });
    seq.push(i+': '+s);
  }
  console.log(seq.join('\n'));
  await b.close();
})();
