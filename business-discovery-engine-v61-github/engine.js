#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 *  BUSINESS DISCOVERY ENGINE v6.1 — ROUND-ROBIN + LIVE ENRICH
 *  Apollo-level business intelligence from 100% public data
 *
 *  v6.1 Upgrades:
 *  - INTERLEAVED: Discover chunk → Enrich → Push to Sheets → Rotate
 *  - Data flows into Sheets IMMEDIATELY, not after all discovery
 *  - Each category chunk: find business → visit website → extract all data → push
 *  - ROUND-ROBIN: Shuffle states + sources within each category
 *  - 1,000 per CATEGORY (not per state) — 65,000 max total
 *  - Rotate category every 250 discoveries (configurable)
 *  - Global dedup — zero duplicates across all states/sources
 *  - Single command: --state ALL runs everything
 *  - Per-category checkpoint + crash recovery
 *
 *  v5 Features (retained):
 *  - 65 business categories (retail, ecommerce, health, home)
 *  - Social media extraction (FB, IG, LinkedIn, Twitter)
 *  - Business age scoring from WHOIS (new biz flagging)
 *  - Google Maps as discovery source
 *  - Smarter Yelp (stealth scrolling, retry, auto-skip)
 *  - Batch Sheets push (10 rows at a time)
 *  - Proxy rotation support
 *  - LIVE DASHBOARD tab (stats, rates, errors, per-source)
 *  - 5 states: AZ, NV, OH, ID, WA
 *
 *  Author: John Williams | It All Started With A Idea
 *  License: MIT
 * ═══════════════════════════════════════════════════════════════════
 */
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());

import axios from 'axios';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { promisify } from 'util';
import dns from 'dns';
import dotenv from 'dotenv';
dotenv.config();

const dnsResolveMx = promisify(dns.resolveMx);

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════
const C = {
  sheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
  creds: process.env.GOOGLE_CREDENTIALS_PATH || 'google-credentials.json',
  delay: parseInt(process.env.DELAY_MS) || 3000,
  maxPages: parseInt(process.env.MAX_PAGES_PER_SITE) || 15,
  maxPerCat: parseInt(process.env.MAX_PER_CATEGORY) || 1000,  // per category across all states/sources
  chunkSize: parseInt(process.env.CHUNK_SIZE) || 250,          // rotate category after N new discoveries
  proxy: process.env.PROXY_URL || '',        // optional: http://user:pass@host:port
  timeout: 20000,
  batchSize: 10,                              // push N rows to Sheets at once
  dashboardInterval: 30000,                   // update dashboard every 30s
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
  NV: { name:'Nevada', abbr:'NV', tab:'Nevada', yp:'nv', cities:['Las Vegas','Henderson','Reno','North Las Vegas','Sparks','Carson City','Mesquite','Boulder City','Elko','Fernley'] },
  OH: { name:'Ohio', abbr:'OH', tab:'Ohio', yp:'oh', cities:['Columbus','Cleveland','Cincinnati','Toledo','Akron','Dayton','Canton','Youngstown','Dublin','Westerville','Mason','Parma'] },
  ID: { name:'Idaho', abbr:'ID', tab:'Idaho', yp:'id', cities:['Boise','Meridian','Nampa','Caldwell','Idaho Falls','Pocatello','Twin Falls',"Coeur d'Alene",'Lewiston','Eagle'] },
  WA: { name:'Washington', abbr:'WA', tab:'Washington', yp:'wa', cities:['Seattle','Spokane','Tacoma','Vancouver','Bellevue','Kent','Everett','Renton','Kirkland','Redmond','Olympia','Bellingham'] }
};

// ═══════════════════════════════════════════════════════════════════
//  60+ CATEGORIES
// ═══════════════════════════════════════════════════════════════════
const CATS = [
  // Original local services
  'plumber','electrician','dentist','restaurant','auto repair','salon',
  'law firm','accountant','real estate agent','roofing','hvac',
  'cleaning service','landscaping','insurance agent','veterinarian',
  'fitness','photography','marketing agency','construction','mechanic',
  'chiropractor','bakery','florist','pet grooming','daycare','tutoring',
  'printing','tailor','locksmith','moving company',
  // Retail & Ecommerce
  'boutique','jewelry store','furniture store','sporting goods','pet store',
  'gift shop','wine shop','supplement store','thrift store','consignment shop',
  // Food & Beverage
  'coffee shop','brewery','catering','food truck','juice bar',
  // Health & Wellness
  'med spa','dermatologist','physical therapy','optometrist',
  'mental health counselor','massage therapist',
  // Professional Services
  'financial advisor','mortgage broker','staffing agency','IT services',
  'web design','commercial cleaning',
  // Home Services
  'garage door','pest control','fence company','pool service',
  'solar installer','window cleaning','tree service','pressure washing'
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
  'locksmith':'locks-locksmiths','moving company':'movers',
  'boutique':'boutiques','jewelry store':'jewelers','furniture store':'furniture-stores',
  'sporting goods':'sporting-goods','pet store':'pet-shops','gift shop':'gift-shops',
  'wine shop':'wine','supplement store':'health-food-stores',
  'thrift store':'thrift-shops','consignment shop':'consignment-shops',
  'coffee shop':'coffee-shops','brewery':'breweries','catering':'caterers',
  'food truck':'food-trucks','juice bar':'juice-bars',
  'med spa':'medical-spas','dermatologist':'dermatologists',
  'physical therapy':'physical-therapists','optometrist':'optometrists',
  'mental health counselor':'counseling-services','massage therapist':'massage-therapists',
  'financial advisor':'financial-advisors','mortgage broker':'mortgage-brokers',
  'staffing agency':'employment-agencies','IT services':'computer-network-design',
  'web design':'web-design','commercial cleaning':'janitorial-service',
  'garage door':'garage-doors','pest control':'pest-control-services',
  'fence company':'fence-contractors','pool service':'swimming-pool-service-repair',
  'solar installer':'solar-energy-contractors','window cleaning':'window-cleaning',
  'tree service':'tree-service','pressure washing':'pressure-washing-service'
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
  social:  m => console.log(`\x1b[35m   🔗 ${m}\x1b[0m`),
};

// ═══════════════════════════════════════════════════════════════════
//  LIVE DASHBOARD — tracks everything in real-time
// ═══════════════════════════════════════════════════════════════════
const STATS = {
  startTime: null,
  currentState: '',
  currentPhase: '',
  // Discovery
  yp: { found: 0, errors: 0, blocked: 0 },
  yelp: { found: 0, errors: 0, blocked: 0, skipped: 0 },
  bbb: { found: 0, errors: 0, blocked: 0 },
  gmaps: { found: 0, errors: 0, blocked: 0 },
  totalDiscovered: 0,
  totalAfterDedup: 0,
  // Enrichment
  enriched: 0,
  enrichErrors: 0,
  websitesFound: 0,
  websitesMissing: 0,
  // Contacts
  emailsFound: 0,
  emailsVerified: 0,
  emailsInferred: 0,
  emailsWhois: 0,
  emailsNoMx: 0,
  // Social
  facebookFound: 0,
  instagramFound: 0,
  linkedinFound: 0,
  twitterFound: 0,
  // Business age
  newBiz: 0,  // < 2 years
  estBiz: 0,  // 2+ years
  // Sheets
  rowsPushed: 0,
  sheetErrors: 0,
  // Per-state
  statesCompleted: [],
  stateResults: {},
  // Errors log (last 20)
  recentErrors: [],
};

function logError(source, msg) {
  STATS.recentErrors.push({ time: new Date().toISOString().substring(11, 19), source, msg: msg.substring(0, 100) });
  if (STATS.recentErrors.length > 20) STATS.recentErrors.shift();
}

// Rebuild STATS from actual biz data (for resume after crash/sleep)
function recomputeStats(allBiz, phase, enrichIdx) {
  // Reset counters
  STATS.yp.found = 0; STATS.yelp.found = 0; STATS.bbb.found = 0; STATS.gmaps.found = 0;
  STATS.emailsFound = 0; STATS.emailsVerified = 0; STATS.emailsInferred = 0; STATS.emailsWhois = 0;
  STATS.facebookFound = 0; STATS.instagramFound = 0; STATS.linkedinFound = 0; STATS.twitterFound = 0;
  STATS.newBiz = 0; STATS.estBiz = 0;

  // Discovery counts by source
  for (const b of allBiz) {
    const src = Array.isArray(b.sources) ? b.sources : [b.source || ''];
    for (const s of src) {
      if (s === 'yellowpages') STATS.yp.found++;
      else if (s === 'yelp') STATS.yelp.found++;
      else if (s === 'bbb') STATS.bbb.found++;
      else if (s === 'google_maps' || s === 'googlemaps') STATS.gmaps.found++;
    }
  }
  STATS.totalDiscovered = allBiz.length;
  STATS.totalAfterDedup = allBiz.length; // already deduped if phase >= 2

  // Enrichment
  const withSites = allBiz.filter(b => b.website);
  const enriched = Math.min(enrichIdx || withSites.length, withSites.length);
  STATS.enriched = enriched;
  STATS.websitesFound = withSites.length;
  STATS.websitesMissing = allBiz.length - withSites.length;

  // Contacts, social, age from actual data
  for (const b of allBiz) {
    if (b.contacts?.length) {
      for (const c of b.contacts) {
        STATS.emailsFound++;
        const conf = String(c.confidence || '');
        if (conf.includes('verified') || conf.includes('mx_ok')) STATS.emailsVerified++;
        if (conf.includes('inferred')) STATS.emailsInferred++;
        if (conf === 'whois') STATS.emailsWhois++;
      }
    }
    if (b.companyInfo?.facebook) STATS.facebookFound++;
    if (b.companyInfo?.instagram) STATS.instagramFound++;
    if (b.companyInfo?.linkedin) STATS.linkedinFound++;
    if (b.companyInfo?.twitter) STATS.twitterFound++;
    if (b.age_label) {
      if (b.age_label.startsWith('NEW')) STATS.newBiz++;
      else STATS.estBiz++;
    }
  }
  L.info(`Stats rebuilt: ${allBiz.length} biz, ${STATS.emailsFound} emails, ${STATS.emailsVerified} verified, ${STATS.facebookFound} FB, ${STATS.instagramFound} IG, ${STATS.linkedinFound} LI`);
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));
const randDelay = (base, variance) => base + Math.floor(Math.random() * variance);

// Fisher-Yates shuffle
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

