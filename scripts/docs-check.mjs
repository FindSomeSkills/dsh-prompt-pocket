// Docs regression: the shipped detail pages are read by the plugin manager, so a
// stale claim there reaches users the same way a code bug does.
// Run: node scripts/docs-check.mjs
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFile(path.join(ROOT, rel), 'utf8');
const exists = async (rel) => {
  try {
    await fs.access(path.join(ROOT, rel));
    return true;
  } catch {
    return false;
  }
};

const ok = [];
const pass = (n) => ok.push(n);

const pkg = JSON.parse(await read('package.json'));
const locales = {
  en: JSON.parse(await read('locale/en.json')),
  zh: JSON.parse(await read('locale/zh.json')),
};

// 1. Each language points at its own page, and the page is really there.
const details = {};
for (const [lang, dict] of Object.entries(locales)) {
  const rel = dict.meta && dict.meta.detail;
  assert.ok(rel, lang + ' 缺少 meta.detail');
  assert.ok(await exists(rel), lang + ' 的 detail 文件不存在：' + rel);
  details[lang] = rel;
}
assert.notEqual(details.en, details.zh, '中英各一份，不要共用');
pass('中英各有一份 detail，路径存在');

// 2. Every shipped file is whitelisted, or npm drops it silently.
for (const rel of [...Object.values(details), 'docs/DETAIL.md', 'docs/DETAIL.zh.md', 'scripts/docs-check.mjs']) {
  assert.ok(pkg.files.includes(rel), 'package.json files 里缺 ' + rel);
}
pass('files 白名单覆盖 detail 与脚本');

// 3. No stale claims from an earlier design.
const dead = ['sqlite', 'prompts.db', '导入导出', '回收站', '标签树'];
for (const [lang, rel] of Object.entries(details)) {
  const text = await read(rel);
  for (const s of dead) {
    if (s === 'AI 润色' || s === '标签树' || s === '导入导出' || s === '回收站') {
      // These may only appear inside the "what it does not do" sentence.
      const lines = text.split(/\r?\n/).filter((l) => l.includes(s));
      for (const line of lines) {
        assert.ok(/不|没有|no /.test(line), lang + ' 里把「' + s + '」写成了功能：' + line.trim().slice(0, 60));
      }
    } else {
      assert.ok(!text.includes(s), lang + ' 的 detail 里还留着旧实现：' + s);
    }
  }
}
pass('没有把不做的功能写成功能');

// 4. The facts this plugin actually promises are stated in both languages.
for (const [lang, rel] of Object.entries(details)) {
  const text = await read(rel);
  const facts = ['Ctrl+Shift+S', 'Ctrl+Shift+P', 'dsh-prompt-stash/store.json', '500', 'prompt_stash', 'DSH'];
  for (const s of facts) {
    assert.ok(text.includes(s), lang + ' 的 detail 里没写 ' + s);
  }
}
pass('快捷键、存储路径、上限、工具名都写对了');

// 5. Local links resolve.
for (const [lang, rel] of Object.entries(details)) {
  const text = await read(rel);
  for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)#\s]+)\)/g)) {
    const link = m[1];
    assert.ok(!/^https?:/.test(link), lang + ' 里出现了外链，包内应使用相对路径：' + link);
    assert.ok(await exists(path.join(path.dirname(rel), link)), lang + ' 的链接指不到文件：' + link);
  }
}
pass('页内本地链接都能打开');

// 6. Once a screenshot exists it belongs right under the title.
if (await exists('docs/shot.png')) {
  for (const [lang, rel] of Object.entries(details)) {
    const lines = (await read(rel)).split(/\r?\n/).filter((l) => l.trim());
    assert.equal(lines[0].trim(), '# dsh-prompt-stash', lang + ' 第一行应是标题');
    assert.match(lines[1], /^!\[[^\]]+\]\(shot\.png\)$/, lang + ' 标题下面要紧跟截图');
  }
  pass('截图紧跟标题');
} else {
  pass('截图还没拍（装进 DSH 后补，拍完这条会自动开始检查）');
}

console.log('通过 ' + ok.length + ' 项：');
ok.forEach((n, i) => console.log('  ' + (i + 1) + '. ' + n));
