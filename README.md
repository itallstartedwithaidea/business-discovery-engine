# Business Discovery Engine v5.0

Apollo-level business intelligence from 100% public data. Discovers businesses, extracts contacts, verifies emails, finds social media — all pushed live to Google Sheets with a real-time dashboard.

## What It Does

```
Discovery (YP + Yelp + BBB + Google Maps)
    → Deduplicate
    → Find Missing Websites
    → Crawl & Extract (9 methods + social media)
    → WHOIS Lookup + Business Age Scoring
    → Email Pattern Inference
    → MX Verification
    → Google Sheets (live push + dashboard)
```

## Features

- **4 Discovery Sources** — Yellow Pages, Yelp (smart auto-skip), BBB, Google Maps
- **65 Business Categories** — local services, retail, ecommerce, health, home services
- **5 States** — AZ, NV, OH, ID, WA (easily extensible)
- **9 Contact Extraction Methods** — JSON-LD, mailto, data-attrs, staff cards, regex, obfuscated, footers, meta, tel
- **Social Media Extraction** — Facebook, Instagram, LinkedIn, Twitter/X
- **Business Age Scoring** — NEW (<2yr), Growing (2-5yr), Established (5-10yr), Mature (10+yr)
- **Email Pattern Inference** — Detects first.last@, flast@, etc. and generates emails for names without them
- **MX Email Verification** — DNS-level verification of every email
- **WHOIS/RDAP Lookup** — Domain registrant data, owner contacts
- **Live Google Sheets Dashboard** — Auto-refreshing stats, rates, errors, per-source breakdowns
- **Batch Push** — 10 rows at a time (fast, quota-friendly)
- **Job Control** — Pause, resume, stop, checkpoint/recovery
- **Proxy Support** — Optional residential proxy rotation
- **Headless Chrome + Stealth** — Bypasses Cloudflare and JS-rendered sites

## Quick Start

```bash
git clone https://github.com/itallstartedwithaidea/business-discovery-engine.git
cd business-discovery-engine
npm install
cp .env.example .env
# Edit .env with your Google Sheet ID
# Add google-credentials.json (service account key)
node engine.js start --state AZ
```

## Commands

```bash
# Run a state
node engine.js start --state AZ
node engine.js start --state NV --max 500
node engine.js start --state OH --categories "plumber,dentist"
node engine.js start --state AZ --fresh        # ignore checkpoint

# Run all 5 states overnight
nohup bash -c 'node engine.js start --state AZ --fresh && node engine.js start --state NV --fresh && node engine.js start --state OH --fresh && node engine.js start --state ID --fresh && node engine.js start --state WA --fresh' > full-run.log 2>&1 &

# Job control
node engine.js pause
node engine.js resume
node engine.js stop
node engine.js status
node engine.js reset

# Monitor
tail -f full-run.log               # terminal output
# Or just check the Dashboard tab in your Google Sheet
```

## Output Columns

| Column | Description |
|--------|-------------|
| First Name | Contact first name |
| Last Name | Contact last name |
| Email | Verified email address |
| Title | Job title |
| Company Name | Business name |
| Location | City, State |
| Website | Business website URL |
| Phone | Phone number |
| Facebook | Facebook page URL |
| Instagram | Instagram profile URL |
| LinkedIn | LinkedIn company/person URL |
| Twitter/X | Twitter/X profile URL |
| Source | Discovery source(s) |
| Confidence | verified, inferred_mx_ok, whois, no_mx |
| Biz Age | NEW (<2yr), Growing, Established, Mature |
| Year Founded | From WHOIS domain registration |
| Industry | Business category |
| Date | Discovery date |

## Live Dashboard

The **Dashboard** tab in your Google Sheet auto-refreshes every 30 seconds with:
- Current state and phase
- Per-source discovery counts (YP, Yelp, BBB, Maps)
- Enrichment rate (businesses/hour)
- Email stats (found, verified, inferred, WHOIS)
- Social media counts (FB, IG, LinkedIn, X)
- Business age distribution
- Sheet push stats and errors
- Recent error log (last 20)

## Configuration (.env)

```
GOOGLE_SPREADSHEET_ID=your-sheet-id
GOOGLE_CREDENTIALS_PATH=google-credentials.json
DELAY_MS=3000
MAX_PAGES_PER_SITE=15
MAX_BUSINESSES=1000
PROXY_URL=                    # optional: http://user:pass@host:port
```

## License

MIT — John Williams / It All Started With A Idea
