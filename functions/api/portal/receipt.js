import {json} from '../_shared.js';import {guard,invalid} from './_auth.js';
export async function onRequestGet({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;
 if(!env.PRINTNEST_DB||!env.PRINTNEST_RECEIPTS)return invalid('Receipt storage not configured',503);
 const id=new URL(request.url).searchParams.get('id');if(!id||id.length>80)return invalid('Invalid ID');
 const row=await env.PRINTNEST_DB.prepare('SELECT receipt_key,receipt_type FROM orders WHERE id=?').bind(id).first();if(!row?.receipt_key)return invalid('No proof uploaded',404);
 const obj=await env.PRINTNEST_RECEIPTS.get(row.receipt_key);if(!obj)return invalid('Receipt missing',404);
 return new Response(obj.body,{headers:{'Content-Type':row.receipt_type||'application/octet-stream','Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'}})
}
