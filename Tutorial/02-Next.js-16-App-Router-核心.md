# 第 2 课：Next.js 16 App Router 核心

> 本课目标：掌握 App Router 的路由系统、布局机制、页面渲染、服务端与客户端组件区分

---

## 2.1 App Router vs Pages Router

Next.js 有两套路由系统：**Pages Router**（传统）和 **App Router**（新一代）。

### 核心区别

| 特性 | Pages Router | App Router |
|------|-------------|------------|
| 路由定义 | 文件系统 `pages/` | 文件系统 `app/` |
| 布局 | `_app.tsx`、`_document.tsx` | 嵌套 `layout.tsx` |
| 服务端组件 | 需要 `getServerSideProps` | 默认服务端渲染 |
| API 路由 | `pages/api/` | `app/api/` |
| 加载状态 | `loading.tsx` | 内置 React Suspense |
| 错误处理 | `error.tsx` | `error.tsx`、`global-error.tsx` |
| 动态路由 | `[id].tsx` | `[id]/page.tsx` |

### App Router 的优势

```typescript
// Pages Router：需要手动获取数据
export async function getServerSideProps() {
  const res = await fetch('https://api.example.com/data');
  const data = await res.json();
  return { props: { data } };
}

// App Router：可以直接使用 async/await
export default async function Page() {
  const res = await fetch('https://api.example.com/data');
  const data = await res.json();
  return <div>{data.name}</div>;
}
```

---

## 2.2 路由系统基础

### 路由对应关系

```
app/
├── page.tsx                      → /
├── about/page.tsx               → /about
├── blog/page.tsx                → /blog
├── blog/[slug]/page.tsx         → /blog/:slug
├── (marketing)/page.tsx         → / (但属于 marketing 组)
└── (marketing)/about/page.tsx   → /about
```

### Polaris 的路由结构

```
src/app/
├── page.tsx                     → / (首页-项目列表)
├── global-error.tsx              → 全局错误边界
│
├── projects/
│   └── [projectId]/
│       ├── layout.tsx            → 项目布局（嵌套）
│       └── page.tsx              → /projects/:projectId
│
└── api/
    ├── messages/route.ts         → POST /api/messages
    ├── github/import/route.ts    → POST /api/github/import
    └── inngest/route.ts          → POST /api/inngest
```

---

## 2.3 布局系统（Layout）

### 布局的继承关系

```
Root Layout (app/layout.tsx)
    │
    ├── 全局 Provider (Clerk、Convex)
    ├── Toaster 组件
    │
    └── Project Layout (app/projects/[projectId]/layout.tsx)
            │
            ├── ProjectIdLayout 组件
            │   ├── Navbar（导航栏）
            │   ├── Sidebar（侧边栏）
            │   └── {children}（页面内容）
            │
            └── IDE Page (app/projects/[projectId]/page.tsx)
                    │
                    └── 项目具体页面
```

### 根布局 (`src/app/layout.tsx`)

```typescript
import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polaris",
  description: "AI-powered cloud IDE",
};

// 根布局是所有页面的共同外壳
export default function RootLayout({
  children,  // 子页面或子布局
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {/* 全局 Provider：Clerk 认证、Convex 数据库 */}
        <Providers>
          {children}
          {/* Toast 通知组件 */}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
```

### 项目布局 (`src/app/projects/[projectId]/layout.tsx`)

```typescript
import { ProjectIdLayout } from "@/features/projects/components/project-id-layout";
import { Id } from "../../../../convex/_generated/dataModel";

const Layout = async ({
  children,
  params,  // 动态路由参数
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;  // Next.js 16：params 是 Promise
}) => {
  // 异步获取动态路由参数
  const { projectId } = await params;

  return (
    // ProjectIdLayout 包含 Navbar、Sidebar 等 IDE 界面组件
    <ProjectIdLayout projectId={projectId as Id<"projects">}>
      {children}
    </ProjectIdLayout>
  );
};

export default Layout;
```

### 嵌套布局的渲染流程

```
用户访问 /projects/123

1. RootLayout 渲染
   └─ <Providers>{children}</Providers>

2. ProjectIdLayout (layout.tsx) 渲染
   └─ <ProjectIdLayout projectId="123">
        <Navbar />
        <Sidebar />
        <main>{children}</main>  ← 这里传入 page.tsx 的内容
      </ProjectIdLayout>

3. ProjectIdPage (page.tsx) 渲染
   └─ <ProjectIdView projectId="123" />
```

---

## 2.4 页面组件（Page）

### 首页 (`src/app/page.tsx`)

