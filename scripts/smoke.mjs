// Host-half regression: exercises the real route handler against a throwaway DSH_HOME.
// Run: node scripts/smoke.mjs
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-stash-'));
process.env.DSH_HOME = tmp;

const { apply, cleanPolished } = await import('../index.js');

let fakeLlm = null;
let fakeModel = null;

const routes = [];
const tools = [];
const sessions = { get: (id) => (id === 'session-a' ? fakeSession : undefined) };
const fakeSession = {
  snapshotEvents: () => [
    { type: 'assistant/message', seq: 3, data: { message: { id: 'm-1', role: 'assistant', content: [{ type: 'text', text: '第一段\n\n第二段' }, { type: 'tool-call', id: 'c1', name: 'x', arguments: '{}' }] } } },
  ],
};

apply({
  webServer: { register: (r) => (routes.push(r), () => {}) },
  tools: { register: (def) => (tools.push(def), () => {}) },
  get: (k) => (k === 'sessions' ? sessions : k === 'llm' ? fakeLlm : k === 'agentDefaultModel' ? fakeModel : undefined),
});

assert.equal(routes.length, 1, '应当只注册一条前缀路由');
const route = routes[0];
assert.equal(route.kind, 'prefix');
assert.equal(route.path, '/dsh-prompt-stash');
assert.equal(tools.length, 1, '应当注册 prompt_stash 工具');
assert.equal(tools[0].name, 'prompt_stash');

async function* bodyOf(text) {
  if (text) yield Buffer.from(text);
}

async function call(pathname, init = {}) {
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers || {};
    },
    end(chunk) {
      this.body = String(chunk || '');
    },
  };
  const req = { method: init.method || 'GET', url: pathname, [Symbol.asyncIterator]: () => bodyOf(init.body) };
  await route.handler(req, res);
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    /* keep null */
  }
  return { status: res.status, json };
}

const post = (pathname, payload) =>
  call(pathname, { method: 'POST', body: JSON.stringify(payload) });

const ok = [];
const pass = (n) => ok.push(n);

// 1. an empty store answers with an empty list rather than an error
{
  const r = await call('/dsh-prompt-stash/state');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.entries, []);
  assert.equal(r.json.cap, 500);
  pass('空库返回空清单，不报错');
}

// 2. saving a workspace entry hides it from another workspace, shows it in its own
{
  const saved = await post('/dsh-prompt-stash/mutate', {
    op: 'save',
    text: '09:30 提交 sitemap',
    scope: 'workspace',
    workspaceId: 'ws-1',
    source: 'draft',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.entry.scope, 'workspace');
  assert.equal(saved.json.entry.workspaceId, 'ws-1');
  assert.equal(saved.json.entry.title, '09:30 提交 sitemap');

  const mine = await call('/dsh-prompt-stash/state?workspace=ws-1');
  assert.equal(mine.json.entries.length, 1);
  const other = await call('/dsh-prompt-stash/state?workspace=ws-2');
  assert.equal(other.json.entries.length, 0, '别的项目不该看见');
  const none = await call('/dsh-prompt-stash/state');
  assert.equal(none.json.entries.length, 0, '没有 workspace 的裸会话看不见项目条目');
  pass('项目档按 workspace 隔离');
}

// 3. a global entry is visible everywhere
{
  const saved = await post('/dsh-prompt-stash/mutate', {
    op: 'save',
    text: 'global prompt',
    scope: 'global',
    source: 'manual',
  });
  assert.equal(saved.status, 200);
  const a = await call('/dsh-prompt-stash/state?workspace=ws-1');
  const b = await call('/dsh-prompt-stash/state?workspace=ws-2');
  assert.ok(a.json.entries.some((e) => e.text === 'global prompt'));
  assert.ok(b.json.entries.some((e) => e.text === 'global prompt'));
  pass('通用档在所有会话可见');
}

// 4. moving an entry to global widens its visibility
{
  const ws = await call('/dsh-prompt-stash/state?workspace=ws-1');
  const target = ws.json.entries.find((e) => e.scope === 'workspace');
  const moved = await post('/dsh-prompt-stash/mutate', { op: 'move', id: target.id, scope: 'global' });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.entry.scope, 'global');
  const other = await call('/dsh-prompt-stash/state?workspace=ws-2');
  assert.ok(other.json.entries.some((e) => e.id === target.id));
  pass('可以改存通用');
}

// 5. touch moves an entry to the front and counts uses
{
  const list = await call('/dsh-prompt-stash/state');
  const first = list.json.entries.find((e) => e.text === 'global prompt');
  await new Promise((r) => setTimeout(r, 5));
  const touched = await post('/dsh-prompt-stash/mutate', { op: 'touch', id: first.id });
  assert.equal(touched.status, 200);
  const after = await call('/dsh-prompt-stash/state');
  assert.equal(after.json.entries[0].id, first.id, '最近用过的排最前');
  assert.equal(after.json.entries[0].useCount, 1);
  pass('用一次就排到最前并计数');
}

// 6. editing rewrites the title from the new first line
{
  const list = await call('/dsh-prompt-stash/state');
  const id = list.json.entries[0].id;
  const r = await post('/dsh-prompt-stash/mutate', { op: 'update', id, text: '新的第一行\n正文' });
  assert.equal(r.status, 200);
  assert.equal(r.json.entry.title, '新的第一行');
  pass('编辑后标题跟着首行走');
}

