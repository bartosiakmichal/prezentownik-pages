export function safeUrl(value) {
  if (!value) return '';
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function filterGifts(gifts, {person='', query='', category='', status='all', sort='priority', mine={}, archived=false, group=''}={}) {
  const term = query.trim().toLocaleLowerCase('pl');
  return gifts.filter(g => belongsToGroup(g,group) && (!g.archived || archived) && (!person || g.recipient_id===person) && (!category || g.category===category) && (!term || `${g.name} ${g.description}`.toLocaleLowerCase('pl').includes(term)) && (status!=='available' || !g.reserved) && (status!=='mine' || (g.reserved && mine[g.id])))
    .sort((a,b) => sort==='price-asc' ? (a.price ?? Infinity)-(b.price ?? Infinity) : sort==='price-desc' ? (b.price ?? -Infinity)-(a.price ?? -Infinity) : sort==='name' ? a.name.localeCompare(b.name,'pl') : Number(b.priority)-Number(a.priority) || a.name.localeCompare(b.name,'pl'));
}
export function validateGift(g) {
  if (!g.name?.trim() || g.name.length>140) throw new Error('Podaj nazwę prezentu (maks. 140 znaków).');
  if (!g.recipient_id) throw new Error('Wybierz osobę.');
  if (!g.category?.trim() || g.category.length>50) throw new Error('Podaj kategorię (maks. 50 znaków).');
  if ((g.description || '').length>1000) throw new Error('Opis może mieć maksymalnie 1000 znaków.');
  if (g.price!==null && (!Number.isFinite(g.price) || g.price<0 || g.price>1000000)) throw new Error('Podaj poprawną cenę od 0 do 1 000 000 zł.');
  for (const field of ['url','image_url']) if (g[field] && (g[field].length>2048 || !safeUrl(g[field]))) throw new Error('Linki muszą być poprawnymi adresami HTTPS (maks. 2048 znaki).');
  const group_codes=g.group_codes??[];
  if (!Array.isArray(group_codes)||group_codes.length>50||group_codes.some(code=>typeof code!=='string'||!GROUP_CODE.test(code))||new Set(group_codes).size!==group_codes.length) throw new Error('Niepoprawne przypisanie grup.');
  return {...g,name:g.name.trim(),category:g.category.trim(),group_codes};
}
export function newToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), x=>x.toString(16).padStart(2,'0')).join(''); }
export const priceLabel = price => price===null ? 'Cena do ustalenia' : new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN',maximumFractionDigits:2}).format(price);
export function giftCount(count){const mod=count%100;return `${count} ${count===1?'prezent':count%10>=2&&count%10<=4&&(mod<12||mod>14)?'prezenty':'prezentów'}`;}
export function illustration(gift) {
  const category = gift.category.toLowerCase();
  return category.includes('książ') ? 'book' : category.includes('kreat') ? 'art' : category.includes('przytul') ? 'bear' : 'blocks';
}

export const GROUP_CODE=/^[a-z][a-z0-9-]{0,15}$/;
export const DEFAULT_GROUPS=[{code:'t',name:'t'},{code:'s',name:'s'}];
export function belongsToGroup(gift,group='') {
  return !group || !(gift.group_codes?.length) || gift.group_codes.includes(group);
}
export function validateGroup(group) {
  const code=String(group.code||'').trim().toLowerCase(),name=String(group.name||'').trim();
  if(!GROUP_CODE.test(code))throw new Error('Kod musi zaczynać się literą i mieć 1–16 małych liter, cyfr lub myślników.');
  if(!name||name.length>60)throw new Error('Podaj nazwę grupy (maks. 60 znaków).');
  return {code,name};
}
export function listUrl(base,{group='',person='',keepPage=false}={}) {
  // Udostępnianie nigdy nie przenosi nazwy prywatnej strony panelu.
  const url=keepPage?new URL(base):new URL('./',base);
  url.search='';
  if(group)url.searchParams.set('g',group);
  url.hash=person?new URLSearchParams({osoba:person}).toString():'';
  return url.href;
}
