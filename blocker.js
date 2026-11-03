const fs = require('fs');

// Domain-based ad/tracker blocker. O(depth of hostname) per request.
// Accepts plain domain lists and hosts-file format ("0.0.0.0 example.com").
class Blocker {
  constructor() {
    this.domains = new Set();
  }

  loadText(text) {
    for (let line of text.split(/\r?\n/)) {
      line = line.replace(/#.*/, '').trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      const host = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase();
      if (host && host !== 'localhost' && host.includes('.')) this.domains.add(host);
    }
  }

  loadFile(file) {
    try {
      this.loadText(fs.readFileSync(file, 'utf8'));
    } catch {
      /* optional file */
    }
  }

  isBlockedHost(host) {
    host = (host || '').toLowerCase();
    while (host.includes('.')) {
      if (this.domains.has(host)) return true;
      host = host.slice(host.indexOf('.') + 1);
    }
    return false;
  }

  isBlockedUrl(u) {
    try {
      return this.isBlockedHost(new URL(u).hostname);
    } catch {
      return false;
    }
  }
}

module.exports = { Blocker };
