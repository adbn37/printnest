import {json} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {orderExtras,validatedExtras} from '../_order_extras.js';
import {summarizeItems} from '../_printing.js';
const audit=(db,email,action,id,detail)=>db.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES(?,?,?,?)').bind(email,action,id,JSON.stringify(detail));

export async function onRequestGet({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 const id=new URL(request.url).searchParams.get('id');if(!id||id.length>80)return invalid('Order ID required');
 try{return json({items:await orderExtras(env.PRINTNEST_DB,id)})}catch{return invalid('Order materials storage unavailable. Check V4 D1 migration.',503)}
}

function parseEstimates(original,raw){
 if(!Array.isArray(raw)||raw.length!==original.length)throw Error('Provide printing estimates for every order line.');
 const edited=[];
 for(let index=0;index<original.length;index++){
  const row=raw[index];if(!row||typeof row!=='object')throw Error('Missing order item printing details.');
  const weight=String(row.print_weight_g??'').trim(),mins=String(row.print_minutes??'').trim(),cost=String(row.print_cost??'').trim();
  if(!/^\d{1,6}(?:\.\d{1,3})?$/.test(weight)||!/^\d{1,6}$/.test(mins)||!/^\d{1,6}(?:\.\d{1,2})?$/.test(cost))
   throw Error('Each order item needs weight (g), printing time (minutes) and BND cost.');
  const w=Number(weight),m=Number(mins),c=Math.round(Number(cost)*100);
  if(!(w>0&&w<=100000&&m>0&&m<=100000&&c>=0&&c<=100000000))throw Error('One or more printing estimates are outside the allowed range.');
  edited.push({...original[index],print_weight_g:w,print_minutes:m,print_cost_cents:c});
 }
 return edited;
}

export async function onRequestPut({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 let data;try{data=await request.json()}catch{return invalid('Invalid JSON')}
 if(!data||typeof data.id!=='string'||!data.id||data.id.length>80)return invalid('Order ID required');
 const db=env.PRINTNEST_DB;
 try{
  const order=await db.prepare('SELECT id,fulfillment_status,items_json FROM orders WHERE id=?').bind(data.id).first();
  if(!order)return invalid('Order not found',404);
  if(['printing','ready','completed','cancelled'].includes(order.fulfillment_status))return invalid('Order already printing, finished or cancelled. Materials cannot be changed.',409);
  if(await db.prepare('SELECT order_id FROM printnest_production_runs WHERE order_id=?').bind(data.id).first())return invalid('Production already recorded. Materials cannot be edited.',409);
  const original=JSON.parse(order.items_json),lines=parseEstimates(original,data.estimates);
  const estimate=summarizeItems(lines);
  if(!estimate.complete)throw Error('Complete the three printing estimates for every order item.');
  const materials=await validatedExtras(db,data.items,estimate.weight_mg);
  await db.batch([
   db.prepare('UPDATE orders SET items_json=? WHERE id=?').bind(JSON.stringify(lines),order.id),
   db.prepare("INSERT INTO printnest_order_extras(order_id,extras_json,updated_by) VALUES(?,?,?) ON CONFLICT(order_id) DO UPDATE SET extras_json=excluded.extras_json,updated_by=excluded.updated_by,updated_at=datetime('now')").bind(order.id,JSON.stringify(materials),g.user.email),
   audit(db,g.user.email,'order.materials.update',order.id,{materials,estimate,total_lines:lines.length})
  ]);
  return json({ok:true,items:materials,weight_g:estimate.weight_mg/1000});
 }catch(e){return invalid(e.message||'Could not save order materials',e.message?.startsWith('Order already')||e.message?.startsWith('Production already')?409:400)}
}
