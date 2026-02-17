#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 *  BUSINESS DISCOVERY ENGINE v4.0
 *  Apollo-level business intelligence from 100% public data
 *  
 *  Discovery → Dedupe → Find Websites → WHOIS → Enrich →
 *  Infer Emails → Verify (MX) → Google Sheets + CSV
 *
 *  Author: John Williams | It All Started With A Idea
 *  License: MIT
 * ═══════════════════════════════════════════════════════════════════
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';
import fs from 'fs/promises';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { resolve as dnsResolve } from 'dns';
import { promisify } from 'util';
import net from 'net';
import dotenv from 'dotenv';
dotenv.config();

const resolveMx = promisify(dnsResolve.bind(null));
import dns from 'dns';
const dnsResolveMx = promisify(dns.resolveMx);

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════
const C = {
  sheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
  creds: process.env.GOOGLE_CREDENTIALS_PATH || 'google-credentials.json',
  delay: parseInt(process.env.DELAY_MS) || 2500,
  maxPages: parseInt(process.env.MAX_PAGES_PER_SITE) || 15,
  maxBiz: parseInt(process.env.MAX_BUSINESSES) || 1000,
  timeout: 20000,
  stateFile: '.discovery-state.json',
  pauseFile: '.discovery-pause',
  stopFile: '.discovery-stop',
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

// ═══════════════════════════════════════════════════════════════════
//  STATES
// ═══════════════════════════════════════════════════════════════════
const STATES = {
  AZ: { name:'Arizona', abbr:'AZ', tab:'Arizona', yp:'az', cities:['Phoenix','Scottsdale','Tempe','Mesa','Chandler','Gilbert','Glendale','Peoria','Surprise','Tucson','Flagstaff','Yuma','Goodyear','Buckeye','Avondale'] },
  ID: { name:'Idaho', abbr:'ID', tab:'Idaho', yp:'id', cities:['Boise','Meridian','Nampa','Caldwell','Idaho Falls','Pocatello','Twin Falls',"Coeur d'Alene",'Lewiston','Eagle'] },
  OH: { name:'Ohio', abbr:'OH', tab:'Ohio', yp:'oh', cities:['Columbus','Cleveland','Cincinnati','Toledo','Akron','Dayton','Canton','Youngstown','Dublin','Westerville','Mason','Parma'] },
  WA: { name:'Washington', abbr:'WA', tab:'Washington', yp:'wa', cities:['Seattle','Spokane','Tacoma','Vancouver','Bellevue','Kent','Everett','Renton','Kirkland','Redmond','Olympia','Bellingham'] }
};

// ═══════════════════════════════════════════════════════════════════
//  CATEGORY → YELLOW PAGES SLUG MAP
// ═══════════════════════════════════════════════════════════════════
const CATS = [
  'plumber','electrician','dentist','restaurant','auto repair','salon',
  'law firm','accountant','real estate agent','roofing','hvac',
  'cleaning service','landscaping','insurance agent','veterinarian',
  'fitness','photography','marketing agency','construction','mechanic',
  'chiropractor','bakery','florist','pet grooming','daycare','tutoring',
  'printing','tailor','locksmith','moving company'
];
const YP_SLUG = {
  'plumber':'plumbers','electrician':'electricians','dentist':'dentists',
  'restaurant':'restaurants','auto repair':'auto-repair-service',
  'salon':'beauty-salons','law firm':'attorneys','accountant':'accountants',
  'real estate agent':'real-estate-agents','roofing':'roofing-contractors',
  'hvac':'air-conditioning-service-repair','cleaning service':'cleaning-services',
  'landscaping':'landscape-contractors','insurance agent':'insurance',
  'veterinarian':'veterinary-clinics-hospitals','fitness':'health-clubs',
  'photography':'photographers','marketing agency':'marketing-consultants',
  'construction':'general-contractors','mechanic':'auto-repair-service',
  'chiropractor':'chiropractors','bakery':'bakeries','florist':'florists',
  'pet grooming':'pet-grooming','daycare':'child-care-consultants',
  'tutoring':'tutoring','printing':'printing-services','tailor':'tailors',
  'locksmith':'locks-locksmiths','moving company':'movers'
};

// ═══════════════════════════════════════════════════════════════════
//  LOGGING
// ═══════════════════════════════════════════════════════════════════
const L = {
  info:    m => console.log(`\x1b[36mℹ\x1b[0m  ${m}`),
  ok:      m => console.log(`\x1b[32m✅\x1b[0m ${m}`),
  warn:    m => console.log(`\x1b[33m⚠\x1b[0m  ${m}`),
  err:     m => console.log(`\x1b[31m❌\x1b[0m ${m}`),
  phase:   m => console.log(`\n\x1b[1m\x1b[34m━━━ ${m} ━━━\x1b[0m\n`),
  dim:     m => console.log(`\x1b[90m   ${m}\x1b[0m`),
  contact: m => console.log(`\x1b[32m   📧 ${m}\x1b[0m`),
  whois:   m => console.log(`\x1b[35m   🔍 ${m}\x1b[0m`),
  infer:   m => console.log(`\x1b[33m   🧠 ${m}\x1b[0m`),
  verify:  m => console.log(`\x1b[34m   ✓ ${m}\x1b[0m`),
};

// ═══════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchUrl(url, opts = {}) {
  try {
    const r = await axios.get(url, {
      headers: { 'User-Agent': C.ua, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5', ...opts.headers },
      timeout: opts.timeout || C.timeout, maxRedirects: 10, validateStatus: s => s < 400
    });
    const ct = r.headers['content-type'] || '';
    if (ct.includes('text/html') || ct.includes('text/xml') || ct.includes('application/json'))
      return { data: r.data, url: r.request?.res?.responseUrl || url };
    return null;
  } catch { return null; }
}

async function fetchJSON(url) {
  try {
    const r = await axios.get(url, { headers: { 'User-Agent': C.ua, 'Accept': 'application/json' }, timeout: 15000 });
    return r.data;
  } catch { return null; }
}

async function resolveUrl(domain) {
  const clean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  for (const pre of ['https://www.','https://','http://www.','http://']) {
    try {
      const r = await axios.get(`${pre}${clean}`, { timeout: 10000, maxRedirects: 10, validateStatus: s => s < 400, headers: { 'User-Agent': C.ua } });
      return (r.request?.res?.responseUrl || `${pre}${clean}`).replace(/\/+$/, '');
    } catch { continue; }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
//  REGEX PATTERNS
// ═══════════════════════════════════════════════════════════════════
const RE_EMAIL = /\b[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}\b/g;
const RE_PHONE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?:\s*(?:ext|x|ext\.)?\s*\d{1,5})?/gi;
const RE_ADDRESS = /\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z][a-zA-Z]+(?:\s+[A-Za-z]+){0,4}\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Loop|Trail|Tr|Pike|Run|Pass|Row)\.?(?:\s*(?:#|Ste|Suite|Apt|Unit|Bldg|Floor|Fl)\s*[A-Za-z0-9-]+)?/gi;
const RE_OBFUSC = /\b[a-zA-Z0-9._-]+\s*[\[({]?\s*at\s*[\])}]?\s*[a-zA-Z0-9.-]+\s*[\[({]?\s*dot\s*[\])}]?\s*[a-zA-Z]{2,}\b/gi;

const SKIP_EMAILS = ['noreply','no-reply','donotreply','admin@','webmaster@','postmaster@','hostmaster@','abuse@','privacy@','ssl@','info@example','test@','example@','placeholder@','dummy@','fake@','sentry','wordpress','wixpress','squarespace','godaddy','cloudflare','w3.org','schema.org','googleapis','jquery','bootstrapcdn','cookie','email@email','support@wix','sample@','demo@','user@','username@','@sentry','change@me','your@email','name@company','.png','.jpg','.gif','.css','.js','.svg','.woff'];
function validEmail(e) {
  if (!e || e.length > 80 || e.length < 6) return false;
  const l = e.toLowerCase();
  for (const s of SKIP_EMAILS) if (l.includes(s)) return false;
  const parts = l.split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1];
  if (!domain.includes('.') || domain.endsWith('.') || domain.startsWith('.')) return false;
  return true;
}

function firstName(full) { return full ? full.trim().split(/\s+/)[0] : ''; }
function lastName(full) { const p = (full||'').trim().split(/\s+/); return p.length > 1 ? p.slice(1).join(' ') : ''; }

// ═══════════════════════════════════════════════════════════════════
//  SOURCE 1: YELLOW PAGES (paginated — 3 pages per city/category)
// ═══════════════════════════════════════════════════════════════════
async function discoverYP(state, categories, cities, max) {
  const biz = [];
  L.info(`Yellow Pages — ${state.name} (${categories.length} cats × ${cities.length} cities)`);
  for (const cat of categories) {
    for (const city of cities) {
      if (biz.length >= max) break;
      const slug = YP_SLUG[cat] || cat.toLowerCase().replace(/\s+/g,'-')+'s';
      const citySlug = city.toLowerCase().replace(/\s+/g,'-').replace(/'/g,'');
      for (let page = 1; page <= 3; page++) {
        if (biz.length >= max) break;
        const url = `https://www.yellowpages.com/${citySlug}-${state.yp}/${slug}${page>1?`?page=${page}`:''}`;
        const r = await fetchUrl(url);
        if (!r?.data) break;
        const $ = cheerio.load(r.data);
        let found = 0;
        $('a[href*="/mip/"]').each((_, a) => {
          let name = $(a).text().trim().replace(/^\d+\.\s*/, '');
          if (!name || name.length < 3 || name.length > 200) return;
          if (/^(browse|search|find|sort|sign|log|yellow pages)/i.test(name)) return;
          if (biz.some(b => b.company_name === name && b.city === city)) return;
          let $box = $(a);
          for (let i = 0; i < 8; i++) { $box = $box.parent(); if (!$box.length) break; if ($box.text().length > 100 && /\(\d{3}\)/.test($box.text())) break; }
          const boxText = $box.text();
          RE_PHONE.lastIndex = 0; const phone = (boxText.match(RE_PHONE)||[])[0]||'';
          RE_ADDRESS.lastIndex = 0; const addr = (boxText.match(RE_ADDRESS)||[])[0]||'';
          let website = '';
          $box.find('a[href^="http"]').each((_, l) => { const h = $(l).attr('href')||''; const t = $(l).text().toLowerCase(); if ((t.includes('website')||t.includes('visit')) && !/yellowpages|yp\.com|intelius|thryv/.test(h) && !website) website = h; });
          if (!website) $box.find('a[href^="http"]').each((_, l) => { const h=$(l).attr('href')||''; if (!/yellowpages|yp\.com|intelius|thryv|facebook|yelp/.test(h) && !website) website=h; });
          biz.push({ source:'yellowpages', company_name:name, phone, address:addr, city, state:state.name, website, industry:cat });
          found++;
        });
        if (found === 0) break;
        L.dim(`YP "${cat}" ${city} p${page}: +${found} (${biz.length} total)`);
        await sleep(C.delay);
      }
    }
    if (biz.length >= max) break;
  }
  L.ok(`Yellow Pages: ${biz.length} businesses`);
  return biz;
}

// ═══════════════════════════════════════════════════════════════════
//  SOURCE 2: YELP (public HTML)
// ═══════════════════════════════════════════════════════════════════
async function discoverYelp(state, categories, cities, max) {
  const biz = [];
  L.info(`Yelp — ${state.name}`);
  for (const cat of categories) {
    for (const city of cities.slice(0, 5)) {
      if (biz.length >= max) break;
      const url = `https://www.yelp.com/search?find_desc=${encodeURIComponent(cat)}&find_loc=${encodeURIComponent(city+', '+state.abbr)}`;
      const r = await fetchUrl(url);
      if (!r?.data) { await sleep(C.delay); continue; }
      const $ = cheerio.load(r.data);
      const seen = new Set();
      $('a[href*="/biz/"]').each((_, a) => {
        const href = $(a).attr('href')||'';
        const bizSlug = href.match(/\/biz\/([\w-]+)/);
        if (!bizSlug || seen.has(bizSlug[1])) return;
        seen.add(bizSlug[1]);
        let name = $(a).text().trim().replace(/^\d+\.\s*/, '');
        if (!name || name.length < 3 || name.length > 150) return;
        if (/^(yelp|more|see|read|write|photo|map|direction|filter|review|claim|sign)/i.test(name)) return;
        if (biz.some(b => b.company_name === name && b.city === city)) return;
        const $c = $(a).closest('div').parent();
        RE_PHONE.lastIndex = 0;
        const phone = ($c.text().match(RE_PHONE)||[])[0]||'';
        biz.push({ source:'yelp', company_name:name, phone, address:'', city, state:state.name, website:'', industry:cat });
      });
      L.dim(`Yelp "${cat}" ${city}: ${biz.length} total`);
      await sleep(C.delay + 1000);
    }
    if (biz.length >= max) break;
  }
  L.ok(`Yelp: ${biz.length} businesses`);
  return biz;
}

// ═══════════════════════════════════════════════════════════════════
//  SOURCE 3: BBB
// ═══════════════════════════════════════════════════════════════════
async function discoverBBB(state, categories, cities, max) {
  const biz = [];
  L.info(`BBB — ${state.name}`);
  for (const cat of categories.slice(0, 10)) {
    for (const city of cities.slice(0, 3)) {
      if (biz.length >= max) break;
      const url = `https://www.bbb.org/search?find_country=US&find_loc=${encodeURIComponent(city)}%2C+${state.abbr}&find_text=${encodeURIComponent(cat)}&page=1&sort=Relevance`;
      const r = await fetchUrl(url);
      if (!r?.data) { await sleep(C.delay); continue; }
      const $ = cheerio.load(r.data);
      $('a[href*="bbb.org/us/"]').each((_, a) => {
        const name = $(a).text().trim();
        if (!name || name.length<3 || name.length>200) return;
        if (/^(bbb|better business|search|find|accredit)/i.test(name)) return;
        if (biz.some(b => b.company_name === name)) return;
        const $s = $(a).closest('div').parent();
        RE_PHONE.lastIndex = 0;
        biz.push({ source:'bbb', company_name:name, phone:($s.text().match(RE_PHONE)||[])[0]||'', address:'', city, state:state.name, website:'', industry:cat });
      });
      await sleep(C.delay);
    }
    if (biz.length >= max) break;
  }
  L.ok(`BBB: ${biz.length} businesses`);
  return biz;
}

// ═══════════════════════════════════════════════════════════════════
//  WEBSITE FINDER — Google search for businesses missing a site
// ═══════════════════════════════════════════════════════════════════
async function findMissingWebsites(businesses) {
  const missing = businesses.filter(b => !b.website);
  if (!missing.length) return businesses;
  L.info(`Finding websites for ${missing.length} businesses...`);
  let found = 0;
  for (const biz of missing) {
    try {
      const q = encodeURIComponent(`"${biz.company_name}" ${biz.city} ${biz.state}`);
      const r = await fetchUrl(`https://www.google.com/search?q=${q}&num=5`);
      if (!r?.data) { await sleep(C.delay); continue; }
      const $ = cheerio.load(r.data);
      $('a[href]').each((_, a) => {
        if (biz.website) return;
        const href = $(a).attr('href')||'';
        const match = href.match(/\/url\?q=(https?:\/\/[^&]+)/);
        const actual = match ? decodeURIComponent(match[1]) : '';
        if (!actual) return;
        if (/google\.|youtube\.|yelp\.|yellowpages\.|bbb\.org|facebook\.|instagram\.|twitter\.|linkedin\.|mapquest|angi\.|homeadvisor|thumbtack|nextdoor|tripadvisor|pinterest|tiktok|reddit/i.test(actual)) return;
        if (actual.startsWith('http') && actual.length < 200) { biz.website = actual.split('?')[0]; found++; }
      });
    } catch {}
    await sleep(C.delay + 500);
  }
  L.ok(`Found websites for ${found}/${missing.length} businesses`);
  return businesses;
}

// ═══════════════════════════════════════════════════════════════════
//  WHOIS / RDAP — public domain registration data
// ═══════════════════════════════════════════════════════════════════
async function lookupWhois(domain) {
  const clean = domain.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'').toLowerCase();
  if (!clean || !clean.includes('.')) return null;
  try {
    // Use RDAP (REST-based WHOIS successor) — returns JSON
    const data = await fetchJSON(`https://rdap.org/domain/${clean}`);
    if (!data) return null;
    const result = { domain: clean, registrant: {}, admin: {} };

    // Parse entities
    const entities = data.entities || [];
    for (const entity of entities) {
      const roles = entity.roles || [];
      const vcard = entity.vcardArray?.[1] || [];
      const target = roles.includes('registrant') ? result.registrant : roles.includes('administrative') ? result.admin : null;
      if (!target) continue;
      for (const field of vcard) {
        if (field[0] === 'fn') target.name = field[3];
        if (field[0] === 'email') target.email = field[3];
        if (field[0] === 'tel') target.phone = field[3];
        if (field[0] === 'org') target.org = field[3];
        if (field[0] === 'adr') {
          const addr = Array.isArray(field[3]) ? field[3].filter(Boolean).join(', ') : field[3];
          if (addr) target.address = addr;
        }
      }
      // Nested entities (contacts inside entities)
      if (entity.entities) {
        for (const sub of entity.entities) {
          const sv = sub.vcardArray?.[1] || [];
          for (const f of sv) {
            if (f[0] === 'fn' && !target.name) target.name = f[3];
            if (f[0] === 'email' && !target.email) target.email = f[3];
            if (f[0] === 'tel' && !target.phone) target.phone = f[3];
          }
        }
      }
    }

    // Parse events for creation date
    if (data.events) {
      for (const ev of data.events) {
        if (ev.eventAction === 'registration') result.created = ev.eventDate;
        if (ev.eventAction === 'last changed') result.updated = ev.eventDate;
      }
    }

    // Only return if we found something useful
    const hasData = result.registrant.name || result.registrant.email || result.admin.name || result.admin.email;
    if (!hasData) return null;

    return result;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
//  ENTITY RESOLUTION (deduplicate across sources)
// ═══════════════════════════════════════════════════════════════════
function normName(n) { return (n||'').toLowerCase().replace(/\b(llc|inc|corp|ltd|co|company|enterprises|services|solutions|group|associates|partners|pllc|lp|llp)\b/g,'').replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim(); }
function normPhone(p) { return (p||'').replace(/[^\d]/g,'').slice(-10); }
function normDomain(u) { return (u||'').replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'').toLowerCase().trim(); }
function dice(a, b) {
  if (!a||!b) return 0; if (a===b) return 1;
  const bg = s => { const p=[]; for(let i=0;i<s.length-1;i++) p.push(s.slice(i,i+2)); return p; };
  const ab=bg(a),bb=bg(b); let m=0; const u=new Set();
  for(const x of ab) for(let i=0;i<bb.length;i++) { if(!u.has(i)&&x===bb[i]) { m++; u.add(i); break; } }
  return (2*m)/(ab.length+bb.length);
}
function sameEntity(a, b) {
  const da=normDomain(a.website), db=normDomain(b.website);
  if (da&&db&&da===db) return true;
  const pa=normPhone(a.phone), pb=normPhone(b.phone);
  if (pa&&pb&&pa.length>=10&&pa===pb) return true;
  const na=normName(a.company_name), nb=normName(b.company_name);
  const s=dice(na,nb);
  if (s>0.85) return true;
  if (s>0.7 && (a.city||'').toLowerCase()===(b.city||'').toLowerCase()) return true;
  return false;
}
function dedupe(list) {
  L.info(`Deduplicating ${list.length} records...`);
  const uniq = [];
  for (const b of list) {
    let matched = false;
    for (let i=0;i<uniq.length;i++) {
      if (sameEntity(uniq[i], b)) {
        for (const k of ['phone','address','city','website','industry'])
          if (!uniq[i][k] && b[k]) uniq[i][k] = b[k];
        if (!uniq[i].sources) uniq[i].sources = [uniq[i].source];
        if (!uniq[i].sources.includes(b.source)) uniq[i].sources.push(b.source);
        matched = true; break;
      }
    }
    if (!matched) { b.sources = [b.source]; uniq.push(b); }
  }
  L.ok(`Dedup: ${list.length} → ${uniq.length} unique`);
  return uniq;
}

// ═══════════════════════════════════════════════════════════════════
//  WEBSITE ENRICHMENT — 9 extraction methods
// ═══════════════════════════════════════════════════════════════════
function extractContacts($, pageUrl) {
  const contacts = [], emails = new Set(), companyInfo = {};

  // 1. JSON-LD / Schema.org
  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      const data = JSON.parse($(script).html());
      const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (const item of items) {
        if (item.email) { const e = item.email.replace('mailto:','').toLowerCase(); if (validEmail(e) && !emails.has(e)) { emails.add(e); contacts.push({ email:e, first_name:firstName(item.name||''), last_name:lastName(item.name||''), title:item.jobTitle||'', phone:item.telephone||'', confidence:'found', source_page:pageUrl }); } }
        if (item.telephone) companyInfo.phone = item.telephone;
        if (item.name && !companyInfo.name) companyInfo.name = item.name;
        if (item.address) { const a = typeof item.address==='string' ? item.address : `${item.address.streetAddress||''} ${item.address.addressLocality||''} ${item.address.addressRegion||''}`.trim(); if (a) companyInfo.address = a; }
        if (item.url) companyInfo.website = item.url;
        if (item.aggregateRating) { companyInfo.rating = item.aggregateRating.ratingValue; companyInfo.reviewCount = item.aggregateRating.reviewCount; }
        const people = item.employee || item.member || item.employees || item.members;
        if (people) { const arr = Array.isArray(people) ? people : [people]; for (const p of arr) { if (p.email) { const pe = p.email.replace('mailto:','').toLowerCase(); if (validEmail(pe) && !emails.has(pe)) { emails.add(pe); contacts.push({ email:pe, first_name:firstName(p.name||''), last_name:lastName(p.name||''), title:p.jobTitle||'', phone:p.telephone||'', confidence:'found', source_page:pageUrl }); } } } }
      }
    } catch {}
  });

  // 2. mailto: links with DOM context
  $('a[href^="mailto:"]').each((_, a) => {
    const email = $(a).attr('href').replace('mailto:','').split('?')[0].trim().toLowerCase();
    RE_EMAIL.lastIndex = 0;
    if (!RE_EMAIL.test(email)) { RE_EMAIL.lastIndex = 0; return; }
    RE_EMAIL.lastIndex = 0;
    if (!validEmail(email) || emails.has(email)) return;
    emails.add(email);
    let name='', title='', phone='';
    let $ctx = $(a);
    for (let i=0; i<6; i++) { $ctx=$ctx.parent(); if(!$ctx.length) break; const t=$ctx.text().trim(); if(t.length>20&&t.length<600) { const ne=$ctx.find('h2,h3,h4,h5,strong,.name,[class*="name"]').first(); const te=$ctx.find('.title,[class*="title"],[class*="position"],[class*="role"],em,.subtitle').first(); name=ne.text().trim(); title=te.text().trim(); RE_PHONE.lastIndex=0; const pm=t.match(RE_PHONE); if(pm) phone=pm[0]; if(name&&name.length>2&&name.length<60) break; } }
    if (title===name) title='';
    if (title.length>80) title='';
    contacts.push({ email, first_name:firstName(name), last_name:lastName(name), title, phone, confidence:'found', source_page:pageUrl });
  });

  // 3. data-email attributes
  $('[data-email],[data-mail],[data-staff-email]').each((_, el) => {
    const $el=$(el); const email=($el.attr('data-email')||$el.attr('data-mail')||$el.attr('data-staff-email')||'').trim().toLowerCase();
    if(!email||!validEmail(email)||emails.has(email)) return; emails.add(email);
    const name=$el.attr('data-staff-name')||$el.attr('data-name')||$el.attr('data-fullname')||'';
    const title=$el.attr('data-staff-title')||$el.attr('data-title')||$el.attr('data-position')||'';
    contacts.push({ email, first_name:firstName(name), last_name:lastName(name), title, phone:'', confidence:'found', source_page:pageUrl });
  });

  // 4. Staff/team card patterns
  const cardSels='.team-member,.staff-member,.employee,.person,.member,[class*="team-card"],[class*="staff-card"],[class*="bio"],[class*="people-card"],[class*="contact-card"],.profile,[class*="personnel"],[class*="directory-item"],[class*="agent-card"],[class*="doctor-card"],[class*="attorney"],[class*="provider-card"],[class*="advisor"]';
  try { $(cardSels).each((_, card) => { const $c=$(card); const t=$c.text(); RE_EMAIL.lastIndex=0; const ce=t.match(RE_EMAIL)||[]; for(const raw of ce) { const e=raw.toLowerCase(); if(!validEmail(e)||emails.has(e)) continue; emails.add(e); const ne=$c.find('h2,h3,h4,h5,.name,[class*="name"],strong').first(); const te=$c.find('.title,[class*="title"],[class*="position"],[class*="role"],em,.subtitle').first(); RE_PHONE.lastIndex=0; const pm=t.match(RE_PHONE); contacts.push({ email:e, first_name:firstName(ne.text().trim()), last_name:lastName(ne.text().trim()), title:te.text().trim().length<80?te.text().trim():'', phone:pm?pm[0]:'', confidence:'found', source_page:pageUrl }); } }); } catch {}

  // 5. Full-page regex sweep
  const bodyText = ($('body').text()||'').replace(/\s+/g,' ');
  RE_EMAIL.lastIndex=0; const pageEmails = bodyText.match(RE_EMAIL)||[];
  for (const raw of pageEmails) { const e=raw.toLowerCase(); if(validEmail(e)&&!emails.has(e)) { emails.add(e); contacts.push({ email:e, first_name:'', last_name:'', title:'', phone:'', confidence:'found', source_page:pageUrl }); } }

  // 6. Obfuscated emails
  RE_OBFUSC.lastIndex=0; const obf = bodyText.match(RE_OBFUSC)||[];
  for (const m of obf) { const cleaned=m.replace(/\s*[\[({]?\s*at\s*[\])}]?\s*/gi,'@').replace(/\s*[\[({]?\s*dot\s*[\])}]?\s*/gi,'.').toLowerCase(); RE_EMAIL.lastIndex=0; if(RE_EMAIL.test(cleaned)&&validEmail(cleaned)&&!emails.has(cleaned)) { emails.add(cleaned); contacts.push({ email:cleaned, first_name:'', last_name:'', title:'', phone:'', confidence:'found', source_page:pageUrl }); } RE_EMAIL.lastIndex=0; }

  // 7. Footer extraction
  $('footer,.footer,[class*="footer"],[id*="footer"]').each((_, f) => { const ft=$(f).text(); if(!companyInfo.phone) { RE_PHONE.lastIndex=0; const pm=ft.match(RE_PHONE); if(pm) companyInfo.phone=pm[0]; } if(!companyInfo.address) { RE_ADDRESS.lastIndex=0; const am=ft.match(RE_ADDRESS); if(am) companyInfo.address=am[0]; } });

  // 8. Meta tags
  companyInfo.site_title = $('meta[property="og:title"]').attr('content') || $('title').text().trim();
  const desc = $('meta[name="description"]').attr('content'); if(desc) companyInfo.description=desc;

  // 9. Tel: links
  if(!companyInfo.phone) $('a[href^="tel:"]').first().each((_,a) => { companyInfo.phone=$(a).attr('href').replace('tel:','').replace(/[^\d+-]/g,''); });

  // BONUS: Extract names WITHOUT emails (for pattern inference later)
  const namesWithoutEmails = [];
  try {
    $(cardSels + ',.wp-block-column,.elementor-widget-container').each((_, card) => {
      const $c = $(card);
      const nameEl = $c.find('h2,h3,h4,h5,.name,[class*="name"],strong').first();
      const titleEl = $c.find('.title,[class*="title"],[class*="position"],[class*="role"],em,.subtitle').first();
      const name = nameEl.text().trim();
      const title = titleEl.text().trim();
      if (name && name.length > 3 && name.length < 60 && /^[A-Z]/.test(name) && name.includes(' ')) {
        // Check this person doesn't already have an email
        const hasEmail = contacts.some(c => `${c.first_name} ${c.last_name}`.trim() === name);
        if (!hasEmail) {
          RE_PHONE.lastIndex = 0;
          const pm = $c.text().match(RE_PHONE);
          namesWithoutEmails.push({ first_name: firstName(name), last_name: lastName(name), title: title.length < 80 ? title : '', phone: pm ? pm[0] : '', source_page: pageUrl });
        }
      }
    });
  } catch {}

  return { contacts, emails: Array.from(emails), companyInfo, namesWithoutEmails };
}

