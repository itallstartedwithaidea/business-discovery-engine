# 🔍 Business Discovery Engine v4.0

**Apollo-level business intelligence from 100% public data.**

One file. One command. Discovers small businesses from public directories, finds their websites, extracts every contact from team/contact/about pages, infers missing emails using pattern detection, verifies them via MX records, pulls WHOIS registrant data, and pushes everything live to Google Sheets with confidence scoring.

![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![No APIs Required](https://img.shields.io/badge/paid%20APIs-none-orange)

---

## What It Does (vs. Apollo/ZoomInfo)

| Capability | Apollo | ZoomInfo | **This Engine** |
|---|:---:|:---:|:---:|
| Business name, phone, address | ✅ | ✅ | ✅ |
| Website discovery | ✅ | ✅ | ✅ |
| Contact names from websites | ✅ | ✅ | ✅ |
| Contact emails from websites | ✅ | ✅ | ✅ |
| Contact titles/roles | ✅ | ✅ | ✅ |
| Email pattern inference | ✅ | ✅ | ✅ |
| MX email verification | ✅ | ✅ | ✅ |
| WHOIS registrant data | ✅ | ❌ | ✅ |
| JSON-LD/Schema.org parsing | ❌ | ❌ | ✅ |
| Obfuscated email detection | ❌ | ❌ | ✅ |
| Confidence scoring | ✅ | ✅ | ✅ |
| Live Google Sheets output | ❌ | ❌ | ✅ |
| Pause/resume/stop | ❌ | ❌ | ✅ |
| **Monthly cost** | **$49-249** | **$14,995+** | **$0** |

## Pipeline

```
Discovery (YP + Yelp + BBB)
    ↓
Entity Resolution & Dedup
    ↓
Find Missing Websites (Google Search)
    ↓
Website Enrichment (9 extraction methods)
  + WHOIS/RDAP Lookup
  + Email Pattern Inference
  + MX Verification
    ↓
Live Push to Google Sheets + CSV Backup
```

## 9 Contact Extraction Methods

1. **JSON-LD / Schema.org** — Machine-readable structured data embedded in HTML
2. **mailto: links** — With DOM context walking for names/titles
3. **data-attributes** — `data-email`, `data-staff-name`, `data-title`
4. **Staff/team cards** — CSS pattern matching (.team-member, .staff-card, etc.)
5. **Full-page regex** — Catches every email pattern on the page
6. **Obfuscated emails** — Decodes `name [at] domain [dot] com`
7. **Footer extraction** — Phone, address, contact info from footers
8. **Meta tags** — og:title, description, geo tags
9. **Tel: links** — Phone numbers from clickable tel: links

## Confidence Levels

| Level | Meaning |
|---|---|
| `verified` | Found on website + MX records valid |
| `found` | Found on website, MX check unavailable |
| `inferred_mx_ok` | Generated from email pattern + MX valid |
| `inferred` | Generated from email pattern, MX not checked |
| `whois` | From public WHOIS/RDAP registration data |
| `no_mx` | Found but domain has no MX records |

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/itallstartedwithaidea/business-discovery-engine.git
cd business-discovery-engine
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your Google Sheet ID
```

### 3. Google Sheets Setup

1. Create a [Google Cloud Service Account](https://console.cloud.google.com/)
2. Enable the **Google Sheets API**
3. Download the JSON key as `google-credentials.json`
4. Share your Google Sheet with the service account email (as Editor)

### 4. Run

```bash
# Test run (10 businesses, one category)
node engine.js start --state AZ --max 10 --categories "plumber"

# Full Arizona run
node engine.js start --state AZ

# Run without Google Sheets (CSV only)
node engine.js start --state AZ --no-sheets
```

---

## Commands

### Start Discovery

```bash
node engine.js start --state AZ                     # Full Arizona
node engine.js start --state OH --max 100            # Ohio, cap at 100
node engine.js start --state WA --categories "plumber,dentist"
node engine.js start --state ID --cities "Boise,Meridian" --fresh
node engine.js start --state AZ --no-sheets          # CSV only, no Sheets
```

### Job Control

```bash
node engine.js pause      # Pause after current business finishes
node engine.js resume     # Resume from saved checkpoint
node engine.js stop       # Stop and save progress
node engine.js status     # Show current job status
node engine.js reset      # Clear all saved state
node engine.js states     # List available states
node engine.js help       # Show full command reference
```

### npm Shortcuts

```bash
npm start                 # Default: Arizona full run
npm test                  # Quick test: AZ, 10 businesses, plumber only
npm run pause             # Pause
npm run resume            # Resume
npm run stop              # Stop
npm run status            # Status
```

## Supported States

| Code | State | Default Cities |
|---|---|---|
| **AZ** | Arizona | Phoenix, Scottsdale, Tempe, Mesa, Chandler, Gilbert, + 9 more |
| **ID** | Idaho | Boise, Meridian, Nampa, Caldwell, Idaho Falls, + 5 more |
| **OH** | Ohio | Columbus, Cleveland, Cincinnati, Toledo, Akron, + 7 more |
| **WA** | Washington | Seattle, Spokane, Tacoma, Vancouver, Bellevue, + 7 more |

### Adding New States

Edit `STATES` in `engine.js`:

```javascript
TX: { name:'Texas', abbr:'TX', tab:'Texas', yp:'tx',
      cities:['Houston','Dallas','Austin','San Antonio','Fort Worth'] }
```

## Output

### Google Sheets (live push per business)

| First Name | Last Name | Email | Title | Company | Location | Website | Phone | Source | Confidence | Date |
|---|---|---|---|---|---|---|---|---|---|---|
| John | Smith | john@smithplumbing.com | Owner | Smith Plumbing LLC | Phoenix, AZ | smithplumbing.com | (480) 555-1234 | yellowpages, yelp | verified | 2026-02-16 |
| Jane | Smith | jane@smithplumbing.com | Office Manager | Smith Plumbing LLC | Phoenix, AZ | smithplumbing.com | | yellowpages | inferred_mx_ok | 2026-02-16 |

### CSV Backup

Auto-generated per run: `discovery-AZ-2026-02-16.csv`

## Configuration

```bash
# .env file
GOOGLE_SPREADSHEET_ID=your_sheet_id_here
GOOGLE_CREDENTIALS_PATH=google-credentials.json
DELAY_MS=2500              # Delay between requests (ms)
MAX_PAGES_PER_SITE=15      # Max subpages to crawl per website
MAX_BUSINESSES=1000         # Default max businesses per run
```

## Default Categories (30)

plumber, electrician, dentist, restaurant, auto repair, salon, law firm, accountant, real estate agent, roofing, hvac, cleaning service, landscaping, insurance agent, veterinarian, fitness, photography, marketing agency, construction, mechanic, chiropractor, bakery, florist, pet grooming, daycare, tutoring, printing, tailor, locksmith, moving company

## Architecture

Single file (`engine.js`, ~1400 lines). No build step. No framework. Just Node.js.

- **Discovery**: Yellow Pages (paginated), Yelp, BBB — HTML scraping with Cheerio
- **Dedup**: Dice coefficient fuzzy matching + phone/domain exact match
- **Website Finder**: Google search for businesses missing a website
- **Enrichment**: 9 extraction methods (see above)
- **WHOIS**: RDAP protocol (REST-based, no external package)
- **Pattern Inference**: Detects `first.last@`, `flast@`, `first@`, etc. from known emails
- **Verification**: DNS MX record lookup (Node.js built-in `dns` module)
- **Output**: Google Sheets API v4 (service account) + CSV

## How Email Pattern Inference Works

1. Engine finds 3 emails on a company website: `john.smith@company.com`, `jane.doe@company.com`, `mike.wilson@company.com`
2. Detects the pattern: `first.last@domain`
3. Finds 2 names on the team page without emails: "Sarah Johnson" and "Tom Brown"
4. Generates: `sarah.johnson@company.com` and `tom.brown@company.com`
5. Verifies via MX lookup that `company.com` accepts email
6. Tags as `inferred_mx_ok` confidence

## Legal & Ethics

- **Public data only** — scrapes publicly available websites and directories
- **No LinkedIn** — no social network scraping
- **No paid APIs** — no data brokers or enrichment services
- **Rate limiting** — configurable delays between requests
- **Respectful** — stops early when comprehensive data found
- **WHOIS** — only uses publicly available registration data (RDAP)

## License

MIT — See [LICENSE](LICENSE)

---

**Built by [John Williams](https://github.com/itallstartedwithaidea) | It All Started With A Idea**
