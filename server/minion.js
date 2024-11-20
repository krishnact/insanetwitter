import WebSocket from 'ws';
import fs from 'fs';
import { scrapeProfile } from './scrapeProfile.js';

const config = JSON.parse(fs.readFileSync('minion.config.json', 'utf-8'));
const { username, password, serverUrl } = config;

let reconnectInterval = 5000; // Reconnect after 5 seconds on error/disconnection
let ws;

function connectToServer() {
  console.log(`Connecting to server at ${serverUrl}...`);

  ws = new WebSocket(`${serverUrl}/ws`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    },
  });

  ws.on('open', () => {
    console.log(`Connected to server as ${username}`);
  });

  ws.on('message', async (message) => {
    const task = JSON.parse(message);
    console.log(`Received task: ${JSON.stringify(task)}`);
    if (task.username){
		try {
		  const result = await scrapeProfile(task.username);
		  console.log(`Scraping result for ${task.username}: ${JSON.stringify(result)}`);
		  ws.send(JSON.stringify({ taskId: task.id, result }));
		} catch (error) {
		  console.error(`Error scraping profile for ${task.username}: ${error.message}`);
		  ws.send(JSON.stringify({ taskId: task.id, error: error.message }));
		}
	}else{
		console.log(`Username is ${task.username}`);
	}
  });

  ws.on('close', (code, reason) => {
    console.error(`Connection closed (code: ${code}, reason: ${reason}). Attempting to reconnect...`);
    retryConnection();
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error: ${error.message}. Attempting to reconnect...`);
    retryConnection();
  });
}

function retryConnection() {
  if (ws && ws.readyState !== WebSocket.CLOSED) {
    return; // Prevent multiple reconnection attempts
  }

  console.log(`Reconnecting in ${reconnectInterval / 1000} seconds...`);
  setTimeout(() => {
    connectToServer();
  }, reconnectInterval);
}

// Initial connection attempt
connectToServer();
