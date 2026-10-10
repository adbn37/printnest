const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
let jwt='',me=null,orders=[],products=[];const bnd=c=>'BND '+((Number(c)||0)/100).toFixed(2);
function message(s){$('notice').textContent=s;$('loginMessage').textContent=s}async function api(path,options={}){const r=await fetch('/api/portal/'+path,{...options,headers:{Authorization:'Bearer '+jwt,...options.headers},cache:'no-store'});let data;try{data=await r.json()}catch{throw Error('Invalid response ('+r.status+')')}if(!r.ok)throw Error(data.error||'HTTP '+r.status);return data}
function section(name){document.querySelectorAll('.section').forEach(x=>x.hidden=x.id!==name);document.querySelectorAll('[data-section]').forEach(x=>x.classList.toggle('selected',x.dataset.section===name));$('sectionTitle').textContent=name[0].toUpperCase()+name.slice(1);document.querySelector('.sidebar').classList.remove('open');if(name==='orders'){renderOrders();loadOrderProducts()}if(name==='products')loadProducts();if(name==='inventory')loadInventory();if(name==='finance'){loadFinance();toggleFinancePurchase()}}
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
function renderOrders(){const q=$('search').value.trim().toLowerCase(),f=$('paymentFilter').value,stageFilter=$('stageFilter').value;const list=orders.filter(o=>(!f||o.payment_status===f)&&(!stageFilter||o.fulfillment_status===stageFilter)&&[o.id,o.customer_name,o.customer_phone].some(x=>String(x||'').toLowerCase().includes(q)));$('orderList').replaceChildren();for(const o of list){const el=document.createElement('article');el.className='panel order';el.innerHTML=`<div class="order-head"><h3>${esc(o.id)}</h3><span class="pill">${esc(o.fulfillment_status)}</span></div><p><strong>${esc(o.customer_name)}</strong> · ${esc(o.customer_phone)} · ${o.total_cents===null?'Quote required':bnd(o.total_cents)}</p><p>${(o.items||[]).map(i=>esc(i.title)+' × '+Number(i.quantity)).join(' · ')}</p><p class="muted">${(o.items||[]).map(i=>i.print_weight_g!=null&&i.print_minutes!=null&&i.print_cost_cents!=null?esc(i.title)+' (×'+i.quantity+'): '+(Number(i.print_weight_g)*Number(i.quantity)).toFixed(2)+'g · '+Number(i.print_minutes)*Number(i.quantity)+'min · '+bnd(Number(i.print_cost_cents)*Number(i.quantity)):'').filter(Boolean).join(' | ')||'No stored Creality estimate (older order or product not configured)'}</p><p class="muted">${esc(o.notes||'No notes')}</p><div class="toolbar order-status-controls"><label>Payment<select class="pay">${opt(['unpaid','awaiting_review','verified','rejected'],o.payment_status)}</select></label><label>Production<select class="stage">${opt(['new','confirmed','awaiting_materials','printing','ready','completed','cancelled'],o.fulfillment_status)}</select></label><button class="save">Save status</button></div><div class="order-extra-actions"><button class="addons" type="button">Order extras</button><button class="stock-check" type="button">Check materials</button>${o.receipt_key?'<button class="receipt">View proof</button>':''}</div><div class="extras-edit" hidden></div><div class="material-check" role="status" hidden></div><div class="preview" hidden></div>`;
 el.querySelector('.addons').onclick=async()=>{
  const editor=el.querySelector('.extras-edit');if(!editor.hidden){editor.hidden=true;return}editor.hidden=false;editor.textContent='Loading optional accessories…';
  try{
   const [stock,saved]=await Promise.all([api('inventory'),api('order-extras?id='+encodeURIComponent(o.id))]);
   editor.replaceChildren();
   const heading=document.createElement('strong');heading.textContent='Optional accessories for this order';editor.append(heading);
   const hint=document.createElement('p');hint.className='muted';hint.textContent='Choose boxes, plastic or accessories only for this customer. They are deducted when printing starts.';editor.append(hint);
   const rows=document.createElement('div');rows.className='recipe-stack';editor.append(rows);
   const available=stock.items.filter(i=>i.category!=='Filament');
   function addRow(itemId='',count=1){
    const wrap=document.createElement('div');wrap.className='recipe-row';const label=document.createElement('label');label.textContent='Accessory';
    const select=newSelect([['','Select accessory'],...available.map(i=>[i.id,i.name+' · '+i.quantity+' '+i.unit+' left'])]);select.value=itemId;label.append(select);
    const amount=document.createElement('label');amount.textContent='Quantity';const qty=document.createElement('input');qty.type='number';qty.min='1';qty.step='1';qty.value=count;amount.append(qty);
    const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.onclick=()=>wrap.remove();wrap.append(label,amount,remove);rows.append(wrap);
    return wrap;
   }
   for(const item of saved.items)addRow(item.item_id,item.quantity_units);
   const buttons=document.createElement('div');buttons.className='order-extra-actions';const add=document.createElement('button');add.type='button';add.textContent='+ Add accessory';add.onclick=()=>addRow();
   const submit=document.createElement('button');submit.type='button';submit.textContent='Save extras';submit.className='primary';
   const notice=document.createElement('div');notice.className='muted';notice.setAttribute('role','status');
   submit.onclick=async()=>{const items=[];for(const row of rows.children){const id=row.querySelector('select').value,q=Number(row.querySelector('input').value);if(!id||!Number.isInteger(q)||q<1){notice.textContent='Select an accessory and a whole quantity for every row.';return}items.push({item_id:id,quantity_units:q})}
    submit.disabled=true;try{await api('order-extras',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:o.id,items})});notice.textContent='Extras saved. Check materials before printing.';message('Accessories saved for '+o.id+'.');}catch(e){notice.textContent='Could not save extras: '+e.message}finally{submit.disabled=false}
   };
   buttons.append(add,submit);editor.append(buttons,notice);
  }catch(e){editor.textContent='Could not load accessories: '+e.message}
 };
 el.querySelector('.stock-check').onclick=async()=>{const out=el.querySelector('.material-check');out.hidden=false;out.textContent='Checking stock…';
  try{const d=await api('material-check?id='+encodeURIComponent(o.id));out.classList.toggle('is-short',!d.available);
   out.textContent=d.started?'Production already recorded. Stock was deducted when this order entered Printing.':d.available?'All materials available — ready to start Printing.':
    ['Cannot start printing yet.',...(d.missing_products?.length?['Missing product material recipes: '+d.missing_products.join(', ')]:[]),...(d.shortages||[]).map(x=>x.label+': need '+x.required+' '+x.unit+', available '+x.available+' '+x.unit+', shortage '+x.shortfall+' '+x.unit)].join('\n')}
  catch(err){out.classList.add('is-short');out.textContent=err.message}
 };
 el.querySelector('.save').onclick=async()=>{if(el.querySelector('.pay').value==='verified'&&o.payment_status!=='verified'&&!confirm('Have you checked the actual bank transaction? A screenshot alone is NOT proof of payment.'))return;try{const saved=await api('orders',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:o.id,payment_status:el.querySelector('.pay').value,fulfillment_status:el.querySelector('.stage').value})});await loadOrders();message(saved.registered?'Order saved. Material stock deducted once; Creality cost posted to Finance.':saved.blocked?'Order moved to Awaiting materials. '+(saved.missing_products?.length?'Configure materials for '+saved.missing_products.join(', ')+'. ':'')+(saved.shortages||[]).map(x=>x.label+' short '+x.shortfall+' '+x.unit).join('; '):'Order status saved. No duplicate stock deduction.')}catch(e){message(e.message)}};
 if(o.receipt_key)el.querySelector('.receipt').onclick=async()=>{const out=el.querySelector('.preview');if(!out.hidden){out.hidden=true;return}try{const r=await fetch('/api/portal/receipt?id='+encodeURIComponent(o.id),{headers:{Authorization:'Bearer '+jwt},cache:'no-store'});if(!r.ok){let d=await r.json();throw Error(d.error||r.status)}const blob=await r.blob(),url=URL.createObjectURL(blob);out.replaceChildren();if(blob.type.startsWith('image/')){const img=document.createElement('img');img.src=url;img.alt='Receipt';out.append(img)}else if(blob.type==='application/pdf'){const frame=document.createElement('iframe');frame.src=url;frame.title='Receipt';out.append(frame)}const a=document.createElement('a');a.textContent='Download proof';a.download=o.id+(blob.type==='application/pdf'?'.pdf':'.png');a.href=url;out.append(a);out.hidden=false}catch(e){message('Receipt: '+e.message)}};
 $('orderList').append(el)}if(!list.length)$('orderList').textContent='No matching orders.'}
