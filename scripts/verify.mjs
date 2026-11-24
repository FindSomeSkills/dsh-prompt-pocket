// Full local verification: every suite plus the tarball contents.
// Usage: node scripts/verify.mjs
import { execFileSync } from 'node:child_process';

const ok = [];
const bad = [];
const pass = (n) => ok.push(n);
const fail = (n, d) => bad.push(n + (d ? ' — ' + d : ''));

console.log('[1/2] 跑三套测试…');
for (const [label, script] of [
  ['宿主 14 项', 'scripts/smoke.mjs'],
  ['客户端 6 项', 'scripts/client-smoke.mjs'],
  ['文档 6 项', 'scripts/docs-check.mjs'],
]) {
  try {
    const out = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    if (!/通过 \d+ 项/.test(out)) throw new Error('没有通过计数');
    pass(label);
  } catch (e) {
    fail(label, String(e.message).split('\n')[0].slice(0, 100));
  }
}

console.log('[2/2] 检查打包内容…');
try {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8', shell: true });
  const files = JSON.parse(out)[0].files.map((f) => f.path);
  const need = [
    'index.js',
    'client.js',
    'cordis.patch.yml',
    'locale/en.json',
    'locale/zh.json',
    'docs/DETAIL.md',
    'docs/DETAIL.zh.md',
    'scripts/verify.mjs',
  ];
  const missing = need.filter((f) => !files.includes(f));
  if (missing.length) throw new Error('缺 ' + missing.join(', '));
  pass('打包含入口、语言包、两份说明与脚本（' + files.length + ' 个文件）');
} catch (e) {
  fail('打包内容', String(e.message).split('\n')[0].slice(0, 120));
}

console.log('');
console.log('通过 ' + ok.length + ' 项：');
ok.forEach((n, i) => console.log('  ' + (i + 1) + '. ' + n));
if (bad.length) {
  console.log('');
  console.log('失败 ' + bad.length + ' 项：');
  bad.forEach((n) => console.log('  ✗ ' + n));
  process.exit(1);
}
console.log('');
console.log('全部通过。');
