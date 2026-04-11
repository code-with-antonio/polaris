# 第 13 课：Feature-First 架构实战

> **学习目标：** 通过实际案例深入理解 Polaris 项目中 Feature-First 架构的设计思想、模块划分、代码组织，以及从零开发一个新功能的完整流程。

---

## 一、什么是 Feature-First？

Feature-First（功能优先）是一种代码组织策略。它的核心理念是：

> **按功能模块组织代码，而非按技术类型分层。**

### 1.1 Layer-First vs Feature-First 对比

假设我们需要做一个"文件管理"功能，两种组织方式的区别：

**Layer-First（层优先）—— 按技术类型分文件夹：**

```
src/
  components/
    file-explorer.tsx
    file-tree.tsx
    file-item.tsx
    editor.tsx
    preview.tsx
  hooks/
    use-files.ts
    use-projects.ts
    use-editor.ts
  stores/
    editor-store.ts
  services/
    file-service.ts
    project-service.ts
```

**Feature-First（功能优先）—— 按功能模块分文件夹：**

```
src/features/
  projects/
    components/file-explorer/
    hooks/use-files.ts
    hooks/use-projects.ts
  editor/
    components/code-editor.tsx
    components/editor-view.tsx
    hooks/use-editor.ts
    store/use-editor-store.ts
    extensions/
  preview/
    components/preview-terminal.tsx
    hooks/use-webcontainer.ts
```

### 1.2 深度对比表

| 维度 | Layer-First | Feature-First |
|------|-------------|---------------|
| **导航速度** | 慢 — 需要跨多个目录跳转 | 快 — 功能代码集中在一处 |
| **模块内聚性** | 低 — 一个功能的代码散落在各处 | 高 — 功能相关代码物理相邻 |
| **删除功能** | 困难 — 要从多个目录清理文件 | 简单 — 删除整个功能文件夹 |
| **团队协作** | 容易冲突 — 多人改同一目录 | 冲突少 — 各自改各自的功能目录 |
| **复用判断** | 看似容易复用，实际耦合严重 | 复用需明确跨模块 import，更有意为之 |
| **适用场景** | 小型项目、功能少且稳定 | 中大型项目、功能多且迭代频繁 |

### 1.3 Polaris 选择 Feature-First 的原因

1. **功能多且独立性强** — 编辑器、对话、预览、项目管理各有复杂逻辑
2. **快速定位代码** — 想改 AI 对话功能，直接进 `conversations/` 目录
3. **可扩展** — 新增功能只需添加一个 feature 文件夹，不影响已有代码
4. **新人友好** — 一个 feature 文件夹就是一个完整的"微应用"

---

## 二、Polaris 的 Feature-First 目录结构

### 2.1 整体架构

```
src/
  app/                  ← Next.js 路由层（极薄）
    page.tsx            ←   首页 → 委托给 ProjectsView
    layout.tsx          ←   根布局 → 委托给 Providers
    projects/[projectId]/ ← 项目页 → 委托给 ProjectIdView/ProjectIdLayout
  components/           ← 全局共享组件
    ui/                 ←   shadcn/ui 基础组件（Button, Dialog, Popover...）
    ai-elements/        ←   AI 对话 UI 组件库（Message, Tool, Artifact...）
    providers.tsx       ←   Provider 树（Clerk, Convex, Theme）
    theme-provider.tsx  ←   主题 Provider
  features/             ← 功能模块（核心）
    auth/               ←   认证模块
    conversations/      ←   AI 对话模块
    editor/             ←   代码编辑器模块
    preview/            ←   预览终端模块
    projects/           ←   项目管理模块
  hooks/                ← 全局 Hooks（极少）
    use-mobile.ts       ←   响应式断点检测
  inngest/              ← 后台任务基础设施
    client.ts           ←   Inngest 客户端
  lib/                  ← 共享工具
    utils.ts            ←   cn() 工具函数
    convex-client.ts    ←   Convex HTTP 客户端
    firecrawl.ts        ←   URL 抓取客户端
```

### 2.2 5 个 Feature 模块概览