// PrintNest V3: selected material recipes, order builder, bundles.
let materialSources={rolls:[],items:[]};
let catalogOptions=[];
function inlineStatus(id,text,error=false){const el=$(id);el.hidden=!text;el.textContent=text;el.classList.toggle('is-error',error)}
async function loadProductSources(){
 const [r,s]=await Promise.all([api('production'),api('inventory')]);
 materialSources={rolls:r.rolls||[],items:s.items||[]};
}
function groupedFilament(){const map=new Map();for(const r of materialSources.rolls){const k=JSON.stringify([r.material,r.color]);if(!map.has(k))map.set(k,{material:r.material,color:r.color,remaining:0});map.get(k).remaining+=Number(r.remaining_mg||0)}return [...map.entries()]}
function newSelect(options){const select=document.createElement('select');for(const [v,name] of options){const el=document.createElement('option');el.value=v;el.textContent=name;select.append(el)}return select}
function recipeRow(holder,kind,prefill=null){
 const div=document.createElement('div');div.className='recipe-row';div.dataset.kind=kind;
 const label=document.createElement('label');label.textContent=kind==='filament'?'Filament colour':'Accessory / packaging';
 const options=kind==='filament'?groupedFilament().map(([k,v])=>[k,v.material+' · '+v.color+' ('+(v.remaining/1000).toFixed(1)+' g left)']):materialSources.items.map(i=>[i.id,i.name+' · '+i.quantity+' '+i.unit+' left']);
 const select=newSelect([['','Select stock item'],...options]);select.className='recipe-stock';select.required=true;
 if(prefill){select.value=kind==='filament'?JSON.stringify([prefill.material,prefill.color]):prefill.item_id;
  if(!select.value){const key=kind==='filament'?JSON.stringify([prefill.material,prefill.color]):prefill.item_id;const opt=document.createElement('option');opt.value=key;opt.textContent=(prefill.name||prefill.material+' '+prefill.color)+' (not currently stocked)';select.append(opt);select.value=key;}
 }
 label.append(select);
 const qLabel=document.createElement('label');qLabel.textContent=kind==='filament'?'Grams per unit':'Qty per unit';
 const qty=document.createElement('input');qty.type='number';qty.className='recipe-qty';qty.required=true;qty.step=kind==='filament'?'0.001':'1';qty.min=kind==='filament'?'0.001':'1';qty.max=kind==='filament'?'100000':'100000';qty.placeholder=kind==='filament'?'g':'pcs';
 if(prefill)qty.value=kind==='filament'?Number(prefill.quantity_mg/1000).toFixed(3):prefill.quantity_units;qLabel.append(qty);
 const del=document.createElement('button');del.type='button';del.textContent='Remove';del.onclick=()=>div.remove();
 div.append(label,qLabel,del);holder.append(div);return div;
}
function collectRecipe(root){const materials=[];for(const row of root.querySelectorAll('.recipe-row')){
 const kind=row.dataset.kind,choice=row.querySelector('.recipe-stock').value,qty=row.querySelector('.recipe-qty').value;
 if(!choice||!qty)throw Error('Select every material and enter its quantity');
 if(kind==='filament'){const [material,color]=JSON.parse(choice);materials.push({kind,material,color,grams:qty})}
 else materials.push({kind:'item',item_id:choice,quantity_units:qty});
 }return materials}
