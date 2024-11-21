import express from 'express';
import axios from 'axios';
import Database from 'better-sqlite3';
import fs from 'fs';
import cors from 'cors';

// Load configuration
const config = JSON.parse(fs.readFileSync('proxy.config.json', 'utf-8'));
const { username, password, serverUrl, maxAgeInDays } = config;


const app = express();
app.use(cors());
app.use(express.json());
const db = new Database('db/proxy.db');

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    username TEXT PRIMARY KEY,
    joinedDate TEXT,
    lastUpdated TEXT
  );

  CREATE TABLE IF NOT EXISTS displayNameHistory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    displayName TEXT,
    capturedAt TEXT,
    FOREIGN KEY(username) REFERENCES profiles(username)
  );
`);

console.log('Database initialized.');

// Helper: Check if a profile is outdated
function isProfileOutdated(lastUpdated) {
  const currentDate = new Date();
  const updatedDate = new Date(lastUpdated);
  const ageInDays = (currentDate - updatedDate) / (1000 * 60 * 60 * 24);
  return ageInDays > maxAgeInDays;
}

// Query profiles and displayNameHistory from the local database
function queryLocalProfiles(usernames) {
  const placeholders = usernames.map(() => '?').join(',');
  const stmt = db.prepare(`
    SELECT p.*, GROUP_CONCAT(json_object(
      'displayName', d.displayName,
      'capturedAt', d.capturedAt
    )) AS displayNameHistory
    FROM profiles p
    LEFT JOIN displayNameHistory d ON p.username = d.username
    WHERE p.username IN (${placeholders})
    GROUP BY p.username
  `);
  return stmt.all(...usernames);
}

// Delete outdated profiles from the local database
function deleteOutdatedProfiles(usernames) {
  const stmt = db.prepare(`
    DELETE FROM profiles
    WHERE username = ? AND lastUpdated <= datetime('now', ? || ' days')
  `);
  usernames.forEach((username) => stmt.run(username, `-${maxAgeInDays}`));
}

// Fetch missing or outdated profiles from the main server
async function fetchProfilesFromServer(usernames) {
  try {
    const response = await axios.get(
      `${serverUrl}/profile/${usernames}`,
      {
        auth: { username, password },
      }
    );
    return response.data; // Assume server returns a list of profiles
  } catch (error) {
    console.error('Error fetching profiles from server:', error.message);
    throw error;
  }
}

// Update the local database with profiles from the server
function updateLocalDatabase(profile) {
  const profileStmt = db.prepare(`
    INSERT OR REPLACE INTO profiles (username, joinedDate, lastUpdated)
    VALUES (?, ?, datetime('now'))
  `);
  const displayNameStmt = db.prepare(`
    INSERT INTO displayNameHistory (username, displayName, capturedAt)
    SELECT ?, ?, datetime('now')
    WHERE NOT EXISTS (
      SELECT 1 FROM displayNameHistory
      WHERE username = ? AND displayName = ?
    )
  `);

  
    if (profile.joinedDate) {
      profileStmt.run(profile.username, profile.joinedDate);
      if (profile.displayName) {
        displayNameStmt.run(profile.username, profile.displayName, profile.username, profile.displayName);
      }
    } else {
      console.warn(`Skipping profile with null joinedDate: ${profile.username}`);
    }

}

// Proxy endpoint to get profiles
app.get('/profile/:usernames', async (req, res) => {
  try {
    const { usernames } = req.params;

    if (!usernames) {
      return res.status(400).json({ error: 'Usernames are required' });
    }

    const usernameList = Array.isArray(usernames) ? usernames : [usernames];
    console.log('Received request for usernames:', usernameList);

    // Step 1: Query local database
    const localProfiles = queryLocalProfiles(usernameList);

    // Step 2: Identify missing or outdated profiles
    const missingOrOutdated = usernameList.filter((username) => {
      const profile = localProfiles.find((p) => p.username === username);
      return !profile || isProfileOutdated(profile.lastUpdated);
    });

    console.log('Missing or outdated profiles:', missingOrOutdated);

    // Step 3: Delete outdated profiles
    deleteOutdatedProfiles(missingOrOutdated);

    // Step 4: Fetch missing/outdated profiles from the server
    let fetchedProfiles ;
    if (missingOrOutdated.length > 0) {
      fetchedProfiles = await fetchProfilesFromServer(missingOrOutdated);
	  if (fetchedProfiles.joinedDate)
		  updateLocalDatabase(fetchedProfiles);
    }

    // Combine local profiles and fetched profiles
    const combinedProfiles = [
      ...localProfiles.filter((p) => !isProfileOutdated(p.lastUpdated)),
      [fetchedProfiles],
    ];
    
    combinedProfiles.forEach((profile) => {
      profile.displayNameHistory = profile.displayNameHistory
        ? JSON.parse(`[${profile.displayNameHistory}]`)
        : [];
	  profile.displayNameHistory = profile.displayNameHistory.some((one) => one.username !== null);
    });

    console.log('Returning profile:', combinedProfiles);

    res.json(combinedProfiles);
  } catch (error) {
    console.error('Error in proxy /profile endpoint:', error.message);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

// Start the proxy server
const PORT = config.port || 3000;
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
