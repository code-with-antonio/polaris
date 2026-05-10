# Polaris 项目 CodeMirror 知识教程

这份教程整理 Polaris 项目中用到的 CodeMirror 6 知识。内容会从“编辑器怎么被创建”开始，逐步讲到主题、语言包、基础能力、状态系统、视图插件、tooltip、快捷键、Decoration、AI 幽灵文本和 Quick Edit。

相关源码：

- `src/features/editor/components/editor-view.tsx`
- `src/features/editor/components/code-editor.tsx`
- `src/features/editor/extensions/custom-setup.ts`
- `src/features/editor/extensions/theme.ts`
- `src/features/editor/extensions/language-extension.ts`
- `src/features/editor/extensions/minimap.ts`
- `src/features/editor/extensions/selection-tooltip.ts`
- `src/features/editor/extensions/quick-edit/index.ts`
- `src/features/editor/extensions/suggestion/index.ts`

## 1. 先理解 CodeMirror 6 的整体模型

CodeMirror 6 不是一个普通 textarea，也不是一个只靠 React state 驱动的组件。它有自己的状态系统、事务系统和扩展系统。

你可以先记住这几个概念：

| 概念 | 作用 | 项目中的例子 |
| --- | --- | --- |
| `EditorView` | 编辑器视图实例，负责 DOM、输入、渲染 | `new EditorView({...})` |
| `EditorState` | 编辑器状态，包含文档、选区、扩展状态 | `view.state.doc`、`view.state.selection` |
| `Extension` | 插件能力，一切功能都通过 extension 注册 | `customSetup`、`suggestion(fileName)` |
| `Transaction` | 一次状态变化，比如输入、移动光标、插入文本 | `view.dispatch({...})` |
| `StateField` | 在编辑器状态里保存自定义数据 | `suggestionState`、`quickEditState` |
| `StateEffect` | 在 transaction 中传递自定义更新消息 | `setSuggestionEffect`、`showQuickEditEffect` |
| `ViewPlugin` | 监听视图更新、维护视图层逻辑 | 幽灵文本请求插件、渲染插件 |
| `Decoration` | 在编辑器中额外渲染内容或样式 | 幽灵文本 `Decoration.widget` |
| `Tooltip` | 在编辑器选区附近渲染浮层 | selection tooltip、quick edit tooltip |
| `keymap` | 注册快捷键 | `Tab` 接受建议、`Mod-k` 打开 Quick Edit |

一句话概括：

> React 负责把 CodeMirror 挂到页面上；CodeMirror 内部通过 extensions 组合功能；用户输入会产生 transaction；插件通过 StateField、ViewPlugin、Decoration、Tooltip、keymap 参与编辑器行为。

## 2. React 中如何创建 CodeMirror

项目的核心编辑器组件是 `CodeEditor`。

简化代码如下：

```tsx
import { useEffect, useMemo, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { indentWithTab } from "@codemirror/commands";

export const CodeEditor = ({ fileName, initialValue, onChange }) => {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    const view = new EditorView({
      doc: initialValue,
      parent: editorRef.current,
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
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
      ],
    });

    return () => {
      view.destroy();
    };
  }, [languageExtension]);

  return <div ref={editorRef} className="size-full pl-4 bg-background" />;
};
```

这里有几个关键点。

`parent` 指定 CodeMirror 要挂载到哪个 DOM 节点：

```ts
parent: editorRef.current
```

`doc` 指定初始文档内容：

```ts
doc: initialValue
```

`extensions` 是最重要的配置。CodeMirror 6 的绝大多数功能都通过扩展传入，比如主题、语言、快捷键、搜索、折叠、自动补全、自定义插件。

组件卸载时必须调用：

```ts
view.destroy();
```

否则 CodeMirror 创建的 DOM、事件监听和插件资源不会被释放。

## 3. EditorView 和 EditorState

`EditorView` 是当前编辑器实例，常用来：

- 读取当前状态：`view.state`
- 派发修改：`view.dispatch(...)`
- 访问 DOM：`view.dom`

`EditorState` 是状态对象。项目中经常读这些内容：

```ts
const code = view.state.doc.toString();
const cursor = view.state.selection.main.head;
const selection = view.state.selection.main;
```

API 解释：

- `state.doc`：当前文档，类型不是普通字符串，而是 CodeMirror 的文本结构。
- `state.doc.toString()`：把文档转成完整字符串。
- `state.selection`：当前选区。
- `state.selection.main`：主选区。CodeMirror 支持多选区，所以这里取 main。
- `selection.from`：选区开始位置。
- `selection.to`：选区结束位置。
- `selection.head`：光标头部位置。
- `selection.empty`：是否没有选中内容。

