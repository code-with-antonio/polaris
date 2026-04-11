# 第 6 课：Zustand 状态管理

> 本课目标：掌握 Zustand 的核心概念、状态管理范式、在编辑器场景中的应用

---

## 6.1 状态管理简介

在复杂应用中，组件之间需要共享状态。状态管理库帮助我们组织和更新全局状态。

### 状态管理的演进

| 方案 | 特点 | 问题 |
|------|------|------|
| Prop Drilling | 通过 props 层层传递 | 代码耦合深，难以维护 |
| Context API | React 内置的跨组件传值 | 适合简单场景，频繁更新性能差 |
| Redux | 功能强大，生态丰富 | 模板代码多，学习曲线陡 |
| **Zustand** | 轻量、简洁、类型安全 | 生态较小 |

### Zustand 的优势

```typescript
// Zustand：简洁的 API
import { create } from "zustand";

const useStore = create((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));

// 使用：像使用 React Hook 一样
function Counter() {
  const { count, increment } = useStore();
  return <button onClick={increment}>{count}</button>;
}
```

### Zustand vs Redux

| 特性 | Zustand | Redux |
|------|---------|-------|
| 代码量 | 少（~100 行核心） | 多（需要模板代码） |
| 学习曲线 | 平缓 | 陡峭 |
| Boilerplate | 几乎不需要 | 大量 action/reducer |
| DevTools | 支持 | 支持 |
| 性能 | 优秀 | 优秀 |
| Middleware | 支持 | 支持（更丰富） |

---

## 6.2 Zustand 核心概念

Zustand 的核心是 `create` 函数，它接收一个带 `set` 和 `get` 的函数，返回一个 Hook。

### 基本结构

```typescript
import { create } from "zustand";

// 定义状态和方法的类型
interface CounterStore {
  count: number;
  increment: () => void;
  decrement: () => void;
  reset: () => void;
}

// 创建 Store
const useCounterStore = create<CounterStore>((set, get) => ({
  // 状态
  count: 0,

  // 方法
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
  reset: () => set({ count: 0 }),
}));
```

### set 和 get

```typescript
const useStore = create((set, get) => ({
  // set：更新状态
  // 方式1：传入部分状态，浅合并
  set({ count: 10 });

  // 方式2：传入函数，返回新状态
  set((state) => ({ count: state.count + 1 }));

  // get：获取当前状态（不触发更新）
  const currentCount = get().count;

  // 常用模式：在 action 中先 get，再 set
  increment: () => {
    const { count } = get();  // 获取当前值
    if (count < 10) {         // 做判断
      set({ count: count + 1 });  // 更新
    }
  },
}));
```

---

## 6.3 Polaris 编辑器 Store

Polaris 使用 Zustand 管理编辑器的 Tab 状态。

### EditorStore 结构

```typescript
// src/features/editor/store/use-editor-store.ts
import { create } from "zustand";
import { Id } from "../../../../convex/_generated/dataModel";

// 单个项目的 Tab 状态
interface TabState {
  openTabs: Id<"files">[];           // 打开的文件 ID 列表
  activeTabId: Id<"files"> | null;   // 当前激活的 Tab
  previewTabId: Id<"files"> | null;  // 预览 Tab（固定）
}

// 默认状态
const defaultTabState: TabState = {
  openTabs: [],
  activeTabId: null,
  previewTabId: null,
};

// 完整的编辑器 Store
interface EditorStore {
  // 状态：以 projectId 为 key 的 Map
  tabs: Map<Id<"projects">, TabState>;

  // 方法
  getTabState: (projectId: Id<"projects">) => TabState;
  openFile: (projectId, fileId, options: { pinned: boolean }) => void;
  closeTab: (projectId, fileId) => void;
  closeAllTabs: (projectId) => void;
  setActiveTab: (projectId, fileId) => void;
}

// 创建 Store
export const useEditorStore = create<EditorStore>()((set, get) => ({
  tabs: new Map(),

  // 获取指定项目的 Tab 状态
  getTabState: (projectId) => {
    return get().tabs.get(projectId) ?? defaultTabState;
  },

  // 打开文件
  openFile: (projectId, fileId, { pinned }) => {
    // ...
  },

  // 关闭 Tab
  closeTab: (projectId, fileId) => {
    // ...
  },

  // 关闭所有 Tab
  closeAllTabs: (projectId) => {
    // ...
  },

  // 设置激活 Tab
  setActiveTab: (projectId, fileId) => {
    // ...
  },
}));
```

