// Reads the fields of a Turkish insurance policy out of its PDF text. Rule-based, runs on the device.
// Tuned on real kasko, trafik and DASK policies where the same field sits in different places:
// after its label, before it, in a separate value block, or in a table column under a header row.
(function (root) {
'use strict';
const low = s => String(s == null ? '' : s).toLocaleLowerCase('tr');
const norm = s => s.replace(/\s+/g, ' ').trim();
const AMT = '(\\d{1,3}(?:[.,]\\d{3})+[.,]\\d{2}|\\d+[.,]\\d{2})(?!\\d)';
const DATE = '(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4})';
const NUM = '([0-9][0-9\\-]{4,24}[0-9])';
const amount = s => { s = String(s).trim(); const n = parseFloat(s.slice(0, -3).replace(/[.,]/g, '') + '.' + s.slice(-2)); return isFinite(n) ? n : null; };  // 18.033,70 or 22,270.40
const toIso = (d, m, y) => (+d >= 1 && +d <= 31 && +m >= 1 && +m <= 12 && +y > 1990 && +y < 2100) ? `${y}-${String(+m).padStart(2, '0')}-${String(+d).padStart(2, '0')}` : null;
const KINDS = [['dask','DASK'],['zorunlu deprem','DASK'],['kasko','Kasko'],['zorunlu mali','Trafik'],['trafik','Trafik'],['sağlık','Sağlık'],['saglik','Sağlık'],['seyahat','Seyahat'],['işyeri','İşyeri'],['iş yeri','İşyeri'],['isyeri','İşyeri'],['konut','Konut']];
function kindFrom(s) { const L = low(s), k = KINDS.map(([w, n]) => [L.indexOf(w), n]).filter(x => x[0] >= 0).sort((a, b) => a[0] - b[0])[0]; return k ? k[1] : null; }

const HEAD = /(biti[şs] tarihi|ba[şs]lama tarihi|ba[şs]lang[ıi][çc] tarihi|tanzim tarihi|zeyil no|poli[çc]e no|acente no|m[üu][şs]teri no\.?|g[üu]n)/g;
// Turns "labels on one line, values on another" layouts into plain "label : value" lines.
function synth(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {                       // a run of ": value" lines that follows a run of labels
    if (!/^:/.test(lines[i]) || (i && /^:/.test(lines[i - 1]))) continue;
    let j = i; while (j < lines.length && /^:/.test(lines[j])) j++;
    const k = j - i; if (i - k < 0) continue;
    for (let n = 0; n < k; n++) out.push(lines[i - k + n].replace(/\s*:\s*$/, '') + ' : ' + lines[i + n].replace(/^:\s*/, ''));
  }
  for (let i = 0; i < lines.length; i++) {                       // a header row with its values on the line above or below
    const lw = low(lines[i]), labels = lw.match(HEAD);
    if (!labels || labels.length < 3 || lw.replace(HEAD, '').trim()) continue;
    for (const v of [lines[i - 1], lines[i + 1]]) {
      const vals = v ? v.split(' ') : [];
      if (vals.length === labels.length) { labels.forEach((l, n) => out.push(l + ' : ' + vals[n])); break; }
    }
  }
  return out;
}

const STOPW = new Set(['adres','adresi','kimlik','acente','tarih','tarihi','poliçe','gsm','tel','mah','mah.','cad','cad.','sok','sok.','vergi','müşteri','unvan','ünvan','unvanı','ünvanı','no','bilgileri','sayfa','ettiren','sigortalı','sigortalının','adı','soyadı']);
function nameLike(s) {
  s = norm(s); if (s.length < 5 || s.length > 60 || /[\d*:]/.test(s)) return false;
  const w = low(s).split(' '); if (w.length < 2 || w.length > 6) return false;
  return /^[\p{L}.'&\- ]+$/u.test(s) && !w.some(x => STOPW.has(x) || x.includes('sigorta'));
}

function oku(text) {
  const raw = String(text).split('\n').map(l => l.replace(/\s+$/, '')), lines = raw.map(norm), syn = synth(lines);
  const all = syn.concat(lines), allLow = all.map(low), out = {};
  const first = (re, from) => { for (let i = 0; i < (from || all).length; i++) { const m = re.exec((from || allLow)[i]); if (m) return {m, i}; } return null; };

  // ---- dates
  const dOf = re => { const r = first(new RegExp(re + '\\s*:?\\s*' + DATE)); return r ? toIso(r.m[1], r.m[2], r.m[3]) : null; };
  let start = dOf('ba[şs]la(?:ma|ng[ıi][çc])\\s*tarihi'), end = dOf('biti[şs]\\s*tarihi');
  const dates = []; for (const l of lines) for (const m of l.matchAll(new RegExp(DATE, 'g'))) { const d = toIso(m[1], m[2], m[3]); if (d) dates.push(d); }
  const plus1 = d => `${+d.slice(0, 4) + 1}${d.slice(4)}`;
  if (start && (!end || end <= start) && dates.includes(plus1(start))) end = plus1(start);
  if (!start && !end) { const p = dates.find(d => dates.includes(plus1(d))); if (p) { start = p; end = plus1(p); } }
  if (start && end && end <= start) end = null;
  if (start) out.start = start; if (end) out.end = end;

  // ---- policy number (never the previous policy's)
  const old = new Set(); allLow.forEach(l => { for (const m of l.matchAll(new RegExp('(?:eski|[öo]nceki|ba[ğg]l[ıi])\\s+pol(?:i[çc]e)?\\s*no\\s*:?\\s*' + NUM, 'g'))) old.add(m[1]); });
  const pn = [];
  allLow.forEach(l => { const m = new RegExp('dask\\s+poli[çc]e\\s*no\\s*:?\\s*' + NUM).exec(l); if (m) pn.push(m[1]); });
  syn.map(low).forEach(l => { const m = new RegExp('^poli[çc]e no\\s*:\\s*' + NUM).exec(l); if (m) pn.push(m[1]); });
  const weak = [];
  lines.map(low).forEach(l => { for (const m of l.matchAll(new RegExp('((?:eski|[öo]nceki|ba[ğg]l[ıi]|[şs]irketi)\\s+)?poli[çc]e\\s*(?:no|numaras[ıi])\\s*[:.]?\\s*' + NUM, 'g'))) { if (!m[1]) pn.push(m[2]); else if (/irketi/.test(m[1])) weak.push(m[2]); } });
  lines.map(low).forEach(l => { const m = new RegExp(NUM + '\\s+poli[çc]e\\s*no').exec(l); if (m) pn.push(m[1]); });
  const no = pn.concat(weak).find(x => !old.has(x) && /\d{5}/.test(x.replace(/-/g, '')));
  if (no) out.policyNo = no.toUpperCase();

  // ---- payment plan: lines that are only [label] date amount
  const inst = [], instRe = new RegExp('^(?:pe[şs]inat|\\d+\\.?\\s*taksit)?\\s*:?\\s*' + DATE + '\\s+' + AMT + '(?:\\s*tl)?$');
  for (let i = 0; i < lines.length; i++) {
    const m = instRe.exec(low(lines[i]));
    if (m) { const due = toIso(m[1], m[2], m[3]), a = amount(m[4]); if (due && a) inst.push({due, amount: a}); }
    else if (inst.length && lines[i]) break;
  }
  const instSum = Math.round(inst.reduce((s, x) => s + x.amount, 0) * 100) / 100;

  // ---- premium: what the customer pays in total
  const PL = ['[öo]denecek\\s+(?:toplam\\s+)?(?:pr[iı]m|tutar)', '(?:toplam\\s+)?br[üu]t\\s+pr[iı]m', 'poli[çc]e\\s+pr[iı]m[iı]', 'toplam\\s+pr[iı]m', 'genel\\s+toplam', 'toplam\\s+tutar'];
  let prem = null;
  outer: for (const pl of PL) for (let i = 0; i < raw.length; i++) {
    const l = lines[i], lw = low(l), m = new RegExp(pl).exec(lw); if (!m || l.length > 130) continue;
    let a = new RegExp('^[\\s:()tl₺]{0,12}' + AMT).exec(lw.slice(m.index + m[0].length));          // right after the label
    if (!a) a = new RegExp(AMT + '(?:\\s*tl)?\\s*$').exec(lw.slice(0, m.index));                      // right before it
    if (!a) {                                                                                          // in the same column of the next row
      const cells = raw[i].trim().split(/\s{2,}/), idx = cells.findIndex(c => new RegExp(pl).test(low(c)));
      let j = i + 1; while (j < raw.length && !raw[j].trim()) j++;
      const nc = (raw[j] || '').trim().split(/\s{2,}/), amts = [...low(raw[j] || '').matchAll(new RegExp(AMT, 'g'))];
      if (idx >= 0 && nc.length === cells.length) a = new RegExp(AMT).exec(nc[idx]);
      if (!a && amts.length && amts.length === cells.length) a = amts[idx];
      if (!a && amts.length && idx === cells.length - 1) a = amts[amts.length - 1];
    }
    if (a) { prem = amount(a[1]); if (prem) break outer; }
  }
  if (!prem && inst.length) prem = instSum;
  if (prem) out.premium = prem;
  if (inst.length && prem && Math.abs(instSum - prem) < 0.06) out.installments = inst;

  // ---- insured name
  const names = [];
  for (let i = 0; i < lines.length; i++) {
    const lw = low(lines[i]), m = /ad[ıi]\s*(?:ve\s*)?soyad[ıi](?:\s*\/\s*[üu]nvan[ıi])?\s*:?\s*/.exec(lw);
    if (!m || /personel|acente|yetkili|sürücü/.test(lw.slice(0, m.index))) continue;
    const rest = lines[i].slice(m.index + m[0].length).split(/\s+(?=(?:t\.?c|tck|kimlik|vergi|adres|gsm|tel|cep|müşteri)\b)/i)[0];
    const strong = /sigortal/.test(lw) || /sigortal/.test(low(lines[i - 1] || ''));
    if (nameLike(rest)) { names.push([strong, norm(rest)]); continue; }
    for (let j = i + 1; j <= i + 4 && j < lines.length; j++) if (nameLike(lines[j])) { names.push([strong, lines[j]]); break; }
  }
  let nm = (names.find(n => n[0]) || names[0] || [])[1];
  if (!nm) { const r = first(/^sigortal[ıi]\s*\/\s*sigorta ettiren$/); if (r && nameLike(all[r.i + 1] || '')) nm = all[r.i + 1]; }
  if (!nm) { const r = /Merhaba\s+([^,\n]{4,60}),/.exec(text); if (r && nameLike(r[1])) nm = norm(r[1]); }
  if (nm) out.name = nm;

  // ---- insurance company (not the agency)
  for (let i = 0; i < lines.length && !out.company; i++) {
    const lw = low(lines[i]), m = /(?:^|\s)sigorta\s+[şs]irketi(?:\s+[üu]nvan[ıi])?\s*:?\s*/.exec(lw);
    if (!m || /eski|[öo]nceki/.test(lw.slice(0, m.index + 1))) continue;
    const v = /^(.*?sigorta.*?a\.?\s?[şs]\.?)(?:\s|$)/i.exec(lines[i].slice(m.index + m[0].length));
    if (v && !/adres|poliçe/.test(low(v[1]))) out.company = norm(v[1]);
  }
  if (!out.company) for (const l of lines) {
    if (/aracılık|acente|hizmet/.test(low(l))) continue;
    const m = /((?:[A-ZÇĞİÖŞÜ][\p{L}&.\-]* ){1,3}(?:S[İI]GORTA|Sigorta) A\.?\s?Ş\.?)/u.exec(l);
    if (m) { out.company = m[1].replace(/^(?:Ünvanı|Unvanı|Şirketi)\s+/, ''); break; }
  }

  // ---- plate, type, phone
  for (const l of lines) { const m = /(?:Plaka|PLAKA)(?:\s+(?:No|NO))?\s*:?\s*(0[1-9]|[1-7]\d|8[01])\s?([A-ZÇĞİÖŞÜ]{1,3})\s?(\d{2,4})\b/.exec(l); if (m) { out.plate = `${m[1]} ${m[2]} ${m[3]}`; break; } }
  const kind = kindFrom(lines.slice(0, 60).join('\n')) || kindFrom(text); if (kind) out.type = kind;
  const ph = first(/(?:gsm|cep)[^\d\n*]{0,20}(0?5\d{9})(?!\d)/); if (ph) out.phone = ph.m[1].replace(/^(?!0)/, '0');
  return out;
}

root.policeOku = oku; root.policeTur = kindFrom;
if (typeof module !== 'undefined') module.exports = {oku, kindFrom};
})(typeof window !== 'undefined' ? window : globalThis);
