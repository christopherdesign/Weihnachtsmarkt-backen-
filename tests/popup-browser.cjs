// Playwright Chromium test. All URLs are intercepted; no production traffic.
const {chromium}=require('playwright-core');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const today=new Date().getFullYear();
const assetRoot=process.env.WM_ASSET_DIR||join(__dirname,'..');
const files=new Set(['index.html','app1.txt','app2.txt','app3.txt','app4.txt','app5.txt','reservations-ui.txt','reservations.js','style.css']);
const origin='https://weihnachtsmarkt-backen.vercel.app';

test('Android emulation: active timer and intercepted API sync keep the same native form controls', {timeout:30000}, async()=>{
 const browser=await chromium.launch(process.env.WM_CHROMIUM?{executablePath:process.env.WM_CHROMIUM}:{});
 try{
  const context=await browser.newContext({isMobile:true,hasTouch:true,viewport:{width:390,height:780},serviceWorkers:'block'});
  const errors=[];
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  const original={id:'prior',family:'Rusche',deviceId:'dev-rusche-machine',date:'2026-01-06',start:'10:00',end:'10:30',watts:1400,powerPrice:0.24,kwh:0.7,cost:0.168};
  const receipts=[{id:'receipt',total:3,receiptPhoto:'synthetic-photo'}];
  const sales=[{id:'historic-sale',cookieQty:1,cookiePrice:9,mixedQty:0,hornQty:0}];
  const reservations=[{id:'existing-reservation',name:'Test',open:{cookie:0,horn:0,mixed:0},pickups:[],audit:[],revision:0}];
  const energyConfig={prices:{Römer:0.25,Rusche:0.24},devices:[
    {id:'dev-roemer-oven',name:'NEFF Backofen',family:'Römer',type:'Backofen',watts:3000},
    {id:'dev-rusche-machine',name:'Küchenmaschine Rusche',family:'Rusche',type:'Küchenmaschine',watts:1400}
  ]};
  let remote={updated_at:new Date(Date.now()-10000).toISOString(),data:{year:today,production:{cookie:3,horn:0,mixed:0},purchaseEntries:receipts,saleEntries:sales,reservations,energyConfig,energyLogs:[original]}};
  let reads=0,writes=0;
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url()),file=u.pathname==='/'?'index.html':u.pathname.slice(1);
    if(u.origin===origin&&files.has(file)){
      const contentType=file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/plain';
      return route.fulfill({body:readFileSync(join(assetRoot,file)),contentType});
    }
    if(u.hostname==='pefkhiqzsaraiomtdkwh.supabase.co'&&u.pathname==='/rest/v1/app_state'){
      const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,PATCH,OPTIONS'};
      let json;
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
      if(route.request().method()==='PATCH'){
        if(u.searchParams.get('updated_at')!=='eq.'+remote.updated_at)return route.fulfill({json:[],headers});
        remote=route.request().postDataJSON(); writes++;
        json=[{updated_at:remote.updated_at}];
      }else if(u.searchParams.get('select')==='updated_at')json=[{updated_at:remote.updated_at}];
      else{reads++;json=[remote]}
      return route.fulfill({json,headers});
    }
    return route.abort();
  });
  await page.goto(origin+'/');
  await page.locator('#syncLabel').filter({hasText:'Synchronisiert'}).waitFor();
  await page.locator('[data-page="energy"]').click();
  const start=page.locator('[data-start="dev-roemer-oven"]');
  await start.click();
  const oven=page.locator('#dynamicEnergy .energy-device').filter({has:start});
  await oven.locator('[data-stop]:enabled').waitFor();
  await page.locator('#syncLabel').filter({hasText:'Synchronisiert'}).waitFor();
  assert.equal(remote.data.energyConfig.devices.find(d=>d.id==='dev-roemer-oven').running,true);
  await page.locator('#flexLogFamily').selectOption('Rusche');
  await page.locator('#flexLogDevice').selectOption('dev-rusche-machine');
  await page.locator('#flexLogDate').fill('2026-11-20');
  await page.locator('#flexLogStart').fill('23:30');
  await page.locator('#flexLogEnd').fill('00:15');
  await page.locator('#flexLogWatts').fill('1250');
  await page.locator('#flexLogPowerPrice').fill('');
  assert.equal(await page.locator('#flexLogPowerPrice').inputValue(),'');
  await page.locator('#flexLogPowerPrice').fill('0.31');
  await page.locator('#flexLogDevice').focus();
  await page.evaluate(()=>window.pickerBefore=document.querySelector('#flexLogDevice'));
  const readsBefore=reads;
  remote={...remote,updated_at:new Date(Date.now()+100).toISOString(),data:{...remote.data,energyLogs:[...remote.data.energyLogs,{...original,id:'remote-energy'}]}};
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>document.querySelector('#syncLabel').textContent.includes('Synchronisiert'),{});
  await new Promise(r=>setTimeout(r,2200));
  assert.ok(reads>readsBefore,'a remote state was fetched in the middle of editing');
  assert.equal(await page.evaluate(()=>window.pickerBefore===document.querySelector('#flexLogDevice')),true);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'flexLogDevice');
  assert.notEqual(await oven.locator('.timer').textContent(),'00:00:00');
  for(const [key,value] of Object.entries({Family:'Rusche',Device:'dev-rusche-machine',Date:'2026-11-20',Start:'23:30',End:'00:15',Watts:'1250',PowerPrice:'0.31'})){
    assert.equal(await page.locator('#flexLog'+key).inputValue(),value);
  }
  // Synthetic viewport resize/blur, not a physical Android IME.
  await page.setViewportSize({width:390,height:450});
  await page.locator('#flexLogWatts').focus();
  await page.setViewportSize({width:390,height:780});
  await page.locator('#addFlexibleEnergyLog').click();
  await page.locator('#syncLabel').filter({hasText:'Synchronisiert'}).waitFor();
  const persisted=remote.data.energyLogs.find(x=>x.date==='2026-11-20');
  assert.deepEqual([persisted.family,persisted.deviceId,persisted.watts,persisted.powerPrice,persisted.durationMs,persisted.endDate],['Rusche','dev-rusche-machine',1250,0.31,2700000,'2026-11-21']);
  assert.ok(writes>0);
  assert.equal(remote.data.energyLogs.filter(x=>x.date==='2026-11-20').length,1);
  assert.equal(remote.data.energyLogs.find(x=>x.id==='prior').powerPrice,0.24);
  assert.ok(remote.data.energyLogs.some(x=>x.id==='remote-energy'));
  assert.equal(remote.data.purchaseEntries[0].receiptPhoto,'synthetic-photo');
  assert.equal(remote.data.saleEntries[0].id,'historic-sale');
  assert.equal(remote.data.reservations[0].id,'existing-reservation');
  await page.locator('#flexLogStart').fill('13:00');
  page.once('dialog',d=>d.dismiss());
  await page.locator('[data-page="settings"]').click();
  assert.equal(await page.locator('#flexLogStart').inputValue(),'13:00');
  assert.equal(await page.locator('#energy').evaluate(el=>el.classList.contains('active')),true);
  page.once('dialog',d=>d.accept());
  await page.locator('[data-page="settings"]').click();
  assert.equal(await page.locator('#flexLogStart').inputValue(),'');
  for(const [tab,selector] of [['settings','#activeYearSelect'],['plan','#productionDate'],['shop','#buyer'],['sales','#saleDateSelect']]){
    await page.locator('[data-page="'+tab+'"]').click();
    const control=page.locator(selector);
    await control.focus();
    const before=await control.inputValue(),numberOfReads=reads;
    await control.evaluate(el=>{window.pickerBefore=el});
    remote={...remote,updated_at:new Date(Date.parse(remote.updated_at)+1000).toISOString()};
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    for(let i=0;i<30&&reads===numberOfReads;i++)await new Promise(r=>setTimeout(r,100));
    assert.ok(reads>numberOfReads,'sync ran on '+tab);
    await page.locator('#syncLabel').filter({hasText:'Synchronisiert'}).waitFor();
    assert.ok(await control.evaluate(el=>window.pickerBefore===el&&document.activeElement===el),tab);
    assert.equal(await control.inputValue(),before,tab);
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
});
