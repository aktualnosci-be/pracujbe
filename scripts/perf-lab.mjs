// Bramka wydajności — pomiar laboratoryjny (#395). Mierzy LCP, CLS i TBT kluczowych stron
// publicznych w Chromium z throttlingiem (CPU 4×, 1,6 Mb/s, RTT 150 ms, 412×823) — obserwowane
// metryki z PerformanceObserver, nie symulacja Lighthouse. Każda strona × {pierwsza wizyta,
// z zapisaną zgodą} × `lab.runs` prób w świeżym kontekście; porównujemy MEDIANĘ z progami
// z `perf-budgets.json`. Kod ≠ 0 = przekroczony próg.
//
// CI (job `e2e`, po testach): ten sam build i ten sam Chromium co Playwright, własny
// `next start` na porcie 3100. Lokalnie:
//   node scripts/perf-lab.mjs                                 # startuje next start na 3100
//   node scripts/perf-lab.mjs --base http://localhost:3000    # istniejący serwer
// Chromium: PLAYWRIGHT_CHROMIUM_PATH (np. /opt/pw-browsers/chromium) albo `playwright install`.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { launchChromium } from "./lib/launch-chromium.mjs";
import {
  clsFromShifts,
  markdownTable,
  median,
  tbtFromLongtasks,
} from "./lib/perf-budget.mjs";

const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const config = JSON.parse(
  readFileSync(new URL("../perf-budgets.json", import.meta.url), "utf8"),
).lab;
const runs = Number(argValue("--runs") ?? config.runs);
const outFile = argValue("--out") ?? "playwright-report/perf-lab.json";
const PORT = 3100;
const base = (argValue("--base") ?? `http://localhost:${PORT}`).replace(
  /\/$/,
  "",
);

const CONSENT_COOKIE = {
  name: "pracujbe_consent",
  value: encodeURIComponent(
    JSON.stringify({
      v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? "1.0",
      categories: {
        necessary: true,
        preferences: false,
        analytics: false,
        marketing: false,
      },
      ts: "2026-01-01T00:00:00.000Z",
      id: "perf-lab",
    }),
  ),
  sameSite: "Lax",
};

// Obserwatory rejestrowane przed skryptami strony (buffered: true łapie też wcześniejsze wpisy).
function installObservers() {
  const perf = { lcp: [], shifts: [], longtasks: [], fcp: null, last: 0 };
  window.__perfLab = perf;
  const observe = (type, onEntry) => {
    try {
      new PerformanceObserver((list) => {
        list.getEntries().forEach(onEntry);
        perf.last = performance.now();
      }).observe({ type, buffered: true });
    } catch {
      // Typ nieobsługiwany — metryka zostanie NaN i skrypt to zgłosi.
    }
  };
  observe("largest-contentful-paint", (e) => perf.lcp.push(e.startTime));
  observe("layout-shift", (e) => {
    if (!e.hadRecentInput) perf.shifts.push({ t: e.startTime, v: e.value });
  });
  observe("longtask", (e) =>
    perf.longtasks.push({ t: e.startTime, d: e.duration }),
  );
  observe("paint", (e) => {
    if (e.name === "first-contentful-paint") perf.fcp = e.startTime;
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // serwer jeszcze nie słucha
    }
    await sleep(500);
  }
  throw new Error(`Serwer ${url} nie odpowiedział w ${timeoutMs / 1000} s`);
}

async function firstLink(path, pattern) {
  const html = await (await fetch(`${base}${path}`)).text();
  const match = html.match(pattern);
  if (!match) throw new Error(`Brak linku ${pattern} na ${path}`);
  return match[1];
}

async function measure(browser, path, withConsent) {
  const context = await browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  try {
    // Tylko nasz serwer: żadnego ruchu zewnętrznego, który wprowadzałby rozrzut.
    await context.route(
      (url) => url.origin !== new URL(base).origin,
      (route) => route.abort(),
    );
    if (withConsent)
      await context.addCookies([{ ...CONSENT_COOKIE, url: base }]);
    await context.addInitScript(installObservers);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: config.network.latencyMs,
      downloadThroughput: (config.network.downloadKbps * 1000) / 8,
      uploadThroughput: (config.network.uploadKbps * 1000) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: config.cpuThrottling,
    });
    const t0 = Date.now();
    await page.goto(`${base}${path}`, { waitUntil: "load", timeout: 60_000 });
    const tLoad = Date.now() - t0;
    // Okno obserwacji: do 1 s bez nowego wpisu (LCP, long task, przesunięcie), co najmniej
    // 3 s od nawigacji, najwyżej 8 s. Łapie treść dorysowaną po `load` (np. hero za
    // setTimeout) i long taski hydratacji, bez stałego, długiego czekania na każdej stronie.
    for (;;) {
      const { now, last } = await page.evaluate(() => ({
        now: performance.now(),
        last: window.__perfLab.last,
      }));
      if ((now - last >= 1000 && now >= 3000) || Date.now() - t0 > 8000) break;
      await sleep(250);
    }
    if (process.env.PERF_LAB_DEBUG)
      console.log(path, withConsent, "load", tLoad, "total", Date.now() - t0);
    const raw = await page.evaluate(() => window.__perfLab);
    return {
      lcp: raw.lcp.length ? raw.lcp[raw.lcp.length - 1] : Number.NaN,
      cls: clsFromShifts(raw.shifts),
      tbt:
        raw.fcp === null
          ? Number.NaN
          : tbtFromLongtasks(raw.longtasks, raw.fcp),
    };
  } finally {
    await context.close();
  }
}