示例：读取选中文本。

```ts
const selection = view.state.selection.main;

if (!selection.empty) {
  const selectedCode = view.state.doc.sliceString(
    selection.from,
    selection.to
  );
}
```

项目的 Quick Edit 就是这样读取用户选中的代码。

## 4. 通过 dispatch 修改编辑器

CodeMirror 不推荐直接改 DOM，也不能直接改 `view.state.doc`。修改文档要通过：

```ts
view.dispatch({
  changes: {
    from: cursor,
    insert: suggestion,
  },
});
```

API 解释：

- `view.dispatch(...)`：提交一次 transaction。
- `changes.from`：修改起始位置。
- `changes.to`：可选，修改结束位置。不传时表示纯插入。
- `changes.insert`：插入文本。
- `selection`：修改后新的光标或选区。
- `effects`：附带自定义 StateEffect。

示例：在光标处插入文本。

```ts
const cursor = view.state.selection.main.head;

view.dispatch({
  changes: { from: cursor, insert: "hello" },
  selection: { anchor: cursor + "hello".length },
});
```

示例：替换选区。

```ts
const selection = view.state.selection.main;

view.dispatch({
  changes: {
    from: selection.from,
    to: selection.to,
    insert: editedCode,
  },
  selection: {
    anchor: selection.from + editedCode.length,
  },
});
```

项目的 Quick Edit 就是用这个方式把 AI 编辑后的代码替换回选区。

## 5. 项目里的基础配置 customSetup

`customSetup` 位于 `src/features/editor/extensions/custom-setup.ts`。

它相当于项目自己组装的一套“编辑器基础能力包”：

```ts
export const customSetup: Extension = (() => [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter({ markerDOM(open) { ... } }),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
  ]),
])();
```

这些 API 可以分组理解。

### 5.1 行号和 gutter

```ts
lineNumbers()
highlightActiveLineGutter()
```

- `lineNumbers()`：显示左侧行号。
- `highlightActiveLineGutter()`：高亮当前行对应的 gutter 区域。

### 5.2 特殊字符、选择和光标

```ts
highlightSpecialChars()
drawSelection()
dropCursor()
```

- `highlightSpecialChars()`：显示或标记特殊不可见字符。
- `drawSelection()`：由 CodeMirror 绘制选区。
- `dropCursor()`：拖拽文本时显示放置光标。

### 5.3 历史记录

```ts
history()
```

启用撤销、重做历史。配合 `historyKeymap` 使用快捷键：

```ts
...historyKeymap
```

### 5.4 代码折叠

```ts
foldGutter({
  markerDOM(open) {
    const icon = document.createElement("div");
    icon.innerHTML = open ? foldGutterOpenSvg : foldGutterClosedSvg;
    return icon;
  },
})
```

- `foldGutter()`：在左侧 gutter 显示代码折叠按钮。
- `markerDOM(open)`：自定义折叠按钮的 DOM。
- `open`：当前折叠区域是否展开。

项目用 lucide 风格的 chevron SVG 替换默认图标。

### 5.5 多选区和矩形选择

```ts
EditorState.allowMultipleSelections.of(true)
rectangularSelection()
crosshairCursor()
```

- `allowMultipleSelections.of(true)`：允许多个选区。
- `rectangularSelection()`：支持矩形选择。
- `crosshairCursor()`：配合矩形选择显示十字光标。

### 5.6 缩进、语法高亮和括号

```ts
indentOnInput()
syntaxHighlighting(defaultHighlightStyle, { fallback: true })
bracketMatching()
closeBrackets()
```

- `indentOnInput()`：输入特定字符时自动调整缩进，例如输入 `}`。
- `syntaxHighlighting(...)`：启用语法高亮。
- `defaultHighlightStyle`：CodeMirror 默认高亮样式。
- `fallback: true`：没有更高优先级样式时使用默认样式。
- `bracketMatching()`：括号匹配高亮。
- `closeBrackets()`：自动补全括号、引号。

### 5.7 自动补全和搜索

```ts
autocompletion()
highlightSelectionMatches()
```

- `autocompletion()`：启用 CodeMirror 自带补全框能力。
- `highlightSelectionMatches()`：高亮当前选中文本在文档中的其他匹配。

### 5.8 keymap 合并

