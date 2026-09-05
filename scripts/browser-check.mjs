// Headless browser check: builds the app, serves dist/ with vite preview, blocks all network
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// except localhost, and verifies rendering at 390x844 with zero console errors.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
const ntfyMock = spawn('node', ['scripts/mock-ntfy.mjs', '8790'], { stdio: 'ignore' }); // stand-in for ntfy.sh, which the phone display publishes to
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
  if (u.startsWith('http://localhost:4173') || u.startsWith('http://localhost:8790')) return route.continue();
  imgBlocked.push(u); return route.abort();
});
let fails = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) fails++; };
try {
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('.tiles .tile', { timeout: 20000 });
  check('opens on Infernus', (await page.textContent('.app-header h1')).startsWith('Infernus'));
  const tabs = await page.$$('.board h2');
  check('one named build', tabs.length === 1, `${(await Promise.all(tabs.map((t) => t.textContent()))).join(' | ')}`);
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
  // heroes with their own held-out set show that player's validation panel
  for (const [v, who] of [['31', "Deathy's Lash"], ['63', "Zergggy's Mina"], ['12', "Yndio's Kelvin"]]) {
    await page.selectOption('.hero-select', v);
    await page.waitForFunction((w) => document.querySelector('.panel h2')?.textContent.includes(w), who, { timeout: 15000 });
    const agreement = await page.textContent('.big');
    const badges = await page.$$eval('.tiles .tile[data-core]', (els) => els.length);
    const rows = await page.$$eval('.tiles .tile', (els) => els.length);
    check(`${who}: validation panel + core badges`, /\d+% agreement/.test(agreement) && badges === rows, agreement);
  }
  // desktop layout: the board and the side column sit next to each other and fill the window
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click('.hero-chip:has-text("Infernus")');
  await page.waitForFunction(() => document.querySelector('.app-header h1')?.textContent.startsWith('Infernus') && document.querySelector('.col-main'), null, { timeout: 15000 });
  await tapOk('Infernus desktop');
  const [bb, sb] = await Promise.all([page.$eval('.col-main', (e) => e.getBoundingClientRect().toJSON()), page.$eval('.col-side', (e) => e.getBoundingClientRect().toJSON())]);
  check('desktop: two columns filling the window', bb.right <= sb.left && sb.right > 1300 && bb.width > 700, `board ${Math.round(bb.width)}px, side ${Math.round(sb.width)}px`);
  await page.screenshot({ path: 'screenshots/desktop.png' });

  // Street Brawl tab: manual card entry, then a fake screen capture that plays a real draft screenshot
  await page.evaluate(() => { localStorage.setItem('brawl-phone', 'testcode'); localStorage.setItem('brawl-ntfy', 'http://localhost:8790'); }); // phone display on, pointed at the mock ntfy
  await page.click('.mode-switch button:has-text("Brawl")');
  await page.waitForSelector('.brawl-controls', { timeout: 15000 });
  await page.waitForSelector('.brawl-pick select', { timeout: 15000 });
  const brawlItems = ['Mystic Regeneration', 'Extended Magazine', 'Spirit Strike'];
  const picks = await page.$$('.brawl-pick select');
  for (let k = 0; k < 3; k++) await picks[k].selectOption({ label: `T1 ${brawlItems[k]}` });
  await page.waitForSelector('.brawl-card.best', { timeout: 15000 });
  const bestName = await page.textContent('.brawl-card.best b');
  const cardCount = await page.$$eval('.brawl-card', (els) => els.length);
  check('brawl: typed cards are ranked, one highlighted', cardCount === 3 && bestName.startsWith('TAKE'), bestName);
  await tapOk('brawl');
  // phone display: the app publishes its advice to the (mock) ntfy topic; the phone page renders it from the topic's SSE feed
  await page.waitForFunction(() => document.querySelector('.brawl-phone img[src^="data:"]'), null, { timeout: 10000 }).catch(() => {});
  const phoneText = await page.textContent('.brawl-phone');
  check('brawl: phone display shows a QR code and the pairing code', phoneText.includes('testcode') && !!(await page.$('.brawl-phone img[src^="data:"]')), phoneText.trim());
  const phone = await ctx.newPage();
  // no request interception here: Playwright buffers an intercepted SSE stream, and the page only talks to the two local servers
  await phone.goto('http://localhost:4173/phone.html#t=testcode&s=http://localhost:8790');
  await phone.waitForFunction(() => document.querySelector('.card.best b')?.textContent.startsWith('TAKE'), null, { timeout: 10000 }).catch(() => {});
  const phoneBest = await phone.$eval('.card.best b', (e) => e.textContent).catch(() => '');
  const phoneHead = await phone.textContent('#hero');
  const published = await (await fetch('http://localhost:8790/brawl-testcode/json')).json();
  const state = JSON.parse(published.message ?? '{}');
  check('brawl: phone page gets the ranked cards through ntfy', state.cards?.length === 3 && published.message.length < 4000 && phoneBest.startsWith('TAKE') && phoneHead.startsWith('Infernus · round 1, choice 1'), `${phoneHead}: ${phoneBest}, ${published.message?.length} bytes`);
  await phone.screenshot({ path: 'screenshots/brawl-phone.png' });
  await phone.close();
  await page.click('.brawl-controls button:has-text("Phone display: on")');
  await page.click('.brawl-card.best');
  const ownedChips = await page.$$eval('.brawl .chips .chip', (els) => els.map((e) => e.textContent));
  const choiceNow = await page.$eval('.brawl-controls select >> nth=1', (e) => e.value);
  check('brawl: taking a card records it and moves to choice 2', ownedChips.length === 1 && choiceNow === '2', ownedChips.join(', '));
  await page.screenshot({ path: 'screenshots/brawl-tab.png', fullPage: true });
  if (require('node:fs').existsSync('screenshots/brawl/s13.png')) {
    // the "game screen" is a canvas repainted from a screenshot; window.__setDraft(name) swaps the screenshot
    await page.route('http://localhost:4173/__draft/*', (route) => route.fulfill({ body: require('node:fs').readFileSync(`screenshots/brawl/${route.request().url().split('/').pop()}`), contentType: 'image/png' }));
    await page.evaluate(() => {
      delete window.documentPictureInPicture; // keep the advice panel in the main document, not the overlay window
      let im = new Image();
      window.__setDraft = (name) => new Promise((resolve, reject) => { const n = new Image(); n.onload = () => { im = n; resolve(); }; n.onerror = () => reject(new Error('draft image')); n.src = `/__draft/${name}`; });
      navigator.mediaDevices.getDisplayMedia = () => window.__setDraft('s13.png').then(() => {
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const ctx = c.getContext('2d');
        const draw = () => { ctx.drawImage(im, 0, 0); requestAnimationFrame(draw); }; draw();
        return c.captureStream(10);
      });
    });
    await page.click('.brawl-controls button:has-text("Capture game screen")');
    await page.waitForFunction(() => document.querySelectorAll('.brawl-card').length === 3 && document.querySelector('.brawl-card.best b')?.textContent.includes('Arcane Surge'), null, { timeout: 30000 }).catch(() => {});
    const seen = await page.$$eval('.brawl-card b', (els) => els.map((e) => e.textContent.replace(/^(TAKE|#\d) /, '')));
    check('brawl: screen capture of a draft screenshot reads all three cards (with the enhanced flag)', seen.length === 3 && ['Arcane Surge', 'Reactive Barrier (enhanced)', 'Enduring Speed'].every((n) => seen.includes(n)), seen.join(' | ') || (await page.textContent('.brawl-controls .muted')));
    const roundNow = await page.$eval('.brawl-controls select >> nth=0', (e) => e.value);
    const choiceSeen = await page.$eval('.brawl-controls select >> nth=1', (e) => e.value);
    const foes = await page.$$eval('.brawl-controls select[aria-label^="Enemy"]', (els) => els.map((e) => e.selectedOptions[0]?.textContent));
    check('brawl: capture syncs round 2 / choice 1 and fills the enemy team from the hero bar', roundNow === '2' && choiceSeen === '1' && ['Pocket', 'Apollo', 'Ivy', 'Calico'].every((n) => foes.includes(n)), `round ${roundNow} choice ${choiceSeen}, enemies ${foes.join(', ')}`);
    await page.screenshot({ path: 'screenshots/brawl-capture.png' });
    // s14 offers Healbane; on s15 Healbane is in the inventory grid: the pick must be detected without a click
    await page.evaluate(() => window.__setDraft('s14.png'));
    await page.waitForFunction(() => document.querySelector('.brawl-card.best b')?.textContent.includes('Healbane') || [...document.querySelectorAll('.brawl-card b')].some((b) => b.textContent.includes('Healbane')), null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => window.__setDraft('s15.png'));
    await page.waitForFunction(() => [...document.querySelectorAll('.brawl-advice .muted')].some((e) => e.textContent.includes('Took Healbane')), null, { timeout: 30000 }).catch(() => {});
    const tookText = await page.$$eval('.brawl-advice .muted', (els) => els.map((e) => e.textContent).join(' | '));
    const ownedNow = await page.$$eval('.chips .chip', (els) => els.map((e) => e.textContent));
    check('brawl: the taken card is read from the inventory grid on the next screen', tookText.includes('Took Healbane') && ownedNow.includes('Healbane'), `${tookText} — owned ${ownedNow.join(', ')}`);
  }
} catch (e) { check('browser flow', false, String(e)); }
check('no console errors (network disabled)', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`(blocked ${imgBlocked.length} external requests, e.g. images — expected offline)`);
await browser.close(); server.kill(); ntfyMock.kill();
process.exit(fails ? 1 : 0);
