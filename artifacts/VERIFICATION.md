# 重启后验证记录（2026-11-25 03:05）

重启由外部计划任务执行（02:59:09），会话中断一次，宿主 10 秒后恢复（pid 14880）。

## 机器能验的，全过了

| 项 | 结果 | 依据 |
| --- | --- | --- |
| 宿主恢复 | PASS | 02:59:25 端口 2081 监听，pid 14880 |
| `/state` | PASS | 200，`cap: 500`，返回现有条目 |
| 保存 / 删除 | PASS | 脚本内置自检，写一条再删一条 |
| `/polish` 真实调用 | PASS | 200，模型返回内容；另跑一次输出 33 字，语义保留、无扩写 |
| `prompt_stash` 工具 | PASS | 重启后工具出现在工具表；list / save / search / remove 我逐项调用过 |
| 工具返回值 | PASS | 无 `undefined` 字段，lossless JSON 校验通过（0.2.0 修的就是这个） |
| 回复正文 `/message` | PASS | 用本会话一条 221 字的回复，返回原文 Markdown，200 |
| 只有工具调用的回复 | PASS（按设计 404） | 取不到纯文本时明说找不到，不编造 |
| 分档隔离 | PASS | 存 `ws-selftest` 的条目，无 workspace 的查询看不见 |
| 客户端槽位 | PASS | `conversation.input.overlay` 有 `dsh-prompt-stash`（order 20），`conversation.chat.assistant-actions` 有 `prompt-stash`（order 30） |
| 安装版本 | PASS | profile 里 0.2.0，`index.js` / `client.js` 与仓库逐字节一致 |
| 本地三套测试 | PASS | 宿主 17、客户端 6、文档 6、打包 1 |

## 第一次运行的瑕疵

脚本在 polish 之后被 console 信号结束（`0xC000013A` / STATUS_CONTROL_C_EXIT），日志缺最后两行汇总。前面 4 条 PASS 都写进了日志。

原因是 `schtasks /run` 让新宿主继承了脚本的控制台。已改成 `Start-Process -WindowStyle Hidden -Wait`，并加了一行无论如何都会写的 `done: failures=N`。

## 机器验不了的

- 圆点是否真的画在右下角、透明度是否合适、拖动是否跟手
- 面板展开后的排版、插入后光标落点、拖动后是否误触
- 截图（页面要带 token 的地址，我这边没有）

这三项需要人眼，或把带 token 的 GUI 地址给我，我用 Playwright 开页面截。

## 现场状态

`~/.dsh/dsh-prompt-stash/store.json` 里 1 条（自检时手存的那条「日报压缩」），脚本写的自检条目已删除。