// Global dedup key — normalized name + city + state
function dedupKey(biz) {
  const n = (biz.company_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const c = (biz.city || '').toLowerCase().replace(/[^a-z]/g, '');
  const s = (biz.state || '').toLowerCase().replace(/[^a-z]/g, '');
  return `${n}|${c}|${s}`;
}

async function fetchUrl(url, opts = {}) {
  try {
    const config = {
      headers: { 'User-Agent': C.ua, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5', ...opts.headers },
      timeout: opts.timeout || C.timeout, maxRedirects: 10, validateStatus: s => s < 400
    };
    if (C.proxy && !opts.noProxy) {
      const { default: HttpsProxyAgent } = await import('https-proxy-agent').catch(() => ({ default: null }));
      if (HttpsProxyAgent) config.httpsAgent = new HttpsProxyAgent(C.proxy);
    }
    const r = await axios.get(url, config);
    const ct = r.headers['content-type'] || '';
    if (ct.includes('text/html') || ct.includes('text/xml') || ct.includes('application/json'))
      return { data: r.data, url: r.request?.res?.responseUrl || url };
    return null;
  } catch { return null; }
}

async function fetchJSON(url) {
  try { const r = await axios.get(url, { headers: { 'User-Agent': C.ua, 'Accept': 'application/json' }, timeout: 15000 }); return r.data; }
  catch { return null; }
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
//  BROWSER MANAGEMENT — with proxy support
// ═══════════════════════════════════════════════════════════════════
let browser = null;

async function launchBrowser() {
  if (browser) return browser;
  L.info('Launching headless Chrome with stealth mode...');
  const args = [
    '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas','--disable-gpu','--window-size=1920,1080',
    '--disable-blink-features=AutomationControlled',
    '--lang=en-US,en'
  ];
  if (C.proxy) {
    args.push(`--proxy-server=${C.proxy}`);
    L.info(`Using proxy: ${C.proxy.replace(/:[^:]*@/, ':***@')}`);
  }
  browser = await puppeteer.launch({
    headless: 'new', args,
    defaultViewport: { width: 1920, height: 1080 }
  });
  L.ok('Browser launched');
  return browser;
}

async function closeBrowser() { if (browser) { try { await browser.close(); } catch {} browser = null; } }

async function getPage() {
  const b = await launchBrowser();
  const page = await b.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  // Randomize fingerprint slightly
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });
  return page;
}

async function humanScroll(page) {
  try {
    await page.evaluate(async () => {
      await new Promise(r => {
        let y = 0; const max = document.body.scrollHeight;
        const step = () => { y += 200 + Math.random() * 300; window.scrollTo(0, y); if (y < max) setTimeout(step, 100 + Math.random() * 200); else r(); };
        step();
      });
    });
  } catch {}
}

async function navigateAndWait(page, url, waitSelector, timeoutMs = 20000) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
    if (waitSelector) await page.waitForSelector(waitSelector, { timeout: 8000 }).catch(() => {});
    await sleep(1000 + Math.random() * 1000);
    await humanScroll(page);
    await sleep(500);
    return await page.content();
  } catch (e) {
    L.warn(`Nav timeout: ${url.substring(0, 80)}`);
    try { return await page.content(); } catch { return null; }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  REGEX PATTERNS
// ═══════════════════════════════════════════════════════════════════
const RE_EMAIL = /\b[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}\b/g;
const RE_PHONE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?:\s*(?:ext|x|ext\.)?\s*\d{1,5})?/gi;
const RE_ADDRESS = /\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z][a-zA-Z]+(?:\s+[A-Za-z]+){0,4}\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Loop|Trail|Tr|Pike|Run|Pass|Row)\.?(?:\s*(?:#|Ste|Suite|Apt|Unit|Bldg|Floor|Fl)\s*[A-Za-z0-9-]+)?/gi;
const RE_OBFUSC = /\b[a-zA-Z0-9._-]+\s*[\[({]?\s*at\s*[\])}]?\s*[a-zA-Z0-9.-]+\s*[\[({]?\s*dot\s*[\])}]?\s*[a-zA-Z]{2,}\b/gi;

// Social media patterns
const RE_FACEBOOK = /https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+\/?/gi;
const RE_INSTAGRAM = /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._-]+\/?/gi;
const RE_LINKEDIN = /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._-]+\/?/gi;
const RE_TWITTER = /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[a-zA-Z0-9._-]+\/?/gi;

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
//  SOCIAL MEDIA EXTRACTION
// ═══════════════════════════════════════════════════════════════════
function extractSocialMedia($, html) {
  const social = {};
  const text = html || '';

  // From href attributes
  $('a[href*="facebook.com"]').each((_, a) => {
    const h = $(a).attr('href') || '';
    if (!social.facebook && /facebook\.com\/[a-zA-Z0-9]/.test(h) && !/facebook\.com\/(sharer|dialog|share|login|plugins)/.test(h))
      social.facebook = h.split('?')[0];
  });
  $('a[href*="instagram.com"]').each((_, a) => {
    const h = $(a).attr('href') || '';
    if (!social.instagram && /instagram\.com\/[a-zA-Z0-9]/.test(h) && !/instagram\.com\/(accounts|explore|p\/)/.test(h))
      social.instagram = h.split('?')[0];
  });
  $('a[href*="linkedin.com"]').each((_, a) => {
    const h = $(a).attr('href') || '';
    if (!social.linkedin && /linkedin\.com\/(company|in)\//.test(h))
      social.linkedin = h.split('?')[0];
  });
  $('a[href*="twitter.com"], a[href*="x.com"]').each((_, a) => {
    const h = $(a).attr('href') || '';
    if (!social.twitter && /(?:twitter|x)\.com\/[a-zA-Z0-9]/.test(h) && !/(?:twitter|x)\.com\/(share|intent|home|search)/.test(h))
      social.twitter = h.split('?')[0];
  });

  // Fallback: regex on raw HTML for inline URLs
  if (!social.facebook) { RE_FACEBOOK.lastIndex = 0; const m = text.match(RE_FACEBOOK); if (m) social.facebook = m[0].split('?')[0]; }
  if (!social.instagram) { RE_INSTAGRAM.lastIndex = 0; const m = text.match(RE_INSTAGRAM); if (m) social.instagram = m[0].split('?')[0]; }
  if (!social.linkedin) { RE_LINKEDIN.lastIndex = 0; const m = text.match(RE_LINKEDIN); if (m) social.linkedin = m[0].split('?')[0]; }
  if (!social.twitter) { RE_TWITTER.lastIndex = 0; const m = text.match(RE_TWITTER); if (m) social.twitter = m[0].split('?')[0]; }

  return social;
}

// ═══════════════════════════════════════════════════════════════════
//  SOURCE 1: YELLOW PAGES (Puppeteer)
// ═══════════════════════════════════════════════════════════════════
async function discoverYP(state, categories, cities, max) {
  const biz = [];
  L.info(`Yellow Pages — ${state.name} (${categories.length} cats × ${cities.length} cities)`);
  const page = await getPage();
  try {
    for (const cat of categories) {
      for (const city of cities) {
        if (biz.length >= max) break;
        const slug = YP_SLUG[cat] || cat.toLowerCase().replace(/\s+/g, '-') + 's';
        const citySlug = city.toLowerCase().replace(/\s+/g, '-').replace(/'/g, '');
        for (let pg = 1; pg <= 3; pg++) {
          if (biz.length >= max) break;
          const url = `https://www.yellowpages.com/${citySlug}-${state.yp}/${slug}${pg > 1 ? `?page=${pg}` : ''}`;
          const html = await navigateAndWait(page, url, '.search-results');
          if (!html) { STATS.yp.errors++; logError('YP', `No HTML: ${city} ${cat}`); break; }
          const $ = cheerio.load(html);
          if (/challenge|captcha|blocked|access denied/i.test($('title').text())) { STATS.yp.blocked++; logError('YP', `Blocked: ${city}`); await sleep(randDelay(10000, 5000)); break; }
          let found = 0;
          const selectors = ['.result .business-name a', '.info h2 a', 'a[href*="/mip/"]', '.srp-listing h2 a', '.v-card .info h2 a'];
          let $links = $();
          for (const sel of selectors) { $links = $(sel); if ($links.length > 0) break; }
          $links.each((_, a) => {
            if (biz.length >= max) return;
            let name = $(a).text().trim().replace(/^\d+\.\s*/, '');
            if (!name || name.length < 3 || name.length > 200) return;
            if (/^(browse|search|find|sort|sign|log|yellow pages|advertise|claim)/i.test(name)) return;
            if (biz.some(b => b.company_name === name && b.city === city)) return;
            let $box = $(a);
            for (let i = 0; i < 8; i++) { $box = $box.parent(); if (!$box.length) break; if ($box.text().length > 100 && /\(\d{3}\)/.test($box.text())) break; }
            const boxText = $box.text();
            RE_PHONE.lastIndex = 0; const phone = (boxText.match(RE_PHONE) || [])[0] || '';
            RE_ADDRESS.lastIndex = 0; const addr = (boxText.match(RE_ADDRESS) || [])[0] || '';
            let website = '';
            $box.find('a[href^="http"]').each((_, l) => { const h = $(l).attr('href') || ''; if (website) return; if (/yellowpages|yp\.com|intelius|thryv|superpages|dexknows/i.test(h)) return; const t = $(l).text().toLowerCase(); if (t.includes('website') || t.includes('visit')) website = h; });
            if (!website) $box.find('a.track-visit-website, a[data-analytics="visit_website"]').each((_, l) => { if (!website) website = $(l).attr('href') || ''; });
            biz.push({ source: 'yellowpages', company_name: name, phone, address: addr, city, state: state.name, website, industry: cat });
            found++; STATS.yp.found++;
          });
          if (found === 0) break;
          L.dim(`YP "${cat}" ${city} p${pg}: +${found} (${biz.length} total)`);
          await sleep(randDelay(C.delay, 2000));
        }
      }
      if (biz.length >= max) break;
    }
  } catch (e) { STATS.yp.errors++; logError('YP', e.message); }
  finally { await page.close(); }
  L.ok(`Yellow Pages: ${biz.length} businesses`);
  return biz;
}

// ═══════════════════════════════════════════════════════════════════
//  SOURCE 2: YELP (Puppeteer + Stealth — auto-skip after failures)
// ═══════════════════════════════════════════════════════════════════
async function discoverYelp(state, categories, cities, max) {
  const biz = [];
  let consecutiveFails = 0;
  const MAX_FAILS = 5; // skip Yelp entirely after 5 consecutive failures
  L.info(`Yelp — ${state.name} (will auto-skip after ${MAX_FAILS} consecutive blocks)`);
  const page = await getPage();
  try {
    for (const cat of categories) {
      if (consecutiveFails >= MAX_FAILS) { L.warn(`Yelp: skipping remaining categories (${consecutiveFails} consecutive blocks)`); STATS.yelp.skipped += (categories.length * cities.length); break; }
      for (const city of cities.slice(0, 5)) {
        if (biz.length >= max || consecutiveFails >= MAX_FAILS) break;
        const url = `https://www.yelp.com/search?find_desc=${encodeURIComponent(cat)}&find_loc=${encodeURIComponent(city + ', ' + state.abbr)}`;
        const html = await navigateAndWait(page, url, 'a[href*="/biz/"]', 15000);
        if (!html || html.length < 2000) {
          consecutiveFails++; STATS.yelp.blocked++;
          logError('Yelp', `Blocked/empty: ${city} ${cat} (fail ${consecutiveFails}/${MAX_FAILS})`);
          await sleep(randDelay(5000, 3000));
          continue;
        }
        const $ = cheerio.load(html);
        if (/enable JS|captcha|unusual traffic|access denied/i.test($.text().substring(0, 500))) {
          consecutiveFails++; STATS.yelp.blocked++;
          logError('Yelp', `JS challenge: ${city} ${cat}`);
          await sleep(randDelay(8000, 5000));
          continue;
        }
        const seen = new Set(); let found = 0;
        $('a[href*="/biz/"]').each((_, a) => {
          if (biz.length >= max) return;
          const href = $(a).attr('href') || '';
          const bizSlug = href.match(/\/biz\/([\w-]+)/);
          if (!bizSlug || seen.has(bizSlug[1])) return;
          seen.add(bizSlug[1]);
          let name = $(a).text().trim().replace(/^\d+\.\s*/, '');
          if (!name || name.length < 3 || name.length > 150) return;
          if (/^(yelp|more|see|read|write|photo|map|direction|filter|review|claim|sign|get|request|ad\b)/i.test(name)) return;
          if (biz.some(b => b.company_name === name && b.city === city)) return;
          const $c = $(a).closest('[class]').parent().parent();
          RE_PHONE.lastIndex = 0;
          biz.push({ source: 'yelp', company_name: name, phone: ($c.text().match(RE_PHONE) || [])[0] || '', address: '', city, state: state.name, website: '', industry: cat });
          found++; STATS.yelp.found++;
        });
        if (found > 0) { consecutiveFails = 0; L.dim(`Yelp "${cat}" ${city}: +${found} (${biz.length} total)`); }
        else { consecutiveFails++; STATS.yelp.errors++; }
        await sleep(randDelay(C.delay + 2000, 3000)); // longer delays for Yelp
      }
      if (biz.length >= max) break;
    }
  } catch (e) { STATS.yelp.errors++; logError('Yelp', e.message); }
  finally { await page.close(); }
  L.ok(`Yelp: ${biz.length} businesses (${consecutiveFails >= MAX_FAILS ? 'auto-skipped — too many blocks' : 'completed'})`);
  return biz;
}

// ═══════════════════════════════════════════════════════════════════
//  SOURCE 3: BBB (Puppeteer)
// ═══════════════════════════════════════════════════════════════════
async function discoverBBB(state, categories, cities, max) {
  const biz = [];
  L.info(`BBB — ${state.name}`);
  const page = await getPage();
  try {
    for (const cat of categories.slice(0, 15)) {
      for (const city of cities.slice(0, 3)) {
        if (biz.length >= max) break;
        const url = `https://www.bbb.org/search?find_country=US&find_loc=${encodeURIComponent(city)}%2C+${state.abbr}&find_text=${encodeURIComponent(cat)}&page=1&sort=Relevance`;
        const html = await navigateAndWait(page, url, 'a[href*="/profile/"]', 25000);
        if (!html) { STATS.bbb.errors++; await sleep(C.delay); continue; }
        const $ = cheerio.load(html);
        const selectors = ['a[href*="/profile/"]', 'a[href*="bbb.org/us/"]', 'h3 a[href*="/us/"]'];
        let $links = $();
        for (const sel of selectors) { $links = $(sel); if ($links.length > 2) break; }
        $links.each((_, a) => {
          if (biz.length >= max) return;
          const name = $(a).text().trim();
          if (!name || name.length < 3 || name.length > 200) return;
          if (/^(bbb|better business|search|find|accredit|view news|start with trust|file a complaint|for businesses)/i.test(name)) return;
          if (biz.some(b => b.company_name === name)) return;
          const $s = $(a).closest('div').parent();
          RE_PHONE.lastIndex = 0;
          biz.push({ source: 'bbb', company_name: name, phone: ($s.text().match(RE_PHONE) || [])[0] || '', address: '', city, state: state.name, website: '', industry: cat });
          STATS.bbb.found++;
        });
        L.dim(`BBB "${cat}" ${city}: ${biz.length} total`);
        await sleep(randDelay(C.delay, 2000));
      }
      if (biz.length >= max) break;
    }
  } catch (e) { STATS.bbb.errors++; logError('BBB', e.message); }
  finally { await page.close(); }
  L.ok(`BBB: ${biz.length} businesses`);
  return biz;
}

// ═══════════════════════════════════════════════════════════════════
//  SOURCE 4: GOOGLE MAPS (Puppeteer — NEW in v5)
// ═══════════════════════════════════════════════════════════════════
async function discoverGMaps(state, categories, cities, max) {
  const biz = [];
  L.info(`Google Maps — ${state.name}`);
  const page = await getPage();
  try {
    for (const cat of categories.slice(0, 20)) {
      for (const city of cities.slice(0, 5)) {
        if (biz.length >= max) break;
        const q = encodeURIComponent(`${cat} in ${city}, ${state.abbr}`);
        const url = `https://www.google.com/maps/search/${q}`;
        const html = await navigateAndWait(page, url, 'a[href*="maps/place"]', 20000);
        if (!html) { STATS.gmaps.errors++; await sleep(C.delay); continue; }
        const $ = cheerio.load(html);

        // Google Maps uses various link patterns
        $('a[href*="/maps/place/"]').each((_, a) => {
          if (biz.length >= max) return;
          let name = $(a).text().trim();
          // Clean up — Maps links often have rating/review text appended
          name = name.replace(/\d+\.\d+\s*\(\d+\).*$/, '').replace(/·.*$/, '').trim();
          if (!name || name.length < 3 || name.length > 150) return;
          if (/^(google|maps|search|directions|sponsored)/i.test(name)) return;
          if (biz.some(b => b.company_name === name && b.city === city)) return;

          const $parent = $(a).parent().parent().parent();
          const parentText = $parent.text();
          RE_PHONE.lastIndex = 0;
          const phone = (parentText.match(RE_PHONE) || [])[0] || '';

          // Try to get address from aria-label or surrounding text
          const ariaLabel = $(a).attr('aria-label') || '';
          RE_ADDRESS.lastIndex = 0;
          const addr = (ariaLabel.match(RE_ADDRESS) || parentText.match(RE_ADDRESS) || [])[0] || '';

          biz.push({ source: 'google_maps', company_name: name, phone, address: addr, city, state: state.name, website: '', industry: cat });
          STATS.gmaps.found++;
        });

        // Also try the feed/results container
        $('[role="feed"] a, .Nv2PK a').each((_, a) => {
          if (biz.length >= max) return;
          const ariaLabel = $(a).attr('aria-label') || '';
          if (!ariaLabel || ariaLabel.length < 3) return;
          const name = ariaLabel.replace(/\d+\.\d+\s*stars?.*$/i, '').trim();
          if (!name || name.length < 3 || biz.some(b => b.company_name === name && b.city === city)) return;
          biz.push({ source: 'google_maps', company_name: name, phone: '', address: '', city, state: state.name, website: '', industry: cat });
          STATS.gmaps.found++;
        });

        L.dim(`GMaps "${cat}" ${city}: ${biz.length} total`);
        await sleep(randDelay(C.delay + 1000, 2000));
      }
      if (biz.length >= max) break;
    }
  } catch (e) { STATS.gmaps.errors++; logError('GMaps', e.message); }
  finally { await page.close(); }
  L.ok(`Google Maps: ${biz.length} businesses`);
  return biz;
}

// ═══════════════════════════════════════════════════════════════════
//  SINGLE-QUERY DISCOVER FUNCTIONS (for round-robin orchestrator)
//  Each takes a browser page + single (state, category, city) combo
//  Returns array of raw biz objects
// ═══════════════════════════════════════════════════════════════════
async function discoverYPSingle(page, state, cat, city) {
  const biz = [];
  const slug = YP_SLUG[cat] || cat.toLowerCase().replace(/\s+/g, '-') + 's';
  const citySlug = city.toLowerCase().replace(/\s+/g, '-').replace(/'/g, '');
  for (let pg = 1; pg <= 3; pg++) {
    const url = `https://www.yellowpages.com/${citySlug}-${state.yp}/${slug}${pg > 1 ? `?page=${pg}` : ''}`;
    const html = await navigateAndWait(page, url, '.search-results');
    if (!html) { STATS.yp.errors++; break; }
    const $ = cheerio.load(html);
    if (/challenge|captcha|blocked|access denied/i.test($('title').text())) { STATS.yp.blocked++; await sleep(randDelay(10000, 5000)); break; }
    let found = 0;
    const selectors = ['.result .business-name a', '.info h2 a', 'a[href*="/mip/"]', '.srp-listing h2 a', '.v-card .info h2 a'];
    let $links = $();
    for (const sel of selectors) { $links = $(sel); if ($links.length > 0) break; }
    $links.each((_, a) => {
      let name = $(a).text().trim().replace(/^\d+\.\s*/, '');
      if (!name || name.length < 3 || name.length > 200) return;
      if (/^(browse|search|find|sort|sign|log|yellow pages|advertise|claim)/i.test(name)) return;
      if (biz.some(b => b.company_name === name && b.city === city)) return;
      let $box = $(a);
      for (let i = 0; i < 8; i++) { $box = $box.parent(); if (!$box.length) break; if ($box.text().length > 100 && /\(\d{3}\)/.test($box.text())) break; }
      const boxText = $box.text();
      RE_PHONE.lastIndex = 0; const phone = (boxText.match(RE_PHONE) || [])[0] || '';
      RE_ADDRESS.lastIndex = 0; const addr = (boxText.match(RE_ADDRESS) || [])[0] || '';
      let website = '';
      $box.find('a[href^="http"]').each((_, l) => { const h = $(l).attr('href') || ''; if (website) return; if (/yellowpages|yp\.com|intelius|thryv|superpages|dexknows/i.test(h)) return; const t = $(l).text().toLowerCase(); if (t.includes('website') || t.includes('visit')) website = h; });
      if (!website) $box.find('a.track-visit-website, a[data-analytics="visit_website"]').each((_, l) => { if (!website) website = $(l).attr('href') || ''; });
      biz.push({ source: 'yellowpages', company_name: name, phone, address: addr, city, state: state.name, website, industry: cat });
      found++; STATS.yp.found++;
    });
    if (found === 0) break;
    await sleep(randDelay(C.delay, 2000));
  }
  return biz;
}

let _yelpConsecutiveFails = 0;
async function discoverYelpSingle(page, state, cat, city) {
  if (_yelpConsecutiveFails >= 5) { STATS.yelp.skipped++; return []; }
  const biz = [];
  const url = `https://www.yelp.com/search?find_desc=${encodeURIComponent(cat)}&find_loc=${encodeURIComponent(city + ', ' + state.abbr)}`;
  const html = await navigateAndWait(page, url, 'a[href*="/biz/"]', 15000);
  if (!html || html.length < 2000) { _yelpConsecutiveFails++; STATS.yelp.blocked++; await sleep(randDelay(5000, 3000)); return []; }
  const $ = cheerio.load(html);
  if (/enable JS|captcha|unusual traffic|access denied/i.test($.text().substring(0, 500))) { _yelpConsecutiveFails++; STATS.yelp.blocked++; await sleep(randDelay(8000, 5000)); return []; }
  const seen = new Set();
  $('a[href*="/biz/"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const bizSlug = href.match(/\/biz\/([\w-]+)/);
    if (!bizSlug || seen.has(bizSlug[1])) return;
    seen.add(bizSlug[1]);
    let name = $(a).text().trim().replace(/^\d+\.\s*/, '');
    if (!name || name.length < 3 || name.length > 150) return;
    if (/^(yelp|more|see|read|write|photo|map|direction|filter|review|claim|sign|get|request|ad\b)/i.test(name)) return;
    if (biz.some(b => b.company_name === name && b.city === city)) return;
    const $c = $(a).closest('[class]').parent().parent();
    RE_PHONE.lastIndex = 0;
    biz.push({ source: 'yelp', company_name: name, phone: ($c.text().match(RE_PHONE) || [])[0] || '', address: '', city, state: state.name, website: '', industry: cat });
    STATS.yelp.found++;
  });
  if (biz.length > 0) _yelpConsecutiveFails = 0; else { _yelpConsecutiveFails++; STATS.yelp.errors++; }
  await sleep(randDelay(C.delay + 2000, 3000));
  return biz;
}

async function discoverBBBSingle(page, state, cat, city) {
  const biz = [];
  const url = `https://www.bbb.org/search?find_country=US&find_loc=${encodeURIComponent(city)}%2C+${state.abbr}&find_text=${encodeURIComponent(cat)}&page=1&sort=Relevance`;
  const html = await navigateAndWait(page, url, 'a[href*="/profile/"]', 25000);
  if (!html) { STATS.bbb.errors++; await sleep(C.delay); return []; }
  const $ = cheerio.load(html);
  const selectors = ['a[href*="/profile/"]', 'a[href*="bbb.org/us/"]', 'h3 a[href*="/us/"]'];
  let $links = $();
  for (const sel of selectors) { $links = $(sel); if ($links.length > 2) break; }
  $links.each((_, a) => {
    const name = $(a).text().trim();
    if (!name || name.length < 3 || name.length > 200) return;
    if (/^(bbb|better business|search|find|accredit|view news|start with trust|file a complaint|for businesses)/i.test(name)) return;
    if (biz.some(b => b.company_name === name)) return;
    const $s = $(a).closest('div').parent();
    RE_PHONE.lastIndex = 0;
    biz.push({ source: 'bbb', company_name: name, phone: ($s.text().match(RE_PHONE) || [])[0] || '', address: '', city, state: state.name, website: '', industry: cat });
    STATS.bbb.found++;
  });
  await sleep(randDelay(C.delay, 2000));
  return biz;
}

async function discoverGMapsSingle(page, state, cat, city) {
  const biz = [];
  const q = encodeURIComponent(`${cat} in ${city}, ${state.abbr}`);
  const url = `https://www.google.com/maps/search/${q}`;
  const html = await navigateAndWait(page, url, 'a[href*="maps/place"]', 20000);
  if (!html) { STATS.gmaps.errors++; await sleep(C.delay); return []; }
  const $ = cheerio.load(html);
  $('a[href*="/maps/place/"]').each((_, a) => {
    let name = $(a).text().trim();
    name = name.replace(/\d+\.\d+\s*\(\d+\).*$/, '').replace(/·.*$/, '').trim();
    if (!name || name.length < 3 || name.length > 150) return;
    if (/^(google|maps|search|directions|sponsored)/i.test(name)) return;
    if (biz.some(b => b.company_name === name && b.city === city)) return;
    const $parent = $(a).parent().parent().parent();
    RE_PHONE.lastIndex = 0;
    const phone = ($parent.text().match(RE_PHONE) || [])[0] || '';
    RE_ADDRESS.lastIndex = 0;
    const ariaLabel = $(a).attr('aria-label') || '';
    const addr = (ariaLabel.match(RE_ADDRESS) || $parent.text().match(RE_ADDRESS) || [])[0] || '';
    biz.push({ source: 'google_maps', company_name: name, phone, address: addr, city, state: state.name, website: '', industry: cat });
    STATS.gmaps.found++;
  });
  $('[role="feed"] a, .Nv2PK a').each((_, a) => {
    const ariaLabel = $(a).attr('aria-label') || '';
    if (!ariaLabel || ariaLabel.length < 3) return;
    const name = ariaLabel.replace(/\d+\.\d+\s*stars?.*$/i, '').trim();
    if (!name || name.length < 3 || biz.some(b => b.company_name === name && b.city === city)) return;
    biz.push({ source: 'google_maps', company_name: name, phone: '', address: '', city, state: state.name, website: '', industry: cat });
    STATS.gmaps.found++;
  });
  await sleep(randDelay(C.delay + 1000, 2000));
  return biz;
}

// ═══════════════════════════════════════════════════════════════════
//  WEBSITE FINDER — DuckDuckGo + Google fallback
// ═══════════════════════════════════════════════════════════════════
async function findMissingWebsites(businesses) {
  const missing = businesses.filter(b => !b.website);
  if (!missing.length) return businesses;
  L.info(`Finding websites for ${missing.length} businesses...`);
  const page = await getPage();
  let found = 0;
  try {
    for (const biz of missing) {
      try {
        const q = encodeURIComponent(`${biz.company_name} ${biz.city} ${biz.state}`);
        const html = await navigateAndWait(page, `https://duckduckgo.com/?q=${q}`, '.result__a', 15000);
        if (html) {
          const $ = cheerio.load(html);
          $('a.result__a, a[data-testid="result-title-a"], a[href*="//"]').each((_, a) => {
            if (biz.website) return;
            let href = $(a).attr('href') || '';
            const uddg = href.match(/uddg=(https?%3A[^&]+)/);
            if (uddg) href = decodeURIComponent(uddg[1]);
            if (!href.startsWith('http')) return;
            if (/google\.|duckduckgo|youtube\.|yelp\.|yellowpages\.|bbb\.org|facebook\.|instagram\.|twitter\.|linkedin\.|mapquest|angi\.|homeadvisor|thumbtack|nextdoor|tripadvisor|pinterest|tiktok|reddit|wikipedia/i.test(href)) return;
            if (href.length < 200) { biz.website = href.split('?')[0]; found++; STATS.websitesFound++; }
          });
        }
        if (!biz.website) {
          const ghtml = await navigateAndWait(page, `https://www.google.com/search?q=${q}`, 'div#search', 15000);
          if (ghtml) {
            const $g = cheerio.load(ghtml);
            $g('a[href^="http"]').each((_, a) => {
              if (biz.website) return;
              const href = $g(a).attr('href') || '';
              if (/google\.|youtube\.|yelp\.|yellowpages\.|bbb\.org|facebook\.|instagram\.|twitter\.|linkedin\.|mapquest|angi\.|homeadvisor|thumbtack|nextdoor|tripadvisor|pinterest|tiktok|reddit|wikipedia/i.test(href)) return;
              if (href.startsWith('http') && href.length < 200) { biz.website = href.split('?')[0]; found++; STATS.websitesFound++; }
            });
          }
        }
        if (!biz.website) STATS.websitesMissing++;
      } catch {}
      await sleep(randDelay(C.delay, 1500));
    }
  } finally { await page.close(); }
  L.ok(`Found websites for ${found}/${missing.length} businesses`);
  return businesses;
}

// ═══════════════════════════════════════════════════════════════════
//  WHOIS / RDAP — with business age scoring (v5)
// ═══════════════════════════════════════════════════════════════════
async function lookupWhois(domain) {
  const clean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
  if (!clean || !clean.includes('.')) return null;
  try {
    const data = await fetchJSON(`https://rdap.org/domain/${clean}`);
    if (!data) return null;
    const result = { domain: clean, registrant: {}, admin: {}, age: null, ageLabel: '' };
    for (const entity of (data.entities || [])) {
      const roles = entity.roles || [];
      const vcard = entity.vcardArray?.[1] || [];
      const target = roles.includes('registrant') ? result.registrant : roles.includes('administrative') ? result.admin : null;
      if (!target) continue;
      for (const field of vcard) {
        if (field[0] === 'fn') target.name = field[3];
        if (field[0] === 'email') target.email = field[3];
        if (field[0] === 'tel') target.phone = field[3];
        if (field[0] === 'adr') { const addr = Array.isArray(field[3]) ? field[3].filter(Boolean).join(', ') : field[3]; if (addr) target.address = addr; }
      }
      if (entity.entities) for (const sub of entity.entities) { const sv = sub.vcardArray?.[1] || []; for (const f of sv) { if (f[0] === 'fn' && !target.name) target.name = f[3]; if (f[0] === 'email' && !target.email) target.email = f[3]; } }
    }
    if (data.events) {
      for (const ev of data.events) {
        if (ev.eventAction === 'registration') {
          result.created = ev.eventDate;
          const created = new Date(ev.eventDate);
          const now = new Date();
          const years = (now - created) / (365.25 * 24 * 60 * 60 * 1000);
          result.age = Math.round(years * 10) / 10;
          if (years < 1) result.ageLabel = 'NEW (<1 yr)';
          else if (years < 2) result.ageLabel = 'NEW (1-2 yrs)';
          else if (years < 5) result.ageLabel = 'Growing (2-5 yrs)';
          else if (years < 10) result.ageLabel = 'Established (5-10 yrs)';
          else result.ageLabel = 'Mature (10+ yrs)';
        }
      }
    }
    return (result.registrant.name || result.registrant.email || result.admin.name || result.admin.email || result.age !== null) ? result : null;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
//  ENTITY RESOLUTION
// ═══════════════════════════════════════════════════════════════════
function normName(n) { return (n || '').toLowerCase().replace(/\b(llc|inc|corp|ltd|co|company|enterprises|services|solutions|group|associates|partners|pllc|lp|llp)\b/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim(); }
function normPhone(p) { return (p || '').replace(/[^\d]/g, '').slice(-10); }
function normDomain(u) { return (u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase().trim(); }
function dice(a, b) { if (!a || !b) return 0; if (a === b) return 1; const bg = s => { const p = []; for (let i = 0; i < s.length - 1; i++) p.push(s.slice(i, i + 2)); return p; }; const ab = bg(a), bb = bg(b); let m = 0; const u = new Set(); for (const x of ab) for (let i = 0; i < bb.length; i++) { if (!u.has(i) && x === bb[i]) { m++; u.add(i); break; } } return (2 * m) / (ab.length + bb.length); }
function sameEntity(a, b) {
  const da = normDomain(a.website), db = normDomain(b.website);
  if (da && db && da === db) return true;
  const pa = normPhone(a.phone), pb = normPhone(b.phone);
  if (pa && pb && pa.length >= 10 && pa === pb) return true;
  const na = normName(a.company_name), nb = normName(b.company_name);
  const s = dice(na, nb);
  if (s > 0.85) return true;
  if (s > 0.7 && (a.city || '').toLowerCase() === (b.city || '').toLowerCase()) return true;
  return false;
}
function dedupe(list) {
  L.info(`Deduplicating ${list.length} records...`);
  const uniq = [];
  for (const b of list) {
    let matched = false;
    for (let i = 0; i < uniq.length; i++) {
      if (sameEntity(uniq[i], b)) {
        for (const k of ['phone', 'address', 'city', 'website', 'industry']) if (!uniq[i][k] && b[k]) uniq[i][k] = b[k];
        if (!uniq[i].sources) uniq[i].sources = [uniq[i].source];
        if (!uniq[i].sources.includes(b.source)) uniq[i].sources.push(b.source);
        matched = true; break;
      }
    }
    if (!matched) { b.sources = [b.source]; uniq.push(b); }
  }
  STATS.totalAfterDedup = uniq.length;
  L.ok(`Dedup: ${list.length} → ${uniq.length} unique`);
  return uniq;
}

// ═══════════════════════════════════════════════════════════════════
//  WEBSITE ENRICHMENT — 9 extraction methods + social media
// ═══════════════════════════════════════════════════════════════════
function extractContacts($, pageUrl, rawHtml) {
  const contacts = [], emails = new Set(), companyInfo = {};

  // Social media (v5)
  const social = extractSocialMedia($, rawHtml);
  if (social.facebook) { companyInfo.facebook = social.facebook; STATS.facebookFound++; }
  if (social.instagram) { companyInfo.instagram = social.instagram; STATS.instagramFound++; }
  if (social.linkedin) { companyInfo.linkedin = social.linkedin; STATS.linkedinFound++; }
  if (social.twitter) { companyInfo.twitter = social.twitter; STATS.twitterFound++; }

  // 1. JSON-LD / Schema.org
  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      const data = JSON.parse($(script).html());
      const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (const item of items) {
        if (item.email) { const e = item.email.replace('mailto:', '').toLowerCase(); if (validEmail(e) && !emails.has(e)) { emails.add(e); contacts.push({ email: e, first_name: firstName(item.name || ''), last_name: lastName(item.name || ''), title: item.jobTitle || '', phone: item.telephone || '', confidence: 'found', source_page: pageUrl }); } }
        if (item.telephone) companyInfo.phone = item.telephone;
        if (item.name && !companyInfo.name) companyInfo.name = item.name;
        if (item.address) { const a = typeof item.address === 'string' ? item.address : `${item.address.streetAddress || ''} ${item.address.addressLocality || ''} ${item.address.addressRegion || ''}`.trim(); if (a) companyInfo.address = a; }
        if (item.aggregateRating) { companyInfo.rating = item.aggregateRating.ratingValue; companyInfo.reviewCount = item.aggregateRating.reviewCount; }
        const people = item.employee || item.member || item.employees || item.members;
        if (people) { const arr = Array.isArray(people) ? people : [people]; for (const p of arr) { if (p.email) { const pe = p.email.replace('mailto:', '').toLowerCase(); if (validEmail(pe) && !emails.has(pe)) { emails.add(pe); contacts.push({ email: pe, first_name: firstName(p.name || ''), last_name: lastName(p.name || ''), title: p.jobTitle || '', phone: p.telephone || '', confidence: 'found', source_page: pageUrl }); } } } }
      }
    } catch {}
  });

  // 2. mailto: links
  $('a[href^="mailto:"]').each((_, a) => {
    const email = $(a).attr('href').replace('mailto:', '').split('?')[0].trim().toLowerCase();
    RE_EMAIL.lastIndex = 0; if (!RE_EMAIL.test(email)) { RE_EMAIL.lastIndex = 0; return; } RE_EMAIL.lastIndex = 0;
    if (!validEmail(email) || emails.has(email)) return; emails.add(email);
    let name = '', title = '', phone = '';
    let $ctx = $(a);
    for (let i = 0; i < 6; i++) { $ctx = $ctx.parent(); if (!$ctx.length) break; const t = $ctx.text().trim(); if (t.length > 20 && t.length < 600) { const ne = $ctx.find('h2,h3,h4,h5,strong,.name,[class*="name"]').first(); const te = $ctx.find('.title,[class*="title"],[class*="position"],[class*="role"],em,.subtitle').first(); name = ne.text().trim(); title = te.text().trim(); RE_PHONE.lastIndex = 0; const pm = t.match(RE_PHONE); if (pm) phone = pm[0]; if (name && name.length > 2 && name.length < 60) break; } }
    if (title === name) title = ''; if (title.length > 80) title = '';
    contacts.push({ email, first_name: firstName(name), last_name: lastName(name), title, phone, confidence: 'found', source_page: pageUrl });
  });

  // 3. data-email attributes
  $('[data-email],[data-mail],[data-staff-email]').each((_, el) => { const $el = $(el); const email = ($el.attr('data-email') || $el.attr('data-mail') || $el.attr('data-staff-email') || '').trim().toLowerCase(); if (!email || !validEmail(email) || emails.has(email)) return; emails.add(email); contacts.push({ email, first_name: firstName($el.attr('data-name') || ''), last_name: lastName($el.attr('data-name') || ''), title: $el.attr('data-title') || '', phone: '', confidence: 'found', source_page: pageUrl }); });

  // 4. Staff/team cards
  const cardSels = '.team-member,.staff-member,.employee,.person,.member,[class*="team-card"],[class*="staff-card"],[class*="bio"],[class*="people-card"],[class*="contact-card"],.profile,[class*="personnel"],[class*="directory-item"],[class*="agent-card"],[class*="doctor-card"],[class*="attorney"],[class*="provider-card"],[class*="advisor"]';
  try { $(cardSels).each((_, card) => { const $c = $(card); const t = $c.text(); RE_EMAIL.lastIndex = 0; const ce = t.match(RE_EMAIL) || []; for (const raw of ce) { const e = raw.toLowerCase(); if (!validEmail(e) || emails.has(e)) continue; emails.add(e); const ne = $c.find('h2,h3,h4,h5,.name,[class*="name"],strong').first(); const te = $c.find('.title,[class*="title"],[class*="position"],[class*="role"],em,.subtitle').first(); RE_PHONE.lastIndex = 0; const pm = t.match(RE_PHONE); contacts.push({ email: e, first_name: firstName(ne.text().trim()), last_name: lastName(ne.text().trim()), title: te.text().trim().length < 80 ? te.text().trim() : '', phone: pm ? pm[0] : '', confidence: 'found', source_page: pageUrl }); } }); } catch {}

  // 5. Full-page regex
  const bodyText = ($('body').text() || '').replace(/\s+/g, ' ');
  RE_EMAIL.lastIndex = 0; const pageEmails = bodyText.match(RE_EMAIL) || [];
  for (const raw of pageEmails) { const e = raw.toLowerCase(); if (validEmail(e) && !emails.has(e)) { emails.add(e); contacts.push({ email: e, first_name: '', last_name: '', title: '', phone: '', confidence: 'found', source_page: pageUrl }); } }

  // 6. Obfuscated emails
  RE_OBFUSC.lastIndex = 0; const obf = bodyText.match(RE_OBFUSC) || [];
  for (const m of obf) { const cleaned = m.replace(/\s*[\[({]?\s*at\s*[\])}]?\s*/gi, '@').replace(/\s*[\[({]?\s*dot\s*[\])}]?\s*/gi, '.').toLowerCase(); RE_EMAIL.lastIndex = 0; if (RE_EMAIL.test(cleaned) && validEmail(cleaned) && !emails.has(cleaned)) { emails.add(cleaned); contacts.push({ email: cleaned, first_name: '', last_name: '', title: '', phone: '', confidence: 'found', source_page: pageUrl }); } RE_EMAIL.lastIndex = 0; }

  // 7. Footer
  $('footer,.footer,[class*="footer"],[id*="footer"]').each((_, f) => { const ft = $(f).text(); if (!companyInfo.phone) { RE_PHONE.lastIndex = 0; const pm = ft.match(RE_PHONE); if (pm) companyInfo.phone = pm[0]; } if (!companyInfo.address) { RE_ADDRESS.lastIndex = 0; const am = ft.match(RE_ADDRESS); if (am) companyInfo.address = am[0]; } });

  // 8. Meta
  companyInfo.site_title = $('meta[property="og:title"]').attr('content') || $('title').text().trim();
  const desc = $('meta[name="description"]').attr('content'); if (desc) companyInfo.description = desc;

  // 9. Tel links
  if (!companyInfo.phone) $('a[href^="tel:"]').first().each((_, a) => { companyInfo.phone = $(a).attr('href').replace('tel:', '').replace(/[^\d+-]/g, ''); });

  // Names without emails (for inference)
  const namesWithoutEmails = [];
  try { $(cardSels + ',.wp-block-column,.elementor-widget-container').each((_, card) => { const $c = $(card); const nameEl = $c.find('h2,h3,h4,h5,.name,[class*="name"],strong').first(); const titleEl = $c.find('.title,[class*="title"],[class*="position"],[class*="role"],em,.subtitle').first(); const name = nameEl.text().trim(); const title = titleEl.text().trim(); if (name && name.length > 3 && name.length < 60 && /^[A-Z]/.test(name) && name.includes(' ')) { const hasEmail = contacts.some(c => `${c.first_name} ${c.last_name}`.trim() === name); if (!hasEmail) { RE_PHONE.lastIndex = 0; const pm = $c.text().match(RE_PHONE); namesWithoutEmails.push({ first_name: firstName(name), last_name: lastName(name), title: title.length < 80 ? title : '', phone: pm ? pm[0] : '', source_page: pageUrl }); } } }); } catch {}

  return { contacts, emails: Array.from(emails), companyInfo, namesWithoutEmails };
}

// ═══════════════════════════════════════════════════════════════════
//  EMAIL PATTERN INFERENCE + MX VERIFICATION
// ═══════════════════════════════════════════════════════════════════
function detectEmailPattern(contacts) {
  const patterns = { 'first': 0, 'first.last': 0, 'firstlast': 0, 'flast': 0, 'first_last': 0, 'firstl': 0, 'last': 0 };
  for (const c of contacts) {
    if (!c.email || !c.first_name || !c.last_name) continue;
    const local = c.email.split('@')[0].toLowerCase();
    const f = c.first_name.toLowerCase(), l = c.last_name.toLowerCase();
    if (!f || !l) continue;
    if (local === f) patterns['first']++;
    else if (local === `${f}.${l}`) patterns['first.last']++;
    else if (local === `${f}${l}`) patterns['firstlast']++;
    else if (local === `${f[0]}${l}`) patterns['flast']++;
    else if (local === `${f}_${l}`) patterns['first_last']++;
    else if (local === `${f}${l[0]}`) patterns['firstl']++;
    else if (local === l) patterns['last']++;
  }
  let best = null, bestCount = 0;
  for (const [pat, count] of Object.entries(patterns)) { if (count > bestCount) { best = pat; bestCount = count; } }
  return bestCount >= 1 ? best : null;
}

function generateEmail(pattern, fname, lname, domain) {
  const f = fname.toLowerCase().replace(/[^a-z]/g, ''), l = lname.toLowerCase().replace(/[^a-z]/g, '');
  if (!f || !l) return null;
  const map = { 'first': `${f}@${domain}`, 'first.last': `${f}.${l}@${domain}`, 'firstlast': `${f}${l}@${domain}`, 'flast': `${f[0]}${l}@${domain}`, 'first_last': `${f}_${l}@${domain}`, 'firstl': `${f}${l[0]}@${domain}`, 'last': `${l}@${domain}` };
  return map[pattern] || null;
}

const mxCache = new Map();
async function verifyEmailMx(email) {
  const domain = email.split('@')[1]; if (!domain) return false;
  if (mxCache.has(domain)) return mxCache.get(domain);
  try { const records = await dnsResolveMx(domain); const valid = records && records.length > 0; mxCache.set(domain, valid); return valid; }
  catch { mxCache.set(domain, false); return false; }
}

// ═══════════════════════════════════════════════════════════════════
//  SUBPAGE DISCOVERY
// ═══════════════════════════════════════════════════════════════════
function findPages($, baseUrl) {
  const pages = new Set(['/']);
  const patterns = [/\b(contact|reach|get.?in.?touch)\b/i, /\b(team|staff|people|employees|crew|directory)\b/i, /\b(about|company|who.?we.?are)\b/i, /\b(leadership|management|directors|partners|attorneys|doctors|providers)\b/i, /\b(our.?team|meet|our.?people|our.?staff)\b/i, /\b(agents?|advisors?|consultants?|specialists?)\b/i];
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') || '';
    let path = '';
    if (href.startsWith('/') && !href.startsWith('//')) path = href;
    else if (href.includes(baseUrl)) try { path = new URL(href).pathname; } catch { return; }
    else return;
    path = path.split('?')[0].split('#')[0];
    if (path.length > 1 && path.length < 150 && patterns.some(p => p.test(path))) pages.add(path);
  });
  return Array.from(pages).slice(0, C.maxPages);
}

// ═══════════════════════════════════════════════════════════════════
//  FULL ENRICHMENT — website + WHOIS + social + age + infer + MX
// ═══════════════════════════════════════════════════════════════════
async function enrichBusiness(biz) {
  if (!biz.website) return { ...biz, contacts: [] };
  const baseUrl = await resolveUrl(biz.website);
  if (!baseUrl) return { ...biz, contacts: [] };
  const domain = baseUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  const allContacts = [], allEmails = new Set(), allNamesNoEmail = [];
  let companyInfo = {};

  // Homepage
  const home = await fetchUrl(baseUrl + '/');
  if (!home?.data) return { ...biz, contacts: [] };
  const $home = cheerio.load(home.data);
  const hr = extractContacts($home, baseUrl, home.data);
  for (const c of hr.contacts) { if (!allEmails.has(c.email)) { allEmails.add(c.email); allContacts.push(c); } }
  allNamesNoEmail.push(...(hr.namesWithoutEmails || []));
  companyInfo = { ...hr.companyInfo };

  // Subpages
  const subPages = findPages($home, baseUrl);
  L.dim(`${subPages.length} relevant pages`);
  for (const pg of subPages.slice(1)) {
    const r = await fetchUrl(baseUrl + pg);
    if (!r?.data) continue;
    const $ = cheerio.load(r.data);
    const pr = extractContacts($, baseUrl + pg, r.data);
    for (const c of pr.contacts) { if (!allEmails.has(c.email)) { allEmails.add(c.email); allContacts.push(c); if (c.first_name) L.contact(`${c.first_name} ${c.last_name} ${c.title ? '(' + c.title + ')' : ''}: ${c.email}`); } }
    allNamesNoEmail.push(...(pr.namesWithoutEmails || []));
    companyInfo = { ...companyInfo, ...pr.companyInfo };
    if (allContacts.filter(c => c.first_name).length >= 5) { L.dim('Comprehensive directory found'); break; }
    await sleep(randDelay(C.delay, 1000));
  }

  // Social media logging
  if (companyInfo.facebook || companyInfo.instagram || companyInfo.linkedin || companyInfo.twitter) {
    const socials = [companyInfo.facebook && 'FB', companyInfo.instagram && 'IG', companyInfo.linkedin && 'LI', companyInfo.twitter && 'X'].filter(Boolean);
    L.social(`Social: ${socials.join(', ')}`);
  }

  // WHOIS + business age
  const whois = await lookupWhois(domain);
  if (whois) {
    const reg = whois.registrant;
    if (reg.email && validEmail(reg.email) && !allEmails.has(reg.email.toLowerCase())) {
      const e = reg.email.toLowerCase(); allEmails.add(e);
      allContacts.push({ email: e, first_name: firstName(reg.name || ''), last_name: lastName(reg.name || ''), title: 'Owner (WHOIS)', phone: reg.phone || '', confidence: 'whois', source_page: 'WHOIS/RDAP' });
      L.whois(`WHOIS: ${reg.name || 'Unknown'} — ${e}`);
      STATS.emailsWhois++;
    }
    if (!biz.address && reg.address) biz.address = reg.address;
    if (whois.created) biz.year_founded = whois.created.split('-')[0];
    if (whois.age !== null) {
      biz.domain_age = whois.age;
      biz.age_label = whois.ageLabel;
      if (whois.age < 2) STATS.newBiz++; else STATS.estBiz++;
    }
  }

  // Email pattern inference
  const pattern = detectEmailPattern(allContacts);
  if (pattern && allNamesNoEmail.length > 0) {
    L.infer(`Pattern: ${pattern}@${domain} — ${allNamesNoEmail.length} names`);
    for (const person of allNamesNoEmail) {
      const inferredEmail = generateEmail(pattern, person.first_name, person.last_name, domain);
      if (inferredEmail && !allEmails.has(inferredEmail)) {
        allEmails.add(inferredEmail);
        allContacts.push({ email: inferredEmail, first_name: person.first_name, last_name: person.last_name, title: person.title, phone: person.phone, confidence: 'inferred', source_page: person.source_page });
        L.infer(`${person.first_name} ${person.last_name}: ${inferredEmail}`);
        STATS.emailsInferred++;
      }
    }
  }

  // MX verification
  let verifiedCount = 0;
  for (const c of allContacts) {
    const mxValid = await verifyEmailMx(c.email);
    if (mxValid) {
      if (c.confidence === 'found') c.confidence = 'verified';
      if (c.confidence === 'inferred') c.confidence = 'inferred_mx_ok';
      verifiedCount++; STATS.emailsVerified++;
    } else {
      c.confidence = (c.confidence === 'inferred') ? 'inferred_no_mx' : 'no_mx';
      STATS.emailsNoMx++;
    }
  }
  if (verifiedCount > 0) L.verify(`${verifiedCount}/${allContacts.length} MX verified`);

  STATS.emailsFound += allContacts.length;
  if (!biz.phone && companyInfo.phone) biz.phone = companyInfo.phone;
  if (!biz.address && companyInfo.address) biz.address = companyInfo.address;
  if (companyInfo.rating) biz.rating = companyInfo.rating;
  if (companyInfo.reviewCount) biz.review_count = companyInfo.reviewCount;

  return { ...biz, contacts: allContacts, companyInfo, enriched_at: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════════════════════
//  GOOGLE SHEETS — BATCHED PUSH + LIVE DASHBOARD
// ═══════════════════════════════════════════════════════════════════
let sheetsApi = null;
let rowBuffer = [];

async function initSheets() {
  if (!C.sheetId) { L.warn('No GOOGLE_SPREADSHEET_ID set. Sheets disabled.'); return false; }
  try {
    const auth = new google.auth.GoogleAuth({ keyFile: C.creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    sheetsApi = google.sheets({ version: 'v4', auth });
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
    // v5 headers with social media + business age columns
    const headers = ['First Name', 'Last Name', 'Email', 'Title', 'Company Name', 'Location', 'Website', 'Phone', 'Facebook', 'Instagram', 'LinkedIn', 'Twitter/X', 'Source', 'Confidence', 'Biz Age', 'Year Founded', 'Industry', 'Date'];
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: C.sheetId, range: `'${tabName}'!A1:R1`,
      valueInputOption: 'RAW', requestBody: { values: [headers] }
    });
    // Bold + freeze header
    const sheetData = await sheetsApi.spreadsheets.get({ spreadsheetId: C.sheetId });
    const sheet = sheetData.data.sheets.find(s => s.properties.title === tabName);
    if (sheet) {
      await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId: C.sheetId, requestBody: { requests: [
        { repeatCell: { range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 18 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.1, green: 0.1, blue: 0.15 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
        { updateSheetProperties: { properties: { sheetId: sheet.properties.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } }
      ] } });
    }
  } catch (e) { L.err(`Tab setup: ${e.message}`); STATS.sheetErrors++; logError('Sheets', e.message); }
}

function toRows(bizList) {
  const rows = [], today = new Date().toISOString().split('T')[0];
  for (const b of bizList) {
    const co = b.company_name || '', loc = [b.city, b.state].filter(Boolean).join(', '), web = b.website || '', ph = b.phone || '';
    const fb = b.companyInfo?.facebook || '', ig = b.companyInfo?.instagram || '', li = b.companyInfo?.linkedin || '', tw = b.companyInfo?.twitter || '';
    const src = (b.sources || [b.source || '']).filter(Boolean).join(', ');
    const age = b.age_label || '', founded = String(b.year_founded || ''), industry = b.industry || '';
    if (b.contacts?.length) {
      for (const c of b.contacts) rows.push([c.first_name || '', c.last_name || '', c.email || '', c.title || '', co, loc, web, c.phone || ph, fb, ig, li, tw, src, String(c.confidence || 'found'), age, founded, industry, today]);
    } else {
      rows.push(['', '', '', '', co, loc, web, ph, fb, ig, li, tw, src, '', age, founded, industry, today]);
    }
  }
  return rows;
}

async function batchPushRows(tabName, bizList) {
  if (!sheetsApi) return;
  const rows = toRows(bizList);
  if (!rows.length) return;
  rowBuffer.push(...rows);
  if (rowBuffer.length >= C.batchSize) {
    try {
      await sheetsApi.spreadsheets.values.append({
        spreadsheetId: C.sheetId, range: `'${tabName}'!A:R`,
        valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rowBuffer }
      });
      STATS.rowsPushed += rowBuffer.length;
      rowBuffer = [];
    } catch (e) { STATS.sheetErrors++; logError('Sheets', e.message); }
  }
}

async function flushRows(tabName) {
  if (!sheetsApi || !rowBuffer.length) return;
  try {
    await sheetsApi.spreadsheets.values.append({
      spreadsheetId: C.sheetId, range: `'${tabName}'!A:R`,
      valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rowBuffer }
    });
    STATS.rowsPushed += rowBuffer.length;
    rowBuffer = [];
  } catch (e) { STATS.sheetErrors++; logError('Sheets', e.message); }
}

// ═══════════════════════════════════════════════════════════════════
//  LIVE DASHBOARD TAB — auto-refreshes every 30s
// ═══════════════════════════════════════════════════════════════════
let dashboardTimer = null;

async function ensureDashboard() {
  if (!sheetsApi) return;
  try {
    const sp = await sheetsApi.spreadsheets.get({ spreadsheetId: C.sheetId });
    if (!sp.data.sheets.some(s => s.properties.title === 'Dashboard')) {
      await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId: C.sheetId, requestBody: { requests: [{ addSheet: { properties: { title: 'Dashboard' } } }] } });
      L.ok('Created Dashboard tab');
    }
  } catch (e) { logError('Dashboard', e.message); }
}

