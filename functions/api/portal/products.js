import {json,getCatalog,putCatalog} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {isSeed,mergeCatalog,parsePrintFields} from '../_printing.js';
import {validateRecipe} from '../_materials.js';
const clean=(v,max=100)=>String(v??'').trim().slice(0,max);
const categories=['Clickers','Keychains','Gifts'];
const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
async function validatePhoto(file){
 if(!file?.size)return {error:'Product photo is required'};
 if(file.size>5*1024*1024)return {error:'Maximum photo size is 5 MB'};
 if(!extensions[file.type])return {error:'Use PNG, JPG or WebP'};
 const a=new Uint8Array(await file.slice(0,16).arrayBuffer());
 const valid=file.type==='image/png'?a[0]===137&&a[1]===80&&a[2]===78&&a[3]===71:file.type==='image/jpeg'?a[0]===255&&a[1]===216:a.length>=12&&String.fromCharCode(...a.slice(0,4))==='RIFF'&&String.fromCharCode(...a.slice(8,12))==='WEBP';
 return valid?{ext:extensions[file.type]}:{error:'Image signature does not match file type'};
}
function productInput(data,{allowQuote=false}={}){
 const title=clean(data.get('title'),100),description=clean(data.get('description'),350),category=clean(data.get('category'),40),raw=String(data.get('price')??'').trim();
 const print=parsePrintFields(data);
 if(print.error)return {error:print.error};
 if(!title||!categories.includes(category))return {error:'Title and category required'};
 if(!raw&&!allowQuote)return {error:'Enter a product price'};
 if(raw&&!/^\d{1,6}(?:\.\d{1,2})?$/.test(raw))return {error:'Price must be BND with up to 2 decimals'};
 const price=raw===''?null:Number(raw);
 if(price!==null&&price>100000)return {error:'Product price exceeds limit'};
 return {title,description,category,price,...print};
}
export async function onRequestGet({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;
 try{return json({products:mergeCatalog(await getCatalog(env))})}catch{return json({products:mergeCatalog(),warning:'R2 product storage not configured'})}
}
export async function onRequestPost({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;if(!env.PRINTNEST_BUCKET)return invalid('PRINTNEST_BUCKET R2 binding missing',503);
 let data;try{data=await request.formData()}catch{return invalid('Invalid product form')}
 const input=productInput(data);if(input.error)return invalid(input.error);
 const photo=data.get('image'),check=await validatePhoto(photo);if(check.error)return invalid(check.error);
 let materials;try{materials=await validateRecipe(env.PRINTNEST_DB,JSON.parse(String(data.get('materials_json')||'[]')),{printWeightG:input.print_weight_g,requireFilament:input.print_weight_g!==null})}catch(e){return invalid(e.message)}
 let key;
 try{const list=await getCatalog(env);if(list.length>=200)return invalid('Product limit reached');const id='up-'+crypto.randomUUID();key='images/'+id+'.'+check.ext;
  await env.PRINTNEST_BUCKET.put(key,photo.stream(),{httpMetadata:{contentType:photo.type}});
  list.push({id,...input,materials,product_type:'single',visible:true,image:'/'+key});
  await putCatalog(env,list);return json({ok:true,id},201)
 }catch{if(key)await env.PRINTNEST_BUCKET.delete(key).catch(()=>{});return invalid('Could not publish product',500)}
}
export async function onRequestPatch({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;if(!env.PRINTNEST_BUCKET)return invalid('PRINTNEST_BUCKET R2 binding missing',503);
 let data;try{data=await request.formData()}catch{return invalid('Invalid product form')}
 const id=clean(data.get('id'),80),input=productInput(data,{allowQuote:isSeed(id)});
 if(!id||input.error)return invalid(input.error||'Missing product ID');
 let newKey=null;
 try{
  const list=await getCatalog(env),merged=mergeCatalog(list),current=merged.find(p=>p.id===id);
  if(!current)return invalid('Product not found',404);
  const file=data.get('image');if(file?.size){const check=await validatePhoto(file);if(check.error)return invalid(check.error);newKey='images/'+crypto.randomUUID()+'.'+check.ext;await env.PRINTNEST_BUCKET.put(newKey,file.stream(),{httpMetadata:{contentType:file.type}})}
  let materials=Array.isArray(current.materials)?current.materials:[];
  if(current.product_type!=='bundle'){try{materials=await validateRecipe(env.PRINTNEST_DB,JSON.parse(String(data.get('materials_json')||'[]')),{printWeightG:input.print_weight_g,requireFilament:input.print_weight_g!==null})}catch(e){return invalid(e.message)}}
  const updated={...current,...input,materials,visible:String(data.get('visible'))==='true',image:newKey?'/'+newKey:current.image};
  const oldKey=current.product_type==='bundle'?null:(current.image?.startsWith('/images/')?current.image.slice(1):null);
  const index=list.findIndex(p=>p.id===id);if(index>=0)list[index]=updated;else list.push(updated);
  try{await putCatalog(env,list)}catch(e){if(newKey)await env.PRINTNEST_BUCKET.delete(newKey).catch(()=>{});throw e}
  if(newKey&&oldKey)await env.PRINTNEST_BUCKET.delete(oldKey).catch(()=>{});
  return json({ok:true,id})
 }catch{return invalid('Could not update product',500)}
}
export async function onRequestDelete({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_BUCKET)return invalid('Product storage unavailable',503);
 const id=clean(new URL(request.url).searchParams.get('id'),80);if(!id.startsWith('up-'))return invalid('Only uploaded products can be deleted');
 try{const list=await getCatalog(env),p=list.find(x=>x.id===id);if(!p)return invalid('Not found',404);
  await putCatalog(env,list.filter(x=>x.id!==id));if(p.product_type!=='bundle'&&p.image?.startsWith('/images/'))await env.PRINTNEST_BUCKET.delete(p.image.slice(1)).catch(()=>{});return json({ok:true});
 }catch{return invalid('Could not delete product',500)}
}
