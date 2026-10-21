import {mergeCatalog,snapshot} from './_printing.js';
import {getCatalog} from './_shared.js';

// Customer preferences are requests; they never control catalog prices, stock or manufacturing costs.
function customerCustomization(raw){
 if(raw===undefined||raw===null)return null;
 if(typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid product personalisation');
 const read=(key,max)=>{const v=raw[key]??'';if(typeof v!=='string'||v.length>max)throw Error('Personalisation field too long or invalid: '+key);return v.trim()};
 const wording=read('wording',80),color=read('color',50),instructions=read('instructions',300),packaging=read('packaging',24)||'None';
 if(!['None','Plastic','Gift box','Other'].includes(packaging))throw Error('Invalid packaging preference');
 return {wording,color,packaging,instructions};
}

export async function loadTrustedProducts(env){return mergeCatalog(await getCatalog(env))}
export function makeOrderItems(catalog,selected){
 if(!Array.isArray(selected)||!selected.length||selected.length>40)throw Error('Select 1–40 order lines');
 const products=new Map(catalog.map(p=>[p.id,p]));const lines=[];let total=0,unpriced=false;
 for(const request of selected){
  const id=String(request.id||''),quantity=Number(request.qty??request.quantity),p=products.get(id);
  if(!p||p.visible===false||p.archived===true||!Number.isInteger(quantity)||quantity<1||quantity>100)throw Error('Invalid product or order quantity');
  let detail,materials,print,price;
  if(p.product_type==='bundle'){
   if(!Array.isArray(p.components)||!p.components.length)throw Error('Bundle components are missing');
   let grams=0,minutes=0,cents=0;materials=[];
   for(const comp of p.components){const component=products.get(comp.id),units=Number(comp.quantity);if(!component||component.product_type==='bundle'||!Number.isInteger(units)||units<1)throw Error('Bundle component is unavailable');
    const snap=snapshot(component);if(snap.print_weight_g==null)throw Error('Bundle component lacks Creality estimates');
    grams+=snap.print_weight_g*units;minutes+=snap.print_minutes*units;cents+=snap.print_cost_cents*units;
    // Material colour is chosen for this individual customer order in Admin.

   }
   // Bundle materials are chosen on the individual order, not the catalog bundle.
   print={print_weight_g:grams,print_minutes:minutes,print_cost_cents:cents};
   detail='bundle';
  }else{materials=[];print=snapshot(p);detail='single'}
  const minimumPrice=p.price===null?null:Math.round(Number(p.price)*100);
  if(minimumPrice!==null&&(!Number.isSafeInteger(minimumPrice)||minimumPrice<0))throw Error('Invalid product price');
  const startingFrom=p.starting_from===true&&minimumPrice!==null;
  const autoLetters=p.pricing_mode==='per_letter';
  const customization=customerCustomization(request.customization);
  let letters=null,letterRate=null;
  if(autoLetters){
   if(minimumPrice===null||p.product_type==='bundle')throw Error('Automatic letter pricing configuration is invalid');
   letterRate=Number(p.per_letter_price_cents);
   if(!Number.isSafeInteger(letterRate)||letterRate<1||letterRate>100000)throw Error('Invalid catalog letter price');
   const wording=String(customization?.wording||'').normalize('NFC');
   if(!wording||!/^[\p{L}\p{N} ]+$/u.test(wording))throw Error('Enter a name using letters, numbers or spaces for this item');
   letters=Array.from(wording.replace(/ /g,'')).length;
   if(letters<1||letters>80)throw Error('Enter 1–80 letters or numbers for this item');
   price=minimumPrice+(letters*letterRate);
  }else{price=startingFrom?null:minimumPrice}
  if(price!==null&&(!Number.isSafeInteger(price)||price<0||price>100000000))throw Error('Calculated price is too high');
  if(price===null)unpriced=true;else total+=price*quantity;
  lines.push({id,title:p.title,quantity,price_cents:price,starting_from:startingFrom&&!autoLetters,minimum_price_cents:startingFrom?minimumPrice:null,pricing_mode:autoLetters?'per_letter':'standard',base_price_cents:autoLetters?minimumPrice:null,letter_count:letters,letter_price_cents:letterRate,...print,materials,product_type:detail,recipe_version:2,customization});
 }
 if(total>100000000)throw Error('Order exceeds price limit');
 return {items:lines,total_cents:unpriced?null:total};
}
