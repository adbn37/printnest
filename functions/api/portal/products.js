import {json,getCatalog,putCatalog} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {isSeed,mergeCatalog,parsePrintFields} from '../_printing.js';
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
 // Optional automatic price = base product price + (chargeable letters * price per letter).
 // Both price components are server-owned catalog data; the customer's browser cannot set them.
 const perLetter=String(data.get('per_letter')??'')==='true';
 const letterRaw=String(data.get('letter_price')??'').trim();
 if(perLetter&&(price===null||price<0))return {error:'Automatic letter pricing requires a base price'};
 if(perLetter&&!/^\d{1,4}(?:\.\d{1,2})?$/.test(letterRaw))return {error:'Enter a valid price per letter (BND)'};
 const per_letter_price_cents=perLetter?Math.round(Number(letterRaw)*100):null;
 if(perLetter&&(!Number.isSafeInteger(per_letter_price_cents)||per_letter_price_cents<1||per_letter_price_cents>100000))return {error:'Letter price must be between BND 0.01 and BND 1,000'};
 const pricing_mode=perLetter?'per_letter':'standard';
 const starting_from=perLetter||String(data.get('starting_from')??'')==='true';
 if(starting_from&&(price===null||price<=0))return {error:'Start From needs a base price greater than BND 0'};
 return {title,description,category,price,starting_from,pricing_mode,per_letter_price_cents,...print};
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
 const materials=[]; // Stock colour and optional packaging are selected in Orders.
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
  if(current.product_type==='bundle'&&input.pricing_mode==='per_letter')return invalid('Automatic letter pricing is only available for individual products');
  const file=data.get('image');if(file?.size){const check=await validatePhoto(file);if(check.error)return invalid(check.error);newKey='images/'+crypto.randomUUID()+'.'+check.ext;await env.PRINTNEST_BUCKET.put(newKey,file.stream(),{httpMetadata:{contentType:file.type}})}
  const materials=[]; // Clear old product recipes; individual orders own all material choices.
  const updated={...current,...input,materials,archived:current.archived===true,visible:current.archived===true?false:String(data.get('visible'))==='true',image:newKey?'/'+newKey:current.image};
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
