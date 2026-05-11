# CodeMirror 自定义 Quick Edit 插件运行机制

这份笔记讲 Polaris 项目中 CodeMirror 自定义 Quick Edit 插件是怎么运行的。它的效果是：用户选中一段代码后，可以点击 `Quick Edit` 或按 `Mod-k`，输入编辑指令，然后由 AI 返回修改后的代码并替换原选区。

相关源码：

- `src/features/editor/components/code-editor.tsx`
- `src/features/editor/extensions/selection-tooltip.ts`
- `src/features/editor/extensions/quick-edit/index.ts`
- `src/features/editor/extensions/quick-edit/fetcher.ts`
- `src/app/api/quick-edit/route.ts`

## 1. Quick Edit 是怎么接入 CodeMirror 的

入口在 `CodeEditor` 组件中。

`src/features/editor/components/code-editor.tsx` 创建 `EditorView` 时，把两个相关扩展放进了 `extensions` 数组：

```ts
extensions: [
  // ...
  quickEdit(fileName),
  selectionTooltip(),
  // ...
]
```

这里要注意：Quick Edit 的运行并不只靠 `quickEdit(fileName)`，它还和 `selectionTooltip()` 配合。

- `selectionTooltip()`：用户选中代码后，显示一个小浮层，里面有 `Add to Chat` 和 `Quick Edit` 按钮。
- `quickEdit(fileName)`：真正管理 Quick Edit 状态、输入框 tooltip、快捷键、提交 AI 编辑。

所以完整交互是：

1. 用户选中代码。
2. `selectionTooltip` 显示普通选择工具条。
3. 用户点击 `Quick Edit` 或按 `Mod-k`。
4. `quickEdit` 打开输入框 tooltip。
5. 用户输入指令并提交。
6. 请求 `/api/quick-edit`。
7. AI 返回修改后的代码。
8. 插件用 `view.dispatch({ changes })` 替换原选区。

## 2. 插件导出了什么

`src/features/editor/extensions/quick-edit/index.ts` 最后导出：

```ts
export const quickEdit = (fileName: string) => [
  quickEditState,
  quickEditTooltipField,
  quickEditKeymap,
  captureViewExtension,
];
```

虽然参数里有 `fileName`，但当前实现没有使用它。

这四个扩展分别负责：

- `quickEditState`：保存 Quick Edit 是否打开。
- `quickEditTooltipField`：根据状态决定是否显示输入框 tooltip。
- `quickEditKeymap`：注册 `Mod-k` 快捷键。
- `captureViewExtension`：捕获当前 `EditorView`，方便 tooltip DOM 事件里调用 `dispatch`。

## 3. 状态开关：showQuickEditEffect 和 quickEditState

Quick Edit 首先定义了一个状态更新消息：

```ts
export const showQuickEditEffect = StateEffect.define<boolean>();
```

可以把 `StateEffect` 理解为 CodeMirror transaction 中携带的“命令”。这里这个 effect 的意思是：

- `showQuickEditEffect.of(true)`：打开 Quick Edit。
- `showQuickEditEffect.of(false)`：关闭 Quick Edit。

真正保存状态的是 `quickEditState`：

```ts
export const quickEditState = StateField.define<boolean>({
  create() {
    return false;
  },

  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(showQuickEditEffect)) {
        return effect.value;
      }
    }
    if (transaction.selection) {
      const selection = transaction.state.selection.main;
      if (selection.empty) {
        return false;
      }
    }
    return value;
  }
});
```

它的逻辑是：

1. 编辑器初始化时，Quick Edit 是关闭的：`false`。
2. 如果 transaction 中有 `showQuickEditEffect`，就使用 effect 的值。
3. 如果选区发生变化，并且选区变空，就自动关闭 Quick Edit。
4. 其他情况保持原值。

这里的设计很 CodeMirror：不直接改 DOM 状态，而是通过 `StateEffect` 触发 `StateField` 更新。

