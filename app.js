import {createStore,isDemo} from './api.js';
import {config} from './config.js';
import {escapeHtml as h,safeUrl,filterGifts,validateGift,newToken,priceLabel,illustration,giftCount,belongsToGroup,listUrl,validateGroup} from './domain.js';

const $=selector=>document.querySelector(selector);
const ADMIN_PAGE=document.body.dataset.admin==='true';
const state={gifts:[],recipients:[],groups:[],group:new URL(location.href).searchParams.get('g')||'',person:'',query:'',category:'',sort:'priority',status:'all',admin:false,archived:false,mine:{},owned:{},loaded:false};
const mineKey=`podaruj-reservations:${config.supabaseUrl||'demo'}`;
let store,toastTimer,loadSequence=0,returnFocus;
try{state.mine=JSON.parse(localStorage.getItem(mineKey)||'{}');if(!state.mine||typeof state.mine!=='object'||Array.isArray(state.mine))state.mine={};}catch{state.mine={};}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
function saveMine(){localStorage.setItem(mineKey,JSON.stringify(state.mine));}
function modal(title,body){returnFocus=document.activeElement;$('#modal-content').innerHTML=`<h2 id="modal-title">${h(title)}</h2>${body}<div id="form-error" class="form-error" role="alert" hidden></div>`;if(!$('#modal').open)$('#modal').showModal();$('#modal-content').querySelector('input,textarea,button')?.focus();}
function closeModal(){$('#modal').close();returnFocus?.focus();}
async function action(button,fn){if(button?.disabled)return;if(button)button.disabled=true;const error=$('#form-error');if(error)error.hidden=true;try{await fn();}catch(e){const panel=$('#form-error');if($('#modal').open&&panel){panel.textContent=e.message;panel.hidden=false;}else toast(e.message);}finally{if(button?.isConnected)button.disabled=false;}}
function onForm(fn){$('#modal-content form').addEventListener('submit',e=>{e.preventDefault();const button=e.submitter;action(button,()=>fn(new FormData(e.target)));});}
function field(label,name,value='',options=''){return `<label class="form-field">${h(label)}<input name="${h(name)}" value="${h(value)}" ${options}></label>`;}
function personName(id){return state.recipients.find(p=>p.id===id)?.name||'Osoba';}