| 模块 | 文件数 | 职责 | 包含的子目录 |
|------|--------|------|-------------|
| **auth** | 2 | 未认证/加载状态视图 | `components/` |
| **conversations** | 16 | AI 对话、聊天历史、Agent 工具 | `components/`, `hooks/`, `inngest/`, `constants.ts` |
| **editor** | 11 | CodeMirror 编辑器、标签页、主题 | `components/`, `hooks/`, `store/`, `extensions/` |
| **preview** | 3 | WebContainer 预览、终端 | `components/`, `hooks/`, `utils/` |
| **projects** | 17 | 项目 CRUD、文件树、GitHub 集成 | `components/`, `hooks/`, `inngest/` |

### 2.3 Feature 模块内部约定

每个 feature 模块内部按**类型**分子目录，遵循统一约定：

```
features/<feature-name>/
  components/       ← React 组件（仅本功能使用）
  hooks/            ← 自定义 React Hooks
  store/            ← Zustand 状态管理（如需要）
  extensions/       ← 插件/扩展（如 CodeMirror 扩展）
  utils/            ← 纯函数工具
  constants.ts      ← 共享常量
  inngest/          ← 后台任务函数（如需要）
    tools/          ←   Agent 工具定义
```

**不是每个模块都有所有子目录**。目录的存在与否取决于功能的实际需要。

---

## 三、Feature 模块是如何被使用的？

### 3.1 薄路由层：App Router 只做委托

在 Feature-First 架构中，`app/` 目录非常薄，只做一件事：把请求委托给对应的 Feature 组件。

**`src/app/page.tsx`（首页）：**

```tsx
import { ProjectsView } from "@/features/projects/components/projects-view";

export default function Home() {
  return <ProjectsView />;
}
```

**`src/app/projects/[projectId]/page.tsx`（项目页）：**

```tsx
import { ProjectIdView } from "@/features/projects/components/project-id-view";

export default function ProjectIdPage({
  params,
}: {
  params: Promise<{ projectId: Id<"projects"> }>;
}) {
  return <ProjectIdViewContainer />;
}
```

> **关键原则：`app/` 目录不包含业务逻辑，它只是一个路由分发层。**

### 3.2 路由层 → Feature → Feature 的委托链

```
app/projects/[projectId]/page.tsx
  └── ProjectIdLayout (projects feature)
        ├── ConversationSidebar (conversations feature)
        └── children → ProjectIdView (projects feature)
              ├── FileExplorer (projects feature)
              ├── EditorView (editor feature)
              └── PreviewView (projects feature → 使用 preview feature)
```

---

## 四、跨 Feature 通信

这是 Feature-First 架构中最关键的问题：当功能需要互相协作时，怎么办？

### 4.1 通信方式总览

Polaris 使用三种跨 Feature 通信方式：

1. **Props 传递 `projectId`** — 最主要的协调机制
2. **Convex 响应式数据库** — 隐式的数据同步
3. **直接 import 其他 Feature 的 Hooks/组件** — 显式的依赖

### 4.2 方式一：Props 传递 `projectId`

`projectId` 是整个应用的**协调键**。从页面级别传入，然后通过 props 逐层传递给其他 Feature 的组件。

```
ProjectIdLayout (收到 projectId)
  ├── ConversationSidebar (projectId)  ← conversations feature
  └── ProjectIdView (projectId)         ← projects feature
        ├── FileExplorer (projectId)     ← projects feature
        ├── EditorView (projectId)       ← editor feature
        └── PreviewView (projectId)      ← preview feature
```

**代码示例 — `ProjectIdLayout`：**

```tsx
export const ProjectIdLayout = ({
  projectId,
  children,
}: {
  projectId: Id<"projects">;
  children: React.ReactNode;
}) => {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Navbar projectId={projectId} />
      <div className="flex-1 flex overflow-hidden">
        <ConversationSidebar projectId={projectId} />  {/* ← 传入 conversations feature */}
        <main className="flex-1 min-w-0">
          {children}  {/* ← 包含 ProjectIdView，也收到 projectId */}
        </main>
      </div>
    </div>
  );
};
```

### 4.3 方式二：Convex 作为响应式通信总线

这是 Polaris 中最强大的通信方式。**Feature 之间不直接通信，它们都监听 Convex 数据库，Convex 的实时更新自动同步变化。**

```
AI Agent (conversations feature)
  └── 通过 Agent Tool 修改文件 → 调用 Convex Mutation
        ↓
    Convex 数据库更新
        ↓
    ┌─────────────────────────────┐
    │                             │
Editor (editor feature)    Preview (preview feature)
  useFile() 自动更新          useFiles() 自动更新
    显示新内容                  热重载
```

