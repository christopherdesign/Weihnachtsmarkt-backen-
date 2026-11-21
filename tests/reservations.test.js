const {test}=require('node:test');
const assert=require('node:assert/strict');
const r=require('../reservations.js');
const q=(cookie=0,horn=0,mixed=0)=>({cookie,horn,mixed});
const fixture=()=>({production:q(5,4,3),saleEntries:[]});
const cmd=(type,id,fields={})=>({type,id,reservationId:'r1',at:'2026-11-19T12:01:00Z',...fields});
const create=cmd('create','new',{name:'Testkunde',date:'2026-11-19',quantities:q(4,2)});

test('bestehende Reservierung ändert alle Stammdaten und Gesamtmengen, ohne Teilumsatz umzuschreiben',()=>{
 const original=r.apply(fixture(),create);
 const edited=r.apply(original,cmd('edit','edit-1',{revision:1,name:'Neue Kundin',date:'2026-11-20',pickupDate:'2026-11-23',note:'Hintereingang',quantities:q(5,1)}));
 assert.deepEqual(r.remainingStock(edited),q(0,3,3));
 const picked=r.apply(edited,cmd('pickup','edit-p1',{revision:2,quantities:q(2,1),priceCents:q(1234,1200)}));
 const command=cmd('edit','edit-2',{revision:3,name:'Neue Kundin',date:'2026-11-21',pickupDate:'',note:'Termin offen',quantities:q(3,1)});
 const next=r.apply(picked,command),record=next.reservations[0];
 assert.equal(record.name,'Neue Kundin');
 assert.equal(record.date,'2026-11-21');
 assert.equal(record.pickupDate,'');
 assert.equal(record.note,'Termin offen');
 assert.deepEqual(record.open,q(1));
 assert.deepEqual(r.fulfilled(record),q(2,1));
 assert.deepEqual(next.saleEntries,picked.saleEntries);
 assert.deepEqual(record.pickups,picked.reservations[0].pickups);
 assert.deepEqual(record.audit.slice(0,-1),picked.reservations[0].audit);
 assert.deepEqual(r.remainingStock(next),q(2,3,3));
 assert.throws(()=>r.apply(picked,{...command,id:'under',quantities:q(1,1)}),/abgeholten Menge/);
 assert.throws(()=>r.apply(picked,{...command,id:'date',date:'2026-02-30'}),/Reservierungsdatum/);
 const reordered=Object.fromEntries(Object.entries(command).reverse());
 assert.equal(r.apply(next,reordered),next);
});

test('Reservierung bindet Bestand ohne Umsatz; Teilabholung und Korrektur mindern nicht doppelt',()=>{
  const s=r.apply(fixture(),create);
  assert.deepEqual(r.remainingStock(s),q(1,2,3));
  assert.equal(s.saleEntries.length,0);
  const pickup=cmd('pickup','p1',{revision:1,quantities:q(2,1),priceCents:q(1000,1300)});
  const s2=r.apply(s,pickup);
  assert.deepEqual(r.remainingStock(s2),q(1,2,3));
  assert.equal(r.status(s2.reservations[0]),'Teilweise abgeholt');
  assert.equal(s2.saleEntries[0].cookieQty*s2.saleEntries[0].cookiePrice+s2.saleEntries[0].hornPrice,33);
  assert.equal(r.apply(s2,pickup),s2);
  const s3=r.apply(s2,cmd('reverse','undo',{revision:2,pickupId:'p1',reason:'Falsche Zuordnung'}));
  assert.equal(s3.saleEntries.length,0);
  assert.deepEqual(r.remainingStock(s3),q(1,2,3));
  assert.equal(s3.reservations[0].audit.length,3);
  assert.equal(s3.reservations[0].pickups[0].voidReason,'Falsche Zuordnung');
});

test('frischer Jahresstand weist Überbuchung zurück; Revision verhindert veraltete Teilabholung',()=>{
  const s=r.apply(fixture(),create);
  assert.throws(()=>r.apply(s,{...create,id:'second',reservationId:'r2',quantities:q(2)}),/freier Bestand/);
  const pickup=cmd('pickup','p1',{revision:1,quantities:q(1),priceCents:q(1000)});
  const s2=r.apply(s,pickup);
  assert.throws(()=>r.apply(s2,{...pickup,id:'p2'}),/inzwischen geändert/);
  assert.throws(()=>r.apply(s2,{...pickup,quantities:q(2)}),/Vorgangs-ID/);
});

test('mehrfache Abholungen, Mengenänderung und Storno behalten Preise und Historie',()=>{
  let s=r.apply(fixture(),create);
  s=r.apply(s,cmd('change','edit',{revision:1,quantities:q(5,2)}));
  s=r.apply(s,cmd('pickup','p1',{revision:2,quantities:q(1),priceCents:q(1000)}));
  s=r.apply(s,cmd('pickup','p2',{revision:3,quantities:q(1,1),priceCents:q(1200,1100)}));
  const all=r.apply(s,cmd('pickup','p3',{revision:4,quantities:q(3,1),priceCents:q(1300,1400)}));
  assert.equal(r.status(all.reservations[0]),'Vollständig abgeholt und verkauft');
  s=r.apply(s,cmd('cancel','cancel',{revision:4,quantities:q(3,1)}));
  assert.deepEqual(r.remainingStock(s),q(3,3,3));
  assert.equal(s.saleEntries.length,2);
  assert.equal(s.saleEntries[0].cookiePrice,10);
  assert.equal(s.saleEntries[1].cookiePrice,12);
  assert.match(r.status(s.reservations[0]),/^Storniert/);
});