```ts
keymap.of([
  ...closeBracketsKeymap,
  ...defaultKeymap,
  ...searchKeymap,
  ...historyKeymap,
  ...foldKeymap,
  ...completionKeymap,
  ...lintKeymap,
])
```

`keymap.of(...)` 用来注册快捷键数组。

常见快捷键来自不同模块：

- `defaultKeymap`：基础编辑快捷键。
- `searchKeymap`：搜索快捷键。
- `historyKeymap`：撤销重做。
- `foldKeymap`：代码折叠。
- `completionKeymap`：补全选择。
- `lintKeymap`：lint 相关快捷键。
- `closeBracketsKeymap`：括号补全相关快捷键。

## 6. 主题：EditorView.theme

项目主题在 `src/features/editor/extensions/theme.ts`。

```ts
export const customTheme = EditorView.theme({
  "&": {
    outline: "none !important",
    height: "100%",
  },
  ".cm-content": {
    fontFamily: "var(--font-plex-mono), monospace",
    fontSize: "14px",
  },
  ".cm-scroller": {
    scrollbarWidth: "thin",
    scrollbarColor: "#3f3f46 transparent",
  },
});
```

API 解释：

- `EditorView.theme(spec)`：创建一个主题扩展。
- `"&"`：代表编辑器根元素。
- `".cm-content"`：编辑器内容区域。
- `".cm-scroller"`：滚动容器。

项目同时还用了官方暗色主题：

```ts
import { oneDark } from "@codemirror/theme-one-dark";
```

最终效果是：`oneDark` 提供大体暗色配色，`customTheme` 负责项目自己的高度、字体、滚动条等细节。

## 7. 语言扩展：按文件名选择语法

项目在 `language-extension.ts` 中根据文件后缀选择语言：

```ts
export const getLanguageExtension = (filename: string): Extension => {
  const ext = filename.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "js":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "html":
      return html();
    case "css":
      return css();
    case "json":
      return json();
    case "md":
    case "mdx":
      return markdown();
    case "py":
      return python();
    default:
      return [];
  }
};
```

API 解释：

- `javascript()`：JavaScript 语言支持。
- `javascript({ jsx: true })`：开启 JSX。
- `javascript({ typescript: true })`：开启 TypeScript。
- `javascript({ typescript: true, jsx: true })`：TSX。
- `html()`、`css()`、`json()`、`markdown()`、`python()`：对应语言包。
- 返回 `[]`：没有匹配语言时不启用额外语法扩展。

在 `CodeEditor` 中用 `useMemo` 计算语言扩展：

```ts
const languageExtension = useMemo(() => {
  return getLanguageExtension(fileName);
}, [fileName]);
```

这样切换文件名时，编辑器能根据后缀加载对应语法支持。

## 8. updateListener：监听文档变化

项目用 `EditorView.updateListener` 把 CodeMirror 内容同步回 React 外部：

```ts
EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    onChange(update.state.doc.toString());
  }
})
```

API 解释：

- `EditorView.updateListener.of(fn)`：创建一个监听每次 view update 的扩展。
- `update.docChanged`：本次更新是否修改了文档。
- `update.state`：更新后的状态。

这里不会在光标移动时触发保存，只有文档变了才调用 `onChange`。

上层 `EditorView` 组件又做了一层 1500ms 防抖保存：

```tsx
onChange={(content: string) => {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
  }

  timeoutRef.current = setTimeout(() => {
    updateFile({ id: activeFile._id, content });
  }, DEBOUNCE_MS);
}}
```

所以保存链路是：

1. CodeMirror 文档变化。
2. `updateListener` 调用 `onChange`。
3. React 外层防抖 1500ms。
4. 调用 `updateFile` 保存到后端数据。

## 9. ViewPlugin：写编辑器视图插件

`ViewPlugin` 适合做跟视图更新有关的功能，比如监听输入、计算装饰、请求建议。

基本形式：

```ts
const plugin = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      // 插件初始化
    }

    update(update: ViewUpdate) {
      // 每次视图更新时调用
    }

    destroy() {
      // 编辑器销毁时清理资源
    }
  }
);
```

项目的幽灵文本请求插件就是这样写的：

```ts
const createDebouncePlugin = (fileName: string) => {
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.triggerSuggestion(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
          this.triggerSuggestion(update.view);
        }
      }

      destroy() {
        // 清 timer 和 abort 请求
      }
    }
  );
};
```

API 解释：