function makeRecipeEditor(form,initial=[]){
 const container=document.createElement('fieldset');container.className='recipe-fields';
 const legend=document.createElement('legend');legend.textContent='Materials required for one product';
 const hint=document.createElement('p');hint.className='muted';hint.textContent='Assign only filament grams here. Boxes, plastic and accessories are chosen separately for each order.';
 const rows=document.createElement('div');rows.className='recipe-stack';rows.dataset.recipeRows='true';
 const addFilament=document.createElement('button');addFilament.type='button';addFilament.className='secondary-action';addFilament.textContent='+ Filament';addFilament.onclick=()=>recipeRow(rows,'filament');
 const addItem=document.createElement('button');addItem.type='button';addItem.className='secondary-action';addItem.textContent='+ Accessory / packaging';addItem.onclick=()=>recipeRow(rows,'item');
 container.append(legend,hint,rows,addFilament);
 for(const item of initial.filter(m=>m.kind==='filament'))recipeRow(rows,item.kind,item);
 if(form.id==='productForm')$('newProductMaterials').append(container);else {const visible=form.querySelector('label.toggle-row');form.insertBefore(container,visible)}
 return rows;
}
function dropdownOrderRow(holder,{bundleOnly=false}={}){
 const row=document.createElement('div');row.className='recipe-row';
 const label=document.createElement('label');label.textContent='Product';
 const values=catalogOptions.filter(p=>p.visible!==false&&(!bundleOnly||p.product_type!=='bundle')).map(p=>[p.id,p.title+(p.price===null?' · Quote required':' · BND '+Number(p.price).toFixed(2))]);
 const select=newSelect([['','Select product'],...values]);select.required=true;select.className='product-choice';label.append(select);
 const qtyLabel=document.createElement('label');qtyLabel.textContent='Quantity';const qty=document.createElement('input');qty.type='number';qty.min='1';qty.max='100';qty.value='1';qty.required=true;qty.className='product-qty';qtyLabel.append(qty);
 const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.onclick=()=>row.remove();row.append(label,qtyLabel,remove);holder.append(row);return row;
}
function productRows(holder){const result=[];for(const row of holder.querySelectorAll('.recipe-row')){const id=row.querySelector('.product-choice').value,quantity=Number(row.querySelector('.product-qty').value);if(!id||!Number.isInteger(quantity)||quantity<1||quantity>100)throw Error('Select product and valid quantity');result.push({id,quantity})}if(!result.length)throw Error('Add at least one product');return result}
async function loadOrderProducts(){try{const d=await api('products');catalogOptions=d.products||[];if(!$('manualLines').childElementCount)dropdownOrderRow($('manualLines'));else{const old=productRowsOptional($('manualLines'));$('manualLines').replaceChildren();for(const item of old){const row=dropdownOrderRow($('manualLines'));row.querySelector('.product-choice').value=item.id;row.querySelector('.product-qty').value=item.quantity}}
 }catch(e){inlineStatus('manualFeedback','Products unavailable: '+e.message,true)}}
