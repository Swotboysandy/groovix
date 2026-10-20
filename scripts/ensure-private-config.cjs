// Creates src/config/private.ts from the example on first install, so a fresh
// clone builds. The real file is git-ignored and never overwritten.
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '..', 'src', 'config');
const target = path.join(dir, 'private.ts');
if (!fs.existsSync(target)) fs.copyFileSync(path.join(dir, 'private.example.ts'), target);