- `ViewPlugin.fromClass(...)`：从 class 创建视图插件。
- `constructor(view)`：插件被创建时调用。
- `update(update)`：编辑器状态或视图变化时调用。
- `update.view`：当前 EditorView。
- `update.docChanged`：文档是否变化。
- `update.selectionSet`：选区是否变化。
- `destroy()`：插件销毁时清理副作用。

## 10. StateEffect 和 StateField：自定义状态

项目有两个典型例子：

- 幽灵文本：保存当前 AI suggestion。
- Quick Edit：保存 Quick Edit tooltip 是否打开。

### 10.1 StateEffect 是更新消息

```ts
const setSuggestionEffect = StateEffect.define<string | null>();
```

它定义一种 effect，值类型是 `string | null`。

派发 effect：

```ts
view.dispatch({
  effects: setSuggestionEffect.of("console.log()"),
});
```

### 10.2 StateField 是状态容器

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

API 解释：

- `StateField.define<T>()`：定义一个编辑器状态字段。
- `create(state)`：初始值。
- `update(value, transaction)`：每次 transaction 后计算新值。
- `transaction.effects`：本次事务附带的 effects。
- `effect.is(...)`：判断 effect 是否是指定类型。
- `effect.value`：effect 携带的值。
- `view.state.field(field)`：读取字段值。

读取建议：

```ts
const suggestion = view.state.field(suggestionState);
```

这个模式非常重要：

> 用 `StateEffect` 表达“我要改状态”，用 `StateField` 保存“当前状态是什么”。

## 11. Decoration：在编辑器中渲染额外内容

幽灵文本使用的是 `Decoration.widget`。

先定义一个 widget：

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

API 解释：

- `WidgetType`：CodeMirror 中自定义 DOM 小组件的基类。
- `toDOM()`：返回实际渲染的 DOM 元素。
- `pointerEvents = "none"`：避免幽灵文本影响鼠标交互。

再创建 decoration：

```ts
Decoration.widget({
  widget: new SuggestionWidget(suggestion),
  side: 1,
}).range(cursor)
```

API 解释：

- `Decoration.widget(...)`：创建一个 widget 装饰。
- `widget`：要渲染的 WidgetType 实例。
- `side: 1`：显示在位置之后。`side: -1` 表示显示在位置之前。
- `.range(cursor)`：把 decoration 放到某个文档位置。

最后返回 `DecorationSet`：

```ts
return Decoration.set([
  Decoration.widget({
    widget: new SuggestionWidget(suggestion),
    side: 1,
  }).range(cursor),
]);
```

如果不需要显示：

```ts
return Decoration.none;
```

## 12. 带 decorations 的 ViewPlugin

幽灵文本渲染插件如下：

```ts
const renderPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      const suggestionChanged = update.transactions.some((transaction) => {
        return transaction.effects.some((effect) => {
          return effect.is(setSuggestionEffect);
        });
      });

      const shouldRebuild =
        update.docChanged || update.selectionSet || suggestionChanged;

      if (shouldRebuild) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView) {
      const suggestion = view.state.field(suggestionState);
      if (!suggestion) {
        return Decoration.none;
      }

      const cursor = view.state.selection.main.head;
      return Decoration.set([
        Decoration.widget({
          widget: new SuggestionWidget(suggestion),
          side: 1,
        }).range(cursor),
      ]);
    }
  },
  { decorations: (plugin) => plugin.decorations }
);
```

最关键的是第二个参数：

```ts
{ decorations: (plugin) => plugin.decorations }
```

这告诉 CodeMirror：这个插件提供 decorations，请把它们渲染到编辑器中。

## 13. keymap：自定义快捷键

项目里有两个自定义快捷键。

### 13.1 Tab 接受幽灵文本

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

API 解释：

- `keymap.of([...])`：注册快捷键数组。
- `key`：快捷键字符串。
- `run(view)`：快捷键触发时执行。
- 返回 `true`：表示这个快捷键已处理，后续 keymap 不再处理。
- 返回 `false`：表示未处理，可以交给其他 keymap。

这个设计让 `Tab` 在有建议时接受建议，没有建议时继续执行缩进。

### 13.2 Mod-k 打开 Quick Edit

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

`Mod-k` 是跨平台写法：

- macOS 上是 `Cmd+K`
- Windows/Linux 上通常是 `Ctrl+K`

## 14. Tooltip：选区浮层和 Quick Edit

CodeMirror 的 tooltip 由 `showTooltip` 提供。

项目里有两个 tooltip：

- `selectionTooltip`：选中文本后显示 `Add to Chat` 和 `Quick Edit`。
- `quickEdit`：显示输入框，让用户输入编辑指令。

