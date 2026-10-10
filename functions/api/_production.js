import {summarizeItems} from './_printing.js';
const bruneiToday=()=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Brunei'}).format(new Date());
const audit=(db,email,action,id,detail)=>db.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES (?,?,?,?)').bind(email,action,id,JSON.stringify(detail));

// Print estimates are captured per order. Inventory is deliberately managed separately:
// there is no trustworthy product-to-filament recipe yet, so never guess which roll to deduct.
export async function saveOrderStatusWithProduction(db,order,{payment,stage,email}){
 const change={payment_status:payment,fulfillment_status:stage};
 const status=db.prepare("UPDATE orders SET payment_status=?,fulfillment_status=?,verified_at=CASE WHEN ?='verified' AND payment_status!='verified' THEN datetime('now') WHEN ?!='verified' THEN NULL ELSE verified_at END WHERE id=?").bind(payment,stage,payment,payment,order.id);
 const entry=audit(db,email,'order.status',order.id,change);
 if(!['printing','completed'].includes(stage)){
  await db.batch([status,entry]);return {registered:false};
 }
 const previous=await db.prepare('SELECT order_id FROM printnest_production_runs WHERE order_id=?').bind(order.id).first();
 if(previous){await db.batch([status,entry]);return {registered:false,already_recorded:true};}
 const estimate=summarizeItems(JSON.parse(order.items_json));
 if(!estimate.complete){await db.batch([status,entry]);return {registered:false,missing_print_details:true};}
 const settings=await db.prepare('SELECT * FROM printnest_printer_settings WHERE id=1').first();
 if(!settings)throw Error('Printer settings missing');
 const electricity=settings.add_electricity&&settings.average_watts>0
  ?Math.round(settings.average_watts*estimate.print_minutes*settings.tariff_cents_per_kwh/60000):0;
 // Existing D1 CHECK permits 'pending'; here it explicitly means MANUAL inventory reconciliation.
 const state='pending',date=bruneiToday();
 await db.batch([
  status,
  db.prepare('INSERT INTO printnest_production_runs(order_id,occurred_on,printer_name,weight_mg,print_minutes,print_cost_cents,electricity_cents,inventory_state,created_by) VALUES(?,?,?,?,?,?,?,?,?)')
   .bind(order.id,date,settings.printer_name,estimate.weight_mg,estimate.print_minutes,estimate.print_cost_cents,electricity,state,email),
  entry,
  audit(db,email,'production.run.create',order.id,{...estimate,electricity_cents:electricity,inventory_mode:'manual'})
 ]);
 return {registered:true,inventory_state:'manual'};
}
