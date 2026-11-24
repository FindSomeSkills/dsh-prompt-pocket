window.__ModuleLoader__.load({
  id: 'dsh-prompt-stash',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;
    const { useState, useEffect, useRef, useMemo, useCallback } = React;

    const EP = '/dsh-prompt-stash';
    const POS_KEY = 'dsh-prompt-stash.pos';
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
      insertHint: '回车插入，Alt+回车替换全文',
      del: '删掉',
      fail: '操作失败',
      saveEmpty: '没有可存的内容',
      saving: '存…',
      count: '{n} 条',
      saveReply: '存为提示词',
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
      insertHint: 'Enter inserts, Alt+Enter replaces the draft',
      del: 'Delete',
      fail: 'That did not work',
      saveEmpty: 'Nothing to save',
      saving: 'Saving…',
      count: '{n} saved',
      saveReply: 'Save as prompt',
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
          const wantScope = workspaceId ? 'workspace' : 'global';
          const r = await api('/mutate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              op: 'save',
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
              until: Date.now() + 2600,
              moveable: wantScope === 'workspace',
            });
            if (r.json.entries) setData(r.json);
            else load();
          } else {
            setFlash({ text: t('fail'), until: Date.now() + 2000 });
          }
        },
        [draft, workspaceId, load, t]
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

      const total = (data.counts && (data.counts.global + data.counts.workspace)) || 0;

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

      if (!open) return createPortal(pill, document.body);

      const panel = h(
        'div',
        {
          'data-dsh-prompt-stash': 'panel',
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
          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #888)' } }, t('count').replace('{n}', String(total)))
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 4, padding: '0 10px 6px' } },
          workspaceId ? tabBtn(t('tabWorkspace'), scope === 'workspace', () => setScope('workspace'), btnStyle) : null,
          tabBtn(t('tabGlobal'), scope === 'global', () => setScope('global'), btnStyle)
        ),
        h('input', {
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
          rows.length === 0
            ? h('p', { style: { margin: '10px', color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 12 } }, q ? t('emptySearch') : t('empty'))
            : rows.map((e) =>
                h(
                  'div',
                  {
                    key: e.id,
                    role: 'button',
                    tabIndex: 0,
                    onKeyDown: (ev) => {
                      if (ev.key === 'Enter') insert(e, ev.altKey);
                    },
                    onClick: (ev) => insert(e, ev.altKey),
                    style: {
                      padding: '6px 10px',
                      cursor: 'pointer',
                      borderTop: '1px solid transparent',
                      display: 'flex',
                      gap: 6,
                      alignItems: 'baseline',
                    },
                    onMouseEnter: (ev) => {
                      ev.currentTarget.style.background = 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1))';
                    },
                    onMouseLeave: (ev) => {
                      ev.currentTarget.style.background = 'transparent';
                    },
                  },
                  h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.title || e.text.slice(0, 40)),
                  h('span', { style: { color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 11 } }, shortTime(e.usedAt || e.createdAt)),
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
          h('span', null, t('insertHint')),
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
                  : null
              )
            : h('span', null, t('count').replace('{n}', String(total)))
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
                title: r.json.title,
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
          ctx.slots.register({ name: 'conversation.input.overlay', id: 'dsh-prompt-stash', order: 20 }, Bound)
        );
        const ReplyBound = (props) => h(ReplySaveAction, { ...props, t });
        ctx.slots.inject('conversation.chat.assistant-actions', () =>
          ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: 'prompt-stash', order: 30 }, ReplyBound)
        );
      },
    };
  },
});