async function updateDashboard() {
  if (!sheetsApi) return;
  try {
    const elapsed = STATS.startTime ? Math.round((Date.now() - STATS.startTime) / 1000) : 0;
    const hours = elapsed / 3600;
    const rate = hours > 0 ? Math.round(STATS.enriched / hours) : 0;
    const discoveryRate = hours > 0 ? Math.round(STATS.totalDiscovered / hours) : 0;

    const rows = [
      ['BUSINESS DISCOVERY ENGINE v6.1 — LIVE DASHBOARD', '', '', ''],
      ['Last Updated', new Date().toISOString().replace('T', ' ').substring(0, 19), '', ''],
      ['', '', '', ''],
      ['═══ STATUS ═══', '', '', ''],
      ['Current State', STATS.currentState, '', ''],
      ['Current Phase', STATS.currentPhase, '', ''],
      ['Runtime', `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m ${elapsed % 60}s`, '', ''],
      ['States Completed', STATS.statesCompleted.join(', ') || 'None yet', '', ''],
      ['', '', '', ''],
      ['═══ DISCOVERY ═══', 'Found', 'Errors', 'Blocked'],
      ['Yellow Pages', STATS.yp.found, STATS.yp.errors, STATS.yp.blocked],
      ['Yelp', STATS.yelp.found, STATS.yelp.errors, `${STATS.yelp.blocked} blocked, ${STATS.yelp.skipped} skipped`],
      ['BBB', STATS.bbb.found, STATS.bbb.errors, STATS.bbb.blocked],
      ['Google Maps', STATS.gmaps.found, STATS.gmaps.errors, STATS.gmaps.blocked],
      ['TOTAL Discovered', STATS.totalDiscovered, '', ''],
      ['After Dedup', STATS.totalAfterDedup, '', ''],
      ['Discovery Rate', `${discoveryRate}/hr`, '', ''],
      ['', '', '', ''],
      ['═══ ENRICHMENT ═══', '', '', ''],
      ['Businesses Enriched', STATS.enriched, '', ''],
      ['Enrichment Errors', STATS.enrichErrors, '', ''],
      ['Enrichment Rate', `${rate}/hr`, '', ''],
      ['Websites Found', STATS.websitesFound, '', ''],
      ['Websites Missing', STATS.websitesMissing, '', ''],
      ['', '', '', ''],
      ['═══ CONTACTS ═══', '', '', ''],
      ['Emails Found (total)', STATS.emailsFound, '', ''],
      ['MX Verified', STATS.emailsVerified, '', ''],
      ['Pattern Inferred', STATS.emailsInferred, '', ''],
      ['WHOIS Contacts', STATS.emailsWhois, '', ''],
      ['Failed MX', STATS.emailsNoMx, '', ''],
      ['', '', '', ''],
      ['═══ SOCIAL MEDIA ═══', '', '', ''],
      ['Facebook', STATS.facebookFound, '', ''],
      ['Instagram', STATS.instagramFound, '', ''],
      ['LinkedIn', STATS.linkedinFound, '', ''],
      ['Twitter/X', STATS.twitterFound, '', ''],
      ['', '', '', ''],
      ['═══ BUSINESS AGE ═══', '', '', ''],
      ['New Businesses (<2 yrs)', STATS.newBiz, '', ''],
      ['Established (2+ yrs)', STATS.estBiz, '', ''],
      ['', '', '', ''],
      ['═══ GOOGLE SHEETS ═══', '', '', ''],
      ['Rows Pushed', STATS.rowsPushed, '', ''],
      ['Sheet Errors', STATS.sheetErrors, '', ''],
      ['', '', '', ''],
      ['═══ PER-STATE RESULTS ═══', 'Discovered', 'Contacts', 'Verified'],
    ];

    for (const [st, data] of Object.entries(STATS.stateResults)) {
      rows.push([st, data.discovered || 0, data.contacts || 0, data.verified || 0]);
    }

    rows.push(['', '', '', '']);
    rows.push(['═══ RECENT ERRORS (last 20) ═══', '', '', '']);
    rows.push(['Time', 'Source', 'Message', '']);
    for (const err of STATS.recentErrors) {
      rows.push([err.time, err.source, err.msg, '']);
    }

    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: C.sheetId, range: "'Dashboard'!A1:D" + (rows.length + 5),
      valueInputOption: 'RAW', requestBody: { values: rows }
    });
  } catch (e) { logError('Dashboard', e.message); }
}

