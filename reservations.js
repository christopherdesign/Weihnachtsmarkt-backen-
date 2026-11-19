(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api;
  else root.Reservations = api;
})(globalThis, () => {
  'use strict';
  const products = ['cookie', 'horn', 'mixed'];
  const zero = () => ({cookie:0,horn:0,mixed:0});
  const integer = x => Number.isSafeInteger(x) && x >= 0;
  const active = q => products.some(k => q[k] > 0);
  const quantity = q => Object.fromEntries(products.map(k => {
    if (!integer(q?.[k])) throw Error('Mengen müssen ganze nichtnegative Zahlen sein.');
    return [k,q[k]];
  }));
  const sum = (a,b,sign=1) => Object.fromEntries(products.map(k=>[k,a[k]+sign*b[k]]));
  function openTotals(state) {
    return (state.reservations||[]).reduce((a,r)=>sum(a,r.open),zero());
  }
  function remainingStock(state) {
    const open=openTotals(state);
    return (state.saleEntries||[]).reduce((a,e)=>sum(a,Object.fromEntries(products.map(k=>[k,Number(e[k+'Qty'])||0])),-1),
      Object.fromEntries(products.map(k=>[k,(Number(state.production?.[k])||0)-open[k]])));
  }
  function status(r) {
    if (active(r.open)) return r.pickups.some(p=>!p.voidedAt)?'Teilweise abgeholt':'Reserviert';
    if (active(r.cancelled) || r.audit.at(-1)?.type==='cancel') return 'Storniert' + (r.pickups.some(p=>!p.voidedAt)?' (bereits abgeholte Mengen verkauft)':'');
    return 'Vollständig abgeholt und verkauft';
  }
  // Pure command application. The caller must serialize the stock check and commit on the server for live use.
  function apply(previous,cmd) {
    if (!cmd.id || !cmd.reservationId || !Number.isFinite(Date.parse(cmd.at))) throw Error('Ungültiger Vorgang.');
    const sameId=(previous.reservations||[]).flatMap(r=>r.audit).find(e=>e.id===cmd.id);
    if (sameId) {
      if (JSON.stringify(sameId)!==JSON.stringify(cmd)) throw Error('Vorgangs-ID bereits anders verwendet.');
      return previous;
    }
    const s=structuredClone(previous);
    s.reservations??=[];
    s.saleEntries??=[];
    let r=s.reservations.find(r=>r.id===cmd.reservationId);
    if (cmd.type==='create') {
      if (r||!cmd.name?.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(cmd.date||'')) throw Error('Name und Datum sind erforderlich.');
      r={id:cmd.reservationId,name:cmd.name.trim(),date:cmd.date,pickupDate:cmd.pickupDate||'',note:cmd.note||'',
        open:zero(),cancelled:zero(),pickups:[],audit:[],revision:0};
      s.reservations.push(r);
    } else if (!r||r.revision!==cmd.revision) throw Error('Reservierung wurde inzwischen geändert. Bitte neu prüfen.');
    const q=cmd.type==='reverse'?null:quantity(cmd.quantities);
    if (cmd.type!=='change'&&q&&!active(q)) throw Error('Mindestens einen Eimer auswählen.');
    if (cmd.type==='create'||cmd.type==='change') {
      const stock=remainingStock(s);
      if (products.some(k=>q[k]>r.open[k]&&q[k]-r.open[k]>stock[k])) throw Error('Nicht genügend freier Bestand.');
      if (!active(q)) throw Error('Zum Auflösen der Restmenge bitte Stornierung verwenden.');
      r.open=q;
    } else if (cmd.type==='pickup'||cmd.type==='cancel') {
      if (products.some(k=>q[k]>r.open[k])) throw Error('Menge übersteigt die noch offene Reservierung.');
      r.open=sum(r.open,q,-1);
      if (cmd.type==='cancel') r.cancelled=sum(r.cancelled,q);
      else {
        const prices=quantity(cmd.priceCents);
        const sale={id:'pickup-'+cmd.id,reservationId:r.id,date:cmd.date||cmd.at.slice(0,10),soldAt:cmd.at,createdAt:cmd.at};
        for (const k of products) { sale[k+'Qty']=q[k]; sale[k+'Price']=prices[k]/100; }
        r.pickups.push({id:cmd.id,saleId:sale.id,at:cmd.at,quantities:q,priceCents:prices});
        s.saleEntries.push(sale);
      }
    } else if (cmd.type==='reverse') {
      const pickup=r.pickups.find(p=>p.id===cmd.pickupId&&!p.voidedAt);
      if (!pickup||!cmd.reason?.trim()) throw Error('Aktive Abholung und Korrekturgrund erforderlich.');
      pickup.voidedAt=cmd.at;pickup.voidReason=cmd.reason.trim();
      s.saleEntries=s.saleEntries.filter(e=>e.id!==pickup.saleId);
      r.open=sum(r.open,pickup.quantities);
    } else throw Error('Unbekannter Reservierungsvorgang.');
    r.audit.push(structuredClone(cmd));
    r.revision++;
    return s;
  }
  return {apply,remainingStock,openTotals,status,products};
});
