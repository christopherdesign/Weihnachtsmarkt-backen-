const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {chromium}=require('playwright-core');
const root=process.env.WM_ROOT||resolve(__dirname,'..');
const old=process.env.WM_OLD||resolve(root,'mobile-releases/10.5.4');
const next=process.env.WM_NEXT||resolve(root,'mobile-releases/10.5.5');
const names=['index.html','style.css','app1.txt','app2.txt','app3.txt','app4.txt','app5.txt'];
const read=(dir,name)=>readFileSync(resolve(dir,name));
const release=JSON.parse(read(root,'mobile-release.json'));
test('versioned OTA files match the root, no APK or workspace changes',()=>{
  assert.deepEqual(release,{version:'10.5.5',path:'/mobile-releases/10.5.5/index.html',nativeVersion:10501,apkPath:'',apkSha256:''});
  for(const n of names)assert.deepEqual(read(root,n),read(next,n),n);
  new Function(names.filter(n=>/^app/.test(n)).map(n=>read(next,n).toString()).join(''));
  assert.doesNotMatch(read(next,'index.html').toString(),/reservations(?:-ui|\.js)/);
});
test('same-origin mobile app update keeps unsynced data, fixes timer form and Rusche duplicate', {timeout:30000},async()=>{
  const browser=await chromium.launch();
  try{
    const context=await browser.newContext({isMobile:true,hasTouch:true,viewport:{width:390,height:780},serviceWorkers:'block'});
    const origin='https://weihnachtsmarkt-backen.vercel.app';
    await context.route('**/*',route=>{
      const u=new URL(route.request().url()),file=u.pathname.split('/').at(-1);
      if(u.origin!==origin)return route.abort(); // No traffic to Supabase or any other service.
      if(file==='mobile-release.json')return route.fulfill({body:read(root,file),contentType:'application/json'});
      if(!names.includes(file))return route.abort();
      return route.fulfill({body:read(u.pathname.includes('/10.5.4/')?old:next,file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/plain'});
    });
    await context.addInitScript(()=>{
      if(localStorage.getItem('wm_backen_v2'))return;
      const year=new Date().getFullYear(),stamp=new Date().toISOString();
      const d={name:'Cloer Hörncheneisen',type:'Hörncheneisen',family:'Rusche',watts:800};
      localStorage.setItem('wm_backen_v2',JSON.stringify({year,energyConfig:{prices:{Rusche:.25},devices:[{...d,id:'dev-rusche-iron',running:true,startAt:Date.now()-120000},{...d,id:'old-rusche'},{...d,id:'dev-roemer-iron',family:'Römer'}]},energyLogs:[{id:'old-unsynced',deviceId:'old-rusche',family:'Rusche',date:year+'-01-02',start:'11:00',end:'11:30',watts:800,powerPrice:.25,cost:.1,_updatedAt:stamp}]}));
    });
    const page=await context.newPage(),errors=[];
    page.setDefaultTimeout(6000);
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/mobile-releases/10.5.4/index.html');
    await page.locator('#flexLogDevice').waitFor({state:'attached'});
    const before=await page.evaluate(()=>localStorage.getItem('wm_backen_v2'));
    const target=await page.evaluate(async()=> (await (await fetch('/mobile-release.json',{cache:'no-store'})).json()).path);
    await page.goto(origin+target);
    assert.match(await page.title(),/V10\.5\.5/);
    await page.locator('[data-page="energy"]').press('Enter');
    await page.locator('#flexLogFamily').selectOption('Rusche');
    await page.locator('#flexLogWatts').fill('1250');
    await page.locator('#flexLogDevice').focus();
    await page.evaluate(()=>window.deviceField=document.querySelector('#flexLogDevice'));
    await new Promise(r=>setTimeout(r,2200));
    assert.equal(await page.locator('[data-start="dev-rusche-iron"]').count(),1);
    assert.equal(await page.locator('[data-start="old-rusche"]').count(),0);
    assert.equal(await page.locator('[data-start="dev-roemer-iron"]').count(),1);
    assert.equal(await page.locator('#flexLogWatts').inputValue(),'1250');
    assert.ok(await page.evaluate(()=>window.deviceField===document.activeElement));
    assert.equal(await page.evaluate(()=>localStorage.getItem('wm_backen_v2')),before);
    assert.deepEqual(errors,[]);
  }finally{await browser.close()}
});
