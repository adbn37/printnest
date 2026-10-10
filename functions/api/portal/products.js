import {json,getCatalog,putCatalog} from '../_shared.js';import {guard,invalid} from './_auth.js';
export async function onRequestGet({request,env}){const g=await guard(request,env);if(g.response)return g.response;try{return json({products:await getCatalog(env)})}catch{return json({products:[],warning:'Product storage requires PRINTNEST_BUCKET'})}}
export async function onRequestPost({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;if(!env.PRINTNEST_BUCKET)return invalid('Add an R2 binding named PRINTNEST_BUCKET to publish products',503);
 let form;try{form=await request.formData()}catch{return invalid('Invalid form')}
 const title=String(form.get('title')||'').trim().slice(0,100),description=String(form.get('description')||'').trim().slice(0,350),category=String(form.get('category')||''),raw=Number(form.get('price')),file=form.get('image');
 if(!title||!['Clickers','Keychains','Gifts'].includes(category)||!Number.isFinite(raw)||raw<0||!file?.size)return invalid('Complete all product fields');
 if(file.size>5*1024*1024)return invalid('Maximum photo size 5 MB',413);
 const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};if(!extensions[file.type])return invalid('Use JPG, PNG or WebP');
 const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());const valid=file.type==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:file.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';if(!valid)return invalid('Invalid image signature');
 try{const catalog=await getCatalog(env);if(catalog.length>=200)return invalid('Product limit reached');const id='up-'+crypto.randomUUID(),key='images/'+id+'.'+extensions[file.type];await env.PRINTNEST_BUCKET.put(key,file.stream(),{httpMetadata:{contentType:file.type}});catalog.push({id,title,description,category,visible:true,price:Math.round(raw*100)/100,image:'/'+key});await putCatalog(env,catalog);return json({ok:true,id},201)}catch{return invalid('Upload failed',500)}
}
export async function onRequestDelete({request,env}){const g=await guard(request,env,{master:true});if(g.response)return g.response;if(!env.PRINTNEST_BUCKET)return invalid('Product storage unavailable',503);const id=new URL(request.url).searchParams.get('id');if(!id?.startsWith('up-'))return invalid('Invalid product');try{const list=await getCatalog(env),p=list.find(x=>x.id===id);if(!p)return invalid('Not found',404);await putCatalog(env,list.filter(x=>x.id!==id));if(p.image?.startsWith('/images/'))await env.PRINTNEST_BUCKET.delete(p.image.slice(1));return json({ok:true})}catch{return invalid('Could not delete product',500)}}

// Edit an uploaded product without disturbing existing order records.
export async function onRequestPatch({request,env}){
 const g=await guard(request,env);if(g.response)return g.response;
 if(!env.PRINTNEST_BUCKET)return invalid('Product storage PRINTNEST_BUCKET not configured',503);
 let data;try{data=await request.formData()}catch{return invalid('Invalid product form')}
 const id=String(data.get('id')||''),title=String(data.get('title')||'').trim().slice(0,100),description=String(data.get('description')||'').trim().slice(0,350),category=String(data.get('category')||''),visible=String(data.get('visible'))==='true';
 const raw=Number(data.get('price'));const file=data.get('image');
 if(!id.startsWith('up-')||!title||!['Clickers','Keychains','Gifts'].includes(category)||!Number.isFinite(raw)||raw<0||raw>100000)return invalid('Invalid product details');
 try{
  const list=await getCatalog(env),item=list.find(p=>p.id===id);if(!item)return invalid('Product not found',404);
  let newKey=null,oldKey=item.image?.startsWith('/images/')?item.image.slice(1):null;
  if(file?.size){
   if(file.size>5*1024*1024)return invalid('Maximum photo size is 5 MB',413);
   const types={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};if(!types[file.type])return invalid('Use PNG JPG or WebP');
   const a=new Uint8Array(await file.slice(0,16).arrayBuffer());const valid=file.type==='image/png'?a[0]===137&&a[1]===80&&a[2]===78&&a[3]===71:file.type==='image/jpeg'?a[0]===255&&a[1]===216:String.fromCharCode(...a.slice(0,4))==='RIFF'&&String.fromCharCode(...a.slice(8,12))==='WEBP';if(!valid)return invalid('Image signature does not match type');
   newKey='images/'+crypto.randomUUID()+'.'+types[file.type];await env.PRINTNEST_BUCKET.put(newKey,file.stream(),{httpMetadata:{contentType:file.type}});
  }
  Object.assign(item,{title,description,category,price:Math.round(raw*100)/100,visible});if(newKey)item.image='/'+newKey;
  try{await putCatalog(env,list)}catch(e){if(newKey)await env.PRINTNEST_BUCKET.delete(newKey).catch(()=>{});throw e}
  if(newKey&&oldKey)await env.PRINTNEST_BUCKET.delete(oldKey).catch(()=>{});
  return json({ok:true,id});
 }catch{return invalid('Could not update product',500)}
}
