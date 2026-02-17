# 🔧 Setup Guide

Complete setup from zero to running discovery in under 10 minutes.

---

## Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **Google Cloud account** — Free tier works
- **A Google Sheet** — Where results land

---

## Step 1: Clone & Install

```bash
git clone https://github.com/itallstartedwithaidea/business-discovery-engine.git
cd business-discovery-engine
npm install
```

This installs 4 dependencies: axios, cheerio, googleapis, dotenv. No heavy packages.

---

## Step 2: Google Cloud Service Account

### Create the Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Go to **APIs & Services → Library**
4. Search **"Google Sheets API"** → click **Enable**
5. Go to **APIs & Services → Credentials**
6. Click **Create Credentials → Service Account**
7. Name it `business-discovery` → click Create
8. Skip optional permissions → click Done
9. Click on the service account you just created
10. Go to **Keys** tab → **Add Key → Create new key → JSON**
11. Save the downloaded file as `google-credentials.json` in the project root

### Share Your Sheet

1. Open your `google-credentials.json`
2. Copy the `client_email` value (looks like `business-discovery@your-project.iam.gserviceaccount.com`)
3. Open your Google Sheet
4. Click **Share** → paste that email → set to **Editor** → **Send**

---

## Step 3: Configure

```bash
cp .env.example .env
```

Edit `.env`:

```bash
GOOGLE_SPREADSHEET_ID=1abc123xyz...    # From your Sheet URL
GOOGLE_CREDENTIALS_PATH=google-credentials.json
DELAY_MS=2500
MAX_PAGES_PER_SITE=15
MAX_BUSINESSES=1000
```

**Finding your Spreadsheet ID:**

Your Sheet URL looks like:
```
https://docs.google.com/spreadsheets/d/1abc123xyzABCDEFG/edit
                                       ^^^^^^^^^^^^^^^^
                                       This is your ID
```

---

## Step 4: Test Run

```bash
# Quick test: 10 businesses, plumber category only, Arizona
node engine.js start --state AZ --max 10 --categories "plumber"
```

You should see:
- Business names appearing from Yellow Pages
- Websites being found
- Contacts being extracted
- Rows appearing in your Google Sheet

---

## Step 5: Full Run

```bash
# Full Arizona run (all 30 categories × 15 cities)
node engine.js start --state AZ

# Or any other state
node engine.js start --state OH
node engine.js start --state WA
node engine.js start --state ID
```

---

## Running Without Google Sheets

If you just want CSV output:

```bash
node engine.js start --state AZ --no-sheets
```

Results save to `discovery-AZ-2026-02-16.csv` automatically.

---

## Troubleshooting

### "Sheets auth failed"
- Make sure `google-credentials.json` exists in the project root
- Make sure it's a valid Service Account key (not an API key)
- Make sure Google Sheets API is enabled in your Cloud project

### "No GOOGLE_SPREADSHEET_ID set"
- Check your `.env` file has the correct Sheet ID
- Make sure `.env` is in the project root (same folder as engine.js)

### "Sheet push failed: 403"
- Share your Google Sheet with the service account email as Editor
- The email is in `google-credentials.json` under `client_email`

### Engine finds 0 businesses
- Run the test first: `node engine.js start --state AZ --max 10 --categories "plumber"`
- Check your internet connection
- Some VPNs block scraping — try without VPN

### Engine hangs on WHOIS
- RDAP servers can be slow — it will timeout after 15 seconds and continue
- This is normal behavior

---

## File Structure

```
business-discovery-engine/
├── engine.js              # The entire engine (single file)
├── package.json           # Dependencies and npm scripts
├── .env                   # Your config (not committed)
├── .env.example           # Config template
├── google-credentials.json # Your service account key (not committed)
├── .gitignore             # Excludes secrets and data files
├── README.md              # Project overview
├── SETUP.md               # This file
├── COMMANDS.md            # Full command reference
└── LICENSE                # MIT
```