// ═══════════════════════════════════════════════════════════════════
//  EMAIL PATTERN INFERENCE — detect pattern from known emails,
//  generate emails for people found without one
// ═══════════════════════════════════════════════════════════════════
function detectEmailPattern(contacts, domain) {
  // Look at emails we found and detect the pattern used
  const patterns = { 'first': 0, 'first.last': 0, 'firstlast': 0, 'flast': 0, 'first_last': 0, 'firstl': 0, 'last': 0 };

  for (const c of contacts) {
    if (!c.email || !c.first_name || !c.last_name) continue;
    const local = c.email.split('@')[0].toLowerCase();
    const f = c.first_name.toLowerCase();
    const l = c.last_name.toLowerCase();
    if (!f || !l) continue;

    if (local === f) patterns['first']++;
    else if (local === `${f}.${l}`) patterns['first.last']++;
    else if (local === `${f}${l}`) patterns['firstlast']++;
    else if (local === `${f[0]}${l}`) patterns['flast']++;
    else if (local === `${f}_${l}`) patterns['first_last']++;
    else if (local === `${f}${l[0]}`) patterns['firstl']++;
    else if (local === l) patterns['last']++;
  }

  // Find the dominant pattern
  let best = null, bestCount = 0;
  for (const [pat, count] of Object.entries(patterns)) {
    if (count > bestCount) { best = pat; bestCount = count; }
  }

  if (bestCount < 1) return null; // Need at least 1 match to detect pattern
  return best;
}