```typescript
import { ProjectsView } from "@/features/projects/components/projects-view";

// 简单页面：直接返回组件
const Home = () => {
  return <ProjectsView />;
};

export default Home;
```

### 项目详情页 (`src/app/projects/[projectId]/page.tsx`)

```typescript
import { ProjectIdView } from "@/features/projects/components/project-id-view";
import { Id } from "../../../../convex/_generated/dataModel";

const ProjectIdPage = async ({
  params,  // 接收动态路由参数
}: {
  params: Promise<{ projectId: string }>;  // Next.js 16 要求 params 是 Promise
}) => {
  // 异步获取 params
  const { projectId } = await params;

  // 将 string 转换为 Convex 的 Id 类型
  return <ProjectIdView projectId={projectId as Id<"projects">} />;
};

export default ProjectIdPage;
```

### Next.js 15/16 的变化：params 是 Promise

```typescript
// Next.js 14 及之前
const Page = ({ params }: { params: { id: string } }) => {
  return <div>{params.id}</div>;
};

// Next.js 15+ (推荐)
const Page = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return <div>{id}</div>;
};
```

---

## 2.5 服务端组件 vs 客户端组件

### 默认行为

| 组件类型 | 默认 | 特点 |
|---------|------|------|
| 服务端组件 | **默认** | 在服务器渲染，可以访问数据库/文件系统 |
| 客户端组件 | 需要 `"use client"` | 在浏览器渲染，可以 useState/useEffect |

### 服务端组件示例

```typescript
// app/page.tsx - 服务端组件（默认）
import { db } from "@/lib/db";

export default async function HomePage() {
  // 直接访问数据库，不需要 API
  const projects = await db.query("projects").first();

  return <ProjectsView projects={projects} />;
}
```

### 客户端组件示例

```typescript
// components/counter.tsx - 客户端组件
"use client";  // 必须声明

import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <button onClick={() => setCount(count + 1)}>
      Count: {count}
    </button>
  );
}
```

### 混合使用模式

```typescript
// app/projects/[projectId]/page.tsx - 服务端组件
import { ProjectIdView } from "@/features/projects/components/project-id-view";
import { Id } from "../../../../convex/_generated/dataModel";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  // 服务端：可以访问数据库
  const project = await getProject(projectId);

  // 将数据传给客户端组件
  return <ProjectIdView projectId={projectId as Id<"projects">} />;
}
```

```typescript
// features/projects/components/project-id-view.tsx - 客户端组件
"use client";

import { useState } from "react";

export function ProjectIdView({ projectId }: { projectId: Id<"projects"> }) {
  const [activeTab, setActiveTab] = useState("files");

  return (
    <div>
      {/* 客户端交互 */}
      <Tab value={activeTab} onChange={setActiveTab} />
    </div>
  );
}
```

### 组件树中的边界

```
服务端组件 (app/page.tsx)
│
├── 可以直接渲染客户端组件 ✓
│   └── <Counter />
│
├── 可以直接渲染服务端组件 ✓
│   └── <ProjectList />
│
└── 客户端组件内部
    └── 不能再导入服务端组件 ✗
        // 错误示例：
        // "use client"
        // import { ServerComponent } from "./server-component"  // ❌
```

---

## 2.6 API 路由

### API 路由结构

```
app/api/
├── messages/
│   ├── route.ts          → POST /api/messages
│   └── cancel/
│       └── route.ts     → POST /api/messages/cancel
├── github/
│   ├── import/
│   │   └── route.ts     → POST /api/github/import
│   └── export/
│       └── route.ts      → POST /api/github/export
└── inngest/
    └── route.ts          → POST /api/inngest
```

### API 路由示例 (`src/app/api/messages/route.ts`)

```typescript
import { z } from "zod";                    // 请求体验证
import { NextResponse } from "next/server";  // 响应构建
import { auth } from "@clerk/nextjs/server"; // 认证

import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

// Zod schema：验证请求体
const requestSchema = z.object({
  conversationId: z.string(),
  message: z.string(),
});

// POST 请求处理
export async function POST(request: Request) {
  // 1. 认证检查
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. 解析并验证请求体
  const body = await request.json();
  const { conversationId, message } = requestSchema.parse(body);

  // 3. 数据库查询
  const conversation = await convex.query(
    api.system.getConversationById,
    { conversationId: conversationId as Id<"conversations"> }
  );

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  // 4. 触发后台任务
  const event = await inngest.send({
    name: "message/sent",
    data: { messageId: conversationId, message },
  });

  // 5. 返回响应
  return NextResponse.json({
    success: true,
    eventId: event.ids[0],
  });
}
```

