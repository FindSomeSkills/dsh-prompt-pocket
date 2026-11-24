window.__ModuleLoader__.load({
  id: 'dsh-prompt-pocket',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;
    const { useState, useEffect, useRef, useMemo, useCallback } = React;

    const EP = '/dsh-prompt-stash';
    const POS_KEY = 'dsh-prompt-stash.pos';
    const SCOPE_KEY = 'dsh-prompt-stash.scope';
    const NS = 'plugin.dsh-prompt-stash';

    const zh = {
      open: '提示词口袋',
      title: '提示词口袋',
      search: '搜索',
      tabWorkspace: '此项目',
      tabGlobal: '通用',
      empty: '还没有存过提示词。选中文字按 Ctrl+Shift+S。',
      emptySearch: '没有匹配的',
      saved: '已存到 {scope}',
      savedGlobal: '通用',
      savedWorkspace: '此项目',
      move: '改存通用',
      moved: '已改存通用',
      insertHint: '↑↓ 选择 · 回车插入 · Alt+回车替换',
      insertHintOne: '回车插入 · Alt+回车替换',
      emptyOther: '这里还没有 · 切到{tab}（{n} 条）',
      del: '删掉',
      fail: '操作失败',
      saveEmpty: '没有可存的内容',
      saving: '存…',
      count: '{n} 条',
      saveReply: '存为提示词',
      moveToGlobal: '移到通用',
      moveToWorkspace: '移到此项目',
      polish: '写成 DSH 提示词',
      polishing: '生成中…',
      polishFail: '生成失败，原文已保留',
      polishTooLong: '生成结果超过 8000 字，没有替换原文',
      polishNoModel: '没有可用的模型，去设置里选一个',
      polishSame: '原文已经是完整可执行的提示词，没有改',
      countTotal: '共 {n} 条',
      polishOriginal: '原文',
      polishResult: 'DSH 提示词',
      accept: '用这版',
      discard: '放弃',
      retry: '再来一次',
    };

    const en = {
      open: 'Prompt pocket',
      title: 'Prompt pocket',
      search: 'Search',
      tabWorkspace: 'This project',
      tabGlobal: 'General',
      empty: 'Nothing saved yet. Select text and press Ctrl+Shift+S.',
      emptySearch: 'No match',
      saved: 'Saved to {scope}',
      savedGlobal: 'General',
      savedWorkspace: 'this project',
      move: 'Move to General',
      moved: 'Moved to General',
      insertHint: '↑↓ move · Enter inserts · Alt+Enter replaces',
      insertHintOne: 'Enter inserts · Alt+Enter replaces',
      emptyOther: 'Nothing here · switch to {tab} ({n})',
      del: 'Delete',
      fail: 'That did not work',
      saveEmpty: 'Nothing to save',
      saving: 'Saving…',
      count: '{n} saved',
      saveReply: 'Save as prompt',
      moveToGlobal: 'Move to General',
      moveToWorkspace: 'Move to this project',
      polish: 'Write a DSH prompt',
      polishing: 'Writing…',
      polishFail: 'Generation failed, the original is kept',
      polishTooLong: 'The result passed 8,000 characters, so the original is kept',
      polishNoModel: 'No model is available; pick one in settings',
      polishSame: 'The input is already an executable prompt; nothing changed',
      countTotal: '{n} in total',
      polishOriginal: 'Original',
      polishResult: 'DSH prompt',
      accept: 'Use this',
      discard: 'Discard',
      retry: 'Try again',
    };

    async function api(pathname, init) {
      const r = await fetch(EP + pathname, { cache: 'no-store', ...init });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* non-JSON */
      }
      return { ok: r.ok, status: r.status, json };
    }

    function readScope() {
      try {
        const s = localStorage.getItem(SCOPE_KEY);
        if (s === 'global' || s === 'workspace') return s;
      } catch {
        /* ignore */
      }
      return null;
    }


    // A prompt's first line is usually an instruction, not a name. Strip the
    // common lead-ins so the row reads like a label the user can scan.
    function deriveTitle(text) {
      const first = String(text || '')
        .split(/\r?\n/)
        .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
        .find((l) => l) || '';
      const stripped = first
        .replace(/^(目标|任务|背景|要求|角色|上下文)[:：]\s*/, '')
        .replace(/\*\*/g, '')
        .replace(/[。；;]\s*$/, '')
        .trim();
      return (stripped || first).slice(0, 24);
    }

    function rowLabel(text) {
      const flat = String(text || '')
        .replace(/\r?\n/g, ' ')
        .replace(/[*#>`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const stripped = flat.replace(/^(目标|任务|背景|要求|角色|上下文)[:：]\s*/, '');
      const label = (stripped || flat).trim();
      return label.length > 60 ? label.slice(0, 60) + '…' : label;
    }

    function previewOf(text) {
      return String(text || '')
        .replace(/\r?\n/g, ' ')
        .replace(/[*#>`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 44);
    }

    function readPos() {
      try {
        const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
        if (p && typeof p.right === 'number' && typeof p.bottom === 'number') return p;
      } catch {
        /* ignore */
      }
      return { right: 22, bottom: 96 };
    }

    function writePos(p) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(p));
      } catch {
        /* ignore */
      }
    }

    function workspaceOf(props) {
      if (typeof props.useWorkspaces !== 'function') return undefined;
      try {
        const items = props.useWorkspaces((s) => (s && s.items) || []);
        const sid = String(props.sessionId || '');
        for (const w of items || []) {
          if ((w.sessionIds || []).some((x) => String(x) === sid)) return w.workspaceId;
        }
        return undefined;
      } catch {
        return undefined;
      }
    }

    function shortTime(ms) {
      try {
        const d = new Date(ms);
        const p = (n) => String(n).padStart(2, '0');
        return p(d.getMonth() + 1) + '-' + p(d.getDate());
      } catch {
        return '';
      }
    }

    function Pocket(props) {
      const t = props.t;
      const inputActions = props.inputActions;
      const useInput = props.useInput;
      const draft = typeof useInput === 'function' ? useInput((s) => (s && s.draft) || '') : '';
      const workspaceId = workspaceOf(props);

      const [pos, setPos] = useState(readPos);
      const [open, setOpen] = useState(false);
      const [scope, setScope] = useState(workspaceId ? 'workspace' : 'global');
      const [q, setQ] = useState('');
      const [data, setData] = useState({ entries: [], counts: { global: 0, workspace: 0 }, total: 0 });
      const [flash, setFlash] = useState(null);
      const [polish, setPolish] = useState(null);
      const [active, setActive] = useState(0);
      const searchRef = useRef(null);
      const panelRef = useRef(null);
      const [lastId, setLastId] = useState(null);
      const spanRef = useRef(null);
      const dragRef = useRef(null);
      const movedRef = useRef(false);
      const rootRef = useRef(null);

      useEffect(() => {
        if (workspaceId) setScope((s) => (s === 'global' ? s : 'workspace'));
        else setScope('global');
      }, [workspaceId]);

      const load = useCallback(async () => {
        const r = await api('/state' + (workspaceId ? '?workspace=' + encodeURIComponent(workspaceId) : ''));
        if (r.ok && r.json) setData(r.json);
      }, [workspaceId]);

      useEffect(() => {
        load();
      }, [load]);

      const remember = useCallback(() => {
        if (inputActions && typeof inputActions.captureInsertion === 'function') {
          try {
            spanRef.current = inputActions.captureInsertion();
          } catch {
            spanRef.current = null;
          }
        }
      }, [inputActions]);

      const save = useCallback(
        async (opts) => {
          const selection = String(window.getSelection ? window.getSelection().toString() : '').trim();
          const text = (opts && opts.text) || selection || String(draft || '').trim();
          if (!text) {
            setFlash({ text: t('saveEmpty'), until: Date.now() + 2000 });
            return;
          }
          const remembered = readScope();
          const wantScope = (opts && opts.scope) || (workspaceId ? remembered === 'global' || scope === 'global' ? 'global' : 'workspace' : 'global');
          const r = await api('/mutate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              op: 'save',
              title: deriveTitle(text),
              text,
              scope: (opts && opts.scope) || wantScope,
              workspaceId,
              source: selection ? 'selection' : 'draft',
            }),
          });
          if (r.ok && r.json && r.json.entry) {
            setLastId(r.json.entry.id);
            setFlash({
              text: t('saved').replace('{scope}', wantScope === 'workspace' ? t('savedWorkspace') : t('savedGlobal')),
              until: Date.now() + 6000,
              moveable: wantScope === 'workspace',
              polishId: r.json.entry.id,
            });
            if (r.json.entries) setData(r.json);
            else load();
          } else {
            setFlash({ text: t('fail'), until: Date.now() + 2000 });
          }
        },
        [draft, workspaceId, load, t, scope]
      );

      const moveToGlobal = useCallback(async () => {
        if (!lastId) return;
        const r = await api('/mutate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op: 'move', id: lastId, scope: 'global' }),
        });
        if (r.ok && r.json) {
          setData(r.json);
          setFlash({ text: t('moved'), until: Date.now() + 1800 });
        }
      }, [lastId, t]);


      const startPolish = useCallback(
        async (id, original) => {
          setPolish({ id, original, result: '', busy: true });
          const r = await api('/polish', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          });
          if (r.ok && r.json && r.json.text)
            setPolish({ id, original, result: r.json.text, busy: false, unchanged: r.json.unchanged === true });
          else setPolish({ id, original, result: '', busy: false, failed: true, code: (r.json && r.json.code) || '' });
        },
        []
      );

      const acceptPolish = useCallback(async () => {
        if (!polish || !polish.result) return;
        const r = await api('/mutate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op: 'update', id: polish.id, text: polish.result, prior: polish.original, workspaceId }),
        });
        if (r.ok && r.json) setData(r.json);
        setPolish(null);
      }, [polish, workspaceId]);

      const moveEntry = useCallback(
        async (entry, target) => {
          const r = await api('/mutate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ op: 'move', id: entry.id, scope: target, workspaceId }),
          });
          if (r.ok && r.json) setData(r.json);
        },
        [workspaceId]
      );

      const remove = useCallback(
        async (id) => {
          const r = await api('/mutate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ op: 'remove', id, workspaceId }),
          });
          if (r.ok && r.json) setData(r.json);
        },
        [workspaceId]
      );

      const insert = useCallback(
        async (entry, replaceAll) => {
          if (!inputActions) return;
          try {
            if (replaceAll && typeof inputActions.setDraft === 'function') {
              inputActions.setDraft(entry.text);
            } else {
              const span = spanRef.current;
              const ok = span && typeof inputActions.insertText === 'function' ? inputActions.insertText(entry.text, span) : false;
              if (!ok) inputActions.setDraft((String(draft || '').trim() ? String(draft).replace(/\s*$/, '') + '\n\n' : '') + entry.text);
            }
            if (typeof inputActions.focus === 'function') inputActions.focus();
          } catch {
            /* editing refused while submitting */
          }
          api('/mutate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ op: 'touch', id: entry.id }),
          });
          setOpen(false);
        },
        [inputActions, draft]
      );

      // Shortcuts: save the draft/selection, and toggle the pocket.
      useEffect(() => {
        const onKey = (ev) => {
          if (!ev.ctrlKey || !ev.shiftKey || ev.altKey || ev.metaKey) return;
          const k = String(ev.key || '').toLowerCase();
          if (k === 's') {
            ev.preventDefault();
            save();
          } else if (k === 'p') {
            ev.preventDefault();
            remember();
            setOpen((v) => !v);
          }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
      }, [save, remember]);

      useEffect(() => {
        if (!flash) return;
        const ms = Math.max(0, flash.until - Date.now());
        const timer = setTimeout(() => setFlash(null), ms);
        return () => clearTimeout(timer);
      }, [flash]);

      // Dragging the pill. Position is stored as distance from the bottom-right corner.
      const onPillDown = (ev) => {
        remember();
        ev.preventDefault();
        const start = { x: ev.clientX, y: ev.clientY, right: pos.right, bottom: pos.bottom };
        dragRef.current = start;
        movedRef.current = false;
        const onMove = (e) => {
          const s = dragRef.current;
          if (!s) return;
          if (Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) > 3) movedRef.current = true;
          const right = Math.max(4, Math.min(window.innerWidth - 34, s.right - (e.clientX - s.x)));
          const bottom = Math.max(4, Math.min(window.innerHeight - 34, s.bottom - (e.clientY - s.y)));
          setPos({ right, bottom });
        };
        const onUp = () => {
          dragRef.current = null;
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          setPos((p) => {
            writePos(p);
            return p;
          });
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      };

      const rows = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return (data.entries || [])
          .filter((e) => (scope === 'global' ? e.scope === 'global' : e.scope === 'workspace'))
          .filter((e) => !needle || (e.title + '\n' + e.text).toLowerCase().includes(needle));
      }, [data.entries, q, scope]);

      const pick = useCallback((next) => {
        setScope(next);
        try {
          localStorage.setItem(SCOPE_KEY, next);
        } catch {
          /* ignore */
        }
      }, []);

      const total = (data.counts && (data.counts.global + data.counts.workspace)) || 0;
      const scopeCount = scope === 'global' ? (data.counts ? data.counts.global : 0) : (data.counts ? data.counts.workspace : 0);
      const otherScope = scope === 'global' ? 'workspace' : 'global';
      const otherCount = otherScope === 'global' ? (data.counts ? data.counts.global : 0) : (data.counts ? data.counts.workspace : 0);
      const showOther = workspaceId && otherCount > 0 && scopeCount === 0 && !q.trim();

      // Opening on an empty drawer while the other one holds prompts is how a
      // pocket looks broken. Switch once per open, and never again: an explicit
      // tab click must win, or the tab looks broken.
      const autoSwitched = useRef(false);
      useEffect(() => {
        if (!open) {
          autoSwitched.current = false;
          return;
        }
        if (autoSwitched.current || !workspaceId || q.trim()) return;
        if (scopeCount === 0 && otherCount > 0) {
          autoSwitched.current = true;
          setScope(otherScope);
        }
      }, [open, workspaceId, scopeCount, otherCount, otherScope, q]);

      useEffect(() => {
        if (active > rows.length - 1) setActive(Math.max(0, rows.length - 1));
      }, [rows.length, active]);

      useEffect(() => {
        if (!open) return;
        setActive(0);
        if (searchRef.current) searchRef.current.focus();
      }, [open]);

      // Native capture listener on the document: the composer owns key handling for
      // its own editor, and a portal escapes that tree, so the listener is scoped to
      // our panel by a containment check instead of relying on the input's bubble.
      useEffect(() => {
        if (!open) return undefined;
        const onKey = (ev) => {
          const panel = panelRef.current;
          if (!panel || !panel.contains(ev.target)) return;
          if (ev.isComposing) return;
          if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            ev.stopPropagation();
            setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
          } else if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            ev.stopPropagation();
            setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
          } else if (ev.key === 'Enter') {
            ev.preventDefault();
            ev.stopPropagation();
            const entry = rows[active];
            if (entry) insert(entry, ev.altKey);
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            setOpen(false);
          }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
      }, [open, rows, active, insert]);

      const pill = h(
        'button',
        {
          type: 'button',
          'data-dsh-prompt-stash': 'pill',
          title: t('open'),
          onPointerDown: onPillDown,
          onClick: () => {
            if (movedRef.current) {
              movedRef.current = false;
              return;
            }
            remember();
            setOpen((v) => !v);
            load();
          },
          style: {
            position: 'fixed',
            right: pos.right,
            bottom: pos.bottom,
            width: 24,
            height: 24,
            borderRadius: 12,
            border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35))',
            background: 'var(--dsw-alias-bg-overlay, rgba(127,127,127,.14))',
            color: 'var(--dsw-alias-label-secondary, #888)',
            fontSize: 10,
            lineHeight: '22px',
            textAlign: 'center',
            cursor: 'grab',
            opacity: open ? 0.9 : 0.28,
            transition: 'opacity 140ms ease',
            padding: 0,
            zIndex: 60,
            touchAction: 'none',
          },
          onMouseEnter: (e) => {
            e.currentTarget.style.opacity = '0.92';
          },
          onMouseLeave: (e) => {
            e.currentTarget.style.opacity = open ? '0.9' : '0.28';
          },
        },
        String(total)
      );

      if (!open) {
        const bubble = flash
          ? h(
              'div',
              {
                'data-dsh-prompt-stash': 'toast',
                style: {
                  position: 'fixed',
                  right: Math.min(pos.right + 28, Math.max(8, window.innerWidth - 260)),
                  bottom: pos.bottom - 4,
                  maxWidth: 250,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3))',
                  background: 'var(--dsw-alias-bg-layer-1, #1c1c1e)',
                  color: 'var(--dsw-alias-label-primary, #eee)',
                  fontSize: 11,
                  zIndex: 61,
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  boxShadow: '0 4px 14px rgba(0,0,0,.18)',
                },
              },
              h('span', null, flash.text),
              flash.moveable
                ? h(
                    'button',
                    { type: 'button', onClick: moveToGlobal, style: { ...btnStyle, fontSize: 11, color: 'var(--dsw-alias-brand-primary, #4aa3ff)' } },
                    t('move')
                  )
                : null,
              flash.polishId
                ? h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => {
                        const entry = (data.entries || []).find((x) => x.id === flash.polishId);
                        if (entry) {
                          setOpen(true);
                          startPolish(entry.id, entry.text);
                        }
                      },
                      style: { ...btnStyle, fontSize: 11, color: 'var(--dsw-alias-brand-primary, #4aa3ff)' },
                    },
                    t('polish')
                  )
                : null
            )
          : null;
        return createPortal(h('div', null, pill, bubble), document.body);
      }

      const panel = h(
        'div',
        {
          'data-dsh-prompt-stash': 'panel',
          ref: panelRef,
          onPointerDown: remember,
          style: {
            position: 'fixed',
            right: Math.min(pos.right, Math.max(4, window.innerWidth - 344)),
            bottom: pos.bottom + 32,
            width: 320,
            maxHeight: 360,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3))',
            background: 'var(--dsw-alias-bg-layer-1, #1c1c1e)',
            color: 'var(--dsw-alias-label-primary, #eee)',
            boxShadow: '0 6px 24px rgba(0,0,0,.18)',
            overflow: 'hidden',
            zIndex: 61,
            fontSize: 13,
          },
        },
        h(
          'div',
          { style: { display: 'flex', gap: 6, alignItems: 'center', padding: '8px 10px 6px' } },
          h(
            'span',
            { style: { fontWeight: 600 } },
            t('title')
          ),
          h('span', { style: { flex: 1 } }),
          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #888)' } }, t('count').replace('{n}', String(scopeCount)))
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 4, padding: '0 10px 6px' } },
          workspaceId ? tabBtn(t('tabWorkspace'), scope === 'workspace', () => pick('workspace'), btnStyle) : null,
          tabBtn(t('tabGlobal'), scope === 'global', () => pick('global'), btnStyle)
        ),
        h('input', {
          ref: searchRef,
          value: q,
          onChange: (e) => setQ(e.target.value),
          placeholder: t('search'),

          style: {
            margin: '0 10px 6px',
            padding: '5px 8px',
            borderRadius: 6,
            border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3))',
            background: 'var(--dsw-alias-bg-base, transparent)',
            color: 'inherit',
            fontSize: 12,
            outline: 'none',
          },
        }),
        h(
          'div',
          { style: { overflowY: 'auto', flex: 1, minHeight: 40 } },
          polish
            ? h(
                'div',
                { style: { padding: '8px 10px' } },
                h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #888)', marginBottom: 4 } }, t('polishOriginal')),
                h(
                  'div',
                  {
                    style: {
                      maxHeight: 84,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      fontSize: 12,
                      marginBottom: 8,
                      color: 'var(--dsw-alias-label-secondary, #999)',
                    },
                  },
                  polish.original
                ),
                h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #888)', marginBottom: 4 } }, t('polishResult')),
                h(
                  'div',
                  {
                    style: {
                      maxHeight: 120,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      fontSize: 12,
                      marginBottom: 8,
                    },
                  },
                  polish.busy
                    ? t('polishing')
                    : polish.failed
                      ? polish.code === 'too-long'
                        ? t('polishTooLong')
                        : polish.code === 'no-model'
                          ? t('polishNoModel')
                          : t('polishFail')
                      : polish.unchanged
                        ? t('polishSame')
                        : polish.result
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
                  h('button', { type: 'button', onClick: () => setPolish(null), style: btnStyle }, t('discard')),
                  polish.busy
                    ? null
                    : h(
                        'button',
                        { type: 'button', onClick: () => startPolish(polish.id, polish.original), style: btnStyle },
                        t('retry')
                      ),
                  polish.result && !polish.unchanged
                    ? h(
                        'button',
                        {
                          type: 'button',
                          onClick: acceptPolish,
                          style: {
                            ...btnStyle,
                            border: '1px solid var(--dsw-alias-brand-primary, #4aa3ff)',
                            color: 'var(--dsw-alias-brand-primary, #4aa3ff)',
                            padding: '3px 8px',
                          },
                        },
                        t('accept')
                      )
                    : null
                )
              )
            : rows.length === 0
            ? h(
                'div',
                { style: { padding: '10px' } },
                h(
                  'p',
                  { style: { margin: 0, color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 12 } },
                  q ? t('emptySearch') : t('empty')
                ),
                showOther
                  ? h(
                      'button',
                      {
                        type: 'button',
                        onClick: () => setScope(otherScope),
                        style: { ...btnStyle, padding: '2px 0', fontSize: 12, color: 'var(--dsw-alias-brand-primary, #4aa3ff)' },
                      },
                      t('emptyOther')
                        .replace('{tab}', otherScope === 'global' ? t('tabGlobal') : t('tabWorkspace'))
                        .replace('{n}', String(otherCount))
                    )
                  : null
              )
            : rows.map((e, i) =>
                h(
                  'div',
                  {
                    key: e.id,
                    role: 'button',
                    tabIndex: 0,
                    title: e.text.length > 80 ? e.text.slice(0, 300) : e.text,
                    onKeyDown: (ev) => {
                      if (ev.key === 'Enter') insert(e, ev.altKey);
                    },
                    onClick: (ev) => {
                      if (ev.detail > 1) return;
                      insert(e, ev.altKey);
                    },
                    style: {
                      padding: '6px 10px',
                      cursor: 'pointer',
                      borderTop: '1px solid transparent',
                      display: 'flex',
                      gap: 6,
                      alignItems: 'baseline',
                      background: i === active ? 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.2))' : 'transparent',
                      boxShadow: i === active ? 'inset 2px 0 0 var(--dsw-alias-brand-primary, #4aa3ff)' : 'none',
                    },
                    onMouseEnter: (ev) => {
                      setActive(i);
                      ev.currentTarget.style.background = 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1))';
                    },
                    onMouseLeave: (ev) => {
                      if (rows[active] && rows[active].id !== e.id) ev.currentTarget.style.background = 'transparent';
                    },
                  },
                  h(
                    'span',
                    { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    rowLabel(e.text)
                  ),
                  h('span', { style: { color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 11 } }, shortTime(e.usedAt || e.createdAt)),
                  e.scope === 'workspace' || workspaceId
                    ? h(
                        'button',
                        {
                          type: 'button',
                          title: e.scope === 'workspace' ? t('moveToGlobal') : t('moveToWorkspace'),
                          onClick: (ev) => {
                            ev.stopPropagation();
                            moveEntry(e, e.scope === 'workspace' ? 'global' : 'workspace');
                          },
                          style: { ...btnStyle, opacity: 0.55, padding: '0 2px' },
                        },
                        '⇄'
                      )
                    : null,
                  e.source !== 'reply' && e.text.length >= 8
                    ? h(
                        'button',
                        {
                          type: 'button',
                          title: t('polish'),
                          onClick: (ev) => {
                            ev.stopPropagation();
                            startPolish(e.id, e.text);
                          },
                          style: { ...btnStyle, opacity: 0.55, padding: '0 2px' },
                        },
                        '✦'
                      )
                    : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      title: t('del'),
                      onClick: (ev) => {
                        ev.stopPropagation();
                        remove(e.id);
                      },
                      style: { ...btnStyle, opacity: 0.5, padding: '0 2px' },
                    },
                    '×'
                  )
                )
              )
        ),
        h(
          'div',
          {
            style: {
              padding: '6px 10px',
              fontSize: 11,
              color: 'var(--dsw-alias-label-secondary, #888)',
              borderTop: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18))',
              display: 'flex',
              gap: 6,
            },
          },
          h('span', null, rows.length > 1 ? t('insertHint') : t('insertHintOne')),
          h('span', { style: { flex: 1 } }),
          flash
            ? h(
                'span',
                { style: { color: 'var(--dsw-alias-brand-primary, #4aa3ff)' } },
                flash.text,
                flash.moveable
                  ? h(
                      'button',
                      { type: 'button', onClick: moveToGlobal, style: { ...btnStyle, marginLeft: 6, color: 'inherit' } },
                      t('move')
                    )
                  : null,
                flash.polishId
                  ? h(
                      'button',
                      {
                        type: 'button',
                        onClick: (ev) => {
                          ev.stopPropagation();
                          const entry = (data.entries || []).find((x) => x.id === flash.polishId);
                          if (entry) startPolish(entry.id, entry.text);
                        },
                        style: { ...btnStyle, marginLeft: 6, color: 'inherit' },
                      },
                      t('polish')
                    )
                  : null
              )
            : h('span', null, t('countTotal').replace('{n}', String(total)))
        )
      );

      return createPortal(h('div', null, pill, panel), document.body);
    }

    const btnStyle = {
      background: 'transparent',
      border: 'none',
      color: 'inherit',
      fontSize: 12,
      cursor: 'pointer',
      padding: '2px 4px',
      borderRadius: 4,
    };

    function tabBtn(label, active, onClick, style) {
      return h(
        'button',
        {
          type: 'button',
          onClick,
          style: {
            ...style,
            background: active ? 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.18))' : 'transparent',
            color: active ? 'var(--dsw-alias-label-primary, #eee)' : 'var(--dsw-alias-label-secondary, #888)',
            padding: '3px 8px',
          },
        },
        label
      );
    }

    // "Save this reply": the action row only knows the message id, so the text
    // comes from the host route that reads the session log.
    function ReplySaveAction(props) {
      const t = props.t;
      const [busy, setBusy] = useState(false);
      const workspaceId = workspaceOf(props);
      const onClick = async (ev) => {
        ev.stopPropagation();
        if (busy) return;
        setBusy(true);
        try {
          const r = await api(
            '/message?session=' + encodeURIComponent(String(props.sessionId || '')) + '&id=' + encodeURIComponent(String(props.messageId || ''))
          );
          if (r.ok && r.json && r.json.text) {
            await api('/mutate', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                op: 'save',
                text: r.json.text,
                title: deriveTitle(r.json.text),
                scope: workspaceId ? 'workspace' : 'global',
                workspaceId,
                source: 'reply',
              }),
            });
          }
        } finally {
          setBusy(false);
        }
      };
      return h(
        'button',
        {
          type: 'button',
          title: t('saveReply'),
          onClick,
          style: { ...btnStyle, opacity: busy ? 0.5 : 0.75 },
        },
        '⤓'
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-prompt-stash locale');
        const t = ctx.locale.bind(NS);
        const Bound = (props) => h(Pocket, { ...props, t });
        ctx.slots.inject('conversation.input.overlay', () =>
          ctx.slots.register({ name: 'conversation.input.overlay', id: 'dsh-prompt-pocket', order: 20 }, Bound)
        );
        const ReplyBound = (props) => h(ReplySaveAction, { ...props, t });
        ctx.slots.inject('conversation.chat.assistant-actions', () =>
          ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: 'prompt-stash', order: 30 }, ReplyBound)
        );
      },
    };
  },
});