**实际例子 — AI 创建文件后的自动更新：**

```tsx
// 1. conversations feature 的 Agent 调用 Convex mutation
// src/features/conversations/inngest/tools/create-files.ts
await convex.mutation(api.files.create, {
  projectId,
  path: "index.html",
  content: "<h1>Hello</h1>",
});

// 2. editor feature 正在使用 useQuery 订阅这个文件
// src/features/editor/components/editor-view.tsx
const file = useQuery(api.files.get, { fileId: activeTabId });
// → 自动收到更新，无需任何额外代码

// 3. preview feature 也自动收到更新
// src/features/preview/hooks/use-webcontainer.ts
const files = useQuery(api.files.list, { projectId });
// → 自动收到更新，写入 WebContainer 文件系统
```

> **这就是 Convex 的威力：Feature 之间完全解耦，通过数据库的响应式查询自动同步。**

### 4.4 方式三：直接 import

Feature 可以直接 import 其他 Feature 的组件和 Hooks。这不是严格隔离的架构，而是**基于约定的协作**。

**跨 Feature import 关系图：**

```
preview feature ──────→ projects feature
  (useFiles 读取文件)     (提供文件数据)

editor feature ───────→ projects feature
  (useFile, useUpdateFile)  (文件 CRUD)

projects feature ─────→ editor feature
  (EditorView 组件)       (编辑器展示)

projects feature ─────→ conversations feature
  (ConversationSidebar)    (AI 对话侧边栏)
```

**代码示例 — Editor 使用 Projects 的 Hooks：**

```tsx
// src/features/editor/components/editor-view.tsx
import { useFile, useUpdateFile } from "@/features/projects/hooks/use-files";

export const EditorView = ({ projectId }: { projectId: Id<"projects"> }) => {
  const { activeTabId } = useEditorStore();
  const file = useQuery(api.files.get, { fileId: activeTabId });
  const updateFile = useUpdateFile();

  // ... 编辑器逻辑
};
```

> **注意：** 项目没有用 ESLint 等工具强制禁止跨 Feature import。隔离是靠**团队约定和代码审查**，而非工具强制执行。

---

## 五、哪些代码放 Feature？哪些放 Shared？

这是 Feature-First 架构中最重要的决策之一。

### 5.1 判断规则

| 条件 | 放在 |
|------|------|
| 只被一个 Feature 使用 | 放在该 Feature 的 `components/` 或 `hooks/` |
| 被 2+ 个 Feature 使用 | 考虑提到 `src/components/` 或 `src/hooks/` |
| 是 UI 基础组件（Button, Dialog） | `src/components/ui/` (shadcn/) |
| 是全局状态（仅一个 Feature 需要） | 放在该 Feature 的 `store/` |
| 是工具函数 | 如果只被一个 Feature 用，放 `features/x/utils/`；否则放 `src/lib/` |

### 5.2 实际案例分析

**案例 1：`use-mobile.ts` 为什么是全局的？**

```tsx
// src/hooks/use-mobile.ts
// 这个 hook 可能被任何组件使用（响应式设计）
// → 放在全局 hooks/
```

**案例 2：`cn()` 为什么是全局的？**

```tsx
// src/lib/utils.ts
// 每个组件都需要合并 className
// → 放在全局 lib/
```

**案例 3：Editor 的 Zustand Store 为什么在 Feature 内？**

```tsx
// src/features/editor/store/use-editor-store.ts
// 只有 editor feature 需要管理标签页状态
// → 放在 editor feature 的 store/
```

**案例 4：AI 消息组件为什么是共享的？**

```tsx
// src/components/ai-elements/
// 这些组件被 conversations feature 和 editor 的 AI 功能同时使用
// → 放在全局 components/
```

---

## 六、Hooks 的封装模式

Polaris 中的 Hooks 有两层封装，这是一个重要的设计模式。

### 6.1 数据层 Hooks（Convex Hooks）

这些 Hooks 封装了与 Convex 数据库的交互：

```tsx
// src/features/projects/hooks/use-files.ts
// 封装 Convex 查询，提供乐观更新

export const useCreateFile = () => {
  return useMutation(api.files.create).withOptimisticUpdate(
    (localStore, args) => {
      const files = localStore.getQuery(api.files.list, { projectId: args.projectId });
      if (files) {
        localStore.setQuery(api.files.list, { projectId: args.projectId }, (old = []) => [
          ...old,
          { /* 乐观插入 */ }
        ]);
      }
    }
  );
};
```