function productRowsOptional(holder){return [...holder.querySelectorAll('.recipe-row')].map(r=>({id:r.querySelector('.product-choice').value,quantity:r.querySelector('.product-qty').value}))}
function refreshBundleRows(){const holder=$('bundleLines'),old=productRowsOptional(holder);holder.replaceChildren();for(const item of old.length?old:[{}]){const row=dropdownOrderRow(holder,{bundleOnly:true});row.querySelector('.product-choice').value=item.id||'';row.querySelector('.product-qty').value=item.quantity||1}}
$('manualAddLine').onclick=()=>dropdownOrderRow($('manualLines'));
$('bundleAddLine').onclick=()=>dropdownOrderRow($('bundleLines'),{bundleOnly:true});
$('bundleAddExtra').onclick=()=>{}; // Order-specific extras only, no mandatory bundle packaging
$('manualOrderForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,btn=form.querySelector('[type=submit]');btn.disabled=true;
 try{const fields=Object.fromEntries(new FormData(form));const items=productRows($('manualLines'));const out=await api('manual-orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,items})});form.reset();$('manualLines').replaceChildren();dropdownOrderRow($('manualLines'));inlineStatus('manualFeedback','Order '+out.id+' created as Unpaid / New.');await loadOrders()}
 catch(err){inlineStatus('manualFeedback',err.message,true)}finally{btn.disabled=false}
};
$('bundleForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,btn=form.querySelector('[type=submit]');btn.disabled=true;
 try{const fields=Object.fromEntries(new FormData(form));const components=productRows($('bundleLines'));const extras=[];
 await api('bundles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,components,extras})});form.reset();$('bundleLines').replaceChildren();$('bundleExtras').replaceChildren();inlineStatus('bundleFeedback','Bundle created successfully.');await loadProducts()}
 catch(err){inlineStatus('bundleFeedback',err.message,true)}finally{btn.disabled=false}
};

function printingInputs(p={}){const w=p.print_weight_g??'',t=p.print_minutes??'',c=p.print_cost_cents==null?'':(p.print_cost_cents/100).toFixed(2);return `<fieldset class="creality-fields"><legend>Creality print estimates (internal)</legend><p class="muted">Copy the values from the Creality app. Leave all three blank if unknown.</p><div class="creality-grid"><label>Weight (g)<input name="print_weight_g" type="number" step="0.001" min="0.001" value="${esc(w)}" placeholder="g"></label><label>Time (minutes)<input name="print_minutes" type="number" step="1" min="1" value="${esc(t)}" placeholder="minutes"></label><label>Cost (BND)<input name="print_cost" type="number" step="0.01" min="0" value="${esc(c)}" placeholder="BND"></label></div></fieldset>`}
function printingSummary(p){return p.print_weight_g!=null&&p.print_minutes!=null&&p.print_cost_cents!=null?`${p.print_weight_g} g · ${p.print_minutes} min · ${bnd(p.print_cost_cents)} estimated cost`:'Creality details not set'}
function productFeedback(text,isError=false){const el=$('productFeedback');if(!el)return;el.hidden=!text;el.textContent=text;el.classList.toggle('is-error',isError)}
function productTop(){const heading=$('products');if(heading)heading.scrollIntoView({behavior:'smooth',block:'start'})}
async function loadProducts(){
 try{
  const [d]=await Promise.all([api('products'),loadProductSources()]);products=d.products||[];catalogOptions=products;refreshBundleRows();
  const holder=$('productList');holder.replaceChildren();if(d.warning)message(d.warning);
  if(!products.length){holder.textContent='No products found.';return}
  for(const p of products){
   const card=document.createElement('article');card.className='panel';
   const form=document.createElement('form');form.className='product-editor';form.hidden=true;
   form.innerHTML=`<h3>${esc(p.title)}</h3><div class="fields"><label>Title<input name="title" value="${esc(p.title)}" required maxlength="100"></label><label>Price (BND)<input name="price" type="number" step="0.01" min="0" value="${p.price===null?'':Number(p.price).toFixed(2)}" ${p.id.startsWith('up-')?'required':''}></label><label>Category<select name="category"><option>Clickers</option><option>Keychains</option><option>Gifts</option></select></label><label>Replace photo (optional)<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label></div><label>Description<textarea name="description" maxlength="350" rows="2">${esc(p.description||'')}</textarea></label>${p.product_type==='bundle'?'<p class="muted">Bundle uses its component printing estimates. To change components, recreate this bundle.</p>':printingInputs(p)}<label class="toggle-row"><input name="visible" type="checkbox" ${p.visible===false?'':'checked'}> Visible in storefront</label><div class="toolbar"><button class="primary" type="submit">Save product</button><button type="button" class="remove-product">Delete</button></div>`;
   form.querySelector('[name=category]').value=p.category;
   if(p.product_type!=='bundle')makeRecipeEditor(form,Array.isArray(p.materials)?p.materials:[]);
   form.onsubmit=async e=>{e.preventDefault();const btn=form.querySelector('[type=submit]');btn.disabled=true;try{const body=new FormData(form);body.set('id',p.id);body.set('visible',String(form.querySelector('[name=visible]').checked));if(p.product_type!=='bundle')body.set('materials_json',JSON.stringify(collectRecipe(form)));await api('products',{method:'PATCH',body});await loadProducts();message('Product saved successfully.');productFeedback('Product saved successfully.');productTop()}catch(e){message(e.message);productFeedback('Could not save product: '+e.message,true)}finally{btn.disabled=false}};
   form.querySelector('.remove-product').onclick=async()=>{if(!confirm('Delete '+p.title+'? Existing orders remain in history.'))return;try{await api('products?id='+encodeURIComponent(p.id),{method:'DELETE'});message('Product removed.');await loadProducts()}catch(e){message(e.message)}};
   const image=document.createElement('img');image.src=p.image;image.alt=p.title;image.loading='lazy';image.style.cssText='max-width:140px;max-height:140px;object-fit:cover;border-radius:12px;margin-bottom:12px';
   const summary=document.createElement('div');summary.className='product-summary';summary.textContent=p.title+' · '+(p.price===null?'Quote needed':bnd(Math.round(p.price*100)))+(p.visible===false?' · Hidden':'')+' · '+printingSummary(p);if(!p.id.startsWith('up-'))form.querySelector('.remove-product').hidden=true;const toggle=document.createElement('button');toggle.type='button';toggle.className='product-edit-toggle';toggle.textContent='Edit product';toggle.onclick=()=>{form.hidden=!form.hidden;toggle.textContent=form.hidden?'Edit product':'Close editor'};card.append(image,summary,toggle,form);holder.append(card)
  }
 }catch(e){message(e.message)}
}
function inventoryFeedback(text,error=false){const el=$('inventoryFeedback');el.hidden=!text;el.textContent=text;el.classList.toggle('finance-error',error)}
const grams=mg=>(Number(mg||0)/1000).toFixed(2)+' g';
const timeDisplay=m=>{m=Number(m)||0;return Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m'};
async function loadInventory(){
 try{
  const [d,stock]=await Promise.all([api('production'),api('inventory')]);
  const cfg=d.settings||{},form=$('printerForm');
  form.elements.printer_name.value=cfg.printer_name||'Creality SPARKX i7';
  form.elements.average_watts.value=cfg.average_watts??0;
  form.elements.tariff_bnd_per_kwh.value=((Number(cfg.tariff_cents_per_kwh??12))/100).toFixed(2);
  form.elements.add_electricity.checked=cfg.add_electricity===1;
  const rolls=$('rollList');rolls.replaceChildren();
  if(!d.rolls.length)rolls.textContent='No filament rolls yet.';
  for(const roll of d.rolls){
   const card=document.createElement('article');card.className='inventory-item';
   const content=document.createElement('div');content.className='inventory-item-content';
   const title=document.createElement('strong');title.textContent=roll.label+(roll.remaining_mg===0?' · OUT OF STOCK':roll.remaining_mg<=100000?' · LOW STOCK':'');
   const info=document.createElement('small');info.textContent=roll.material+' · '+roll.color+' · '+grams(roll.remaining_mg)+' / '+grams(roll.initial_mg)+' remaining'+(roll.purchase_cost_cents==null?'':' · Purchased '+bnd(roll.purchase_cost_cents));
   content.append(title,info);card.append(content);
   const btn=document.createElement('button');btn.type='button';btn.textContent='Adjust grams';
   btn.onclick=async()=>{
    const value=prompt('Adjust '+roll.label+' stock in grams. Enter +50 to add, or -15 to record usage. Current: '+grams(roll.remaining_mg),'');
    if(value===null)return;
    const amount=value.trim();if(!/^[-+]?\d{1,6}(?:\.\d{1,3})?$/.test(amount)||Number(amount)===0){inventoryFeedback('Enter a non-zero adjustment in grams, e.g. -15 or +20.',true);return;}
    try{await api('production',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'adjust_roll',id:roll.id,delta_grams:amount})});await loadInventory();inventoryFeedback('Filament balance updated manually.');}
    catch(e){inventoryFeedback(e.message,true)}
   };card.append(btn);
   const buy=document.createElement('button');buy.type='button';buy.textContent='Restock + Finance';
   buy.onclick=async()=>{
    const qty=prompt('How many grams of '+roll.label+' did you BUY?','1000');if(qty===null)return;
    if(!/^\d{1,6}(?:\.\d{1,3})?$/.test(qty.trim())||Number(qty)<=0){inventoryFeedback('Enter positive grams.',true);return}
    const amount=prompt('Total purchase amount BND:','');if(amount===null)return;
    if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount.trim())||Number(amount)<=0){inventoryFeedback('Enter valid purchase amount.',true);return}
    buy.disabled=true;try{await api('inventory',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'purchase',stock_kind:'filament',id:roll.id,quantity:qty,amount,occurred_on:bruneiDate(),description:'Filament purchase: '+roll.label,request_key:crypto.randomUUID()})});await loadInventory();inventoryFeedback('Filament received and Finance purchase recorded.')}catch(e){inventoryFeedback(e.message,true)}finally{buy.disabled=false}
   };card.append(buy);rolls.append(card);
  }
  const items=$('stockList');items.replaceChildren();
  if(!stock.items.length)items.textContent='No other inventory items yet. Add boxes, accessories or supplies above.';
  for(const item of stock.items){
   const card=document.createElement('article');card.className='inventory-item';
   const content=document.createElement('div');content.className='inventory-item-content';
   const title=document.createElement('strong');title.textContent=item.name+' · '+item.quantity+' '+item.unit+(item.quantity===0?' · OUT OF STOCK':item.quantity<=5?' · LOW STOCK':'');
   const line=document.createElement('small');line.textContent=item.category+(item.unit_cost_cents==null?'':' · '+bnd(item.unit_cost_cents)+' / '+item.unit)+(item.notes?' · '+item.notes:'');
   content.append(title,line);card.append(content);
   const controls=document.createElement('div');controls.className='stock-controls';
   for(const [label,sign] of [['Stock correction (+)',1],['Stock correction (−)',-1]]){
    const btn=document.createElement('button');btn.type='button';btn.textContent=label;if(sign<0)btn.classList.add('stock-use');
    btn.onclick=async()=>{
     const value=prompt(label+' for '+item.name+'. Enter quantity in '+item.unit+':','1');
     if(value===null)return;
     const count=Number(value.trim());
     if(!/^\d{1,8}$/.test(value.trim())||!Number.isSafeInteger(count)||count<1||count>10000000){inventoryFeedback('Enter a whole quantity between 1 and 10,000,000.',true);return;}
     try{await api('inventory',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'adjust',id:item.id,delta:sign*count})});await loadInventory();inventoryFeedback(label+' recorded for '+item.name+'.');}
     catch(e){inventoryFeedback('Could not update '+item.name+': '+e.message,true)}
    };controls.append(btn);
   }
   const buy=document.createElement('button');buy.type='button';buy.textContent='Restock + Finance';
   buy.onclick=async()=>{
    const qty=prompt('How many '+item.unit+' of '+item.name+' did you BUY?','1');if(qty===null)return;
    if(!/^\d{1,7}$/.test(qty.trim())||Number(qty)<=0){inventoryFeedback('Enter a positive whole quantity.',true);return}
    const amount=prompt('Total purchase amount paid (BND), e.g. 5.00:','');if(amount===null)return;
    if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount.trim())||Number(amount)<=0){inventoryFeedback('Enter a positive purchase total in BND.',true);return}
    buy.disabled=true;try{
     await api('inventory',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'purchase',stock_kind:'item',id:item.id,quantity:qty,amount,occurred_on:bruneiDate(),description:'Restock: '+item.name,request_key:crypto.randomUUID()})});
     await loadInventory();inventoryFeedback('Stock received and linked Finance purchase recorded for '+item.name+'.');
    }catch(e){inventoryFeedback(e.message,true)}finally{buy.disabled=false}
   };controls.append(buy);card.append(controls);items.append(card);
  }
  const history=$('runList');history.replaceChildren();
  if(!d.runs.length)history.textContent='No print jobs recorded yet.';
  for(const run of d.runs){
   const card=document.createElement('article');card.className='inventory-item';
   const content=document.createElement('div');content.className='inventory-item-content';
   const title=document.createElement('strong');title.textContent=run.order_id+' · '+run.customer_name;
   const info=document.createElement('small');
   const state=run.inventory_state==='deducted'?'Previously deducted automatically':run.inventory_state==='pending'?'Manual stock tracking':run.inventory_state;
   info.textContent=run.occurred_on+' · '+grams(run.weight_mg)+' · '+timeDisplay(run.print_minutes)+' · '+bnd(run.print_cost_cents)+' print cost'+(run.electricity_cents?' + '+bnd(run.electricity_cents)+' electricity':'')+' · '+state;
   content.append(title,info);card.append(content);history.append(card);
  }
 }catch(e){inventoryFeedback('Could not load inventory: '+e.message,true)}
}

