import {authorize,json} from '../_shared.js';
export async function onRequestGet({request,env}){
 if(!authorize(request,env))return json({error:'Unauthorized'},401);
 if(!env.PRINTNEST_DB||!env.PRINTNEST_RECEIPTS)return json({error:'Storage unavailable'},503);
 const id=new URL(request.url).searchParams.get('id');if(!id||id.length>80)return json({error:'Invalid order ID'},400);
 const order=await env.PRINTNEST_DB.prepare('SELECT receipt_key,receipt_type FROM orders WHERE id=?').bind(id).first();
 if(!order?.receipt_key)return json({error:'No payment proof'},404);
 const obj=await env.PRINTNEST_RECEIPTS.get(order.receipt_key);if(!obj)return json({error:'Receipt missing'},404);
 return new Response(obj.body,{headers:{'Content-Type':order.receipt_type||'application/octet-stream','Content-Disposition':'inline','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}})
}
