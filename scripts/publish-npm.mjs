// Publish with the token the user keeps in ~/.dsh/.credentials.yaml.
// Never prints the token, never writes it anywhere except a temporary npmrc
// that stays (the user asked for credentials to be kept, not cleaned up).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

function token() {
  if (process.env.NPM_TOKEN) return process.env.NPM_TOKEN;
  const file = path.join(os.homedir(), '.dsh', '.credentials.yaml');
  if (!existsSync(file)) return null;
  const m = readFileSync(file, 'utf8').match(/^NPM_TOKEN:\s*["']?([^"'\r\n]+)["']?\s*$/m);
  return m ? m[1].trim() : null;
}

const t = token();
if (!t) {
  console.error('没有 NPM_TOKEN。放到 ~/.dsh/.credentials.yaml 的 NPM_TOKEN: 一行，或者先 npm login。');
  process.exit(1);
}
const rc = path.join(os.homedir(), '.npmrc');
const line = `//registry.npmjs.org/:_authToken=${t}`;
const current = existsSync(rc) ? readFileSync(rc, 'utf8') : '';
const re = /^\/\/registry\.npmjs\.org\/:_authToken=.*$/m;
const next = re.test(current)
  ? current.replace(re, line)
  : current.replace(/\s*$/, '') + '\n' + line + '\n';
if (next !== current) {
  writeFileSync(rc, next, 'utf8');
  console.log('已写入 ~/.npmrc（保留，不再删除）');
}
const out = execFileSync('npm', ['publish', '--access', 'public', '--json'], { encoding: 'utf8', shell: true });
const j = JSON.parse(out);
console.log('published', j.id || j.name, j.version);
