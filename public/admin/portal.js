const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
let jwt='',me=null,orders=[],products=[];const bnd=c=>'BND '+((Number(c)||0)/100).toFixed(2);
function message(s){$('notice').textContent=s;$('loginMessage').textContent=s}async function api(path,options={}){const r=await fetch('/api/portal/'+path,{...options,headers:{Authorization:'Bearer '+jwt,...options.headers},cache:'no-store'});let data;try{data=await r.json()}catch{throw Error('Invalid response ('+r.status+')')}if(!r.ok)throw Error(data.error||'HTTP '+r.status);return data}
function section(name){document.querySelectorAll('.section').forEach(x=>x.hidden=x.id!==name);document.querySelectorAll('[data-section]').forEach(x=>x.classList.toggle('selected',x.dataset.section===name));$('sectionTitle').textContent=name[0].toUpperCase()+name.slice(1);document.querySelector('.sidebar').classList.remove('open');if(name==='orders')renderOrders();if(name==='products')loadProducts();if(name==='inventory')loadInventory();if(name==='finance')loadFinance()}
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
function renderOrders(){const q=$('search').value.trim().toLowerCase(),f=$('paymentFilter').value,stageFilter=$('stageFilter').value;const list=orders.filter(o=>(!f||o.payment_status===f)&&(!stageFilter||o.fulfillment_status===stageFilter)&&[o.id,o.customer_name,o.customer_phone].some(x=>String(x||'').toLowerCase().includes(q)));$('orderList').replaceChildren();for(const o of list){const el=document.createElement('article');el.className='panel order';el.innerHTML=`<div class="order-head"><h3>${esc(o.id)}</h3><span class="pill">${esc(o.fulfillment_status)}</span></div><p><strong>${esc(o.customer_name)}</strong> · ${esc(o.customer_phone)} · ${o.total_cents===null?'Quote required':bnd(o.total_cents)}</p><p>${(o.items||[]).map(i=>esc(i.title)+' × '+Number(i.quantity)).join(' · ')}</p><p class="muted">${(o.items||[]).map(i=>i.print_weight_g!=null&&i.print_minutes!=null&&i.print_cost_cents!=null?esc(i.title)+' (×'+i.quantity+'): '+(Number(i.print_weight_g)*Number(i.quantity)).toFixed(2)+'g · '+Number(i.print_minutes)*Number(i.quantity)+'min · '+bnd(Number(i.print_cost_cents)*Number(i.quantity)):'').filter(Boolean).join(' | ')||'No stored Creality estimate (older order or product not configured)'}</p><p class="muted">${esc(o.notes||'No notes')}</p><div class="toolbar"><label>Payment<select class="pay">${opt(['unpaid','awaiting_review','verified','rejected'],o.payment_status)}</select></label><label>Production<select class="stage">${opt(['new','confirmed','printing','ready','completed','cancelled'],o.fulfillment_status)}</select></label><button class="save">Save status</button>${o.receipt_key?'<button class="receipt">View proof</button>':''}</div><div class="preview" hidden></div>`;
 el.querySelector('.save').onclick=async()=>{if(el.querySelector('.pay').value==='verified'&&o.payment_status!=='verified'&&!confirm('Have you checked the actual bank transaction? A screenshot alone is NOT proof of payment.'))return;try{const saved=await api('orders',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:o.id,payment_status:el.querySelector('.pay').value,fulfillment_status:el.querySelector('.stage').value})});await loadOrders();message(saved.registered?'Order saved. Creality cost recorded once; inventory: '+saved.inventory_state+'.':saved.missing_print_details?'Order saved. This order has no complete Creality snapshot, so add cost manually if needed.':'Order status saved; no duplicate printing cost was recorded.')}catch(e){message(e.message)}};
 if(o.receipt_key)el.querySelector('.receipt').onclick=async()=>{const out=el.querySelector('.preview');if(!out.hidden){out.hidden=true;return}try{const r=await fetch('/api/portal/receipt?id='+encodeURIComponent(o.id),{headers:{Authorization:'Bearer '+jwt},cache:'no-store'});if(!r.ok){let d=await r.json();throw Error(d.error||r.status)}const blob=await r.blob(),url=URL.createObjectURL(blob);out.replaceChildren();if(blob.type.startsWith('image/')){const img=document.createElement('img');img.src=url;img.alt='Receipt';out.append(img)}else if(blob.type==='application/pdf'){const frame=document.createElement('iframe');frame.src=url;frame.title='Receipt';out.append(frame)}const a=document.createElement('a');a.textContent='Download proof';a.download=o.id+(blob.type==='application/pdf'?'.pdf':'.png');a.href=url;out.append(a);out.hidden=false}catch(e){message('Receipt: '+e.message)}};
 $('orderList').append(el)}if(!list.length)$('orderList').textContent='No matching orders.'}