## 4. selectionTooltip 如何打开 Quick Edit

`selectionTooltip.ts` 是 Quick Edit 的入口之一。

当用户选中代码时，它会创建一个 tooltip：

```ts
const selection = state.selection.main;

if (selection.empty) {
  return [];
}

const isQuickEditActive = state.field(quickEditState);
if (isQuickEditActive) {
  return [];
}
```

含义是：

- 没有选中代码时，不显示工具条。
- Quick Edit 输入框已经打开时，不显示普通工具条。
- 否则显示普通工具条。

普通工具条里有 `Quick Edit` 按钮：

```ts
quickEditButton.onclick = () => {
  if (editorView) {
    editorView.dispatch({
      effects: showQuickEditEffect.of(true),
    });
  }
};
```

点击按钮时，它没有直接显示输入框，而是 dispatch 一个 effect：

```ts
showQuickEditEffect.of(true)
```

这个 effect 会被 `quickEditState` 捕获，于是 Quick Edit 状态变成 `true`。

状态变成 `true` 后：

- `selectionTooltip` 会隐藏普通工具条。
- `quickEditTooltipField` 会显示 Quick Edit 输入框。

这就是两个 tooltip 之间的切换机制。

## 5. 快捷键 Mod-k 如何打开 Quick Edit

除了点击按钮，还可以按快捷键。

`quickEditKeymap` 注册了 `Mod-k`：

```ts
const quickEditKeymap = keymap.of([
  {
    key: "Mod-k",
    run: (view) => {
      const selection = view.state.selection.main;
      if (selection.empty) {
        return false;
      }

      view.dispatch({
        effects: showQuickEditEffect.of(true),
      });
      return true;
    },
  },
]);
```

API 解释：

- `keymap.of(...)`：注册快捷键扩展。
- `key: "Mod-k"`：跨平台快捷键，macOS 是 `Cmd-k`，Windows/Linux 通常是 `Ctrl-k`。
- `run(view)`：快捷键触发后执行。
- `return false`：没有处理这个快捷键，可以交给其他 keymap。
- `return true`：已经处理这个快捷键。

这里的逻辑是：

- 如果没有选中代码，返回 `false`，不打开 Quick Edit。
- 如果有选区，dispatch `showQuickEditEffect.of(true)`，打开 Quick Edit。

## 6. 为什么要 captureViewExtension

文件里有一个模块级变量：

```ts
let editorView: EditorView | null = null;
```

然后通过 update listener 保存当前 view：

```ts
const captureViewExtension = EditorView.updateListener.of((update) => {
  editorView = update.view;
});
```

为什么需要这样做？

因为 Quick Edit tooltip 的 DOM 是用 `document.createElement` 创建的，不是 React 组件。按钮点击、表单提交这些事件发生在手写 DOM 里。在这些 DOM 事件回调中，需要调用：

```ts
editorView.dispatch(...)
```

所以代码用 `captureViewExtension` 把当前 CodeMirror `EditorView` 存起来，供 tooltip DOM 事件使用。

注意：这种写法在单编辑器场景可以工作。如果页面未来同时存在多个 CodeMirror 实例，模块级 `editorView` 会被共享，可能互相覆盖。更稳的设计是把 view 放在插件实例内部，或者在 tooltip 创建闭包中传入当前 view。

## 7. Quick Edit 输入框 tooltip 是怎么生成的

核心函数是：

```ts
const createQuickEditTooltip = (state: EditorState): readonly Tooltip[] => {
  const selection = state.selection.main;

  if (selection.empty) {
    return [];
  }

  const isQuickEditActive = state.field(quickEditState);
  if (!isQuickEditActive) {
    return [];
  }

  return [
    {
      pos: selection.to,
      above: false,
      strictSide: false,
      create() {
        // 创建 DOM
        return { dom };
      },
    },
  ];
};
```

它只在两个条件同时满足时显示：