### HTTP 方法处理

```typescript
// app/api/example/route.ts

export async function GET(request: Request) {
  // 处理 GET 请求
}

export async function POST(request: Request) {
  // 处理 POST 请求
}

export async function PUT(request: Request) {
  // 处理 PUT 请求
}

export async function DELETE(request: Request) {
  // 处理 DELETE 请求
}
```

---

## 2.7 动态路由

### 动态路由定义

```
app/
└── projects/
    └── [projectId]/           # 方括号表示动态段
        ├── page.tsx            # → /projects/:projectId
        └── [filePath]/
            └── page.tsx        # → /projects/:projectId/:filePath
```

### 获取动态参数

```typescript
// Next.js 15+：params 是 Promise
const ProjectPage = async ({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) => {
  const { projectId } = await params;
  // ...
};
```

### 多层动态路由

```typescript
// app/projects/[projectId]/files/[...filePath]/page.tsx

export default async function FilePage({
  params,
}: {
  params: Promise<{
    projectId: string;
    filePath: string[];  // 捕获所有剩余段
  }>;
}) {
  const { projectId, filePath } = await params;
  // /projects/123/files/src/components/Button.tsx
  // filePath = ["src", "components", "Button.tsx"]

  const fullPath = filePath.join("/");
}
```

---

## 2.8 错误处理

### 全局错误边界 (`global-error.tsx`)

```typescript
"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

// 这个组件处理所有未捕获的错误
// 注意：这是客户端组件（"use client"）
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    // 上报错误到 Sentry
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        {/* Next.js 默认错误页面 */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
```

### 局部错误边界 (`error.tsx`)

```typescript
// app/projects/[projectId]/error.tsx

"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;  // 重试函数
}) {
  return (
    <div>
      <h2>Something went wrong!</h2>
      <button onClick={() => reset()}>Try again</button>
    </div>
  );
}
```

---

## 2.9 路由组（Route Groups）

路由组使用 `(folderName)` 语法，用于：

1. **组织代码**：将相关路由分组
2. **布局分离**：组内共享布局，组间不共享

### 示例

```
app/
├── (marketing)/           # 营销组
│   ├── layout.tsx         # 营销组布局
│   ├── page.tsx          → /
│   └── pricing/
│       └── page.tsx      → /pricing
│
└── (app)/                # 应用组
    ├── layout.tsx         # 应用组布局
    ├── dashboard/
    │   └── page.tsx     → /dashboard
    └── settings/
        └── page.tsx     → /settings
```

### Polaris 的路由组

```
src/app/
├── page.tsx              → / (首页)
└── projects/
    └── [projectId]/      # 注意：没有用路由组
        └── page.tsx     → /projects/:projectId
```

---

## 2.10 模板（Template）

模板是另一种布局变体，**每次路由变化都会重新创建**。

```typescript
// app/page.tsx - 布局（保持状态）
export default function Layout({ children }) {
  return <div>{children}</div>;
}

// app/template.tsx - 模板（每次重新创建）
export default function Template({ children }) {
  // 每次路由变化都会执行
  useEffect(() => {
    console.log("Route changed!");
  }, []);

  return <div>{children}</div>;
}
```

**使用场景**：
- 需要每次路由变化时重置状态
- 动画过渡效果

---

## 2.11 练习建议

1. **创建新页面**：在 `app/about/` 下创建 About 页面
2. **添加布局**：为项目路由添加 loading.tsx 加载状态
3. **尝试 API**：使用 Postman 或 curl 测试 `/api/messages` 接口
4. **理解 params**：添加 console.log 观察 params 的变化

### 实践：创建 About 页面

```typescript
// 1. 创建文件：app/about/page.tsx
export default function AboutPage() {
  return (
    <div>
      <h1>About Polaris</h1>
      <p>AI-powered cloud IDE</p>
    </div>
  );
}

// 2. 访问 http://localhost:3000/about
```

---

## 2.12 总结

| 概念 | 关键点 |
|------|--------|
| **Layout** | 嵌套结构，共享 UI，params 通过 children 传递 |
| **Page** | 叶子节点，对应具体路由 |
| **服务端组件** | 默认，可以 async/await，访问数据库 |
| **客户端组件** | 需要 `"use client"`，可以使用 useState/useEffect |
| **API Route** | `app/api/*/route.ts`，处理 HTTP 请求 |
| **动态路由** | `[param]/page.tsx`，params 是 Promise |

**下一课预告**：TypeScript 与类型安全 - 深入理解项目中的 TypeScript 高级用法和类型设计。
