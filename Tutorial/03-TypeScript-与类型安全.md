# 第 3 课：TypeScript 与类型安全

> 本课目标：理解项目中 TypeScript 的高级用法、类型设计和类型安全实践

---

## 3.1 TypeScript 在项目中的重要性

Polaris 项目是一个**全类型安全**的应用程序，从数据库到前端组件，每一个环节都充分利用了 TypeScript 的类型系统。

```
┌─────────────────────────────────────────────────────────────┐
│                      TypeScript 类型层级                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────┐    ┌─────────────────┐              │
│   │  Convex Schema  │───▶│  _generated/    │              │
│   │   (定义层)      │    │  (自动生成)     │              │
│   └─────────────────┘    └────────┬────────┘              │
│                                    │                       │
│                                    ▼                        │
│   ┌─────────────────┐    ┌─────────────────┐              │
│   │  Zustand Store  │◀───│  Editor State   │              │
│   │   (状态管理)     │    │   (编辑器状态)   │              │
│   └─────────────────┘    └─────────────────┘              │
│                                    │                       │
│                                    ▼                        │
│   ┌─────────────────┐    ┌─────────────────┐              │
│   │  API Response   │◀───│  AI SDK Types   │              │
│   │   (接口响应)     │    │   (AI 类型)     │              │
│   └─────────────────┘    └─────────────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3.2 TypeScript 配置详解

### tsconfig.json 核心配置

```json
{
  "compilerOptions": {
    // 路径别名：@/* 指向 src/*
    "paths": {
      "@/*": ["./src/*"]
    },
    // 严格模式 - 开启所有严格类型检查
    "strict": true,
    // 装饰器支持 - 用于 Inngest 函数
    "experimentalDecorators": true,
    // 允许导入 JSON 文件
    "resolveJsonModule": true,
    // ESNext 模块解析
    "module": "esnext",
    // 跳过库检查
    "skipLibCheck": true
  },
  // 只编译 src 和 convex 目录
  "include": ["src/**/*", "convex/**/*"],
  "exclude": ["node_modules"]
}
```

### 关键配置说明

| 配置项 | 作用 |
|--------|------|
| `strict: true` | 开启所有严格检查，确保类型安全 |
| `paths` | 配置 `@/*` 别名，简化导入路径 |
| `experimentalDecorators` | 支持 Inngest 的装饰器语法 |
| `resolveJsonModule` | 允许导入 JSON 文件 |

---

## 3.3 Convex 自动生成类型

Convex 最强大的特性之一是**自动生成类型**，无需手动维护。

### 生成的文件结构

```
convex/
├── _generated/
│   ├── api.d.ts        # API 函数类型
│   ├── api.js          # API 实现
│   ├── server.d.ts     # 服务端类型
│   ├── server.js       # 服务端实现
│   └── dataModel.d.ts  # 数据模型类型 ← 重点
```

### dataModel.d.ts - 数据模型类型

```typescript
// convex/_generated/dataModel.d.ts

import type { DataModelFromSchemaDefinition, DocumentByName, TableNamesInDataModel } from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";

// 表名联合类型
export type TableNames = TableNamesInDataModel<DataModel>;

// 文档类型 - 获取任意表的文档类型
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;

// Id 类型 - 类型安全的文档 ID
export type Id<TableName extends TableNames | SystemTableNames> = GenericId<TableName>;

// 完整数据模型
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
```

### 使用示例

```typescript
import { Id, Doc } from "@/convex/_generated/dataModel";

// 获取特定表的文档类型
type ProjectDoc = Doc<"projects">;
type FileDoc = Doc<"files">;
type MessageDoc = Doc<"messages">;

// 类型安全的 ID
type ProjectId = Id<"projects">;
type FileId = Id<"files">;

// 在函数参数中使用
function updateFile(fileId: FileId, content: string) {
  // fileId 被限制为 "files" 表的 ID
}
```

### api.d.ts - API 函数类型

```typescript
// convex/_generated/api.d.ts

import type * as projects from "../projects.js";
import type * as files from "../files.js";

// 完整的 API 类型
export declare const api: {
  projects: typeof projects;
  files: typeof files;
};

// 在前端使用
import { api } from "@/convex/client";

// 调用时自动类型检查
const projects = await api.projects.list.query();
```

---

## 3.4 Zustand 状态类型化

### Editor Store 类型定义

```typescript
// src/features/editor/store/use-editor-store.ts

import { create } from "zustand";
import { Id } from "../../../../convex/_generated/dataModel";

// 单个项目的 Tab 状态
interface TabState {
  openTabs: Id<"files">[];           // 打开的 Tab 列表
  activeTabId: Id<"files"> | null;   // 当前激活的 Tab
  previewTabId: Id<"files"> | null;  // 预览 Tab（固定）
}

// 完整的编辑器 Store 类型
interface EditorStore {
  // 状态
  tabs: Map<Id<"projects">, TabState>;
  
  // 方法
  getTabState: (projectId: Id<"projects">) => TabState;
  openFile: (
    projectId: Id<"projects">,
    fileId: Id<"files">,
    options: { pinned: boolean }
  ) => void;
  closeTab: (projectId: Id<"projects">, fileId: Id<"files">) => void;
  closeAllTabs: (projectId: Id<"projects">) => void;
  setActiveTab: (projectId: Id<"projects">, fileId: Id<"files">) => void;
}

// 创建 Store（类型自动推断）
export const useEditorStore = create<EditorStore>()((set, get) => ({
  tabs: new Map(),
  // ... 方法实现
}));
```

### 类型化优势

1. **自动补全**：编辑器会自动提示可用的方法和属性
2. **编译时检查**：错误的属性名会在编译时报错
3. **重构安全**：重命名属性时，TypeScript 会提示所有使用处

---

## 3.5 Zod 运行时验证

项目使用 **Zod** 进行 API 请求的运行时验证。

### Zod vs TypeScript

```
┌────────────────────────────────────────────────────────────┐
│                    TypeScript vs Zod                       │
├──────────────────────────┬─────────────────────────────────┤
│     TypeScript           │           Zod                   │
├──────────────────────────┼─────────────────────────────────┤
│ 编译时类型检查           │ 运行时类型验证                    │
│ 不生成代码               │ 生成验证函数                      │
│ 无法验证 JSON 解析       │ 验证 API 接收的 JSON 数据        │
│ 类型不可序列化           │ Schema 可序列化（API 文档）      │
└──────────────────────────┴─────────────────────────────────┘
```

### API 请求验证示例

```typescript
// src/app/api/messages/route.ts
import { z } from "zod";

// 定义请求 Schema
const requestSchema = z.object({
  conversationId: z.string(),
  message: z.string(),
});

export async function POST(request: Request) {
  // 解析并验证请求体
  const body = requestSchema.parse(await request.json());
  
  // body 类型被推断为：
  // { conversationId: string; message: string }
  
  // 使用验证后的数据
  const { conversationId, message } = body;
  // ...
}
```

### AI 工具参数验证

```typescript
// src/features/conversations/inngest/tools/update-file.ts
import { z } from "zod";

// 工具参数 Schema
const paramsSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  content: z.string(),
});

// 转换为 Inngest 工具定义
export const updateFileTool = {
  description: "Update a file with new content",
  parameters: z.object({
    fileId: z.string().describe("The ID of the file to update"),
    content: z.string().describe("The new content for the file"),
  }),
};
```

### 完整 Schema 示例

```typescript
// GitHub 导出 API Schema
const requestSchema = z.object({
  projectId: z.string(),
  repoName: z.string().min(1).max(100),           // 仓库名 1-100 字符
  description: z.string().max(350).optional(),    // 描述最多 350 字符
  visibility: z.enum(["private", "public"]).default("private"),
  accessToken: z.string().optional(),
});

// 验证错误时会抛出详细错误信息
// Error: [
//   {
//     code: "too_big",
//     message: "repoName must be at most 100 characters",
//     path: ["repoName"]
//   }
// ]
```

---

## 3.6 CodeMirror 类型系统

### EditorState 和 EditorView

```typescript
// src/features/editor/extensions/custom-setup.ts
import { Extension, EditorState } from "@codemirror/state";

// EditorState 是编辑器的不可变状态
const state = EditorState.create({
  doc: "console.log('Hello')",        // 文档内容
  selection: { anchor: 0 },            // 光标位置
  extensions: [
    // 扩展列表
  ],
});

// EditorView 是渲染后的视图
const view = new EditorView({
  state,
  parent: document.getElementById("editor"),
});
```

### StateField 状态字段

```typescript
// src/features/editor/extensions/selection-tooltip.ts
import { StateField, EditorState } from "@codemirror/state";
import { Tooltip, showTooltip, EditorView } from "@codemirror/view";

// 定义状态字段的类型
interface TooltipState {
  visible: boolean;
  position: { x: number; y: number };
  content: string;
}

// 创建状态字段
const tooltipField = StateField.define<TooltipState>({
  create() {
    return { visible: false, position: { x: 0, y: 0 }, content: "" };
  },
  update(state, tr) {
    // 处理事务更新状态
    // 返回新的 TooltipState
  },
  provide: (f) => EditorView.tooltip.from(f),
});
```

### 扩展类型

```typescript
// 扩展可以是以下类型：
type Extension =
  | StateField<any>                    // 状态字段
  | StateEffect<any>                   // 状态变更
  | EditorViewExtension                 // 视图扩展
  | Compartment                        // 可隔离的配置
  | Extension[];                       // 扩展数组（自动组合）
```

---

## 3.7 AI SDK 类型

### 流式响应类型

```typescript
// src/app/api/suggestion/route.ts
import { generateText, Output } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

// 定义输出 Schema
const suggestionSchema = z.object({
  suggestion: z.string().describe("建议插入的代码"),
});

// 使用结构化输出
const { output } = await generateText({
  model: anthropic("claude-3-7-sonnet-20250219"),
  output: Output.object({ schema: suggestionSchema }),
  prompt,
});

// output 类型被正确推断
const code: string = output.suggestion;
```

### 消息类型

```typescript
// AI 对话消息类型
type MessageRole = "user" | "assistant" | "system";

interface Message {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];  // AI 调用的工具
  toolResults?: ToolResult[]; // 工具执行结果
}

// 工具调用
interface ToolCall {
  toolName: string;
  args: Record<string, any>;
}
```

---

## 3.8 类型安全的最佳实践

### 1. 使用 const 断言

```typescript
// ❌ 不好 - 类型是 string
const route = "/projects/[id]";

// ✅ 更好 - 类型是 "/projects/[id]"
const route = "/projects/[id]" as const;
```

### 2. 避免 any

```typescript
// ❌ 不好 - 丢失类型信息
function process(data: any): any {}

// ✅ 更好 - 使用泛型
function process<T>(data: T): T { return data; }

// ✅ 更好 - 使用 unknown
function process(data: unknown): void {
  if (isUser(data)) {
    // data 在这里被推断为 User 类型
  }
}
```

### 3. 使用类型守卫

```typescript
// 类型守卫函数
function isFile(doc: unknown): doc is Doc<"files"> {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "type" in doc &&
    doc.type === "file"
  );
}

// 使用
if (isFile(doc)) {
  // doc 自动类型化为 Doc<"files">
}
```

### 4. 严格 null 检查

```typescript
// ❌ 不好 - 允许 undefined
function getName(user?: { name: string }) {
  return user.name; // 可能报错
}

// ✅ 更好 - 明确处理
function getName(user?: { name: string }) {
  return user?.name ?? "Anonymous";
}
```

---

## 3.9 类型文件速查表

| 文件 | 用途 |
|------|------|
| `tsconfig.json` | TypeScript 编译器配置 |
| `convex/_generated/dataModel.d.ts` | 数据库表类型定义 |
| `convex/_generated/api.d.ts` | Convex API 类型 |
| `src/features/editor/store/use-editor-store.ts` | Zustand Store 类型 |
| `src/app/api/*/route.ts` | API 请求/响应类型 |
| `src/features/conversations/inngest/tools/*.ts` | AI 工具参数类型 |

---

## 3.10 TypeScript 高级类型：泛型基础

泛型（Generics）允许创建可复用的组件，同时保持类型安全。

### 什么是泛型？

```typescript
// ❌ 没有泛型：类型丢失
function identity(arg: any): any {
  return arg;
}

// ✅ 有泛型：类型保留
function identity<T>(arg: T): T {
  return arg;
}

const num = identity<number>(42);      // num 类型是 number
const str = identity("hello");          // str 类型是 string（类型推断）
```

### 泛型约束

限制泛型的范围，确保类型具有特定属性。

```typescript
// 要求 T 必须有 length 属性
function logLength<T extends { length: number }>(arg: T): T {
  console.log(arg.length);
  return arg;
}

logLength("hello");      // ✓ string 有 length
logLength([1, 2, 3]);    // ✓ array 有 length
logLength(123);          // ✗ Error: number 没有 length
```

### 多类型参数

```typescript
// 映射类型：将 T 的所有属性转换为 U
function mapArray<T, U>(array: T[], fn: (item: T) => U): U[] {
  return array.map(fn);
}

const numbers = [1, 2, 3];
const strings = mapArray(numbers, (n) => String(n));  // ["1", "2", "3"]
```

### 泛型接口

```typescript
// Convex 风格的 API 接口
interface ApiEndpoint<TRequest, TResponse> {
  query: (request: TRequest) => Promise<TResponse>;
  mutation: (request: TRequest) => Promise<TResponse>;
}

interface GetProjectRequest {
  projectId: string;
}

interface GetProjectResponse {
  name: string;
  description: string;
}

const getProjectEndpoint: ApiEndpoint<GetProjectRequest, GetProjectResponse> = {
  query: async (request) => {
    const project = await db.projects.get(request.projectId);
    return project;
  },
};
```

### 泛型在项目中的应用

```typescript
// Zustand Store 的泛型用法
interface EditorStore<TFileId, TProjectId> {
  tabs: Map<TProjectId, TabState<TFileId>>;
  openFile: (projectId: TProjectId, fileId: TFileId) => void;
}

// Convex 的泛型定义
type Id<TableName extends string> = GenericId<TableName>;
```

---

## 3.11 TypeScript 高级类型：条件类型与映射类型

### 条件类型

根据类型条件选择不同的类型。

```typescript
// 基本语法：T extends U ? X : Y
type IsString<T> = T extends string ? "yes" : "no";

type A = IsString<string>;   // "yes"
type B = IsString<number>;   // "no"
```

### 分布式条件类型

当条件类型作用于联合类型时，会"分布式"处理。

```typescript
type ExtractStrings<T> = T extends string ? T : never;

type C = ExtractStrings<string | number | boolean>;  // string（只有 string 匹配）
type D = ExtractStrings<string | (() => void)>;     // string
```

### 映射类型

从现有类型创建新类型。

```typescript
// 将所有属性变为可选
type Partial<T> = {
  [P in keyof T]?: T[P];
};

// 将所有属性变为只读
type Readonly<T> = {
  readonly [P in keyof T]: T[P];
};

// 将所有属性变为必填
type Required<T> = {
  [P in keyof T]-?: T[P];
};

// 使用示例
interface Project {
  id: string;
  name: string;
  description: string;
}

type PartialProject = Partial<Project>;
// { id?: string; name?: string; description?: string }
```

### keyof 与索引访问

```typescript
// keyof：获取类型的所有键
type ProjectKeys = keyof Project;  // "id" | "name" | "description"

// 索引访问：获取属性类型
type ProjectNameType = Project["name"];  // string

// 组合使用
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const project: Project = { id: "1", name: "My Project", description: "Desc" };
const name = getProperty(project, "name");  // string
```

### 内置工具类型

TypeScript 提供了一系列内置工具类型：

```typescript
// Exclude<T, U>：从 T 中排除可赋值给 U 的类型
type Role = "admin" | "user" | "guest";
type NonAdmin = Exclude<Role, "admin">;  // "user" | "guest"

// Extract<T, U>：从 T 中提取可赋值给 U 的类型
type Admin = Extract<Role, "admin" | "superadmin">;  // "admin"

// NonNullable<T>：排除 null 和 undefined
type MaybeString = string | null | undefined;
type DefinitelyString = NonNullable<MaybeString>;  // string

// ReturnType<T>：获取函数返回类型
function createProject() {
  return { id: "1", name: "Test" };
}
type ProjectType = ReturnType<typeof createProject>;  // { id: string; name: string }

// Parameters<T>：获取函数参数类型
type CreateProjectParams = Parameters<typeof createProject>;  // []
```

### infer 关键字

在条件类型中推断类型。

```typescript
// 推断函数返回类型
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

// 推断数组元素类型
type ArrayElement<T> = T extends (infer E)[] ? E : never;
type Num = ArrayElement<number[]>;  // number

// 推断 Promise 内部类型
type Awaited<T> = T extends Promise<infer U> ? U : T;
type Str = Awaited<Promise<string>>;  // string
```

### 实战：类型安全的 API 包装

```typescript
// 创建类型安全的 API 客户端
function createApiClient<T extends Record<string, unknown>>(
  baseUrl: string
) {
  return {
    async get<K extends keyof T>(endpoint: K): Promise<T[K]> {
      const res = await fetch(`${baseUrl}${endpoint}`);
      return res.json();
    },
    async post<K extends keyof T, D extends T[K]>(
      endpoint: K,
      data: Omit<D, keyof T>
    ): Promise<T[K]> {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.json();
    },
  };
}

// 定义 API 端点返回类型
interface ApiSchemas {
  "/projects": Project[];
  "/projects/:id": Project;
  "/files": File[];
}

// 创建客户端
const api = createApiClient<ApiSchemas>("https://api.example.com");

// 类型安全调用
const projects = await api.get("/projects");    // 类型是 Project[]
const project = await api.get("/projects/:id"); // 类型是 Project
```

---

## 3.12 TypeScript 5 新特性

TypeScript 5 引入了多项新特性，进一步提升了类型系统的表达能力。

### const 泛型

确保泛型参数推断为字面量类型。

```typescript
// TS 4.7
type Route<T> = T;
type A = Route<"/api/projects">;  // string

// TS 5.0+ const 泛型
type Route<T extends string> = T;
type B = Route<"/api/projects">;  // "/api/projects"（字面量类型）

// 在函数中使用
function createRoute<T extends string>(route: T): T {
  return route;
}

const r1 = createRoute("/api/projects");  // "/api/projects"
```

### 更严格的 infer

```typescript
// 在 extends 条件中更准确地推断类型
type Flatten<T> = T extends Array<infer U> ? U : T;

type A = Flatten<string[]>;  // string
type B = Flatten<number>;    // number
```

###装饰器（Decorator）

TypeScript 5 支持新的装饰器语法（与 TC39 提案同步）。

```typescript
// 类装饰器
function logged(target: Function) {
  console.log(`Class ${target.name} was defined`);
}

@logged
class MyClass {
  // ...
}
```

### `using` 关键字与 Dispose

```typescript
// 自动资源管理（类似 C# 的 using）
interface Disposable {
  [Symbol.dispose](): void;
}

function example() {
  using resource = getResource();  // 离开作用域时自动调用 dispose
  // 使用 resource...
}
```

### 子模块（Submodules）

```typescript
// 从模块导出子模块路径
import { type foo, bar } from "my-module";
export type { foo } from "my-module";
```

### 遍历类型（Variadic Tuple Types）优化

```typescript
// 更好地支持元组操作
type Concat<T extends unknown[], U extends unknown[]> = [...T, ...U];

type Result = Concat<[1, 2], [3, 4]>;  // [1, 2, 3, 4]
```

---

## 3.13 练习建议

1. **泛型练习**：为 Zustand Store 添加新方法，观察类型自动推导
2. **类型守卫**：创建类型守卫函数，验证 API 返回的数据结构
3. **条件类型**：使用 `Extract` 和 `Exclude` 处理联合类型
4. **查看生成类型**：运行 `npx convex dev`，观察 `_generated` 目录的变化
5. **添加新字段**：在 `convex/schema.ts` 添加字段，运行 `npx convex dev`，查看类型自动更新

---

## 3.14 总结

本节课我们了解到：

- ✅ **Convex 自动生成类型**：无需手动维护数据库类型
- ✅ **Zustand 类型化 Store**：编辑器状态全程类型安全
- ✅ **Zod 运行时验证**：API 请求的运行时类型检查
- ✅ **CodeMirror 类型系统**：EditorState、EditorView、StateField
- ✅ **AI SDK 类型**：流式响应、结构化输出类型
- ✅ **最佳实践**：const 断言、类型守卫、严格 null 检查
- ✅ **泛型基础**：创建可复用且类型安全的组件
- ✅ **条件类型与映射类型**：强大的类型转换能力
- ✅ **TypeScript 5 新特性**：const 泛型、装饰器等

**下一课预告**：Tailwind CSS 4 与 shadcn/ui - 原子化 CSS 和组件库的使用。