import {json} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {inspectOrderMaterials,saveOrderStatusWithProduction} from '../_production.js';
// One deliberate approval: receipt VERIFIED and saved production requirements available.
// No stock is deducted here. Existing workflow deducts it once when printing begins.
export async function onRequestPost({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_DB)return invalid('Order database unavailable',503);
 let data;try{data=await request.json()}catch{return invalid('Invalid JSON')}
 const id=String(data?.id||'').trim();if(!/^PN-[A-Za-z0-9-]{8,80}$/.test(id))return invalid('Invalid order ID');
 try{
  const db=env.PRINTNEST_DB,order=await db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
  if(!order)return invalid('Order not found',404);
  if(!['new','confirmed','awaiting_materials'].includes(order.fulfillment_status))return invalid('Order is not awaiting approval',409);
  if(order.total_cents===null)return invalid('This quotation needs a confirmed price and payment before approval',409);
  if(order.payment_status!=='verified')return invalid('Verify the actual bank payment before approving',409);
  const check=await inspectOrderMaterials(db,order);
  if(!check.available)return invalid('Order materials are not ready. Open Order materials and save printing estimates, assign stock, then check availability. '+(check.missing_products||[]).join('; '),409);
  const result=await saveOrderStatusWithProduction(db,order,{payment:'verified',stage:'ready_to_print',email:g.user.email});
  if(result.blocked)return invalid(result.reason||'Cannot approve this order; check materials',409);
  return json({ok:true,id,stage:'ready_to_print'});
 }catch(e){return invalid('Approval could not be completed: '+e.message,409)}
}
