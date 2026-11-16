(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ic = n => `<svg class="ic"><use href="#i-${n}"/></svg>`;
const TYPES = ['Kasko','Trafik','DASK','Konut','Sağlık','İşyeri','Seyahat','Diğer'];
const MONTHS = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
const RENEW = [['', 'Aranmadı'], ['arandi', 'Arandı'], ['teklif', 'Teklif verildi'], ['yenilendi', 'Yenilendi'], ['kaybedildi', 'Kaybedildi']];
const QSTAT = [['bekliyor', 'Bekliyor', 'warn'], ['kabul', 'Kabul edildi', 'ok'], ['ret', 'Reddedildi', 'crit']];
const CSTAT = [['acik', 'Açık', 'warn'], ['eksper', 'Eksper aşamasında', 'warn'], ['odeme', 'Ödeme bekleniyor', 'warn'], ['kapandi', 'Kapandı', 'none']];
const PLANS = [['', 'Ödeme takibi yok'], ['paid', 'Peşin, tahsil edildi'], ['cash', 'Peşin, tahsil edilecek']].concat([2,3,4,5,6,8,9,10,12].map(n => [String(n), `${n} taksit`]));

/* ---------- dates, money ---------- */
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const pd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], m[2]-1, +m[3]) : null; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d, n) => { const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate(); return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last)); };
const fmtDate = s => { const d = pd(s); return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—'; };
const daysLeft = p => { const d = pd(p.end); return d ? Math.round((d - today()) / 864e5) : null; };
const nf = new Intl.NumberFormat('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2});
const money = n => (typeof n === 'number' && isFinite(n)) ? nf.format(n) + ' ₺' : '—';
const r2 = n => Math.round(n * 100) / 100;
function parseMoney(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s); return isFinite(n) ? n : null;
}
function status(p) {
  const d = daysLeft(p);
  if (d === null) return {key:'none', label:'Tarih yok'};
  if (d < 0) return {key:'crit', label:'Süresi doldu'};
  if (d <= 30) return {key:'warn', label: d === 0 ? 'Bugün bitiyor' : `${d} gün kaldı`};
  return {key:'ok', label:'Aktif'};
}
const low = s => String(s ?? '').toLocaleLowerCase('tr');
const ckey = s => low(s).replace(/\s+/g, ' ').trim();
const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const lbl = (arr, v) => (arr.find(x => x[0] === (v || '')) || arr[0]);

/* ---------- money on a policy ---------- */
const comm = p => typeof p.commission === 'number' ? p.commission : (p.commRate && p.premium ? r2(p.premium * p.commRate / 100) : 0);
const unpaid = p => (p.installments || []).filter(i => !i.paid);
const debt = p => r2(unpaid(p).reduce((s, i) => s + i.amount, 0));
const overdue = p => { const t = iso(today()); return r2(unpaid(p).filter(i => i.due < t).reduce((s, i) => s + i.amount, 0)); };
function makeInst(plan, premium, start) {
  if (!plan || !premium) return [];
  const base = pd(start) || today();
  if (plan === 'paid' || plan === 'cash') return [{due: iso(base), amount: premium, paid: plan === 'paid'}];
  const n = +plan, each = Math.floor(premium / n * 100) / 100;
  return Array.from({length: n}, (_, i) => ({due: iso(addMonths(base, i)), amount: i === n - 1 ? r2(premium - each * (n - 1)) : each, paid: false}));
}

/* ---------- storage ---------- */
const st = {loaded:false, mode:'', selecting:false, selected:new Set(), tab:'policeler', takip:'yen'};
let policies = [];
const misc = new Map();                       // customers (c:), quotes (q:), claims (h:), settings (s:)
const idb = {
  db:null,
  open() { return new Promise((res, rej) => {
    const r = indexedDB.open('police-defterim', 2);
    r.onupgradeneeded = () => { for (const s of ['policies', 'files', 'misc']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, {keyPath:'id'}); };
    r.onsuccess = () => { idb.db = r.result; res(); }; r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
  }); },
  tx(store, mode, fn) { return new Promise((res, rej) => {
    const t = idb.db.transaction(store, mode), rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result); t.onerror = t.onabort = () => rej(t.error);
  }); },
  all: s => idb.tx(s, 'readonly', o => o.getAll()), get: (s, k) => idb.tx(s, 'readonly', o => o.get(k)),
  put: (s, v) => idb.tx(s, 'readwrite', o => o.put(v)), del: (s, k) => idb.tx(s, 'readwrite', o => o.delete(k)),
  putMany: (s, arr) => idb.tx(s, 'readwrite', o => { arr.forEach(v => o.put(v)); }),
  clear: s => idb.tx(s, 'readwrite', o => o.clear()),
};
const on = () => st.mode === 'idb';
async function savePolicy(id, data, silent) {
  const rec = {...data, id: id || newId()};
  if (on()) await idb.put('policies', rec);
  const i = policies.findIndex(p => p.id === rec.id);
  if (i >= 0) policies[i] = rec; else policies.push(rec);
  if (!silent) renderAll(); return rec.id;
}
async function removePolicy(p, silent) {
  if (on()) await idb.del('policies', p.id);
  policies = policies.filter(x => x.id !== p.id);
  if (p.fileId && on()) idb.del('files', p.fileId).catch(() => {});
  if (!silent) renderAll();
}
async function putMisc(rec, silent) { rec.updatedAt = Date.now(); if (on()) await idb.put('misc', rec); misc.set(rec.id, rec); if (!silent) renderAll(); }
async function delMisc(id) { if (on()) await idb.del('misc', id); misc.delete(id); renderAll(); }
const kindOf = k => [...misc.values()].filter(r => r.kind === k);
const custInfo = name => misc.get('c:' + ckey(name)) || {};
const phoneOf = p => p.phone || custInfo(p.name).phone || '';
const writeErr = e => toast(e && e.name === 'QuotaExceededError' ? 'Telefonun depolama alanı doldu. Eski poliçeleri veya dosyaları silin.' : 'Kaydedilemedi. Yeniden deneyin.');
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
}
const touch = () => matchMedia('(pointer:coarse)').matches;
// Hands a file to the phone's share sheet (WhatsApp, Mail, Dosyalar'a Kaydet); on a computer it downloads.
async function saveFile(file, text) {
  if (touch() && navigator.canShare && navigator.canShare({files:[file]})) {
    try { await navigator.share(text ? {files:[file], text} : {files:[file]}); return; }
    catch (e) { if (e && e.name === 'AbortError') throw {code:'declined'}; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const saveText = (filename, data, type) => saveFile(new File([data], filename, {type})).catch(e => { if (!e || e.code !== 'declined') toast('Dosya kaydedilemedi.'); });

/* ---------- settings & templates ---------- */
const DEF_TPL = [
  {title:'Poliçe bilgisi', text:'Sayın {ad},\n{tur} poliçenizin bilgileri:\nSigorta şirketi: {sirket}\nPoliçe no: {policeNo}\nBaşlangıç: {baslangic}\nBitiş: {bitis}\nToplam prim: {prim}'},
  {title:'Yenileme hatırlatma', text:'Sayın {ad}, {plaka} {tur} poliçeniz {bitis} tarihinde sona eriyor. Yenileme teklifinizi hazırlamamı ister misiniz?'},
  {title:'Ödeme hatırlatma', text:'Sayın {ad}, {tur} poliçenize ait {kalan} tutarında ödemeniz bulunmaktadır. Bilginize sunarız.'},
  {title:'Teşekkür', text:'Sayın {ad}, {tur} poliçeniz düzenlenmiştir. Bizi tercih ettiğiniz için teşekkür ederiz.'},
];
const settings = () => misc.get('s:settings') || {id:'s:settings', kind:'settings', templates: DEF_TPL, signature:''};
function fillTpl(text, p) {
  const v = {ad:p.name, tur:p.type, sirket:p.company, policeNo:p.policyNo, baslangic:p.start ? fmtDate(p.start) : '', bitis:p.end ? fmtDate(p.end) : '',
    gun: daysLeft(p) ?? '', prim: typeof p.premium === 'number' ? money(p.premium) : '', plaka:p.plate, kalan: money(debt(p))};
  let out = text.replace(/\{(\w+)\}/g, (m, k) => k in v ? String(v[k] ?? '') : m).replace(/[ \t]{2,}/g, ' ').replace(/^.*:\s*$/gm, '').replace(/\n{2,}/g, '\n').trim();
  const sig = settings().signature; if (sig) out += '\n' + sig;
  return out;
}

/* ---------- boot ---------- */
async function boot() {
  renderAll();
  try {
    await idb.open(); policies = (await idb.all('policies')) || [];
    for (const r of await idb.all('misc')) misc.set(r.id, r);
    st.mode = 'idb';
  } catch { st.mode = 'mem'; }
  st.loaded = true; renderAll();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- policies list ---------- */
function visible() {
  const q = low($('#q').value.trim()), ft = $('#fType').value, fs = $('#fStatus').value, so = $('#sort').value;
  const a = policies.filter(p => {
    if (ft && p.type !== ft) return false;
    if (fs && status(p).key !== fs) return false;
    if (!q) return true;
    return [p.name, p.policyNo, p.company, p.plate, p.type].some(v => low(v).includes(q));
  });
  return a.sort({
    end: (x, y) => (x.end || '9999').localeCompare(y.end || '9999'),
    name: (x, y) => String(x.name).localeCompare(String(y.name), 'tr'),
    new: (x, y) => (y.createdAt || 0) - (x.createdAt || 0),
    premium: (x, y) => (y.premium || 0) - (x.premium || 0),
  }[so]);
}
const polCard = (p, extra = '') => { const s = status(p), d = debt(p); return `
  <button class="card${st.selected.has(p.id) ? ' sel' : ''}" type="button" data-act="pol" data-id="${esc(p.id)}">
    <span class="nm">${esc(p.name || 'İsimsiz')}${p.sample ? '<span class="tag">Örnek</span>' : ''}</span>
    <span class="badge ${s.key}">${esc(s.label)}</span>
    <span class="sub"><b>${esc(p.type || 'Diğer')}</b> · ${esc(p.company || 'Şirket belirtilmedi')}${p.plate ? ' · ' + esc(p.plate) : ''}</span>
    <span class="sub">Bitiş: ${esc(fmtDate(p.end))}${d ? ` · <b style="color:var(--${overdue(p) ? 'crit' : 'warn'})">Kalan ${esc(money(d))}</b>` : ''}${extra}</span>
  </button>`; };
function renderList() {
  const n = $('#notice');
  const msg = st.mode === 'mem' ? 'Bu tarayıcı kayıt saklamaya izin vermiyor (gizli sekme olabilir). Eklediğiniz poliçeler sayfa kapanınca silinir.' : '';
  n.textContent = msg; n.hidden = !msg;
  const ins = $('#install'), standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  ins.hidden = standalone || !/iPhone|iPad|iPod/.test(navigator.userAgent);
  ins.textContent = 'iPhone\'a kurmak için Safari\'de alttaki Paylaş düğmesine, sonra "Ana Ekrana Ekle"ye dokunun. Kurulunca internetsiz çalışır.';

  const list = $('#list'), a = visible();
  $('#count').textContent = st.loaded ? `Toplam ${a.length} poliçe` : '';
  $('#selBtn').classList.toggle('on', st.selecting);
  $('#bulk').hidden = !st.selecting;
  $('#bulkCount').textContent = `${st.selected.size} seçildi`;
  $('#bulkDel').disabled = !st.selected.size;
  if (!st.loaded) { list.innerHTML = `<div class="empty"><div class="spin"></div><p>Poliçeler yükleniyor…</p></div>`; return; }
  if (!policies.length) {
    list.innerHTML = `<div class="empty"><h2>Henüz poliçe yok</h2>
      <p>Bir poliçe PDF'i yükleyin, içindeki bilgiler otomatik doldurulsun. Elinizde Excel listesi varsa hepsini tek seferde aktarabilirsiniz.</p>
      <div class="row"><button class="btn pri" data-act="add-pdf">${ic('up')}PDF ile ekle</button>
      <button class="btn" data-act="add-man">Elle ekle</button><button class="btn" data-act="import">Excel'den aktar</button><button class="btn" data-act="samples">Örnek verileri yükle</button></div></div>`;
    return;
  }
  list.innerHTML = a.length ? a.map(p => polCard(p)).join('')
    : `<div class="empty"><p>Bu aramaya veya filtreye uyan poliçe yok.</p><button class="btn" data-act="clear">Filtreleri temizle</button></div>`;
}

/* ---------- customers ---------- */
function customers() {
  const m = new Map();
  const get = name => { const k = ckey(name); if (!k) return null; if (!m.has(k)) m.set(k, {key:k, name:String(name).trim(), pols:[], info:misc.get('c:' + k) || {}}); return m.get(k); };
  for (const p of policies) { const c = get(p.name || ''); if (c) c.pols.push(p); }
  for (const r of kindOf('customer')) { const c = get(r.name); if (c) c.name = r.name; }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}
function renderCustomers() {
  const q = low($('#cq').value.trim());
  const all = customers(), a = all.filter(c => !q || [c.name, c.info.phone, c.info.tc, ...c.pols.map(p => p.phone)].some(v => low(v).includes(q)));
  $('#custNames').innerHTML = all.map(c => `<option value="${esc(c.name)}">`).join('');
  $('#ccount').textContent = st.loaded ? `${a.length} müşteri` : '';
  $('#clist').innerHTML = a.length ? a.map(c => {
    const d = r2(c.pols.reduce((s, p) => s + debt(p), 0)), live = c.pols.filter(p => (daysLeft(p) ?? -1) >= 0).length;
    const ph = c.info.phone || (c.pols.find(p => p.phone) || {}).phone || '';
    return `<button class="card" type="button" data-act="cust" data-key="${esc(c.key)}">
      <span class="nm">${esc(c.name)}</span>${d ? `<span class="badge ${c.pols.some(overdue) ? 'crit' : 'warn'}">Borç ${esc(money(d))}</span>` : `<span class="badge none">${c.pols.length} poliçe</span>`}
      <span class="sub">${esc(ph || 'Telefon yok')} · ${live} yürürlükte, toplam ${c.pols.length} poliçe</span></button>`; }).join('')
    : `<div class="empty"><p>${all.length ? 'Bu aramaya uyan müşteri yok.' : 'Poliçe eklediğinizde müşteriler burada kendiliğinden oluşur. İsterseniz önce müşteriyi kaydedebilirsiniz.'}</p></div>`;
}
const waNum = ph => { let n = String(ph || '').replace(/\D/g, ''); if (n.length === 11 && n.startsWith('0')) n = '9' + n; else if (n.length === 10) n = '90' + n; return n.length >= 11 ? n : ''; };
const telHref = ph => 'tel:' + String(ph || '').replace(/[^\d+]/g, '');
const contactBtns = ph => ph ? `<div class="row3"><a class="btn" href="${esc(telHref(ph))}">${ic('phone')}Ara</a>
  <a class="btn" href="https://wa.me/${waNum(ph)}" target="_blank" rel="noopener">WhatsApp</a>
  <a class="btn" href="sms:${esc(String(ph).replace(/[^\d+]/g, ''))}">${ic('msg')}SMS</a></div>` : '';
function openCustomer(key) {
  const c = customers().find(x => x.key === key); if (!c) return closeSheet();
  const i = c.info, ph = i.phone || (c.pols.find(p => p.phone) || {}).phone || '';
  const row = (l, v) => v ? `<div><small>${l}</small><span>${esc(v)}</span></div>` : '';
  const tot = r2(c.pols.filter(p => (daysLeft(p) ?? -1) >= 0).reduce((s, p) => s + (p.premium || 0), 0)), d = r2(c.pols.reduce((s, p) => s + debt(p), 0));
  const qs = kindOf('quote').filter(x => ckey(x.name) === key), hs = kindOf('claim').filter(x => ckey(x.name) === key);
  openSheet('Müşteri kartı', `<h2 style="overflow-wrap:anywhere">${esc(c.name)}</h2>
    ${contactBtns(ph)}
    <div class="dl">${row('Telefon', ph) || '<div><small>Telefon</small><span>—</span></div>'}${row('T.C. / Vergi no', i.tc)}${row('E-posta', i.email)}${row('Adres', i.address)}${row('Not', i.note)}
      <div><small>Yürürlükteki poliçelerin primi</small><span>${esc(money(tot))}</span></div>${d ? `<div><small>Kalan borç</small><span style="color:var(--crit)">${esc(money(d))}</span></div>` : ''}</div>
    <h3>Poliçeler (${c.pols.length})</h3>
    ${c.pols.sort((a, b) => (b.end || '').localeCompare(a.end || '')).map(p => polCard(p)).join('') || '<p class="mut">Kayıtlı poliçe yok.</p>'}
    <button class="btn pri block" data-act="add-for" data-key="${esc(key)}">${ic('plus')}Bu müşteriye poliçe ekle</button>
    ${qs.length ? `<h3>Teklifler</h3>${qs.map(itemCard).join('')}` : ''}${hs.length ? `<h3>Hasar dosyaları</h3>${hs.map(itemCard).join('')}` : ''}`,
    `<button class="iconbtn plain" data-act="cust-edit" data-key="${esc(key)}" aria-label="Düzenle">${ic('edit')}</button>`);
}

/* ---------- generic small forms (customer, quote, claim) ---------- */
const SPEC = {
  customer: {title:'Müşteri', fields:[['name','Ad soyad / unvan','text'],['phone','Telefon','tel',0,1],['tc','T.C. / Vergi no','text',0,1],['email','E-posta','email'],['address','Adres','area'],['note','Not','area']]},
  quote: {title:'Teklif', fields:[['name','Müşteri','name'],['type','Tür','select',TYPES.map(t => [t, t]),1],['amount','Teklif tutarı (₺)','money',0,1],['company','Sigorta şirketi','text'],['date','Tarih','date',0,1],['status','Durum','select',QSTAT,1],['note','Not','area']]},
  claim: {title:'Hasar dosyası', fields:[['name','Müşteri','name'],['fileNo','Dosya no','text',0,1],['policyNo','Poliçe no','text',0,1],['date','Hasar tarihi','date',0,1],['amount','Tutar (₺)','money',0,1],['status','Durum','select',CSTAT],['desc','Açıklama','area'],['note','Not','area']]},
};
let item = null;
function openItem(kind, rec = {}) {
  const sp = SPEC[kind], edit = !!rec.id || (kind === 'customer' && !!rec.name);
  const inp = ([k, label, type, opts, half]) => {
    const v = rec[k], id = 'x-' + k;
    const el = type === 'select' ? `<select id="${id}">${opts.map(o => `<option value="${esc(o[0])}"${(v || opts[0][0]) === o[0] ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`
      : type === 'area' ? `<textarea id="${id}" rows="2">${esc(v)}</textarea>`
      : `<input id="${id}" ${type === 'date' ? 'type="date"' : type === 'tel' ? 'type="tel"' : type === 'email' ? 'type="email"' : type === 'money' ? 'inputmode="decimal"' : type === 'name' ? 'list="custNames"' : ''} autocomplete="off" value="${esc(type === 'money' && typeof v === 'number' ? nf.format(v) : (v ?? (type === 'date' && !edit ? iso(today()) : '')))}">`;
    return `<div class="fld${half ? ' half' : ''}"><label for="${id}">${label}</label>${el}</div>`;
  };
  item = {kind, rec};
  openSheet(edit ? sp.title + ' düzenle' : 'Yeni ' + low(sp.title), `<form class="pf" data-form="item" novalidate>${sp.fields.map(inp).join('')}
    <p class="full" id="formErr" style="margin:0;color:var(--crit)" hidden></p>
    <button class="btn pri block full" type="submit">Kaydet</button>
    ${kind === 'quote' && edit ? `<button class="btn block full" type="button" data-act="quote-pol" data-id="${esc(rec.id)}">Poliçeye çevir</button>` : ''}
    ${edit && kind !== 'customer' ? `<button class="btn danger block full" type="button" data-act="item-del" data-id="${esc(rec.id)}">Sil</button>` : ''}</form>`);
}
async function submitItem() {
  const {kind, rec} = item, sp = SPEC[kind], out = {...rec, kind}, err = $('#formErr');
  for (const [k, , type] of sp.fields) {
    const raw = $('#x-' + k).value.trim();
    if (type === 'money') { const n = raw ? parseMoney(raw) : null; if (raw && n === null) { err.textContent = 'Tutarı sayı olarak yazın, örneğin 12.480,00.'; err.hidden = false; return; } if (n === null) delete out[k]; else out[k] = n; }
    else out[k] = raw;
  }
  if (!out.name) { err.textContent = 'Adı yazın.'; err.hidden = false; return; }
  try {
    if (kind === 'customer') {
      const oldKey = rec.name ? ckey(rec.name) : '', nk = ckey(out.name);
      out.id = 'c:' + nk;
      if (oldKey && oldKey !== nk) {                                   // rename: carry the policies, quotes and claims along
        for (const p of policies.filter(p => ckey(p.name) === oldKey)) await savePolicy(p.id, {...p, name: out.name}, true);
        for (const r of [...misc.values()].filter(r => (r.kind === 'quote' || r.kind === 'claim') && ckey(r.name) === oldKey)) await putMisc({...r, name: out.name}, true);
        if (misc.has('c:' + oldKey)) await delMisc('c:' + oldKey);
      }
      await putMisc(out); toast('Müşteri kaydedildi'); openCustomer(nk);
    } else {
      out.id = rec.id || (kind === 'quote' ? 'q:' : 'h:') + newId(); out.createdAt = rec.createdAt || Date.now();
      await putMisc(out); closeSheet(); toast('Kaydedildi');
    }
  } catch (e) { writeErr(e); }
}
function itemCard(r) {
  const q = r.kind === 'quote', s = lbl(q ? QSTAT : CSTAT, r.status);
  return `<button class="card" type="button" data-act="item" data-id="${esc(r.id)}"><span class="nm">${esc(r.name)}</span><span class="badge ${s[2]}">${esc(s[1])}</span>
    <span class="sub">${q ? `<b>${esc(r.type || '')}</b> · ${esc(r.company || 'Şirket belirtilmedi')}` : `Dosya ${esc(r.fileNo || '—')}${r.desc ? ' · ' + esc(r.desc) : ''}`}</span>
    <span class="sub">${esc(fmtDate(r.date))}${typeof r.amount === 'number' ? ' · ' + esc(money(r.amount)) : ''}</span></button>`;
}

/* ---------- takip ---------- */
const renewList = () => policies.filter(p => { const d = daysLeft(p); return d !== null && d <= 45 && d >= -30 && !['yenilendi', 'kaybedildi'].includes(p.renewal); }).sort((a, b) => a.end.localeCompare(b.end));
const debtList = () => policies.filter(p => debt(p) > 0).sort((a, b) => unpaid(a)[0].due.localeCompare(unpaid(b)[0].due));
function renderTakip() {
  document.querySelectorAll('#tseg button').forEach(b => b.classList.toggle('on', b.dataset.t === st.takip));
  const el = $('#tbody'), t = st.takip;
  if (t === 'yen') {
    const a = renewList();
    el.innerHTML = `<p class="mut">Bitişine 45 gün kalan ve son 30 günde süresi dolan poliçeler. Yenilendi ya da kaybedildi işaretlenenler listeden çıkar.</p>` +
      (a.length ? a.map(p => { const s = status(p), ph = phoneOf(p); return `<div class="tcard">
        <button class="card flat" type="button" data-act="pol" data-id="${esc(p.id)}"><span class="nm">${esc(p.name)}</span><span class="badge ${s.key}">${esc(s.label)}</span>
          <span class="sub"><b>${esc(p.type)}</b> · ${esc(p.company || '')}${p.plate ? ' · ' + esc(p.plate) : ''} · Bitiş ${esc(fmtDate(p.end))}</span></button>
        <div class="trow"><select class="pill" data-ch="renew" data-id="${esc(p.id)}" aria-label="Yenileme durumu">${RENEW.map(r => `<option value="${r[0]}"${(p.renewal || '') === r[0] ? ' selected' : ''}>${r[1]}</option>`).join('')}</select>
          ${ph ? `<a class="btn sm" href="${esc(telHref(ph))}">${ic('phone')}Ara</a>` : ''}
          <button class="btn sm" data-act="msg" data-id="${esc(p.id)}" data-tpl="1">${ic('msg')}Mesaj</button>
          <button class="btn sm pri" data-act="renew" data-id="${esc(p.id)}">Yenile</button></div></div>`; }).join('')
        : `<div class="empty"><p>Şu an aranacak yenileme yok.</p></div>`);
  } else if (t === 'tah') {
    const a = debtList(), tot = r2(a.reduce((s, p) => s + debt(p), 0)), late = r2(a.reduce((s, p) => s + overdue(p), 0));
    el.innerHTML = `<div class="kpis two"><div class="kpi"><small>Toplam alacak</small><strong>${esc(money(tot))}</strong></div>
      <div class="kpi"><small>Vadesi geçmiş</small><strong style="color:var(--${late ? 'crit' : 'ink'})">${esc(money(late))}</strong></div></div>` +
      (a.length ? a.map(p => { const u = unpaid(p)[0], od = overdue(p); return `<div class="tcard">
        <button class="card flat" type="button" data-act="pol" data-id="${esc(p.id)}"><span class="nm">${esc(p.name)}</span><span class="badge ${od ? 'crit' : 'warn'}">${od ? 'Gecikmiş' : 'Bekliyor'}</span>
          <span class="sub"><b>${esc(p.type)}</b> · Kalan ${esc(money(debt(p)))} · ${unpaid(p).length} ödeme</span>
          <span class="sub">Sıradaki: ${esc(fmtDate(u.due))} · ${esc(money(u.amount))}</span></button>
        <div class="trow"><button class="btn sm pri" data-act="pay-next" data-id="${esc(p.id)}">Sıradakini ödendi işaretle</button>
          <button class="btn sm" data-act="msg" data-id="${esc(p.id)}" data-tpl="2">${ic('msg')}Hatırlat</button></div></div>`; }).join('')
        : `<div class="empty"><p>Tahsil edilecek ödeme yok. Poliçe eklerken ödeme şeklini "tahsil edilecek" ya da taksitli seçtiğinizde burada görünür.</p></div>`);
  } else {
    const q = t === 'tek', a = kindOf(q ? 'quote' : 'claim').sort((x, y) => (y.date || '').localeCompare(x.date || ''));
    el.innerHTML = `<button class="btn pri block" data-act="${q ? 'quote-new' : 'claim-new'}">${ic('plus')}${q ? 'Yeni teklif' : 'Yeni hasar dosyası'}</button>` +
      (a.length ? a.map(itemCard).join('') : `<div class="empty"><p>${q ? 'Verdiğiniz teklifleri buraya yazın; kabul edileni tek dokunuşla poliçeye çevirirsiniz.' : 'Açılan hasar dosyalarını ve durumlarını buradan izleyin.'}</p></div>`);
  }
  const dot = renewList().length + policies.filter(overdue).length;
  $('#navDot').hidden = !dot; $('#navDot').textContent = dot > 99 ? '99+' : dot;
}

/* ---------- reports ---------- */
function renderStats() {
  const el = $('#stats');
  if (!policies.length) { el.innerHTML = `<div class="empty"><p>Poliçe eklediğinizde kazanç, üretim ve yenileme raporları burada görünür.</p></div>`; return; }
  const t0 = today(), when = p => pd(p.start) || new Date(p.createdAt || Date.now());
  const live = policies.filter(p => (daysLeft(p) ?? -1) >= 0), soon = live.filter(p => daysLeft(p) <= 30);
  const inM = (p, y, m) => { const d = when(p); return d.getFullYear() === y && d.getMonth() === m; };
  const mo = policies.filter(p => inM(p, t0.getFullYear(), t0.getMonth())), yr = policies.filter(p => when(p).getFullYear() === t0.getFullYear());
  const sum = (a, f) => r2(a.reduce((s, p) => s + (f(p) || 0), 0)), prem = p => p.premium;
  const months = [], ends = [];
  for (let i = 5; i >= 0; i--) { const m = new Date(t0.getFullYear(), t0.getMonth() - i, 1); months.push([`${MONTHS[m.getMonth()]} ${String(m.getFullYear()).slice(2)}`, sum(policies.filter(p => inM(p, m.getFullYear(), m.getMonth())), comm)]); }
  for (let i = 0; i < 6; i++) { const m = new Date(t0.getFullYear(), t0.getMonth() + i, 1); ends.push([`${MONTHS[m.getMonth()]} ${String(m.getFullYear()).slice(2)}`, policies.filter(p => { const d = pd(p.end); return d && d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth(); }).length]); }
  const byType = TYPES.map(t => [t, policies.filter(p => (p.type || 'Diğer') === t).length]).filter(x => x[1]);
  const comp = {}; yr.forEach(p => { const k = p.company || 'Belirtilmedi'; (comp[k] = comp[k] || []).push(p); });
  const bars = (rows, fmt) => { const max = Math.max(...rows.map(x => x[1]), 1); return rows.map(([l, v]) => `<div class="bar${fmt ? ' wide' : ''}"><span>${esc(l)}</span><div class="trk"><i style="width:${v / max * 100}%"></i></div><span>${fmt ? esc(nf.format(v)) : v}</span></div>`).join(''); };
  const kpi = (l, v) => `<div class="kpi"><small>${l}</small><strong>${esc(v)}</strong></div>`;
  el.innerHTML = `
    <div class="kpis">${kpi('Toplam poliçe', policies.length)}${kpi('Yürürlükte', live.length)}${kpi('30 günde bitecek', soon.length)}${kpi('Müşteri', customers().length)}</div>
    <div class="panel"><h3>Kazanç ve üretim</h3><div class="kpis two">
      ${kpi('Bu ay komisyon', money(sum(mo, comm)))}${kpi('Bu yıl komisyon', money(sum(yr, comm)))}${kpi('Bu ay prim üretimi', money(sum(mo, prem)))}${kpi('Bu yıl prim üretimi', money(sum(yr, prem)))}</div>
      <p class="mut">Poliçenin başlangıç tarihine göre hesaplanır. Komisyon girilmemiş poliçeler 0 sayılır.</p></div>
    <div class="panel"><h3>Son 6 ay komisyon (₺)</h3>${bars(months, 1)}</div>
    <div class="panel"><h3>Bu yıl şirketlere göre</h3><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Şirket</th><th>Adet</th><th>Prim</th><th>Komisyon</th></tr></thead><tbody>
      ${Object.entries(comp).sort((a, b) => sum(b[1], prem) - sum(a[1], prem)).map(([k, a]) => `<tr><td>${esc(k)}</td><td>${a.length}</td><td>${esc(nf.format(sum(a, prem)))}</td><td>${esc(nf.format(sum(a, comm)))}</td></tr>`).join('') || '<tr><td colspan="4">Bu yıl başlayan poliçe yok.</td></tr>'}
      </tbody></table></div></div>
    <div class="panel"><h3>Türe göre poliçe sayısı</h3>${bars(byType)}</div>
    <div class="panel"><h3>Aylara göre biten poliçe sayısı</h3>${bars(ends)}</div>`;
}

function renderAll() {
  renderList(); renderCustomers(); renderTakip();
  if (st.tab === 'raporlar') renderStats();
}
const TABS = ['policeler', 'musteriler', 'takip', 'raporlar'];
function route() {
  const h = location.hash.slice(1);
  st.tab = TABS.includes(h) ? h : 'policeler';
  for (const t of TABS) $('#v-' + t).hidden = t !== st.tab;
  document.querySelectorAll('.nav a').forEach(a => a.dataset.tab === st.tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  if (st.tab === 'raporlar') renderStats();
  window.scrollTo(0, 0);
}

/* ---------- sheet & modal ---------- */
let sheetToken = 0, form = null;
function openSheet(title, body, actions = '') {
  sheetToken++; form = null;
  $('#sheetTitle').textContent = title; $('#sheetBody').innerHTML = body; $('#sheetActions').innerHTML = actions;
  $('#sheet').hidden = false; $('#sheetBody').scrollTop = 0;
}
function closeSheet() { sheetToken++; $('#sheet').hidden = true; $('#sheetBody').innerHTML = ''; form = null; item = null; }
function modal(html, ready) {
  return new Promise(res => {
    const m = $('#modal'), c = $('#modalCard');
    c.innerHTML = html; m.hidden = false; if (ready) ready(c);
    const done = v => { m.hidden = true; m.onclick = null; c.onchange = null; res(v); };
    m.onclick = e => { if (e.target === m) return done(null); const b = e.target.closest('[data-m]'); if (b) done(b.dataset.m); };
  });
}
const confirmBox = (msg, ok = 'Sil') => modal(`<h2>Emin misiniz?</h2><p>${esc(msg)}</p>
  <div class="row" style="justify-content:flex-end"><button class="btn" data-m="">Vazgeç</button><button class="btn danger" data-m="ok">${esc(ok)}</button></div>`).then(v => v === 'ok');

/* ---------- policy detail ---------- */
function openDetail(id) {
  const p = policies.find(x => x.id === id); if (!p) return closeSheet();
  const s = status(p), ph = phoneOf(p), c = comm(p), ins = p.installments || [];
  const row = (l, v) => `<div><small>${l}</small><span>${esc(v || '—')}</span></div>`;
  openSheet('Poliçe detayı', `
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:start"><h2 style="overflow-wrap:anywhere;min-width:0">${esc(p.name)}</h2><span class="badge ${s.key}">${esc(s.label)}</span></div>
    ${contactBtns(ph)}
    <div class="dl">${row('Poliçe türü', p.type)}${row('Sigorta şirketi', p.company)}${row('Poliçe numarası', p.policyNo)}
      ${row('Başlangıç tarihi', fmtDate(p.start))}${row('Bitiş tarihi', fmtDate(p.end))}${row('Toplam prim', money(p.premium))}
      ${c ? row('Komisyon', money(c) + (p.commRate ? ` (%${String(p.commRate).replace('.', ',')})` : '')) : ''}
      ${p.plate ? row('Plaka', p.plate) : ''}${ph ? row('Telefon', ph) : ''}${p.note ? row('Not', p.note) : ''}</div>
    ${ins.length ? `<div class="panel"><h3>Ödemeler · kalan ${esc(money(debt(p)))}</h3>${ins.map((x, i) => `<div class="inst"><span>${ins.length > 1 ? `${i + 1}. taksit · ` : ''}${esc(fmtDate(x.due))}<br><b>${esc(money(x.amount))}</b></span>
      <button class="btn sm${x.paid ? '' : ' pri'}" data-act="pay" data-id="${esc(p.id)}" data-i="${i}">${x.paid ? 'Ödendi ✓' : 'Ödendi işaretle'}</button></div>`).join('')}</div>` : ''}
    <div class="panel"><h3>Yenileme</h3><div class="trow"><select class="pill" data-ch="renew" data-id="${esc(p.id)}" aria-label="Yenileme durumu">${RENEW.map(r => `<option value="${r[0]}"${(p.renewal || '') === r[0] ? ' selected' : ''}>${r[1]}</option>`).join('')}</select>
      <button class="btn sm pri" data-act="renew" data-id="${esc(p.id)}">Yenile (yeni poliçe aç)</button></div></div>
    ${p.fileId ? `<div class="file">${ic('doc')}<span>${esc(p.fileName || 'Poliçe dosyası')}</span><button class="btn sm" data-act="dl" data-id="${esc(p.id)}">${ic('down')}Aç</button></div>` : ''}
    <button class="btn pri block" data-act="msg" data-id="${esc(p.id)}" data-tpl="0">${ic('share')}Müşteriye gönder</button>
    <button class="btn block" data-act="cust" data-key="${esc(ckey(p.name))}">${ic('user')}Müşteri kartı</button>
    <button class="btn danger block" data-act="del" data-id="${esc(p.id)}">Poliçeyi sil</button>`,
    `<button class="iconbtn plain" data-act="msg" data-id="${esc(p.id)}" data-tpl="0" aria-label="Gönder">${ic('share')}</button>
     <button class="iconbtn plain" data-act="edit" data-id="${esc(p.id)}" aria-label="Düzenle">${ic('edit')}</button>`);
}
const fileExt = p => p.fileType === 'application/pdf' ? 'pdf' : p.fileType === 'image/png' ? 'png' : p.fileType === 'image/webp' ? 'webp' : 'jpg';
const clean = s => String(s || '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
async function getFile(p) {
  if (!p.fileId || !on()) return null;
  const r = await idb.get('files', p.fileId); if (!r) return null;
  return new File([r.buf], `${clean(p.name) || 'police'}_${clean(p.type) || 'Police'}.${fileExt(p)}`, {type: r.type});
}
async function downloadFile(p) {
  try { const f = await getFile(p); if (!f) return toast('Dosya bulunamadı.'); await saveFile(f); }
  catch (e) { if (!e || e.code !== 'declined') toast('Dosya açılamadı.'); }
}
async function sendMsg(p, tplIdx) {
  const tpls = settings().templates, ph = phoneOf(p);
  let text = fillTpl((tpls[tplIdx] || tpls[0] || DEF_TPL[0]).text, p);
  const file = await getFile(p).catch(() => null);          // read before the tap so the share sheet opens straight from it
  const canFile = file && touch() && navigator.canShare && navigator.canShare({files:[file]});
  const links = c => { const enc = encodeURIComponent(text);
    $('#shareTxt', c).textContent = text;
    $('[data-m="wa"]', c).href = `https://wa.me/${waNum(ph)}?text=${enc}`;
    $('[data-m="mail"]', c).href = `mailto:${encodeURIComponent(custInfo(p.name).email || '')}?subject=${encodeURIComponent((p.type || '') + ' poliçeniz')}&body=${enc}`;
    $('[data-m="sms"]', c).href = `sms:${String(ph).replace(/[^\d+]/g, '')}&body=${enc}`; };
  const v = await modal(`<h2>Müşteriye gönder</h2>
    <select class="pill" id="tplSel" aria-label="Mesaj şablonu">${tpls.map((t, i) => `<option value="${i}"${i === +tplIdx ? ' selected' : ''}>${esc(t.title)}</option>`).join('')}</select>
    <pre id="shareTxt"></pre>
    ${canFile ? `<button class="btn pri" data-m="file">${ic('share')}Poliçe dosyasıyla gönder</button>` : ''}
    <a class="btn${canFile ? '' : ' pri'}" target="_blank" rel="noopener" data-m="wa">WhatsApp'ta yaz</a>
    <div class="row3"><a class="btn" data-m="mail">E-posta</a><a class="btn" data-m="sms">SMS</a><button class="btn" data-m="copy">Kopyala</button></div>
    ${file && !canFile ? `<button class="btn" data-m="dl">${ic('down')}Poliçe dosyasını indir</button>` : ''}
    <button class="btn" data-m="">Kapat</button>`, c => { links(c); c.onchange = e => { if (e.target.id === 'tplSel') { text = fillTpl(tpls[+e.target.value].text, p); links(c); } }; });
  try {
    if (v === 'file') await navigator.share({files:[file], text});
    else if (v === 'dl') await saveFile(file);
    else if (v === 'copy') { await navigator.clipboard.writeText(text); toast('Metin kopyalandı'); }
  } catch (e) { if (v === 'copy') toast('Kopyalanamadı. Metni seçip elle kopyalayın.'); }
}

/* ---------- policy form ---------- */
function formHTML(p) {
  const v = k => esc(p[k] ?? ''), num = k => typeof p[k] === 'number' ? esc(nf.format(p[k])) : '';
  const f = (id, label, input, half) => `<div class="fld${half ? ' half' : ''}"><label for="f-${id}">${label}</label>${input}</div>`;
  const plan = p.payPlan ?? (p.id ? '' : 'paid');
  return `<form class="pf" data-form="policy" id="pForm" novalidate>
    ${f('name', 'Sigortalı adı', `<input id="f-name" list="custNames" value="${v('name')}" autocomplete="off">`)}
    ${f('type', 'Poliçe türü', `<select id="f-type">${TYPES.map(t => `<option${(p.type || 'Kasko') === t ? ' selected' : ''}>${t}</option>`).join('')}</select>`, 1)}
    ${f('plate', 'Plaka (varsa)', `<input id="f-plate" value="${v('plate')}" autocomplete="off">`, 1)}
    ${f('company', 'Sigorta şirketi', `<input id="f-company" value="${v('company')}" autocomplete="off">`)}
    ${f('no', 'Poliçe numarası', `<input id="f-no" value="${v('policyNo')}" autocomplete="off">`)}
    ${f('start', 'Başlangıç tarihi', `<input id="f-start" type="date" value="${v('start')}">`, 1)}
    ${f('end', 'Bitiş tarihi', `<input id="f-end" type="date" value="${v('end')}">`, 1)}
    ${f('premium', 'Toplam prim (₺)', `<input id="f-premium" inputmode="decimal" value="${num('premium')}" autocomplete="off">`, 1)}
    ${f('plan', 'Ödeme', `<select id="f-plan">${PLANS.map(o => `<option value="${o[0]}"${plan === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>`, 1)}
    ${f('rate', 'Komisyon oranı (%)', `<input id="f-rate" inputmode="decimal" value="${p.commRate ? esc(String(p.commRate).replace('.', ',')) : ''}" autocomplete="off">`, 1)}
    ${f('comm', 'Komisyon tutarı (₺)', `<input id="f-comm" inputmode="decimal" value="${num('commission')}" placeholder="Orandan hesaplanır" autocomplete="off">`, 1)}
    ${f('phone', 'Müşteri telefonu', `<input id="f-phone" type="tel" value="${esc(p.phone || (p.name ? custInfo(p.name).phone : '') || '')}" autocomplete="off">`)}
    ${f('note', 'Not', `<textarea id="f-note" rows="2">${v('note')}</textarea>`)}
    <div class="full" id="fileRow"></div>
    <p class="full" id="formErr" style="margin:0;color:var(--crit)" hidden></p>
    <button class="btn pri block full" id="saveBtn" type="submit">Poliçeyi kaydet</button>
  </form>`;
}
function renderFileRow() {
  const el = $('#fileRow'); if (!el || !form) return;
  const name = form.file ? form.file.name : (form.base.fileId && !form.removeFile ? (form.base.fileName || 'Poliçe dosyası') : '');
  el.innerHTML = name ? `<div class="file">${ic('doc')}<span>${esc(name)}</span><button class="btn sm" type="button" data-act="rm-file">Kaldır</button></div>`
    : on() ? `<button class="btn block" type="button" data-act="pick">${ic('up')}Poliçe dosyası ekle (PDF veya fotoğraf)</button>` : '';
}
function openForm(p, mode, extra) {
  const edit = !!(p && p.id);
  const upload = `<div class="seg" id="seg"><button type="button" data-mode="pdf">PDF ile yükle</button><button type="button" data-mode="man">Elle ekle</button></div>
    <div class="up" id="upCard">${ic('doc')}<h3>Poliçe dosyasını yükleyin</h3><p>PDF ya da poliçenin fotoğrafı, en fazla 30 MB.</p>
      <button class="btn pri" type="button" data-act="pick">${ic('up')}Dosya seç</button></div>
    <div class="hint" id="aiHint">${ic('spark')}<span>PDF'in içindeki yazıdan bulunan alanlar otomatik doldurulur. Kaydetmeden önce siz kontrol edersiniz.</span></div>`;
  openSheet(edit ? 'Poliçeyi düzenle' : 'Yeni poliçe ekle',
    `${edit ? '' : upload}<input type="file" id="fileIn" accept="application/pdf,image/jpeg,image/png,image/webp" hidden>${formHTML(p || {})}`);
  form = {id: edit ? p.id : null, base: p || {}, file:null, removeFile:false, token:sheetToken, ...extra};
  renderFileRow();
  if (!edit) setMode(mode || 'pdf');
}
function setMode(m) {
  document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  const pdf = m === 'pdf';
  $('#upCard').hidden = !pdf; $('#aiHint').hidden = !pdf; $('#pForm').hidden = pdf && !form.file;
}
function aiMsg(text, busy) {
  const h = $('#aiHint'); if (!h) return;
  h.hidden = false; h.innerHTML = `${busy ? '<div class="spin"></div>' : ic('spark')}<span>${esc(text)}</span>`;
}
async function readPdf(file) {
  if (!window.pdfjsLib) throw new Error('nopdf');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
  const pdf = await window.pdfjsLib.getDocument({data: await file.arrayBuffer()}).promise;
  let text = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 6); i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    text += tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  return text;
}
const KINDS = [['dask','DASK'],['zorunlu deprem','DASK'],['kasko','Kasko'],['zorunlu mali','Trafik'],['trafik','Trafik'],['sağlık','Sağlık'],['saglik','Sağlık'],['seyahat','Seyahat'],['işyeri','İşyeri'],['iş yeri','İşyeri'],['isyeri','İşyeri'],['konut','Konut']];
const kindFrom = s => { const L = low(s), k = KINDS.map(([w, n]) => [L.indexOf(w), n]).filter(x => x[0] >= 0).sort((a, b) => a[0] - b[0])[0]; return k ? k[1] : null; };
// Best-effort field finder for Turkish policy text. Works on the device, no internet.
function guess(text) {
  const t = text.replace(/[ \t]+/g, ' '), out = {};
  const D = '(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4})';
  const toIso = m => { const d = +m[0], mo = +m[1], y = +m[2]; return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y > 1990 && y < 2100 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; };
  const after = label => { const m = new RegExp(label + '[^\\d\\n]{0,25}' + D, 'i').exec(t); return m ? toIso(m.slice(1)) : null; };
  out.start = after('ba[şs]lang[ıi][çc]'); out.end = after('biti[şs]');
  if (!out.start || !out.end) {
    const all = [...t.matchAll(new RegExp(D, 'g'))].map(m => toIso(m.slice(1))).filter(Boolean);
    const pair = all.find(a => all.includes(`${+a.slice(0, 4) + 1}${a.slice(4)}`));
    if (pair) { out.start = out.start || pair; out.end = out.end || `${+pair.slice(0, 4) + 1}${pair.slice(4)}`; }
  }
  let m = /poli[çc]e\s*(?:no|numaras[ıi])\s*[:.]?\s*([A-Z0-9][A-Z0-9\-\/]{3,24})/i.exec(t); if (m) out.policyNo = m[1];
  m = /(?:[öo]denecek\s*(?:toplam\s*)?(?:prim|tutar)|toplam\s*(?:br[üu]t\s*)?prim|br[üu]t\s*prim|toplam\s*tutar)[^\d\n]{0,20}(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/i.exec(t);
  if (m) out.premium = m[1];
  m = /plaka[^\n]{0,20}?\b(0[1-9]|[1-7]\d|8[01])\s?([A-ZÇĞİÖŞÜ]{1,3})\s?(\d{2,4})\b/i.exec(t) || /\b(0[1-9]|[1-7]\d|8[01]) ([A-ZÇĞİÖŞÜ]{1,3}) (\d{2,4})\b/.exec(t);
  if (m) out.plate = `${m[1]} ${m[2].toLocaleUpperCase('tr')} ${m[3]}`;
  out.type = kindFrom(t);
  m = /([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü.&\-]*(?: [A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü.&\-]*){0,3} S[İi]GORTA(?: A\.? ?Ş\.?)?)/.exec(t); if (m) out.company = m[1].trim();
  m = /sigortal[ıi](?:n[ıi]n)?\s*(?:ad[ıi]\s*(?:soyad[ıi])?)?\s*(?:[\/,]?\s*[üu]nvan[ıi])?\s*[:.]\s*([^\n]{3,60})/i.exec(t);
  if (m) out.name = m[1].split(/ {2,}|\s(?:T\.?C\.?|Adres|Vergi|Tel)/i)[0].trim();
  return out;
}
function fillForm(d) {
  let n = 0;
  const set = (id, val) => { if (val === null || val === undefined || val === '') return; const el = $('#f-' + id); if (!el) return; el.value = val; if (el.value) { el.classList.add('ai'); n++; } };
  set('name', d.name && String(d.name).slice(0, 120)); set('type', TYPES.includes(d.type) ? d.type : null);
  set('company', d.company && String(d.company).slice(0, 120)); set('no', d.policyNo ? String(d.policyNo).slice(0, 60) : null);
  set('start', pd(d.start) ? d.start : null); set('end', pd(d.end) ? d.end : null);
  const pm = parseMoney(d.premium); set('premium', pm !== null ? nf.format(pm) : null);
  set('plate', d.plate && String(d.plate).slice(0, 20));
  return n;
}
async function handleFile(file) {
  if (!file || !form) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImg = /^image\/(jpeg|png|webp)$/.test(file.type);
  if (!isPdf && !isImg) { toast('Yalnızca PDF, JPG, PNG veya WebP yükleyebilirsiniz.'); return; }
  if (file.size > 30 * 1048576) { toast('Dosya 30 MB sınırını aşıyor.'); return; }
  form.file = file; form.fileType = isPdf ? 'application/pdf' : file.type; form.removeFile = false;
  renderFileRow();
  const tk = form.token, up = $('#upCard');
  if (!up || up.hidden) return;                 // attached by hand: nothing to read
  up.hidden = true;
  let msg = 'Fotoğraftaki yazı okunamaz. Alanları elle doldurun; fotoğraf poliçeye eklenir.';
  if (isPdf) {
    aiMsg('Poliçe okunuyor…', true);
    try {
      const text = await readPdf(file);
      if (!form || form.token !== tk) return;
      if (text.replace(/\s/g, '').length < 80) msg = 'Bu PDF taranmış bir görüntü, içinde okunabilir yazı yok. Alanları elle doldurun; dosya poliçeye eklenir.';
      else { const n = fillForm(guess(text)); msg = n ? `${n} alan dolduruldu (mor çerçeveli). Yanlış okunmuş olabilir, kaydetmeden önce mutlaka kontrol edin.` : 'Dosyadan bilgi çıkarılamadı. Alanları elle doldurun.'; }
    } catch { if (!form || form.token !== tk) return; msg = 'PDF okunamadı. Alanları elle doldurun; dosya poliçeye eklenir.'; }
  }
  aiMsg(msg); $('#pForm').hidden = false;
}
async function submitPolicy() {
  if (!form) return;
  const g = id => $('#f-' + id).value.trim(), err = $('#formErr'), btn = $('#saveBtn');
  const fail = m => { err.textContent = m; err.hidden = false; };
  err.hidden = true;
  if (!g('name')) return fail('Sigortalı adını yazın.');
  if (!pd(g('end'))) return fail('Bitiş tarihini seçin.');
  if (g('start') && g('start') > g('end')) return fail('Bitiş tarihi başlangıçtan önce olamaz.');
  const num = id => g(id) ? parseMoney(g(id)) : null;
  const pm = num('premium'), rate = num('rate'); let cm = num('comm');
  if ((g('premium') && pm === null) || (g('rate') && rate === null) || (g('comm') && cm === null)) return fail('Tutarları sayı olarak yazın, örneğin 12.480,00.');
  if (rate !== null && (rate < 0 || rate > 100)) return fail('Komisyon oranı 0 ile 100 arasında olmalı.');
  if (cm === null && rate !== null && pm !== null) cm = r2(pm * rate / 100);
  const b = form.base, plan = g('plan');
  if (plan && pm === null) return fail('Ödeme takibi için prim tutarını yazın.');
  const data = {kind:'policy', name:g('name'), type:g('type'), company:g('company'), policyNo:g('no'), start:g('start'), end:g('end'),
    plate:g('plate'), phone:g('phone'), note:g('note'), payPlan:plan, renewal:b.renewal || '', createdAt: b.createdAt || Date.now(), updatedAt: Date.now()};
  if (b.sample) data.sample = true;
  if (pm !== null) data.premium = pm; if (rate !== null) data.commRate = rate; if (cm !== null) data.commission = cm;
  data.installments = (b.id && b.payPlan === plan && b.premium === pm && b.start === data.start && b.installments) ? b.installments : makeInst(plan, pm, data.start);
  if (b.fileId && !form.removeFile && !form.file) Object.assign(data, {fileId:b.fileId, fileName:b.fileName || '', fileType:b.fileType || ''});
  btn.disabled = true; btn.textContent = 'Kaydediliyor…';
  let note = '';
  try {
    if (form.file && on()) {
      try { const fid = newId(); await idb.put('files', {id:fid, buf: await form.file.arrayBuffer(), type: form.fileType, name: form.file.name});
        Object.assign(data, {fileId:fid, fileName:form.file.name.slice(0, 120), fileType:form.fileType}); }
      catch { note = ' Dosya saklanamadı, yalnızca bilgiler kaydedildi.'; }
    }
    const renewOf = form.renewOf, quoteOf = form.quoteOf;
    const id = await savePolicy(form.id, data, true);
    if (b.fileId && b.fileId !== data.fileId && on()) idb.del('files', b.fileId).catch(() => {});
    if (data.phone && !custInfo(data.name).phone) await putMisc({...custInfo(data.name), id:'c:' + ckey(data.name), kind:'customer', name: custInfo(data.name).name || data.name, phone:data.phone}, true);
    if (renewOf) { const old = policies.find(x => x.id === renewOf); if (old) await savePolicy(old.id, {...old, renewal:'yenilendi'}, true); }
    if (quoteOf && misc.has(quoteOf)) await putMisc({...misc.get(quoteOf), status:'kabul'}, true);
    renderAll(); toast('Poliçe kaydedildi.' + note); openDetail(id);
  } catch (e) { btn.disabled = false; btn.textContent = 'Poliçeyi kaydet'; writeErr(e); }
}

/* ---------- Excel / CSV import ---------- */
const FIELDS = [['name','Sigortalı adı',['sigortal','müşteri','musteri','ad soyad','adı soyadı','unvan','isim']],['policyNo','Poliçe no',['poliçe no','police no','poliçe num','poliçeno']],
  ['company','Sigorta şirketi',['şirket','sirket']],['type','Tür / branş',['branş','brans','tür','tur','ürün']],['start','Başlangıç tarihi',['başlangıç','baslangic','tanzim','başl']],
  ['end','Bitiş tarihi',['bitiş','bitis','vade']],['premium','Prim',['brüt prim','toplam prim','prim','tutar']],['commission','Komisyon tutarı',['komisyon']],
  ['plate','Plaka',['plaka']],['phone','Telefon',['telefon','gsm','cep','tel']],['tc','T.C. / Vergi no',['t.c','tc','kimlik','vergi']]];
let imp = null;
function loadXlsx() {
  return window.XLSX ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'xlsx.full.min.js'; s.onload = res; s.onerror = rej; document.head.append(s); });
}
function openImport() {
  imp = null;
  openSheet('Excel\'den aktar', `<div class="up" id="impCard">${ic('doc')}<h3>Excel ya da CSV dosyanızı seçin</h3>
    <p>İlk satır sütun başlıkları olmalı (Sigortalı, Poliçe No, Bitiş Tarihi gibi). Dosya telefonda okunur, internete gönderilmez.</p>
    <button class="btn pri" type="button" data-act="imp-pick">${ic('up')}Dosya seç</button></div>
    <input type="file" id="xlsIn" accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden><div class="stack" id="impBody"></div>`);
}
async function readSheet(file) {
  await loadXlsx();
  const buf = await file.arrayBuffer(); let wb;
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    let text; try { text = new TextDecoder('utf-8', {fatal:true}).decode(buf); } catch { text = new TextDecoder('windows-1254').decode(buf); }
    wb = window.XLSX.read(text, {type:'string', raw:true});
  } else wb = window.XLSX.read(buf, {type:'array', cellDates:true});
  const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1, raw:true, defval:''}).filter(r => r.some(c => String(c).trim() !== ''));
  if (rows.length < 2) throw new Error('empty');
  return {head: rows[0].map(h => String(h).trim()), rows: rows.slice(1)};
}
function cellDate(v) {
  if (v instanceof Date && !isNaN(v)) return iso(new Date(v.getTime() + 12 * 36e5));
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = window.XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : ''; }
  const s = String(v).trim(); let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
  return m && +m[2] <= 12 && +m[1] <= 31 ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
