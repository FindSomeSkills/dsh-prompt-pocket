# dsh-prompt-stash

**A prompt pocket that floats in the corner of DeepSeek Harness.** Press `Ctrl+Shift+S` and the draft you were already typing is saved. Click a row to put it back at your caret.

**It adds nothing to the layout** — no sidebar entry, no chip row above the composer, no panel that shifts the conversation. Just a 24px dot you can drag anywhere.

## Install

```bash
dsh plugin --profile web add dsh-prompt-stash
```

Restart the host once, then force-reload the page (`Ctrl+Shift+R`).

## Use

| Action | Key |
| --- | --- |
| Save selection, or the whole draft when nothing is selected | `Ctrl+Shift+S` |
| Open the pocket | `Ctrl+Shift+P` |
| Insert a prompt at the caret | `Enter` on a row |
| Replace the whole draft with it | `Alt+Enter` |

Two drawers: **This project** (every session in the same workspace) and **General** (everywhere). Saving never opens a dialog.

## Storage

`$DSH_HOME/dsh-prompt-stash/store.json` — one file, atomic write, 500 entries maximum, least recently used evicted first.

A `prompt_stash` tool lets the agent read and write the same pocket.

## License

MIT
