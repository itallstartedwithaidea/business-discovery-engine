# Business Discovery Engine v6.1

**Apollo-level business intelligence from 100% public data.**

Round-robin discovery across 5 states, 65 categories, and 4 sources — with inline enrichment that pushes data to your Google Sheet in real-time.

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![License](https://img.shields.io/badge/License-MIT-blue) ![Categories](https://img.shields.io/badge/Categories-65-orange) ![Sources](https://img.shields.io/badge/Sources-4-purple)

---

## What It Does

For each business discovered, the engine:

1. **Discovers** the business from Yellow Pages, Yelp, BBB, or Google Maps
2. **Finds its website** via DuckDuckGo + Google search
3. **Visits the website** — crawls homepage + contact/about/team pages
4. **Extracts contacts** — emails, names, titles, phone numbers from 9 extraction methods
5. **Finds social media** — Facebook, Instagram, LinkedIn, Twitter/X links
6. **WHOIS lookup** — domain age, registration date, registrant info
7. **Email pattern inference** — detects `first.last@`, `flast@`, etc. and generates emails for names without them
8. **MX verification** — validates every email has working mail servers
9. **Pushes to Google Sheets** — each state gets its own tab, live dashboard tracks progress

All from 100% public data. No APIs, no subscriptions, no data brokers.

---

## Architecture: Round-Robin + Inline Enrichment

```
┌─────────────────────────────────────────────────────┐
│  For each category (65 total):                       │
│                                                       │
│  1. DISCOVER 250 businesses                          │
│     └─ Shuffle: states × sources × cities            │
│     └─ YP in Phoenix → Yelp in Columbus →            │
│        BBB in Boise → GMaps in Vegas                 │
│     └─ Global dedup on every insert                  │
│                                                       │
│  2. FIND WEBSITES (DuckDuckGo + Google)              │
│                                                       │
│  3. ENRICH each business                             │
│     └─ Visit website → extract contacts/social       │
│     └─ WHOIS → domain age → business age scoring     │
│     └─ Email inference → MX verification             │
│                                                       │
│  4. PUSH TO SHEETS (immediately)                     │
│     └─ Data flows into your Sheet within minutes     │
│                                                       │
│  → Rotate to next category and repeat                │
└─────────────────────────────────────────────────────┘
```

**Key difference from v5:** Data flows into your Sheet continuously as each chunk completes. No waiting hours for all discovery to finish first.

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/itallstartedwithaidea/business-discovery-engine.git
cd business-discovery-engine
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:
- `GOOGLE_SPREADSHEET_ID` — your Google Sheet ID (from the URL)
- `GOOGLE_CREDENTIALS_PATH` — path to your service account JSON key

**Google Sheets setup:**
1. Create a [Google Cloud service account](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Enable the Google Sheets API
3. Download the JSON key file → save as `google-credentials.json`
4. Share your Google Sheet with the service account email (Editor access)

### 3. Run

```bash
# All 5 states, round-robin, 1000/category
node engine.js start --state ALL --fresh

# Background run (safe to close terminal)
nohup node engine.js start --state ALL --fresh > full-run.log 2>&1 &
tail -f full-run.log

# Single state
node engine.js start --state AZ --fresh

# Custom limits
node engine.js start --state ALL --max 500 --chunk 100 --fresh
```

---

## States & Categories

### 5 States (54 cities)

| State | Cities |
|-------|--------|
| **AZ** | Phoenix, Scottsdale, Tempe, Mesa, Chandler, Gilbert, Glendale, Peoria, Surprise, Tucson, Flagstaff, Yuma, Goodyear, Buckeye, Avondale |
| **NV** | Las Vegas, Henderson, Reno, North Las Vegas, Sparks, Carson City, Mesquite, Boulder City, Elko, Fernley |
| **OH** | Columbus, Cleveland, Cincinnati, Toledo, Akron, Dayton, Canton, Youngstown, Dublin, Westerville, Mason, Parma |
| **ID** | Boise, Meridian, Nampa, Caldwell, Idaho Falls, Pocatello, Twin Falls, Coeur d'Alene, Lewiston, Eagle |
| **WA** | Seattle, Spokane, Tacoma, Vancouver, Bellevue, Kent, Everett, Renton, Kirkland, Redmond, Olympia, Bellingham |

### 65 Categories

**Local Services (30):** plumber, electrician, HVAC, locksmith, roofer, painter, landscaper, pest control, garage door, fence company, tree service, carpet cleaner, mover, junk removal, window cleaner, pressure washing, chimney sweep, pool service, handyman, appliance repair, auto mechanic, auto body shop, tow truck, flooring installer, drywall contractor, concrete contractor, locksmith, moving company, cleaning service, construction

**Retail (10):** boutique, jewelry store, furniture store, sporting goods, pet store, gift shop, wine shop, supplement store, thrift store, consignment shop

**Food & Beverage (5):** coffee shop, brewery, catering, food truck, juice bar

**Health & Wellness (6):** med spa, dermatologist, physical therapy, optometrist, mental health counselor, massage therapist

**Professional Services (6):** financial advisor, mortgage broker, staffing agency, IT services, web design, commercial cleaning

**Home Services (8):** garage door, pest control, fence company, pool service, solar installer, window cleaning, tree service, pressure washing

---

## CLI Reference

```bash
# ── RUN ──
node engine.js start --state ALL                    # All states, round-robin
node engine.js start --state AZ                     # Single state
node engine.js start --state ALL --max 500          # 500/category cap
node engine.js start --state ALL --chunk 100        # Rotate every 100
node engine.js start --state OH --categories "plumber,dentist"
node engine.js start --state ALL --fresh            # Ignore saved progress

# ── JOB CONTROL ──
node engine.js pause                                # Pause after current business
node engine.js resume                               # Resume from pause
node engine.js stop                                 # Graceful stop + checkpoint
node engine.js status                               # Show current state
node engine.js reset                                # Clear all saved progress

# ── INFO ──
node engine.js states                               # List all states + cities
node engine.js cats                                 # List all 65 categories
node engine.js                                      # Help
```

---

## Google Sheet Output

Each state gets its own tab with these columns:

| Column | Description |
|--------|-------------|
| First Name | Contact first name |
| Last Name | Contact last name |
| Email | Email address |
| Title | Job title (Owner, Manager, etc.) |
| Company Name | Business name |
| Location | City, State |
| Website | Business website URL |
| Phone | Phone number |
| Facebook | Facebook page URL |
| Instagram | Instagram profile URL |
| LinkedIn | LinkedIn company/profile URL |
| Twitter/X | Twitter/X profile URL |
| Source | Discovery source(s) |
| Confidence | verified, inferred, whois, no_mx |
| Biz Age | NEW (<1 yr), Growing (2-5 yr), Established, Mature |
| Year Founded | Domain registration year |
| Industry | Business category |
| Date | Discovery date |

**Dashboard tab** auto-refreshes every 30 seconds with live stats: discovery counts, enrichment progress, error rates, per-source breakdowns, and per-state results.

---

## Crash Recovery

The engine survives laptop sleep, terminal disconnects, and crashes:

- **Signal handlers** — SIGTERM, SIGINT, SIGHUP trigger emergency state save
- **Per-category checkpoints** — progress saved after each category chunk completes
- **Global dedup on resume** — rebuilds the seen-set from checkpoint data, zero duplicates
- **Stats recomputation** — dashboard numbers rebuild from actual data, not stale counters

Just re-run the same command — it picks up exactly where it left off.

---

## 4 Discovery Sources

| Source | Method | Coverage |
|--------|--------|----------|
| **Yellow Pages** | Puppeteer + Stealth | 3 pages per category/city |
| **Yelp** | Puppeteer + anti-detection | Auto-skips after 5 blocks |
| **BBB** | Puppeteer | Top 15 categories, 3 cities |
| **Google Maps** | Puppeteer | Top 20 categories, 5 cities |

---

## 9 Email Extraction Methods

1. **JSON-LD / Schema.org** structured data
2. **`mailto:` links** in HTML
3. **Regex on page text** (email patterns)
4. **Meta tags** (author, contact)
5. **VCard / hCard** microformats
6. **Staff directory** parsing (name + title + email)
7. **WHOIS/RDAP** registrant data
8. **Email pattern inference** (detect pattern → generate for names without emails)
9. **MX verification** (DNS lookup to validate mail servers exist)

---

## License

MIT — built by [John Williams](https://www.itallstartedwithaidea.com) at It All Started With A Idea.
