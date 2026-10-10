import {summarizeItems} from './_printing.js';
const bruneiToday=()=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Brunei'}).format(new Date());
const audit=(db,email,action,id,detail)=>db.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES (?,?,?,?)').bind(email,action,id,JSON.stringify(detail));
export async function saveOrderStatusWithProduction(db,order,{payment,stage,email}){
 const action={payment_status:payment,fulfillment_status:stage};
 const status=db.prepare("UPDATE orders SET payment_status=?,fulfillment_status=?,verified_at=CASE WHEN ?='verified' AND payment_status!='verified' THEN datetime('now') WHEN ?!='verified' THEN NULL ELSE verified_at END WHERE id=?").bind(payment,stage,payment,payment,order.id);
 const entry=audit(db,email,'order.status',order.id,action);
 if(!['printing','completed'].includes(stage)){
  await db.batch([status,entry]);return {registered:false};
 }
 const previous=await db.prepare('SELECT order_id FROM printnest_production_runs WHERE order_id=?').bind(order.id).first();
 if(previous){await db.batch([status,entry]);return {registered:false,already_recorded:true};}
 const estimate=summarizeItems(JSON.parse(order.items_json));
 if(!estimate.complete){await db.batch([status,entry]);return {registered:false,missing_print_details:true};}
 const settings=await db.prepare('SELECT * FROM printnest_printer_settings WHERE id=1').first();
 if(!settings)throw Error('Production setup missing');
 const elec=settings.add_electricity&&settings.average_watts>0?Math.round(settings.average_watts*estimate.print_minutes*settings.tariff_cents_per_kwh/60000):0;
 const roll=await db.prepare('SELECT * FROM printnest_filament_rolls WHERE is_default=1').first();
 const eligible=estimate.weight_mg>0&&roll&&roll.remaining_mg>=estimate.weight_mg;
 const state=estimate.weight_mg===0?'not_applicable':eligible?'deducted':'pending';
 const date=bruneiToday(),query=[
  status,
  db.prepare('INSERT INTO printnest_production_runs(order_id,occurred_on,printer_name,weight_mg,print_minutes,print_cost_cents,electricity_cents,inventory_state,created_by) VALUES(?,?,?,?,?,?,?,?,?)').bind(order.id,date,settings.printer_name,estimate.weight_mg,estimate.print_minutes,estimate.print_cost_cents,elec,state,email),
 ];
 if(eligible){
  // D1 batch is atomic; CHECK(remaining_mg>=0) rejects concurrent over-consumption.
  query.push(db.prepare('UPDATE printnest_filament_rolls SET remaining_mg=remaining_mg-? WHERE id=?').bind(estimate.weight_mg,roll.id));
  query.push(db.prepare('INSERT INTO printnest_roll_usage(order_id,roll_id,used_mg) VALUES(?,?,?)').bind(order.id,roll.id,estimate.weight_mg));
 }
 query.push(entry,audit(db,email,'production.run.create',order.id,{...estimate,electricity_cents:elec,inventory_state:state,roll_id:eligible?roll.id:null}));
 await db.batch(query);
 return {registered:true,inventory_state:state};
}
export async function allocatePendingProduction(db,orderId,email){
 const run=await db.prepare("SELECT * FROM printnest_production_runs WHERE order_id=? AND inventory_state='pending'").bind(orderId).first();
 if(!run)throw Error('No pending allocation for this order');
 const roll=await db.prepare('SELECT * FROM printnest_filament_rolls WHERE is_default=1').first();
 if(!roll)throw Error('Select a default filament roll first');
 if(roll.remaining_mg<run.weight_mg)throw Error('Not enough filament remaining in the default roll');
 await db.batch([
  db.prepare('INSERT INTO printnest_roll_usage(order_id,roll_id,used_mg) VALUES(?,?,?)').bind(orderId,roll.id,run.weight_mg),
  db.prepare('UPDATE printnest_filament_rolls SET remaining_mg=remaining_mg-? WHERE id=?').bind(run.weight_mg,roll.id),
  db.prepare("UPDATE printnest_production_runs SET inventory_state='deducted' WHERE order_id=? AND inventory_state='pending'").bind(orderId),
  audit(db,email,'production.inventory.allocate',orderId,{roll_id:roll.id,grams:run.weight_mg/1000})
 ]);
 return {ok:true};
}
