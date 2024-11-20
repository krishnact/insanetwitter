# Twitter Profile Analyzer

This project consists of two main components:
1. A Chrome extension for analyzing Twitter profiles
2. A backend server (TPRS) for storing profile data
3. A minion to fetch profile info
4. A proxy to serve public requetes.

The proxies contact TPRS for profile info and TPRS works with minions to fetch them. This ensures main TPRS can be hidden behind proxies and not get overloaded. There is a seed file that is published at well know location and the plugin picks a random proxy server from the seed file.

```mermaid
graph TD
    A[Chrome Extension] -->|Analyzes Profiles| B[Proxies]
    B -->|Fetch Profile Info| C[TPRS Backend]
    C -->|Coordinates with| D[Minions]
    B -.->|Uses Random Proxy from Seed File| E[Seed File]

    subgraph Backend
        C
        D
    end
```
## Project Structure

```
.
├── extension/          # Chrome extension files
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js
│   ├── content.js
│   └── styles.css
│
└── server/            # Backend server files
    ├── package.json
    └── server.js
    └── minion.js
```

## Installation

### Chrome Extension
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension` directory

### Backend Server
1. Navigate to the server directory:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```

## Configuration

Click the extension icon in Chrome to:
- Set the TPRS server URL
- Configure color schemes for different account age ranges
- Customize background colors

## Architecture

- Chrome Extension: Monitors Twitter pages and applies visual changes
- TPRS Server: Stores profile data and avatar history using SQLite
- Settings: Stored in Chrome's sync storage

## Database Schema

```sql
profiles:
  - username (TEXT PRIMARY KEY)
  - displayName (TEXT)
  - joinedDate (TEXT)
  - lastUpdated (TEXT)

avatars:
  - id (INTEGER PRIMARY KEY)
  - username (TEXT)
  - url (TEXT)
  - capturedAt (TEXT)
```