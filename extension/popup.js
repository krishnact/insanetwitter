document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.sync.get();
  
  // Load saved settings
  document.getElementById('serverUrl').value = settings.serverUrl || 'http://localhost:3000';
  
  const ageRanges = ['6m', '2y', '4y', '5y', '10y', '10plus'];
  ageRanges.forEach(range => {
    document.getElementById(`color-${range}`).value = settings[`color-${range}`] || getDefaultColor(range);
    document.getElementById(`bg-${range}`).value = settings[`bg-${range}`] || getDefaultBg(range);
  });

  // Save settings
  document.getElementById('save').addEventListener('click', async () => {
    const newSettings = {
      serverUrl: document.getElementById('serverUrl').value,
    };

    ageRanges.forEach(range => {
      newSettings[`color-${range}`] = document.getElementById(`color-${range}`).value;
      newSettings[`bg-${range}`] = document.getElementById(`bg-${range}`).value;
    });

    await chrome.storage.sync.set(newSettings);
    alert('Settings saved!');
  });
});

function getDefaultColor(range) {
  const colors = {
    '6m': '#ff0000',
    '2y': '#ff69b4',
    '4y': '#ffa500',
    '5y': '#008000',
    '10y': '#0000ff',
    '10plus': '#4b0082'
  };
  return colors[range];
}

function getDefaultBg(range) {
  const colors = {
    '6m': '#ffeeee',
    '2y': '#fff0f5',
    '4y': '#fff5e6',
    '5y': '#f0fff0',
    '10y': '#f0f8ff',
    '10plus': '#f5f0ff'
  };
  return colors[range];
}