function generateEmail(pattern, fname, lname, domain) {
  const f = fname.toLowerCase().replace(/[^a-z]/g, '');
  const l = lname.toLowerCase().replace(/[^a-z]/g, '');
  if (!f || !l) return null;
  const map = {
    'first': `${f}@${domain}`,
    'first.last': `${f}.${l}@${domain}`,
    'firstlast': `${f}${l}@${domain}`,
    'flast': `${f[0]}${l}@${domain}`,
    'first_last': `${f}_${l}@${domain}`,
    'firstl': `${f}${l[0]}@${domain}`,
    'last': `${l}@${domain}`
  };
  return map[pattern] || null;
}

// ═══════════════════════════════════════════════════════════════════
//  EMAIL VERIFICATION — MX record check
// ═══════════════════════════════════════════════════════════════════
const mxCache = new Map();

async function verifyEmailMx(email) {
  const domain = email.split('@')[1];
  if (!domain) return false;
  if (mxCache.has(domain)) return mxCache.get(domain);
  try {
    const records = await dnsResolveMx(domain);
    const valid = records && records.length > 0;
    mxCache.set(domain, valid);
    return valid;
  } catch {
    mxCache.set(domain, false);
    return false;
  }
}

// SMTP-level verification (checks if mailbox exists)
// Note: Many ISPs block port 25 outbound. This is best-effort.
async function verifyEmailSmtp(email) {
  const domain = email.split('@')[1];
  try {
    const records = await dnsResolveMx(domain);
    if (!records || !records.length) return 'invalid_domain';
    // Sort by priority (lowest = highest priority)
    records.sort((a, b) => a.priority - b.priority);
    const mxHost = records[0].exchange;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => { socket.destroy(); resolve('timeout'); }, 10000);
      const socket = net.createConnection(25, mxHost);
      let step = 0, response = '';

      socket.on('data', (data) => {
        response = data.toString();
        if (step === 0 && response.startsWith('220')) {
          socket.write(`EHLO verify.local\r\n`); step = 1;
        } else if (step === 1 && (response.startsWith('250') || response.startsWith('220'))) {
          socket.write(`MAIL FROM:<verify@verify.local>\r\n`); step = 2;
        } else if (step === 2 && response.startsWith('250')) {
          socket.write(`RCPT TO:<${email}>\r\n`); step = 3;
        } else if (step === 3) {
          socket.write(`QUIT\r\n`);
          clearTimeout(timeout);
          if (response.startsWith('250')) resolve('verified');
          else if (response.startsWith('550') || response.startsWith('551') || response.startsWith('553')) resolve('invalid');
          else resolve('unknown');
          socket.destroy();
        }
      });
      socket.on('error', () => { clearTimeout(timeout); resolve('error'); });
      socket.on('timeout', () => { clearTimeout(timeout); socket.destroy(); resolve('timeout'); });
    });
  } catch {
    return 'error';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SUBPAGE DISCOVERY
// ═══════════════════════════════════════════════════════════════════
function findPages($, baseUrl) {
  const pages = new Set(['/']);
  const patterns = [/\b(contact|reach|get.?in.?touch)\b/i, /\b(team|staff|people|employees|crew|directory)\b/i, /\b(about|company|who.?we.?are)\b/i, /\b(leadership|management|directors|partners|attorneys|doctors|providers)\b/i, /\b(our.?team|meet|our.?people|our.?staff)\b/i, /\b(agents?|advisors?|consultants?|specialists?)\b/i];
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href')||'';
    let path = '';
    if (href.startsWith('/') && !href.startsWith('//')) path = href;
    else if (href.includes(baseUrl)) try { path = new URL(href).pathname; } catch { return; }
    else return;
    path = path.split('?')[0].split('#')[0];
    if (path.length>1 && path.length<150 && patterns.some(p => p.test(path))) pages.add(path);
  });
  return Array.from(pages).slice(0, C.maxPages);
}

