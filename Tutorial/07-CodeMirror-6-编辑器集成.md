# 第 7 课：CodeMirror 6 编辑器集成

> 本课目标：掌握 CodeMirror 6 的核心概念、架构设计和 Polaris 项目中的集成方式

---

## 7.1 CodeMirror 简介

CodeMirror 是一个**模块化的代码编辑器**，用于在浏览器中提供成熟的代码编辑体验。

### CodeMirror 版本对比

| 特性 | CodeMirror 5 | CodeMirror 6 |
|------|-------------|--------------|
| 架构 | 单体式 | 模块化（Extension） |
| 性能 | 一般 | 优秀（虚拟渲染） |
| 主题 | 需要手动适配 | 原生主题支持 |
| 扩展 | 复杂 | 通过 Extension 轻松扩展 |
| 包大小 | ~200KB | ~100KB（按需加载） |

### CodeMirror 6 核心包

```bash
# 核心包
codemirror           # 主包，导出所有核心模块
@codemirror/state    # 状态系统（EditorState）
@codemirror/view      # 视图系统（EditorView）

# 语言支持
@codemirror/lang-javascript
@codemirror/lang-python
@codemirror/lang-html
@codemirror/lang-css

# 主题
@codemirror/theme-one-dark

# 第三方扩展
@replit/codemirror-indentation-markers  # 缩进标记
@replit/codemirror-minimap               # 小地图
```

---

## 7.2 CodeMirror 6 核心概念

CodeMirror 6 的核心是**状态（State）**和**视图（View）**的分离。

### 核心类型

| 类型 | 包 | 说明 |
|------|-----|------|
| `EditorState` | `@codemirror/state` | 编辑器的不可变状态 |
| `EditorView` | `@codemirror/view` | 编辑器的渲染视图 |
| `Extension` | `@codemirror/state` | 可组合的扩展 |

### EditorState - 状态

EditorState 是编辑器的**不可变状态**，包含：
- 文档内容（`doc`）
- 选区（`selection`）
- 拓展配置（`extensions`）

```typescript
import { EditorState } from "@codemirror/state";

const state = EditorState.create({
  doc: "Hello, CodeMirror!",  // 初始文档
  selection: { anchor: 0 },    // 光标位置
  extensions: [
    // 扩展列表
  ],
});
```

### EditorView - 视图

EditorView 负责**渲染和交互**，接收 EditorState 并绑定到 DOM。

```typescript
import { EditorView } from "@codemirror/view";

const view = new EditorView({
  state,  // EditorState 实例
  parent: document.getElementById("editor"),  // 挂载点
});

// 销毁视图
view.destroy();
```

### 状态更新流程

```
用户输入
    ↓
EditorView 检测变化
    ↓
创建 Transaction（事务）
    ↓
生成新的 EditorState（不可变）
    ↓
视图自动重新渲染
```

---

## 7.3 Extension 系统

Extension 是 CodeMirror 6 的核心概念，用于扩展编辑器功能。

### Extension 类型

```typescript
import { Extension } from "@codemirror/state";

// Extension 可以是：
type Extension =
  | StateField<any>     // 状态字段
  | StateEffect<any>    // 状态效果
  | EditorViewExtension  // 视图扩展
  | Compartment          // 可切换配置
  | Extension[];         // 扩展数组
```

### 基本扩展示例

```typescript
import { lineNumbers, highlightActiveLine } from "@codemirror/view";

const extensions: Extension = [
  lineNumbers(),           // 行号
  highlightActiveLine(),   // 高亮当前行
  // 更多扩展...
];
```

### Polaris 的扩展配置

```typescript
// src/features/editor/extensions/custom-setup.ts
export const customSetup: Extension = [
  lineNumbers(),                    // 行号
  highlightActiveLineGutter(),      // 行号高亮
  highlightSpecialChars(),          // 特殊字符
  history(),                        // 撤销/重做
  foldGutter(),                     // 代码折叠
  drawSelection(),                  // 选区绘制
  dropCursor(),                     // 拖放光标
  indentOnInput(),                  // 自动缩进
  bracketMatching(),                // 括号匹配
  closeBrackets(),                  // 自动闭合
  autocompletion(),                 // 自动补全
  // ... 更多
];
```