tooltip 数据结构类似：

```ts
return [
  {
    pos: selection.to,
    above: false,
    strictSide: false,
    create() {
      const dom = document.createElement("div");
      dom.textContent = "Quick Edit";
      return { dom };
    },
  },
];
```

API 解释：

- `pos`：tooltip 锚定到文档中的哪个位置。
- `above`：是否显示在上方。
- `strictSide`：是否严格固定在指定方向。
- `create()`：创建 tooltip DOM。
- 返回 `{ dom }`：CodeMirror 用这个 DOM 渲染浮层。

### 14.1 selectionTooltip 的状态字段

`selectionTooltip` 用 `StateField<readonly Tooltip[]>` 保存当前 tooltip 列表：

```ts
const selectionTooltipField = StateField.define<readonly Tooltip[]>({
  create(state) {
    return createTooltipForSelection(state);
  },

  update(tooltips, transaction) {
    if (transaction.docChanged || transaction.selection) {
      return createTooltipForSelection(transaction.state);
    }

    for (const effect of transaction.effects) {
      if (effect.is(showQuickEditEffect)) {
        return createTooltipForSelection(transaction.state);
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

最关键的是 `provide`：

```ts
provide: (field) => showTooltip.computeN(
  [field],
  (state) => state.field(field),
)
```

API 解释：

- `provide`：让这个 StateField 额外提供某种扩展能力。
- `showTooltip.computeN(...)`：根据状态计算多个 tooltip。
- `state.field(field)`：读取当前 tooltip 数组。

也就是说，`StateField` 不仅保存 tooltip 数据，还通过 `provide` 告诉 CodeMirror 要显示这些 tooltip。

### 14.2 selectionTooltip 什么时候显示

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

逻辑是：

- 没有选中文本，不显示。
- Quick Edit 已经打开时，不显示普通选择工具条。
- 否则显示 `Add to Chat` 和 `Quick Edit`。

点击 Quick Edit 按钮时：

```ts
editorView.dispatch({
  effects: showQuickEditEffect.of(true),
});
```

它通过 effect 打开 Quick Edit 状态。

## 15. Quick Edit：完整运行机制

Quick Edit 在 `src/features/editor/extensions/quick-edit/index.ts`。

它导出：

```ts
export const quickEdit = (fileName: string) => [
  quickEditState,
  quickEditTooltipField,
  quickEditKeymap,
  captureViewExtension,
];
```

虽然参数里有 `fileName`，当前实现里没有实际使用。

### 15.1 quickEditState

```ts
export const showQuickEditEffect = StateEffect.define<boolean>();

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

含义：

- 初始 Quick Edit 关闭。
- 收到 `showQuickEditEffect.of(true)` 时打开。
- 收到 `showQuickEditEffect.of(false)` 时关闭。
- 如果选区变空，也自动关闭。

### 15.2 quickEditTooltipField

它和 selection tooltip 类似，也是 `StateField<readonly Tooltip[]>`。

只有在选区非空且 `quickEditState` 为 true 时才显示：

```ts
if (selection.empty) {
  return [];
}

const isQuickEditActive = state.field(quickEditState);
if (!isQuickEditActive) {
  return [];
}
```

### 15.3 提交 Quick Edit

Quick Edit tooltip 里创建了一个 form。

提交时：

```ts
const selection = editorView.state.selection.main;
const selectedCode = editorView.state.doc.sliceString(
  selection.from,
  selection.to
);
const fullCode = editorView.state.doc.toString();

const editedCode = await fetcher(
  {
    selectedCode,
    fullCode,
    instruction,
  },
  currentAbortController.signal
);
```

拿到结果后替换选区：

```ts
editorView.dispatch({
  changes: {
    from: selection.from,
    to: selection.to,
    insert: editedCode,
  },
  selection: { anchor: selection.from + editedCode.length },
  effects: showQuickEditEffect.of(false),
});
```

完整链路：

1. 用户选中代码。
2. selection tooltip 出现。
3. 点击 Quick Edit 或按 `Mod-k`。
4. dispatch `showQuickEditEffect.of(true)`。
5. `quickEditState` 变成 true。
6. 普通 selection tooltip 隐藏。
7. Quick Edit tooltip 显示输入框。
8. 用户输入指令并提交。
9. 请求 `/api/quick-edit`。
10. 后端调用 AI 返回 `editedCode`。
11. 用 `view.dispatch({ changes })` 替换原选区。
12. 关闭 Quick Edit。

