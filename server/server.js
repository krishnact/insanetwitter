import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer';
import { WebSocketServer } from 'ws';
import fs from 'fs';

// Load configuration
const config = JSON.parse(fs.readFileSync('server.config.json', 'utf-8'));
const validMinions = config.minions;
const validProxies = config.proxies;
const MAX_TASKS_PER_MINION = config.maxTasksPerMinion || 5;

const app = express();
const db = new Database('db/profiles.db');

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

app.use(cors());
app.use(express.json());

const taskQueue = [];
const minions = new Map();

// Helper function: Update or insert profile and display name history
function storeProfileAndHistory(profile) {
  console.log(`--->> profile: ${profile}`, profile)
  const { username, displayName, joinedDate } = profile;
  console.log(`--->> ${username} ${displayName} ${joinedDate} `)
  const profileStmt = db.prepare(`
    INSERT OR REPLACE INTO profiles (username, joinedDate, lastUpdated)
    VALUES (?, ?, datetime('now'))
  `);
  profileStmt.run(username, joinedDate);

  if (displayName) {
    const displayNameStmt = db.prepare(`
      INSERT INTO displayNameHistory (username, displayName, capturedAt)
      SELECT ?, ?, datetime('now')
      WHERE NOT EXISTS (
        SELECT 1 FROM displayNameHistory
        WHERE username = ? AND displayName = ?
      )
    `);
    displayNameStmt.run(username, displayName, username, displayName);
  }
}

// WebSocket server
const wss = new WebSocketServer({ noServer: true });

function assignTasksToMinions() {
  for (const [minionId, minion] of minions) {
    if (minion.tasks.length >= MAX_TASKS_PER_MINION) continue;

    const availableCapacity = MAX_TASKS_PER_MINION - minion.tasks.length;
    const tasksToAssign = taskQueue.splice(0, availableCapacity);

    if (tasksToAssign.length > 0) {
      tasksToAssign.forEach((task) => {
		  minion.tasks.push(task)
		  minion.ws.send(JSON.stringify(task));
	  }
	  );
      
      console.log(`Assigned ${tasksToAssign.length} tasks to minion ${minionId}`);
    }
  }
}

function enqueueTask(task) {
  // Check if the task is already in the queue
  const isAlreadyInQueue = taskQueue.some((queuedTask) => queuedTask.username === task.username);

  // Check if the task is already assigned to a minion
  const isAssignedToMinion = [...minions.values()].some((minion) =>
    minion.tasks.some((t) => t.username === task.username)
  );

  if (!isAlreadyInQueue && !isAssignedToMinion) {
    taskQueue.push(task);
    console.log(`Task enqueued: ${JSON.stringify(task)}`);
    assignTasksToMinions();
  } else {
    console.log(`Task for ${task.username} is already in queue or assigned.`);
  }
}

function handleMinionDisconnection(minionId) {
  console.log(`Minion ${minionId} disconnected. Reassigning its tasks.`);
  const minion = minions.get(minionId);

  if (minion) {
    taskQueue.push(...minion.tasks); // Requeue uncompleted tasks
    minions.delete(minionId);
  }

  assignTasksToMinions();
}

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

function isValidProxy(authHeader) {
  const base64Credentials = authHeader.split(' ')[1];
  const [username, password] = Buffer.from(base64Credentials, 'base64').toString('ascii').split(':');
  const isValid = validProxies.some((proxy) => proxy.username === username && proxy.password === password);
  if (isValid) {
    console.log(`Proxy authentication successful for: ${username}`);
  } else {
    console.warn(`Proxy authentication failed for: ${username}`);
  }
  return isValid;
}

function getUsernameFromAuth(authHeader) {
  const base64Credentials = authHeader.split(' ')[1];
  const [username] = Buffer.from(base64Credentials, 'base64').toString('ascii').split(':');
  return username;
}

wss.on('connection', (ws, request) => {
  const authHeader = request.headers['authorization'];
  if (!authHeader || !isValidMinion(authHeader)) {
    console.error('Unauthorized WebSocket connection attempt.');
    ws.close(1008, 'Unauthorized');
    return;
  }

  const username = getUsernameFromAuth(authHeader);
  const minionId = request.headers['sec-websocket-key']; // Use WebSocket key as a unique ID
  minions.set(minionId, { ws, tasks: [], username: username });

  console.log(`Minion connected ${username}, id: ${minionId}`);

  ws.on('message', (message) => {
    const result = JSON.parse(message);
    console.log(`Results received from minion ${minionId}:`, result);
    
	if (result.error) {
		console.error(`Error processing ${result.username}: ${result.error}`);
		enqueueTask({ id: '', username: result.username }); // Retry the failed task
	} else {
		storeProfileAndHistory(result.result);
	}

    // Remove completed tasks from the minion's task list
    const minion = minions.get(minionId);
    if (minion) {
      minion.tasks = minion.tasks.filter((task) =>
        task.username === result.username
      );
    }
    console.log(`Minion ${minion.username} has ${minion.tasks.length} tasks`);
    assignTasksToMinions();
  });

  ws.on('close', () => handleMinionDisconnection(minionId));

  ws.on('error', (error) => {
    console.error(`Error with minion ${minionId}: ${error.message}`);
    handleMinionDisconnection(minionId);
  });

  assignTasksToMinions();
});

app.post('/profile', async (req, res) => {
	
  const authHeader = req.headers['authorization'];
  if (!authHeader || !isValidProxy(authHeader)) {
    console.error('Unauthorized WebSocket connection attempt.');
    ws.close(1008, 'Unauthorized');
    return;
  }
  
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  console.log(`Profile request received for: ${username}`);
  enqueueTask({ username });
  res.json({ success: true });
});

app.get('/profile/:username', async (req, res) => {
  const { username } = req.params;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  console.log(`Fetching profile for: ${username}`);

  const profileStmt = db.prepare(`
    SELECT p.*, GROUP_CONCAT(json_object(
      'displayName', d.displayName,
      'capturedAt', d.capturedAt
    )) AS displayNameHistory
    FROM profiles p
    LEFT JOIN displayNameHistory d ON p.username = d.username
    WHERE p.username = ?
    GROUP BY p.username
  `);

  const profile = profileStmt.get(username);

  if (!profile) {
    enqueueTask({ username });
    return res.json({ error: 'Profile not found. Task enqueued for processing.', joinedDate: null, username: username  });
  }

  profile.displayNameHistory = profile.displayNameHistory
    ? JSON.parse(`[${profile.displayNameHistory}]`)
    : [];

  res.json(profile);
});

// Initialize server
const server = app.listen(config.port || 4000, () => {
  console.log(`Server running on port ${config.port || 4000}`);
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});
