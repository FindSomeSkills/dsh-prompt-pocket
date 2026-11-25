// dsh-prompt-stash — Host half.
// Owns the file behind the pocket: one JSON document under $DSH_HOME/dsh-prompt-stash,
// atomic writes, a 500-entry cap with least-recently-used eviction, three HTTP routes
// the browser half reads, plus a message-text route for "save this reply".

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';

const CAP = 500;
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const DIR = path.join(HOME, 'dsh-prompt-stash');
const STORE = path.join(DIR, 'store.d');
const LEGACY = path.join(DIR, 'store.json');
const SYNC = path.join(DIR, 'sync.json');
const TOMB_DAYS = 90;
const FILE = LEGACY;

function newId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function clipTitle(text) {
  const first = String(text || '').split(/\r?\n/).find((l) => l.trim()) || '';
  return first.replace(/\s+/g, ' ').trim().slice(0, 40);
}

const empty = () => ({ version: 1, entries: [], tombstones: [] });

function normalizeEntry(raw, fallbackId) {
  const text = String(raw.text).slice(0, 20000);
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  const usedAt = typeof raw.usedAt === 'number' ? raw.usedAt : createdAt;
  const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : usedAt;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : fallbackId || newId(),
    text,
    title: typeof raw.title === 'string' && raw.title ? raw.title.slice(0, 60) : clipTitle(text),
    scope: raw.scope === 'workspace' ? 'workspace' : 'global',
    ...(typeof raw.workspaceId === 'string' && raw.workspaceId ? { workspaceId: raw.workspaceId } : {}),
    source: ['draft', 'selection', 'reply', 'manual'].includes(raw.source) ? raw.source : 'manual',
    createdAt,
    usedAt,
    updatedAt,
    useCount: typeof raw.useCount === 'number' ? raw.useCount : 0,
    ...(typeof raw.prior === 'string' && raw.prior.trim() ? { prior: raw.prior.slice(0, 20000) } : {}),
  };
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return empty();
  const list = Array.isArray(raw.entries) ? raw.entries : [];
  const entries = list
    .filter((e) => e && typeof e.text === 'string' && e.text.trim())
    .map((e) => normalizeEntry(e))
    .slice(-CAP);
  return { version: 1, entries, tombstones: [] };
}

function normalizeTombstone(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.deletedAt !== 'number') return null;
  return { id: raw.id, deletedAt: raw.deletedAt };
}

// One file per prompt: a git merge can then keep both sides instead of fighting
// over one JSON document. Tombstones live in the same directory and win when
// they are newer than the entry they delete.
async function readEntryFiles() {
  const entries = [];
  const tombstones = [];
  const names = (await fs.readdir(STORE)).filter((n) => n.endsWith('.json'));
  for (const name of names) {
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(path.join(STORE, name), 'utf8'));
    } catch {
      await fs.rename(path.join(STORE, name), path.join(STORE, `${name}.corrupt-${Date.now()}.bak`)).catch(() => {});
      continue;
    }
    if (typeof raw.deletedAt === 'number') {
      const tomb = normalizeTombstone(raw);
      if (tomb) tombstones.push(tomb);
      continue;
    }
    if (typeof raw.text === 'string' && raw.text.trim()) entries.push(normalizeEntry(raw, name.slice(0, -5)));
  }
  return { entries, tombstones };
}

async function migrateLegacy() {
  try {
    const raw = JSON.parse(await fs.readFile(LEGACY, 'utf8'));
    const legacy = normalize(raw);
    if (!legacy.entries.length) return 0;
    await writeStore(legacy);
    await fs.rename(LEGACY, `${LEGACY}.migrated-${Date.now()}`);
    return legacy.entries.length;
  } catch {
    return 0;
  }
}