1. 用户选中了代码。
2. `quickEditState` 是 `true`。

返回的 tooltip 配置里：

```ts
{
  pos: selection.to,
  above: false,
  strictSide: false,
  create() {
    return { dom };
  },
}
```

API 解释：

- `pos: selection.to`：tooltip 锚定在选区结束位置。
- `above: false`：倾向显示在选区下方。
- `strictSide: false`：不强制固定方向，CodeMirror 可以根据空间调整。
- `create()`：创建 tooltip DOM。
- `return { dom }`：把 DOM 交给 CodeMirror 渲染。

## 8. 输入框 DOM 结构

`create()` 里手写了一个表单：

```ts
const dom = document.createElement("div");
const form = document.createElement("form");
const input = document.createElement("input");
const cancelButton = document.createElement("button");
const submitButton = document.createElement("button");
```

DOM 层级大致是：

```txt
div tooltip container
└─ form
   ├─ input
   └─ buttonContainer
      ├─ Cancel button
      └─ Submit button
```

输入框配置：

```ts
input.type = "text";
input.placeholder = "Edit selected code";
input.autofocus = true;
```

最后又用：

```ts
setTimeout(() => {
  input.focus();
}, 0);
```

确保 tooltip 挂载到 DOM 后，输入框能够拿到焦点。

## 9. quickEditTooltipField 如何让 tooltip 显示出来

CodeMirror tooltip 不是直接 return DOM 就能显示，还要通过 `showTooltip.computeN` 提供给编辑器。

项目里定义：

```ts
const quickEditTooltipField = StateField.define<readonly Tooltip[]>({
  create(state) {
    return createQuickEditTooltip(state);
  },

  update(tooltips, transaction) {
    if (transaction.docChanged || transaction.selection) {
      return createQuickEditTooltip(transaction.state);
    }
    for (const effect of transaction.effects) {
      if (effect.is(showQuickEditEffect)) {
        return createQuickEditTooltip(transaction.state);
      }
    }
    return tooltips;
  },
  provide: (field) => showTooltip.computeN(
    [field],
    (state) => state.field(field),
  ),
});
```

这里有两层职责。

第一层：`StateField` 保存当前 tooltip 数组。

- 初始时调用 `createQuickEditTooltip(state)`。
- 文档变化或选区变化时重新计算。
- 收到 `showQuickEditEffect` 时重新计算。
- 否则沿用旧 tooltip。

第二层：`provide` 把 tooltip 提供给 CodeMirror。

```ts
provide: (field) => showTooltip.computeN(
  [field],
  (state) => state.field(field),
)
```

这行的意思是：当这个 field 变化时，从 state 里取出 tooltip 数组，交给 `showTooltip` 渲染。

## 10. 点击 Cancel 发生了什么

Cancel 按钮逻辑：

```ts
cancelButton.onclick = () => {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  if (editorView) {
    editorView.dispatch({
      effects: showQuickEditEffect.of(false),
    });
  }
}
```

它做两件事：

1. 如果当前正在请求 AI，调用 `abort()` 取消请求。
2. dispatch `showQuickEditEffect.of(false)`，关闭 Quick Edit。

关闭后：

- `quickEditState` 变成 `false`。
- `quickEditTooltipField` 重新计算，返回 `[]`。
- 输入框 tooltip 消失。
- 因为选区还在，`selectionTooltip` 又可以显示普通工具条。

## 11. 提交表单时怎么拿到选中代码

提交逻辑在：

```ts
form.onsubmit = async (e) => {
  e.preventDefault();

  if (!editorView) return;

  const instruction = input.value.trim();
  if (!instruction) return;

  const selection = editorView.state.selection.main;
  const selectedCode = editorView.state.doc.sliceString(
    selection.from,
    selection.to
  );
  const fullCode = editorView.state.doc.toString();

  // 请求 AI
};
```

这里读取了三个核心数据：

