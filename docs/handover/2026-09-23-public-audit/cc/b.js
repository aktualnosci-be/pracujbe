const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
const cats=['construction','transport','warehouse','production','technical','cleaning','hospitality','care','logistics','seasonal'];
const cities=['brussels','antwerp','ghent','leuven','mechelen','hasselt','liege','charleroi','bruges','kortrijk'];
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const pg=await br.newPage();
 for (const loc of ['pl','nl','fr','en']) { let out=[];
  for (const c of cats){ await pg.goto(`${B}/${loc}/praca/kategoria/${c}`); out.push('k:'+c+'='+await pg.locator('[aria-live]').first().textContent()); }
  for (const c of cities){ await pg.goto(`${B}/${loc}/praca/miasto/${c}`); out.push('m:'+c+'='+await pg.locator('[aria-live]').first().textContent()); }
  // hub counts
  await pg.goto(`${B}/${loc}/praca`);
  const hub=await pg.$$eval('main ul li a',as=>as.map(a=>a.getAttribute('href').split('/').pop()+':'+(a.querySelector('p.text-sm')?.textContent||'-')));
  console.log(loc, out.join(' ; ')); console.log(' HUB', hub.join(' ; '));
 }
 await br.close();
})();
