// Headless browser check: builds the app, serves dist/ with vite preview, blocks all network
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// except localhost, and verifies rendering at 390x844 with zero console errors.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const exe = process.env.CHROME_PATH || (await import('node:fs')).readdirSync(process.env.HOME + '/.cache/ms-playwright').filter((d) => d.startsWith('chromium_headless_shell-')).sort().map((d) => process.env.HOME + '/.cache/ms-playwright/' + d + '/chrome-headless-shell-linux64/chrome-headless-shell').find((p) => (require('node:fs')).existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
// Network disabled: only the local preview server is allowed (item images are remote and will fail to load, which is expected offline).
const imgBlocked = [];
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith('http://localhost:4173')) return route.continue();
  imgBlocked.push(u); return route.abort();
});
let fails = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) fails++; };
try {
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('.tiles .tile', { timeout: 20000 });
  check('opens on Infernus', (await page.textContent('.app-header h1')).startsWith('Infernus'));
  const tabs = await page.$$('.tab');
  check('>=2 named builds', tabs.length >= 2, `${tabs.length} tabs: ${(await Promise.all(tabs.map((t) => t.textContent()))).join(' | ')}`);
  const noHScroll = async (label) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    check(`no horizontal scroll (${label})`, w[0] <= w[1], `${w[0]} <= ${w[1]}`);
  };
  await noHScroll('Infernus build');
  const tapOk = async (label) => {
    const bad = await page.evaluate(() => [...document.querySelectorAll('button, select, a, [role=button]')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40); }).map((el) => `${el.className}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));
    check(`all tap targets >= 40px (${label})`, bad.length === 0, bad.slice(0, 5).join(', '));
  };
  await tapOk('Infernus');
  for (let i = 0; i < tabs.length; i++) {
    await tabs[i].tap();
    const rows = await page.$$('.tiles .tile');
    const phases = await page.$$eval('.phase-head span:first-child', (els) => els.map((e) => e.textContent));
    const totals = await page.$$eval('.tiles .tile', (els) => els.map((e) => Number(e.dataset.total)));
    const costs = await page.$$eval('.tiles .tile', (els) => els.map((e) => Number(e.dataset.cost)));
    let run = 0; const totalsOk = costs.every((c, k) => (run += c) === totals[k]);
    const imgs = await page.$$eval('.tiles .tile img', (els) => els.map((e) => e.getAttribute('src')));
    const broken = await page.$$eval('.tiles .tile img', (els) => els.filter((e) => !e.complete || e.naturalWidth === 0).length);
    const badges = await page.$$eval('.tiles .tile[data-core]', (els) => els.length);
    const abil = await page.$$eval('.ap-icon img', (els) => [...new Set(els.map((e) => e.getAttribute('alt')))]);
    const unlocks = await page.$$eval('.ap-track .pt.unlock', (els) => els.length);
    const agreement = await page.textContent('.big');
    check(`build ${i + 1}: >=12 items, 3 phases, running totals, images`, rows.length >= 12 && broken === 0 && phases.length === 3 && totalsOk && imgs.every((s) => s && /\/data\/img\/items\/\d+\.webp$/.test(s)), `${rows.length} items, phases ${phases.join('/')}`);
    check(`build ${i + 1}: core badge on every item + agreement`, badges === rows.length && /\d+% agreement/.test(agreement), agreement);
    check(`build ${i + 1}: 4 real Infernus abilities, unlock + tiers`, abil.length === 4 && unlocks === 4 && ['Napalm', 'Flame Dash', 'Afterburn', 'Concussive Combustion'].every((n) => abil.includes(n)), abil.join(', '));
  }
  // tap an item -> detail card
  await (await page.$('.tiles .tile')).tap();
  await page.waitForSelector('.sheet');
  const name = await page.textContent('.sheet h2');
  const chips = await page.$$eval('.sheet .chip', (els) => els.map((e) => e.textContent.trim()));
  const stats = await page.$$eval('.sheet .stat-line', (els) => els.length);
  const img = await page.$eval('.sheet-head img', (e) => e.getAttribute('src'));
  check('item detail card: image, cost, tier, slot, stats', !!img && chips.some((c) => /souls/.test(c)) && chips.some((c) => /^Tier \d/.test(c)) && chips.some((c) => /Weapon|Vitality|Spirit/.test(c)) && stats > 0, `${name}: ${chips.join(' | ')}, ${stats} stat lines`);
  await noHScroll('item card open');
  await page.screenshot({ path: 'screenshots/infernus-item-card.png' });
  await page.tap('.sheet-close');
  await page.screenshot({ path: 'screenshots/infernus-build.png', fullPage: true });
  // 3 other heroes via the select
  const options = await page.$$eval('.hero-select option', (els) => els.map((e) => [e.value, e.textContent]));
  const others = options.filter(([v]) => v !== '1').slice(0, 3);
  for (const [v, n] of others) {
    await page.selectOption('.hero-select', v);
    await page.waitForFunction((name) => document.querySelector('.app-header h1')?.textContent.startsWith(name) && document.querySelectorAll('.tiles .tile').length >= 12, n, { timeout: 15000 });
    const rows = await page.$$eval('.tiles .tile', (els) => els.length);
    const abil = await page.$$eval('.ap-icon img', (els) => [...new Set(els.map((e) => e.getAttribute('alt')))]);
    check(`${n}: renders build + ability order`, rows >= 12 && abil.length === 4, `${rows} items, abilities ${abil.join(', ')}`);
    await noHScroll(n);
    await tapOk(n);
  }
  await page.screenshot({ path: 'screenshots/other-hero.png', fullPage: true });
  await page.selectOption('.hero-select', '1');
  await page.waitForFunction(() => document.querySelector('.app-header h1')?.textContent.startsWith('Infernus'));
} catch (e) { check('browser flow', false, String(e)); }
check('no console errors (network disabled)', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`(blocked ${imgBlocked.length} external requests, e.g. images — expected offline)`);
await browser.close(); server.kill();
process.exit(fails ? 1 : 0);