function startDashboard() {
  if (!sheetsApi) return;
  dashboardTimer = setInterval(() => updateDashboard().catch(() => {}), C.dashboardInterval);
  updateDashboard().catch(() => {});
}

function stopDashboard() {
  if (dashboardTimer) { clearInterval(dashboardTimer); dashboardTimer = null; }
  updateDashboard().catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════
//  JOB CONTROL
// ═══════════════════════════════════════════════════════════════════
function saveState(s) { writeFileSync(C.stateFile, JSON.stringify(s, null, 2)); }
function loadState() { try { return existsSync(C.stateFile) ? JSON.parse(readFileSync(C.stateFile, 'utf8')) : null; } catch { return null; } }
function clearState() { for (const f of [C.stateFile, C.pauseFile, C.stopFile]) try { if (existsSync(f)) unlinkSync(f); } catch {} }
function isPaused() { return existsSync(C.pauseFile); }
function isStopped() { return existsSync(C.stopFile); }
async function waitPause() { if (!isPaused()) return; L.warn('PAUSED'); while (isPaused() && !isStopped()) await sleep(2000); if (!isStopped()) L.ok('RESUMED'); }

// ═══════════════════════════════════════════════════════════════════
//  EMERGENCY STATE SAVE — handles sleep, close, Ctrl+C, kill
// ═══════════════════════════════════════════════════════════════════
let _runState = null; // global ref for emergency saves
function emergencySave(signal) {
  if (_runState && _runState.phase) {
    try {
      saveState(_runState);
      L.warn(`⚡ Emergency save (${signal}): Phase ${_runState.phase}, ${(_runState.allBiz || []).length} businesses preserved`);
    } catch (e) { console.error('Emergency save failed:', e.message); }
  }
  if (signal === 'SIGTERM' || signal === 'SIGINT') {
    stopDashboard();
    process.exit(0);
  }
}
process.on('SIGINT', () => emergencySave('SIGINT'));
process.on('SIGTERM', () => emergencySave('SIGTERM'));
process.on('SIGHUP', () => emergencySave('SIGHUP'));
process.on('beforeExit', () => emergencySave('beforeExit'));
process.on('uncaughtException', (e) => { L.err(`Uncaught: ${e.message}`); emergencySave('uncaughtException'); process.exit(1); });

// ═══════════════════════════════════════════════════════════════════
//  MAIN PIPELINE — ROUND-ROBIN + INLINE ENRICHMENT (v6.1)
//  Discover chunk → Enrich → Push to Sheets → Rotate category
//  Data flows into Sheets continuously, not at the end
// ═══════════════════════════════════════════════════════════════════
async function run(stateAbbr, opts = {}) {
  const isAll = (stateAbbr === 'ALL');
  const targetStates = isAll ? Object.keys(STATES) : [stateAbbr.toUpperCase()];
  for (const k of targetStates) { if (!STATES[k]) { L.err(`Unknown state: ${k}. Use: ${Object.keys(STATES).join(', ')} or ALL`); process.exit(1); } }

  const cats = opts.categories || CATS;
  const maxPerCat = opts.maxPerCat || C.maxPerCat;
  const chunkSize = C.chunkSize;
  const sources = ['yp', 'yelp', 'bbb', 'gmaps'];

  STATS.startTime = STATS.startTime || Date.now();
  STATS.currentState = isAll ? 'ALL STATES' : STATES[targetStates[0]].name;

  console.log(`\n\x1b[1m\x1b[34m╔════════════════════════════════════════════════════════════════════╗
║  🔍 BUSINESS DISCOVERY ENGINE v6.1 — ROUND-ROBIN + LIVE ENRICH    ║
║  States: ${targetStates.join(', ').padEnd(57)}║
║  Categories: ${String(cats.length).padEnd(52)}║
║  Max per category: ${String(maxPerCat).padEnd(46)}║
║  Chunk size: ${String(chunkSize).padEnd(53)}║
║  Sources: YP + Yelp + BBB + Google Maps (shuffled)                ║
║  Mode: Discover ${chunkSize} → Enrich → Push to Sheets → Rotate          ║
╚════════════════════════════════════════════════════════════════════╝\x1b[0m\n`);

  // ─── LOAD STATE OR START FRESH ───
  const saved = loadState();
  let allBiz = [], globalSeen = new Set(), catCounts = {}, catWorkIdx = {};
  let enrichedSet = new Set();

  if (saved && !opts.fresh) {
    L.info(`Resuming: ${saved.allBiz?.length || 0} businesses, ${Object.keys(saved.catCounts || {}).length} categories tracked`);
    allBiz = saved.allBiz || saved.biz || [];
    catCounts = saved.catCounts || {};
    catWorkIdx = saved.catWorkIdx || {};
    for (const b of allBiz) {
      globalSeen.add(dedupKey(b));
      if (b.enriched_at || b.contacts?.length) enrichedSet.add(dedupKey(b));
    }
    recomputeStats(allBiz, 1, 0);
  }

  _runState = { phase: 1, allBiz, catCounts, catWorkIdx };
  for (const f of [C.pauseFile, C.stopFile]) try { if (existsSync(f)) unlinkSync(f); } catch {}

  // ─── SHEETS INIT ───
  const sheetsOk = await initSheets();
  if (!sheetsOk) {
    L.err('Google Sheets authentication failed — cannot continue without Sheets.');
    process.exit(1);
  }
  for (const k of targetStates) await ensureTab(STATES[k].tab);
  await ensureDashboard();
  startDashboard();
  const t0 = Date.now();

  try {
    // Build work queues per category: shuffled (state, source, city) combos
    const catWork = {};
    for (const cat of cats) {
      catWork[cat] = [];
      for (const stKey of targetStates) {
        for (const src of sources) {
          for (const city of STATES[stKey].cities) {
            catWork[cat].push({ stKey, src, city });
          }
        }
      }
      shuffle(catWork[cat]);
    }

    const catOrder = shuffle([...cats]);
    let roundNum = 0;

    while (true) {
      const activeCats = catOrder.filter(c =>
        (catCounts[c] || 0) < maxPerCat &&
        (catWorkIdx[c] || 0) < catWork[c].length
      );
      if (activeCats.length === 0) break;

      roundNum++;
      L.phase(`ROUND ${roundNum}: ${activeCats.length} active categories, ${allBiz.length} total businesses`);

      for (const cat of activeCats) {
        if (isStopped()) { _runState = { phase: 1, allBiz, catCounts, catWorkIdx }; saveState(_runState); return; }
        await waitPause();

        // ═══ STEP 1: DISCOVER CHUNK (browser needed) ═══
        const chunkBiz = [];
        const startIdx = catWorkIdx[cat] || 0;
        STATS.currentPhase = `Discover: "${cat}" (${catCounts[cat] || 0}/${maxPerCat})`;
        L.info(`🔄 [${cat}] ${catCounts[cat] || 0}/${maxPerCat} — round ${roundNum}`);

        let page = await getPage();
        try {
          for (let i = startIdx; i < catWork[cat].length && chunkBiz.length < chunkSize; i++) {
            if (isStopped()) { catWorkIdx[cat] = i; break; }

            const { stKey, src, city } = catWork[cat][i];
            catWorkIdx[cat] = i + 1;

            let results = [];
            try {
              switch (src) {
                case 'yp': results = await discoverYPSingle(page, STATES[stKey], cat, city); break;
                case 'yelp': results = await discoverYelpSingle(page, STATES[stKey], cat, city); break;
                case 'bbb': results = await discoverBBBSingle(page, STATES[stKey], cat, city); break;
                case 'gmaps': results = await discoverGMapsSingle(page, STATES[stKey], cat, city); break;
              }
            } catch (e) { logError(src.toUpperCase(), `${cat}/${city}/${stKey}: ${e.message}`); continue; }

            let unitNew = 0;
            for (const biz of results) {
              const key = dedupKey(biz);
              if (globalSeen.has(key)) continue;
              globalSeen.add(key);
              biz.stateKey = stKey;
              allBiz.push(biz);
              chunkBiz.push(biz);
              catCounts[cat] = (catCounts[cat] || 0) + 1;
              unitNew++;
              STATS.totalDiscovered++;
              if ((catCounts[cat] || 0) >= maxPerCat) break;
            }

            if (unitNew > 0) L.dim(`${src.toUpperCase()} "${cat}" ${city}, ${STATES[stKey].abbr}: +${unitNew} new (${catCounts[cat]} cat, ${allBiz.length} global)`);
            if ((catCounts[cat] || 0) >= maxPerCat) { L.ok(`🎯 [${cat}] HIT CAP: ${maxPerCat}`); break; }
          }

          // ═══ STEP 2: FIND WEBSITES FOR THIS CHUNK (reuse browser) ═══
          if (chunkBiz.length > 0) {
            const needWebsite = chunkBiz.filter(b => !b.website);
            if (needWebsite.length > 0) {
              STATS.currentPhase = `Websites: "${cat}" (${needWebsite.length} missing)`;
              L.info(`🌐 Finding websites for ${needWebsite.length}/${chunkBiz.length}...`);
              let wFound = 0;
              for (const biz of needWebsite) {
                try {
                  const q = encodeURIComponent(`${biz.company_name} ${biz.city} ${biz.state}`);
                  const html = await navigateAndWait(page, `https://duckduckgo.com/?q=${q}`, '.result__a', 15000);
                  if (html) {
                    const $ = cheerio.load(html);
                    $('a.result__a, a[data-testid="result-title-a"], a[href*="//"]').each((_, a) => {
                      if (biz.website) return;
                      let href = $(a).attr('href') || '';
                      const uddg = href.match(/uddg=(https?%3A[^&]+)/);
                      if (uddg) href = decodeURIComponent(uddg[1]);
                      if (!href.startsWith('http')) return;
                      if (/google\.|duckduckgo|youtube\.|yelp\.|yellowpages\.|bbb\.org|facebook\.|instagram\.|twitter\.|linkedin\.|mapquest|angi\.|homeadvisor|thumbtack|nextdoor|tripadvisor|pinterest|tiktok|reddit|wikipedia/i.test(href)) return;
                      if (href.length < 200) { biz.website = href.split('?')[0]; wFound++; STATS.websitesFound++; }
                    });
                  }
                  if (!biz.website) {
                    const ghtml = await navigateAndWait(page, `https://www.google.com/search?q=${q}`, 'div#search', 15000);
                    if (ghtml) {
                      const $g = cheerio.load(ghtml);
                      $g('a[href^="http"]').each((_, a) => {
                        if (biz.website) return;
                        const href = $g(a).attr('href') || '';
                        if (/google\.|youtube\.|yelp\.|yellowpages\.|bbb\.org|facebook\.|instagram\.|twitter\.|linkedin\.|mapquest|angi\.|homeadvisor|thumbtack|nextdoor|tripadvisor|pinterest|tiktok|reddit|wikipedia/i.test(href)) return;
                        if (href.startsWith('http') && href.length < 200) { biz.website = href.split('?')[0]; wFound++; STATS.websitesFound++; }
                      });
                    }
                  }
                  if (!biz.website) STATS.websitesMissing++;
                } catch {}
                await sleep(randDelay(C.delay, 1500));
              }
              L.ok(`Websites: ${wFound}/${needWebsite.length} found`);
            }
          }
        } finally {
          await page.close();
        }

        if (chunkBiz.length === 0) {
          L.dim(`[${cat}] no new businesses this round`);
          continue;
        }

        L.ok(`[${cat}] discovered +${chunkBiz.length} → ${catCounts[cat] || 0} total`);

        // ═══ STEP 3: ENRICH + PUSH TO SHEETS (axios — no browser needed) ═══
        STATS.currentPhase = `Enrich: "${cat}" (${chunkBiz.length} businesses)`;
        L.phase(`ENRICHING "${cat}" — ${chunkBiz.length} businesses`);

        const withSites = chunkBiz.filter(b => b.website);
        const noSites = chunkBiz.filter(b => !b.website);

        // Push no-website businesses immediately
        if (noSites.length) {
          for (const b of noSites) {
            const tab = b.stateKey ? STATES[b.stateKey]?.tab : guessStateTab(b);
            if (tab) await batchPushRows(tab, [b]);
          }
          for (const k of targetStates) await flushRows(STATES[k].tab);
          L.dim(`Pushed ${noSites.length} businesses (no website) to Sheets`);
        }

        // Enrich businesses with websites → website visit → contacts → social → WHOIS → MX → Sheets
        for (let i = 0; i < withSites.length; i++) {
          if (isStopped()) {
            for (const k of targetStates) await flushRows(STATES[k].tab);
            _runState = { phase: 1, allBiz, catCounts, catWorkIdx };
            saveState(_runState);
            return;
          }
          await waitPause();

          const b = withSites[i];
          STATS.currentPhase = `Enrich "${cat}" ${i + 1}/${withSites.length}: ${b.company_name}`;
          L.info(`[${i + 1}/${withSites.length}] ${b.company_name} — ${b.website}`);

          try {
            const eb = await enrichBusiness(b);
            const idx = allBiz.findIndex(x => dedupKey(x) === dedupKey(b));
            if (idx >= 0) allBiz[idx] = eb;
            enrichedSet.add(dedupKey(eb));

            const tab = eb.stateKey ? STATES[eb.stateKey]?.tab : guessStateTab(eb);
            if (tab) await batchPushRows(tab, [eb]);
            STATS.enriched++;

            const v = eb.contacts?.filter(c => c.confidence?.includes('verified') || c.confidence?.includes('mx_ok')).length || 0;
            const inf = eb.contacts?.filter(c => c.confidence?.includes('inferred')).length || 0;
            L.ok(`${b.company_name}: ${eb.contacts?.length || 0} contacts (${v} verified, ${inf} inferred)`);
          } catch (e) {
            STATS.enrichErrors++; logError('Enrich', `${b.company_name}: ${e.message}`);
            L.warn(`Failed: ${b.company_name}: ${e.message}`);
            const tab = b.stateKey ? STATES[b.stateKey]?.tab : guessStateTab(b);
            if (tab) await batchPushRows(tab, [b]);
          }
        }

        // Flush all remaining rows
        for (const k of targetStates) await flushRows(STATES[k].tab);
        L.ok(`[${cat}] enriched & pushed to Sheets ✅`);

        // Checkpoint after each category
        _runState = { phase: 1, allBiz, catCounts, catWorkIdx };
        saveState(_runState);
      }
    }

  } finally {
    await closeBrowser();
  }

  // ═══ SUMMARY ═══
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const totalContacts = allBiz.reduce((s, b) => s + (b.contacts?.length || 0), 0);
  const verified = allBiz.reduce((s, b) => s + (b.contacts?.filter(c => c.confidence?.includes('verified') || c.confidence?.includes('mx_ok')).length || 0), 0);
  const inferred = allBiz.reduce((s, b) => s + (b.contacts?.filter(c => c.confidence?.includes('inferred')).length || 0), 0);
  const whoisContacts = allBiz.reduce((s, b) => s + (b.contacts?.filter(c => c.confidence === 'whois').length || 0), 0);

  recomputeStats(allBiz, 5, allBiz.length);
  STATS.currentPhase = 'Complete';
  for (const k of targetStates) {
    const stBiz = allBiz.filter(b => (b.stateKey || '') === k || (b.state || '').toLowerCase() === STATES[k].name.toLowerCase());
    STATS.stateResults[STATES[k].name] = { discovered: stBiz.length, contacts: stBiz.reduce((s, b) => s + (b.contacts?.length || 0), 0), verified: stBiz.reduce((s, b) => s + (b.contacts?.filter(c => c.confidence?.includes('verified')).length || 0), 0) };
  }
  STATS.statesCompleted = targetStates.map(k => STATES[k].name);
  _runState = null;
  clearState();
  await updateDashboard();

  const catBreakdown = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
  const catComplete = catBreakdown.filter(([, n]) => n >= maxPerCat).length;

  console.log(`\n\x1b[1m\x1b[32m╔════════════════════════════════════════════════════════════════════╗
║  🎉 COMPLETE — ROUND-ROBIN + LIVE ENRICHMENT                       ║
╠════════════════════════════════════════════════════════════════════╣
║  📊 Businesses discovered:   ${String(allBiz.length).padEnd(38)}║
║  🗂  Categories with data:   ${String(catBreakdown.length + '/' + cats.length).padEnd(38)}║
║  🎯 Categories at cap:       ${String(catComplete + '/' + cats.length + ' (' + maxPerCat + ' each)').padEnd(38)}║
║  🌎 States covered:          ${String(targetStates.join(', ')).padEnd(38)}║
║  👥 Total contacts:          ${String(totalContacts).padEnd(38)}║
║  ✅ MX-verified emails:      ${String(verified).padEnd(38)}║
║  🧠 Pattern-inferred emails: ${String(inferred).padEnd(38)}║
║  🔍 WHOIS contacts:          ${String(whoisContacts).padEnd(38)}║
║  🌐 With websites:           ${String(allBiz.filter(b => b.website).length).padEnd(38)}║
║  📱 Social profiles found:   ${String(STATS.facebookFound + STATS.instagramFound + STATS.linkedinFound + STATS.twitterFound).padEnd(38)}║
║  🆕 New businesses (<2yr):   ${String(STATS.newBiz).padEnd(38)}║
║  ⏱️  Time: ${String(Math.floor(elapsed / 3600) + 'h ' + Math.floor((elapsed % 3600) / 60) + 'm ' + elapsed % 60 + 's').padEnd(55)}║
╚════════════════════════════════════════════════════════════════════╝\x1b[0m
\x1b[36m📎 https://docs.google.com/spreadsheets/d/${C.sheetId}/edit\x1b[0m\n`);

  L.info('Top categories:');
  for (const [cat, count] of catBreakdown.slice(0, 10)) {
    console.log(`   ${count >= maxPerCat ? '🎯' : '  '} ${cat}: ${count}`);
  }
}

// Helper: guess state tab from business data
function guessStateTab(biz) {
  const s = (biz.state || '').toLowerCase();
  for (const [k, v] of Object.entries(STATES)) {
    if (v.name.toLowerCase() === s) return v.tab;
  }
  return 'Other';
}

// ═══════════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════════
function parseArgs(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--state' && args[i + 1]) o.state = args[++i].toUpperCase();
    else if (args[i] === '--categories' && args[i + 1]) o.categories = args[++i].split(',').map(s => s.trim());
    else if (args[i] === '--max-per-cat' && args[i + 1]) o.maxPerCat = parseInt(args[++i]);
    else if (args[i] === '--max' && args[i + 1]) o.maxPerCat = parseInt(args[++i]); // alias
    else if (args[i] === '--chunk' && args[i + 1]) C.chunkSize = parseInt(args[++i]);
    else if (args[i] === '--fresh') o.fresh = true;
  }
  return o;
}

