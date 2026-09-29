import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, 'app', 'server');

const child = spawn(process.execPath, ['test_whatsapp_flow.js'], {
  cwd: serverDir,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