let server;
async function main() {
  if (!argValue("--base")) {
    server = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)],
      {
        stdio: ["ignore", "ignore", "inherit"],
        env: { ...process.env, PORT: String(PORT) },
      },
    );
    server.on("exit", (code) => {
      if (code !== null && code !== 0)
        console.error(`next start zakończył się kodem ${code}`);
    });
  }
  await waitForServer(`${base}/pl`, 60_000);

  const detail = await firstLink(
    "/pl/oferty-pracy",
    /href="(\/pl\/oferty-pracy\/[a-z0-9-]+)"/,
  );
  const guide = await firstLink(
    "/pl/poradniki",
    /href="(\/pl\/poradniki\/[a-z0-9-]+)"/,
  );
  const paths = ["/pl", "/pl/oferty-pracy", detail, guide, "/pl/logowanie"];
  // Rozgrzewka: pierwsze żądanie `next start` ładuje moduły strony — nie mierzymy tego.
  for (const path of paths)
    for (let i = 0; i < 2; i += 1) await (await fetch(`${base}${path}`)).text();

  const scenarios = paths.flatMap((path) => [
    {
      path,
      withConsent: false,
      visit: "pierwsza wizyta",
      lcpLimit: config.thresholds.lcpMsFirstVisit,
    },
    {
      path,
      withConsent: true,
      visit: "ze zgodą",
      lcpLimit: config.thresholds.lcpMsWithConsent,
    },
  ]);
  const samples = new Map(scenarios.map((s) => [s, []]));
  const browser = await launchChromium();
  const started = Date.now();
  try {
    // Próby przeplatane (runda po rundzie), żeby chwilowe obciążenie runnera nie trafiło
    // wszystkich prób jednej strony.
    for (let run = 0; run < runs; run += 1) {
      for (const scenario of scenarios) {
        samples
          .get(scenario)
          .push(await measure(browser, scenario.path, scenario.withConsent));
      }
    }
  } finally {
    await browser.close();
  }

  const { cls: clsLimit, tbtMs: tbtLimit } = config.thresholds;
  const results = scenarios.map((scenario) => {
    const values = samples.get(scenario);
    const lcp = median(values.map((v) => v.lcp));
    const cls = median(values.map((v) => v.cls));
    const tbt = median(values.map((v) => v.tbt));
    const failures = [];
    if (!(lcp <= scenario.lcpLimit))
      failures.push(`LCP ${Math.round(lcp)} ms > ${scenario.lcpLimit} ms`);
    if (!(cls <= clsLimit))
      failures.push(`CLS ${cls.toFixed(3)} > ${clsLimit}`);
    if (!(tbt <= tbtLimit))
      failures.push(`TBT ${Math.round(tbt)} ms > ${tbtLimit} ms`);
    return {
      path: scenario.path,
      visit: scenario.visit,
      lcp,
      cls,
      tbt,
      samples: values,
      failures,
    };
  });

  const table = markdownTable(
    ["strona", "wizyta", "LCP ms", "CLS", "TBT ms", "wynik"],
    results.map((r) => [
      `\`${r.path}\``,
      r.visit,
      String(Math.round(r.lcp)),
      r.cls.toFixed(3),
      String(Math.round(r.tbt)),
      r.failures.length ? `❌ ${r.failures.join("; ")}` : "✅",
    ]),
  );
  const note =
    `Mediana z ${runs} prób; progi: LCP ${config.thresholds.lcpMsFirstVisit}/${config.thresholds.lcpMsWithConsent} ms ` +
    `(pierwsza wizyta/ze zgodą), CLS ${clsLimit}, TBT ${tbtLimit} ms. CPU ${config.cpuThrottling}×, ` +
    `${config.network.downloadKbps / 1000} Mb/s, RTT ${config.network.latencyMs} ms, ` +
    `${config.viewport.width}×${config.viewport.height}. Pomiar ${Math.round((Date.now() - started) / 1000)} s.`;
  console.log(`${table}\n\n${note}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Budżet wydajności (lab CWV, #395)\n\n${table}\n\n${note}\n\n`,
    );
  }
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify({ config, results }, null, 2)}\n`);

  const failed = results.filter((r) => r.failures.length);
  if (failed.length > 0) {
    console.error(
      `\nPrzekroczone progi lab CWV (perf-budgets.json, mediana z ${runs} prób):\n${failed
        .map(
          (r) =>
            `  ${r.path} (${r.visit}): ${r.failures.join("; ")} — próby LCP ${r.samples
              .map((s) => Math.round(s.lcp))
              .join(
                "/",
              )} ms, TBT ${r.samples.map((s) => Math.round(s.tbt)).join("/")} ms`,
        )
        .join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.log("\nProgi lab CWV w normie.");
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  server?.kill("SIGTERM");
}