async function load({quiet=false}={}){
  const seq=++loadSequence;
  try{
    const [data,owned]=await Promise.all([store.list(state.admin,state.group),store.owned(state.mine)]);
    if(seq!==loadSequence)return;
    state.gifts=data.gifts;state.recipients=data.recipients;state.groups=data.groups;state.owned=Object.fromEntries(owned.map(id=>[id,true]));state.loaded=true;
    if(state.person&&!state.recipients.some(p=>p.id===state.person))state.person='';
    $('#load-error').hidden=true;render();
  }catch(e){if(seq!==loadSequence)return;$('#load-error').hidden=false;$('#load-error').innerHTML=`${h(e.message)} <button class="secondary-button" id="retry">Spróbuj ponownie</button>`;$('#retry').onclick=()=>load();if(!quiet&&!state.loaded)$('#gifts').innerHTML='<div class="empty"><h3>Lista chwilowo niedostępna</h3><p>Spróbuj ponownie za moment.</p></div>';}
}
function render(){
  updateAdminScreen();
  const group=state.groups.find(g=>g.code===state.group);
  const unknownGroup=state.admin&&!!state.group&&!group;
  if($('#group-label')){$('#group-label').hidden=!state.admin||!state.group;$('#group-label').textContent=state.admin?(group?.name||(state.group?'Nieznana grupa':'')):'';}
  document.title=ADMIN_PAGE?'Panel administratora · Prezentownik':'Prezentownik · Lista prezentów';
  const visible=unknownGroup?[]:state.gifts.filter(g=>(!g.archived||state.archived)&&belongsToGroup(g,state.group));
  $('#recipients').innerHTML=[{id:'',name:'Wszyscy'},...state.recipients.filter(p=>!state.group||visible.some(g=>g.recipient_id===p.id))].map(p=>`<button class="recipient ${state.person===p.id?'active':''}" data-person="${h(p.id)}" aria-pressed="${state.person===p.id}"><span class="initial">${p.id?h(p.name.charAt(0)):'♡'}</span>${h(p.name)}<small>${visible.filter(g=>!p.id||g.recipient_id===p.id).length}</small></button>`).join('');
  const categories=[...new Set(visible.filter(g=>!state.person||g.recipient_id===state.person).map(g=>g.category))].sort((a,b)=>a.localeCompare(b,'pl'));
  if(state.category&&!categories.includes(state.category))state.category='';
  $('#category').innerHTML='<option value="">Wszystkie kategorie</option>'+categories.map(c=>`<option ${c===state.category?'selected':''} value="${h(c)}">${h(c)}</option>`).join('');
  const filtered=unknownGroup?[]:filterGifts(state.gifts,{...state,mine:state.owned});
  const available=filtered.filter(g=>!g.reserved&&!g.archived).length;
  $('#result-count').innerHTML=`<strong>${giftCount(filtered.length)}</strong> na liście <span aria-hidden="true">·</span> <span class="status-dot">●</span> Dostępne: ${available}`;
  $('#gifts').innerHTML=filtered.length?filtered.map(card).join(''):`<div class="empty"><h3>${state.status==='mine'?'Brak Twoich rezerwacji':'Brak prezentów'}</h3><p>${state.status==='mine'?'Tutaj zobaczysz prezenty zarezerwowane w tej przeglądarce.':state.admin?'Zmień filtry lub dodaj pierwszy prezent.':'Zmień filtry albo sprawdź listę później.'}</p><button class="secondary-button" data-action="reset-filters">Pokaż wszystkie prezenty</button></div>`;
  if(unknownGroup)$('#gifts').innerHTML='<div class="empty"><h3>Nieznana grupa</h3><p>Sprawdź otrzymany link lub poproś o nowy.</p></div>';
  document.querySelectorAll('[data-status]').forEach(b=>{b.classList.toggle('active',b.dataset.status===state.status);b.setAttribute('aria-pressed',String(b.dataset.status===state.status));});
  if(ADMIN_PAGE){
  $('#admin-toolbar').hidden=!state.admin;
  if(state.admin){$('#admin-toolbar').className='admin-toolbar';$('#admin-toolbar').innerHTML=`<strong>Panel administratora${isDemo?' · demo':''}</strong><button class="primary-button" data-action="add-gift">＋ Dodaj prezent</button><button class="secondary-button" data-action="people">Osoby</button><button class="secondary-button" data-action="groups">Grupy i linki</button><label class="group-view-label">Widok <select id="group-view" aria-label="Podgląd grupy">${groupOptions(state.group)}</select></label><button class="secondary-button" data-action="reservations">Rezerwacje</button><button class="secondary-button" data-action="archive-view">${state.archived?'Ukryj archiwum':'Pokaż archiwum'}</button><button class="secondary-button" data-action="export">Eksport JSON</button><button class="text-button" data-action="logout">Wyloguj</button>`;}
  $('#admin-button').textContent=state.admin?'Zarządzanie':'Zaloguj się';
  }
  document.querySelectorAll('img.external').forEach(img=>img.addEventListener('error',()=>{img.src=`./assets/${img.dataset.fallback}.svg`;img.classList.remove('external');},{once:true}));
}
function card(g){
  const mine=!!state.owned[g.id],image=safeUrl(g.image_url),url=safeUrl(g.url);
  const badge=g.archived?'<span class="badge reserved">W archiwum</span>':g.reserved?`<span class="badge ${mine?'mine':'reserved'}">${mine?'✓ Twoja rezerwacja':'✓ Zarezerwowany'}</span>`:g.priority?'<span class="badge">✦ Priorytet</span>':'';
  return `<article class="gift-card ${g.archived?'admin-archive':''}" data-gift="${h(g.id)}"><div class="gift-image">${badge}<img src="${h(image||`./assets/${illustration(g)}.svg`)}" class="${image?'external':''}" data-fallback="${illustration(g)}" alt="${h(g.name)}" loading="lazy" referrerpolicy="no-referrer"></div><div class="gift-body"><div class="card-meta">${h(personName(g.recipient_id))} <span aria-hidden="true">/</span> ${h(g.category)}</div><h3>${h(g.name)}</h3><p class="gift-description">${h(g.description)}</p><div class="price-line"><span class="price">${h(priceLabel(g.price))}</span>${url?`<a class="shop-link" href="${h(url)}" target="_blank" rel="noopener noreferrer">Zobacz w sklepie ↗</a>`:''}</div><button class="reserve-button ${mine?'mine':''}" data-action="reserve" ${g.archived||g.reserved?'disabled':''}>${g.archived?'Prezent w archiwum':mine?'✓ Moja rezerwacja':g.reserved?'Zarezerwowany':'Zarezerwuj prezent'}</button>${state.admin?`<div class="card-admin"><button data-action="edit">Edytuj</button><button class="danger" data-action="archive">${g.archived?'Przywróć':'Archiwizuj'}</button></div>`:''}</div></article>`;
}
function reserveModal(g){
  modal('Zarezerwuj prezent',`<p>Rezerwujesz: <strong>${h(g.name)}</strong> dla: <strong>${h(personName(g.recipient_id))}</strong>.</p><form>${field('Twoje imię lub pseudonim','guest_name','','required maxlength="80" autocomplete="nickname"')}<p class="footer-help">Widoczne tylko dla administratora listy. Pozostali goście zobaczą jedynie, że prezent jest zajęty.</p><div class="notice">Rezerwacja nie oznacza zakupu. Jeśli się pomylisz, poproś administratora listy o usunięcie rezerwacji.</div><div class="form-actions"><button class="primary-button" type="submit">Rezerwuję ten prezent</button></div></form>`);
  onForm(async form=>{
    const name=form.get('guest_name').trim();if(!name)throw new Error('Wpisz imię lub pseudonim.');
    // Wewnętrzny token pozwala bezpiecznie ponowić żądanie i rozpoznać własną rezerwację.
    const token=state.mine[g.id]||newToken();state.mine[g.id]=token;saveMine();
    try{await store.reserve(g.id,name,token);}catch(e){await load({quiet:true});throw e;}
    await load({quiet:true});showConfirmation(g);
  });
}
function showConfirmation(g){
  modal('Prezent zarezerwowany',`<p><strong>${h(g.name)}</strong> · ${h(personName(g.recipient_id))}</p><p>Jeśli się pomylisz lub zmienisz plany, poproś administratora listy o usunięcie rezerwacji.</p><div class="form-actions"><button class="primary-button" id="reservation-done">Gotowe</button></div>`);
  $('#reservation-done').onclick=closeModal;
}
function confirmModal(title,message,label,fn){modal(title,`<p>${h(message)}</p><div class="form-actions"><button class="danger-button" id="confirm">${h(label)}</button><button class="secondary-button" id="abort">Wróć do listy</button></div>`);$('#confirm').onclick=e=>action(e.currentTarget,fn);$('#abort').onclick=closeModal;}
async function copy(text){try{await navigator.clipboard.writeText(text);}catch{throw new Error('Przeglądarka nie pozwoliła skopiować linku. Zaznacz i skopiuj go ręcznie.');}}
function download(name,content,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function updateAdminScreen(){
  if(!ADMIN_PAGE)return;
  $('#admin-login').hidden=state.admin;
  $('#main').hidden=!state.admin;
  $('#admin-login-note').hidden=!isDemo;
  $('#admin-login-note').textContent=isDemo?'Tryb demo. Hasło: demo.':'';
}
function loginModal(){
  if(!ADMIN_PAGE)return;
  updateAdminScreen();
  if(state.admin)$('#admin-toolbar').scrollIntoView({behavior:'smooth',block:'center'});
  else $('#admin-login-form input').focus();
}
function giftModal(g={}){
  if(!state.recipients.length){peopleModal();return;}
  modal(g.id?'Edytuj prezent':'Dodaj prezent',`<form>${field('Nazwa prezentu','name',g.name,'required maxlength="140"')}<div class="form-row"><label class="form-field">Dla kogo?<select name="recipient_id" required>${state.recipients.map(p=>`<option value="${h(p.id)}" ${p.id===(g.recipient_id||state.person)?'selected':''}>${h(p.name)}</option>`).join('')}</select></label>${field('Cena (zł, opcjonalnie)','price',g.price??'','type="number" min="0" max="1000000" step="0.01"')}</div>${field('Kategoria','category',g.category||'Zabawki','required maxlength="50" list="category-options"')}<datalist id="category-options">${['Zabawki','Książki','Kreatywne','Przytulanki','Elektronika','Sport','Inne'].map(c=>`<option>${c}</option>`).join('')}</datalist><label class="form-field">Opis / wskazówki<textarea name="description" maxlength="1000">${h(g.description)}</textarea></label>${field('Link do sklepu (opcjonalnie)','url',g.url,'type="url" maxlength="2048" placeholder="https://…"')}${field('Adres zdjęcia (opcjonalnie)','image_url',g.image_url,'type="url" maxlength="2048" placeholder="https://…"')}<p class="footer-help">Bez zdjęcia pokażemy ilustrację kategorii. Używaj linków HTTPS do zdjęć, które możesz udostępniać.</p><fieldset class="group-fields"><legend>Widoczność dla grup</legend><p>Bez zaznaczeń: prezent wspólny dla wszystkich.</p>${state.groups.map(group=>`<label class="checkbox-field"><input type="checkbox" name="group_codes" value="${h(group.code)}" ${(g.group_codes||(!g.id&&state.group?[state.group]:[])).includes(group.code)?'checked':''}> ${h(group.name)}</label>`).join('')}</fieldset><label class="checkbox-field"><input type="checkbox" name="priority" ${g.priority?'checked':''}> Oznacz jako „Priorytet”</label><div class="form-actions"><button class="primary-button">Zapisz prezent</button></div></form>`);
  onForm(async form=>{const data=validateGift({...(g.id?{id:g.id}:{}),name:form.get('name'),recipient_id:form.get('recipient_id'),price:form.get('price')===''?null:Number(form.get('price')),category:form.get('category'),description:form.get('description').trim(),url:form.get('url').trim(),image_url:form.get('image_url').trim(),priority:form.has('priority'),group_codes:form.getAll('group_codes')});await store.saveGift(data);closeModal();await load();toast('Prezent zapisany.');});
}
function peopleModal(){modal('Dla kogo są prezenty?',`<p>Dodaj bliskich i stwórz dla każdego własną listę.</p><div>${state.recipients.map(p=>`<div class="person-row"><span>${h(p.name)}</span><button class="secondary-button" data-edit-person="${h(p.id)}">Zmień nazwę</button></div>`).join('')}</div><form>${field('Nowa osoba','name','','required maxlength="60" placeholder="np. Ola"')}<div class="form-actions"><button class="primary-button">Dodaj osobę</button></div></form>`);onForm(async form=>{const name=form.get('name').trim();if(!name)throw new Error('Podaj imię.');await store.savePerson({name});await load();peopleModal();toast('Osoba dodana.');});document.querySelectorAll('[data-edit-person]').forEach(button=>button.onclick=()=>{const p=state.recipients.find(p=>p.id===button.dataset.editPerson);modal('Zmień nazwę osoby',`<form>${field('Imię lub nazwa','name',p.name,'required maxlength="60"')}<div class="form-actions"><button class="primary-button">Zapisz</button></div></form>`);onForm(async form=>{const name=form.get('name').trim();if(!name)throw new Error('Podaj imię.');await store.savePerson({id:p.id,name});await load();peopleModal();});});}
async function reservationsModal(){const reservations=await store.reservations();modal('Zarezerwowane prezenty',`<p>${reservations.length} aktywnych rezerwacji. Imiona widoczne są tylko dla administratorów.</p>${reservations.map(r=>{const g=state.gifts.find(g=>g.id===r.gift_id);return `<div class="reservation-row"><span><strong>${h(g?.name||'Prezent')}</strong><small>${h(r.guest_name)} · ${h(new Date(r.created_at).toLocaleDateString('pl-PL'))}</small></span><button class="secondary-button" data-release="${h(r.gift_id)}">Zwolnij</button></div>`;}).join('')||'<div class="notice">Nikt jeszcze nie zarezerwował prezentu.</div>'}`);document.querySelectorAll('[data-release]').forEach(button=>button.onclick=()=>confirmModal('Zwolnić rezerwację?','Prezent będzie znów dostępny dla wszystkich gości.','Zwolnij prezent',async()=>{await store.release(button.dataset.release);await load();await reservationsModal();toast('Prezent jest ponownie dostępny.');}));}


function groupOptions(selected='') {
  return `<option value="">Wszystkie prezenty</option>`+state.groups.map(g=>`<option value="${h(g.code)}" ${g.code===selected?'selected':''}>${h(g.name)}</option>`).join('');
}
function shareModal(selected=state.group) {
  modal('Udostępnij listę',`${state.admin?`<label class="form-field">Wariant listy<select id="share-group">${groupOptions(selected)}</select></label>`:''}${state.person?`<label class="checkbox-field"><input type="checkbox" id="share-person" checked> Tylko ${h(personName(state.person))}</label>`:''}<label class="form-field">Link<input id="share-url" readonly></label><div class="form-actions"><button class="primary-button" id="copy-link">Kopiuj link</button><a class="secondary-button" id="preview-link" target="_blank" rel="noopener">Otwórz listę</a></div>${state.admin?'<p class="footer-help">Wariant wybiera zestaw prezentów. Link nie jest zabezpieczeniem dostępu.</p>':''}`);
  const update=()=>{const url=listUrl(location.href,{group:state.admin?$('#share-group').value:state.group,person:$('#share-person')?.checked?state.person:''});$('#share-url').value=url;$('#preview-link').href=url;};
  if($('#share-group'))$('#share-group').onchange=update;if($('#share-person'))$('#share-person').onchange=update;update();
  $('#share-url').onclick=e=>e.target.select();
  $('#copy-link').onclick=e=>action(e.currentTarget,async()=>{await copy($('#share-url').value);toast('Link skopiowany.');});
}
function groupsModal() {
  modal('Grupy i linki',`<div>${state.groups.map(g=>`<div class="person-row"><span><strong>${h(g.name)}</strong><small class="group-code">?g=${h(g.code)}</small></span><div class="row-actions"><button class="secondary-button" data-group-link="${h(g.code)}">Link</button><button class="secondary-button" data-group-edit="${h(g.code)}">Edytuj</button></div></div>`).join('')}</div><form><h3>Dodaj grupę</h3>${field('Nazwa grupy','name','','required maxlength="60" placeholder="np. Rodzina"')}${field('Kod w linku','code','','required maxlength="16" pattern="[a-z](?:[a-z0-9]|-){0,15}" placeholder="np. r"')}<div class="form-actions"><button class="primary-button">Dodaj grupę</button></div></form>`);
  onForm(async form=>{const group=validateGroup({code:form.get('code'),name:form.get('name')});await store.saveGroup(group);await load();groupsModal();toast('Grupa dodana. Przypisz do niej prezenty w formularzu edycji.');});
  document.querySelectorAll('[data-group-link]').forEach(b=>b.onclick=()=>shareModal(b.dataset.groupLink));
  document.querySelectorAll('[data-group-edit]').forEach(b=>b.onclick=()=>{const group=state.groups.find(g=>g.code===b.dataset.groupEdit);modal('Edytuj grupę',`<p>Kod linku: <strong>${h(group.code)}</strong></p><form>${field('Nazwa grupy','name',group.name,'required maxlength="60"')}<div class="form-actions"><button class="primary-button">Zapisz grupę</button></div></form>`);onForm(async form=>{await store.saveGroup(validateGroup({...group,name:form.get('name')}),true);await load();groupsModal();});});
}

$('#modal-close').onclick=closeModal;
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
$('#admin-login-form')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.currentTarget,button=$('#admin-login-submit'),error=$('#admin-login-error');
  if(button.disabled||!store)return;
  button.disabled=true;error.hidden=true;
  try{
    await store.login(new FormData(form).get('password'));
    form.reset();state.admin=true;updateAdminScreen();await load();toast('Zalogowano.');
  }catch(err){error.textContent=err.message;error.hidden=false;form.querySelector('input').focus();}
  finally{button.disabled=false;}
});
$('#admin-button')?.addEventListener('click',()=>store&&loginModal());
$('#share-button').onclick=()=>store&&shareModal();
$('#search').addEventListener('input',e=>{state.query=e.target.value;render();});
$('#category').onchange=e=>{state.category=e.target.value;render();};
$('#sort').onchange=e=>{state.sort=e.target.value;render();};
$('#recipients').onclick=e=>{const b=e.target.closest('[data-person]');if(!b)return;state.person=b.dataset.person;state.category='';history.replaceState(null,'',`${location.pathname}${location.search}${state.person?'#osoba='+state.person:''}`);render();};
document.querySelector('.status-filters').onclick=e=>{const b=e.target.closest('[data-status]');if(!b)return;state.status=b.dataset.status;render();};
document.addEventListener('click',e=>{
  const button=e.target.closest('[data-action]');if(!button||!store)return;const name=button.dataset.action;const id=button.closest('[data-gift]')?.dataset.gift;const g=state.gifts.find(g=>g.id===id);
  if(name==='reset-filters'){state.person='';state.query='';state.category='';state.status='all';$('#search').value='';history.replaceState(null,'',listUrl(location.href,{group:state.group,keepPage:ADMIN_PAGE}));render();}
  if(name==='reserve'&&g)reserveModal(g);
  if(!ADMIN_PAGE||!state.admin)return;
  if(name==='add-gift')giftModal();if(name==='edit'&&g)giftModal(g);if(name==='people')peopleModal();if(name==='groups')groupsModal();
  if(name==='reservations')action(button,reservationsModal);
  if(name==='archive-view'){state.archived=!state.archived;render();}
  if(name==='archive'&&g)confirmModal(g.archived?'Przywrócić prezent?':'Przenieść do archiwum?',g.archived?'Prezent ponownie pojawi się na publicznej liście.':'Prezent zniknie z publicznej listy. Istniejąca rezerwacja pozostanie zachowana. Możesz go później przywrócić.',g.archived?'Przywróć':'Archiwizuj',async()=>{await store.archive(g.id,!g.archived);closeModal();await load();toast(g.archived?'Prezent przywrócony.':'Prezent zarchiwizowany.');});
  if(name==='export'){download('prezentownik.json',JSON.stringify({version:2,groups:state.groups,exported_at:new Date().toISOString(),recipients:state.recipients,gifts:state.gifts.map(({reserved,...g})=>g)},null,2));toast('Eksport listy zapisany. Nie zawiera rezerwacji ani danych gości.');}
  if(name==='logout')action(button,async()=>{try{if(!isDemo)await store.logout();}finally{state.admin=false;state.archived=false;$('#admin-login-form').reset();$('#admin-login-error').hidden=true;updateAdminScreen();await load();loginModal();}toast('Wylogowano.');});
});
window.addEventListener('storage',e=>{if(e.key===mineKey){try{state.mine=JSON.parse(e.newValue||'{}');}catch{state.mine={};}}if(store)load({quiet:true});});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&store&&!$('#modal').open)load({quiet:true});});
document.addEventListener('change',e=>{if(e.target.id==='group-view'){state.group=e.target.value;state.person='';state.category='';history.replaceState(null,'',listUrl(location.href,{group:state.group,keepPage:ADMIN_PAGE}));render();}});
window.addEventListener('popstate',()=>{state.group=new URL(location.href).searchParams.get('g')||'';state.person=new URLSearchParams(location.hash.slice(1)).get('osoba')||'';if(state.loaded)load();});
window.addEventListener('hashchange',()=>{state.person=new URLSearchParams(location.hash.slice(1)).get('osoba')||'';if(state.loaded)render();});
async function boot(){
  try{store=createStore();if(ADMIN_PAGE)$('#admin-login-submit').disabled=false;if(isDemo){$('#mode-banner').hidden=false;$('#mode-banner').textContent='Demo — dane i rezerwacje zapisują się tylko w tej przeglądarce.';}else if(ADMIN_PAGE){try{state.admin=await store.isAdmin();}catch{store.clearSession();toast('Sesja administratora wygasła. Możesz zalogować się ponownie.');}}
    state.person=new URLSearchParams(location.hash.slice(1)).get('osoba')||'';await load();if(ADMIN_PAGE&&!state.admin)loginModal();
    setInterval(()=>{if(!document.hidden&&!$('#modal').open)load({quiet:true});},30000);
  }catch(e){if(ADMIN_PAGE){$('#admin-login-error').textContent=e.message;$('#admin-login-error').hidden=false;}else{$('#load-error').hidden=false;$('#load-error').textContent=e.message;$('#result-count').textContent='Nie udało się uruchomić listy.';}}
}
boot();
