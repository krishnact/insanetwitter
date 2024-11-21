let settings = {};
let observer = null;

async function getRandomURL() {
  const fileURL = "https://raw.githubusercontent.com/krishnact/insanetwitter/refs/heads/main/extension/seed.json";
  
  try {
    // Fetch the file
    const response = await fetch(fileURL);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    }

    // Parse the JSON content
    const data = await response.json();

    // Extract the list of URLs (assuming it's an array in the file)
    const urls = data.urls; // Replace 'urls' with the actual key in the JSON file that contains the URLs
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error("No URLs found in the JSON file.");
    }

    // Return a random URL
    const randomIndex = Math.floor(Math.random() * urls.length);
    return urls[randomIndex];
  } catch (error) {
    console.error("Error fetching or processing the file:", error.message);
    return null;
  }
}

// Load settings first
chrome.storage.sync.get().then(stored => {
  settings = stored || {
    serverUrl: 'https://instwitter.monimee.com',
    'color-6m': '#ff0000',
    'bg-6m': '#ffeeee',
    'color-2y': '#ff69b4',
    'bg-2y': '#fff0f5',
    'color-4y': '#ffa500',
    'bg-4y': '#fff5e6',
    'color-5y': '#008000',
    'bg-5y': '#f0fff0',
    'color-10y': '#0000ff',
    'bg-10y': '#f0f8ff',
    'color-10plus': '#4b0082',
    'bg-10plus': '#f5f0ff'
  };
  
  getRandomURL().then(serverUrl =>{
	  settings.serverUrl = serverUrl;
  })
  initializeExtension();
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'deleteProfileKeys') {
        deleteProfileKeysFromLocalStorage();
        sendResponse({ success: true, message: 'Keys deleted!' });
    }
});


function deleteProfileKeysFromLocalStorage() {
    // Iterate over the keys in localStorage
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);

        // Check if the key starts with 'profile_'
        if (key.startsWith('profile_')) {
            localStorage.removeItem(key);
            // Adjust the index because removing an item shifts the remaining keys
            i--;
        }
    }
}

function initializeExtension() {
  // Create observer for dynamic content
  observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          processNewContent(node);
        }
      });
    });
  });

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Initial processing
  processNewContent(document.body);
}

async function processNewContent(node) {
  // Check if we're on a profile page
  if (window.location.pathname.match(/\/[^/]+$/) && !window.location.pathname.includes('/status/')) {
    const username = window.location.pathname.slice(1);
	if (username != 'home' && username != 'explore' && username != 'messages' && username != 'notifications'){
		// Not used any more
		// await sendProfileToServer(username);
	}		
  }

  // Process tweets
  const tweets = node.querySelectorAll('[data-testid="tweet"]');
  tweets.forEach(processTweet);
}

async function sendProfileToServer(username) {
  if (!settings.serverUrl) return;
  
  try {
    const response = await fetch(`${settings.serverUrl}/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username })
    });
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
  } catch (error) {
    console.error('Error sending profile to server:', error);
  }
}

async function processTweet(tweetElement) {
  if (tweetElement.dataset.processed) return;
  tweetElement.dataset.processed = 'true';

  const usernameElement = tweetElement.querySelector('[data-testid="User-Name"]');
  if (!usernameElement) return;

  const usernameMatch = usernameElement.textContent.match(/@(\w+)/);
  if (!usernameMatch) return;

  const username = usernameMatch[1];
  if (!settings.serverUrl) return;
  if (username == 'home') return;
  
	try {
	  const cacheKey = `profile_${username}`;

	  // Check if there's a valid cached response
	  const cachedData = localStorage.getItem(cacheKey);
	  const now = Date.now();

	  let profile;

	  if (cachedData) {
		const parsedCache = JSON.parse(cachedData);

		// Check if the cache is still valid
		if (parsedCache.expiry && now < parsedCache.expiry) {
		  profile = parsedCache.data;
		}
	  }

	  if (!profile) {
		// Fetch profile from the server if not cached or expired
		const response = await fetch(`${settings.serverUrl}/profile/${username}`);
		if (!response.ok) {
		  throw new Error(`Server returned ${response.status}`);
		}

		const contentType = response.headers.get('content-type');
		if (!contentType || !contentType.includes('application/json')) {
		  throw new Error('Server did not return JSON');
		}

		profiles = await response.json();
		if (profiles.length > 0){
			profile = profiles[0]
		}

		// Cache the profile along with expiry (30 days in milliseconds)
		if (profile && profile.joinedDate){
			const cacheData = {
			  data: profile,
			  expiry: now + 30 * 24 * 60 * 60 * 1000, // 30 days from now
			};
			localStorage.setItem(cacheKey, JSON.stringify(cacheData));			
		}
	  }

	  if (profile && profile.joinedDate) {
		const ageStyle = getStyleForAccountAge(new Date(profile.joinedDate));

		// Apply styles
		usernameElement.style.color = ageStyle.color;
		usernameElement.style.backgroundColor = ageStyle.background;

		// Add avatar history icon if there's history
		if (profile.displayNameHistory && profile.displayNameHistory.length > 0) {
		  addAvatarHistoryButton(usernameElement, profile.displayNameHistory, profile.joinedDate);
		}
	  } else {
		if ( usernameElement.insaneTwitter == true) {
			
		}else{
			// Try again after 10
			setTimeout(function(){
				console.log(`Retrying ${username}`)
				processTweet(tweetElement)
			}, 10000)
			// Apply default styles
			usernameElement.style.color = 'grey';
			usernameElement.style.backgroundColor = 'lightgrey';
			usernameElement.insaneTwitter = true
		}
	  }
	} catch (error) {
	  console.error(`Error processing tweet for ${username}:`, error);
	}

}

function getStyleForAccountAge(joinedDate) {
  const now = new Date();
  const ageInMonths = (now - joinedDate) / (1000 * 60 * 60 * 24 * 30);
  
  if (ageInMonths <= 6) {
    return { color: settings['color-6m'], background: settings['bg-6m'] };
  } else if (ageInMonths <= 24) {
    return { color: settings['color-2y'], background: settings['bg-2y'] };
  } else if (ageInMonths <= 48) {
    return { color: settings['color-4y'], background: settings['bg-4y'] };
  } else if (ageInMonths <= 60) {
    return { color: settings['color-5y'], background: settings['bg-5y'] };
  } else if (ageInMonths <= 120) {
    return { color: settings['color-10y'], background: settings['bg-10y'] };
  } else {
    return { color: settings['color-10plus'], background: settings['bg-10plus'] };
  }
}

function addAvatarHistoryButton(usernameElement, displayNameHistory, joinedDate) {
  const button = document.createElement('button');
  button.className = 'avatar-history-btn';
  button.innerHTML = '📷';
  button.title = 'View avatar history';
  
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showAvatarHistory(displayNameHistory, joinedDate);
  });
  
  usernameElement.appendChild(button, joinedDate);
}

function showAvatarHistory(displayNameHistory, joinedDate) {
  const modal = document.createElement('div');
  modal.className = 'avatar-history-modal';
  
  const content = document.createElement('div');
  content.innerHTML=`<span>Joined: ${joinedDate}</span>`
  content.className = 'avatar-history-content';
  
  displayNameHistory.forEach(displayNameInfo => {
	  if (displayNameInfo.displayName){
		  const div = document.createElement('div');
		  div.innerHTML = `${displayNameInfo.displayName} (${displayNameInfo.capturedAt})`
		  content.appendChild(div);
	  }
  });
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  modal.addEventListener('click', () => {
    modal.remove();
  });
}