### 6.2 表现层 Hooks（Feature Hooks）

这些 Hooks 封装了业务逻辑和状态访问：

```tsx
// src/features/editor/hooks/use-editor.ts
// 薄封装，将 projectId 绑定到 store
export const useEditor = (projectId: Id<"projects">) => {
  const editorStore = useEditorStore();
  return {
    ...editorStore,
    projectId,
  };
};
```

### 6.3 为什么 hooks 在 Feature 内部而非全局？

```
全局 hooks/          ← 只有 use-mobile.ts（因为确实全局通用）
Feature hooks/       ← 所有业务 hooks（use-files, use-editor, use-conversations）
```

这个分配体现了 Feature-First 的理念：**hooks 是功能的内部实现细节，不应该提升到全局。**

---

## 七、状态管理的边界设计

Polaris 中只有一种场景使用了客户端状态管理（Zustand），其他所有状态都通过 Convex 管理。

### 7.1 状态分层

```
┌─────────────────────────────────────────┐
│ Convex (服务端状态)                      │
│   - 项目数据                              │
│   - 文件数据                              │
│   - 对话/消息                             │
│   - 用户数据                              │
│   → 通过 useQuery 订阅，自动实时更新       │
├─────────────────────────────────────────┤
│ Zustand (客户端状态)                     │
│   - 编辑器标签页                          │
│   - 当前激活的文件                         │
│   - 预览标签                              │
│   → 仅 UI 状态，不持久化到数据库           │
├─────────────────────────────────────────┤
│ React useState                          │
│   - 组件级 UI 状态（展开/折叠、弹窗开关）   │
│   → 最局部，生命周期跟随组件               │
└─────────────────────────────────────────┘
```

### 7.2 为什么只用一个 Zustand Store？

| 方案 | 优点 | 缺点 |
|------|------|------|
| 全部用 Zustand | 响应快 | 需要手动同步服务端，容易不一致 |
| 全部用 Convex | 自动实时同步 | 纯 UI 状态（如标签页）没必要存数据库 |
| **混合方案（Polaris 采用）** | 数据走 Convex，UI 状态走 Zustand | 需要判断哪些是什么状态 |

> **最佳实践：优先使用 Convex（服务端状态），只有纯 UI 交互状态才用 Zustand。**

---

## 八、后台任务的 Feature 内聚

Inngest 后台任务也被组织在 Feature 模块内部。

### 8.1 文件分布

```
src/features/conversations/inngest/
  process-message.ts        ← AI 消息处理函数
  tools/                    ← Agent 工具定义
    create-files.ts
    update-file.ts
    ...

src/features/projects/inngest/
  import-github-repo.ts     ← GitHub 导入
  export-to-github.ts       ← GitHub 导出
```

### 8.2 中央注册

虽然后台函数定义在各 Feature 内，但它们在统一的路由中注册：

```tsx
// src/app/api/inngest/route.ts
import { processMessage } from "@/features/conversations/inngest/process-message";
import { importGithubRepo } from "@/features/projects/inngest/import-github-repo";
import { exportToGithub } from "@/features/projects/inngest/export-to-github";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processMessage, importGithubRepo, exportToGithub],
});
```

> **模式：定义在 Feature 内，注册在基础设施层。定义和关注点内聚，注册集中管理。**

---

## 九、实战：从零开发一个新 Feature

现在让我们通过一个完整案例来实践 Feature-First 架构。

### 9.1 需求：添加"终端（Terminal）"功能

假设我们要给 Polaris 添加一个独立的终端面板，用户可以在其中运行命令，不依赖 WebContainer 预览。

### 9.2 第一步：创建 Feature 目录结构

```
src/features/terminal/
  components/
    terminal-view.tsx       ← 终端主面板
    terminal-toolbar.tsx    ← 工具栏（清屏、连接状态）
  hooks/
    use-terminal.ts         ← 终端 Hook（连接 WebContainer，管理输出）
  constants.ts              ← 终端配置常量
```

### 9.3 第二步：定义常量