// ═══════════════════════════════════════════════════════════════════
//  FULL ENRICHMENT — website crawl + WHOIS + infer + verify
// ═══════════════════════════════════════════════════════════════════
async function enrichBusiness(biz) {
  if (!biz.website) return { ...biz, contacts: [] };
  const baseUrl = await resolveUrl(biz.website);
  if (!baseUrl) return { ...biz, contacts: [] };
  const domain = baseUrl.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'');

  const allContacts = [], allEmails = new Set(), allNamesNoEmail = [];
  let companyInfo = {};

  // ── Scrape homepage ──
  const home = await fetchUrl(baseUrl + '/');
  if (!home?.data) return { ...biz, contacts: [] };
  const $home = cheerio.load(home.data);
  const hr = extractContacts($home, baseUrl);
  for (const c of hr.contacts) { if (!allEmails.has(c.email)) { allEmails.add(c.email); allContacts.push(c); } }
  allNamesNoEmail.push(...(hr.namesWithoutEmails||[]));
  companyInfo = { ...hr.companyInfo };

  // ── Scrape subpages ──
  const subPages = findPages($home, baseUrl);
  L.dim(`${subPages.length} relevant pages`);
  for (const page of subPages.slice(1)) {
    const r = await fetchUrl(baseUrl + page);
    if (!r?.data) continue;
    const $ = cheerio.load(r.data);
    const pr = extractContacts($, baseUrl + page);
    for (const c of pr.contacts) { if (!allEmails.has(c.email)) { allEmails.add(c.email); allContacts.push(c); if (c.first_name) L.contact(`${c.first_name} ${c.last_name} ${c.title?'('+c.title+')':''}: ${c.email}`); } }
    allNamesNoEmail.push(...(pr.namesWithoutEmails||[]));
    companyInfo = { ...companyInfo, ...pr.companyInfo };
    if (allContacts.filter(c=>c.first_name).length >= 5) { L.dim('Comprehensive directory found'); break; }
    await sleep(C.delay);
  }

  // ── WHOIS lookup ──
  const whois = await lookupWhois(domain);
  if (whois) {
    const reg = whois.registrant;
    if (reg.email && validEmail(reg.email) && !allEmails.has(reg.email.toLowerCase())) {
      const e = reg.email.toLowerCase();
      allEmails.add(e);
      allContacts.push({ email: e, first_name: firstName(reg.name||''), last_name: lastName(reg.name||''), title: 'Owner (WHOIS)', phone: reg.phone||'', confidence: 'whois', source_page: 'WHOIS/RDAP' });
      L.whois(`WHOIS registrant: ${reg.name||'Unknown'} — ${e}`);
    }
    if (!biz.address && reg.address) biz.address = reg.address;
    if (whois.created) biz.year_founded = whois.created.split('-')[0];
  }

  // ── Email pattern inference ──
  const pattern = detectEmailPattern(allContacts, domain);
  if (pattern && allNamesNoEmail.length > 0) {
    L.infer(`Detected email pattern: ${pattern}@${domain} — applying to ${allNamesNoEmail.length} names`);
    for (const person of allNamesNoEmail) {
      const inferredEmail = generateEmail(pattern, person.first_name, person.last_name, domain);
      if (inferredEmail && !allEmails.has(inferredEmail)) {
        allEmails.add(inferredEmail);
        allContacts.push({ email: inferredEmail, first_name: person.first_name, last_name: person.last_name, title: person.title, phone: person.phone, confidence: 'inferred', source_page: person.source_page });
        L.infer(`${person.first_name} ${person.last_name}: ${inferredEmail}`);
      }
    }
  }

  // ── MX verification ──
  let verifiedCount = 0;
  for (const c of allContacts) {
    const mxValid = await verifyEmailMx(c.email);
    if (mxValid) {
      if (c.confidence === 'found') c.confidence = 'verified';
      if (c.confidence === 'inferred') c.confidence = 'inferred_mx_ok';
      verifiedCount++;
    } else {
      c.confidence = (c.confidence === 'inferred') ? 'inferred_no_mx' : 'no_mx';
    }
  }
  if (verifiedCount > 0) L.verify(`${verifiedCount}/${allContacts.length} emails passed MX verification`);

  // Fill gaps
  if (!biz.phone && companyInfo.phone) biz.phone = companyInfo.phone;
  if (!biz.address && companyInfo.address) biz.address = companyInfo.address;
  if (companyInfo.rating) biz.rating = companyInfo.rating;
  if (companyInfo.reviewCount) biz.review_count = companyInfo.reviewCount;

  return { ...biz, contacts: allContacts, companyInfo, enriched_at: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════════════════════
//  GOOGLE SHEETS OUTPUT
// ═══════════════════════════════════════════════════════════════════
let sheetsApi = null;
async function initSheets() {
  if (!C.sheetId) { L.warn('No GOOGLE_SPREADSHEET_ID set. Sheets disabled.'); return false; }
  try {
    const auth = new google.auth.GoogleAuth({ keyFile: C.creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    sheetsApi = google.sheets({ version:'v4', auth });
    L.ok('Google Sheets authenticated');
    return true;
  } catch (e) { L.err(`Sheets auth failed: ${e.message}`); return false; }
}

async function ensureTab(tabName) {
  try {
    const sp = await sheetsApi.spreadsheets.get({ spreadsheetId: C.sheetId });
    if (!sp.data.sheets.some(s => s.properties.title === tabName)) {
      await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId: C.sheetId, requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] } });
      L.ok(`Created tab: "${tabName}"`);
    }
    const headers = ['First Name','Last Name','Email','Title','Company Name','Location','Website','Phone','Source','Confidence','Date'];
    await sheetsApi.spreadsheets.values.update({ spreadsheetId: C.sheetId, range: `'${tabName}'!A1:K1`, valueInputOption:'RAW', requestBody: { values: [headers] } });
    const sheetData = await sheetsApi.spreadsheets.get({ spreadsheetId: C.sheetId });
    const sheet = sheetData.data.sheets.find(s => s.properties.title === tabName);
    if (sheet) {
      await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId: C.sheetId, requestBody: { requests: [
        { repeatCell: { range: { sheetId: sheet.properties.sheetId, startRowIndex:0, endRowIndex:1, startColumnIndex:0, endColumnIndex:11 }, cell: { userEnteredFormat: { textFormat: { bold:true }, backgroundColor: { red:0.15, green:0.15, blue:0.2 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
        { updateSheetProperties: { properties: { sheetId: sheet.properties.sheetId, gridProperties: { frozenRowCount:1 } }, fields: 'gridProperties.frozenRowCount' } }
      ] } });
    }
  } catch (e) { L.err(`Tab setup error: ${e.message}`); }
}

function toRows(bizList) {
  const rows = [], today = new Date().toISOString().split('T')[0];
  for (const b of bizList) {
    const co=b.company_name||'', loc=[b.city,b.state].filter(Boolean).join(', '), web=b.website||'', ph=b.phone||'', src=(b.sources||[b.source||'']).filter(Boolean).join(', ');
    if (b.contacts?.length) { for (const c of b.contacts) rows.push([c.first_name||'',c.last_name||'',c.email||'',c.title||'',co,loc,web,c.phone||ph,src,c.confidence||'found',today]); }
    else rows.push(['','','','',co,loc,web,ph,src,'',today]);
  }
  return rows;
}

async function pushRows(tabName, bizList) {
  if (!sheetsApi) return;
  const rows = toRows(bizList);
  if (!rows.length) return;
  try { await sheetsApi.spreadsheets.values.append({ spreadsheetId: C.sheetId, range: `'${tabName}'!A:K`, valueInputOption:'RAW', insertDataOption:'INSERT_ROWS', requestBody: { values: rows } }); }
  catch (e) { L.err(`Sheet push failed: ${e.message}`); }
}

// ═══════════════════════════════════════════════════════════════════
//  JOB CONTROL
// ═══════════════════════════════════════════════════════════════════
function saveState(s) { writeFileSync(C.stateFile, JSON.stringify(s, null, 2)); }
function loadState() { try { return existsSync(C.stateFile) ? JSON.parse(readFileSync(C.stateFile,'utf8')) : null; } catch { return null; } }
function clearState() { for (const f of [C.stateFile,C.pauseFile,C.stopFile]) try { if(existsSync(f)) unlinkSync(f); } catch {} }
function isPaused() { return existsSync(C.pauseFile); }
function isStopped() { return existsSync(C.stopFile); }
async function waitPause() { if(!isPaused()) return; L.warn('⏸  PAUSED — run "node engine.js resume"'); while(isPaused()&&!isStopped()) await sleep(2000); if(!isStopped()) L.ok('▶  RESUMED'); }

// ═══════════════════════════════════════════════════════════════════
//  MAIN PIPELINE — 6 phases
// ═══════════════════════════════════════════════════════════════════
async function run(stateAbbr, opts = {}) {
  const st = STATES[stateAbbr.toUpperCase()];
  if (!st) { L.err(`Unknown state: ${stateAbbr}. Use: ${Object.keys(STATES).join(', ')}`); process.exit(1); }
  const cats = opts.categories || CATS;
  const cities = opts.cities || st.cities;
  const max = opts.max || C.maxBiz;

  console.log(`\n\x1b[1m\x1b[34m╔════════════════════════════════════════════════════════════════════╗
║  🔍 BUSINESS DISCOVERY ENGINE v4.0                                 ║
║  State: ${(st.name+' ('+st.abbr+')').padEnd(57)}║
║  Categories: ${String(cats.length).padEnd(52)}║
║  Cities: ${String(cities.length).padEnd(56)}║
║  Max: ${String(max).padEnd(60)}║
║                                                                    ║
║  Pipeline: Discover → Dedupe → Websites → WHOIS →                 ║
║            Enrich → Infer Emails → MX Verify → Sheets             ║
╚════════════════════════════════════════════════════════════════════╝\x1b[0m\n`);

  const saved = loadState();
  let allBiz = [], startPhase = 1, enrichIdx = 0;
  if (saved && saved.st === stateAbbr.toUpperCase() && !opts.fresh) {
    L.info(`Resuming: Phase ${saved.phase}, ${saved.discovered||0} discovered, ${saved.enriched||0} enriched`);
    allBiz = saved.biz || []; startPhase = saved.phase || 1; enrichIdx = saved.enrichIdx || 0;
  }
  for (const f of [C.pauseFile, C.stopFile]) try { if(existsSync(f)) unlinkSync(f); } catch {}

  const sheetsOk = await initSheets();
  if (sheetsOk) await ensureTab(st.tab);
  const t0 = Date.now();

  // PHASE 1: DISCOVERY
  if (startPhase <= 1) {
    L.phase('PHASE 1: MULTI-SOURCE DISCOVERY (YP + Yelp + BBB)');
    await waitPause(); if(isStopped()){saveState({st:stateAbbr.toUpperCase(),phase:1,biz:allBiz});return;}
    allBiz.push(...await discoverYP(st, cats, cities, max));
    await waitPause(); if(isStopped()){saveState({st:stateAbbr.toUpperCase(),phase:1,biz:allBiz});return;}
    allBiz.push(...await discoverYelp(st, cats, cities, Math.round(max/2)));
    await waitPause(); if(isStopped()){saveState({st:stateAbbr.toUpperCase(),phase:1,biz:allBiz});return;}
    allBiz.push(...await discoverBBB(st, cats, cities, Math.round(max/3)));
    L.ok(`Discovery: ${allBiz.length} total records`);
    saveState({st:stateAbbr.toUpperCase(),phase:2,biz:allBiz,discovered:allBiz.length});
  }

  // PHASE 2: DEDUP
  if (startPhase <= 2) {
    L.phase('PHASE 2: ENTITY RESOLUTION & DEDUPLICATION');
    allBiz = dedupe(allBiz);
    saveState({st:stateAbbr.toUpperCase(),phase:3,biz:allBiz,discovered:allBiz.length,enrichIdx:0});
  }

  // PHASE 3: FIND MISSING WEBSITES
  if (startPhase <= 3) {
    L.phase('PHASE 3: FINDING MISSING WEBSITES (Google Search)');
    await waitPause(); if(isStopped()){saveState({st:stateAbbr.toUpperCase(),phase:3,biz:allBiz});return;}
    allBiz = await findMissingWebsites(allBiz);
    saveState({st:stateAbbr.toUpperCase(),phase:4,biz:allBiz,discovered:allBiz.length,enrichIdx});
  }

  // PHASE 4: ENRICHMENT (website crawl + WHOIS + infer + verify + push)
  if (startPhase <= 4) {
    L.phase('PHASE 4: ENRICH → WHOIS → INFER → VERIFY → PUSH');
    const withSites = allBiz.filter(b => b.website);
    const noSites = allBiz.filter(b => !b.website);
    L.info(`${withSites.length} with websites | ${noSites.length} without`);

    if (enrichIdx === 0 && sheetsOk && noSites.length) { await pushRows(st.tab, noSites); L.ok(`Pushed ${noSites.length} businesses (no website)`); }

    let enriched = enrichIdx;
    for (let i = enrichIdx; i < withSites.length; i++) {
      await waitPause();
      if (isStopped()) { saveState({st:stateAbbr.toUpperCase(),phase:4,biz:allBiz,discovered:allBiz.length,enrichIdx:i,enriched}); L.warn(`Stopped at ${i}/${withSites.length}`); return; }
      const b = withSites[i];
      console.log('');
      L.info(`[${i+1}/${withSites.length}] ${b.company_name} — ${b.website}`);
      try {
        const eb = await enrichBusiness(b);
        const idx = allBiz.findIndex(x => x.company_name===b.company_name && x.website===b.website);
        if (idx>=0) allBiz[idx] = eb;
        if (sheetsOk) await pushRows(st.tab, [eb]);
        enriched++;
        const v = eb.contacts?.filter(c => c.confidence?.includes('verified')||c.confidence?.includes('mx_ok')).length || 0;
        const inf = eb.contacts?.filter(c => c.confidence?.includes('inferred')).length || 0;
        L.ok(`${b.company_name}: ${eb.contacts?.length||0} contacts (${v} verified, ${inf} inferred)`);
      } catch (e) { L.warn(`Failed: ${b.company_name}: ${e.message}`); if(sheetsOk) await pushRows(st.tab,[b]); }
      if (i%10===0) saveState({st:stateAbbr.toUpperCase(),phase:4,biz:allBiz,discovered:allBiz.length,enrichIdx:i+1,enriched});
    }
  }

  // SUMMARY
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const totalContacts = allBiz.reduce((s,b) => s+(b.contacts?.length||0), 0);
  const verified = allBiz.reduce((s,b) => s+(b.contacts?.filter(c=>c.confidence?.includes('verified')||c.confidence?.includes('mx_ok')).length||0), 0);
  const inferred = allBiz.reduce((s,b) => s+(b.contacts?.filter(c=>c.confidence?.includes('inferred')).length||0), 0);
  const whoisContacts = allBiz.reduce((s,b) => s+(b.contacts?.filter(c=>c.confidence==='whois').length||0), 0);

  // CSV backup
  const csvH = 'First Name,Last Name,Email,Title,Company Name,Location,Website,Phone,Source,Confidence,Date';
  const csvRows = toRows(allBiz);
  const csv = csvH + '\n' + csvRows.map(r => r.map(c => `"${(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const csvFile = `discovery-${stateAbbr.toUpperCase()}-${new Date().toISOString().split('T')[0]}.csv`;
  await fs.writeFile(csvFile, csv);
  clearState();

  console.log(`\n\x1b[1m\x1b[32m╔════════════════════════════════════════════════════════════════════╗
║  🎉 COMPLETE — ${st.name.toUpperCase().padEnd(52)}║
╠════════════════════════════════════════════════════════════════════╣
║  📊 Businesses discovered:   ${String(allBiz.length).padEnd(38)}║
║  👥 Total contacts:          ${String(totalContacts).padEnd(38)}║
║  ✅ MX-verified emails:      ${String(verified).padEnd(38)}║
║  🧠 Pattern-inferred emails: ${String(inferred).padEnd(38)}║
║  🔍 WHOIS contacts:          ${String(whoisContacts).padEnd(38)}║
║  🌐 With websites:           ${String(allBiz.filter(b=>b.website).length).padEnd(38)}║
║  ⏱️  Time: ${String(Math.floor(elapsed/60)+'m '+elapsed%60+'s').padEnd(55)}║
║  📁 CSV: ${csvFile.padEnd(57)}║
╚════════════════════════════════════════════════════════════════════╝\x1b[0m
${C.sheetId ? `\x1b[36m📎 https://docs.google.com/spreadsheets/d/${C.sheetId}/edit\x1b[0m` : ''}\n`);
}

// ═══════════════════════════════════════════════════════════════════
//  CLI ROUTER
// ═══════════════════════════════════════════════════════════════════
function parseArgs(args) {
  const o = {};
  for (let i=0; i<args.length; i++) {
    if (args[i]==='--state' && args[i+1]) o.state=args[++i].toUpperCase();
    else if (args[i]==='--categories' && args[i+1]) o.categories=args[++i].split(',').map(s=>s.trim());
    else if (args[i]==='--cities' && args[i+1]) o.cities=args[++i].split(',').map(s=>s.trim());
    else if (args[i]==='--max' && args[i+1]) o.max=parseInt(args[++i]);
    else if (args[i]==='--fresh') o.fresh=true;
    else if (args[i]==='--no-sheets') o.noSheets=true;
  }
  return o;
}

function help() {
  console.log(`
\x1b[1m\x1b[34m╔════════════════════════════════════════════════════════════════════╗
║  BUSINESS DISCOVERY ENGINE v4.0 — Command Reference                ║
╚════════════════════════════════════════════════════════════════════╝\x1b[0m

\x1b[1mSTART A DISCOVERY RUN:\x1b[0m
  node engine.js start --state AZ                    Full Arizona run
  node engine.js start --state OH --max 100          Ohio, cap at 100
  node engine.js start --state WA --categories "plumber,dentist"
  node engine.js start --state ID --cities "Boise,Meridian" --fresh
  node engine.js start --state AZ --no-sheets        Skip Google Sheets

\x1b[1mJOB CONTROL:\x1b[0m
  node engine.js pause     Pause after current business finishes
  node engine.js resume    Resume from saved checkpoint
  node engine.js stop      Stop and save progress
  node engine.js status    Show current job status
  node engine.js reset     Clear all saved state

\x1b[1mSTATES:\x1b[0m  ${Object.entries(STATES).map(([k,v])=>`${k} (${v.name})`).join(', ')}

\x1b[1mPIPELINE (6 phases):\x1b[0m
  1. Discover    Yellow Pages (paginated) + Yelp + BBB
  2. Dedupe      Entity resolution across sources
  3. Websites    Google search for businesses missing a website
  4. Enrich      Crawl websites (9 extraction methods) + WHOIS/RDAP
  5. Infer       Detect email patterns → generate missing emails
  6. Verify      MX record check on all emails

\x1b[1mEXTRACTION METHODS:\x1b[0m
  JSON-LD/Schema.org · mailto: links · data-attributes · staff cards
  regex sweep · obfuscated emails · footer data · meta tags · tel: links

\x1b[1mCONFIDENCE LEVELS:\x1b[0m
  verified         Found on page + MX records valid
  found            Found on page (MX not checked or failed)
  inferred_mx_ok   Generated from pattern + MX valid
  inferred         Generated from pattern (MX not checked)
  whois            Extracted from public WHOIS/RDAP data

\x1b[1mOUTPUT COLUMNS:\x1b[0m
  First Name | Last Name | Email | Title | Company | Location |
  Website | Phone | Source | Confidence | Date
  `);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);

  switch (cmd) {
    case 'start':
      if (!opts.state) { L.err('Need --state. Example: node engine.js start --state AZ'); process.exit(1); }
      if (opts.noSheets) C.sheetId = '';
      await run(opts.state, opts);
      break;
    case 'pause': writeFileSync(C.pauseFile, new Date().toISOString()); L.ok('⏸  Pause signal sent'); break;
    case 'resume': {
      try{if(existsSync(C.pauseFile))unlinkSync(C.pauseFile);}catch{}
      try{if(existsSync(C.stopFile))unlinkSync(C.stopFile);}catch{}
      const s=loadState();
      if(s){L.ok(`▶  Resuming ${s.st} Phase ${s.phase}`);await run(s.st,opts);}
      else L.warn('No saved state. Use "start --state XX"');
      break;
    }
    case 'stop': writeFileSync(C.stopFile, new Date().toISOString()); L.ok('⏹  Stop signal sent'); break;
    case 'status': {
      const s=loadState();
      if(!s){console.log('\n  Status: \x1b[90mIDLE\x1b[0m\n');break;}
      const label=isStopped()?'\x1b[31mSTOPPED\x1b[0m':isPaused()?'\x1b[33mPAUSED\x1b[0m':'\x1b[32mRUNNING\x1b[0m';
      console.log(`\n  Status: ${label}\n  State: ${s.st}\n  Phase: ${s.phase}/4\n  Discovered: ${s.discovered||0}\n  Enriched: ${s.enriched||0}\n`);
      break;
    }
    case 'reset': clearState(); L.ok('State cleared'); break;
    case 'states': console.log(''); Object.entries(STATES).forEach(([k,v])=>console.log(`  \x1b[36m${k}\x1b[0m ${v.name} — ${v.cities.join(', ')}`)); console.log(''); break;
    default: help();
  }
}

main().catch(e => { L.err(`Fatal: ${e.message}`); console.error(e.stack); process.exit(1); });
