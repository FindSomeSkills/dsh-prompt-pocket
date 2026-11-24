// dsh-prompt-stash — Host half.
// Owns the file behind the pocket: one JSON document under $DSH_HOME/dsh-prompt-stash,
// atomic writes, a 500-entry cap with least-recently-used eviction, three HTTP routes
// the browser half reads, plus a message-text route for "save this reply".

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CAP = 500;
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const DIR = path.join(HOME, 'dsh-prompt-stash');
const FILE = path.join(DIR, 'store.json');

function newId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function clipTitle(text) {
  const first = String(text || '').split(/\r?\n/).find((l) => l.trim()) || '';
  return first.replace(/\s+/g, ' ').trim().slice(0, 40);
}

const empty = () => ({ version: 1, entries: [] });

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return empty();
  const list = Array.isArray(raw.entries) ? raw.entries : [];
  const entries = list
    .filter((e) => e && typeof e.text === 'string' && e.text.trim())
    .map((e) => ({
      id: typeof e.id === 'string' && e.id ? e.id : newId(),
      text: String(e.text).slice(0, 20000),
      title: typeof e.title === 'string' && e.title ? e.title.slice(0, 60) : clipTitle(e.text),
      scope: e.scope === 'workspace' ? 'workspace' : 'global',
      ...(typeof e.workspaceId === 'string' && e.workspaceId ? { workspaceId: e.workspaceId } : {}),
      source: ['draft', 'selection', 'reply', 'manual'].includes(e.source) ? e.source : 'manual',
      createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
      usedAt: typeof e.usedAt === 'number' ? e.usedAt : typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
      useCount: typeof e.useCount === 'number' ? e.useCount : 0,
      ...(typeof e.prior === 'string' && e.prior.trim() ? { prior: e.prior.slice(0, 20000) } : {}),
    }))
    .slice(-CAP);
  return { version: 1, entries };
}

async function readStore() {
  try {
    return normalize(JSON.parse(await fs.readFile(FILE, 'utf8')));
  } catch (e) {
    if (e && e.code === 'ENOENT') return empty();
    try {
      await fs.rename(FILE, FILE + '.corrupt-' + Date.now() + '.bak');
    } catch {
      /* nothing else to do */
    }
    return empty();
  }
}

async function writeStore(store) {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tmp, FILE);
}

// Least-recently-used first: the entry evicted is the one untouched the longest.
function evict(entries) {
  if (entries.length <= CAP) return entries;
  const sorted = entries.slice().sort((a, b) => a.usedAt - b.usedAt);
  const drop = new Set(sorted.slice(0, entries.length - CAP).map((e) => e.id));
  return entries.filter((e) => !drop.has(e.id));
}

function visible(entries, workspaceId) {
  return entries.filter(
    (e) => e.scope === 'global' || (e.scope === 'workspace' && workspaceId && e.workspaceId === workspaceId)
  );
}

async function snapshot(workspaceId) {
  const store = await readStore();
  const shown = visible(store.entries, workspaceId);
  return {
    entries: shown.sort((a, b) => b.usedAt - a.usedAt),
    total: store.entries.length,
    cap: CAP,
    counts: {
      global: store.entries.filter((e) => e.scope === 'global').length,
      workspace: store.entries.filter((e) => e.scope === 'workspace').length,
    },
  };
}

