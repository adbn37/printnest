const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
let jwt='',me=null,orders=[],products=[];const bnd=c=>'BND '+((Number(c)||0)/100).toFixed(2);
function message(s){$('notice').textContent=s;$('loginMessage').textContent=s}async function api(path,options={}){const r=await fetch('/api/portal/'+path,{...options,headers:{Authorization:'Bearer '+jwt,...options.headers},cache:'no-store'});let data;try{data=await r.json()}catch{throw Error('Invalid response ('+r.status+')')}if(!r.ok)throw Error(data.error||'HTTP '+r.status);return data}
function section(name){document.querySelectorAll('.section').forEach(x=>x.hidden=x.id!==name);document.querySelectorAll('[data-section]').forEach(x=>x.classList.toggle('selected',x.dataset.section===name));$('sectionTitle').textContent=name[0].toUpperCase()+name.slice(1);document.querySelector('.sidebar').classList.remove('open');if(name==='orders')renderOrders();if(name==='products')loadProducts();if(name==='finance')loadFinance()}
const SESSION_KEY='printnest_google_credential';
function clearSession(){sessionStorage.removeItem(SESSION_KEY);jwt='';me=null;orders=[]}
async function signIn(credential){
 jwt=credential;
 try{
  me=await api('me');
  sessionStorage.setItem(SESSION_KEY,credential);
  $('signin').hidden=true;$('portal').hidden=false;
  $('userEmail').textContent=me.email;
  $('roleBadge').textContent=me.role==='developer'?'Developer':'Master Admin';
  await loadOrders();
 }catch(e){clearSession();$('portal').hidden=true;$('signin').hidden=false;message(e.message)}
}
async function start(){
 const cached=sessionStorage.getItem(SESSION_KEY);
 if(cached){
  await signIn(cached);
  if(me)return;
 }
 try{
  const r=await fetch('/api/portal/config');const c=await r.json();
  if(!c.clientId){message('Set GOOGLE_CLIENT_ID in Cloudflare Pages Production variables.');return}
  let tries=0;
  const tick=()=>{
   if(!window.google?.accounts?.id){if(++tries<90)setTimeout(tick,150);else message('Google Sign-In script did not load.');return}
   google.accounts.id.initialize({client_id:c.clientId,callback:r=>signIn(r.credential),auto_select:false});
   google.accounts.id.renderButton($('googleBtn'),{theme:'outline',size:'large',width:260,text:'signin_with'});
  };tick();
 }catch(e){message('Could not initialize Google Sign-In: '+e.message)}
}
async function loadOrders(){try{const d=await api('orders');orders=d.orders||[];$('statOrders').textContent=orders.length;$('statReview').textContent=orders.filter(o=>o.payment_status==='awaiting_review').length;$('statPrinting').textContent=orders.filter(o=>o.fulfillment_status==='printing').length;$('statDone').textContent=orders.filter(o=>o.fulfillment_status==='completed').length;$('recentOrders').innerHTML='<div class="simple-row simple-head"><span>Order</span><span>Customer</span><span>Amount</span><span>Payment</span></div>'+ (orders.slice(0,8).map(o=>`<div class="simple-row"><strong>${esc(o.id)}</strong><span>${esc(o.customer_name)}</span><span>${o.total_cents===null?'Quote needed':bnd(o.total_cents)}</span><span class="status-text">${esc(o.payment_status.replaceAll('_',' '))}</span></div>`).join('')||'<div class="empty-row">No orders yet</div>');renderOrders();}catch(e){message(e.message)}}
function opt(values,current){return values.map(v=>`<option value="${v}" ${v===current?'selected':''}>${v.replaceAll('_',' ')}</option>`).join('')}
function renderOrders(){const q=$('search').value.trim().toLowerCase(),f=$('paymentFilter').value,stageFilter=$('stageFilter').value;const list=orders.filter(o=>(!f||o.payment_status===f)&&(!stageFilter||o.fulfillment_status===stageFilter)&&[o.id,o.customer_name,o.customer_phone].some(x=>String(x||'').toLowerCase().includes(q)));$('orderList').replaceChildren();for(const o of list){const el=document.createElement('article');el.className='panel order';el.innerHTML=`<div class="order-head"><h3>${esc(o.id)}</h3><span class="pill">${esc(o.fulfillment_status)}</span></div><p><strong>${esc(o.customer_name)}</strong> · ${esc(o.customer_phone)} · ${o.total_cents===null?'Quote required':bnd(o.total_cents)}</p><p>${(o.items||[]).map(i=>esc(i.title)+' × '+Number(i.quantity)).join(' · ')}</p><p class="muted">${esc(o.notes||'No notes')}</p><div class="toolbar"><label>Payment<select class="pay">${opt(['unpaid','awaiting_review','verified','rejected'],o.payment_status)}</select></label><label>Production<select class="stage">${opt(['new','confirmed','printing','ready','completed','cancelled'],o.fulfillment_status)}</select></label><button class="save">Save status</button>${o.receipt_key?'<button class="receipt">View proof</button>':''}</div><div class="preview" hidden></div>`;
 el.querySelector('.save').onclick=async()=>{if(el.querySelector('.pay').value==='verified'&&o.payment_status!=='verified'&&!confirm('Have you checked the actual bank transaction? A screenshot alone is NOT proof of payment.'))return;try{await api('orders',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:o.id,payment_status:el.querySelector('.pay').value,fulfillment_status:el.querySelector('.stage').value})});message('Order status saved.');await loadOrders()}catch(e){message(e.message)}};
 if(o.receipt_key)el.querySelector('.receipt').onclick=async()=>{const out=el.querySelector('.preview');if(!out.hidden){out.hidden=true;return}try{const r=await fetch('/api/portal/receipt?id='+encodeURIComponent(o.id),{headers:{Authorization:'Bearer '+jwt},cache:'no-store'});if(!r.ok){let d=await r.json();throw Error(d.error||r.status)}const blob=await r.blob(),url=URL.createObjectURL(blob);out.replaceChildren();if(blob.type.startsWith('image/')){const img=document.createElement('img');img.src=url;img.alt='Receipt';out.append(img)}else if(blob.type==='application/pdf'){const frame=document.createElement('iframe');frame.src=url;frame.title='Receipt';out.append(frame)}const a=document.createElement('a');a.textContent='Download proof';a.download=o.id+(blob.type==='application/pdf'?'.pdf':'.png');a.href=url;out.append(a);out.hidden=false}catch(e){message('Receipt: '+e.message)}};
 $('orderList').append(el)}if(!list.length)$('orderList').textContent='No matching orders.'}
