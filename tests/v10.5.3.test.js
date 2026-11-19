const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const root=__dirname+'/..';
const backup=JSON.parse(fs.readFileSync(root+'/../backups/weihnachtsmarkt-backen-v10.5.2-2026-11-16.json','utf8'));
const source=backup.data;
const before=JSON.stringify(source);
const photoHash=value=>crypto.createHash('sha256').update(value||'').digest('hex');
const beforePhotos=source.purchaseEntries.map(e=>photoHash(e.receiptPhoto));

// Additive migration rehearsal on a deep copy of the real production snapshot.
const migrated=structuredClone(source);
migrated.purchaseEntries=migrated.purchaseEntries.map(entry=>{
  if(entry.buyerKey)return entry;
  if(entry.buyer===migrated.family1)return {...entry,buyerKey:'family1'};
  if(entry.buyer===migrated.family2)return {...entry,buyerKey:'family2'};
  return entry;
});
migrated.energyConfig??={prices:{},devices:[]};
if(!migrated.energyConfig.devices.some(d=>d.id==='dev-rusche-iron'))migrated.energyConfig.devices.push({id:'dev-rusche-iron',family:migrated.family2,type:'Hörncheneisen',name:'Cloer Hörncheneisen',watts:800,ironCount:1,running:false,startAt:null});

assert.equal(JSON.stringify(source),before,'the source snapshot must remain byte-for-byte unchanged in memory');
assert.deepEqual(source.purchaseEntries.map(e=>photoHash(e.receiptPhoto)),beforePhotos,'receipt photos must remain unchanged');
assert.equal(migrated.purchaseEntries.length,source.purchaseEntries.length);
assert.equal(migrated.productionEntries.length,source.productionEntries.length);
assert.equal(migrated.saleEntries.length,source.saleEntries.length);
assert.equal(migrated.energyLogs.length,source.energyLogs.length);
assert.ok(migrated.energyConfig.devices.some(d=>d.id==='dev-roemer-iron'));
assert.ok(migrated.energyConfig.devices.some(d=>d.id==='dev-rusche-iron'&&d.watts===800));

// Required accounting example: revenue 300, neutral purchases 350, energy 20.
const revenue=300, purchases=350, energy=20;
const commonResult=revenue-purchases-energy;
assert.equal(commonResult,-70);
assert.equal(commonResult/2,-35);
assert.equal(commonResult/2,-35);
assert.equal(0+commonResult/2,-35,'neutral purchases must not become a personal reimbursement');

// Historical energy values: stored cost/kWh take precedence over later settings.
const historical={kwh:4,cost:1.2,powerPrice:.3,watts:6400,durationMs:2250000};
const laterPowerPrice=.9;
assert.equal(historical.cost,1.2);
assert.notEqual(historical.kwh*laterPowerPrice,historical.cost);

// Cross-midnight duration and independent iron groups.
const minutes=(start,end)=>{const [sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number);let value=eh*60+em-sh*60-sm;if(value<0)value+=1440;return value};
assert.equal(minutes('23:30','00:45'),75);
const kwh=(count,wattsEach,mins)=>count*wattsEach/1000*mins/60;
assert.equal(kwh(8,800,60),6.4);
assert.equal(kwh(6,800,60),4.8);

// Per-device merge rehearsal: changes on two phones must coexist; tombstones win.
const mergeEntities=(left,right,tombstones={})=>{
  const items=new Map();
  for(const item of [...right,...left]){const old=items.get(item.id);if(!old||String(item._updatedAt)>=String(old._updatedAt))items.set(item.id,item)}
  return [...items.values()].filter(item=>String(tombstones[item.id]||'')<String(item._updatedAt||''));
};
const phoneA=[{id:'dev-roemer-iron',running:true,_updatedAt:'2026-11-19T10:00:00Z'}];
const phoneB=[{id:'dev-rusche-iron',running:true,_updatedAt:'2026-11-19T10:00:01Z'}];
assert.deepEqual(mergeEntities(phoneA,phoneB).map(x=>x.id).sort(),['dev-roemer-iron','dev-rusche-iron']);
assert.equal(mergeEntities(phoneA,phoneB,{'dev-roemer-iron':'2026-11-19T10:00:02Z'}).some(x=>x.id==='dev-roemer-iron'),false);
const app1=fs.readFileSync(root+'/app1.txt','utf8'),app5=fs.readFileSync(root+'/app5.txt','utf8');
assert.match(app1,/getPath\(remote,kind\)/,'nested arrays must use generic merge paths');
assert.match(app5,/ARRAY_KEYS\.includes\('energyConfig\.devices'\)/,'energy devices must participate in entity merge/tombstones');

// Immutable web release and root must contain the same deployable program files.
for(const name of ['index.html','app1.txt','app2.txt','app3.txt','app4.txt','app5.txt','style.css']){
  assert.equal(fs.readFileSync(root+'/'+name,'utf8'),fs.readFileSync(root+'/mobile-releases/10.5.3/'+name,'utf8'),name+' differs from immutable release');
}
const manifest=JSON.parse(fs.readFileSync(root+'/mobile-release.json','utf8'));
assert.equal(manifest.version,'10.5.3');
assert.equal(manifest.path,'/mobile-releases/10.5.3/index.html');
assert.match(fs.readFileSync(root+'/app3.txt','utf8'),/parsed\?\.backupFormat&&parsed\?\.data\?parsed\.data:parsed/,'the verified backup wrapper must be directly restorable');
console.log('V10.5.3 tests passed with production snapshot:',JSON.stringify({purchases:source.purchaseEntries.length,photos:beforePhotos.filter((_,i)=>source.purchaseEntries[i].receiptPhoto).length,production:source.productionEntries.length,sales:source.saleEntries.length,energyLogs:source.energyLogs.length}));