---

## 7.4 Polaris CodeEditor 组件

Polaris 使用 React 封装 CodeMirror 6。

### 组件结构

```typescript
// src/features/editor/components/code-editor.tsx
"use client";

import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";

import { customSetup } from "../extensions/custom-setup";
import { customTheme } from "../extensions/theme";
import { getLanguageExtension } from "../extensions/language-extension";

export const CodeEditor = ({
  fileName,
  initialValue = "",
  onChange,
}: Props) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    // 创建 EditorView
    const view = new EditorView({
      doc: initialValue,
      parent: editorRef.current,
      extensions: [
        oneDark,              // 主题
        customTheme,          // 自定义主题
        customSetup,          // 基础设置
        languageExtension,    // 语言支持
        // 更多扩展...
      ],
    });

    viewRef.current = view;

    // 清理函数
    return () => {
      view.destroy();
    };
  }, [languageExtension]);

  return (
    <div ref={editorRef} className="size-full pl-4 bg-background" />
  );
};
```

### 组件 Props

```typescript
interface Props {
  fileName: string;           // 文件名（用于确定语言）
  initialValue?: string;     // 初始内容
  onChange: (value: string) => void;  // 内容变化回调
}
```

---

## 7.5 EditorState.create

创建编辑器状态时，需要配置所有扩展。

### 完整配置示例

```typescript
const state = EditorState.create({
  doc: "console.log('Hello')",
  selection: { anchor: 0, head: 0 },
  extensions: [
    // 1. 基础扩展
    lineNumbers(),
    history(),
    indentOnInput(),

    // 2. 主题
    oneDark,
    EditorView.theme({
      "&": { height: "100%" },
      ".cm-content": { fontFamily: "monospace" },
    }),

    // 3. 语言
    javascript(),

    // 4. 监听更新
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        console.log(update.state.doc.toString());
      }
    }),
  ],
});
```

---

## 7.6 EditorView 配置

EditorView 是编辑器的视觉呈现。

### 基本配置

```typescript
const view = new EditorView({
  state,                      // EditorState 实例
  parent: containerElement,   // DOM 容器

  // 可选配置
  dispatch: (tr) => {},       // 自定义 dispatch
  extensions: [],             // 额外扩展
});
```

### EditorView 主要属性

```typescript
// 状态
view.state     // 当前的 EditorState
view.doc       // 当前文档（view.state.doc 的简写）

// DOM
view.dom       // 编辑器的根 DOM 元素
view.contentDOM // 可编辑内容的 DOM

// 方法
view.dispatch(tr)  // 分发事务
view.focus()       // 聚焦
view.destroy()     // 销毁
```

### 事务（Transaction）

事务是状态更新的载体。

```typescript
// 获取当前选区
const { from, to } = view.state.selection.main;

// 更新文档
view.dispatch({
  changes: {
    from,           // 起始位置
    to,             // 结束位置
    insert: "new content",  // 插入内容
  },
});

// 替换整个文档
view.dispatch({
  changes: {
    from: 0,
    to: view.state.doc.length,
    insert: "entire new content",
  },
});
```

---

## 7.7 语言扩展

CodeMirror 6 通过语言包支持不同编程语言。

### getLanguageExtension 函数

```typescript
// src/features/editor/extensions/language-extension.ts
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";

export const getLanguageExtension = (filename: string): Extension => {
  const ext = filename.split(".").pop()?.toLowerCase();

  switch(ext) {
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
    case "py":
      return python();
    default:
      return [];  // 无语法高亮
  }
};
```

### 支持的语言