$('printerForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,btn=f.querySelector('[type=submit]');btn.disabled=true;
 try{const v=Object.fromEntries(new FormData(f));await api('production',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...v,action:'settings',add_electricity:f.elements.add_electricity.checked})});await loadInventory();inventoryFeedback('Printer settings saved. Electricity rate applies to future print jobs only.')}catch(err){inventoryFeedback(err.message,true)}finally{btn.disabled=false}
};
function rollFormFeedback(text='',isError=false){
 const out=$('rollFeedback');out.hidden=!text;out.textContent=text;out.classList.toggle('is-error',isError);
}
function rollFormError(input,text){
 rollFormFeedback(text,true);
 if(input){input.classList.add('roll-input-invalid');input.focus();}
}
$('rollForm').addEventListener('input',e=>{
 if(e.target instanceof HTMLInputElement)e.target.classList.remove('roll-input-invalid');
 const out=$('rollFeedback');if(out.classList.contains('is-error'))rollFormFeedback('');
});
$('rollForm').onsubmit=async e=>{
 e.preventDefault();
 const f=e.currentTarget,btn=f.querySelector('button[type="submit"]');
 if(btn.disabled)return;
 // HTML native validation previously stopped submit silently on some browsers.
 for(const [name,label] of [['label','Roll name'],['material','Material'],['color','Colour']]){
  const el=f.elements.namedItem(name);
  if(!el||!el.value.trim()){rollFormError(el,'Please enter '+label+' before adding a roll.');return;}
 }
 const weight=f.elements.namedItem('grams'),w=weight.value.trim();
 if(!/^\d{1,7}(?:\.\d{1,3})?$/.test(w)||Number(w)<=0||Number(w)>100000){
  rollFormError(weight,'Starting weight must be greater than 0 and no more than 100,000 g (up to 3 decimal places).');return;
 }
 const price=f.elements.namedItem('purchase_cost'),c=price.value.trim();
 if(c&&(!/^\d{1,7}(?:\.\d{1,2})?$/.test(c)||Number(c)>100000)){
  rollFormError(price,'Purchase cost must be a valid BND amount with up to 2 decimals, or leave it blank.');return;
 }
 const label=f.elements.namedItem('label').value.trim();
 const payload={...Object.fromEntries(new FormData(f)),action:'add_roll'};
 btn.disabled=true;btn.textContent='Saving roll…';rollFormFeedback('Saving filament roll…');
 let saved=false;
 try{
  await api('production',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  saved=true;
  f.reset();f.elements.namedItem('material').value='PLA';f.elements.namedItem('grams').value='1000';
  rollFormFeedback('Filament roll "'+label+'" saved successfully. Stock can be adjusted manually under Filament stock.');
  await loadInventory();
  inventoryFeedback('Filament roll added. No automatic stock deduction will occur.');
 }catch(err){
  const explanation=saved?'Roll was saved, but the stock list may not have refreshed. Refresh the page—do not add it again.':'Could not add roll: '+err.message;
  rollFormFeedback(explanation,true);inventoryFeedback(explanation,true);
 }finally{btn.disabled=false;btn.textContent='Add roll';}
};

$('stockForm').elements.record_purchase.onchange=e=>{const enabled=e.target.checked;const line=document.querySelector('.stock-purchase-total');line.hidden=!enabled;line.querySelector('input').required=enabled};
$('stockForm').onsubmit=async e=>{
 e.preventDefault();const f=e.currentTarget,button=f.querySelector('[type=submit]'),feedback=$('stockFeedback');
 const data=Object.fromEntries(new FormData(f));data.record_purchase=f.elements.record_purchase.checked;
 const show=(msg,error=false)=>{feedback.hidden=!msg;feedback.textContent=msg;feedback.classList.toggle('is-error',error)};
 if(!data.name?.trim())return show('Enter an inventory item name.',true);
 if(!/^\d{1,8}$/.test(String(data.quantity))||Number(data.quantity)>10000000)return show('Quantity must be a whole number, 0 to 10,000,000.',true);
 if(data.unit_cost?.trim()&&!/^\d{1,6}(?:\.\d{1,2})?$/.test(data.unit_cost))return show('Unit cost must be BND with at most two decimal places.',true);
 button.disabled=true;button.textContent='Saving item…';show('Saving item…');
 let saved=false;
 try{
  await api('inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});saved=true;
  f.reset();f.elements.quantity.value='0';document.querySelector('.stock-purchase-total').hidden=true;document.querySelector('.stock-purchase-total input').required=false;await loadInventory();show(data.record_purchase?'Item and linked Finance purchase saved.':'Opening stock item saved (not counted as a new purchase).');
 }catch(err){show(saved?'Item saved, but refresh failed. Refresh the page before trying again.':err.message,true)}
 finally{button.disabled=false;button.textContent='Add inventory item'}
};

let financeReport=null;
const bruneiDate=()=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Brunei'}).format(new Date());
function financeFeedback(text,error=false){const box=$('financeFeedback');box.textContent=text;box.hidden=!text;box.classList.toggle('finance-error',error)}
function financeTop(){$('finance').scrollIntoView({behavior:'smooth',block:'start'})}
function money(c){return (Number(c)||0)/100}
function financeCsvCell(x){let s=String(x??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
function financeExport(){const d=financeReport;if(!d){financeFeedback('Load a month before exporting.',true);return}
 const data=[['PrintNest monthly finance summary',d.month],['Metric','BND'],['Verified sales',money(d.sales_cents).toFixed(2)],['Direct job costs',money(d.direct_cost_cents).toFixed(2)],['Operating expenses',money(d.operating_cents).toFixed(2)],['Estimated result',money(d.estimated_result_cents).toFixed(2)],['Inventory purchases (not included in result)',money(d.inventory_purchase_cents).toFixed(2)],[],['Job costs'],['Date','Order ID','Customer','Category','Description','BND'],...d.job_costs.map(x=>[x.occurred_on,x.order_id,x.customer_name,x.category,x.description,money(x.amount_cents).toFixed(2)]),[],['Expenses / purchases'],['Date','Type','Category','Description','BND'],...d.expenses.map(x=>[x.occurred_on,x.expense_kind,x.category,x.description,money(x.amount_cents).toFixed(2)]),[],['Notes',d.note]];
 const csv='\ufeff'+data.map(row=>row.map(financeCsvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='PrintNest-Finance-'+d.month+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function financeActionButton(label,handler){const btn=document.createElement('button');btn.type='button';btn.className='finance-action';btn.textContent=label;btn.onclick=handler;return btn}
function entryRow(parts){const row=document.createElement('div');row.className='finance-row';for(const part of parts){const cell=document.createElement('span');cell.textContent=part??'';row.append(cell)}return row}
async function loadFinance(){
 const month=$('financeMonth').value;
 if(!/^\d{4}-\d{2}$/.test(month))return financeFeedback('Select a reporting month.',true);
 try{
  const d=await api('finance?month='+encodeURIComponent(month));financeReport=d;
  $('finRevenue').textContent=bnd(d.sales_cents);$('finCosts').textContent=bnd(d.direct_cost_cents);$('finExpenses').textContent=bnd(d.operating_cents);$('finNet').textContent=bnd(d.estimated_result_cents);$('finPurchases').textContent=bnd(d.inventory_purchase_cents);$('finCount').textContent=d.verified_count;
  $('finNet').style.color=d.estimated_result_cents<0?'#b34252':'#254d44';
  const selector=$('costOrderSelect'),previous=selector.value;selector.replaceChildren();
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Select an order';selector.append(placeholder);
  for(const order of d.orders){const option=document.createElement('option');option.value=order.id;option.textContent=order.id+' — '+order.customer_name;selector.append(option)}
  if([...selector.options].some(o=>o.value===previous))selector.value=previous;
  const summary=$('financeOrders');summary.replaceChildren();
  summary.append(entryRow(['Order','Customer','Sales','Direct cost','Job margin']));
  for(const o of d.orders){const priced=o.total_cents!==null,verified=o.payment_status==='verified';summary.append(entryRow([o.id,o.customer_name,priced?bnd(o.total_cents):'Quote required',bnd(o.direct_cost_cents),verified&&priced?bnd(o.total_cents-o.direct_cost_cents):'Pending / unpriced']))}
  if(!d.orders.length)summary.append(entryRow(['No orders yet']));
  const costs=$('jobCostList');costs.replaceChildren();
  for(const c of d.job_costs){const el=entryRow([c.occurred_on,c.order_id,c.category,c.description,bnd(c.amount_cents)]);if(c.source!=='production')el.append(financeActionButton('Void',async()=>{if(!confirm('Void this cost entry? The audit log will keep the change.'))return;try{await api('finance?kind=job_cost&id='+encodeURIComponent(c.id),{method:'DELETE'});financeFeedback('Job cost voided.');await loadFinance()}catch(e){financeFeedback(e.message,true)}}));costs.append(el)}
  if(!d.job_costs.length)costs.textContent='No job costs recorded for this month.';
  const expenses=$('expenseList');expenses.replaceChildren();
  for(const e of d.expenses){const el=entryRow([e.occurred_on,e.category,e.description,bnd(e.amount_cents)]);
   const kind=document.createElement('select');kind.setAttribute('aria-label','Entry type');
   [['operating','Operating'],['inventory','Inventory purchase']].forEach(([value,label])=>{const op=document.createElement('option');op.value=value;op.textContent=label;kind.append(op)});kind.value=e.expense_kind;kind.disabled=!!e.linked_purchase;if(e.linked_purchase){kind.title='Linked to inventory stock; void with stock reversal to correct it';}kind.onchange=async()=>{const previous=e.expense_kind;try{await api('finance',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reclassify_expense',id:e.id,expense_kind:kind.value})});financeFeedback('Entry classification saved.');await loadFinance()}catch(err){kind.value=previous;financeFeedback(err.message,true)}};el.append(kind);if(e.linked_purchase)el.append(document.createTextNode(' · Stock linked'));
   el.append(financeActionButton('Void',async()=>{if(!confirm('Void this expense/purchase? The audit log will retain a record.'))return;try{await api('finance?kind=expense&id='+encodeURIComponent(e.id),{method:'DELETE'});financeFeedback('Entry voided.');await loadFinance()}catch(err){financeFeedback(err.message,true)}}));expenses.append(el)}
  if(!d.expenses.length)expenses.textContent='No expenses or purchases recorded for this month.';
 }catch(e){financeFeedback('Could not load finance: '+e.message,true)}
}
document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>section(b.dataset.section));$('menu').onclick=()=>document.querySelector('.sidebar').classList.toggle('open');$('logout').onclick=()=>{clearSession();$('portal').hidden=true;$('signin').hidden=false;google?.accounts?.id?.disableAutoSelect?.();message('Signed out.');};$('search').oninput=renderOrders;$('paymentFilter').onchange=renderOrders;$('stageFilter').onchange=renderOrders;$('refreshOrders').onclick=loadOrders;
$('productForm').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{const body=new FormData(e.target);body.set('materials_json',JSON.stringify(collectRecipe(e.target)));await api('products',{method:'POST',body});e.target.reset();await loadProducts();message('Product published successfully.');productFeedback('Product published successfully. The form is clear for your next product.');productTop()}catch(x){message(x.message)}finally{btn.disabled=false}};
makeRecipeEditor($('productForm'),[]);
async function refreshFinanceStock(){
 const kind=$('financeStockKind').value,select=$('financeStockId'),last=select.value;select.replaceChildren();const intro=document.createElement('option');intro.value='';intro.textContent='Select stock';select.append(intro);
 const [stock,printer]=await Promise.all([api('inventory'),api('production')]);
 for(const i of kind==='filament'?printer.rolls:stock.items){const option=document.createElement('option');option.value=i.id;option.textContent=kind==='filament'?i.label+' · '+(Number(i.remaining_mg)/1000).toFixed(1)+' g':i.name+' · '+i.quantity+' '+i.unit;select.append(option)}
 if([...select.options].some(x=>x.value===last))select.value=last;
 const qty=$('financeStockQty');qty.step=kind==='filament'?'0.001':'1';qty.min=kind==='filament'?'0.001':'1';qty.placeholder=kind==='filament'?'Grams purchased':'Quantity purchased';
}
function toggleFinancePurchase(){const stock=$('financeEntryKind').value==='inventory';$('financePurchaseFields').hidden=!stock;
 for(const name of ['stock_id','stock_quantity'])$('expenseForm').elements[name].required=stock;
 if(stock)refreshFinanceStock().catch(e=>financeFeedback('Could not load inventory options: '+e.message,true));}
$('financeEntryKind').onchange=toggleFinancePurchase;
$('financeStockKind').onchange=()=>refreshFinanceStock().catch(e=>financeFeedback(e.message,true));
$('financeMonth').value=bruneiDate().slice(0,7);
$('financeMonth').onchange=()=>{financeFeedback('');loadFinance()};
$('financeExport').onclick=financeExport;
$('jobCostForm').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;try{const data=Object.fromEntries(new FormData(e.target));await api('finance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'job_cost',...data})});const order=data.order_id;e.target.reset();e.target.querySelector('[name=occurred_on]').value=bruneiDate();financeFeedback('Job cost recorded successfully.');await loadFinance();$('costOrderSelect').value=order;financeTop()}catch(err){financeFeedback(err.message,true)}finally{btn.disabled=false}};
$('expenseForm').onsubmit=async e=>{e.preventDefault();const f=e.target,btn=f.querySelector('button[type=submit]');btn.disabled=true;const data=Object.fromEntries(new FormData(f));
 const key=f.dataset.requestKey||crypto.randomUUID();f.dataset.requestKey=key;
 try{await api('finance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'expense',...data,request_key:key})});
  delete f.dataset.requestKey;f.reset();f.querySelector('[name=occurred_on]').value=bruneiDate();toggleFinancePurchase();financeFeedback('Entry saved. Linked purchases have updated Inventory as well.');await loadFinance();financeTop()}
 catch(err){financeFeedback(err.message,true)}finally{btn.disabled=false}
};
$('expenseForm').querySelector('[name=occurred_on]').value=bruneiDate();
$('jobCostForm').querySelector('[name=occurred_on]').value=bruneiDate();
start();