async function mutate(body) {
  const store = await readStore();
  const entries = store.entries.slice();
  const op = body && body.op;
  const at = (id) => entries.findIndex((e) => e.id === id);

  if (op === 'save') {
    const text = String(body.text || '').trim();
    if (!text) return { ok: false, code: 'empty' };
    const scope = body.scope === 'workspace' ? 'workspace' : 'global';
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined;
    if (scope === 'workspace' && !workspaceId) return { ok: false, code: 'no-workspace' };
    const entry = {
      id: newId(),
      text: text.slice(0, 20000),
      title: (typeof body.title === 'string' && body.title.trim() ? body.title.trim() : clipTitle(text)).slice(0, 60),
      scope,
      ...(scope === 'workspace' ? { workspaceId } : {}),
      source: ['draft', 'selection', 'reply', 'manual'].includes(body.source) ? body.source : 'manual',
      createdAt: Date.now(),
      usedAt: Date.now(),
      useCount: 0,
    };
    entries.push(entry);
    const next = evict(entries);
    await writeStore({ version: 1, entries: next });
    return { ok: true, entry };
  }

  if (op === 'update') {
    const i = at(body.id);
    if (i < 0) return { ok: false, code: 'not-found' };
    const text = String(body.text || '').trim();
    if (!text) return { ok: false, code: 'empty' };
    entries[i] = {
      ...entries[i],
      text: text.slice(0, 20000),
      title: (typeof body.title === 'string' && body.title.trim()) || clipTitle(text),
      ...(typeof body.prior === 'string' && body.prior.trim() ? { prior: body.prior.slice(0, 20000) } : {}),
    };
    await writeStore({ version: 1, entries });
    return { ok: true, entry: entries[i] };
  }

  if (op === 'remove') {
    const i = at(body.id);
    if (i < 0) return { ok: false, code: 'not-found' };
    entries.splice(i, 1);
    await writeStore({ version: 1, entries });
    return { ok: true };
  }

  if (op === 'move') {
    const i = at(body.id);
    if (i < 0) return { ok: false, code: 'not-found' };
    const scope = body.scope === 'workspace' ? 'workspace' : 'global';
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : entries[i].workspaceId;
    if (scope === 'workspace' && !workspaceId) return { ok: false, code: 'no-workspace' };
    entries[i] = {
      ...entries[i],
      scope,
      ...(scope === 'workspace' ? { workspaceId } : {}),
    };
    await writeStore({ version: 1, entries });
    return { ok: true, entry: entries[i] };
  }

  if (op === 'touch') {
    const i = at(body.id);
    if (i < 0) return { ok: false, code: 'not-found' };
    entries[i] = { ...entries[i], usedAt: Date.now(), useCount: (entries[i].useCount || 0) + 1 };
    await writeStore({ version: 1, entries });
    return { ok: true };
  }

  return { ok: false, code: 'unknown-op' };
}

// The client action row only receives a message id; the text lives in the session log.
function replyText(sessions, sessionId, messageId) {
  if (!sessions || !sessionId || !messageId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  let hit = null;
  const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : [];
  for (const ev of events) {
    const m = ev && ev.type === 'assistant/message' && ev.data && ev.data.message;
    if (m && String(m.id) === String(messageId)) hit = m;
  }
  if (!hit) return null;
  const parts = [];
  for (const block of hit.content || []) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  const text = parts.join('\n\n').trim();
  return text || null;
}


// Polishing is opt-in: it runs only when the user clicks it, never on save.
export const POLISH_SYSTEM = [
  'You clean up a prompt that the user will reuse.',
  'Keep the original language, intent and scope.',
  'Keep every {{variable}}, path, URL, code block and quoted string byte-for-byte.',
  'Do not add features, steps, examples or explanations.',
  'Never grow the text past 1.3 times the input; shortening is fine.',
  'Replace vague wording with concrete instructions and remove filler.',
  'Output only the rewritten prompt: no preamble, no commentary, no code fences.',
].join('\n');

// One place decides whether a model reply is an acceptable rewrite.
export function cleanPolished(input, raw) {
  const src = String(input || '').trim();
  let out = String(raw || '').trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(out);
  if (fence) out = fence[1].trim();
  out = out.trim();
  if (!out) return { ok: false, code: 'empty' };
  if (out.length > Math.max(120, src.length * 2)) return { ok: false, code: 'too-long' };
  if (out === src) return { ok: false, code: 'unchanged' };
  return { ok: true, text: out };
}

async function polishText(ctx, text) {
  const llm = ctx.get('llm');
  const models = ctx.get('agentDefaultModel');
  if (!llm || !models) return { ok: false, code: 'no-model' };
  let selection;
  try {
    selection = models.currentSelection();
  } catch {
    return { ok: false, code: 'no-model' };
  }
  const provider = selection && selection.provider;
  const model = selection && selection.model;
  if (!provider || !model) return { ok: false, code: 'no-model' };
  let raw = '';
  try {
    const stream = llm.stream({
      provider,
      model,
      system: POLISH_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: String(text) }] }],
      maxTokens: 1200,
      temperature: 0.2,
      signal: AbortSignal.timeout(25000),
    });
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') raw += chunk.text;
      else if (chunk.type === 'finish') {
        const kind = chunk.reason && chunk.reason.kind;
        if (kind !== 'stop') return { ok: false, code: 'failed', reason: String(kind || 'unknown') };
      }
    }
  } catch (e) {
    return { ok: false, code: 'failed', message: String((e && e.message) || e).slice(0, 160) };
  }
  return cleanPolished(text, raw);
}