// 7. deleting removes it for good
{
  const list = await call('/dsh-prompt-stash/state');
  const id = list.json.entries[0].id;
  const r = await post('/dsh-prompt-stash/mutate', { op: 'remove', id });
  assert.equal(r.status, 200);
  const after = await call('/dsh-prompt-stash/state');
  assert.ok(!after.json.entries.some((e) => e.id === id));
  pass('删掉就真的没了');
}

// 8. empty text is refused, not stored as a blank row
{
  const r = await post('/dsh-prompt-stash/mutate', { op: 'save', text: '   ', scope: 'global' });
  assert.equal(r.status, 400);
  pass('空白内容不落库');
}

// 9. workspace scope without a workspace is refused
{
  const r = await post('/dsh-prompt-stash/mutate', { op: 'save', text: 'x', scope: 'workspace' });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'no-workspace');
  pass('没有 workspace 时拒绝存项目档');
}

// 10. the reply route returns only text blocks, joined as Markdown
{
  const r = await call('/dsh-prompt-stash/message?session=session-a&id=m-1');
  assert.equal(r.status, 200);
  assert.equal(r.json.text, '第一段\n\n第二段');
  assert.equal(r.json.title, '第一段');
  pass('回复正文只取 text 块，跳过工具调用');
}

// 11. an unknown message id is a 404, not an empty string
{
  const r = await call('/dsh-prompt-stash/message?session=session-a&id=nope');
  assert.equal(r.status, 404);
  pass('找不到的消息返回 404');
}

// 12. the cap evicts the least recently used entry, never the new one
{
  for (let i = 0; i < 500; i += 1) {
    await post('/dsh-prompt-stash/mutate', { op: 'save', text: 'filler ' + i, scope: 'global' });
  }
  const last = await post('/dsh-prompt-stash/mutate', { op: 'save', text: 'newest one', scope: 'global' });
  assert.equal(last.status, 200);
  const all = await call('/dsh-prompt-stash/state');
  assert.equal(all.json.total, 500, '上限就是 500');
  assert.ok(all.json.entries.some((e) => e.text === 'newest one'), '刚存的不该被淘汰');
  pass('超过 500 条按最久未用淘汰，新条留下');
}

// 13. a corrupt file is renamed and the store starts clean
{
  const file = path.join(tmp, 'dsh-prompt-stash', 'store.json');
  await fs.writeFile(file, '{ this is not json', 'utf8');
  const r = await call('/dsh-prompt-stash/state');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.entries, []);
  const files = await fs.readdir(path.dirname(file));
  assert.ok(files.some((f) => f.includes('.corrupt-')), '坏文件要留底');
  pass('坏文件留底后从空库继续');
}

// 14. the tool reads and writes the same file the routes serve
{
  const tool = tools[0];
  const saved = await tool.execute({ op: 'save', text: 'tool saved prompt', scope: 'global' });
  assert.equal(saved.ok, true);
  const state = await call('/dsh-prompt-stash/state');
  assert.ok(state.json.entries.some((e) => e.text === 'tool saved prompt'), '工具写进去，路由立刻能读到');
  const hasUndefined = (o) => Object.values(o).some((v) => v === undefined);
  assert.ok(!hasUndefined(saved.entry), '工具返回的条目不能带 undefined 字段（会破坏 lossless JSON）');
  assert.ok(state.json.entries.every((e) => !hasUndefined(e)), '列表里的条目也不能带 undefined');
  const found = await tool.execute({ op: 'search', query: 'tool saved' });
  assert.equal(found.entries.length, 1);
  pass('工具与 HTTP 读写同一份文件');
}


// 15. polish output is accepted only when it is a real, bounded rewrite
{
  const fenced = '\u0060\u0060\u0060\nclean rewrite\n\u0060\u0060\u0060';
  const a = cleanPolished('messy prompt', fenced);
  assert.equal(a.ok, true);
  assert.equal(a.text, 'clean rewrite');
  const same = cleanPolished('same text', 'same text');
  assert.equal(same.ok, true, '没改动也是合法结果');
  assert.equal(same.unchanged, true, '没改动要标出来，而不是报错');
  assert.equal(cleanPolished('src', '   ').ok, false, '空结果必须拒收');
  assert.equal(cleanPolished('短句', 'x'.repeat(9000)).ok, false, '超过 8000 字就拒收');
  pass('润色结果：去围栏、拒空、未改动照样返回、拒暴涨');
}

// 16. without an LLM the route answers 503 instead of pretending
{
  const r = await post('/dsh-prompt-stash/polish', { text: 'hello' });
  assert.equal(r.status, 503);
  assert.equal(r.json.code, 'no-model');
  pass('没有模型时返回 503，不编造结果');
}

// 17. with a model it returns the cleaned text from the stream
{
  fakeModel = { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) };
  fakeLlm = {
    stream: async function* () {
      yield { type: 'text-delta', index: 0, text: 'polished ' };
      yield { type: 'text-delta', index: 0, text: 'prompt' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
  const r = await post('/dsh-prompt-stash/polish', { text: 'raw prompt' });
  assert.equal(r.status, 200);
  assert.equal(r.json.text, 'polished prompt');
  fakeLlm = null;
  fakeModel = null;
  pass('有模型时把流式结果拼成润色文本');
}

await fs.rm(tmp, { recursive: true, force: true });
if (process.env.DSH_HOME === tmp) delete process.env.DSH_HOME;

console.log('通过 ' + ok.length + ' 项：');
ok.forEach((n, i) => console.log('  ' + (i + 1) + '. ' + n));