### 为什么用 Map 存储状态？

```typescript
// 使用 Map 的优势：一个 store 管理多个项目
const tabs: Map<Id<"projects">, TabState> = new Map();

// 项目 A 的 Tab
tabs.set(projectAId, {
  openTabs: [file1, file2],
  activeTabId: file1,
  previewTabId: null,
});

// 项目 B 的 Tab（独立管理）
tabs.set(projectBId, {
  openTabs: [file3],
  activeTabId: file3,
  previewTabId: file3,
});
```

---

## 6.4 openFile 详解

`openFile` 是最复杂的 method，处理多种打开文件的场景。

### 场景分析

```typescript
openFile: (projectId, fileId, { pinned }) => {
  // 1. 获取当前项目状态
  const tabs = new Map(get().tabs);
  const state = tabs.get(projectId) ?? defaultTabState;
  const { openTabs, previewTabId } = state;

  // 2. 检查文件是否已打开
  const isOpen = openTabs.includes(fileId);
}
```

### 场景 1：新文件作为预览

```typescript
// 文件未打开，且作为预览打开
if (!isOpen && !pinned) {
  const newTabs = previewTabId
    ? openTabs.map((id) => (id === previewTabId) ? fileId : id)  // 替换预览
    : [...openTabs, fileId];  // 添加新 Tab

  tabs.set(projectId, {
    openTabs: newTabs,
    activeTabId: fileId,
    previewTabId: fileId,  // 更新预览 Tab
  });
  set({ tabs });
}
```

### 场景 2：固定文件

```typescript
// 文件未打开，且固定打开
if (!isOpen && pinned) {
  tabs.set(projectId, {
    ...state,
    openTabs: [...openTabs, fileId],
    activeTabId: fileId,
  });
  set({ tabs });
}
```

### 场景 3：已打开的文件

```typescript
// 文件已打开，只需激活
const shouldPin = pinned && previewTabId === fileId;
tabs.set(projectId, {
  ...state,
  activeTabId: fileId,
  previewTabId: shouldPin ? null : previewTabId,  // 如果是双击预览，取消预览状态
});
```

---

## 6.5 closeTab 详解

`closeTab` 处理复杂的逻辑：关闭 Tab 后自动激活相邻 Tab。

### 核心逻辑

```typescript
closeTab: (projectId, fileId) => {
  // 1. 获取状态
  const tabs = new Map(get().tabs);
  const state = tabs.get(projectId) ?? defaultTabState;
  const { openTabs, activeTabId, previewTabId } = state;

  // 2. 检查文件是否在列表中
  const tabIndex = openTabs.indexOf(fileId);
  if (tabIndex === -1) return;

  // 3. 从列表中移除
  const newTabs = openTabs.filter((id) => id !== fileId);

  // 4. 处理激活状态
  let newActiveTabId = activeTabId;

  if (activeTabId === fileId) {
    // 关闭的是当前激活的 Tab
    if (newTabs.length === 0) {
      // 没有其他 Tab 了
      newActiveTabId = null;
    } else if (tabIndex >= newTabs.length) {
      // 关闭的是最后一个 Tab，激活前一个
      newActiveTabId = newTabs[newTabs.length - 1];
    } else {
      // 激活被关闭位置的下一个
      newActiveTabId = newTabs[tabIndex];
    }
  }

  // 5. 清除预览状态（如果关闭的是预览 Tab）
  tabs.set(projectId, {
    openTabs: newTabs,
    activeTabId: newActiveTabId,
    previewTabId: previewTabId === fileId ? null : previewTabId,
  });
  set({ tabs });
}
```

### 关闭后激活逻辑图解

```
假设 openTabs = [A, B, C, D], activeTabId = C

情况1：关闭 C（当前激活）
  → 激活 C 的下一个 (D)

情况2：关闭 D（最后一个）
  → 激活 D 的前一个 (C)

情况3：关闭 B
  → 保持 C 激活
```

