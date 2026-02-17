# Google Ads Bulk Uploader

A Google Apps Script for automating bulk creation of Google Ads campaigns, ad groups, keywords, and Responsive Search Ads (RSAs) from Google Sheets.

![Google Ads](https://img.shields.io/badge/Google%20Ads-Scripts-4285F4?style=flat&logo=google-ads&logoColor=white)
![Google Sheets](https://img.shields.io/badge/Google%20Sheets-Powered-34A853?style=flat&logo=google-sheets&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

## Features

- **Bulk Campaign Creation** - Create multiple campaigns via CSV bulk upload
- **Ad Group Management** - Build ad groups with custom bids and status
- **Keyword Uploads** - Support for exact, phrase, and broad match types
- **RSA Builder** - Create Responsive Search Ads with up to 15 headlines and 4 descriptions
- **MCC Support** - Operate across multiple accounts from a Manager account
- **Duplicate Prevention** - Automatic tracking to prevent re-uploading
- **Email Notifications** - Get notified when uploads complete or fail

## Quick Start

### 1. Copy the Google Sheet Template

Create a Google Sheet with these tabs:
- `config and counts` - Configuration settings
- `cmpns` - Campaign data
- `adgrs to upload` - Ad group data
- `kws to upload` - Keyword data
- `rsas to upload` - RSA data

### 2. Install the Script

1. Open Google Ads → Tools & Settings → Bulk Actions → Scripts
2. Create a new script
3. Paste the contents of [`src/bulk-uploader.js`](src/bulk-uploader.js)
4. Update the `SPREADSHEET_URL` variable with your Sheet URL
5. Save and authorize

### 3. Configure & Run

1. Set your configuration in the `config and counts` tab
2. Add your data to the appropriate tabs
3. Run the script manually or schedule it

## Documentation

| Document | Description |
|----------|-------------|
| [Setup & Usage Guide](docs/INSTRUCTIONS.md) | Step-by-step setup and usage instructions |
| [Technical Documentation](docs/TECHNICAL.md) | Architecture, functions, and data specifications |
| [Sheet Templates](examples/) | Example data structures for each tab |

## Repository Structure

```
google-ads-bulk-uploader/
├── README.md                 # This file
├── LICENSE                   # MIT License
├── src/
│   └── bulk-uploader.js      # Main Google Ads Script
├── docs/
│   ├── INSTRUCTIONS.md       # Setup and usage guide
│   └── TECHNICAL.md          # Technical documentation
└── examples/
    ├── config-template.csv   # Config tab structure
    ├── campaigns-template.csv    # Campaign data structure
    ├── adgroups-template.csv     # Ad group data structure
    ├── keywords-template.csv     # Keyword data structure
    └── rsas-template.csv         # RSA data structure
```

## Configuration Options

| Setting | Values | Description |
|---------|--------|-------------|
| Customer ID Mode | ON/OFF | Enable MCC account selection |
| Campaign Module | ON/OFF | Process campaign uploads |
| Ad Group Module | ON/OFF | Process ad group uploads |
| Keyword Module | ON/OFF | Process keyword uploads |
| RSA Module | ON/OFF | Process RSA uploads |
| Notification Email Mode | ON/OFF | Send email notifications |

## Processing Order

The script processes entities in dependency order:

```
Campaigns → (2 min wait) → Ad Groups → Keywords → RSAs
```

Each module can be toggled independently in the configuration.

## Match Type Formatting

| Input | Match Type | Output |
|-------|------------|--------|
| keyword | exact | [keyword] |
| keyword | phrase | "keyword" |
| keyword | broad | +keyword |

## Requirements

- Google Ads account with Scripts access
- Google Sheets with edit permissions
- MCC access (for multi-account operations)

## Limitations

- Single account per execution (first ID if multiple provided)
- No negative keyword support currently
- RSA pinning not implemented
- Campaign creation via bulk CSV (limited customization)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-feature`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/new-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built for scalable Google Ads account management
- Designed for paid media specialists and agencies

---

**Note:** This script is provided as-is. Always test in a non-production account first.