async function handleSheet(file) {
  const body = $('#impBody'); if (!file || !body) return;
  body.innerHTML = `<div class="hint"><div class="spin"></div><span>Dosya okunuyor…</span></div>`;
  try {
    const {head, rows} = await readSheet(file), used = new Set(), map = {};
    for (const [k, , words] of FIELDS) { const i = head.findIndex((h, j) => !used.has(j) && words.some(w => low(h).includes(w))); map[k] = i; if (i >= 0) used.add(i); }
    imp = {head, rows};
    $('#impCard').hidden = true;
    body.innerHTML = `<div class="hint">${ic('spark')}<span>${rows.length} satır bulundu. Sütun eşleşmelerini kontrol edin, yanlış olanı düzeltin.</span></div>
      <form class="pf" data-form="import">${FIELDS.map(([k, label]) => `<div class="fld half"><label for="m-${k}">${label}</label><select id="m-${k}"><option value="-1">Yok</option>${head.map((h, i) => `<option value="${i}"${map[k] === i ? ' selected' : ''}>${esc(h || 'Sütun ' + (i + 1))}</option>`).join('')}</select></div>`).join('')}
      <p class="full" id="formErr" style="margin:0;color:var(--crit)" hidden></p>
      <button class="btn pri block full" type="submit">${rows.length} satırı aktar</button></form>`;
  } catch { body.innerHTML = `<div class="notice">Dosya okunamadı. .xlsx, .xls ya da .csv olduğundan ve ilk satırda başlıklar bulunduğundan emin olun.</div>`; $('#impCard').hidden = false; }
}
async function submitImport() {
  if (!imp) return;
  const col = k => +$('#m-' + k).value, err = $('#formErr');
  if (col('name') < 0 || col('end') < 0) { err.textContent = 'En azından "Sigortalı adı" ve "Bitiş tarihi" sütunlarını seçin.'; err.hidden = false; return; }
  const have = new Set(policies.map(p => p.policyNo).filter(Boolean)), recs = [], custs = new Map(); let skip = 0, dup = 0;
  const get = (r, k) => col(k) >= 0 ? r[col(k)] : '';
  for (const r of imp.rows) {
    const name = String(get(r, 'name')).trim(), end = cellDate(get(r, 'end')), no = String(get(r, 'policyNo')).trim();
    if (!name || !end) { skip++; continue; }
    if (no && have.has(no)) { dup++; continue; }
    if (no) have.add(no);
    const rec = {id:newId(), kind:'policy', name, type: kindFrom(String(get(r, 'type'))) || (TYPES.includes(String(get(r, 'type')).trim()) ? String(get(r, 'type')).trim() : 'Diğer'),
      company:String(get(r, 'company')).trim(), policyNo:no, start:cellDate(get(r, 'start')), end, plate:String(get(r, 'plate')).trim(), phone:String(get(r, 'phone')).trim(),
      note:'', payPlan:'', installments:[], renewal:'', createdAt:Date.now(), updatedAt:Date.now()};
    const pm = parseMoney(get(r, 'premium')), cm = parseMoney(get(r, 'commission'));
    if (pm !== null) rec.premium = pm; if (cm !== null) rec.commission = cm;
    recs.push(rec);
    const tc = String(get(r, 'tc')).trim(), k = ckey(name), old = misc.get('c:' + k) || custs.get(k) || {};
    if ((tc && !old.tc) || (rec.phone && !old.phone)) custs.set(k, {...old, id:'c:' + k, kind:'customer', name: old.name || name, tc: old.tc || tc, phone: old.phone || rec.phone, updatedAt:Date.now()});
  }
  try {
    if (on()) { await idb.putMany('policies', recs); await idb.putMany('misc', [...custs.values()]); }
    policies.push(...recs); custs.forEach(c => misc.set(c.id, c));
    closeSheet(); renderAll();
    toast(`${recs.length} poliçe aktarıldı` + (dup ? `, ${dup} tanesi zaten kayıtlıydı` : '') + (skip ? `, ${skip} satır adı ya da bitiş tarihi olmadığı için atlandı` : ''));
  } catch (e) { writeErr(e); }
}