```tsx
// src/features/terminal/constants.ts
export const TERMINAL_ROWS = 24;
export const TERMINAL_COLS = 80;
export const TERMINAL_FONT_FAMILY = '"Cascadia Code", "Fira Code", monospace';
export const TERMINAL_THEME = {
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  cursor: "#ffffff",
};
```

### 9.4 第三步：编写 Hook

```tsx
// src/features/terminal/hooks/use-terminal.ts
import { useState, useEffect, useRef } from "react";
import { useWebContainer } from "@/features/preview/hooks/use-webcontainer";

export const useTerminal = () => {
  const { webContainer, isLoading } = useWebContainer();
  const [isConnected, setIsConnected] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const processRef = useRef<any>(null);

  useEffect(() => {
    if (!webContainer || isLoading) return;

    const spawnTerminal = async () => {
      const process = await webContainer.spawn("jsh", {
        terminal: {
          cols: TERMINAL_COLS,
          rows: TERMINAL_ROWS,
        },
      });
      processRef.current = process;
      setIsConnected(true);

      // 读取输出
      process.output.pipeTo(
        new WritableStream({
          write(data) {
            setOutput((prev) => [...prev, data]);
          },
        })
      );
    };

    spawnTerminal();

    return () => {
      processRef.current?.kill();
    };
  }, [webContainer, isLoading]);

  const write = (command: string) => {
    processRef.current?.input.write(command);
  };

  const clear = () => setOutput([]);

  return { output, isConnected, write, clear };
};
```

### 9.5 第四步：编写组件

```tsx
// src/features/terminal/components/terminal-view.tsx
import { useTerminal } from "../hooks/use-terminal";
import { TERMINAL_THEME, TERMINAL_FONT_FAMILY } from "../constants";

export const TerminalView = () => {
  const { output, isConnected, write, clear } = useTerminal();

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e] text-[#d4d4d4]">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-700">
        <span className="text-xs text-muted-foreground">
          {isConnected ? "Connected" : "Connecting..."}
        </span>
        <button onClick={clear} className="text-xs text-muted-foreground hover:text-foreground">
          Clear
        </button>
      </div>

      {/* 终端输出 */}
      <pre
        style={{ fontFamily: TERMINAL_FONT_FAMILY, fontSize: "13px" }}
        className="flex-1 overflow-auto p-3"
      >
        {output.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </pre>

      {/* 输入行 */}
      <div className="flex items-center px-3 py-1 border-t border-gray-700">
        <span className="text-green-400 mr-2">$</span>
        <input
          className="flex-1 bg-transparent outline-none text-[#d4d4d4] font-mono text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              write(e.currentTarget.value + "\n");
              e.currentTarget.value = "";
            }
          }}
        />
      </div>
    </div>
  );
};
```

### 9.6 第五步：集成到现有页面

修改 `ProjectIdView`，添加 Terminal 标签页：

```tsx
// src/features/projects/components/project-id-view.tsx
// ... 已有 imports
import { TerminalView } from "@/features/terminal/components/terminal-view";  // 新

export const ProjectIdView = ({ projectId }: { projectId: Id<"projects"> }) => {
  const [activeView, setActiveView] = useState<"editor" | "preview" | "terminal">("editor");  // 添加 terminal

  return (
    <div className="h-full flex flex-col">
      <nav className="h-8.75 flex items-center bg-sidebar border-b">
        <Tab label="Code" isActive={activeView === "editor"} onClick={() => setActiveView("editor")} />
        <Tab label="Preview" isActive={activeView === "preview"} onClick={() => setActiveView("preview")} />
        <Tab label="Terminal" isActive={activeView === "terminal"} onClick={() => setActiveView("terminal")} />  {/* 新 */}
        {/* ... */}
      </nav>
      {/* ... Code 和 Preview 视图 ... */}
      <div className={cn(
        "absolute inset-0",
        activeView === "terminal" ? "visible" : "invisible"
      )}>
        <TerminalView />  {/* 新 */}
      </div>
    </div>
  );
};
```

### 9.7 总结：新 Feature 开发流程

```
1. 确定需求范围
     ↓
2. 在 src/features/ 下创建新目录
     ↓
3. 按约定创建子目录（components/, hooks/, utils/, constants.ts）
     ↓
4. 定义常量（constants.ts）
     ↓
5. 编写 Hooks（封装数据获取和业务逻辑）
     ↓
6. 编写组件（使用 Hooks，处理 UI）
     ↓
7. 在其他 Feature 的页面中集成（跨 Feature import）
     ↓
8. 如需后台任务，在 inngest/ 下定义函数
     ↓
9. 在 src/app/api/inngest/route.ts 中注册
```

