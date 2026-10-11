import {json,getCatalog,putCatalog} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {mergeCatalog} from '../_printing.js';

// Archive is reversible and applies to both original and uploaded products.
export async function onRequestPatch({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_BUCKET)return invalid('Product R2 storage unavailable',503);
 let data;try{data=await request.json()}catch{return invalid('Invalid JSON')}
 const id=String(data?.id||'').trim();
 if(!id||id.length>80||typeof data?.archived!=='boolean')return invalid('Product ID and archive state required');
 try{
  const list=await getCatalog(env),current=mergeCatalog(list).find(p=>p.id===id);
  if(!current)return invalid('Product not found',404);
  const updated={...current,archived:data.archived,visible:data.archived?false:true};
  const index=list.findIndex(p=>p.id===id);
  if(index>=0)list[index]=updated;else list.push(updated);
  await putCatalog(env,list);
  if(env.PRINTNEST_DB){try{await env.PRINTNEST_DB.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES(?,?,?,?)').bind(g.user.email,data.archived?'product.archive':'product.restore',id,JSON.stringify({archived:data.archived})).run()}catch{ /* Catalog action succeeded; audit failure must not trigger repeat writes */ }}
  return json({ok:true,id,archived:data.archived,visible:!data.archived});
 }catch{return invalid('Unable to change archive state. Check the product R2 binding.',500)}
}
