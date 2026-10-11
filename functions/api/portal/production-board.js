// Production board for PrintNest. Uses the existing atomic production deduction routine.
import {json} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {saveOrderStatusWithProduction} from '../_production.js';
import {nextProductionStage,productionLane,productionStageLabels} from '../_production_flow.js';

const trim=(s,max)=>String(s??'').trim().slice(0,max);
const audit=(db,email,action,id,details)=>db.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES(?,?,?,?)').bind(email,action,id,JSON.stringify(details));
const validDate=s=>!s||(/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s);

export async function onRequestGet({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;
 const db=env.PRINTNEST_DB;if(!db)return invalid('PRINTNEST_DB binding is missing',503);
 try{
  const data=await db.prepare(`SELECT o.id,o.customer_name,o.customer_phone,o.notes AS order_notes,
      o.items_json,o.total_cents,o.payment_status,o.fulfillment_status,o.created_at,
      e.extras_json,
      j.handover_method,j.priority,j.printer_name AS assigned_printer,j.due_on,
      j.notes AS production_notes,j.updated_at AS production_updated_at,
      r.print_cost_cents,r.electricity_cents,r.weight_mg,r.print_minutes,
      r.occurred_on AS printing_started,
      COALESCE((SELECT SUM(c.amount_cents) FROM finance_order_costs c
       WHERE c.order_id=o.id AND c.voided_at IS NULL),0) AS manual_cost_cents,
      COALESCE(r.stock_cost_cents,0) AS accessory_cost_cents
     FROM orders o
     LEFT JOIN printnest_order_extras e ON e.order_id=o.id
     LEFT JOIN printnest_production_jobs j ON j.order_id=o.id
     LEFT JOIN printnest_production_runs r ON r.order_id=o.id
     ORDER BY o.created_at DESC LIMIT 500`).all();
  const jobs=(data.results||[]).map(o=>{
   let items=[],materials=[];try{items=JSON.parse(o.items_json)}catch{}
   try{materials=JSON.parse(o.extras_json||'[]')}catch{}
   const costs=Number(o.print_cost_cents||0)+Number(o.electricity_cents||0)+Number(o.accessory_cost_cents||0)+Number(o.manual_cost_cents||0);
   return {id:o.id,customer_name:o.customer_name,customer_phone:o.customer_phone,order_notes:o.order_notes,
    items:items.map(i=>({title:i.title,quantity:i.quantity,customization:i.customization||null,print_weight_g:i.print_weight_g,print_minutes:i.print_minutes,print_cost_cents:i.print_cost_cents})),
    materials:materials.map(m=>m.kind==='filament'?`${m.material} ${m.color}: ${(Number(m.quantity_mg||0)/1000).toFixed(3)} g`:`${m.name||'Accessory'}: ${m.quantity_units} ${m.unit||'pcs'}`),
    total_cents:o.total_cents,payment_status:o.payment_status,status:o.fulfillment_status,
    lane:productionLane(o.fulfillment_status),created_at:o.created_at,
    handover_method:o.handover_method||'collection',priority:o.priority||'normal',
    printer_name:o.assigned_printer||'',due_on:o.due_on||'',production_notes:o.production_notes||'',
    printing_started:o.printing_started||null,weight_mg:o.weight_mg??null,print_minutes:o.print_minutes??null,
    direct_cost_cents:costs,print_cost_cents:o.print_cost_cents??null,
    accessory_cost_cents:o.accessory_cost_cents??null,
    next_stage:nextProductionStage(o.fulfillment_status,o.handover_method||'collection')};
  });
  return json({jobs,stage_labels:productionStageLabels});
 }catch(e){return invalid('Could not load Production Board. Apply v8-migration.sql to the production D1 database.',503)}
}

export async function onRequestPatch({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;
 const db=env.PRINTNEST_DB;if(!db)return invalid('PRINTNEST_DB binding is missing',503);
 let data;try{data=await request.json()}catch{return invalid('Invalid JSON')}
 if(!data||typeof data!=='object'||Array.isArray(data))return invalid('Invalid request');
 const id=trim(data.id,80),action=trim(data.action,20);
 if(!id)return invalid('Order ID is required');
 try{
  const order=await db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
  if(!order)return invalid('Order not found',404);
  if(action==='details'){
   const method=trim(data.handover_method,20),priority=trim(data.priority,15),
    printer=trim(data.printer_name,100),due=trim(data.due_on,10),notes=trim(data.notes,800);
   if(!['collection','delivery'].includes(method)||!['normal','urgent'].includes(priority)||!validDate(due))return invalid('Check handover method, priority and due date');
   if(['ready_for_collection','collected'].includes(order.fulfillment_status)&&method!=='collection')return invalid('This order is already in the collection stage. Keep Collection or change the stage through an audited workflow.',409);
   if(['ready_for_delivery','delivered'].includes(order.fulfillment_status)&&method!=='delivery')return invalid('This order is already in the delivery stage. Keep Delivery or change the stage through an audited workflow.',409);
   await db.batch([
    db.prepare(`INSERT INTO printnest_production_jobs(order_id,handover_method,priority,printer_name,due_on,notes,updated_by)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET
      handover_method=excluded.handover_method,priority=excluded.priority,
      printer_name=excluded.printer_name,due_on=excluded.due_on,notes=excluded.notes,
      updated_by=excluded.updated_by,updated_at=datetime('now')`).bind(id,method,priority,printer,due||null,notes,g.user.email),
    audit(db,g.user.email,'production.job.details',id,{method,priority,printer,due,notes})
   ]);
   return json({ok:true,message:'Production job details saved'});
  }
  if(action==='next'){
   const details=await db.prepare('SELECT handover_method FROM printnest_production_jobs WHERE order_id=?').bind(id).first();
   const method=details?.handover_method||'collection';
   const next=nextProductionStage(order.fulfillment_status,method);
   if(!next)return invalid('This order has no next production stage',409);
   if(['collected','delivered'].includes(next) && data.confirm_handover!==true)return invalid('Confirm that the customer actually collected the order or delivery was completed.',409);
   // The shared helper checks stock before printing, and posts costs/deducts stock once.
   const result=await saveOrderStatusWithProduction(db,order,{payment:order.payment_status,stage:next,email:g.user.email});
   if(result.blocked)return invalid('Production not advanced: '+(result.reason||[...(result.missing_products||[]),...(result.shortages||[]).map(s=>s.label+' is short '+s.shortfall+' '+s.unit)].join('; ')||'Order materials are incomplete'),409);
   return json({ok:true,stage:next,message:'Advanced to '+productionStageLabels[next],registered:!!result.registered});
  }
  return invalid('Unsupported Production Board action');
 }catch(e){return invalid('Could not update production job: '+(e?.message||'database error'),500)}
}
