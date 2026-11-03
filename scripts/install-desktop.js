// Linux: add Nimvane to the app launcher and give its window the right taskbar icon
// when running from source. Wayland compositors only show an app's icon if a .desktop
// file matches its app id (package.json "desktopName").
// Usage: npm run desktop            install or refresh
//        npm run desktop -- --remove uninstall
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const appsDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications');
const file = path.join(appsDir, pkg.desktopName);

if (process.platform !== 'linux') {
  console.error('Desktop entries are only for Linux.');
  process.exit(1);
}

if (process.argv.includes('--remove')) {
  fs.rmSync(file, { force: true });
  console.log('Removed', file);
} else {
  const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
  if (!fs.existsSync(electron)) {
    console.error('Electron is not installed yet. Run npm install first.');
    process.exit(1);
  }
  // Desktop entry Exec values quote with double quotes and escape \ " ` $
  const q = (s) => '"' + s.replace(/[\\"`$]/g, '\\$&') + '"';
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${pkg.productName}`,
    'GenericName=Web Browser',
    `Comment=${pkg.description}`,
    `Exec=${q(electron)} ${q(root)} %U`,
    `Icon=${path.join(root, 'build', 'icon.png')}`,
    `StartupWMClass=${pkg.desktopName.replace(/\.desktop$/, '')}`,
    'Terminal=false',
    'Categories=Network;WebBrowser;',
    'MimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;',
    'StartupNotify=true',
    '',
  ].join('\n');
  fs.mkdirSync(appsDir, { recursive: true });
  fs.writeFileSync(file, entry);
  console.log('Installed', file);
}

try {
  execFileSync('update-desktop-database', [appsDir], { stdio: 'ignore' });
} catch {
  /* optional tool; launchers pick the file up on their own */
}
