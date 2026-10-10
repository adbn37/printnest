import {json} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {loadTrustedProducts,makeOrderItems} from '../_order_items.js';
const clean=(s,n=100)=>String(s??'').trim().slice(0,n);
export async function onRequestPost({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_DB||!env.PRINTNEST_BUCKET)return invalid('D1 and R2 catalog required',503);
 let d;try{d=await request.json()}catch{return invalid('Invalid JSON')}
 const name=clean(d?.customer_name),phone=clean(d?.customer_phone,32),notes=clean(d?.notes,1000);
 if(name.length<2||!/^[+\d\s()-]{7,25}$/.test(phone))return invalid('Enter customer name and phone number');
 try{
  const details=makeOrderItems(await loadTrustedProducts(env),d.items);
  const id='PN-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,8).toUpperCase();
  await env.PRINTNEST_DB.batch([
   env.PRINTNEST_DB.prepare("INSERT INTO orders(id,customer_name,customer_phone,notes,items_json,total_cents,payment_status,fulfillment_status,order_type) VALUES(?,?,?,?,?,?,'unpaid','new','manual')").bind(id,name,phone,notes,JSON.stringify(details.items),details.total_cents),
   env.PRINTNEST_DB.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES(?,?,?,?)').bind(g.user.email,'order.manual.create',id,JSON.stringify({customer:name,items:details.items.map(i=>({id:i.id,quantity:i.quantity}))}))
  ]);
  return json({ok:true,id,total_cents:details.total_cents},201);
 }catch(e){return invalid(e.message||'Could not create order',400)}
}
