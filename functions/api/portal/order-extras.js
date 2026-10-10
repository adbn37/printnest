import {json} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {orderExtras,validatedExtras} from '../_order_extras.js';
const audit=(db,email,action,id,detail)=>db.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES(?,?,?,?)').bind(email,action,id,JSON.stringify(detail));
export async function onRequestGet({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 const id=new URL(request.url).searchParams.get('id');if(!id||id.length>80)return invalid('Order ID required');
 try{return json({items:await orderExtras(env.PRINTNEST_DB,id)})}catch{return invalid('Install V4 database migration first',503)}
}
export async function onRequestPut({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 let data;try{data=await request.json()}catch{return invalid('Invalid JSON')}
 if(!data||typeof data.id!=='string'||!data.id||data.id.length>80)return invalid('Order ID required');
 const db=env.PRINTNEST_DB;
 try{
  const order=await db.prepare('SELECT id,fulfillment_status FROM orders WHERE id=?').bind(data.id).first();
  if(!order)return invalid('Order not found',404);
  if(['printing','ready','completed','cancelled'].includes(order.fulfillment_status))return invalid('Cannot edit extras after production has started or order is closed',409);
  const run=await db.prepare('SELECT order_id FROM printnest_production_runs WHERE order_id=?').bind(data.id).first();
  if(run)return invalid('Stock has already been deducted for this order. Extras cannot be changed.',409);
  const extras=await validatedExtras(db,data.items);
  await db.batch([
   db.prepare("INSERT INTO printnest_order_extras(order_id,extras_json,updated_by) VALUES(?,?,?) ON CONFLICT(order_id) DO UPDATE SET extras_json=excluded.extras_json,updated_by=excluded.updated_by,updated_at=datetime('now')").bind(data.id,JSON.stringify(extras),g.user.email),
   audit(db,g.user.email,'order.extras.update',data.id,{extras})
  ]);
  return json({ok:true,items:extras});
 }catch(e){return invalid(e.message||'Could not save optional accessories',e.message?.startsWith('Stock')?409:400)}
}
