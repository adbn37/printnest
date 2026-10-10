import {json} from '../_shared.js';import {guard,invalid,permittedPayments,permittedStages} from './_auth.js';
export async function onRequestGet({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 try{const rows=await env.PRINTNEST_DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').all();return json({orders:rows.results.map(o=>({...o,items:JSON.parse(o.items_json)}))})}catch{return invalid('Could not load orders',500)}
}
export async function onRequestPatch({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 let d;try{d=await request.json()}catch{return invalid('Invalid JSON')}
 const id=String(d.id||'').slice(0,80),p=String(d.payment_status||''),s=String(d.fulfillment_status||'');
 if(!id||!permittedPayments.includes(p)||!permittedStages.includes(s))return invalid('Invalid order status');
 // Only authorized Google users can change payment and fulfillment statuses.
 if(!['developer','master_admin'].includes(g.user.role)){
  const old=await env.PRINTNEST_DB.prepare('SELECT payment_status FROM orders WHERE id=?').bind(id).first();
  if(!old)return invalid('Order not found',404);
  if(p!==old.payment_status)return invalid('Only master admin may change payment status',403);
 }
 try{const r=await env.PRINTNEST_DB.prepare('UPDATE orders SET payment_status=?,fulfillment_status=? WHERE id=?').bind(p,s,id).run();if(!r.meta?.changes)return invalid('Order not found',404);
 await env.PRINTNEST_DB.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES(?,?,?,?)').bind(g.user.email,'order.status',id,JSON.stringify({payment_status:p,fulfillment_status:s})).run();return json({ok:true})}catch{return invalid('Could not save status. Check portal migration.',500)}
}
