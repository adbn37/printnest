import {summarizeItems} from './_printing.js';
import {checkAvailability} from './_materials.js';
const today=()=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Brunei'}).format(new Date());
const audit=(db,email,action,id,detail)=>db.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES(?,?,?,?)').bind(email,action,id,JSON.stringify(detail));
export async function inspectOrderMaterials(db,order){
 const lines=JSON.parse(order.items_json),missing=lines.filter(l=>l.recipe_version!==1||!Array.isArray(l.materials)||l.materials.length===0||l.print_weight_g==null).map(l=>l.title);
 const check=await checkAvailability(db,lines);
 return {...check,missing_products:missing,available:missing.length===0&&check.available};
}
export async function saveOrderStatusWithProduction(db,order,{payment,stage,email}){
 const update=(s)=>db.prepare("UPDATE orders SET payment_status=?,fulfillment_status=?,verified_at=CASE WHEN ?='verified' AND payment_status!='verified' THEN datetime('now') WHEN ?!='verified' THEN NULL ELSE verified_at END WHERE id=?").bind(payment,s,payment,payment,order.id);
 const action=(s)=>audit(db,email,'order.status',order.id,{payment_status:payment,fulfillment_status:s,requested_stage:stage});
 if(!['printing','completed'].includes(stage)){
  await db.batch([update(stage),action(stage)]);return {registered:false};
 }
 const previous=await db.prepare('SELECT order_id FROM printnest_production_runs WHERE order_id=?').bind(order.id).first();
 if(previous){await db.batch([update(stage),action(stage)]);return {registered:false,already_recorded:true};}
 const estimate=summarizeItems(JSON.parse(order.items_json));
 if(!estimate.complete){await db.batch([update('awaiting_materials'),action('awaiting_materials')]);return {registered:false,blocked:true,missing_print_details:true};}
 const stock=await inspectOrderMaterials(db,order);
 if(!stock.available){await db.batch([update('awaiting_materials'),action('awaiting_materials'),audit(db,email,'production.stock.blocked',order.id,{shortages:stock.shortages,missing_products:stock.missing_products})]);return {registered:false,blocked:true,shortages:stock.shortages,missing_products:stock.missing_products};}
 const settings=await db.prepare('SELECT * FROM printnest_printer_settings WHERE id=1').first();if(!settings)throw Error('Printer settings missing');
 const electricity=settings.add_electricity&&settings.average_watts>0?Math.round(settings.average_watts*estimate.print_minutes*settings.tariff_cents_per_kwh/60000):0;
 const allocations=stock.allocations,statements=[
  update(stage),
  db.prepare('INSERT INTO printnest_production_runs(order_id,occurred_on,printer_name,weight_mg,print_minutes,print_cost_cents,electricity_cents,inventory_state,stock_cost_cents,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(order.id,today(),settings.printer_name,estimate.weight_mg,estimate.print_minutes,estimate.print_cost_cents,electricity,'deducted',stock.stock_cost_cents,email)
 ];
 for(const a of allocations){
  if(a.kind==='filament'){
   // On concurrent requests CHECK(remaining_mg>=0) aborts the entire D1 transaction.
   statements.push(db.prepare('UPDATE printnest_filament_rolls SET remaining_mg=CASE WHEN remaining_mg>=? THEN remaining_mg-? ELSE -1 END WHERE id=?').bind(a.quantity_mg,a.quantity_mg,a.id));
   statements.push(db.prepare("INSERT INTO printnest_material_usage(order_id,stock_kind,stock_id,quantity_mg,quantity_units) VALUES(?,'filament',?,?,0)").bind(order.id,a.id,a.quantity_mg));
  }else{
   statements.push(db.prepare('UPDATE printnest_inventory_items SET quantity=CASE WHEN quantity>=? THEN quantity-? ELSE -1 END,updated_at=datetime(\'now\') WHERE id=?').bind(a.quantity_units,a.quantity_units,a.id));
   statements.push(db.prepare("INSERT INTO printnest_material_usage(order_id,stock_kind,stock_id,quantity_mg,quantity_units) VALUES(?,'item',?,0,?)").bind(order.id,a.id,a.quantity_units));
  }
 }
 statements.push(action(stage),audit(db,email,'production.run.create',order.id,{...estimate,electricity_cents:electricity,stock_cost_cents:stock.stock_cost_cents,allocations}));
 await db.batch(statements);
 return {registered:true,inventory_state:'deducted',allocations:allocations.length};
}