async function readStore() {
  await fs.mkdir(STORE, { recursive: true });
  const names = (await fs.readdir(STORE)).filter((n) => n.endsWith('.json'));
  if (!names.length) await migrateLegacy();
  const { entries, tombstones } = await readEntryFiles();
  const cutoff = Date.now() - TOMB_DAYS * 24 * 60 * 60 * 1000;
  return { version: 1, entries, tombstones: tombstones.filter((t) => t.deletedAt >= cutoff) };
}

async function writeFileAtomic(file, body) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, file);
}

async function writeEntryFile(entry) {
  await writeFileAtomic(path.join(STORE, `${entry.id}.json`), JSON.stringify(entry));
}

async function writeTombstoneFile(tomb) {
  await writeFileAtomic(path.join(STORE, `${tomb.id}.json`), JSON.stringify(tomb));
}

async function writeStore(store) {
  await fs.mkdir(STORE, { recursive: true });
  const entries = store.entries || [];
  const tombstones = store.tombstones || [];
  const keep = new Set(entries.map((e) => e.id));
  const buried = new Set(tombstones.map((t) => t.id));
  for (const entry of entries) await writeEntryFile(entry);
  for (const tomb of tombstones) await writeTombstoneFile(tomb);
  for (const name of await fs.readdir(STORE)) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5);
    if (keep.has(id) || buried.has(id)) continue;
    await fs.unlink(path.join(STORE, name)).catch(() => {});
  }
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
    await writeEntryFile(entry);
    for (const dropped of entries) {
      if (!next.some((e) => e.id === dropped.id)) {
        await fs.unlink(path.join(STORE, `${dropped.id}.json`)).catch(() => {});
      }
    }
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
    await writeEntryFile(entries[i]);
    return { ok: true, entry: entries[i] };
  }

  if (op === 'remove') {
    const i = at(body.id);
    if (i < 0) return { ok: false, code: 'not-found' };
    entries.splice(i, 1);
    // The tombstone replaces the entry file: same name, different body.
    await writeTombstoneFile({ id: body.id, deletedAt: Date.now() });
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
      updatedAt: Date.now(),
    };
    await writeEntryFile(entries[i]);
    return { ok: true, entry: entries[i] };
  }

  if (op === 'touch') {
    const i = at(body.id);
    if (i < 0) return { ok: false, code: 'not-found' };
    entries[i] = { ...entries[i], usedAt: Date.now(), updatedAt: Date.now(), useCount: (entries[i].useCount || 0) + 1 };
    await writeEntryFile(entries[i]);
    return { ok: true };
  }

  return { ok: false, code: 'unknown-op' };
}

// ---------- git sync ----------
// The transport is a private git repository the user owns. Identity is the
// repository credential; the plugin never stores a token. Prompts are one file
// each, so a merge keeps both sides instead of fighting over one document.

function git(args) {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', DIR, ...args], { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 20000);
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout: '', stderr: 'git not available' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout: out.trim(), stderr: err.trim() });
    });
  });
}

async function readSyncConfig() {
  try {
    const raw = JSON.parse(await fsp.readFile(SYNC, 'utf8'));
    return {
      enabled: raw.enabled === true,
      remote: typeof raw.remote === 'string' ? raw.remote : '',
      branch: typeof raw.branch === 'string' && raw.branch ? raw.branch : 'main',
      syncId: typeof raw.syncId === 'string' ? raw.syncId : '',
      lastSyncAt: typeof raw.lastSyncAt === 'number' ? raw.lastSyncAt : 0,
      lastError: typeof raw.lastError === 'string' ? raw.lastError : '',
    };
  } catch {
    return { enabled: false, remote: '', branch: 'main', syncId: '', lastSyncAt: 0, lastError: '' };
  }
}

async function writeSyncConfig(cfg) {
  await fs.mkdir(DIR, { recursive: true });
  await writeFileAtomic(SYNC, JSON.stringify(cfg, null, 2));
}

