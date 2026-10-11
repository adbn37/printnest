const PHONE='6737184968';
const seed=[
{id:'name-clicker',title:'Personalised Name Clicker',price:3.50,category:'Clickers',description:'Custom lettering and colors. A tiny tactile treat.',image:'/assets/product-8.webp'},
{id:'game-switch',title:'Game Switch Clicker',price:null,category:'Clickers',description:'Playful handheld-inspired clicker. Ask us for a quote.',image:'/assets/product-3.webp'},
{id:'switch-keychain',title:'Game Switch Clicker Keychain',price:null,category:'Keychains',description:'Gaming-inspired keychain clicker with custom options.',image:'/assets/product-4.webp'},
{id:'coin-bank',title:'Custom Coin Bank',price:7,category:'Gifts',description:'Fun personalized coin bank for gifting.',image:'/assets/product-7.webp'},
{id:'license-plate',title:'Custom License Plate Keychain',price:null,category:'Keychains',description:'A miniature custom license plate for your keys.',image:'/assets/product-2.webp'},
{id:'clicker-color',title:'Neon Game Switch Clicker',price:null,category:'Clickers',description:'Colorful personalized game clicker. Ask for details.',image:'/assets/product-5.webp'},
{id:'gift-packaging',title:'Custom Name Keychain',price:null,category:'Keychains',description:'Personalised little gift for someone special.',image:'/assets/product-6.webp'},
{id:'coin-bank-color',title:'Coin Bank — Color Options',price:7,category:'Gifts',description:'Select your favorite colors and wording.',image:'/assets/product-1.webp'}
];
const $=id=>document.getElementById(id);let products=seed.slice();let filter='All';let bag=[];let token='';
try{bag=JSON.parse(localStorage.getItem('printnest_cart_v1')||'[]');if(!Array.isArray(bag))bag=[];bag=bag.filter(x=>x&&typeof x.id==='string'&&Number.isSafeInteger(Number(x.qty))&&Number(x.qty)>0&&Number(x.qty)<=100).slice(0,40).map(x=>({...x,key:typeof x.key==='string'&&x.key?x.key:crypto.randomUUID()}))}catch{bag=[]};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=p=>p==null?'Ask for price':'BND '+Number(p).toFixed(2);
function toast(s){$('toast').textContent=s;$('toast').style.display='block';clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('toast').style.display='none',3000)}
// V12: customer-facing catalog, product personalisation and per-line cart
let shopSearch='',shopSort='featured',customizeProduct=null,customizeKey=null,customizeReturnToBag=false;
const customDetails=b=>b&&typeof b==='object'&&!Array.isArray(b)?b:{};
const preferenceSummary=c=>[c.wording&&'Wording: '+c.wording,c.color&&'Colour: '+c.color,c.packaging&&c.packaging!=='None'&&'Packaging request: '+c.packaging,c.instructions&&'Instructions: '+c.instructions].filter(Boolean).join(' · ');
function render(){
 const list=products.filter(p=>p.visible!==false&&(filter==='All'||p.category===filter)&&(!shopSearch||[p.title,p.category,p.description].join(' ').toLowerCase().includes(shopSearch)));
 if(shopSort==='name')list.sort((a,b)=>a.title.localeCompare(b.title));
 if(shopSort==='price-low')list.sort((a,b)=>(a.price==null?Infinity:a.price)-(b.price==null?Infinity:b.price));
 if(shopSort==='price-high')list.sort((a,b)=>(b.price==null?-Infinity:b.price)-(a.price==null?-Infinity:a.price));
 $('productCount').textContent=`${list.length} ${list.length===1?'design':'designs'}`;
 const holder=$('products');holder.replaceChildren();
 if(!list.length){const empty=document.createElement('div');empty.className='shop-empty';empty.textContent='No matching designs. Try another search or category.';holder.append(empty);return}
 for(const p of list){
  const card=document.createElement('article');card.className='product';
  card.innerHTML=`<div class="product-image"><img src="${esc(p.image)}" loading="lazy" alt="${esc(p.title)}"><span class="product-category">${esc(p.category)}</span></div><div class="product-info"><h3>${esc(p.title)}</h3><p>${esc(p.description||'Customized 3D printed creation.')}</p><div class="product-bottom"><span class="price">${p.price==null?'On request':price(p.price)}</span><button class="add" type="button" aria-label="Personalise ${esc(p.title)}">Personalise ↗</button></div></div>`;
  card.querySelector('.add').onclick=()=>openCustomizer(p.id);
  holder.append(card);
 }
}
function save(){localStorage.setItem('printnest_cart_v1',JSON.stringify(bag));renderBag()}
function add(id){openCustomizer(id)}
function openCustomizer(id,key=null,returnToBag=false){
 const product=products.find(p=>p.id===id&&p.visible!==false);if(!product)return toast('This design is no longer available');
 customizeProduct=product;customizeKey=key;customizeReturnToBag=returnToBag;
 const old=key?bag.find(x=>x.key===key):null,c=customDetails(old?.customization),f=$('customizeForm');
 f.reset();f.elements.wording.value=c.wording||'';f.elements.color.value=c.color||'';f.elements.packaging.value=c.packaging||'None';f.elements.instructions.value=c.instructions||'';f.elements.qty.value=old?.qty||1;
 $('customizeTitle').textContent=product.title;$('customizeImage').src=product.image;$('customizeImage').alt=product.title;
 $('customizePrice').textContent=product.price==null?'Price on request':price(product.price)+' / item';
 $('customizeAction').textContent=key?'Update bag':'Add to bag';
 $('configurator').hidden=false;document.body.style.overflow='hidden';f.elements.wording.focus();
}
function closeCustomizer(){
 $('configurator').hidden=true;document.body.style.overflow='';customizeProduct=null;customizeKey=null;
 if(customizeReturnToBag){customizeReturnToBag=false;drawer(true)}
}
$('closeConfigurator').onclick=closeCustomizer;
$('configurator').addEventListener('click',e=>{if(e.target===$('configurator'))closeCustomizer()});
$('customizeForm').onsubmit=e=>{
 e.preventDefault();const product=customizeProduct;if(!product)return;
 const f=e.currentTarget,qty=Number(f.elements.qty.value);
 if(!Number.isSafeInteger(qty)||qty<1||qty>100)return toast('Choose 1 to 100 items');
 const customization={wording:f.elements.wording.value.trim(),color:f.elements.color.value.trim(),packaging:f.elements.packaging.value,instructions:f.elements.instructions.value.trim()};
 if(customizeKey){const row=bag.find(x=>x.key===customizeKey);if(row){row.qty=qty;row.customization=customization}}
 else{if(bag.length>=40)return toast('Maximum 40 different order lines.');bag.push({key:crypto.randomUUID(),id:product.id,qty,customization})}
 save();toast(customizeKey?'Item updated':'Added to your bag ✳');closeCustomizer();
};
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('configurator').hidden)closeCustomizer()});
function change(key,delta){const row=bag.find(x=>x.key===key);if(!row)return;row.qty=Math.min(100,row.qty+delta);if(row.qty<=0)bag=bag.filter(x=>x.key!==key);save()}
function renderBag(){
 let n=bag.reduce((a,b)=>a+Number(b.qty||0),0);$('cartCount').textContent=n;$('cartCount2').textContent=n;
 const target=$('cartItems');target.replaceChildren();let total=0,unpriced=false;
 for(const line of bag){
  const p=products.find(x=>x.id===line.id);if(!p)continue;
  if(p.price===null)unpriced=true;else total+=p.price*line.qty;
  const el=document.createElement('div');el.className='cart-line';
  const img=document.createElement('img');img.src=p.image;img.alt=p.title;
  const detail=document.createElement('div');detail.className='detail';
  const title=document.createElement('strong');title.textContent=p.title;
  const amount=document.createElement('small');amount.textContent=price(p.price)+' / item';
  const custom=document.createElement('p');custom.className='bag-customization';custom.textContent=preferenceSummary(customDetails(line.customization))||'No personalisation requested';
  const actions=document.createElement('div');actions.className='bag-actions';
  const edit=document.createElement('button');edit.type='button';edit.textContent='Edit details';edit.onclick=()=>{drawer(false);openCustomizer(line.id,line.key,true)};
  const controls=document.createElement('div');controls.className='quantity-controls';
  const less=document.createElement('button');less.type='button';less.setAttribute('aria-label','Decrease '+p.title);less.textContent='−';less.onclick=()=>change(line.key,-1);
  const number=document.createElement('span');number.textContent=line.qty;
  const more=document.createElement('button');more.type='button';more.setAttribute('aria-label','Increase '+p.title);more.textContent='+';more.disabled=line.qty>=100;more.onclick=()=>change(line.key,1);
  controls.append(less,number,more);actions.append(edit,controls);detail.append(title,amount,custom,actions);el.append(img,detail);target.append(el);
 }
 if(!target.children.length)target.innerHTML='<div class="empty">Your bag is empty.<br>Pick something cute from the shop ✳</div>';
 $('subtotal').textContent=`BND ${total.toFixed(2)}${unpriced?' + quote items':''}`;
}
function drawer(show){$('drawer').classList.toggle('open',show);$('drawer').setAttribute('aria-hidden',String(!show));$('overlay').hidden=!show;document.body.style.overflow=show?'hidden':''}
$('cartButton').onclick=()=>drawer(true);$('closeCart').onclick=()=>drawer(false);$('overlay').onclick=()=>drawer(false);
function whatsapp(message){const url='https://wa.me/'+PHONE+'?text='+encodeURIComponent(message);window.open(url,'_blank','noopener,noreferrer')}
$('checkout').onclick=async()=>{
 if(!bag.length)return toast('Add a product first');
 const name=$('checkoutName').value.trim(),phone=$('checkoutPhone').value.trim(),notes=$('checkoutNotes').value.trim(),proof=$('checkoutProof').files[0];
 if(name.length<2||!/^[+\d\s()-]{7,25}$/.test(phone))return toast('Enter your name and WhatsApp phone number');
 if(proof&&proof.size>5*1024*1024)return toast('Payment proof must be under 5MB');
 const button=$('checkout');button.disabled=true;$('checkoutResult').textContent='Saving your order…';
 const form=new FormData();form.set('name',name);form.set('phone',phone);form.set('notes',notes);form.set('items',JSON.stringify(bag));if(proof)form.set('proof',proof);
 try{const response=await fetch('/api/orders',{method:'POST',body:form});const result=await response.json();if(!response.ok)throw Error(result.error||'Order could not be saved');
 const lines=bag.map(b=>{let p=products.find(x=>x.id===b.id);return p?`• ${p.title} × ${b.qty}${preferenceSummary(customDetails(b.customization))?'\n  '+preferenceSummary(customDetails(b.customization)):''}`:''}).filter(Boolean).join('\n');
 $('checkoutResult').textContent=`Order ${result.id} saved. Please press Send in WhatsApp to notify us.`;
 whatsapp(`Hello 3D PRINTNEST! New website order\nOrder ID: ${result.id}\nName: ${name}\nPhone: ${phone}\nItems:\n${lines}\nTotal: ${result.total===null?'Quotation required':'BND '+Number(result.total).toFixed(2)}\nPayment proof: ${proof?'Uploaded — please verify':'Not uploaded'}\nNotes: ${notes||'None'}\n\nPlease confirm this order. `);
 bag=[];save();
 }catch(e){$('checkoutResult').textContent=e.message;toast(e.message)}finally{button.disabled=false}
};
$('references').onchange=e=>{let files=[...e.target.files];if(files.length>4){e.target.value='';return toast('Maximum 4 pictures')}const root=$('previews');root.innerHTML='';for(const f of files){if(!f.type.startsWith('image/'))continue;let img=new Image();const url=URL.createObjectURL(f);img.src=url;img.onload=()=>URL.revokeObjectURL(url);root.append(img)}};
$('customForm').onsubmit=e=>{e.preventDefault();const form=new FormData(e.currentTarget);const files=[...$('references').files];if(files.length>4)return toast('Maximum 4 pictures');let txt=`Hello 3D PRINTNEST! I'd like a custom 3D print quotation.\n\nName: ${form.get('name')}\nDescription: ${form.get('description')}\nQuantity: ${form.get('quantity')}\nPreferred color: ${form.get('color')||'Flexible'}\nReference images: ${files.length} (I'll attach separately here in WhatsApp)\n\nPlease let me know if this can be made and the estimated price. Thank you!`;whatsapp(txt);if(files.length)toast('Attach your selected pictures manually in WhatsApp')};
document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');filter=b.dataset.filter;render()});
$('shopSearch').addEventListener('input',e=>{shopSearch=e.target.value.trim().toLowerCase();render()});
$('shopSort').addEventListener('change',e=>{shopSort=e.target.value;render()});
function admin(show){$('adminModal').hidden=!show;document.body.style.overflow=show?'hidden':''} $('adminLink').onclick=()=>{window.location.href='/admin/'};$('closeAdmin').onclick=()=>admin(false);$('adminModal').onclick=e=>{if(e.target===$('adminModal'))admin(false)};
function msg(s){$('adminMessage').textContent=s}function password(){token=$('adminPassword').value.trim();return token}
async function loadLive(){try{const r=await fetch('/api/products',{cache:'no-store'});if(!r.ok)throw Error('Request failed');let data=await r.json();if(Array.isArray(data.products)){const map=new Map(seed.map(p=>[p.id,p]));for(const p of data.products){if(!p||!p.id)continue;map.set(p.id,{...(map.get(p.id)||{}),...p})}products=[...map.values()].filter(p=>p.visible!==false&&p.archived!==true);const before=bag.length;bag=bag.filter(b=>products.some(p=>p.id===b.id));if(before!==bag.length)localStorage.setItem('printnest_cart_v1',JSON.stringify(bag));render();renderBag();renderAdmin()}}catch(e){console.warn('Live catalog unavailable:',e)}}
function renderAdmin(){const holder=$('adminProducts');holder.innerHTML='<h4>Uploaded products</h4>';const uploaded=products.filter(p=>p.id.startsWith('up-'));if(!uploaded.length){holder.innerHTML+='<div class="empty">No uploaded products yet.</div>';return}for(const p of uploaded){const row=document.createElement('div');row.className='admin-entry';let name=document.createElement('span');name.textContent=p.title;let del=document.createElement('button');del.textContent='Delete';del.onclick=()=>deleteProduct(p.id);row.append(name,del);holder.append(row)}}
$('adminLoad').onclick=async()=>{if(!password())return msg('Enter the administrator password.');try{let r=await fetch('/api/admin/check',{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw Error('Wrong password or admin not configured');msg('Admin access verified.');await loadLive();await loadOrders()}catch(e){msg(e.message)}};
$('adminForm').onsubmit=async e=>{e.preventDefault();if(!password())return msg('Enter the administrator password.');const btn=e.currentTarget.querySelector('button[type=submit]');const body=new FormData(e.currentTarget);const file=body.get('image');if(file?.size>8*1024*1024)return msg('Image must be 8 MB or smaller.');btn.disabled=true;msg('Uploading...');try{let r=await fetch('/api/products',{method:'POST',headers:{Authorization:`Bearer ${token}`},body});const data=await r.json();if(!r.ok)throw Error(data.error||'Upload failed');msg('Product published.');e.currentTarget.reset();await loadLive()}catch(err){msg(err.message)}finally{btn.disabled=false}};
async function deleteProduct(id){if(!password())return msg('Enter administrator password.');if(!confirm('Delete this product?'))return;try{let r=await fetch('/api/products?id='+encodeURIComponent(id),{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});const data=await r.json();if(!r.ok)throw Error(data.error||'Delete failed');bag=bag.filter(x=>x.id!==id);save();msg('Product removed.');await loadLive()}catch(e){msg(e.message)}}
render();renderBag();loadLive();

async function loadOrders(){
 if(!token)return msg('Verify your admin password first');
 const holder=$('adminOrders');holder.textContent='Loading orders…';
 try{const r=await fetch('/api/orders',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'Could not load orders');const orders=data.orders||[];
 $('orderSummary').textContent=`${orders.length} recent orders · ${orders.filter(x=>x.payment_status==='awaiting_review').length} payments to review · ${orders.filter(x=>x.fulfillment_status==='new').length} new orders`;
 holder.innerHTML='';if(!orders.length){holder.textContent='No orders yet.';return}
 for(const o of orders){const card=document.createElement('article');card.className='order-card';
 const title=document.createElement('h4');title.textContent=`${o.id} — ${o.customer_name}`;card.append(title);
 const details=document.createElement('p');details.textContent=`${o.created_at} · ${o.customer_phone} · ${o.total_cents===null?'Quote required':'BND '+(o.total_cents/100).toFixed(2)}`;card.append(details);
 const lines=document.createElement('p');lines.textContent=o.items.map(i=>`${i.title} × ${i.quantity}`).join(' · ');card.append(lines);
 const notes=document.createElement('p');notes.textContent='Notes: '+(o.notes||'None');card.append(notes);
 if(o.receipt_key){
 const button=document.createElement('button');button.className='btn secondary';button.type='button';button.textContent='View payment proof';
 const preview=document.createElement('div');preview.hidden=true;preview.style.cssText='margin:12px 0;max-width:100%;overflow:hidden';
 let currentUrl=null;
 button.onclick=async()=>{
  if(!preview.hidden){preview.hidden=true;button.textContent='View payment proof';return}
  button.disabled=true;button.textContent='Loading receipt…';
  try{
   const r=await fetch('/api/admin/receipt?id='+encodeURIComponent(o.id),{headers:{Authorization:'Bearer '+token},cache:'no-store'});
   if(!r.ok){let error='HTTP '+r.status;try{const data=await r.json();error=data.error||error}catch{}throw Error(error)}
   const blob=await r.blob();
   if(currentUrl)URL.revokeObjectURL(currentUrl);
   currentUrl=URL.createObjectURL(blob);
   preview.replaceChildren();
   if(blob.type.startsWith('image/')){
    const img=document.createElement('img');img.src=currentUrl;img.alt='Payment proof for '+o.id;img.style.cssText='display:block;max-width:100%;max-height:65vh;object-fit:contain;border-radius:10px';preview.append(img);
   }else if(blob.type==='application/pdf'){
    const frame=document.createElement('iframe');frame.src=currentUrl;frame.title='Payment proof for '+o.id;frame.style.cssText='width:100%;height:65vh;border:1px solid #ddd;border-radius:10px';preview.append(frame);
   }else{throw Error('Unsupported receipt format')}
   const link=document.createElement('a');link.href=currentUrl;link.download='printnest-receipt-'+o.id+(blob.type==='application/pdf'?'.pdf':blob.type==='image/png'?'.png':blob.type==='image/webp'?'.webp':'.jpg');link.textContent='Download receipt';link.style.cssText='display:inline-block;margin-top:10px;text-decoration:underline';preview.append(link);
   preview.hidden=false;button.textContent='Hide payment proof';msg('');
  }catch(e){msg('Receipt error: '+e.message);button.textContent='View payment proof'}
  finally{button.disabled=false}
 };
 card.append(button,preview)
}
 const fields=document.createElement('div');fields.className='form-pair';
 function field(label,options,value){const l=document.createElement('label');l.textContent=label;const select=document.createElement('select');for(const option of options){const e=document.createElement('option');e.value=option;e.textContent=option.replaceAll('_',' ');select.append(e)}select.value=value;l.append(select);fields.append(l);return select}
 const payment=field('Payment',['unpaid','awaiting_review','verified','rejected'],o.payment_status),stage=field('Order stage',['new','confirmed','printing','ready','completed','cancelled'],o.fulfillment_status);card.append(fields);
 const saveBtn=document.createElement('button');saveBtn.className='btn primary';saveBtn.textContent='Save status';saveBtn.onclick=async()=>{saveBtn.disabled=true;try{const r=await fetch('/api/orders',{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({id:o.id,payment_status:payment.value,fulfillment_status:stage.value})});const data=await r.json();if(!r.ok)throw Error(data.error||'Update failed');msg('Order '+o.id+' updated');await loadOrders()}catch(e){msg(e.message)}finally{saveBtn.disabled=false}};card.append(saveBtn);holder.append(card)
 }
 }catch(e){holder.textContent=e.message}
}
$('loadOrders').onclick=loadOrders;