---

## 十、架构优势与注意事项

### 10.1 优势总结

1. **快速定位** — 知道功能属于哪个模块，就能快速找到代码
2. **独立开发** — 多人可以同时开发不同 Feature，互不干扰
3. **易于删除** — 删除一个功能只需删除一个文件夹
4. **自然分层** — 每个 Feature 内部有自己的 components/hooks/store
5. **渐进式理解** — 新人可以先理解一个 Feature，再理解整个项目

### 10.2 注意事项

| 问题 | 建议 |
|------|------|
| 跨 Feature import 过多 | 考虑是否需要提取共享模块 |
| Feature 变得过大 | 拆分为子 Feature，或将通用逻辑提到全局 |
| Feature 过小（1-2 个文件） | 考虑是否可以合并到相关 Feature |
| 循环依赖 | 通过提升公共代码到全局 `lib/` 或 `hooks/` 解决 |
| 组件归属不清 | 如果 2+ 个 Feature 都需要，提到 `src/components/` |

### 10.3 规模指标参考

| 指标 | 健康范围 | 预警 |
|------|---------|------|
| 单个 Feature 文件数 | 5-20 个 | > 30 个考虑拆分 |
| 跨 Feature import 数量 | 每个 Feature 1-3 个 | > 5 个考虑重构 |
| 全局 hooks/ 文件数 | 0-5 个 | > 10 个说明 Feature 边界可能不对 |
| 全局 components/ 数量 | 基础组件 + AI 元素 | 业务组件不该放这里 |

---

## 十一、关键架构洞察

### 洞察 1：Feature 边界是"约定的"，不是"强制的"

Polaris 没有使用 ESLint 规则、Monorepo package 隔离等工具来强制 Feature 之间的边界。模块间的隔离靠**团队纪律和代码审查**。这是权衡后的选择：强制隔离会增加复杂性，而小团队通过约定即可维护好架构。

### 洞察 2：`projectId` 是跨 Feature 协调的核心

整个应用围绕"项目"展开。`projectId` 从页面级别传入，然后通过 props 传递给所有 Feature 的组件。这确保了所有 Feature 都在操作同一个项目的数据。

### 洞察 3：Convex 是隐式的消息总线

Feature 之间不发送事件，不调用对方的 API。它们都读写同一个数据库，Convex 的响应式查询自动完成数据同步。这是一种**共享状态模型**，而非消息传递模型。

### 洞察 4：Zustand 仅用于 UI 状态

整个项目只有一个 Zustand Store（编辑器的标签页状态）。这是因为大部分状态（文件、项目、对话）都是服务端状态，由 Convex 管理。Zustand 只处理不需要持久化的纯客户端 UI 状态。

### 洞察 5：后台任务定义分散，注册集中

Inngest 函数定义在各自的 Feature 模块中（内聚），但在 `app/api/inngest/route.ts` 中统一注册。这是**关注点分离**的好例子：实现细节就近存放，基础设施集中管理。

---

## 十二、实践练习

### 练习 1：分析现有 Feature

打开 `src/features/conversations/` 目录，画出它的内部结构图，标注每个文件的职责。

### 练习 2：设计新 Feature

假设你要添加一个"版本历史（Version History）"功能，允许用户查看和恢复文件的历史版本。请设计：
- 目录结构
- 需要哪些组件
- 需要哪些 Hooks
- 需要和哪些现有 Feature 交互
- 常量、工具函数放哪里

### 练习 3：重构决策

`use-mobile.ts` 目前在全局 `hooks/` 中。如果项目中又出现了 5 个全局 Hooks，你觉得应该怎么做？什么情况下应该将它们移到某个 Feature 内部？

---

## 扩展阅读

- [Feature-Sliced Design](https://feature-sliced.design/) — 另一种 Feature-First 的变体，有更严格的层级规则
- [Domain-Driven Design](https://martinfowler.com/bliki/DomainDrivenDesign.html) — 领域驱动设计，Feature-First 的思想源头之一
- [Convex React 文档](https://docs.convex.dev/home) — 理解 Convex 响应式查询的工作方式
- [Zustand 文档](https://github.com/pmndrs/zustand) — 轻量级状态管理
