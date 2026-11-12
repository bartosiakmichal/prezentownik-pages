import {DEFAULT_GROUPS,validateGroup,belongsToGroup} from './domain.js';
const ALUNIA_ID='11111111-1111-4111-8111-111111111111';
const SEED_VERSION=2;
export function initialDemo() {
  const recipients=[{id:ALUNIA_ID,name:'Alunia'}];
  const rows=[
    ['Interaktywny muzyczny pluszak — Owocowy przyjaciel','Przytulanki','Muzyczny pluszak z podlinkowanej oferty.', 'https://allegro.pl/oferta/interaktywny-muzyczny-pluszak-owocowy-przyjaciel-3-hit-2026-18929566026'],
    ['Pianino KIDYPIANO — Kidywolf','Muzyczne','Kolor trzeba wybrać — ustal go przed zakupem.', 'https://kidywolf.com/en/products/kidypiano'],
    ['Magnetyczna naklejka ścienna 95 × 75 cm — Cleverclixx','Kreatywne','Wariant z linku: soft nude.', 'https://www.dobreliski.pl/pl/p/Magnetyczna-naklejka-scienna-95x75cm-soft-nude-Cleverclixx/50306'],
    ['Klocki magnetyczne — Magna-Tiles Zamek, 25 el.','Zabawki','To tylko przykładowy zestaw klocków magnetycznych.', 'https://www.dobreliski.pl/pl/p/Klocki-Magnetyczne-Zamek-25-el.-Magna-Tiles/36545']
  ];
  const gifts=rows.map(([name,category,description,url],i)=>({id:`bbbbbbbb-bbbb-4bbb-8bbb-${String(i+1).padStart(12,'0')}`,name,category,price:null,description,priority:false,recipient_id:ALUNIA_ID,url,image_url:'',archived:false,reserved:false,group_codes:[]}));
  return {seedVersion:SEED_VERSION,groups:structuredClone(DEFAULT_GROUPS),recipients,gifts,reservations:[]};
}

function updateExamples(state) {
  const fresh=initialDemo();
  // Nowe prezenty mają nowe identyfikatory: dawna rezerwacja nie przejdzie na inny produkt.
  const oldIds=new Set(Array.from({length:8},(_,i)=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(i+1).padStart(12,'0')}`));
  state.reservations=state.reservations.filter(r=>!(oldIds.has(r.gift_id)&&r.token==='demo-unavailable'));
  const reservedIds=new Set(state.reservations.map(r=>r.gift_id));
  state.gifts=state.gifts.filter(g=>!oldIds.has(g.id)||reservedIds.has(g.id));
  for(const gift of state.gifts){
    gift.recipient_id=ALUNIA_ID;
    if(oldIds.has(gift.id))gift.archived=true;
  }
  state.recipients=fresh.recipients;
  state.gifts.push(...fresh.gifts.filter(g=>!state.gifts.some(existing=>existing.id===g.id)));
  state.seedVersion=SEED_VERSION;
}

// Demo jest wyłącznie lokalnym podglądem. Produkcja używa transakcji PostgreSQL.
export class DemoStore {
  constructor(storage) { this.storage=storage; this.key='podaruj-demo-v1'; }
  read() {
    const raw=this.storage.getItem(this.key);
    if(!raw){const state=initialDemo();this.write(state);return state;}
    const state=JSON.parse(raw);let changed=false;
    if(!state.groups){state.groups=structuredClone(DEFAULT_GROUPS);changed=true;}
    for(const gift of state.gifts){if(!Array.isArray(gift.group_codes)){gift.group_codes=[];changed=true;}}
    if((state.seedVersion||0)<SEED_VERSION){
      const backupKey=`${this.key}-before-alunia`;
      if(!this.storage.getItem(backupKey))this.storage.setItem(backupKey,raw);
      updateExamples(state);changed=true;
    }
    if(changed)this.write(state);
    return state;
  }
  write(state) { this.storage.setItem(this.key,JSON.stringify(state)); }
  async mutate(fn) {
    const run=()=>{const state=this.read();const value=fn(state);this.write(state);return value;};
    return typeof window!=='undefined' && globalThis.navigator?.locks ? navigator.locks.request(this.key,run) : run();
  }
  async list(admin=false,group='') {
    const s=this.read();
    if(admin&&typeof document!=='undefined'){
      const defaults=JSON.parse(document.querySelector('#demo-group-labels')?.textContent||'[]');
      for(const label of defaults){const existing=s.groups.find(g=>g.code===label.code);if(existing&&existing.name===existing.code)existing.name=label.name;}
      this.write(s);
    }
    if(admin)return {groups:s.groups,recipients:s.recipients,gifts:s.gifts};
    const valid=!group||s.groups.some(g=>g.code===group);
    const gifts=valid?s.gifts.filter(g=>!g.archived&&belongsToGroup(g,group)).map(({group_codes,...gift})=>gift):[];
    return {groups:[],recipients:s.recipients,gifts};
  }
  async login(password) {if(password!=='demo')throw new Error('Nieprawidłowe hasło. W trybie demo użyj: demo.');}
  async reserve(id,guest_name,token) { return this.mutate(s=>{const g=s.gifts.find(g=>g.id===id&&!g.archived);if(!g)throw new Error('Ten prezent nie jest już dostępny.');const r=s.reservations.find(r=>r.gift_id===id);if(r?.token===token)return;if(g.reserved)throw new Error('Ktoś już zarezerwował ten prezent. Wybierz inny.');g.reserved=true;s.reservations.push({gift_id:id,guest_name,token,created_at:new Date().toISOString()});}); }
  async saveGift(gift) { return this.mutate(s=>{if((gift.group_codes||[]).some(code=>!s.groups.some(group=>group.code===code)))throw new Error('Nieznana grupa.');const old=s.gifts.find(g=>g.id===gift.id);if(old)Object.assign(old,gift);else s.gifts.push({...gift,id:crypto.randomUUID(),reserved:false,archived:false});}); }
  async saveGroup(group,editing=false) {const data=validateGroup(group);return this.mutate(s=>{const old=s.groups.find(g=>g.code===data.code);if(editing){if(!old)throw new Error('Nieznana grupa.');old.name=data.name;}else{if(old)throw new Error('Ten kod grupy już istnieje.');s.groups.push(data);}});}
  async archive(id,archived) { return this.mutate(s=>{s.gifts.find(g=>g.id===id).archived=archived;}); }
  async savePerson(person) { return this.mutate(s=>{const old=s.recipients.find(p=>p.id===person.id);if(old)old.name=person.name;else s.recipients.push({id:crypto.randomUUID(),name:person.name});}); }
  async reservations() {return this.read().reservations.map(({token,...r})=>r);}
  async owned(claims) {return this.read().reservations.filter(r=>claims[r.gift_id]===r.token).map(r=>r.gift_id);}
  async release(id) {return this.mutate(s=>{s.reservations=s.reservations.filter(r=>r.gift_id!==id);const g=s.gifts.find(g=>g.id===id);if(g)g.reserved=false;});}
}