/* ---------- samples, export, backup ---------- */
async function loadSamples() {
  const t = today(), d = n => iso(addDays(t, n));
  const mk = (name, type, company, no, endIn, premium, plate, rate, plan, paidN) => { const start = d(endIn - 365), ins = makeInst(plan, premium, start);
    ins.forEach((x, i) => { if (i < (paidN || 0)) x.paid = true; });
    return {id:newId(), kind:'policy', sample:true, name, type, company, policyNo:no, start, end:d(endIn), premium, commRate:rate, commission:r2(premium * rate / 100),
      plate:plate || '', phone:'', note:'', payPlan:plan, installments:ins, renewal:'', createdAt:Date.now(), updatedAt:Date.now()}; };
  const rows = [
    mk('Defne Karaca', 'Kasko', 'Örnek Sigorta A.Ş.', '41870233', 6, 14250, '34 ORN 101', 15, 'paid'),
    mk('Tolga Erdem', 'Trafik', 'Deneme Sigorta A.Ş.', '77012946', 12, 5870.4, '06 ORN 202', 10, 'paid'),
    mk('Selin Aktaş', 'DASK', 'Numune Sigorta A.Ş.', '30558812', 19, 980, '', 17.5, 'paid'),
    mk('Onur Bilgin', 'Konut', 'Örnek Sigorta A.Ş.', '52099374', 41, 2360.75, '', 20, 'paid'),
    mk('Kardelen Tekstil Ltd. Şti.', 'İşyeri', 'Deneme Sigorta A.Ş.', '88341507', 345, 21400, '', 18, '6', 0),
    mk('Melis Uysal', 'Sağlık', 'Numune Sigorta A.Ş.', '19263480', 320, 31750, '', 12, '9', 1),
    mk('Barış Özdemir', 'Kasko', 'Örnek Sigorta A.Ş.', '64470925', 290, 18990, '35 ORN 303', 15, 'cash'),
    mk('Defne Karaca', 'DASK', 'Numune Sigorta A.Ş.', '30561177', 200, 1120, '', 17.5, 'paid'),
    mk('Gizem Sarı', 'Trafik', 'Deneme Sigorta A.Ş.', '25816039', -9, 4920, '16 ORN 404', 10, 'paid'),
  ];
  const extra = [{id:'q:' + newId(), kind:'quote', sample:true, name:'Onur Bilgin', type:'Kasko', company:'Örnek Sigorta A.Ş.', amount:16800, date:d(-2), status:'bekliyor', note:''},
    {id:'h:' + newId(), kind:'claim', sample:true, name:'Barış Özdemir', fileNo:'H-2026-0417', policyNo:'64470925', date:d(-12), amount:23500, status:'eksper', desc:'Park halinde çarpma', note:''}];
  try { if (on()) { await idb.putMany('policies', rows); await idb.putMany('misc', extra); } policies.push(...rows); extra.forEach(x => misc.set(x.id, x)); renderAll(); toast('Örnek veriler eklendi'); }
  catch (e) { writeErr(e); }
}
function exportCsv() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`, n = v => typeof v === 'number' ? String(v).replace('.', ',') : '';
  const head = ['Sigortalı','Tür','Sigorta şirketi','Poliçe no','Başlangıç','Bitiş','Prim (TL)','Komisyon (TL)','Kalan borç (TL)','Plaka','Telefon','Yenileme','Not'];
  const lines = [head.map(q).join(';')].concat(policies.map(p =>
    [p.name, p.type, p.company, p.policyNo, p.start, p.end, n(p.premium), n(comm(p)), n(debt(p)), p.plate, phoneOf(p), lbl(RENEW, p.renewal)[1], p.note].map(q).join(';')));
  saveText('policeler.csv', '﻿' + lines.join('\r\n'), 'text/csv');
}
const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
async function exportBackup() {
  try {
    const files = on() ? (await idb.all('files')).map(f => ({id:f.id, name:f.name, type:f.type, b64:b64(f.buf)})) : [];
    await saveText(`police-defterim-yedek-${iso(today())}.json`, JSON.stringify({app:'police-defterim', v:2, policies, misc:[...misc.values()], files}), 'application/json');
  } catch { toast('Yedek alınamadı.'); }
}
async function importBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!d || d.app !== 'police-defterim' || !Array.isArray(d.policies)) throw 0;
    const pol = d.policies.filter(p => p && p.id && p.kind === 'policy').map(p => ({...p, id:String(p.id)}));
    const ms = (d.misc || []).filter(r => r && typeof r.id === 'string' && /^[cqhs]:/.test(r.id));
    if (on()) {
      await idb.putMany('files', (d.files || []).filter(f => f && f.id && f.b64).map(f => ({id:String(f.id), name:String(f.name || ''), type:String(f.type || ''), buf:unb64(f.b64)})));
      await idb.putMany('policies', pol); await idb.putMany('misc', ms);
    }
    const ids = new Set(pol.map(p => p.id)); policies = policies.filter(p => !ids.has(p.id)).concat(pol); ms.forEach(r => misc.set(r.id, r));
    closeSheet(); renderAll(); toast(`${pol.length} poliçe yedekten yüklendi`);
  } catch { toast('Bu dosya bir Poliçe Defterim yedeği değil ya da bozuk.'); }
}
async function wipe(onlySamples) {
  try {
    if (onlySamples) {
      for (const p of policies.filter(x => x.sample)) await removePolicy(p, true);
      for (const r of [...misc.values()].filter(x => x.sample)) { if (on()) await idb.del('misc', r.id); misc.delete(r.id); }
    } else {
      const keep = misc.get('s:settings');
      if (on()) { await idb.clear('policies'); await idb.clear('files'); await idb.clear('misc'); if (keep) await idb.put('misc', keep); }
      policies = []; misc.clear(); if (keep) misc.set(keep.id, keep);
    }
    st.selected.clear(); renderAll(); toast(onlySamples ? 'Örnek veriler silindi' : 'Tüm veriler silindi');
  } catch (e) { writeErr(e); }
}

/* ---------- settings ---------- */
function openSettings() {
  const hasSamples = policies.some(p => p.sample), L = lockCfg();
  openSheet('Ayarlar', `
    <div class="dl">
      <div><small>Veriler nerede</small><span>Yalnızca bu cihazda. İnternete gönderilmez; uygulama silinirse kaybolur, bu yüzden düzenli yedek alın.</span></div>
      <div><small>Telefon ve bilgisayar</small><span>Yedek dosyasını diğer cihazda "Yedekten yükle" ile açarak verileri taşırsınız.</span></div>
    </div>
    <button class="btn block" data-act="lock-set">${ic('lock')}Uygulama kilidi: ${L ? 'açık' : 'kapalı'}</button>
    <button class="btn block" data-act="tpl">${ic('msg')}Mesaj şablonları ve imza</button>
    <button class="btn block" data-act="import">${ic('up')}Excel'den toplu aktar</button>
    <button class="btn pri block" data-act="backup">${ic('down')}Yedek al (tüm veriler ve dosyalar)</button>
    <button class="btn block" data-act="restore">${ic('up')}Yedekten yükle</button>
    <input type="file" id="impIn" accept="application/json,.json" hidden>
    ${policies.length ? `<button class="btn block" data-act="csv">${ic('down')}Poliçe listesini Excel için indir (CSV)</button>` : ''}
    ${hasSamples ? `<button class="btn block" data-act="rm-samples">Örnek verileri sil</button>` : `<button class="btn block" data-act="samples">Örnek verileri yükle</button>`}
    ${policies.length || misc.size ? `<button class="btn danger block" data-act="wipe">Tüm verileri sil</button>` : ''}`);
}
function openTemplates() {
  const s = settings();
  openSheet('Mesaj şablonları', `<p class="mut">Kullanabileceğiniz alanlar: {ad} {tur} {sirket} {policeNo} {baslangic} {bitis} {gun} {prim} {plaka} {kalan}. Gönderirken kendiliğinden dolar.</p>
    <form class="pf" data-form="tpl"><div class="full stack" id="tplList">${s.templates.map(tplRow).join('')}</div>
      <button class="btn block full" type="button" data-act="tpl-add">${ic('plus')}Şablon ekle</button>
      <div class="fld"><label for="sig">İmza (her mesajın sonuna eklenir)</label><input id="sig" value="${esc(s.signature)}" placeholder="Örn. Ahmet Yılmaz, Yılmaz Sigorta, 0 5xx xxx xx xx" autocomplete="off"></div>
      <button class="btn pri block full" type="submit">Kaydet</button>
      <button class="btn block full" type="button" data-act="tpl-reset">Hazır şablonlara dön</button></form>`);
}
const tplRow = t => `<div class="panel tpl"><input class="tt" value="${esc(t.title)}" placeholder="Şablon adı" aria-label="Şablon adı"><textarea class="tx" rows="4" aria-label="Şablon metni">${esc(t.text)}</textarea>
  <button class="btn sm danger" type="button" data-act="tpl-del">Bu şablonu sil</button></div>`;
async function submitTemplates() {
  const templates = [...document.querySelectorAll('#tplList .tpl')].map(el => ({title: $('.tt', el).value.trim(), text: $('.tx', el).value.trim()})).filter(t => t.title && t.text);
  if (!templates.length) return toast('En az bir şablon olmalı.');
  try { await putMisc({...settings(), templates, signature: $('#sig').value.trim()}); closeSheet(); toast('Şablonlar kaydedildi'); } catch (e) { writeErr(e); }
}

/* ---------- app lock (keeps the screen closed; it does not encrypt the stored data) ---------- */
const LOCK_KEY = 'pd_lock';
const lockCfg = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch { return null; } };
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const hashPin = async (salt, pin) => b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin)));
const bioOk = () => !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
let hiddenAt = 0;
function showLock() {
  const L = lockCfg(); if (!L) return;
  $('#lock').hidden = false; $('#pin').value = ''; $('#lockErr').hidden = true; $('#bioBtn').hidden = !(L.bio && bioOk());
  setTimeout(() => $('#pin').focus(), 50);
}
async function tryPin() {
  const L = lockCfg(); if (!L) { $('#lock').hidden = true; return; }
  if (await hashPin(L.salt, $('#pin').value) === L.hash) $('#lock').hidden = true;
  else { $('#lockErr').hidden = false; $('#pin').value = ''; }
}
async function tryBio() {
  const L = lockCfg(); if (!L || !L.bio) return;
  try { await navigator.credentials.get({publicKey:{challenge:rnd(32), allowCredentials:[{type:'public-key', id:unb64(L.bio)}], userVerification:'required', timeout:60000}}); $('#lock').hidden = true; }
  catch { toast('Yüz ya da parmak izi doğrulanamadı. Şifreyi yazın.'); }
}
function openLockSettings() {
  const L = lockCfg();
  if (!crypto.subtle) return toast('Bu tarayıcıda kilit kullanılamıyor.');
  openSheet('Uygulama kilidi', L ? `<div class="dl"><div><small>Durum</small><span>Kilit açık. Uygulama açılırken ve bir dakikadan uzun arka planda kaldıktan sonra şifre sorar.</span></div>
      <div><small>Face ID / Touch ID</small><span>${L.bio ? 'Açık' : bioOk() ? 'Kapalı' : 'Bu cihazda kullanılamıyor'}</span></div></div>
      ${bioOk() ? `<button class="btn block" data-act="bio-toggle">${L.bio ? 'Face ID / Touch ID\'yi kapat' : 'Face ID / Touch ID ile açmayı etkinleştir'}</button>` : ''}
      <button class="btn danger block" data-act="lock-off">Kilidi kaldır</button>`
    : `<p class="mut">En az 4 haneli bir şifre belirleyin. Şifreyi unutursanız verilere ulaşmanın yolu yoktur; önce yedek almanız iyi olur. Kilit ekranı kapatır, kayıtlı verileri şifrelemez.</p>
      <form class="pf" data-form="lock"><div class="fld half"><label for="p1">Şifre</label><input id="p1" type="password" inputmode="numeric" autocomplete="off"></div>
      <div class="fld half"><label for="p2">Şifre (tekrar)</label><input id="p2" type="password" inputmode="numeric" autocomplete="off"></div>
      <p class="full" id="formErr" style="margin:0;color:var(--crit)" hidden></p><button class="btn pri block full" type="submit">Kilidi aç</button></form>`);
}
async function submitLock() {
  const a = $('#p1').value, b = $('#p2').value, err = $('#formErr');
  if (!/^\d{4,12}$/.test(a)) { err.textContent = 'Şifre 4 ile 12 hane arasında rakamlardan oluşmalı.'; err.hidden = false; return; }
  if (a !== b) { err.textContent = 'İki şifre aynı değil.'; err.hidden = false; return; }
  const salt = b64(rnd(16));
  try { localStorage.setItem(LOCK_KEY, JSON.stringify({salt, hash: await hashPin(salt, a)})); toast('Kilit açıldı'); openLockSettings(); }
  catch { toast('Kilit kaydedilemedi.'); }
}
async function toggleBio() {
  const L = lockCfg(); if (!L) return;
  if (L.bio) delete L.bio;
  else {
    try {
      const c = await navigator.credentials.create({publicKey:{challenge:rnd(32), rp:{name:'Poliçe Defterim'}, user:{id:rnd(16), name:'kullanici', displayName:'Poliçe Defterim'},
        pubKeyCredParams:[{type:'public-key', alg:-7}, {type:'public-key', alg:-257}], authenticatorSelection:{authenticatorAttachment:'platform', userVerification:'required', residentKey:'discouraged'}, timeout:60000}});
      L.bio = b64(c.rawId);
    } catch { return toast('Face ID / Touch ID etkinleştirilemedi.'); }
  }
  localStorage.setItem(LOCK_KEY, JSON.stringify(L)); openLockSettings();
}

/* ---------- actions ---------- */
const pol = d => policies.find(x => x.id === d.id);
const ACT = {
  close: closeSheet, settings: openSettings, import: openImport, tpl: openTemplates, csv: exportCsv, backup: exportBackup,
  'add-pdf': () => openForm(null, 'pdf'), 'add-man': () => openForm(null, 'man'),
  'add-for': d => { const c = customers().find(x => x.key === d.key); openForm({name: c ? c.name : ''}, 'man'); },
  samples: () => { closeSheet(); loadSamples(); },
  clear: () => { $('#q').value = ''; $('#fType').value = ''; $('#fStatus').value = ''; renderList(); },
  'sel-toggle': () => { st.selecting = !st.selecting; st.selected.clear(); renderList(); },
  'bulk-del': async () => { const arr = policies.filter(p => st.selected.has(p.id));
    if (!arr.length || !await confirmBox(`${arr.length} poliçe ve ekli dosyaları kalıcı olarak silinecek.`)) return;
    try { for (const p of arr) await removePolicy(p, true); toast(`${arr.length} poliçe silindi`); } catch (e) { writeErr(e); }
    st.selecting = false; st.selected.clear(); renderAll(); },
  pol: d => { if (st.selecting && $('#sheet').hidden) { st.selected.has(d.id) ? st.selected.delete(d.id) : st.selected.add(d.id); renderList(); } else openDetail(d.id); },
  edit: d => { const p = pol(d); if (p) openForm(p); },
  msg: d => { const p = pol(d); if (p) sendMsg(p, +d.tpl || 0); },
  dl: d => { const p = pol(d); if (p) downloadFile(p); },
  del: async d => { const p = pol(d); if (p && await confirmBox(`${p.name} adına kayıtlı ${p.type} poliçesi${p.fileId ? ' ve ekli dosyası' : ''} kalıcı olarak silinecek.`)) {
    try { await removePolicy(p); closeSheet(); toast('Poliçe silindi'); } catch (e) { writeErr(e); } } },
  pay: async d => { const p = pol(d); if (!p) return; const ins = p.installments.map((x, i) => i === +d.i ? {...x, paid: !x.paid} : x);
    try { await savePolicy(p.id, {...p, installments: ins}); openDetail(p.id); } catch (e) { writeErr(e); } },
  'pay-next': async d => { const p = pol(d); if (!p) return; const i = p.installments.findIndex(x => !x.paid); if (i < 0) return;
    try { await savePolicy(p.id, {...p, installments: p.installments.map((x, j) => j === i ? {...x, paid:true} : x)}); toast('Ödendi olarak işaretlendi'); } catch (e) { writeErr(e); } },
  renew: d => { const p = pol(d); if (!p) return; const s = pd(p.end) || today();
    openForm({name:p.name, type:p.type, company:p.company, plate:p.plate, phone:p.phone, premium:p.premium, commRate:p.commRate, start:iso(s), end:iso(addMonths(s, 12))}, 'man', {renewOf:p.id});
    toast('Yeni dönem bilgilerini kontrol edip kaydedin'); },
  pick: () => $('#fileIn').click(),
  'rm-file': () => { if (form) { form.file = null; form.removeFile = true; renderFileRow(); } },
  takip: d => { st.takip = d.t; renderTakip(); },
  cust: d => openCustomer(d.key), 'cust-new': () => openItem('customer'),
  'cust-edit': d => { const c = customers().find(x => x.key === d.key); if (c) openItem('customer', {...c.info, name:c.name, phone: c.info.phone || (c.pols.find(p => p.phone) || {}).phone || ''}); },
  'quote-new': () => openItem('quote'), 'claim-new': () => openItem('claim'),
  item: d => { const r = misc.get(d.id); if (r) openItem(r.kind, r); },
  'item-del': async d => { if (await confirmBox('Bu kayıt kalıcı olarak silinecek.')) { try { await delMisc(d.id); closeSheet(); toast('Silindi'); } catch (e) { writeErr(e); } } },
  'quote-pol': d => { const r = misc.get(d.id); if (r) openForm({name:r.name, type:r.type, company:r.company, premium:r.amount, start:iso(today()), end:iso(addMonths(today(), 12))}, 'man', {quoteOf:r.id}); },
  'imp-pick': () => $('#xlsIn').click(), restore: () => $('#impIn').click(),
  'rm-samples': () => { closeSheet(); wipe(true); },
  wipe: async () => { if (await confirmBox('Tüm poliçeler, müşteriler, teklifler, hasar dosyaları ve ekli dosyalar kalıcı olarak silinecek. Önce yedek aldığınızdan emin olun.', 'Tümünü sil')) { closeSheet(); wipe(false); } },
  'tpl-add': () => $('#tplList').insertAdjacentHTML('beforeend', tplRow({title:'', text:''})),
  'tpl-del': (d, el) => el.closest('.tpl').remove(),
  'tpl-reset': async () => { if (await confirmBox('Kendi şablonlarınız silinip hazır şablonlar geri gelecek.', 'Sıfırla')) { await putMisc({...settings(), templates: DEF_TPL}); openTemplates(); } },
  'lock-set': openLockSettings, 'bio-toggle': toggleBio,
  'lock-off': async () => { if (await confirmBox('Uygulama artık şifre sormayacak.', 'Kilidi kaldır')) { localStorage.removeItem(LOCK_KEY); openLockSettings(); } },
};
const FORMS = {policy: submitPolicy, item: submitItem, import: submitImport, tpl: submitTemplates, lock: submitLock};

document.addEventListener('click', e => {
  if (e.target.id === 'sheet') return closeSheet();
  const m = e.target.closest('[data-mode]'); if (m && form) return setMode(m.dataset.mode);
  const a = e.target.closest('[data-act]'); if (a && ACT[a.dataset.act]) ACT[a.dataset.act](a.dataset, a);
});
document.addEventListener('submit', e => { e.preventDefault(); const f = e.target.dataset.form; if (FORMS[f]) FORMS[f](); else if (e.target.id === 'lockForm') tryPin(); });
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'fileIn') { handleFile(t.files[0]); t.value = ''; }
  else if (t.id === 'impIn') importBackup(t.files[0]);
  else if (t.id === 'xlsIn') { handleSheet(t.files[0]); t.value = ''; }
  else if (t.dataset.ch === 'renew') { const p = policies.find(x => x.id === t.dataset.id); if (p) { try { await savePolicy(p.id, {...p, renewal:t.value}); toast('Yenileme durumu: ' + lbl(RENEW, t.value)[1]); } catch (er) { writeErr(er); } } }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.classList && t.classList.contains('ai')) t.classList.remove('ai');
  if (['q', 'fType', 'fStatus', 'sort'].includes(t.id)) renderList(); else if (t.id === 'cq') renderCustomers();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal').hidden && !$('#sheet').hidden) closeSheet(); });
const sheetEl = $('#sheet');
sheetEl.addEventListener('dragover', e => { const u = $('#upCard'); if (u && !u.hidden) { e.preventDefault(); u.classList.add('drag'); } });
sheetEl.addEventListener('dragleave', () => { const u = $('#upCard'); if (u) u.classList.remove('drag'); });
sheetEl.addEventListener('drop', e => { const u = $('#upCard'); if (u && !u.hidden) { e.preventDefault(); u.classList.remove('drag'); handleFile(e.dataTransfer.files[0]); } });
$('#bioBtn').onclick = tryBio;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 60000 && $('#lock').hidden) showLock();
});
window.addEventListener('hashchange', route);

$('#fType').innerHTML = '<option value="">Tüm türler</option>' + TYPES.map(t => `<option>${t}</option>`).join('');
showLock(); route(); boot();
})();
