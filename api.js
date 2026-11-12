import {config} from './config.js';
import {DemoStore} from './demo.js';
export const isDemo=!config.supabaseUrl&&!config.supabaseKey;
const sessionKey='podaruj-admin-session';
export class RemoteStore {
  constructor() {
    this.session=null;
    try{this.session=JSON.parse(sessionStorage.getItem(sessionKey)||'null');}catch{sessionStorage.removeItem(sessionKey);}
    this.base=config.supabaseUrl.replace(/\/$/,'');
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(this.base)||!config.supabaseKey)throw new Error('Uzupełnij poprawny adres projektu Supabase i publiczny klucz w config.js.');
    if(config.supabaseKey.startsWith('sb_secret_'))throw new Error('Użyj publicznego klucza publishable, nigdy secret.');
    if(config.supabaseKey.startsWith('eyJ')){
      let role;try{role=JSON.parse(atob(config.supabaseKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role;}catch{throw new Error('Niepoprawny klucz anon.');}
      if(role!=='anon')throw new Error('Użyj wyłącznie publicznego klucza anon lub publishable.');
    }else if(!config.supabaseKey.startsWith('sb_publishable_'))throw new Error('Niepoprawny publiczny klucz Supabase.');
  }
  async request(path,{method='GET',body,auth=true,refresh=true}={}) {
    if(auth&&refresh&&this.session&&this.session.expires_at*1000<Date.now()+60000)await this.refresh();
    const headers={apikey:config.supabaseKey,'Content-Type':'application/json'};
    if(auth&&this.session)headers.Authorization=`Bearer ${this.session.access_token}`;
    else if(config.supabaseKey.startsWith('eyJ'))headers.Authorization=`Bearer ${config.supabaseKey}`;
    let response;
    try{response=await fetch(`${this.base}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{throw new Error('Nie udało się połączyć. Sprawdź internet i spróbuj ponownie.');}
    const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null;}catch{data=null;}
    if(!response.ok){
      const message=data?.message||data?.error_description||'';
      if(data?.code==='23505'&&path.startsWith('/rest/v1/gift_groups'))throw new Error('Ten kod grupy już istnieje. Wybierz inny.');
      if(message.includes('INVALID_GROUP'))throw new Error('Niepoprawna grupa. Odśwież listę i spróbuj ponownie.');
      if(path.startsWith('/rest/v1/gift_groups')&&(response.status===404||data?.code==='PGRST205'))throw new Error('Baza wymaga aktualizacji grup: uruchom supabase/migrations/002_groups.sql.');
      if(path==='/rest/v1/rpc/list_public_gifts'&&response.status===404)throw new Error('Lista wymaga aktualizacji przez administratora.');
      if(message.includes('GIFT_UNAVAILABLE'))throw new Error('Ktoś już zarezerwował ten prezent lub został on zarchiwizowany.');
      if(message.includes('INVALID_TOKEN'))throw new Error('Nie udało się potwierdzić rezerwacji. Odśwież listę i spróbuj ponownie.');
      if(response.status===401||response.status===403)throw new Error('Brak uprawnień lub sesja wygasła. Zaloguj się ponownie.');
      if(path.startsWith('/auth/'))throw new Error('Logowanie nie powiodło się. Sprawdź hasło i spróbuj ponownie.');
      throw new Error('Nie udało się zapisać lub odczytać danych. Sprawdź konfigurację bazy i spróbuj ponownie.');
    }
    return data;
  }
  persist(session){this.session=session;sessionStorage.setItem(sessionKey,JSON.stringify(session));}
  async refresh(){if(!this.refreshing)this.refreshing=this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:this.session.refresh_token},auth:false,refresh:false}).then(s=>this.persist(s)).catch(e=>{this.clearSession();throw e;}).finally(()=>{this.refreshing=null;});return this.refreshing;}
  clearSession(){this.session=null;sessionStorage.removeItem(sessionKey);}
  async login(password){const email=config.adminEmail?.trim();if(!email)throw new Error('Logowanie nie jest jeszcze skonfigurowane. Uzupełnij adminEmail w konfiguracji.');const session=await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},auth:false});this.persist(session);try{if(!await this.isAdmin())throw new Error('To konto nie ma uprawnień administratora.');}catch(e){this.clearSession();throw e;}}
  async logout(){try{if(this.session)await this.request('/auth/v1/logout',{method:'POST'});}finally{this.clearSession();}}
  async isAdmin(){if(!this.session)return false;return this.request('/rest/v1/rpc/is_gift_admin',{method:'POST',body:{}});}
  async list(admin=false,group=''){
    const [recipients,gifts,groups]=await Promise.all([
      this.request('/rest/v1/recipients?select=*&order=name',{auth:admin}),
      admin?this.request('/rest/v1/rpc/list_gifts',{method:'POST',body:{include_archived:true}}):this.request('/rest/v1/rpc/list_public_gifts',{method:'POST',body:{group_code:group||null},auth:false}),
      admin?this.request('/rest/v1/gift_groups?select=code,name&order=name'):Promise.resolve([])
    ]);
    return {recipients,gifts,groups};
  }
  reserve(id,name,token){return this.request('/rest/v1/rpc/reserve_gift',{method:'POST',body:{target_id:id,guest_name:name,reservation_token:token},auth:false});}
  saveGift(gift){const {id,...data}=gift;return this.request(`/rest/v1/gifts${id?`?id=eq.${encodeURIComponent(id)}`:''}`,{method:id?'PATCH':'POST',body:data});}
  saveGroup(group,editing=false){return this.request(`/rest/v1/gift_groups${editing?`?code=eq.${encodeURIComponent(group.code)}`:''}`,{method:editing?'PATCH':'POST',body:editing?{name:group.name}:group});}
  archive(id,archived){return this.request(`/rest/v1/gifts?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{archived}});}
  savePerson(person){const {id,...data}=person;return this.request(`/rest/v1/recipients${id?`?id=eq.${encodeURIComponent(id)}`:''}`,{method:id?'PATCH':'POST',body:data});}
  reservations(){return this.request('/rest/v1/reservations?select=gift_id,guest_name,created_at&order=created_at.desc');}
  owned(claims){return Object.keys(claims).length?this.request('/rest/v1/rpc/owned_reservations',{method:'POST',body:{claims},auth:false}):Promise.resolve([]);}
  release(id){return this.request(`/rest/v1/reservations?gift_id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});}
}
export function createStore(){return isDemo?new DemoStore(localStorage):new RemoteStore();}