---

## 6.6 在组件中使用 Store

### 获取状态

```typescript
// 方式1：解构获取多个值（组件会自动订阅）
function TabBar({ projectId }: { projectId: Id<"projects"> }) {
  const { openTabs, activeTabId } = useEditorStore();

  return (
    <div>
      {openTabs.map((tabId) => (
        <Tab
          key={tabId}
          isActive={tabId === activeTabId}
        />
      ))}
    </div>
  );
}
```

### 精细化订阅

```typescript
// 方式2：使用选择器，只订阅需要的值
function ActiveTabIndicator({ projectId }: { projectId: Id<"projects"> }) {
  // 只订阅 activeTabId，openTabs 变化不会触发重渲染
  const activeTabId = useEditorStore(
    (state) => state.getTabState(projectId).activeTabId
  );

  return <span>Active: {activeTabId}</span>;
}
```

### 调用方法

```typescript
function FileTree({ projectId, fileId }) {
  const openFile = useEditorStore((state) => state.openFile);

  const handleClick = () => {
    openFile(projectId, fileId, { pinned: true });
  };

  return <button onClick={handleClick}>Open File</button>;
}
```

---

## 6.7 Zustand 的响应式更新

Zustand 使用浅比较判断是否需要更新组件。

### 默认行为

```typescript
// 默认使用浅比较（shallow）
const { a, b } = useStore();
// 当 a 或 b 的引用变化时触发更新
```

### 深层选择器

```typescript
import { useShallow } from "zustand/react/shallow";

// 使用 useShallow 进行浅比较
const { tabs, activeTabId } = useEditorStore(
  useShallow((state) => ({
    tabs: state.tabs,
    activeTabId: state.getTabState(projectId).activeTabId,
  }))
);
```

### 避免不必要的重渲染

```typescript
// ❌ 不好：每次调用都创建新对象
const { getTabState } = useEditorStore();  // 每次渲染都是新函数引用

// ✅ 好：使用选择器
const tabState = useEditorStore(
  (state) => state.getTabState(projectId)
);
```

---

## 6.8 Middleware

Zustand 支持 Middleware 来扩展功能。

### persist - 持久化

```typescript
import { persist, createJSONStorage } from "zustand/middleware";

const useStore = create(
  persist(
    (set) => ({
      count: 0,
      increment: () => set((s) => ({ count: s.count + 1 })),
    }),
    {
      name: "my-store",  // localStorage key
      storage: createJSONStorage(() => localStorage),
    }
  )
);
```

### devtools - Redux DevTools 集成

```typescript
import { devtools } from "zustand/middleware";

const useStore = create(
  devtools(
    (set) => ({
      count: 0,
      increment: () => set((state) => ({ count: state.count + 1 })),
    }),
    { name: "My Store" }  // DevTools 中的名称
  )
);
```

### immer - 不可变更新

```typescript
import { immer } from "zustand/middleware/immer";

const useStore = create(
  immer((set) => ({
    count: 0,
    // 直接修改 draft（像可变操作一样）
    increment: () => set((draft) => { draft.count++; }),
  }))
);
```

### combine - 合并状态

```typescript
import { combine } from "zustand/middleware";

const useStore = create(
  combine(
    { count: 0 },  // 基础状态
    (set) => ({
      increment: () => set((s) => ({ count: s.count + 1 })),
    })
  )
);
```

---

## 6.9 常见模式

### 派生状态（Computed Values）

```typescript
interface Store {
  items: string[];
  // 派生值作为方法实现
  getFilteredItems: (filter: string) => string[];
}

const useStore = create<Store>((set, get) => ({
  items: [],

  getFilteredItems: (filter) => {
    const { items } = get();
    return items.filter((item) =>
      item.toLowerCase().includes(filter.toLowerCase())
    );
  },
}));

// 使用
const filtered = useStore((s) => s.getFilteredItems("test"));
```

### 批量更新

```typescript
// 不好的方式：多次 set，触发多次更新
set((s) => ({ count: s.count + 1 }));
set((s) => ({ name: "new name" }));

// 好的方式：合并为一次 set
set((s) => ({ count: s.count + 1, name: "new name" }));
```

