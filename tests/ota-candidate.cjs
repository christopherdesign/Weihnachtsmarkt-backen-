// Checks the packaged web update, never the production API or a real handset.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright-core');

const root = join(__dirname, '..');
const host = 'https://weihnachtsmarkt-backen.vercel.app';
const assets = new Set(['index.html','style.css','app1.txt','app2.txt','app3.txt','app4.txt',
  'app5.txt','startup-checkpoint.js','reservations.js','reservations-ui.txt']);
const nextPath = '/mobile-releases/10.5.6/index.html';
const previousPath = '/mobile-releases/10.5.5/index.html';
const year = new Date().getFullYear();
const journalKey = 'wm_backen_journal_v1_'+(year-1);
const oldYearKey = 'wm_backen_year_'+year;
const currentKey = 'wm_backen_v2';
const currentState = JSON.stringify({year, production:{cookie:2,horn:0,mixed:0},
  purchaseEntries:[{id:'local-only',total:10.25,receiptPhoto:'synthetic-receipt'}]});
const pendingJournal = JSON.stringify({state:{year:year-1,production:{cookie:1},purchaseEntries:[{id:'old-local',total:2}]},
  pending:['old-offline'],details:{'old-offline':{at:String(year-1)+'-11-01'}}});

test('packaged 10.5.6 assets are complete and its test manifest does not replace the release channel', () => {
  const production = JSON.parse(readFileSync(join(root,'mobile-release.json'),'utf8'));
  assert.equal(production.version,'10.5.5');
  assert.equal(production.path,previousPath);
  for(const name of assets)assert.deepEqual(readFileSync(join(root,'mobile-releases/10.5.6',name)),readFileSync(join(root,name)),name);
});

test('actual packaged 10.5.5 to 10.5.6 web update retains years, receipts, and pending changes', {timeout:45000}, async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({isMobile:true, hasTouch:true,viewport:{width:390,height:820},serviceWorkers:'block'});
    const page = await ctx.newPage();
    page.setDefaultTimeout(12000);
    const appErrors=[];
    page.on('pageerror',err=>appErrors.push(err.message));
    let allowCandidate=false,writes=0;
    await ctx.route('**/*', async route=>{
      const u = new URL(route.request().url());
      const method=route.request().method();
      if (u.origin !== host) {
        if(method!=='GET'&&method!=='OPTIONS')writes++;
        return route.abort(); // Network fault. No request leaves the browser.
      }
      if (u.pathname === '/mobile-release.json')
        return route.fulfill({json:{version:allowCandidate?'10.5.6':'10.5.5',path:allowCandidate?nextPath:previousPath,nativeVersion:10501}});
      const asset=u.pathname.match(/^\/mobile-releases\/(10\.5\.[56])\/([a-zA-Z0-9.-]+)$/);
      if (!asset||!assets.has(asset[2]))return route.abort();
      const file=asset[2],path=join(root,'mobile-releases',asset[1],file);
      return route.fulfill({body:readFileSync(path),contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/plain'});
    });
    await ctx.addInitScript(({currentKey,currentState,oldYearKey,journalKey,pendingJournal})=>{
      window.AndroidBridge={}; // Exercise the checkpoint's Android-origin protection.
      if(localStorage.getItem(currentKey)===null){
        localStorage.setItem(currentKey,currentState);
        localStorage.setItem(oldYearKey,currentState);
        localStorage.setItem(journalKey,pendingJournal);
      }
    },{currentKey,currentState,oldYearKey,journalKey,pendingJournal});
    // The Android shell's URL selection is simulated; WebView adoption still needs a hardware test.
    await page.goto(host+previousPath);
    await page.locator('#flexLogDevice').waitFor({state:'attached'});
    const before = await page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)])),[currentKey,oldYearKey,journalKey]);
    allowCandidate=true;
    const manifest=await page.evaluate(async()=> (await(await fetch('/mobile-release.json',{cache:'no-store'})).json()));
    assert.equal(manifest.path,nextPath);
    await page.goto(host+manifest.path);
    await page.locator('#updateSafetyStatus').waitFor({state:'hidden'});
    await page.locator('#flexLogDevice').waitFor({state:'attached'});
    const checkpoint=await page.evaluate(()=>window.WMStartupCheckpoint.exportCopy());
    for(const key of Object.keys(before))assert.equal(checkpoint.storage[key],before[key],key);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),journalKey),pendingJournal);
    assert.equal(writes,0,'no production write attempted without a server response');
    assert.deepEqual(appErrors,[]);
  } finally { await browser.close() }
});