| 扩展名 | 语言 | 包 |
|--------|------|-----|
| `.js` | JavaScript | `@codemirror/lang-javascript` |
| `.ts` | TypeScript | `@codemirror/lang-javascript({ typescript: true })` |
| `.jsx` | React JSX | `@codemirror/lang-javascript({ jsx: true })` |
| `.tsx` | React TSX | `@codemirror/lang-javascript({ jsx: true, typescript: true })` |
| `.html` | HTML | `@codemirror/lang-html` |
| `.css` | CSS | `@codemirror/lang-css` |
| `.json` | JSON | `@codemirror/lang-json` |
| `.py` | Python | `@codemirror/lang-python` |
| `.md` | Markdown | `@codemirror/lang-markdown` |

---

## 7.8 主题系统

### 内置主题

CodeMirror 6 自带一些主题，也可以使用第三方主题。

```typescript
import { oneDark } from "@codemirror/theme-one-dark";

// 使用内置主题
const extensions = [oneDark];
```

### 自定义主题

```typescript
// src/features/editor/extensions/theme.ts
import { EditorView } from "@codemirror/view";

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
}, { dark: true });  // 标记为暗色主题
```

### 主题叠加

```typescript
const extensions = [
  oneDark,          // 基础暗色主题
  customTheme,      // Polaris 自定义
];
```

---

## 7.9 常用扩展详解

### 行号与高亮

```typescript
import {
  lineNumbers,                    // 行号
  highlightActiveLine,            // 高亮当前行
  highlightActiveLineGutter,      // 高亮行号栏
  highlightSpecialChars,          // 高亮特殊字符
} from "@codemirror/view";
```

### 选择与历史

```typescript
import {
  drawSelection,    // 显示选区
  dropCursor,       // 拖放时光标
  EditorState.allowMultipleSelections,  // 多重选区
} from "@codemirror/view";

import {
  history,          // 撤销/重做
  defaultKeymap,    // 默认快捷键
  historyKeymap,    // 历史操作快捷键
} from "@codemirror/commands";
```

### 代码编辑辅助

```typescript
import {
  indentOnInput,      // 缩进辅助
  bracketMatching,    // 括号匹配
  closeBrackets,      // 自动闭合括号
  autocompletion,     // 自动补全
} from "@codemirror/autocomplete";

import {
  foldGutter,         // 代码折叠
  foldKeymap,         // 折叠快捷键
} from "@codemirror/language";
```

### 搜索

```typescript
import {
  searchKeymap,           // 搜索快捷键
  highlightSelectionMatches,  // 高亮选中文本
} from "@codemirror/search";
```

### 快捷键

```typescript
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";

// Tab 键缩进
keymap.of([indentWithTab]),
```

---

## 7.10 Keymap 与快捷键

### 内置 Keymap

```typescript
import { keymap } from "@codemirror/view";
import {
  defaultKeymap,      // 默认快捷键（Enter 换行等）
  historyKeymap,      // Ctrl+Z 撤销等
  foldKeymap,         // Ctrl+Q 折叠等
} from "@codemirror/commands";
import {
  searchKeymap,       // Ctrl+F 搜索等
} from "@codemirror/search";
import {
  closeBracketsKeymap,  // 自动闭合快捷键
  completionKeymap,     // 补全快捷键
} from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";

// 组合所有快捷键
keymap.of([
  ...closeBracketsKeymap,
  ...defaultKeymap,
  ...searchKeymap,
  ...historyKeymap,
  ...foldKeymap,
  ...completionKeymap,
  ...lintKeymap,
]),
```

### 自定义快捷键

```typescript
import { keymap } from "@codemirror/view";

const customKeymap = keymap.of([
  {
    key: "Mod-Enter",        // Ctrl/Cmd + Enter
    run: () => {
      console.log("Ctrl+Enter pressed!");
      return true;  // 表示已处理
    },
  },
  {
    key: "Mod-k",            // Ctrl/Cmd + K
    run: (view) => {
      // 执行命令
      return true;
    },
  },
]);

// Mod = Ctrl (Windows/Linux) 或 Cmd (Mac)
```

---

## 7.11 更新监听

### EditorView.updateListener

