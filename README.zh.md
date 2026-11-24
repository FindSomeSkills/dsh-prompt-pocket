# dsh-prompt-stash

**浮在 DeepSeek Harness 角落的提示词口袋。** 按 `Ctrl+Shift+S`，正在打的草稿就存进去了；点一条，它回到光标处。

**界面里不多出任何东西**——没有侧栏入口，没有输入框上方那排胶囊，没有会挤压对话的面板。只有一枚 24px 的圆点，能拖到任何位置。

## 安装

```bash
dsh plugin --profile web add dsh-prompt-stash
```

重启一次宿主，然后按 `Ctrl+Shift+R` 强制刷新页面。

## 用法

| 动作 | 按键 |
| --- | --- |
| 存选区；没选中时存整段草稿 | `Ctrl+Shift+S` |
| 打开口袋 | `Ctrl+Shift+P` |
| 把一条插到光标处 | 选中后 `Enter` |
| 用这条替换整段草稿 | `Alt+Enter` |

两个抽屉：**此项目**（同一个 workspace 下的所有会话）、**通用**（到哪儿都在）。保存从不弹窗。

## 数据

`$DSH_HOME/dsh-prompt-stash/store.json`——单文件，原子写，最多 500 条，满了先淘汰最久没用的。

模型通过 `prompt_stash` 工具读写同一个口袋。

## 许可

MIT
