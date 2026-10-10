import {getCatalog,putCatalog,json} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {mergeCatalog,snapshot} from '../_printing.js';
import {validateRecipe} from '../_materials.js';
const trim=(v,n=140)=>String(v??'').trim().slice(0,n);
export async function onRequestPost({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_BUCKET||!env.PRINTNEST_DB)return invalid('D1 and R2 catalog required',503);
 let d;try{d=await request.json()}catch{return invalid('Invalid JSON')}
 const title=trim(d?.title,100),description=trim(d?.description,350),price=String(d?.price??'').trim();
 if(!title||!/^\d{1,6}(?:\.\d{1,2})?$/.test(price))return invalid('Enter a bundle name and BND price');
 const components=d?.components;if(!Array.isArray(components)||components.length<1||components.length>12)return invalid('Choose 1–12 components');
 const clean=[],ids=new Set();for(const c of components){const id=trim(c.id,80),quantity=Number(c.quantity);if(!id||ids.has(id)||!Number.isInteger(quantity)||quantity<1||quantity>100)return invalid('Component must be unique with quantity 1–100');ids.add(id);clean.push({id,quantity})}
 try{
  const catalog=await getCatalog(env),all=mergeCatalog(catalog),lookup=new Map(all.map(p=>[p.id,p]));let first=null;
  for(const c of clean){const p=lookup.get(c.id);if(!p||p.product_type==='bundle'||p.visible===false||snapshot(p).print_weight_g===null)return invalid('Each bundle component must have Creality weight/time/cost configured');if(!first)first=p}
  // Optional boxes, plastic and accessories belong to each customer order.
  const extras=[];
  if(catalog.length>=200)return invalid('Catalog limit reached');
  const id='up-'+crypto.randomUUID();const entry={id,title,description,price:Number(price),category:'Gifts',image:first.image,visible:true,product_type:'bundle',components:clean,materials:extras,print_weight_g:null,print_minutes:null,print_cost_cents:null};
  await putCatalog(env,[...catalog,entry]);
  await env.PRINTNEST_DB.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES(?,?,?,?)').bind(g.user.email,'products.bundle.add',id,JSON.stringify({components:clean,extras})).run();
  return json({ok:true,id},201);
 }catch(e){return invalid(e.message||'Could not create bundle',400)}
}