```typescript
import { EditorView } from "@codemirror/view";

// 监听更新
EditorView.updateListener.of((update) => {
  // 文档变化
  if (update.docChanged) {
    const newContent = update.state.doc.toString();
    onChange?.(newContent);
  }

  // 选区变化
  if (update.selectionSet) {
    const sel = update.state.selection.main;
    console.log("Selection:", sel.from, "-", sel.to);
  }

  // 聚焦变化
  if (update.focusChanged) {
    console.log("Focused:", update.view.hasFocus);
  }
});
```

### 完整示例

```typescript
// 在 Polaris 中的使用
EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    // 将新内容通知给父组件
    onChange(update.state.doc.toString());
  }
})
```

---

## 7.12 第三方扩展

### 缩进标记

```typescript
import { indentationMarkers } from "@replit/codemirror-indentation-markers";

const extensions = [
  indentationMarkers(),  // 显示缩进线
];
```

### 小地图

```typescript
// src/features/editor/extensions/minimap.ts
import { Minimap } from "@replit/codemirror-minimap";

export const minimap = () => Minimap();
```

### Polaris 的完整扩展列表

```typescript
const extensions = [
  oneDark,                            // 暗色主题
  customTheme,                        // 自定义主题
  customSetup,                        // 基础设置
  languageExtension,                  // 语言支持
  suggestion(fileName),               // AI 建议
  quickEdit(fileName),                // 快速编辑
  selectionTooltip(),                 // 选择提示
  keymap.of([indentWithTab]),         // Tab 缩进
  minimap(),                          // 小地图
  indentationMarkers(),               // 缩进标记
  // 更新监听
  EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange(update.state.doc.toString());
    }
  }),
];
```

---

## 7.13 在 React 中使用 CodeMirror

### 使用 useRef

```typescript
function CodeEditor({ fileName, initialValue, onChange }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    // 创建视图
    const view = new EditorView({
      doc: initialValue,
      parent: editorRef.current,
      extensions: [...],
    });

    viewRef.current = view;

    // 清理
    return () => {
      view.destroy();
    };
  }, [/* 依赖项 */]);

  return <div ref={editorRef} />;
}
```

### 注意事项

1. **依赖项管理**：`useEffect` 的依赖数组要谨慎设置
2. **内存泄漏**：确保在 `useEffect` 的清理函数中调用 `view.destroy()`
3. **懒加载**：考虑使用 `React.lazy` 懒加载编辑器

---

## 7.14 练习建议

1. **阅读源码**：阅读 `code-editor.tsx` 和 `custom-setup.ts`
2. **添加新语言**：在 `language-extension.ts` 中添加 Rust 或 Go 支持
3. **自定义主题**：修改 `customTheme` 更改编辑器样式
4. **添加扩展**：为编辑器添加搜索功能

### 实践：添加 Rust 语言支持

```typescript
// 1. 安装包
// npm install @codemirror/lang-rust

// 2. 修改 language-extension.ts
import { rust } from "@codemirror/lang-rust";

case "rs":
  return rust();
```

### 实践：创建自定义编辑器包装组件

```typescript
// src/components/my-editor.tsx
"use client";

import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";

export function MyEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const view = new EditorView({
      doc: value,
      parent: ref.current,
      extensions: [
        oneDark,
        lineNumbers(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
      ],
    });

    return () => view.destroy();
  }, []);

  return <div ref={ref} />;
}
```

---

## 7.15 总结

本节课我们了解到：

- ✅ **CodeMirror 6 简介**：模块化架构 vs CodeMirror 5
- ✅ **核心概念**：EditorState（状态）、EditorView（视图）
- ✅ **Extension 系统**：可组合的扩展机制
- ✅ **Polaris 集成**：CodeEditor 组件结构
- ✅ **语言扩展**：JavaScript、TypeScript、Python 等
- ✅ **主题系统**：内置主题、自定义主题
- ✅ **常用扩展**：行号、折叠、括号匹配、自动补全
- ✅ **Keymap**：快捷键配置
- ✅ **更新监听**：docChanged、selectionSet 等
- ✅ **第三方扩展**：缩进标记、小地图

**下一课预告**：编辑器扩展开发 - 深入理解如何开发自定义 CodeMirror 扩展。