function printingInputs(p={}){const w=p.print_weight_g??'',t=p.print_minutes??'',c=p.print_cost_cents==null?'':(p.print_cost_cents/100).toFixed(2);return `<fieldset class="creality-fields"><legend>Creality print estimates (internal)</legend><p class="muted">Copy the values from the Creality app. Leave all three blank if unknown.</p><div class="creality-grid"><label>Weight (g)<input name="print_weight_g" type="number" step="0.001" min="0.001" value="${esc(w)}" placeholder="g"></label><label>Time (minutes)<input name="print_minutes" type="number" step="1" min="1" value="${esc(t)}" placeholder="minutes"></label><label>Cost (BND)<input name="print_cost" type="number" step="0.01" min="0" value="${esc(c)}" placeholder="BND"></label></div></fieldset>`}
function printingSummary(p){return p.print_weight_g!=null&&p.print_minutes!=null&&p.print_cost_cents!=null?`${p.print_weight_g} g · ${p.print_minutes} min · ${bnd(p.print_cost_cents)} estimated cost`:'Creality details not set'}
function productFeedback(text,isError=false){const el=$('productFeedback');if(!el)return;el.hidden=!text;el.textContent=text;el.classList.toggle('is-error',isError)}
function productTop(){const heading=$('products');if(heading)heading.scrollIntoView({behavior:'smooth',block:'start'})}
async function loadProducts(){
 try{
  const d=await api('products');products=d.products||[];
  const holder=$('productList');holder.replaceChildren();if(d.warning)message(d.warning);
  if(!products.length){holder.textContent='No products found.';return}
  for(const p of products){
   const card=document.createElement('article');card.className='panel';
   const form=document.createElement('form');form.className='product-editor';form.hidden=true;
   form.innerHTML=`<h3>${esc(p.title)}</h3><div class="fields"><label>Title<input name="title" value="${esc(p.title)}" required maxlength="100"></label><label>Price (BND)<input name="price" type="number" step="0.01" min="0" value="${p.price===null?'':Number(p.price).toFixed(2)}" ${p.id.startsWith('up-')?'required':''}></label><label>Category<select name="category"><option>Clickers</option><option>Keychains</option><option>Gifts</option></select></label><label>Replace photo (optional)<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label></div><label>Description<textarea name="description" maxlength="350" rows="2">${esc(p.description||'')}</textarea></label>${printingInputs(p)}<label class="toggle-row"><input name="visible" type="checkbox" ${p.visible===false?'':'checked'}> Visible in storefront</label><div class="toolbar"><button class="primary" type="submit">Save product</button><button type="button" class="remove-product">Delete</button></div>`;
   form.querySelector('[name=category]').value=p.category;
   form.onsubmit=async e=>{e.preventDefault();const btn=form.querySelector('[type=submit]');btn.disabled=true;try{const body=new FormData(form);body.set('id',p.id);body.set('visible',String(form.querySelector('[name=visible]').checked));await api('products',{method:'PATCH',body});await loadProducts();message('Product saved successfully.');productFeedback('Product saved successfully.');productTop()}catch(e){message(e.message);productFeedback('Could not save product: '+e.message,true)}finally{btn.disabled=false}};
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
  const d=await api('production');
  const cfg=d.settings||{};const form=$('printerForm');
  form.elements.printer_name.value=cfg.printer_name||'Creality SPARKX i7';
  form.elements.average_watts.value=cfg.average_watts??0;
  form.elements.tariff_bnd_per_kwh.value=((Number(cfg.tariff_cents_per_kwh??12))/100).toFixed(2);
  form.elements.add_electricity.checked=cfg.add_electricity===1;
  const list=$('rollList');list.replaceChildren();
  if(!d.rolls.length){const msg=document.createElement('p');msg.className='muted';msg.textContent='No filament rolls yet. Add a roll, then choose Make default to enable automatic stock deduction.';list.append(msg)}
  for(const roll of d.rolls){
   const card=document.createElement('article');card.className='inventory-item';
   const top=document.createElement('div');top.className='inventory-item-content';
   const name=document.createElement('strong');name.textContent=roll.label+(roll.is_default?' · Default':'');
   const line=document.createElement('small');line.textContent=roll.material+' · '+roll.color+' · '+grams(roll.remaining_mg)+' of '+grams(roll.initial_mg)+' remaining'+(roll.purchase_cost_cents==null?'':' · Roll price '+bnd(roll.purchase_cost_cents));
   top.append(name,line);card.append(top);
   if(!roll.is_default){const btn=document.createElement('button');btn.type='button';btn.textContent='Make default';btn.onclick=async()=>{try{await api('production',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'default_roll',id:roll.id})});await loadInventory();inventoryFeedback('Default roll updated.')}catch(e){inventoryFeedback(e.message,true)}};card.append(btn)}
   else{const btn=document.createElement('button');btn.type='button';btn.textContent='Disable automatic roll';btn.onclick=async()=>{try{await api('production',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'default_roll',id:''})});await loadInventory();inventoryFeedback('Automatic roll deduction disabled.')}catch(e){inventoryFeedback(e.message,true)}};card.append(btn)}
   list.append(card)
  }
  const history=$('runList');history.replaceChildren();
  if(!d.runs.length){history.textContent='No print jobs recorded yet.';return}
  for(const run of d.runs){const card=document.createElement('article');card.className='inventory-item';const top=document.createElement('div');top.className='inventory-item-content';const name=document.createElement('strong');name.textContent=run.order_id+' · '+run.customer_name;const detail=document.createElement('small');detail.textContent=run.occurred_on+' · '+grams(run.weight_mg)+' · '+timeDisplay(run.print_minutes)+' · Printing '+bnd(run.print_cost_cents)+(run.electricity_cents?' + electricity '+bnd(run.electricity_cents):'')+' · Inventory: '+run.inventory_state;top.append(name,detail);card.append(top);
   if(run.inventory_state==='pending'){const btn=document.createElement('button');btn.type='button';btn.textContent='Allocate default roll';btn.onclick=async()=>{if(!confirm('Deduct '+grams(run.weight_mg)+' from the current default roll for '+run.order_id+'?'))return;try{await api('production',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'allocate',order_id:run.order_id})});await loadInventory();inventoryFeedback('Stock allocated once for order '+run.order_id+'.')}catch(e){inventoryFeedback(e.message,true)}};card.append(btn)}
   history.append(card)}
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
  rollFormFeedback('Filament roll "'+label+'" saved successfully. Select Make default under Filament stock.');
  await loadInventory();
  inventoryFeedback('Filament roll added. Set it as your default to enable automatic stock deduction.');
 }catch(err){
  const explanation=saved?'Roll was saved, but the stock list may not have refreshed. Refresh the page—do not add it again.':'Could not add roll: '+err.message;
  rollFormFeedback(explanation,true);inventoryFeedback(explanation,true);
 }finally{btn.disabled=false;btn.textContent='Add roll';}
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
   [['operating','Operating'],['inventory','Inventory purchase']].forEach(([value,label])=>{const op=document.createElement('option');op.value=value;op.textContent=label;kind.append(op)});kind.value=e.expense_kind;kind.onchange=async()=>{const previous=e.expense_kind;try{await api('finance',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reclassify_expense',id:e.id,expense_kind:kind.value})});financeFeedback('Entry classification saved.');await loadFinance()}catch(err){kind.value=previous;financeFeedback(err.message,true)}};el.append(kind);
   el.append(financeActionButton('Void',async()=>{if(!confirm('Void this expense/purchase? The audit log will retain a record.'))return;try{await api('finance?kind=expense&id='+encodeURIComponent(e.id),{method:'DELETE'});financeFeedback('Entry voided.');await loadFinance()}catch(err){financeFeedback(err.message,true)}}));expenses.append(el)}
  if(!d.expenses.length)expenses.textContent='No expenses or purchases recorded for this month.';
 }catch(e){financeFeedback('Could not load finance: '+e.message,true)}
}
document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>section(b.dataset.section));$('menu').onclick=()=>document.querySelector('.sidebar').classList.toggle('open');$('logout').onclick=()=>{clearSession();$('portal').hidden=true;$('signin').hidden=false;google?.accounts?.id?.disableAutoSelect?.();message('Signed out.');};$('search').oninput=renderOrders;$('paymentFilter').onchange=renderOrders;$('stageFilter').onchange=renderOrders;$('refreshOrders').onclick=loadOrders;
$('productForm').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{await api('products',{method:'POST',body:new FormData(e.target)});e.target.reset();await loadProducts();message('Product published successfully.');productFeedback('Product published successfully. The form is clear for your next product.');productTop()}catch(x){message(x.message)}finally{btn.disabled=false}};
$('financeMonth').value=bruneiDate().slice(0,7);
$('financeMonth').onchange=()=>{financeFeedback('');loadFinance()};
$('financeExport').onclick=financeExport;
$('jobCostForm').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;try{const data=Object.fromEntries(new FormData(e.target));await api('finance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'job_cost',...data})});const order=data.order_id;e.target.reset();e.target.querySelector('[name=occurred_on]').value=bruneiDate();financeFeedback('Job cost recorded successfully.');await loadFinance();$('costOrderSelect').value=order;financeTop()}catch(err){financeFeedback(err.message,true)}finally{btn.disabled=false}};
$('expenseForm').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;try{const data=Object.fromEntries(new FormData(e.target));await api('finance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'expense',...data})});e.target.reset();e.target.querySelector('[name=occurred_on]').value=bruneiDate();financeFeedback('Expense / purchase saved successfully.');await loadFinance();financeTop()}catch(err){financeFeedback(err.message,true)}finally{btn.disabled=false}};
$('expenseForm').querySelector('[name=occurred_on]').value=bruneiDate();
$('jobCostForm').querySelector('[name=occurred_on]').value=bruneiDate();
start();