function help() {
  console.log(`
\x1b[1m\x1b[34mBUSINESS DISCOVERY ENGINE v6.1 — ROUND-ROBIN + LIVE ENRICH\x1b[0m

\x1b[1mRUN (RECOMMENDED — ALL STATES, ROUND-ROBIN):\x1b[0m
  node engine.js start --state ALL               All 5 states, 1000/category, shuffle everything
  node engine.js start --state ALL --max 500      All states, 500/category cap
  node engine.js start --state ALL --chunk 100    Rotate category every 100 discoveries

\x1b[1mRUN (SINGLE STATE):\x1b[0m
  node engine.js start --state AZ                 Arizona only, 1000/category
  node engine.js start --state NV --max 200       Nevada, 200/category cap
  node engine.js start --state OH --categories "plumber,dentist"

\x1b[1mFLAGS:\x1b[0m
  --state ALL|AZ|NV|OH|ID|WA    Which state(s) to discover
  --max N / --max-per-cat N      Max businesses per category (default: 1000)
  --chunk N                      Rotate to next category after N discoveries (default: 250)
  --categories "a,b,c"           Specific categories only
  --fresh                        Ignore saved progress, start from scratch

\x1b[1mJOB CONTROL:\x1b[0m
  node engine.js pause / resume / stop / status / reset

\x1b[1mSTATES:\x1b[0m  ${Object.entries(STATES).map(([k, v]) => `${k} (${v.name})`).join(', ')}

\x1b[1mBACKGROUND:\x1b[0m
  nohup node engine.js start --state ALL --fresh > full-run.log 2>&1 &
  tail -f full-run.log

\x1b[1mMONITOR:\x1b[0m  Check the Dashboard tab in your Google Sheet for live stats.

\x1b[1mHOW IT WORKS:\x1b[0m
  For each category chunk (250 businesses):
  1. DISCOVER — scrape YP/Yelp/BBB/GMaps across shuffled states+cities
  2. WEBSITES — DuckDuckGo + Google to find business websites
  3. ENRICH — visit each website, extract contacts, social, WHOIS, age
  4. PUSH — rows appear in your Google Sheet immediately
  Then rotate to next category and repeat.
  Data flows into Sheets continuously — no waiting!
  `);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  switch (cmd) {
    case 'start':
      if (!opts.state) { L.err('Need --state. Example: node engine.js start --state ALL'); process.exit(1); }
      await run(opts.state, opts);
      break;
    case 'pause': writeFileSync(C.pauseFile, new Date().toISOString()); L.ok('⏸  Pause signal sent'); break;
    case 'resume': {
      try { if (existsSync(C.pauseFile)) unlinkSync(C.pauseFile); } catch {}
      try { if (existsSync(C.stopFile)) unlinkSync(C.stopFile); } catch {}
      const s = loadState();
      if (s) { L.ok(`▶  Resuming Phase ${s.phase}`); await run(s.st || 'ALL', opts); }
      else L.warn('No saved state. Use "start --state ALL"');
      break;
    }
    case 'stop': writeFileSync(C.stopFile, new Date().toISOString()); L.ok('⏹  Stop signal sent'); stopDashboard(); break;
    case 'status': {
      const s = loadState();
      if (!s) { console.log('\n  Status: IDLE\n'); break; }
      const label = isStopped() ? '\x1b[31mSTOPPED\x1b[0m' : isPaused() ? '\x1b[33mPAUSED\x1b[0m' : '\x1b[32mRUNNING\x1b[0m';
      const catsDone = Object.keys(s.catCounts || {}).length;
      console.log(`\n  Status: ${label}\n  Phase: ${s.phase}/4\n  Discovered: ${(s.allBiz || []).length}\n  Categories tracked: ${catsDone}\n  Enriched: ${s.enrichIdx || 0}\n`);
      break;
    }
    case 'reset': clearState(); L.ok('State cleared'); break;
    case 'states': console.log(''); Object.entries(STATES).forEach(([k, v]) => console.log(`  \x1b[36m${k}\x1b[0m ${v.name} — ${v.cities.join(', ')}`)); console.log(''); break;
    case 'cats': case 'categories':
      console.log(`\n  \x1b[1m${CATS.length} Categories:\x1b[0m`);
      CATS.forEach((c, i) => console.log(`  ${String(i+1).padStart(3)}. ${c}`));
      console.log('');
      break;
    default: help();
  }
}

main().catch(e => { L.err(`Fatal: ${e.message}`); console.error(e.stack); stopDashboard(); closeBrowser(); process.exit(1); });