### 异步操作

```typescript
interface AsyncStore {
  data: null | Data;
  isLoading: boolean;
  error: null | Error;
  fetchData: () => Promise<void>;
}

const useStore = create<AsyncStore>((set) => ({
  data: null,
  isLoading: false,
  error: null,

  fetchData: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch("/api/data");
      const data = await response.json();
      set({ data, isLoading: false });
    } catch (error) {
      set({ error, isLoading: false });
    }
  },
}));
```

---

## 6.10 Zustand 在 Polaris 中的应用

### EditorStore 使用示例

```typescript
// src/features/editor/components/tabs.tsx
"use client";

import { useEditorStore } from "../store/use-editor-store";
import { Id } from "../../../../convex/_generated/dataModel";

export function EditorTabs({ projectId }: { projectId: Id<"projects"> }) {
  const { openTabs, activeTabId } = useEditorStore();
  const tabState = useEditorStore((s) => s.getTabState(projectId));

  const { openTabs: tabs, activeTabId } = tabState;

  return (
    <div className="flex gap-1">
      {tabs.map((tabId) => (
        <Tab
          key={tabId}
          fileId={tabId}
          isActive={tabId === activeTabId}
          onClose={() => useEditorStore.getState().closeTab(projectId, tabId)}
        />
      ))}
    </div>
  );
}
```

### Store 的优势

| 场景 | 使用 Store | 不用 Store |
|------|-----------|-----------|
| 跨组件共享 Tab 状态 | 多个组件访问同一个 store | 需要层层传递 props |
| 多项目 Tab 隔离 | Map 结构天然隔离 | 需要额外的 context |
| 预览 Tab 功能 | 内置 previewTabId | 难以实现 |
| 关闭后自动切换 | 业务逻辑在 store 中 | 需要在组件中处理 |

---

## 6.11 练习建议

1. **阅读 Store 源码**：仔细阅读 `use-editor-store.ts`，理解每个方法
2. **添加新功能**：在 EditorStore 中添加 `renameTab` 方法
3. **创建新 Store**：为项目创建一个设置 Store（主题、语言等）
4. **实现持久化**：为 EditorStore 添加 localStorage 持久化

### 实践：添加右键菜单功能

```typescript
// 1. 扩展 TabState
interface TabState {
  openTabs: Id<"files">[];
  activeTabId: Id<"files"> | null;
  previewTabId: Id<"files"> | null;
  contextMenuTabId: Id<"files"> | null;  // 新增
}

// 2. 添加打开/关闭右键菜单方法
interface EditorStore {
  // ...
  openContextMenu: (projectId: Id<"projects">, tabId: Id<"files">) => void;
  closeContextMenu: () => void;
}

// 3. 实现
openContextMenu: (projectId, tabId) => {
  const tabs = new Map(get().tabs);
  const state = tabs.get(projectId) ?? defaultTabState;
  tabs.set(projectId, { ...state, contextMenuTabId: tabId });
  set({ tabs });
},
```

### 实践：创建项目设置 Store

```typescript
interface ProjectSettingsStore {
  theme: "light" | "dark" | "system";
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setFontSize: (size: number) => void;
}

export const useProjectSettings = create<ProjectSettingsStore>((set) => ({
  theme: "system",
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,

  setTheme: (theme) => set({ theme }),
  setFontSize: (size) => set({ fontSize: size }),
}));
```

---

## 6.12 总结

本节课我们了解到：

- ✅ **Zustand 简介**：轻量级状态管理库，API 简洁
- ✅ **核心概念**：create、set、get
- ✅ **EditorStore 设计**：Tab 状态管理、Map 结构
- ✅ **openFile/closeTab**：复杂的 Tab 操作逻辑
- ✅ **组件使用**：useEditorStore、选择器模式
- ✅ **响应式更新**：浅比较、useShallow
- ✅ **Middleware**：persist、devtools、immer
- ✅ **常见模式**：派生状态、批量更新、异步操作

**下一课预告**：CodeMirror 6 编辑器集成 - 深入理解 CodeMirror 6 的核心概念和编辑器集成。
