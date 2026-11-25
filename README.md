# dsh-prompt-pocket

**A prompt pocket for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): one keystroke saves what you were typing, one click puts it back at the caret.** It lives as a 24px dot in the corner, so the layout never grows a sidebar, a chip row, or a panel that shifts the conversation.

![The prompt pocket open over a session: a search box, two drawers, three saved prompts and the dot in the corner](https://raw.githubusercontent.com/FindSomeSkills/dsh-prompt-pocket/main/docs/images/en-panel.png)

Site: **[dshtoolbox.com/plugins/dsh-prompt-pocket](https://www.dshtoolbox.com/plugins/dsh-prompt-pocket/)** · 中文页: [dshtoolbox.com/zh/plugins/dsh-prompt-pocket](https://www.dshtoolbox.com/zh/plugins/dsh-prompt-pocket/) · npm: [dsh-prompt-pocket](https://www.npmjs.com/package/dsh-prompt-pocket)

## Why it exists

Prompt libraries ask for a title, tags, a folder and a panel before they will keep a sentence. By then you have forgotten the sentence. This one keeps the sentence.

## What it does that others do not

- **`Ctrl+Shift+S` saves without a dialog.** The selection if there is one, the whole draft otherwise. No title, no tags, no “where should this go”.
- **The confirmation appears beside the dot even when the panel is closed** — with a one-click move to the other drawer and a button to rewrite the prompt.
- **Insert is revision-guarded, not string concatenation.** A quote chip or attachment you already had stays where it is, the insert is one undo step, and focus returns to the composer.
- **Two drawers split by workspace, not by session.** Sessions get archived and forked; a prompt pinned to one session loses its home. A bare session falls back to General instead of showing an empty drawer.
- **✦ writes a DSH prompt, it does not paraphrase.** Variables, paths, URLs and code blocks are kept byte-for-byte, nothing is invented, and filler is forbidden by the instruction. A failed or empty result never replaces your text; accepting a rewrite keeps the old one in `prior`.
- **One click on an assistant reply keeps it verbatim** as source material, read from the session log — text blocks only, tool calls never leak in.
- **The agent shares the same pocket** through the `prompt_stash` tool, scoped to the drawers so one project's prompts do not show up in another's answer.
- **Sync through your own private git repository, automatically.** The host pulls on launch, when the panel opens after a stale gap, and every five minutes; each change is pushed three seconds after you make it. The panel pushes each change and merges the remote on launch; prompts are one file each, so a merge keeps both sides instead of corrupting one document. **A public repository is refused** — the plugin asks GitHub whether the repo is visible before it enables sync.
- **Export and import as one JSON file.** For machines without git, or for a backup before you trust a sync.
- **500 prompts, least recently used dropped, one JSON file, atomic writes, no runtime dependencies, no account.** Nothing leaves the machine except the one model call you explicitly ask for.

![The pocket collapsed to a faint dot in the corner of the composer](https://raw.githubusercontent.com/FindSomeSkills/dsh-prompt-pocket/main/docs/images/en-pill.png)

## Install

```bash
dsh plugin --profile web add dsh-prompt-pocket
```

Restart the host once so the route, the tool and the client bundle register, then force-reload the page with `Ctrl+Shift+R`. From a checkout instead:

```bash
git clone https://github.com/FindSomeSkills/dsh-prompt-pocket
cd dsh-prompt-pocket
dsh plugin --profile web add .
```

## Use

| Action | How |
| --- | --- |
| Save the selection or the draft | `Ctrl+Shift+S` |
| Open or close the pocket | `Ctrl+Shift+P`, or click the dot |
| Move the dot | Drag it; the position is remembered per browser |
| Insert a prompt at the caret | `Enter`, or click the row |
| Replace the whole draft | `Alt+Enter` while a row is selected |
| Walk the list | `↑` `↓` (wraps around), `Esc` closes |
| Move a prompt between drawers | `⇄` on the row |
| Delete | `×` on the row |
| Rewrite the prompt for DSH | `✦`, or the button on the save confirmation |
| Save an assistant reply | `⤓` in the reply action row |

## Where the data lives

`$DSH_HOME/dsh-prompt-stash/store.json`, by default `~/.dsh/dsh-prompt-stash/store.json`. One file for every profile and every browser pointed at this host; writes go through a temporary file and a rename, and a damaged file is renamed to `.corrupt-<timestamp>.bak` instead of blocking the panel.

## Requirements

DeepSeek Harness `>= 0.2.0-rc.1` and a Web profile — the pocket renders inside the composer. Windows, macOS and Linux run the same code; the interface language follows the DSH setting. The desktop client is untested.

## Links

- Product page: https://www.dshtoolbox.com/plugins/dsh-prompt-pocket/
- Chinese page: https://www.dshtoolbox.com/zh/plugins/dsh-prompt-pocket/
- npm: https://www.npmjs.com/package/dsh-prompt-pocket
- Manual: [docs/DETAIL.md](docs/DETAIL.md) (English) · [docs/DETAIL.zh.md](docs/DETAIL.zh.md) (中文)

MIT.
