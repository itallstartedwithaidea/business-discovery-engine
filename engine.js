#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 *  BUSINESS DISCOVERY ENGINE v5.0
 *  Apollo-level business intelligence from 100% public data
 *
 *  v5 Upgrades:
 *  - 60+ business categories (retail, ecommerce, health, home)
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
import fs from 'fs/promises';
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
  maxBiz: parseInt(process.env.MAX_BUSINESSES) || 1000,
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

// ═══════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));
const randDelay = (base, variance) => base + Math.floor(Math.random() * variance);

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
    const age = b.age_label || '', founded = b.year_founded || '', industry = b.industry || '';
    if (b.contacts?.length) {
      for (const c of b.contacts) rows.push([c.first_name || '', c.last_name || '', c.email || '', c.title || '', co, loc, web, c.phone || ph, fb, ig, li, tw, src, c.confidence || 'found', age, founded, industry, today]);
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
      ['BUSINESS DISCOVERY ENGINE v5.0 — LIVE DASHBOARD', '', '', ''],
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
//  MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════
async function run(stateAbbr, opts = {}) {
  const st = STATES[stateAbbr.toUpperCase()];
  if (!st) { L.err(`Unknown state: ${stateAbbr}. Use: ${Object.keys(STATES).join(', ')}`); process.exit(1); }
  const cats = opts.categories || CATS;
  const cities = opts.cities || st.cities;
  const max = opts.max || C.maxBiz;

  STATS.currentState = st.name;
  STATS.startTime = STATS.startTime || Date.now();

  console.log(`\n\x1b[1m\x1b[34m╔════════════════════════════════════════════════════════════════════╗
║  🔍 BUSINESS DISCOVERY ENGINE v5.0 (Puppeteer + Stealth)          ║
║  State: ${(st.name + ' (' + st.abbr + ')').padEnd(57)}║
║  Categories: ${String(cats.length).padEnd(52)}║
║  Cities: ${String(cities.length).padEnd(56)}║
║  Max: ${String(max).padEnd(60)}║
║  Sources: YP + Yelp + BBB + Google Maps                           ║
║  Features: Social Media | Business Age | Batch Push | Dashboard    ║
╚════════════════════════════════════════════════════════════════════╝\x1b[0m\n`);

  const saved = loadState();
  let allBiz = [], startPhase = 1, enrichIdx = 0;
  if (saved && saved.st === stateAbbr.toUpperCase() && !opts.fresh) {
    L.info(`Resuming: Phase ${saved.phase}, ${saved.discovered || 0} discovered, ${saved.enriched || 0} enriched`);
    allBiz = saved.biz || []; startPhase = saved.phase || 1; enrichIdx = saved.enrichIdx || 0;
  }
  for (const f of [C.pauseFile, C.stopFile]) try { if (existsSync(f)) unlinkSync(f); } catch {}

  const sheetsOk = await initSheets();
  if (sheetsOk) {
    await ensureTab(st.tab);
    await ensureDashboard();
    startDashboard();
  }
  const t0 = Date.now();

  try {
    // PHASE 1: DISCOVERY
    if (startPhase <= 1) {
      STATS.currentPhase = 'Phase 1: Discovery';
      L.phase('PHASE 1: MULTI-SOURCE DISCOVERY (YP + Yelp + BBB + Maps)');

      await waitPause(); if (isStopped()) { saveState({ st: stateAbbr.toUpperCase(), phase: 1, biz: allBiz }); return; }
      allBiz.push(...await discoverYP(st, cats, cities, max));

      await waitPause(); if (isStopped()) { saveState({ st: stateAbbr.toUpperCase(), phase: 1, biz: allBiz }); return; }
      allBiz.push(...await discoverYelp(st, cats, cities, Math.round(max / 2)));

      await waitPause(); if (isStopped()) { saveState({ st: stateAbbr.toUpperCase(), phase: 1, biz: allBiz }); return; }
      allBiz.push(...await discoverBBB(st, cats, cities, Math.round(max / 3)));

      await waitPause(); if (isStopped()) { saveState({ st: stateAbbr.toUpperCase(), phase: 1, biz: allBiz }); return; }
      allBiz.push(...await discoverGMaps(st, cats, cities, Math.round(max / 3)));

      STATS.totalDiscovered = allBiz.length;
      L.ok(`Discovery: ${allBiz.length} total records`);
      saveState({ st: stateAbbr.toUpperCase(), phase: 2, biz: allBiz, discovered: allBiz.length });
    }

    // PHASE 2: DEDUP
    if (startPhase <= 2) {
      STATS.currentPhase = 'Phase 2: Dedup';
      L.phase('PHASE 2: ENTITY RESOLUTION & DEDUPLICATION');
      allBiz = dedupe(allBiz);
      saveState({ st: stateAbbr.toUpperCase(), phase: 3, biz: allBiz, discovered: allBiz.length, enrichIdx: 0 });
    }

    // PHASE 3: FIND MISSING WEBSITES
    if (startPhase <= 3) {
      STATS.currentPhase = 'Phase 3: Websites';
      L.phase('PHASE 3: FINDING MISSING WEBSITES');
      await waitPause(); if (isStopped()) { saveState({ st: stateAbbr.toUpperCase(), phase: 3, biz: allBiz }); return; }
      allBiz = await findMissingWebsites(allBiz);
      saveState({ st: stateAbbr.toUpperCase(), phase: 4, biz: allBiz, discovered: allBiz.length, enrichIdx });
    }

    // Close browser for discovery — enrichment uses axios
    await closeBrowser();

    // PHASE 4: ENRICHMENT
    if (startPhase <= 4) {
      STATS.currentPhase = 'Phase 4: Enrichment';
      L.phase('PHASE 4: ENRICH → SOCIAL → WHOIS → AGE → INFER → MX → PUSH');
      const withSites = allBiz.filter(b => b.website);
      const noSites = allBiz.filter(b => !b.website);
      L.info(`${withSites.length} with websites | ${noSites.length} without`);

      if (enrichIdx === 0 && sheetsOk && noSites.length) {
        for (const b of noSites) await batchPushRows(st.tab, [b]);
        await flushRows(st.tab);
        L.ok(`Pushed ${noSites.length} businesses (no website)`);
      }

      let enriched = enrichIdx;
      for (let i = enrichIdx; i < withSites.length; i++) {
        await waitPause();
        if (isStopped()) { await flushRows(st.tab); saveState({ st: stateAbbr.toUpperCase(), phase: 4, biz: allBiz, discovered: allBiz.length, enrichIdx: i, enriched }); L.warn(`Stopped at ${i}/${withSites.length}`); return; }
        const b = withSites[i];
        console.log('');
        L.info(`[${i + 1}/${withSites.length}] ${b.company_name} — ${b.website}`);
        try {
          const eb = await enrichBusiness(b);
          const idx = allBiz.findIndex(x => x.company_name === b.company_name && x.website === b.website);
          if (idx >= 0) allBiz[idx] = eb;
          if (sheetsOk) await batchPushRows(st.tab, [eb]);
          enriched++; STATS.enriched++;
          const v = eb.contacts?.filter(c => c.confidence?.includes('verified') || c.confidence?.includes('mx_ok')).length || 0;
          const inf = eb.contacts?.filter(c => c.confidence?.includes('inferred')).length || 0;
          L.ok(`${b.company_name}: ${eb.contacts?.length || 0} contacts (${v} verified, ${inf} inferred)`);
        } catch (e) {
          STATS.enrichErrors++; logError('Enrich', `${b.company_name}: ${e.message}`);
          L.warn(`Failed: ${b.company_name}: ${e.message}`);
          if (sheetsOk) await batchPushRows(st.tab, [b]);
        }
        if (i % 10 === 0) saveState({ st: stateAbbr.toUpperCase(), phase: 4, biz: allBiz, discovered: allBiz.length, enrichIdx: i + 1, enriched });
      }
      if (sheetsOk) await flushRows(st.tab);
    }
  } finally {
    await closeBrowser();
  }

  // SUMMARY
  STATS.currentPhase = 'Complete';
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const totalContacts = allBiz.reduce((s, b) => s + (b.contacts?.length || 0), 0);
  const verified = allBiz.reduce((s, b) => s + (b.contacts?.filter(c => c.confidence?.includes('verified') || c.confidence?.includes('mx_ok')).length || 0), 0);
  const inferred = allBiz.reduce((s, b) => s + (b.contacts?.filter(c => c.confidence?.includes('inferred')).length || 0), 0);
  const whoisContacts = allBiz.reduce((s, b) => s + (b.contacts?.filter(c => c.confidence === 'whois').length || 0), 0);

  // Save per-state results
  STATS.stateResults[st.name] = { discovered: allBiz.length, contacts: totalContacts, verified };
  STATS.statesCompleted.push(st.name);

  // CSV
  const csvH = 'First Name,Last Name,Email,Title,Company Name,Location,Website,Phone,Facebook,Instagram,LinkedIn,Twitter,Source,Confidence,Biz Age,Year Founded,Industry,Date';
  const csvRows = toRows(allBiz);
  const csv = csvH + '\n' + csvRows.map(r => r.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const csvFile = `discovery-${stateAbbr.toUpperCase()}-${new Date().toISOString().split('T')[0]}.csv`;
  await fs.writeFile(csvFile, csv);
  clearState();

  // Final dashboard update
  if (sheetsOk) await updateDashboard();

  console.log(`\n\x1b[1m\x1b[32m╔════════════════════════════════════════════════════════════════════╗
║  🎉 COMPLETE — ${st.name.toUpperCase().padEnd(52)}║
╠════════════════════════════════════════════════════════════════════╣
║  📊 Businesses discovered:   ${String(allBiz.length).padEnd(38)}║
║  👥 Total contacts:          ${String(totalContacts).padEnd(38)}║
║  ✅ MX-verified emails:      ${String(verified).padEnd(38)}║
║  🧠 Pattern-inferred emails: ${String(inferred).padEnd(38)}║
║  🔍 WHOIS contacts:          ${String(whoisContacts).padEnd(38)}║
║  🌐 With websites:           ${String(allBiz.filter(b => b.website).length).padEnd(38)}║
║  📱 Social profiles found:   ${String(STATS.facebookFound + STATS.instagramFound + STATS.linkedinFound + STATS.twitterFound).padEnd(38)}║
║  🆕 New businesses (<2yr):   ${String(STATS.newBiz).padEnd(38)}║
║  ⏱️  Time: ${String(Math.floor(elapsed / 60) + 'm ' + elapsed % 60 + 's').padEnd(55)}║
║  📁 CSV: ${csvFile.padEnd(57)}║
╚════════════════════════════════════════════════════════════════════╝\x1b[0m
${C.sheetId ? `\x1b[36m📎 https://docs.google.com/spreadsheets/d/${C.sheetId}/edit\x1b[0m` : ''}\n`);
}

// ═══════════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════════
function parseArgs(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--state' && args[i + 1]) o.state = args[++i].toUpperCase();
    else if (args[i] === '--categories' && args[i + 1]) o.categories = args[++i].split(',').map(s => s.trim());
    else if (args[i] === '--cities' && args[i + 1]) o.cities = args[++i].split(',').map(s => s.trim());
    else if (args[i] === '--max' && args[i + 1]) o.max = parseInt(args[++i]);
    else if (args[i] === '--fresh') o.fresh = true;
    else if (args[i] === '--no-sheets') o.noSheets = true;
  }
  return o;
}

function help() {
  console.log(`
\x1b[1m\x1b[34mBUSINESS DISCOVERY ENGINE v5.0\x1b[0m

\x1b[1mRUN:\x1b[0m
  node engine.js start --state AZ                Full Arizona (60+ categories)
  node engine.js start --state NV --max 500      Nevada, 500 cap
  node engine.js start --state OH --categories "plumber,dentist"
  node engine.js start --state AZ --no-sheets    CSV only
  node engine.js start --state AZ --fresh        Ignore saved progress

\x1b[1mJOB CONTROL:\x1b[0m
  node engine.js pause / resume / stop / status / reset

\x1b[1mSTATES:\x1b[0m  ${Object.entries(STATES).map(([k, v]) => `${k} (${v.name})`).join(', ')}

\x1b[1mRUN ALL STATES:\x1b[0m
  nohup bash -c 'node engine.js start --state AZ --fresh && node engine.js start --state NV --fresh && node engine.js start --state OH --fresh && node engine.js start --state ID --fresh && node engine.js start --state WA --fresh' > full-run.log 2>&1 &

\x1b[1mMONITOR:\x1b[0m  Check the Dashboard tab in your Google Sheet for live stats.
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
      try { if (existsSync(C.pauseFile)) unlinkSync(C.pauseFile); } catch {}
      try { if (existsSync(C.stopFile)) unlinkSync(C.stopFile); } catch {}
      const s = loadState();
      if (s) { L.ok(`▶  Resuming ${s.st} Phase ${s.phase}`); await run(s.st, opts); }
      else L.warn('No saved state. Use "start --state XX"');
      break;
    }
    case 'stop': writeFileSync(C.stopFile, new Date().toISOString()); L.ok('⏹  Stop signal sent'); stopDashboard(); break;
    case 'status': {
      const s = loadState();
      if (!s) { console.log('\n  Status: IDLE\n'); break; }
      const label = isStopped() ? '\x1b[31mSTOPPED\x1b[0m' : isPaused() ? '\x1b[33mPAUSED\x1b[0m' : '\x1b[32mRUNNING\x1b[0m';
      console.log(`\n  Status: ${label}\n  State: ${s.st}\n  Phase: ${s.phase}/4\n  Discovered: ${s.discovered || 0}\n  Enriched: ${s.enriched || 0}\n`);
      break;
    }
    case 'reset': clearState(); L.ok('State cleared'); break;
    case 'states': console.log(''); Object.entries(STATES).forEach(([k, v]) => console.log(`  \x1b[36m${k}\x1b[0m ${v.name} — ${v.cities.join(', ')}`)); console.log(''); break;
    default: help();
  }
}

main().catch(e => { L.err(`Fatal: ${e.message}`); console.error(e.stack); stopDashboard(); closeBrowser(); process.exit(1); });
