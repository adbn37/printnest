import {authorize,json} from './_shared.js';
const clean=(v,max=200)=>String(v||'').trim().slice(0,max);
const bad=(e,status=400)=>json({error:e},status);
const paymentStates=['unpaid','awaiting_review','verified','rejected'];
const fulfillmentStates=['new','confirmed','printing','ready','completed','cancelled'];
const receiptTypes={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'};
function validReceipt(sig,type){let a=new Uint8Array(sig);return type==='image/png'?a[0]===137&&a[1]===80&&a[2]===78&&a[3]===71:type==='image/jpeg'?a[0]===255&&a[1]===216:type==='image/webp'?String.fromCharCode(...a.slice(0,4))==='RIFF'&&String.fromCharCode(...a.slice(8,12))==='WEBP':type==='application/pdf'?String.fromCharCode(...a.slice(0,4))==='%PDF':false}
function dbMissing(env){return !env.PRINTNEST_DB}
export async function onRequestPost({request,env}){
 if(dbMissing(env))return bad('Order database is not configured',503);
 if(Number(request.headers.get('content-length')||0)>7*1024*1024)return bad('Request too large',413);
 let form;try{form=await request.formData()}catch{return bad('Invalid order form')}
 const name=clean(form.get('name'),100),phone=clean(form.get('phone'),32),notes=clean(form.get('notes'),1000),proof=form.get('proof');
 if(name.length<2||!/^[+\d\s()-]{7,25}$/.test(phone))return bad('Enter a valid name and phone number');
 let submitted;try{submitted=JSON.parse(String(form.get('items')||'[]'))}catch{return bad('Invalid items')}
 if(!Array.isArray(submitted)||!submitted.length||submitted.length>40)return bad('Choose at least one item');
 // Server-owned pricing only; never trust prices submitted by the browser.
 const catalog={
 'name-clicker':{title:'Personalised Name Clicker',price:350},'game-switch':{title:'Game Switch Clicker',price:null},'switch-keychain':{title:'Game Switch Clicker Keychain',price:null},'coin-bank':{title:'Custom Coin Bank',price:700},'license-plate':{title:'Custom License Plate Keychain',price:null},'clicker-color':{title:'Neon Game Switch Clicker',price:null},'gift-packaging':{title:'Custom Name Keychain',price:null},'coin-bank-color':{title:'Coin Bank — Color Options',price:700}
 };
 if(env.PRINTNEST_BUCKET){try{const object=await env.PRINTNEST_BUCKET.get('catalog/products.json');const extra=object?await object.json():[];for(const p of extra)if(p.id&&Number.isFinite(Number(p.price)))catalog[p.id]={title:clean(p.title,100),price:Math.round(Number(p.price)*100)}}catch{return bad('Product catalog unavailable',503)}}
 let items=[],total=0,unpriced=false;
 for(const s of submitted){let p=catalog[clean(s.id,80)],qty=Number(s.qty);if(!p||!Number.isSafeInteger(qty)||qty<1||qty>100)return bad('Invalid cart item');items.push({id:clean(s.id,80),title:p.title,quantity:qty,price_cents:p.price});if(p.price===null)unpriced=true;else total+=p.price*qty}
 if(total>100000000)return bad('Order exceeds allowed value');
 if(proof&&proof.size){if(!env.PRINTNEST_RECEIPTS)return bad('Receipt storage not configured. Please contact PrintNest or send proof through WhatsApp.',503);if(proof.size>5*1024*1024)return bad('Proof must be 5 MB or smaller',413);if(!receiptTypes[proof.type]||!validReceipt(await proof.slice(0,16).arrayBuffer(),proof.type))return bad('Receipt must be PNG, JPG, WebP or PDF')}
 const id='PN-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,8).toUpperCase();let key=null;
 try{
 if(proof&&proof.size){key=`receipts/${id}.${receiptTypes[proof.type]}`;await env.PRINTNEST_RECEIPTS.put(key,proof.stream(),{httpMetadata:{contentType:proof.type}})}
 await env.PRINTNEST_DB.prepare('INSERT INTO orders(id,customer_name,customer_phone,notes,items_json,total_cents,payment_status,receipt_key,receipt_type) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,name,phone,notes,JSON.stringify(items),unpriced?null:total,key?'awaiting_review':'unpaid',key,key?proof.type:null).run();
 return json({id,success:true,total:unpriced?null:total/100,payment_status:key?'awaiting_review':'unpaid'},201)
 }catch(e){if(key)try{await env.PRINTNEST_RECEIPTS.delete(key)}catch{};return bad('Order could not be saved. Please retry.',500)}
}
export async function onRequestGet({request,env}){
 if(!authorize(request,env))return bad('Unauthorized',401);if(dbMissing(env))return bad('Order database not configured',503);
 const url=new URL(request.url),id=url.searchParams.get('id');
 try{if(id){const r=await env.PRINTNEST_DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();return r?json({order:{...r,items:JSON.parse(r.items_json)}}):bad('Order not found',404)}
 const rows=await env.PRINTNEST_DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 250').all();return json({orders:rows.results.map(r=>({...r,items:JSON.parse(r.items_json)}))})}catch{return bad('Could not load orders',500)}
}
export async function onRequestPatch({request,env}){
 if(!authorize(request,env))return bad('Unauthorized',401);if(dbMissing(env))return bad('Order database not configured',503);
 let data;try{data=await request.json()}catch{return bad('Invalid JSON')}
 const id=clean(data.id,80),ps=clean(data.payment_status,30),fs=clean(data.fulfillment_status,30);
 if(!id||!paymentStates.includes(ps)||!fulfillmentStates.includes(fs))return bad('Invalid order status');
 try{const result=await env.PRINTNEST_DB.prepare('UPDATE orders SET payment_status=?,fulfillment_status=? WHERE id=?').bind(ps,fs,id).run();if(!result.meta?.changes)return bad('Order not found',404);return json({success:true})}catch{return bad('Could not update order',500)}
}
