import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import { scrapeProfile } from './scrapeProfile.js';

const app = express();
const db = new Database('profiles.db');
//const WebSocket = require('ws');
// Load configuration
const config = JSON.parse(fs.readFileSync('server.config.json', 'utf-8'));
const validMinions = config.minions;

console.log('Loaded configuration:', JSON.stringify(config, null, 2));

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

console.log('Database initialized with tables.');

app.use(cors());
app.use(express.json());

const minions = new Map();
const taskQueue = [];

// WebSocket server for minions
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, request) => {
  const authHeader = request.headers['authorization'];
  if (!authHeader || !isValidMinion(authHeader)) {
    console.error('Unauthorized WebSocket connection attempt.');
    ws.close(1008, 'Unauthorized');
    return;
  }

  const username = getUsernameFromAuth(authHeader);
  minions.set(username, ws);
  console.log(`Minion connected: ${username}`);
  
  ws.on('message', (message) => {
    console.log(`Message received from minion ${username}: ${message}`);
    const { taskId, result, error } = JSON.parse(message);

    if (error) {
      console.error(`Error reported by minion ${username}: ${error}`);
    } else {
      console.log(`Result received from minion ${username}: ${JSON.stringify(result)}`);
      if (result) {
        storeProfile(result);
      }
    }
    distributeTasks();
  });

  ws.on('close', () => {
    minions.delete(username);
    console.log(`Minion disconnected: ${username}`);
  });
  
  distributeTasks();
});

// Middleware to handle HTTP to WebSocket upgrade
app.use((req, res, next) => {
  if (req.url === '/ws') {
    console.log('WebSocket upgrade request received.');
    wss.handleUpgrade(req, req.socket, req.headers, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    next();
  }
});

// Utility: Validate minion using basic auth
function isValidMinion(authHeader) {
  const base64Credentials = authHeader.split(' ')[1];
  const [username, password] = Buffer.from(base64Credentials, 'base64').toString('ascii').split(':');
  const isValid = validMinions.some((minion) => minion.username === username && minion.password === password);
  if (isValid) {
    console.log(`Minion authentication successful for: ${username}`);
  } else {
    console.warn(`Minion authentication failed for: ${username}`);
  }
  return isValid;
}

function getUsernameFromAuth(authHeader) {
  const base64Credentials = authHeader.split(' ')[1];
  const [username] = Buffer.from(base64Credentials, 'base64').toString('ascii').split(':');
  return username;
}

// Browser initialization
let browser;
async function initBrowser() {
  console.log('Initializing Puppeteer browser...');
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  console.log('Puppeteer browser initialized.');
}

// Task assignment function
function distributeTasks() {
  console.log(`Distributing tasks. Queue size: ${taskQueue.length}, Minions available: ${minions.size}`);
  while (taskQueue.length > 0 && minions.size > 0) {
    const task = taskQueue.shift();
	if (task.username){
		const minion = [...minions.values()][0]; // Use the first available minion

		if (minion) {
		  console.log(`Assigning task to minion: ${JSON.stringify(task)}`);
		  minion.send(JSON.stringify(task));
		} else {
		  console.warn('No minions available. Requeuing task.');
		  taskQueue.push(task); // Requeue if no minions are available
		  break;
		}		
	}
  }
}

// Add tasks to the queue
function enqueueTask(task) {
  console.log(`Enqueuing task: ${JSON.stringify(task)}`);
  taskQueue.push(task);

  distributeTasks();
}

// Store profile in the database
function storeProfile(profile) {
  const { username, displayName, joinedDate, avatarUrl } = profile;

  console.log(`Storing profile in database: ${JSON.stringify(profile)}`);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO profiles (username, displayName, joinedDate, lastUpdated)
    VALUES (?, ?, ?, datetime('now'))
  `);

  stmt.run(username, displayName, joinedDate);

  if (avatarUrl) {
    const avatarStmt = db.prepare(`
      INSERT INTO avatars (username, url, capturedAt)
      SELECT ?, ?, datetime('now')
      WHERE NOT EXISTS (
        SELECT 1 FROM avatars 
        WHERE username = ? AND url = ?
      )
    `);

    avatarStmt.run(username, avatarUrl, username, avatarUrl);
  }

  console.log(`Profile stored successfully for ${username}`);
}

// Endpoint to store profile
app.post('/profile', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    console.warn('Missing username in request.');
    return res.status(400).json({ error: 'Username is required' });
  }

  console.log(`Profile request received for: ${username}`);
  enqueueTask({ username });
  res.json({ success: true });
});

// Initialize browser and start server
const PORT = process.env.PORT || 3000;
initBrowser().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});


// Endpoint to get profile
app.get('/profile/:username', (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    console.log(`Profile fetch request for ${username}`)
    const profile = db.prepare(`
      SELECT p.*, GROUP_CONCAT(json_object(
        'url', a.url,
        'date', a.capturedAt
      )) as avatarHistory
      FROM profiles p
      LEFT JOIN avatars a ON p.username = a.username
      WHERE p.username = ?
      GROUP BY p.username
    `).get(username);

    if (!profile) {
		enqueueTask({ username });
        return res.json({ joinedDate: null });
    }

    // Parse avatar history from string to array
    profile.avatarHistory = profile.avatarHistory ? JSON.parse(`[${profile.avatarHistory}]`) : [];
    console.log(`Returning profile of ${username}/${profile.joinedDate}`)
    res.json(profile);
  } catch (error) {
    console.error('Error retrieving profile:', error);
    res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});