- `instruction`：用户输入的编辑要求。
- `selectedCode`：当前选中的代码。
- `fullCode`：整个文件内容。

相关 API：

- `editorView.state.selection.main`：读取主选区。
- `selection.from`：选区开始位置。
- `selection.to`：选区结束位置。
- `doc.sliceString(from, to)`：读取某段文档文本。
- `doc.toString()`：读取整个文档文本。

为什么要传 `fullCode`？

因为只看选中代码，AI 可能不知道上下文。例如变量来自哪里、组件 props 是什么、函数返回类型是什么。传完整文件可以让 AI 更准确地修改选区。

## 12. fetcher 如何请求后端

请求函数在 `quick-edit/fetcher.ts`。

请求 schema：

```ts
const editRequestSchema = z.object({
  selectedCode: z.string(),
  fullCode: z.string(),
  instruction: z.string(),
});
```

响应 schema：

```ts
const editResponseSchema = z.object({
  editedCode: z.string(),
});
```

请求代码：

```ts
const response = await ky
  .post("/api/quick-edit", {
    json: validatedPayload,
    signal,
    timeout: 30_000,
    retry: 0,
  })
  .json<EditResponse>();
```

这里的设计点：

- 用 zod 校验请求，避免传错结构。
- 用 zod 校验响应，避免后端返回不符合预期。
- `timeout: 30_000`：最多等待 30 秒。
- `retry: 0`：不自动重试，避免重复编辑请求。
- `signal`：支持 Cancel 按钮 abort 请求。

如果是 abort：

```ts
if (error instanceof Error && error.name === "AbortError") {
  return null;
}
```

其他错误会 toast：

```ts
toast.error("Failed to fetch AI quick edit");
```

## 13. 后端 /api/quick-edit 做了什么

接口在 `src/app/api/quick-edit/route.ts`。

流程：

1. 检查 Clerk 登录态。
2. 读取 `selectedCode`、`fullCode`、`instruction`。
3. 校验选区和指令不能为空。
4. 如果 instruction 里有 URL，用 Firecrawl 抓文档。
5. 拼接 prompt。
6. 调用 AI SDK `generateText`。
7. 要求模型返回结构化对象 `{ editedCode: string }`。
8. 返回给前端。

核心 prompt：

```ts
const QUICK_EDIT_PROMPT = `You are a code editing assistant. Edit the selected code based on the user's instruction.

<context>
<selected_code>
{selectedCode}
</selected_code>
<full_code_context>
{fullCode}
</full_code_context>
</context>

{documentation}

<instruction>
{instruction}
</instruction>

<instructions>
Return ONLY the edited version of the selected code.
Maintain the same indentation level as the original.
Do not include any explanations or comments unless requested.
If the instruction is unclear or cannot be applied, return the original code unchanged.
</instructions>`;
```

模型调用：

```ts
const { output } = await generateText({
  model: anthropic("claude-3-7-sonnet-20250219"),
  output: Output.object({ schema: quickEditSchema }),
  prompt,
});
```

为什么要求 “Return ONLY the edited version of the selected code”？

因为前端会直接拿 `editedCode` 替换选区。如果模型返回解释文字、Markdown 代码块或者额外说明，就会污染源代码。

## 14. AI 返回后如何替换代码

前端拿到 `editedCode` 后：

```ts
if (editedCode) {
  editorView.dispatch({
    changes: {
      from: selection.from,
      to: selection.to,
      insert: editedCode,
    },
    selection: { anchor: selection.from + editedCode.length },
    effects: showQuickEditEffect.of(false),
  });
} else {
  submitButton.disabled = false;
  submitButton.textContent = "Submit";
}
```

这一次 `dispatch` 同时做了三件事：

1. 替换选区代码：

```ts
changes: {
  from: selection.from,
  to: selection.to,
  insert: editedCode,
}
```

2. 把光标移动到新代码末尾：

