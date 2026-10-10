import {json} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {inspectOrderMaterials} from '../_production.js';
export async function onRequestGet({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;
 const id=new URL(request.url).searchParams.get('id');if(!id||id.length>80)return invalid('Order ID required');
 try{
  const db=env.PRINTNEST_DB;
  const order=await db.prepare('SELECT id,items_json FROM orders WHERE id=?').bind(id).first();if(!order)return invalid('Order not found',404);
  const started=await db.prepare('SELECT order_id FROM printnest_production_runs WHERE order_id=?').bind(id).first();
  if(started)return json({started:true,available:true,shortages:[],missing_products:[]});
  const details=await inspectOrderMaterials(db,order);
  return json({started:false,available:details.available,shortages:details.shortages,missing_products:details.missing_products,needs:details.needs});
 }catch{return invalid('Could not check materials. Apply V3 migration.',503)}
}
