# CodeMirror 幽灵文本插件运行机制

这份笔记讲的是项目里的自定义 CodeMirror 幽灵文本插件，也就是编辑器里自动出现的灰色 AI 补全建议。

核心源码在：

- `src/features/editor/components/code-editor.tsx`
- `src/features/editor/extensions/suggestion/index.ts`
- `src/features/editor/extensions/suggestion/fetcher.ts`
- `src/app/api/suggestion/route.ts`

## 1. 插件是怎么装进编辑器的

入口在 `CodeEditor` 组件里。

`src/features/editor/components/code-editor.tsx` 创建 `EditorView` 时，把 `suggestion(fileName)` 放进了 CodeMirror 的 `extensions` 数组：

```ts
extensions: [
  oneDark,
  customTheme,
  customSetup,
  languageExtension,
  suggestion(fileName),
  quickEdit(fileName),
  selectionTooltip(),
  keymap.of([indentWithTab]),
  minimap(),
  indentationMarkers(),
]
```

所以这个幽灵文本功能不是 React 在 JSX 里直接渲染出来的，而是作为 CodeMirror extension 注册进去的。

`suggestion(fileName)` 返回的是一个扩展数组：

```ts
export const suggestion = (fileName: string) => [
  suggestionState,
  createDebouncePlugin(fileName),
  renderPlugin,
  acceptSuggestionKeymap,
];
```

这四个东西分别负责：

- `suggestionState`：保存当前 AI 建议文本。
- `createDebouncePlugin(fileName)`：监听输入和光标变化，延迟请求 AI 建议。
- `renderPlugin`：把建议文本画成编辑器里的灰色幽灵文本。
- `acceptSuggestionKeymap`：按 `Tab` 时把建议插入真实文档。

## 2. 状态：用 StateField 保存建议

插件先定义了一个 `StateEffect`：

```ts
const setSuggestionEffect = StateEffect.define<string | null>();
```

可以把 `StateEffect` 理解成一次编辑器事务里的“消息”。这里的消息含义是：请把当前建议改成某个字符串，或者改成 `null`。

然后用 `StateField` 存储建议：

```ts
const suggestionState = StateField.define<string | null>({
  create() {
    return null;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSuggestionEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});
```

它的逻辑很简单：

- 编辑器刚创建时，建议是 `null`。
- 每次 CodeMirror transaction 发生时，检查有没有 `setSuggestionEffect`。
- 如果有，就用 effect 里的值更新建议。
- 如果没有，就保持旧值。

也就是说，插件不会直接改全局变量来控制显示内容，而是通过 CodeMirror 自己的状态系统保存建议。

## 3. 触发：输入或移动光标后延迟请求

`createDebouncePlugin(fileName)` 用 `ViewPlugin.fromClass` 创建了一个视图插件。

它有两个触发点：

```ts
constructor(view: EditorView) {
  this.triggerSuggestion(view);
}

update(update: ViewUpdate) {
  if (update.docChanged || update.selectionSet) {
    this.triggerSuggestion(update.view);
  }
}
```

含义是：

- 编辑器初始化时，请求一次建议。
- 文档变化时，请求建议。
- 光标或选区变化时，也请求建议。

真正请求前有 300ms 防抖：

```ts
const DEBOUNCE_DELAY = 300;
```

每次触发都会：

1. 清掉旧的 `debounceTimer`。
2. abort 掉上一次还没完成的请求。
3. 标记 `isWaitingForSuggestion = true`。
4. 300ms 后重新生成 payload 并请求后端。

这能避免用户连续输入时每个字符都打一次接口。

## 4. 请求参数：只取光标附近上下文

请求前会调用 `generatePayload(view, fileName)`。

它从 CodeMirror 的 `view.state` 里拿这些信息：

- 当前完整文件内容：`code`
- 当前光标位置：`selection.main.head`
- 当前行：`currentLine`
- 光标在当前行内的位置：`cursorInLine`
- 当前行前 5 行：`previousLines`
- 当前行后 5 行：`nextLines`
- 光标前文本：`textBeforeCursor`
- 光标后文本：`textAfterCursor`
- 文件名：`fileName`
- 行号：`lineNumber`

这些信息会被发给 `/api/suggestion`，让模型知道“光标在哪里、上下文是什么、前后已经有什么代码”。

## 5. 前端 fetcher：校验后调用接口

`src/features/editor/extensions/suggestion/fetcher.ts` 负责真正请求接口。

它做了三件事：

1. 用 zod 校验请求 payload。
2. 用 `ky.post("/api/suggestion")` 请求后端。
3. 用 zod 校验响应，返回 `suggestion` 字符串。

如果请求被 abort，直接返回 `null`。如果是其他错误，就 toast 提示：

```ts
toast.error("Failed to fetch AI completion");
```

## 6. 后端接口：调用 AI 生成补全

接口在 `src/app/api/suggestion/route.ts`。

它的流程是：

1. 用 Clerk 的 `auth()` 检查用户登录状态。
2. 读取前端传来的代码上下文。
3. 把上下文填进 `SUGGESTION_PROMPT`。
4. 调用 AI SDK 的 `generateText()`。
5. 用结构化输出要求模型返回：

```ts
{
  suggestion: string
}
```

当前模型是：

```ts
anthropic("claude-3-7-sonnet-20250219")
```

prompt 里有几个关键约束：

- 如果后面的 `next_lines` 已经继续写了代码，就返回空字符串。
- 如果光标前已经是完整语句，比如以 `;`、`}`、`)` 结尾，就返回空字符串。
- 返回值只应该是“要插入到光标处的新文本”，不能重复文件里已经有的内容。