function sendNode(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const TOOL_DESCRIPTION = [
  'Read or change the prompt pocket the user keeps in the corner of the interface.',
  'Use op=list or op=search to read saved prompts (scope global or workspace).',
  'Use op=save to keep a prompt the user asked you to remember, op=remove to delete one.',
].join(' ');

const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['list', 'search', 'save', 'remove'] },
    query: { type: 'string', description: 'Search text, for search.' },
    text: { type: 'string', description: 'Prompt text, for save.' },
    title: { type: 'string', description: 'Optional short title, for save.' },
    scope: { type: 'string', enum: ['global', 'workspace'], description: 'Where it is visible, for save.' },
    workspaceId: { type: 'string', description: 'Workspace key when scope is workspace.' },
    id: { type: 'string', description: 'Entry id, for remove.' },
  },
  required: ['op'],
  additionalProperties: false,
};

export const inject = ['webServer', 'tools'];

export function apply(ctx) {
  const sessions = ctx.get('sessions');

  ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-prompt-stash',
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');

      if (url.pathname === '/dsh-prompt-stash/state') {
        if (req.method !== 'GET') return sendNode(res, 405, { error: 'method not allowed' });
        return sendNode(res, 200, await snapshot(url.searchParams.get('workspace') || undefined));
      }

      if (url.pathname === '/dsh-prompt-stash/mutate') {
        if (req.method !== 'POST') return sendNode(res, 405, { error: 'method not allowed' });
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return sendNode(res, 400, { error: 'malformed body' });
        }
        const result = await mutate(body);
        if (!result.ok) return sendNode(res, 400, result);
        return sendNode(res, 200, { ...result, ...(await snapshot(body.workspaceId)) });
      }

      if (url.pathname === '/dsh-prompt-stash/message') {
        if (req.method !== 'GET') return sendNode(res, 405, { error: 'method not allowed' });
        const text = replyText(sessions, url.searchParams.get('session'), url.searchParams.get('id'));
        if (!text) return sendNode(res, 404, { error: 'not-found' });
        return sendNode(res, 200, { text, title: clipTitle(text) });
      }


      if (url.pathname === '/dsh-prompt-stash/polish') {
        if (req.method !== 'POST') return sendNode(res, 405, { error: 'method not allowed' });
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return sendNode(res, 400, { error: 'malformed body' });
        }
        const store = await readStore();
        const source = body && body.text ? String(body.text) : store.entries.find((e) => e.id === body.id)?.text;
        if (!source || !String(source).trim()) return sendNode(res, 400, { error: 'empty' });
        const result = await polishText(ctx, source);
        if (!result.ok) {
          const status = result.code === 'no-model' ? 503 : 502;
          return sendNode(res, status, result);
        }
        return sendNode(res, 200, { ok: true, text: result.text });
      }

      return sendNode(res, 404, { error: 'not found' });
    },
  });

  ctx.tools.register({
    name: 'prompt_stash',
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    output: {
      schema: { type: 'object' },
      render(args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
      },
    },
    async execute(args) {
      const a = args && typeof args === 'object' ? args : {};
      if (a.op === 'list') return snapshot(a.workspaceId);
      if (a.op === 'search') {
        const q = String(a.query || '').toLowerCase();
        const snap = await snapshot(a.workspaceId);
        return { ...snap, entries: snap.entries.filter((e) => (e.title + '\n' + e.text).toLowerCase().includes(q)) };
      }
      if (a.op === 'save') {
        const result = await mutate({ op: 'save', ...a, source: 'manual' });
        return { ...result, ...(await snapshot(a.workspaceId)) };
      }
      if (a.op === 'remove') {
        const result = await mutate({ op: 'remove', id: a.id });
        return { ...result, ...(await snapshot(a.workspaceId)) };
      }
      return { error: 'unknown op' };
    },
  });
}
