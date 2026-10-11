// PrintNest V8 Production Board. Uses authenticated server endpoints; no direct D1 writes.
(() => {
  const $=id=>document.getElementById(id);
  const labels={new:'New',confirmed:'Confirmed',awaiting_materials:'Awaiting materials',ready_to_print:'Ready to print',printing:'Printing',quality_check:'Quality check',packaging:'Packaging',ready:'Ready (legacy)',ready_for_collection:'Ready for collection',ready_for_delivery:'Ready for delivery',collected:'Collected',delivered:'Delivered',completed:'Completed',cancelled:'Cancelled'};
  const lanes=[['queued','New & confirmed'],['materials','Awaiting materials'],['ready','Ready to print'],['active','Printing & finishing'],['handover','Collection / delivery'],['completed','Completed'],['cancelled','Cancelled']];
  const dateFmt=s=>s?String(s).replace('T',' ').slice(0,16):'Not scheduled';
  const money=n=>'BND '+((Number(n)||0)/100).toFixed(2);
  const els={};
  let jobs=[],isLoading=false,lastQuery='';
  const openIds=new Set();
  const element=(tag,className='',text='')=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el};
  function notify(message,error=false){const el=$('productionBoardNotice');el.hidden=false;el.classList.toggle('error',error);el.textContent=message;}
  async function api(path,options={}){
    const token=sessionStorage.getItem('printnest_google_credential');
    if(!token)throw Error('Google login expired. Please sign in again.');
    const response=await fetch('/api/portal/'+path,{...options,headers:{Authorization:'Bearer '+token,...options.headers},cache:'no-store'});
    let body;try{body=await response.json()}catch{throw Error('Unexpected server response ('+response.status+')')}
    if(!response.ok)throw Error(body.error||'Request failed ('+response.status+')');return body;
  }
  const appendKV=(parent,label,value)=>{const block=element('div','production-kv');block.append(element('small','',label),element('strong','',value));parent.append(block)};
  function createControl(name,type,value,options){
    const label=element('label');label.textContent=name;
    let input;
    if(options){input=element('select');for(const [v,t] of options){const op=element('option','',t);op.value=v;input.append(op)}input.value=value||options[0][0]}
    else if(type==='textarea'){input=element('textarea');input.rows=3;input.maxLength=800;input.value=value||''}
    else {input=element('input');input.type=type||'text';input.value=value||''}
    label.append(input);return {label,input};
  }
  function showDetails(job,container){
    container.replaceChildren();
    const heading=element('h4','','Production job details');container.append(heading);
    const form=element('form','production-edit-form');
    const fields=element('div','production-edit-fields');
    const handover=createControl('Customer handover','select',job.handover_method,[['collection','Collection'],['delivery','Delivery']]);
    const priority=createControl('Priority','select',job.priority,[['normal','Normal'],['urgent','Urgent']]);
    const printer=createControl('Assigned printer','text',job.printer_name);printer.input.maxLength=100;printer.input.placeholder='e.g. Creality SPARKX i7';
    const due=createControl('Target date','date',job.due_on);
    const notes=createControl('Production / delivery notes','textarea',job.production_notes);
    fields.append(handover.label,priority.label,printer.label,due.label,notes.label);form.append(fields);
    const feedback=element('div','production-inline-feedback');feedback.setAttribute('role','status');feedback.hidden=true;
    const controls=element('div','production-card-actions');const save=element('button','primary','Save details');save.type='submit';const close=element('button','','Close');close.type='button';close.onclick=()=>{openIds.delete(job.id);render()};controls.append(save,close);form.append(controls,feedback);
    form.onsubmit=async e=>{e.preventDefault();save.disabled=true;save.textContent='Saving…';feedback.hidden=true;
      try{await api('production-board',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:job.id,action:'details',handover_method:handover.input.value,priority:priority.input.value,printer_name:printer.input.value,due_on:due.input.value,notes:notes.input.value})});notify('Production details saved for '+job.id);await load();}
      catch(err){feedback.hidden=false;feedback.textContent=err.message;feedback.classList.add('error')}
      finally{save.disabled=false;save.textContent='Save details'}
    };
    container.append(form);
  }
  function card(job){
    const wrap=element('article','production-card');
    if(job.priority==='urgent')wrap.classList.add('is-urgent');
    const head=element('div','production-card-header');const id=element('strong','',job.id),status=element('span','production-stage',labels[job.status]||job.status);head.append(id,status);wrap.append(head);
    wrap.append(element('div','production-customer',job.customer_name+' · '+job.customer_phone));
    const items=element('div','production-products',job.items.map(i=>i.title+' × '+i.quantity).join(' · ')||'Order has no items');wrap.append(items);
    if(job.materials?.length)wrap.append(element('p','production-mini','Materials: '+job.materials.join(' · ')));
    const stats=element('div','production-card-meta');
    appendKV(stats,'Payment',String(job.payment_status||'').replaceAll('_',' '));
    appendKV(stats,'Priority',job.priority==='urgent'?'Urgent':'Normal');
    appendKV(stats,'Target date',dateFmt(job.due_on));
    appendKV(stats,'Handover',job.handover_method==='delivery'?'Delivery':'Collection');
    wrap.append(stats);
    if(job.printer_name)wrap.append(element('p','production-mini','Printer: '+job.printer_name));
    if(job.production_notes)wrap.append(element('p','production-notes',job.production_notes));
    const cost=element('div','production-cost');
    cost.append(element('span','','Direct costs: '+(job.print_cost_cents===null?'Not yet recorded':money(job.direct_cost_cents))));
    if(job.payment_status==='verified'&&job.total_cents!=null&&job.print_cost_cents!==null)cost.append(element('strong','','Est. job margin '+money(job.total_cents-job.direct_cost_cents)));
    wrap.append(cost);
    const controls=element('div','production-card-actions');
    const details=element('button','','Edit details');details.type='button';details.onclick=()=>{if(openIds.has(job.id))openIds.delete(job.id);else openIds.add(job.id);render()};controls.append(details);
    if(job.next_stage){const next=element('button','primary','→ '+(labels[job.next_stage]||job.next_stage));next.type='button';
      next.onclick=async()=>{
        if(['collected','delivered'].includes(job.next_stage)&&!confirm('Confirm '+job.customer_name+' has actually '+(job.next_stage==='collected'?'collected this order':'received the delivery')+'?'))return;
        if(job.next_stage==='completed'&&!confirm('Mark this order fully completed after customer handover?'))return;
        next.disabled=true;next.textContent='Updating…';
        try{const r=await api('production-board',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:job.id,action:'next',confirm_handover:['collected','delivered'].includes(job.next_stage)})});notify(r.message+(r.registered?' · Inventory deducted once, production cost recorded.':''));await load();}
        catch(err){notify(job.id+': '+err.message,true);await load()}
        finally{next.disabled=false;next.textContent='→ '+(labels[job.next_stage]||job.next_stage)}
      };controls.append(next)}
    wrap.append(controls);
    const more=element('div','production-card-actions');
    const check=element('button','','Check stock');check.type='button';
    const stockInfo=element('div','production-inline-feedback');stockInfo.hidden=true;stockInfo.setAttribute('role','status');
    check.onclick=async()=>{check.disabled=true;stockInfo.hidden=false;stockInfo.textContent='Checking stock…';stockInfo.classList.remove('error');
      try{const r=await api('material-check?id='+encodeURIComponent(job.id));stockInfo.textContent=r.started?'Printing already recorded; stock was deducted previously.':r.available?'Materials ready for printing.':(r.missing_products?.length?'Missing setup: '+r.missing_products.join('; '):'Short stock: '+(r.shortages||[]).map(s=>s.label+' (need '+s.required+' '+s.unit+', have '+s.available+')').join('; '));stockInfo.classList.toggle('error',!r.available)}
      catch(err){stockInfo.textContent=err.message;stockInfo.classList.add('error')}finally{check.disabled=false}
    };more.append(check);
    const go=element('button','','View in Orders');go.type='button';go.onclick=()=>{const search=$('search');if(search){search.value=job.id;search.dispatchEvent(new Event('input',{bubbles:true}))}if(typeof section==='function')section('orders')};more.append(go);wrap.append(more,stockInfo);
    if(openIds.has(job.id)){const editor=element('div','production-card-editor');showDetails(job,editor);wrap.append(editor)}
    return wrap;
  }
  function render(){
    const grid=$('productionBoardGrid');if(!grid)return;grid.replaceChildren();
    const q=String($('productionSearch')?.value||'').trim().toLowerCase();
    const mode=$('productionVisibility')?.value||'active';
    const filtered=jobs.filter(j=>(mode==='all'||!['completed','cancelled'].includes(j.status))&&(!q||[j.id,j.customer_name,j.customer_phone,...j.items.map(i=>i.title)].join(' ').toLowerCase().includes(q)));
    const counts={queued:0,materials:0,ready:0,active:0,handover:0,completed:0,cancelled:0};for(const j of jobs)counts[j.lane]=(counts[j.lane]||0)+1;
    for(const [lane,title] of lanes){
      if(mode!=='all'&&['completed','cancelled'].includes(lane))continue;
      const entries=filtered.filter(j=>j.lane===lane).sort((a,b)=>(a.priority==='urgent'?0:1)-(b.priority==='urgent'?0:1));
      const col=element('section','production-lane');const head=element('div','production-lane-head');head.append(element('h3','',title),element('span','production-count',String(counts[lane]||0)));col.append(head);
      if(!entries.length)col.append(element('p','production-empty',q?'No matching jobs':'No jobs in this stage'));
      else for(const j of entries)col.append(card(j));grid.append(col);
    }
    $('productionTotal').textContent=String(jobs.filter(j=>!['completed','cancelled'].includes(j.status)).length);
    $('productionActive').textContent=String(jobs.filter(j=>['printing','quality_check','packaging'].includes(j.status)).length);
    $('productionWaiting').textContent=String(jobs.filter(j=>j.lane==='materials').length);
    $('productionHandover').textContent=String(jobs.filter(j=>j.lane==='handover').length);
  }
  async function load(){if(isLoading)return;isLoading=true;const btn=$('productionRefresh');if(btn)btn.disabled=true;
    try{const res=await api('production-board');jobs=res.jobs||[];render()}
    catch(err){notify('Could not load Production Board: '+err.message,true)}
    finally{isLoading=false;if(btn)btn.disabled=false}
  }
  $('productionSearch')?.addEventListener('input',render);
  $('productionVisibility')?.addEventListener('change',render);
  $('productionRefresh')?.addEventListener('click',load);
  window.PrintNestProductionBoard={load};
})();
