# dsh-prompt-stash

**A pocket, not a library.** One 24px dot in the corner. Press `Ctrl+Shift+S` and the draft you were already typing is saved; click a row and it drops back at your caret.

**Nothing new appears in the layout.** No sidebar entry, no row of chips above the composer, no panel that shifts the conversation. The dot does not take part in layout at all — it floats, and it drags.

## Saving

| You do this | It saves |
| --- | --- |
| Select text, `Ctrl+Shift+S` | that selection |
| No selection, `Ctrl+Shift+S` | the whole draft, without copying first |
| Click ⤓ on an assistant reply | that reply's Markdown, verbatim |

**Saving never opens a dialog.** The dot blinks, the count goes up, and you keep typing. A two-second line under it says where it landed and offers to move it.

## Where it lands

Two drawers:

- **This project** — visible to every session in the same workspace. Paths, client names and half-written context belong here.
- **General** — visible everywhere.

Workspace scoping is by workspace, not by session: sessions get archived and forked, and a prompt pinned to one session would lose its home. A bare session with no workspace falls back to General without an empty tab.

## Using one

Click the dot (or `Ctrl+Shift+P`). Type to filter, `Enter` inserts at the caret, `Alt+Enter` replaces the whole draft.

**The insert is one undo step and does not touch the rest of the draft.** It goes through the composer's revision-guarded insert, so a quote chip or an attachment you already had stays where it is.

## Writing a DSH prompt, when you ask for it

**Nothing is rewritten on save.** The two-second chip after a save has a «Write a DSH prompt» button, and every non-reply row has ✦. Until you click one, the text stays exactly as you typed it.

What comes back is not a prettier version of your sentence. **It is a prompt written for DSH**: the goal in one line, the context and paths you mentioned, ordered steps or constraints, and the shape of the answer you expect. Your `{{variables}}`, paths, URLs and code blocks are kept byte-for-byte, and nothing you did not state gets invented.

You get the original and the generated prompt side by side, then choose: use this one, discard, or try again. Accepting keeps the old text in `prior`. **A failed or empty result never replaces anything** — the original stays and the line says so. If the input is already an executable prompt, it comes back unchanged and the panel says so instead of pretending to work.

Replies saved from the chat are marked as source material and get no ✦: you kept them verbatim on purpose.

The generation runs on your current default model.

## Limits

**500 prompts. When it is full, the least recently used one goes.** No dialog, no growing list of things you never open again.

`$DSH_HOME/dsh-prompt-stash/store.json`, one file, atomic write. A damaged file is renamed to `.corrupt-<timestamp>.bak` and replaced with an empty pocket.

The agent can read and write the same pocket through the `prompt_stash` tool, so "save that as a prompt" works without a copy-paste.

## Requirements

- DeepSeek Harness `>= 0.2.0-rc.1`, Web profile: the pocket renders inside the composer and needs the conversation slot
- Windows, macOS and Linux run the same code
- The Desktop client is untested

## What it does not do

**No tags, no folders, no import wizard, no recycle bin.** Each of those needs a panel, and a panel needs a decision every time you save. This one is built so there is nothing to decide.
