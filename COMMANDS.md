# 💻 Command Reference

## 🚀 Start a Discovery Run

```bash
# Full state run (all 30 categories × all cities)
node engine.js start --state AZ
node engine.js start --state OH
node engine.js start --state WA
node engine.js start --state ID

# Cap the number of businesses
node engine.js start --state AZ --max 50
node engine.js start --state AZ --max 500

# Specific categories only
node engine.js start --state AZ --categories "plumber,electrician,dentist"

# Specific cities only
node engine.js start --state AZ --cities "Phoenix,Scottsdale,Tempe"

# Fresh run (ignore saved checkpoint)
node engine.js start --state AZ --fresh

# CSV only (skip Google Sheets)
node engine.js start --state AZ --no-sheets

# Combine flags
node engine.js start --state OH --max 100 --categories "plumber,dentist" --cities "Columbus,Cleveland" --fresh
```

## ⏸️ Job Control

The engine saves progress after every 10 businesses. You can safely pause/stop at any time.

```bash
# Pause (finishes current business, then waits)
node engine.js pause

# Resume from where you left off
node engine.js resume

# Stop (saves state and exits)
node engine.js stop

# Check what's happening
node engine.js status

# Clear all saved state (start fresh next time)
node engine.js reset
```

### How Pause/Resume Works

1. You start a run: `node engine.js start --state AZ`
2. In another terminal: `node engine.js pause`
3. Engine finishes current business, then waits
4. Later: `node engine.js resume` — picks up exactly where it stopped
5. Or: `node engine.js stop` — saves and exits cleanly

## 📊 npm Script Shortcuts

```bash
npm start          # node engine.js start --state AZ
npm test           # Quick test: AZ, 10 businesses, plumber only
npm run pause      # node engine.js pause
npm run resume     # node engine.js resume
npm run stop       # node engine.js stop
npm run status     # node engine.js status
npm run reset      # node engine.js reset
npm run help       # node engine.js help
```

State-specific shortcuts:
```bash
npm run start:az   # Arizona
npm run start:id   # Idaho
npm run start:oh   # Ohio
npm run start:wa   # Washington
```

## 📋 Info Commands

```bash
# Show all available states and their cities
node engine.js states

# Show full help with pipeline details
node engine.js help
```

## 🔧 Background / Production Runs

```bash
# Run in background with logging
nohup node engine.js start --state AZ > discovery-$(date +%Y%m%d_%H%M%S).log 2>&1 &

# Monitor the log
tail -f discovery-*.log

# Check if still running
node engine.js status

# Kill if needed
pkill -f "node engine.js"
```

## 🧪 Testing

```bash
# Minimal test (10 businesses, 1 category)
node engine.js start --state AZ --max 10 --categories "plumber"

# Test without Sheets
node engine.js start --state AZ --max 5 --no-sheets

# Test a specific city
node engine.js start --state AZ --max 20 --cities "Scottsdale" --categories "dentist,law firm"
```

## 📂 Output Files

| File | Description |
|---|---|
| `discovery-AZ-2026-02-16.csv` | CSV backup (auto-generated per run) |
| Google Sheets tab "Arizona" | Live-pushed rows with confidence scores |
| `.discovery-state.json` | Checkpoint for pause/resume |

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_SPREADSHEET_ID` | (none) | Your Google Sheet ID |
| `GOOGLE_CREDENTIALS_PATH` | `google-credentials.json` | Path to service account key |
| `DELAY_MS` | `2500` | Delay between HTTP requests (ms) |
| `MAX_PAGES_PER_SITE` | `15` | Max subpages to crawl per website |
| `MAX_BUSINESSES` | `1000` | Default cap per run |

### Adjust Speed

```bash
# Faster (may get blocked more)
DELAY_MS=1500 node engine.js start --state AZ

# Slower (more respectful)
DELAY_MS=5000 node engine.js start --state AZ
```

## 🔍 Pipeline Phases

When you run the engine, it executes these phases in order:

| Phase | What Happens |
|---|---|
| **1. Discovery** | Scrapes Yellow Pages (3 pages per city/category), Yelp, BBB |
| **2. Dedup** | Fuzzy name matching + phone/domain exact match across sources |
| **3. Website Finder** | Google searches for businesses that don't have a website yet |
| **4. Enrich** | Crawls each website (9 methods) + WHOIS + infer emails + MX verify |

Each phase saves a checkpoint. If interrupted, `resume` picks up mid-phase.

## 🗂️ Adding New States

Edit the `STATES` object in `engine.js`:

```javascript
TX: {
  name: 'Texas',
  abbr: 'TX',
  tab: 'Texas',
  yp: 'tx',
  cities: ['Houston','Dallas','Austin','San Antonio','Fort Worth','El Paso','Arlington','Plano','Lubbock','Amarillo']
}
```

Then run: `node engine.js start --state TX`