## 16. 幽灵文本 suggestion：完整运行机制

幽灵文本插件在 `src/features/editor/extensions/suggestion/index.ts`。

导出结构：

```ts
export const suggestion = (fileName: string) => [
  suggestionState,
  createDebouncePlugin(fileName),
  renderPlugin,
  acceptSuggestionKeymap,
];
```

### 16.1 保存建议文本

```ts
const setSuggestionEffect = StateEffect.define<string | null>();

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

`suggestionState` 保存当前要显示的补全文本。`null` 表示不显示。

### 16.2 生成请求 payload

```ts
const generatePayload = (view: EditorView, fileName: string) => {
  const code = view.state.doc.toString();
  const cursorPosition = view.state.selection.main.head;
  const currentLine = view.state.doc.lineAt(cursorPosition);
  const cursorInLine = cursorPosition - currentLine.from;

  return {
    fileName,
    code,
    currentLine: currentLine.text,
    previousLines,
    textBeforeCursor: currentLine.text.slice(0, cursorInLine),
    textAfterCursor: currentLine.text.slice(cursorInLine),
    nextLines,
    lineNumber: currentLine.number,
  };
};
```

重要 API：

- `doc.lineAt(pos)`：获取某个位置所在的行。
- `line.from`：该行起始文档位置。
- `line.text`：该行文本。
- `line.number`：行号。
- `doc.line(n)`：获取第 n 行。
- `doc.lines`：总行数。

项目会取当前行前后最多 5 行作为上下文。

### 16.3 防抖和 abort

```ts
let debounceTimer: number | null = null;
let currentAbortController: AbortController | null = null;
const DEBOUNCE_DELAY = 300;
```

每次输入或移动光标：

```ts
if (debounceTimer !== null) {
  clearTimeout(debounceTimer);
}

if (currentAbortController !== null) {
  currentAbortController.abort();
}
```

含义：

- 用户继续输入时，取消上一轮 300ms 等待。
- 如果旧请求还在路上，用 `AbortController` 取消。

这样可以减少接口请求，也能避免旧建议覆盖新位置的建议。

### 16.4 渲染幽灵文本

AI 返回建议后：

```ts
view.dispatch({
  effects: setSuggestionEffect.of(suggestion),
});
```

然后 `renderPlugin` 读取 `suggestionState`，创建 `Decoration.widget`：

```ts
const cursor = view.state.selection.main.head;

return Decoration.set([
  Decoration.widget({
    widget: new SuggestionWidget(suggestion),
    side: 1,
  }).range(cursor),
]);
```

`SuggestionWidget` 创建半透明 span：

```ts
const span = document.createElement("span");
span.textContent = this.text;
span.style.opacity = "0.4";
span.style.pointerEvents = "none";
```

这就是你看到的灰色幽灵文本。它不是文档内容，只是额外渲染。

### 16.5 Tab 接受建议

```ts
view.dispatch({
  changes: { from: cursor, insert: suggestion },
  selection: { anchor: cursor + suggestion.length },
  effects: setSuggestionEffect.of(null),
});
```

接收后：

- suggestion 插入真实文档。
- 光标移动到插入文本末尾。
- suggestion state 清空。

## 17. Minimap 和第三方扩展

项目使用 `@replit/codemirror-minimap`：

```ts
import { showMinimap } from "@replit/codemirror-minimap";

const createMinimap = () => {
  const dom = document.createElement("div");
  return { dom };
};

export const minimap = () => [
  showMinimap.compute(["doc"], () => {
    return {
      create: createMinimap,
    };
  }),
];
```

API 解释：

- `showMinimap`：Replit 提供的 CodeMirror minimap 扩展入口。
- `.compute(["doc"], fn)`：根据指定依赖计算配置。这里依赖文档内容。
- `create`：创建 minimap DOM。

项目还用了缩进线扩展：

```ts
import { indentationMarkers } from "@replit/codemirror-indentation-markers";

