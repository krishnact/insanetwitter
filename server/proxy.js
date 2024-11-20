import express from 'express';
import axios from 'axios';
import Database from 'better-sqlite3';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('proxy.config.json', 'utf-8'));
const { username, password, serverUrl, maxAgeInDays } = config;

const app = express();
const db = new Database('proxy.db');

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    username TEXT PRIMARY KEY,
    displayName TEXT,
    joinedDate TEXT,
    lastUpdated TEXT
  );

  CREATE TABLE IF NOT EXISTS avatars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    url TEXT,
    capturedAt TEXT,
    FOREIGN KEY(username) REFERENCES profiles(username)
  );
`);

console.log('Database initialized.');

// Helper function to compute max age in days
function isProfileOutdated(lastUpdated) {
  const currentDate = new Date();
  const updatedDate = new Date(lastUpdated);
  const ageInDays = (currentDate - updatedDate) / (1000 * 60 * 60 * 24);
  return ageInDays > maxAgeInDays;
}

// Query profiles from the local database
function queryLocalProfiles(usernames) {
  const placeholders = usernames.map(() => '?').join(',');
  const stmt = db.prepare(`
    SELECT * FROM profiles
    WHERE username IN (${placeholders})
  `);
  return stmt.all(...usernames);
}

// Delete outdated profiles from the local database
function deleteOutdatedProfiles(usernames) {
  const stmt = db.prepare(`
    DELETE FROM profiles
    WHERE username = ? AND lastUpdated <= datetime('now', ? || ' days')
  `);
  for (const username of usernames) {
    stmt.run(username, `-${maxAgeInDays}`);
  }
}

// Fetch missing or outdated profiles from the main server
async function fetchProfilesFromServer(usernames) {
  try {
    const response = await axios.post(
      `${serverUrl}/profile`,
      { usernames },
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

// Update local database with profiles from the server
function updateLocalDatabase(profiles) {
  const insertProfileStmt = db.prepare(`
    INSERT OR REPLACE INTO profiles (username, displayName, joinedDate, lastUpdated)
    VALUES (?, ?, ?, datetime('now'))
  `);
  const insertAvatarStmt = db.prepare(`
    INSERT INTO avatars (username, url, capturedAt)
    SELECT ?, ?, datetime('now')
    WHERE NOT EXISTS (
      SELECT 1 FROM avatars WHERE username = ? AND url = ?
    )
  `);

  for (const profile of profiles) {
    if (profile.joinedDate) {
      insertProfileStmt.run(profile.username, profile.displayName, profile.joinedDate);
      if (profile.avatarUrl) {
        insertAvatarStmt.run(profile.username, profile.avatarUrl, profile.username, profile.avatarUrl);
      }
    } else {
      console.warn(`Skipping profile with null joinedDate: ${profile.username}`);
    }
  }
}

// Proxy endpoint to get profiles
app.get('/profiles', async (req, res) => {
  try {
    const { usernames } = req.query;

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

    // Step 4: Fetch missing/outdated profiles from server
    let fetchedProfiles = [];
    if (missingOrOutdated.length > 0) {
      fetchedProfiles = await fetchProfilesFromServer(missingOrOutdated);
      updateLocalDatabase(fetchedProfiles);
    }

    // Combine local profiles and fetched profiles
    const combinedProfiles = [
      ...localProfiles.filter((p) => !isProfileOutdated(p.lastUpdated)),
      ...fetchedProfiles,
    ];

    console.log('Returning profiles:', combinedProfiles);

    res.json(combinedProfiles);
  } catch (error) {
    console.error('Error in proxy /profiles endpoint:', error.message);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

const PORT = config.port || 4000;
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
