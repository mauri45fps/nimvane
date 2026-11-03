// electron-builder leaves the .pacman package out of dist/latest-linux.yml, so Arch installs
// would find no update to download. Run after `electron-builder --linux` to add it.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml'); // comes with electron-builder

const dist = path.resolve(__dirname, '..', 'dist');
const infoFile = path.join(dist, 'latest-linux.yml');
const info = yaml.load(fs.readFileSync(infoFile, 'utf8'));
const pkg = fs.readdirSync(dist).find((f) => f.endsWith(`-${info.version}.pacman`));
if (!pkg) {
  console.error(`No .pacman for version ${info.version} in dist/`);
  process.exit(1);
}

const data = fs.readFileSync(path.join(dist, pkg));
const entry = { url: pkg, sha512: crypto.createHash('sha512').update(data).digest('base64'), size: data.length };
info.files = info.files.filter((f) => !f.url.endsWith('.pacman')).concat(entry);
fs.writeFileSync(infoFile, yaml.dump(info, { lineWidth: -1 }));
console.log('Added', pkg, 'to latest-linux.yml');
