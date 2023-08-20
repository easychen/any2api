document.addEventListener('DOMContentLoaded', function() {
    const urlInput = document.getElementById('urlInput');
    const portInput = document.getElementById('portInput');
    const passwordInput = document.getElementById('passwordInput');
    const domainInput = document.getElementById('domainInput');
    const enableCheckbox = document.getElementById('enableCheckbox');
    const saveButton = document.getElementById('saveButton');

    disconnectButton.addEventListener('click', function() {
        chrome.storage.sync.set({
            enabled: false
        }, function() {
            console.log('Settings saved');
            document.getElementById('enableCheckbox').checked = false;
        });
    });
  
    saveButton.addEventListener('click', function() {
      const url = urlInput.value;
      const port = portInput.value;
      const password = passwordInput.value;
      const domain = domainInput.value;
      const enabled = enableCheckbox.checked;
  
      chrome.storage.sync.set({
        url: url,
        port: port,
        password: password,
        domain:domain,
        enabled: enabled
      }, function() {
        console.log('Settings saved');
      });
    });
  
    chrome.storage.sync.get(['url', 'port', 'password', 'enabled', 'domain'], function(result) {
      urlInput.value = result.url || '';
      portInput.value = result.port || '';
      passwordInput.value = result.password || '';
      domainInput.value = result.domain || '';
      enableCheckbox.checked = result.enabled || false;
    });
  });