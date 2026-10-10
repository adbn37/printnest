import {json} from '../_shared.js';
import {guard,invalid,permittedPayments,permittedStages} from './_auth.js';
import {saveOrderStatusWithProduction} from '../_production.js';
export async function onRequestGet({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;
 if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 try{const rows=await env.PRINTNEST_DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').all();return json({orders:rows.results.map(o=>({...o,items:JSON.parse(o.items_json)}))})}
 catch{return invalid('Could not load orders',500)}
}
export async function onRequestPatch({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;
 if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 let d;try{d=await request.json()}catch{return invalid('Invalid JSON')}
 const id=String(d?.id||'').slice(0,80),payment=String(d?.payment_status||''),stage=String(d?.fulfillment_status||'');
 if(!id||!permittedPayments.includes(payment)||!permittedStages.includes(stage))return invalid('Invalid order status');
 try{
  const db=env.PRINTNEST_DB,order=await db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
  if(!order)return invalid('Order not found',404);
  if(!['developer','master_admin'].includes(g.user.role)&&payment!==order.payment_status)return invalid('Only master admin may change payment status',403);
  const result=await saveOrderStatusWithProduction(db,order,{payment,stage,email:g.user.email});
  return json({ok:true,...result});
 }catch{return invalid('Could not save order or production. Check production migration and default roll configuration.',500)}
}