indentationMarkers()
```

这类第三方扩展的接入方式和官方扩展一样：只要返回 CodeMirror extension，就能放进 `extensions` 数组。

## 18. Extension 数组的组合方式

CodeMirror extension 可以是单个扩展，也可以是数组。

项目里这些都是合法的：

```ts
customTheme
customSetup
languageExtension
suggestion(fileName)
quickEdit(fileName)
selectionTooltip()
minimap()
```

其中：

- `customTheme` 是单个 extension。
- `customSetup` 是一个 extension 数组，但类型上仍可作为 `Extension`。
- `suggestion(fileName)` 返回数组。
- `quickEdit(fileName)` 返回数组。
- `selectionTooltip()` 返回数组。

CodeMirror 会把嵌套数组展开并组合。

## 19. 项目的编辑器数据流

从打开文件到保存文件，整体链路是：

1. 用户在文件树中打开文件。
2. `useEditorStore` 记录当前 tab 和 active file。
3. `EditorView` 根据 `activeTabId` 取到 `activeFile`。
4. 如果是文本文件，渲染 `CodeEditor`。
5. `CodeEditor` 创建 CodeMirror `EditorView`。
6. 用户编辑代码。
7. CodeMirror `updateListener` 检测 `docChanged`。
8. 调用 React 传入的 `onChange`。
9. 外层 1500ms 防抖后 `updateFile` 保存文件。

这里要区分两个 `EditorView`：

- React 组件 `src/features/editor/components/editor-view.tsx` 叫 `EditorView`。
- CodeMirror 类 `@codemirror/view` 也叫 `EditorView`。

它们不是同一个东西。前者是项目页面组件，后者是 CodeMirror 编辑器实例。

## 20. 常见 API 速查

### 20.1 创建编辑器

```ts
new EditorView({
  doc: "initial code",
  parent: dom,
  extensions: [],
});
```

### 20.2 读取全文

```ts
view.state.doc.toString();
```

### 20.3 读取光标

```ts
view.state.selection.main.head;
```

### 20.4 读取选区

```ts
const selection = view.state.selection.main;
const selected = view.state.doc.sliceString(selection.from, selection.to);
```

### 20.5 插入文本

```ts
view.dispatch({
  changes: { from: pos, insert: text },
});
```

### 20.6 替换文本

```ts
view.dispatch({
  changes: { from, to, insert: text },
});
```

### 20.7 移动光标

```ts
view.dispatch({
  selection: { anchor: newPos },
});
```

### 20.8 注册快捷键

```ts
keymap.of([
  {
    key: "Mod-k",
    run(view) {
      return true;
    },
  },
]);
```

### 20.9 定义状态

```ts
const effect = StateEffect.define<string>();

const field = StateField.define<string>({
  create() {
    return "";
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(effect)) return e.value;
    }
    return value;
  },
});
```

### 20.10 读取状态

```ts
view.state.field(field);
```

### 20.11 派发状态更新

```ts
view.dispatch({
  effects: effect.of("new value"),
});
```

### 20.12 创建 tooltip

```ts
const tooltip = {
  pos,
  create() {
    const dom = document.createElement("div");
    return { dom };
  },
};
```

### 20.13 创建 widget decoration

```ts
Decoration.widget({
  widget: new MyWidget(),
  side: 1,
}).range(pos);
```

## 21. 学习建议：按这个顺序读源码

建议按下面顺序学习，会比较顺：

1. `code-editor.tsx`：看编辑器如何创建，extensions 如何组合。
2. `custom-setup.ts`：认识基础扩展。
3. `theme.ts`：理解 CodeMirror 样式写法。
4. `language-extension.ts`：理解语言包如何切换。
5. `selection-tooltip.ts`：学习 tooltip 和 StateField。
6. `quick-edit/index.ts`：学习 tooltip、keymap、dispatch 替换选区。
7. `suggestion/index.ts`：学习 ViewPlugin、Decoration、WidgetType、AI 幽灵文本。

如果只记一个核心公式：

> CodeMirror 功能 = extensions；状态变化 = transaction；改文档 = dispatch changes；改自定义状态 = dispatch effects；额外 UI = tooltip 或 decoration。

## 22. 项目实现里的注意点

这部分不是必须先学，但读懂后会更容易理解维护风险。

### 22.1 模块级变量会被多个编辑器共享

`suggestion/index.ts` 中：

```ts
let debounceTimer: number | null = null;
let isWaitingForSuggestion = false;
let currentAbortController: AbortController | null = null;
```

`quick-edit/index.ts` 和 `selection-tooltip.ts` 中也有模块级 `editorView`。

如果页面上永远只有一个 CodeMirror 实例，这样通常没问题。如果未来同时显示多个编辑器实例，这些变量会共享，可能互相影响。

更稳的方式是把这些状态放进 `ViewPlugin` class 实例字段中，例如：

```ts
class SuggestionRequester {
  debounceTimer: number | null = null;
  currentAbortController: AbortController | null = null;