```ts
selection: { anchor: selection.from + editedCode.length }
```

3. 关闭 Quick Edit：

```ts
effects: showQuickEditEffect.of(false)
```

这也是 CodeMirror 里很典型的写法：一次 transaction 可以同时修改文档、移动光标、更新自定义状态。

## 15. 一次完整运行链路

从用户选中代码开始，完整链路如下：

1. 用户在 CodeMirror 中选中一段代码。
2. `selectionTooltipField` 检测到选区非空。
3. `selectionTooltip` 显示普通工具条。
4. 用户点击 `Quick Edit`，或者按 `Mod-k`。
5. 插件 dispatch `showQuickEditEffect.of(true)`。
6. `quickEditState` 更新为 `true`。
7. `selectionTooltip` 因为 Quick Edit 已激活而隐藏。
8. `quickEditTooltipField` 重新计算 tooltip。
9. `createQuickEditTooltip()` 返回输入框 tooltip。
10. CodeMirror 通过 `showTooltip.computeN` 渲染输入框。
11. 用户输入编辑指令。
12. 用户提交表单。
13. 插件读取 `selectedCode` 和 `fullCode`。
14. 插件调用 `fetcher()` 请求 `/api/quick-edit`。
15. 后端校验登录态和参数。
16. 后端拼 prompt，必要时抓取 URL 文档。
17. 后端调用 AI 返回 `{ editedCode }`。
18. 前端收到 `editedCode`。
19. 插件 dispatch `changes` 替换原选区。
20. 插件 dispatch `showQuickEditEffect.of(false)` 关闭输入框。
21. CodeMirror 文档变化触发 `CodeEditor` 的 `onChange`。
22. 外层编辑器保存逻辑防抖后把文件内容写回 Convex。

## 16. 和 CodeEditor 保存逻辑的关系

Quick Edit 只负责修改 CodeMirror 当前文档：

```ts
editorView.dispatch({
  changes: {
    from: selection.from,
    to: selection.to,
    insert: editedCode,
  },
});
```

它不直接调用 `updateFile` 保存数据库。

保存由 `CodeEditor` 里的 update listener 统一处理：

```ts
EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    onChange(update.state.doc.toString());
  }
})
```

这样设计的好处是：无论用户手动输入、按 Tab 接受幽灵文本、还是 Quick Edit 替换选区，只要 CodeMirror 文档变了，都会走同一套保存链路。

## 17. 这个插件的设计思路

Quick Edit 插件的核心设计可以概括成：

> 用 StateField 管开关，用 Tooltip 显示输入框，用 keymap 和按钮触发打开，用 fetcher 调 AI，用 dispatch changes 替换选区。

它把不同职责拆开：

- 状态：`quickEditState`
- 打开/关闭消息：`showQuickEditEffect`
- UI：`quickEditTooltipField` + `createQuickEditTooltip`
- 快捷键：`quickEditKeymap`
- 网络请求：`fetcher`
- AI 逻辑：`/api/quick-edit`
- 保存文件：交给外层 `CodeEditor` 的 `onChange`

这个拆法让插件符合 CodeMirror 的扩展模型，也让 AI 编辑不会和文件保存逻辑耦合。

## 18. 可以继续优化的点

当前实现能跑通，但有几个维护点值得注意：

1. `editorView` 是模块级变量，如果未来同屏多个编辑器，会互相覆盖。
2. `currentAbortController` 也是模块级变量，多实例下也会共享。
3. `quickEdit(fileName)` 接收 `fileName`，但当前没有使用，可以删掉或后续传给后端增强上下文。
4. tooltip UI 用原生 DOM 手写，如果交互继续复杂，维护成本会升高。
5. 后端接口没有用 zod parse 请求体，前端有校验，但后端也可以补上更稳。

如果只看当前单编辑器工作台场景，这套实现已经比较清晰：选区触发入口，状态切换 tooltip，AI 返回后替换选区。