后端最后返回：

```ts
return NextResponse.json({ suggestion: output.suggestion })
```

## 7. 回写状态：dispatch effect

前端拿到 AI 建议后，不是直接操作 DOM，而是 dispatch 一个 CodeMirror transaction：

```ts
view.dispatch({
  effects: setSuggestionEffect.of(suggestion),
});
```

这个 effect 会被前面的 `suggestionState.update()` 捕获，于是 `suggestionState` 里的值就变成了新的建议。

如果建议为空或请求失败，就等价于把建议设为 `null`。

## 8. 渲染：用 Decoration.widget 画幽灵文本

`renderPlugin` 负责把状态里的建议显示出来。

它会在这些情况下重新构建 decorations：

- 文档内容变化：`update.docChanged`
- 光标变化：`update.selectionSet`
- 建议状态变化：检测 transaction 里有没有 `setSuggestionEffect`

构建时先判断：

```ts
if (isWaitingForSuggestion) {
  return Decoration.none;
}

const suggestion = view.state.field(suggestionState);
if (!suggestion) {
  return Decoration.none;
}
```

也就是说：

- 正在请求时，不显示旧建议。
- 没有建议时，不显示任何东西。

有建议时，它会在当前光标位置创建一个 widget decoration：

```ts
Decoration.widget({
  widget: new SuggestionWidget(suggestion),
  side: 1,
}).range(cursor)
```

`side: 1` 表示这个 widget 显示在光标后面。

真正的 DOM 由 `SuggestionWidget` 创建：

```ts
class SuggestionWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.text;
    span.style.opacity = "0.4";
    span.style.pointerEvents = "none";
    return span;
  }
}
```

所以“幽灵文本”的本质是一个 CodeMirror widget decoration。它看起来像文本，但不在真实文档里。

## 9. 接收建议：Tab 插入真实文档

`acceptSuggestionKeymap` 注册了一个 `Tab` 快捷键：

```ts
const acceptSuggestionKeymap = keymap.of([
  {
    key: "Tab",
    run: (view) => {
      const suggestion = view.state.field(suggestionState);
      if (!suggestion) {
        return false;
      }

      const cursor = view.state.selection.main.head;
      view.dispatch({
        changes: { from: cursor, insert: suggestion },
        selection: { anchor: cursor + suggestion.length },
        effects: setSuggestionEffect.of(null),
      });
      return true;
    },
  },
]);
```

这里有一个重要细节：

- 没有建议时，返回 `false`，CodeMirror 会继续交给其他 Tab 处理，比如缩进。
- 有建议时，返回 `true`，表示这个 Tab 已经被插件处理了。

接收建议时做三件事：

1. 在光标处插入 suggestion。
2. 把光标移动到插入文本末尾。
3. 用 `setSuggestionEffect.of(null)` 清空幽灵文本。

## 10. 一次完整运行链路

从用户输入一个字符开始，完整链路是：

1. 用户在 CodeMirror 里输入内容。
2. CodeMirror 产生一次 transaction，`docChanged` 为 true。
3. `createDebouncePlugin.update()` 被调用。
4. 插件清理旧 timer，abort 旧请求，启动新的 300ms timer。
5. timer 到点后，`generatePayload()` 从编辑器状态提取上下文。
6. `fetcher()` 请求 `/api/suggestion`。
7. 后端检查登录态，拼 prompt，调用 AI。
8. 后端返回 `{ suggestion: "..." }`。
9. 前端 `view.dispatch({ effects: setSuggestionEffect.of(suggestion) })`。
10. `suggestionState` 保存新建议。
11. `renderPlugin` 检测到 suggestion effect，重建 decorations。
12. `Decoration.widget` 在光标后渲染 `SuggestionWidget`。
13. 用户看到灰色幽灵文本。
14. 用户按 `Tab`。
15. `acceptSuggestionKeymap` 把建议插入真实文档，并清空建议状态。

## 11. 为什么用 Decoration，而不是直接改 DOM

CodeMirror 的文档、选区、渲染都是由它自己的状态系统控制的。如果直接操作 DOM，很容易和 CodeMirror 的重新渲染冲突。

这里用 `Decoration.widget` 的好处是：

- 它不会污染真实代码内容。
- 它会跟随光标和文档更新。
- 它能被 CodeMirror 正确销毁和重建。
- 它可以通过 keymap 在需要时变成真实文本。

所以这个实现符合 CodeMirror 的扩展模型：状态存在 `StateField`，界面通过 `Decoration` 渲染，用户操作通过 `keymap` 转成 transaction。

## 12. 需要注意的小问题

这个插件有几个可以继续优化的点：

1. `debounceTimer`、`isWaitingForSuggestion`、`currentAbortController` 是模块级变量。如果页面上同时存在多个编辑器实例，它们会共享这些变量，可能互相影响。
2. `suggestion(fileName)` 依赖文件名，但 `CodeEditor` 的 effect 只依赖 `languageExtension`。如果文件名变化但语言扩展没有变化，旧 editor 不一定会重建。
3. 正在等待建议时使用全局 `isWaitingForSuggestion` 控制渲染，多个编辑器实例下也可能互相影响。
4. AI 返回的 suggestion 没有在前端再次判断是否和 `textAfterCursor` 重复，主要依赖 prompt 约束。

如果只考虑当前项目里单个主编辑器的场景，这个实现已经能跑通。理解它时抓住一句话就够了：

> 输入触发 ViewPlugin 请求 AI，AI 结果通过 StateEffect 写进 StateField，渲染插件把 StateField 里的文本变成光标后的 Decoration.widget，Tab 再把 widget 文本插入真实文档。