async function loadProducts(){
 try{
  const d=await api('products');products=d.products||[];
  const holder=$('productList');holder.replaceChildren();if(d.warning)message(d.warning);
  if(!products.length){holder.textContent='No uploaded products yet. The eight original designs remain part of the starter shop.';return}
  for(const p of products){
   const card=document.createElement('article');card.className='panel';
   const form=document.createElement('form');form.className='product-editor';
   form.innerHTML=`<h3>${esc(p.title)}</h3><div class="fields"><label>Title<input name="title" value="${esc(p.title)}" required maxlength="100"></label><label>Price (BND)<input name="price" type="number" step="0.01" min="0" value="${Number(p.price).toFixed(2)}" required></label><label>Category<select name="category"><option>Clickers</option><option>Keychains</option><option>Gifts</option></select></label><label>Replace photo (optional)<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label></div><label>Description<textarea name="description" maxlength="350" rows="2">${esc(p.description||'')}</textarea></label><label class="toggle-row"><input name="visible" type="checkbox" ${p.visible===false?'':'checked'}> Visible in storefront</label><div class="toolbar"><button class="primary" type="submit">Save product</button><button type="button" class="remove-product">Delete</button></div>`;
   form.querySelector('[name=category]').value=p.category;
   form.onsubmit=async e=>{e.preventDefault();const btn=form.querySelector('[type=submit]');btn.disabled=true;try{const body=new FormData(form);body.set('id',p.id);body.set('visible',String(form.querySelector('[name=visible]').checked));await api('products',{method:'PATCH',body});message('Product updated.');await loadProducts()}catch(e){message(e.message)}finally{btn.disabled=false}};
   form.querySelector('.remove-product').onclick=async()=>{if(!confirm('Delete '+p.title+'? Existing orders remain in history.'))return;try{await api('products?id='+encodeURIComponent(p.id),{method:'DELETE'});message('Product removed.');await loadProducts()}catch(e){message(e.message)}};
   const image=document.createElement('img');image.src=p.image;image.alt=p.title;image.loading='lazy';image.style.cssText='max-width:140px;max-height:140px;object-fit:cover;border-radius:12px;margin-bottom:12px';
   card.append(image,form);holder.append(card)
  }
 }catch(e){message(e.message)}
}
async function loadFinance(){try{const d=await api('finance');$('finRevenue').textContent=bnd(d.sales_cents);$('finExpenses').textContent=bnd(d.expenses_cents);$('finNet').textContent=bnd(d.net_cents);$('finCount').textContent=d.verified_count;$('expenseList').replaceChildren();for(const e of d.expenses){const el=document.createElement('div');el.className='simple-row';el.innerHTML=`<span>${esc(e.occurred_on)}</span><strong>${esc(e.description)}</strong><span>${esc(e.category)}</span><span>${bnd(e.amount_cents)}</span>`;const del=document.createElement('button');del.textContent='Delete';del.onclick=async()=>{if(!confirm('Delete this expense?'))return;try{await api('finance?id='+encodeURIComponent(e.id),{method:'DELETE'});await loadFinance()}catch(x){message(x.message)}};el.append(del);$('expenseList').append(el)}}catch(e){message(e.message)}}
document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>section(b.dataset.section));$('menu').onclick=()=>document.querySelector('.sidebar').classList.toggle('expanded');$('logout').onclick=()=>{clearSession();$('portal').hidden=true;$('signin').hidden=false;google?.accounts?.id?.disableAutoSelect?.();message('Signed out.');};$('search').oninput=renderOrders;$('paymentFilter').onchange=renderOrders;$('stageFilter').onchange=renderOrders;$('refreshOrders').onclick=loadOrders;
$('productForm').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{await api('products',{method:'POST',body:new FormData(e.target)});e.target.reset();message('Product published.');await loadProducts()}catch(x){message(x.message)}finally{btn.disabled=false}};
$('expenseForm').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{await api('finance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});e.target.reset();message('Expense saved.');await loadFinance()}catch(x){message(x.message)}finally{btn.disabled=false}};
$('expenseForm').querySelector('[name="occurred_on"]').value=new Date().toLocaleDateString('en-CA');start();