  update(update: ViewUpdate) {
    // 每个编辑器实例有自己的 plugin 实例
  }
}
```

### 22.2 React effect 依赖和文件切换

`CodeEditor` 的 effect 依赖是：

```ts
}, [languageExtension]);
```

而 `EditorView` 外层给了：

```tsx
<CodeEditor key={activeFile._id} ... />
```

因为 key 是文件 id，所以切换文件会重新挂载 `CodeEditor`，从而销毁旧 CodeMirror 并创建新实例。这一点保证了不同文件内容不会混在同一个 editor 实例里。

### 22.3 Tooltip DOM 是手写 DOM，不是 React 组件

CodeMirror tooltip 的 `create()` 返回真实 DOM：

```ts
const dom = document.createElement("div");
```

所以 tooltip 内部按钮、输入框都是用 DOM API 创建的，不是 JSX。这样符合 CodeMirror tooltip API，但写复杂 UI 时会比 React 组件更繁琐。

## 23. 一个最小自定义扩展示例

假设你想做一个“按 Alt-l 插入 console.log”的扩展，可以这样写：

```ts
import { keymap } from "@codemirror/view";

export const insertLogKeymap = keymap.of([
  {
    key: "Alt-l",
    run(view) {
      const cursor = view.state.selection.main.head;
      const text = "console.log();";

      view.dispatch({
        changes: { from: cursor, insert: text },
        selection: { anchor: cursor + "console.log(".length },
      });

      return true;
    },
  },
]);
```

然后加入 `CodeEditor`：

```ts
extensions: [
  customSetup,
  insertLogKeymap,
]
```

这就是 CodeMirror 6 的扩展思路：写一个 extension，放进数组。

## 24. 一个最小 tooltip 示例

选中文本时显示一个简单 tooltip：

```ts
import { Tooltip, showTooltip } from "@codemirror/view";
import { StateField } from "@codemirror/state";

const createTooltip = (state): readonly Tooltip[] => {
  const selection = state.selection.main;
  if (selection.empty) return [];

  return [
    {
      pos: selection.to,
      create() {
        const dom = document.createElement("div");
        dom.textContent = "Selected";
        dom.className = "rounded border p-1";
        return { dom };
      },
    },
  ];
};

export const selectedTooltip = StateField.define<readonly Tooltip[]>({
  create: createTooltip,
  update(value, tr) {
    if (tr.selection || tr.docChanged) {
      return createTooltip(tr.state);
    }
    return value;
  },
  provide: (field) =>
    showTooltip.computeN([field], (state) => state.field(field)),
});
```

项目的 `selectionTooltip` 就是这个模式的增强版。

## 25. 一个最小幽灵文本示例

下面是一个不请求 AI、固定显示 `" world"` 的幽灵文本扩展：

```ts
import {
  Decoration,
  DecorationSet,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";

class GhostWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.textContent = " world";
    span.style.opacity = "0.4";
    return span;
  }
}

export const simpleGhostText = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view) {
      this.decorations = this.build(view);
    }

    update(update) {
      if (update.selectionSet || update.docChanged) {
        this.decorations = this.build(update.view);
      }
    }

    build(view) {
      const cursor = view.state.selection.main.head;
      return Decoration.set([
        Decoration.widget({
          widget: new GhostWidget(),
          side: 1,
        }).range(cursor),
      ]);
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  }
);
```

项目的 `suggestion` 插件就是在这个基础上增加了：

- 防抖。
- 请求 AI。
- 用 StateField 保存 suggestion。
- Tab 接受建议。
- 请求中隐藏旧建议。

## 26. 总结

Polaris 项目里 CodeMirror 的使用层次非常清晰：

- `CodeEditor` 创建编辑器实例。
- `customSetup` 提供基础编辑体验。
- `customTheme` 控制编辑器样式。
- `getLanguageExtension` 根据文件名启用语言支持。
- `updateListener` 把文档变化同步给外层保存逻辑。
- `selectionTooltip` 在选区上显示操作入口。
- `quickEdit` 使用 tooltip + keymap + dispatch 替换选区。
- `suggestion` 使用 ViewPlugin + StateField + Decoration 实现 AI 幽灵文本。
- `minimap` 和 `indentationMarkers` 接入第三方 CodeMirror 扩展。

学会这些之后，你基本就掌握了本项目里 CodeMirror 的主要知识点。以后要新增编辑器能力，大多数时候就是选择合适的扩展点：快捷键用 `keymap`，状态用 `StateField`，浮层用 `showTooltip`，额外渲染用 `Decoration`，视图副作用用 `ViewPlugin`。
