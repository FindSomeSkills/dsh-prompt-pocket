# 两个关键接口的验证（2026-11-25 02:45）

结论：**两个都能做，但不是按我原来设想的接口做。** 下面每条给出依据文件和签名。

## 一、从回复存提示词：能做，走宿主侧读会话事件

客户端 `assistant-actions` 只给 `messageId`，不给正文。实测依据：

- 槽位源码：`dsh-client-ui-chat/lib/client.js` 里渲染动作行时传的是 `{ messageId }`，没有 message 对象
- ChatStore 只有 `turnProcesses`，不能按 id 取消息（`dsh-client-ui-chat/lib/types/client/stores.d.ts`）

宿主侧可以取到，链路完整：

1. `ctx.sessions.get(sessionId)` 拿 live session（`sessions` 服务，签名 `get(id: SessionId): Session | undefined`）
2. `session.snapshotEvents()` / `session.surface.nodes` 遍历事件
3. `assistant/message` 事件的 `data.message` 是 `AssistantMessage extends MessageBase`，字段 `id: MessageId` + `content: ContentBlock[]`（`dsh-llm/lib/types/message.d.ts:124`）
4. 按 `message.id === messageId` 取 `content` 里的 `text` 块拼成 Markdown

我还在本机会话日志里直接验证过这个结构：`assistant/message` 的 `message` 键正是 `['role','content','source','id']`，id 形如 `f2718b6d-…`。

所以插件要加一条宿主路由：`GET /dsh-prompt-stash/message?session=<id>&id=<messageId>`，客户端动作按钮调它，拿回原文再存。多一个路由，不多依赖。

残留风险：`content` 是「面向模型的 blocks」，不是渲染后的 HTML。若回复里混了工具调用块，只取 `type: 'text'` 的块，跳过其余，拼出来就是 Markdown 原文。

## 二、插入草稿：能做，而且 DSH 就是为这个场景设计的

我上一版想的是「读草稿 + 拼接 + setDraft」，那样会把光标顶到末尾、还把撤销记录拆成两步。契约里有更对的接口：

```ts
// dsh-client-ui-conversation/src/client/contract/input.ts:264
captureInsertion(): TokenSpan          // 272 行：带修订号的当前选区副本
insertText(text: string, span: TokenSpan): boolean   // 280 行：
  // Insert asynchronous text without replacing subsequent edits or reference chips.
  // @param span - captured selection and draft revision.
setDraft(text: string): void           // 281 行：整体替换，只在「Alt 覆盖」时用
focus(): void                          // 221 行
```

`focus()` 的注释写得很直白：*"callers that took focus away from it (an overlay that held its own)"*——这正是浮层点一下、焦点被拿走、再还回去的场景。DSH 自己已经把这个用例写进契约了。

插入链路：

1. 圆点 `pointerdown` 时（还没抢焦点）调 `captureInsertion()` 存 span
2. 点条目 → `insertText(text, span)`，一步撤销，插入到原光标处，不动后面的引用 chip
3. 若 `insertText` 返回 false（草稿在面板打开期间被改过，修订号对不上），退到 `setDraft(原文 + "\n\n" + 新内容)`，光标落末尾
4. 调 `focus()` 把键盘还给输入框

`insertText` 内部是 `insertAsyncText(span, text)` → `$replaceDetectSpanWithText`，只替换捕获的 span，不重建文档，所以不会把整段文字挪位。

## 三、没验证的部分

- **只查了契约和实现，没有在页面里跑过。** 要真跑得装插件进 profile 或重启宿主，按第 0 条没做。
- `focus()` 恢复后光标落在插入点之后还是停在末尾：契约没写死，需要实装后肉眼确认一次。
- 面板打开时草稿被别的入口改过（比如模型插入引用 chip），`insertText` 会返回 false，退路是否体面要实测。

## 四、对设计的影响

1. 存回复要加宿主路由，插件从「纯客户端」变成「客户端 + 宿主半」，和 dsh-todo-bar 同构，成本可控。
2. 插入改用 `captureInsertion` + `insertText`，不再用「读全文 + setDraft」；这让「不打断」从「靠拼字符串」变成「靠 DSH 的修订号保护」。
3. `pointerdown` 取 span 这一点必须写进实现，否则点圆点那一瞬间焦点已经走了，span 可能取不到。