async function ensureRepo(cfg) {
  await fs.mkdir(DIR, { recursive: true });
  if (!(await fsp.stat(path.join(DIR, '.git')).catch(() => null))) await git(['init']);
  const remote = await git(['remote', 'get-url', 'origin']);
  if (!remote.ok) await git(['remote', 'add', 'origin', cfg.remote]);
  else if (remote.stdout !== cfg.remote) await git(['remote', 'set-url', 'origin', cfg.remote]);
  const name = await git(['config', 'user.name']);
  if (!name.ok || !name.stdout) await git(['config', 'user.name', 'dsh-prompt-pocket']);
  const mail = await git(['config', 'user.email']);
  if (!mail.ok || !mail.stdout) await git(['config', 'user.email', 'pocket@localhost']);
  const ignore = path.join(DIR, '.gitignore');
  if (!(await fsp.stat(ignore).catch(() => null))) await fsp.writeFile(ignore, '*.tmp\n', 'utf8');
}

async function readRemoteEntries(cfg) {
  const fetched = await git(['fetch', 'origin', cfg.branch]);
  if (!fetched.ok) return null; // nothing on the remote yet
  const tmp = path.join(os.tmpdir(), `pocket-sync-${process.pid}-${Date.now()}`);
  const added = await git(['worktree', 'add', '--force', '--detach', tmp, `origin/${cfg.branch}`]);
  if (!added.ok) return null;
  try {
    const dir = path.join(tmp, 'store.d');
    const entries = [];
    const tombstones = [];
    for (const name of (await fsp.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json'))) {
      try {
        const raw = JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8'));
        if (typeof raw.deletedAt === 'number') tombstones.push(normalizeTombstone(raw));
        else if (raw && typeof raw.text === 'string' && raw.text.trim()) entries.push(normalizeEntry(raw, name.slice(0, -5)));
      } catch {
        /* a bad remote file is skipped, not merged */
      }
    }
    return { entries: entries.filter(Boolean), tombstones: tombstones.filter(Boolean) };
  } finally {
    await git(['worktree', 'remove', '--force', tmp]);
  }
}

function mergeStores(local, remote) {
  const byId = new Map(local.entries.map((e) => [e.id, e]));
  const tombs = new Map();
  for (const tomb of [...(local.tombstones || []), ...(remote.tombstones || [])]) {
    const current = tombs.get(tomb.id);
    if (!current || tomb.deletedAt > current.deletedAt) tombs.set(tomb.id, tomb);
  }
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let deleted = 0;
  for (const incoming of remote.entries) {
    const tomb = tombs.get(incoming.id);
    if (tomb && tomb.deletedAt >= incoming.updatedAt) continue;
    const current = byId.get(incoming.id);
    if (!current) {
      byId.set(incoming.id, incoming);
      added += 1;
    } else if (incoming.updatedAt > current.updatedAt) {
      byId.set(incoming.id, incoming);
      updated += 1;
    } else {
      skipped += 1;
    }
  }
  for (const [id, tomb] of tombs) {
    const current = byId.get(id);
    if (current && tomb.deletedAt > current.updatedAt) {
      byId.delete(id);
      deleted += 1;
    }
  }
  return { entries: [...byId.values()], tombstones: [...tombs.values()].filter(Boolean), added, updated, skipped, deleted };
}

// A public repository would publish every prompt. GitHub answers 404 to an
// unauthenticated API call for a private repo, 200 for a public one.
async function publicGitHubRepo(remote) {
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote || '');
  if (!m) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}`, { headers: { 'user-agent': 'dsh-prompt-pocket' } });
    return res.status === 200;
  } catch {
    return false;
  }
}

let syncInFlight = null;

async function syncNow(cfg) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runSync(cfg).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function runSync(cfg) {
  if (!cfg.enabled || !cfg.remote) return { ok: false, code: 'disabled' };
  const hasGit = await git(['--version']);
  if (!hasGit.ok) {
    await writeSyncConfig({ ...cfg, lastError: 'git is not installed' });
    return { ok: false, code: 'no-git' };
  }
  await ensureRepo(cfg);
  const local = await readStore();
  const remote = await readRemoteEntries(cfg);
  const merged = remote ? mergeStores(local, remote) : { entries: local.entries, tombstones: local.tombstones, added: 0, updated: 0, skipped: 0, deleted: 0 };
  // A sync can take seconds (fetch, worktree, push). Anything saved or deleted
  // while it runs is newer than the snapshot read above, so merge that in before
  // writing: otherwise the tail of the sync resurrects what was just deleted.
  const fresh = await readStore();
  const settled = mergeStores(merged, fresh);
  await writeStore({ version: 1, entries: settled.entries, tombstones: settled.tombstones });
  await git(['add', '-A']);
  const status = await git(['status', '--porcelain']);
  if (status.ok && status.stdout.trim()) await git(['commit', '-m', `pocket sync ${new Date().toISOString()}`]);
  let pushed = await git(['push', 'origin', `HEAD:${cfg.branch}`]);
  if (!pushed.ok) {
    await git(['pull', '--rebase', 'origin', cfg.branch]);
    pushed = await git(['push', 'origin', `HEAD:${cfg.branch}`]);
  }
  const next = {
    ...cfg,
    lastSyncAt: Date.now(),
    lastError: pushed.ok ? '' : (pushed.stderr || 'push failed').slice(0, 300),
  };
  await writeSyncConfig(next);
  return { ok: pushed.ok, code: pushed.ok ? 'ok' : 'push-failed', merge: merged };
}

let syncTimer = null;
function scheduleSync() {
  readSyncConfig().then((cfg) => {
    if (!cfg.enabled || !cfg.remote) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncNow(cfg).catch(() => {});
    }, 3000);
    if (syncTimer.unref) syncTimer.unref();
  });
}

// Merge an exported file into the local store. Same id + newer usedAt wins;
// everything else is kept, so an import never deletes a local prompt.
async function importEntries(rawEntries) {
  const store = await readStore();
  const byId = new Map(store.entries.map((e) => [e.id, e]));
  const tombById = new Map((store.tombstones || []).map((t) => [t.id, t]));
  const incoming = normalize({ entries: Array.isArray(rawEntries) ? rawEntries : [] }).entries;
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const entry of incoming) {
    const tomb = tombById.get(entry.id);
    if (tomb && tomb.deletedAt >= (entry.updatedAt || entry.usedAt || 0)) {
      skipped += 1;
      continue;
    }
    const current = byId.get(entry.id);
    if (!current) {
      byId.set(entry.id, entry);
      added += 1;
    } else if ((entry.usedAt || 0) > (current.usedAt || 0)) {
      byId.set(entry.id, entry);
      updated += 1;
    } else {
      skipped += 1;
    }
  }
  const entries = evict([...byId.values()]);
  await writeStore({ version: 1, entries, tombstones: [...tombById.values()] });
  return {
    ok: true,
    merge: {
      received: Array.isArray(rawEntries) ? rawEntries.length : 0,
      added,
      updated,
      skipped,
      invalid: (Array.isArray(rawEntries) ? rawEntries.length : 0) - incoming.length,
    },
  };
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
  'You turn a rough note into a professional prompt for DeepSeek Harness (DSH), an agentic coding harness.',
  'The input is the author\'s intent, not wording to preserve: rewrite it into a prompt an agent can execute.',
  'Structure the result, but only where it carries information:',
  '- the goal in one sentence;',
  '- the context, inputs and file paths the author mentioned;',
  '- ordered steps or constraints;',
  '- the expected output shape.',
  'Rules:',
  '- Keep the author\'s language.',
  '- Keep every {{variable}}, path, URL, code block and quoted string byte-for-byte.',
  '- Never invent facts, tools, files, APIs, requirements or numeric values the author did not state.',
  '- Never pad with generic advice such as be careful, ensure quality, or think step by step.',
  '- A prompt earns its length through information, not through headings; drop a section when it would be empty.',
  '- If the input is already a complete, executable prompt, return it unchanged character for character.',
  'Output only the prompt text: no preamble, no commentary, no code fences.',
].join('\n');

// One place decides whether a model reply is an acceptable rewrite.
export function cleanPolished(input, raw) {
  const src = String(input || '').trim();
  let out = String(raw || '').trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(out);
  if (fence) out = fence[1].trim();
  out = out.trim();
  if (!out) return { ok: false, code: 'empty' };
  if (out.length > 8000) return { ok: false, code: 'too-long' };
  if (out === src) return { ok: true, text: src, unchanged: true };
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

  // Pull once the host is up, then keep pulling every five minutes. Without this
  // a machine only ever pushed its own changes and never saw the other one.
  readSyncConfig()
    .then((cfg) => {
      if (cfg.enabled && cfg.remote) return syncNow(cfg);
    })
    .catch(() => {});
  const timer = setInterval(() => {
    readSyncConfig()
      .then((cfg) => {
        if (cfg.enabled && cfg.remote) return syncNow(cfg);
      })
      .catch(() => {});
  }, 5 * 60 * 1000);
  if (timer.unref) timer.unref();

  ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-prompt-stash',
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');

      if (url.pathname === '/dsh-prompt-stash/state') {
        if (req.method !== 'GET') return sendNode(res, 405, { error: 'method not allowed' });
        // Opening the panel refreshes from the remote when the last sync is old.
        const cfg = await readSyncConfig();
        if (cfg.enabled && cfg.remote && Date.now() - cfg.lastSyncAt > 30000) scheduleSync();
        return sendNode(res, 200, await snapshot(url.searchParams.get('workspace') || undefined));
      }

      if (url.pathname === '/dsh-prompt-stash/sync') {
        const cfg = await readSyncConfig();
        if (req.method === 'GET') {
          const hasGit = await git(['--version']);
          return sendNode(res, 200, { ...cfg, gitAvailable: hasGit.ok });
        }
        if (req.method !== 'POST') return sendNode(res, 405, { error: 'method not allowed' });
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return sendNode(res, 400, { error: 'malformed body' });
        }
        const next = {
          ...cfg,
          enabled: body.enabled === true,
          remote: typeof body.remote === 'string' ? body.remote.trim() : cfg.remote,
          branch: typeof body.branch === 'string' && body.branch.trim() ? body.branch.trim() : cfg.branch,
          syncId: cfg.syncId || newId(),
        };
        if (next.enabled && await publicGitHubRepo(next.remote)) {
          return sendNode(res, 400, { error: 'public-repo', code: 'public-repo' });
        }
        await writeSyncConfig(next);
        const result = next.enabled && next.remote ? await syncNow(next) : { ok: true, code: 'saved' };
        return sendNode(res, 200, { ...await readSyncConfig(), result, ...(await snapshot()) });
      }

      if (url.pathname === '/dsh-prompt-stash/sync/now') {
        if (req.method !== 'POST') return sendNode(res, 405, { error: 'method not allowed' });
        const cfg = await readSyncConfig();
        const result = await syncNow(cfg);
        return sendNode(res, result.ok ? 200 : 400, { ...await readSyncConfig(), result, ...(await snapshot()) });
      }

      if (url.pathname === '/dsh-prompt-stash/export') {
        if (req.method !== 'GET') return sendNode(res, 405, { error: 'method not allowed' });
        const store = await readStore();
        return sendNode(res, 200, { version: 1, exportedAt: new Date().toISOString(), entries: store.entries });
      }

      if (url.pathname === '/dsh-prompt-stash/import') {
        if (req.method !== 'POST') return sendNode(res, 405, { error: 'method not allowed' });
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return sendNode(res, 400, { error: 'malformed body' });
        }
        if (!Array.isArray(body && body.entries)) return sendNode(res, 400, { error: 'entries required' });
        const result = await importEntries(body.entries);
        return sendNode(res, 200, { ...result, ...(await snapshot(body.workspaceId)) });
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
        scheduleSync();
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
        return sendNode(res, 200, { ok: true, text: result.text, unchanged: result.unchanged === true });
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
