# 第 11 课：Clerk 认证系统

> 本课目标：掌握 Clerk 认证的实现方式、用户会话管理、API 路由保护和 Convex 认证集成

---

## 11.1 Clerk 认证概述

Clerk 是一个**即插即用的认证解决方案**，提供登录、注册、OAuth、用户管理等功能。

### Clerk 核心功能

| 功能 | 说明 |
|------|------|
| **多方式登录** | 邮箱密码、OAuth（GitHub、Google 等）、无密码登录 |
| **用户管理** | 用户信息、元数据、会话管理 |
| **组件库** | 预构建的 UI 组件（SignIn、SignUp、UserButton） |
| **Webhook** | 用户事件通知（创建、更新、删除） |
| **SSO** | 企业单点登录支持 |

### Clerk 与 Polaris 架构

```
┌──────────────────────────────────────────────────────────────┐
│                     Clerk 认证流程                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  用户浏览器                                                   │
│  ┌─────────────────┐                                        │
│  │ ClerkProvider    │ ←── 全局 Provider                      │
│  └────────┬────────┘                                        │
│           │                                                   │
│           ▼                                                   │
│  ┌─────────────────┐                                        │
│  │ Middleware      │ ←── 请求拦截（src/proxy.ts）            │
│  └────────┬────────┘                                        │
│           │                                                   │
│           ▼                                                   │
│  ┌─────────────────┐                                        │
│  │ ConvexAuth      │ ←── Convex 认证（convex/auth.ts）       │
│  └────────┬────────┘                                        │
│           │                                                   │
│           ▼                                                   │
│  ┌─────────────────┐                                        │
│  │ 用户数据        │ ←── Clerk 用户身份                      │
│  └─────────────────┘                                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 11.2 Clerk Provider 配置

### 全局 Provider

```typescript
// src/components/providers.tsx
"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <ClerkProvider>
      {/* Convex 与 Clerk 集成 */}
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {/* 认证状态渲染 */}
        <Authenticated>
          {children}
        </Authenticated>
        <Unauthenticated>
          <UnauthenticatedView />
        </Unauthenticated>
        <AuthLoading>
          <AuthLoadingView />
        </AuthLoading>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
};
```

### Provider 组件层级

```
ClerkProvider
    │
    └── ConvexProviderWithClerk
            │
            ├── Authenticated
            │       │
            │       └── children（已登录）
            │
            ├── Unauthenticated
            │       │
            │       └── UnauthenticatedView（未登录）
            │
            └── AuthLoading
                    │
                    └── AuthLoadingView（加载中）
```

---

## 11.3 Middleware 配置

Clerk 提供 Middleware 来保护路由。

### proxy.ts 配置

```typescript
// src/proxy.ts
import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    // 跳过 Next.js 内部文件和静态文件
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // API 路由始终执行
    "/(api|trpc)(.*)",
  ],
};
```

### Middleware 工作流程

```
请求进入
    │
    ▼
clerkMiddleware() 执行
    │
    ├── 检测会话
    │       │
    │       ├── 有效会话 → 允许通过
    │       │
    │       ├── 无会话 → 重定向到登录页（保护路由）
    │       │
    │       └── 无效会话 → 清除并重定向
    │
    ▼
继续到 Next.js 处理
```

---

## 11.4 Convex Auth 配置

Polaris 使用 Convex 的内置认证与 Clerk 集成。

### auth.config.ts

```typescript
// convex/auth.config.ts
import { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      // Clerk 的 JWT Issuer 域名
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      // Convex 应用 ID
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
```

### 环境变量

```bash
# .env.local
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_xxx
CLERK_SECRET_KEY=sk_xxx
CLERK_JWT_ISSUER_DOMAIN=xxx.clerk.accounts.dev
NEXT_PUBLIC_CONVEX_URL=https://xxx.convex.cloud
```

---

## 11.5 verifyAuth 工具函数

Convex 中使用 `verifyAuth` 验证用户身份。

### 基本实现

```typescript
// convex/auth.ts
import { MutationCtx, QueryCtx } from "./_generated/server";

// 验证用户身份
export const verifyAuth = async (ctx: QueryCtx | MutationCtx) => {
  // 获取用户身份
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Unauthorized");
  }

  return identity;
};
```

### 返回的 identity 对象

```typescript
interface UserIdentity {
  subject: string;    // 用户唯一 ID（Clerk 的 userId）
  email?: string;      // 用户邮箱
  name?: string;        // 用户名
  imageUrl?: string;   // 头像 URL
  // ...
}
```

### 在 Query 中使用

```typescript
export const getById = query({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    // 1. 验证身份
    const identity = await verifyAuth(ctx);

    // 2. 获取项目
    const project = await ctx.db.get("projects", args.id);

    // 3. 检查权限
    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to this project");
    }

    return project;
  },
});
```

### 在 Mutation 中使用

```typescript
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    // 验证身份
    const identity = await verifyAuth(ctx);

    // 创建项目，使用 identity.subject 作为 ownerId
    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      ownerId: identity.subject,  // 使用 Clerk 用户 ID
      updatedAt: Date.now(),
    });

    return projectId;
  },
});
```

---

## 11.6 认证状态组件

Clerk 提供三种认证状态组件。

### Authenticated - 已认证

```tsx
import { Authenticated } from "convex/react";

function MyComponent() {
  return (
    <Authenticated>
      {/* 用户已登录时显示 */}
      <Dashboard />
    </Authenticated>
  );
}
```

### Unauthenticated - 未认证

```tsx
import { Unauthenticated } from "convex/react";
import { UnauthenticatedView } from "@/features/auth/components/unauthenticated-view";

function App() {
  return (
    <>
      <Authenticated>
        {children}
      </Authenticated>
      <Unauthenticated>
        <UnauthenticatedView />
      </Unauthenticated>
    </>
  );
}
```

### UnauthenticatedView 组件

```tsx
// src/features/auth/components/unauthenticated-view.tsx
import { ShieldAlertIcon } from "lucide-react";
import { SignInButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export const UnauthenticatedView = () => {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-full max-w-lg bg-muted">
        <Item variant="outline">
          <ItemMedia variant="icon">
            <ShieldAlertIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Unauthorized Access</ItemTitle>
            <ItemDescription>
              You are not authorized to access this resource.
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <SignInButton>
              <Button variant="outline" size="sm">
                Sign in
              </Button>
            </SignInButton>
          </ItemActions>
        </Item>
      </div>
    </div>
  );
};
```

### AuthLoading - 加载中

```tsx
import { AuthLoading } from "convex/react";
import { Spinner } from "@/components/ui/spinner";

export const AuthLoadingView = () => {
  return (
    <div className="flex items-center justify-center h-screen">
      <Spinner className="size-6 text-ring" />
    </div>
  );
};
```

---

## 11.7 API 路由认证

在 Next.js API 路由中使用 Clerk 认证。

### 获取用户 ID

```typescript
// src/app/api/messages/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function POST(request: Request) {
  // 获取用户身份
  const { userId } = await auth();

  // 未登录检查
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 继续处理...
  return NextResponse.json({ success: true });
}
```

### 完整示例

```typescript
// src/app/api/projects/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";

const requestSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function POST(request: Request) {
  // 1. 认证检查
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. 解析请求
  const body = await requestSchema.parseAsync(await request.json());

  // 3. 创建对话
  const conversationId = await convex.mutation(api.conversations.create, {
    projectId: args.projectId,
    title: args.title,
  });

  // 4. 返回
  return NextResponse.json({ success: true, conversationId });
}
```

---

## 11.8 useAuth Hook

在客户端组件中使用 `useAuth` Hook。

### 基本用法

```typescript
"use client";

import { useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const { signOut } = useAuth();

  return (
    <Button onClick={() => signOut()}>
      Sign Out
    </Button>
  );
}
```

### useAuth 返回值

```typescript
const {
  userId,      // 当前用户 ID，未登录为 null
  sessionId,    // 会话 ID
  signOut,      // 登出函数
  isLoaded,     // 是否已加载
} = useAuth();
```

### 使用示例

```typescript
import { useAuth } from "@clerk/nextjs";

function UserProfile() {
  const { userId, isLoaded } = useAuth();

  if (!isLoaded) {
    return <Spinner />;
  }

  if (!userId) {
    return <SignInButton />;
  }

  return <Dashboard userId={userId} />;
}
```

---

## 11.9 Clerk 组件

Clerk 提供预构建的 UI 组件。

### SignInButton

```tsx
import { SignInButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function LoginButton() {
  return (
    <SignInButton mode="modal">
      <Button>Sign In</Button>
    </SignInButton>
  );
}

// mode: "modal" | "redirect"
// modal：在模态框中显示
// redirect：重定向到登录页
```

### UserButton

用户头像按钮，显示下拉菜单（设置、登出等）：

```tsx
import { UserButton } from "@clerk/nextjs";

export function Header() {
  return (
    <header>
      <UserButton afterSignOutUrl="/" />
    </header>
  );
}
```

### 完整页面示例

```tsx
// app/sign-in/[[...sign-in]]/page.tsx
import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return <SignIn />;
}

// app/sign-up/[[...sign-up]]/page.tsx
import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return <SignUp />;
}
```

---

## 11.10 用户元数据

Clerk 支持用户元数据存储额外信息。

### 元数据类型

| 类型 | 说明 | 访问 |
|------|------|------|
| `publicMetadata` | 公开数据 | `user.publicMetadata` |
| `privateMetadata` | 私有数据 | `user.privateMetadata` |
| `unsafeMetadata` | 任意数据 | `user.unsafeMetadata` |

### 在 Clerk Dashboard 设置

在 Clerk Dashboard 的 User Management 中可以手动设置元数据。

### 在代码中使用

```typescript
// 获取元数据（在 Convex 中）
const identity = await ctx.auth.getUserIdentity();

// 元数据需要通过 Clerk API 获取
// 这部分通常在 Webhook 中处理
```

---

## 11.11 Webhook 集成

Clerk Webhook 用于同步用户数据。

### 设置 Webhook

1. 在 Clerk Dashboard 创建 Webhook
2. 配置事件：`user.created`、`user.updated`、`user.deleted`
3. 设置端点：`https://your-domain.com/api/webhooks/clerk`

### 处理 Webhook

```typescript
// src/app/api/webhooks/clerk/route.ts
import { Webhook } from "svix";
import { headers } from "next/headers";

export async function POST(request: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  const body = await request.text();
  const signature = headers().get("svix-signature");

  // 验证 Webhook
  const wh = new Webhook(WEBHOOK_SECRET);
  let event;

  try {
    event = wh.verify(body, signature);
  } catch (err) {
    return new Response("Webhook verification failed", { status: 400 });
  }

  // 处理事件
  const { type, data } = event;

  switch (type) {
    case "user.created":
      // 创建用户
      console.log("User created:", data.id);
      break;
    case "user.updated":
      // 更新用户
      console.log("User updated:", data.id);
      break;
    case "user.deleted":
      // 删除用户
      console.log("User deleted:", data.id);
      break;
  }

  return new Response("OK", { status: 200 });
}
```

---

## 11.12 多因素认证（MFA）

Clerk 支持 MFA 设置。

### 在 Clerk Dashboard 启用

在 Clerk Dashboard → User Management → Settings → Multi-factor 中启用 MFA。

### MFA 类型

| 类型 | 说明 |
|------|------|
| TOTP | 基于时间的一次性密码（Authenticator App） |
| Backup Codes | 备用代码 |
| Passkeys | 无密码认证 |

### 检查用户 MFA 状态

```typescript
// 在 API 中检查
const { userId } = await auth();
if (!userId) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// Clerk 会自动处理 MFA
// 如果用户启用了 MFA，Clerk 会要求验证
```

---

## 11.13 会话管理

### 会话生命周期

```
用户登录
    │
    ├── Clerk 创建会话 → 颁发 Session Token
    │
    ▼
请求携带 Session Token
    │
    ├── Middleware 验证 Token
    │
    ├── Token 有效 → 请求继续
    │
    └── Token 过期 → 自动刷新或重定向登录
    │
    ▼
用户登出
    │
    └── Clerk 清除会话
```

### 主动登出

```typescript
"use client";

import { useAuth } from "@clerk/nextjs";

export function SignOutButton() {
  const { signOut } = useAuth();

  const handleSignOut = async () => {
    // 登出并重定向到首页
    await signOut({ redirectUrl: "/" });
  };

  return <Button onClick={handleSignOut}>Sign Out</Button>;
}
```

---

## 11.14 练习建议

1. **阅读源码**：阅读 `providers.tsx`、`auth.ts`、`proxy.ts`
2. **添加路由保护**：使用 Clerk 组件保护路由
3. **实现 Webhook**：创建一个 Webhook 处理用户事件
4. **自定义 UnauthenticatedView**：根据需求修改未授权页面

### 实践：添加管理员功能

```typescript
// convex/auth.ts
export const verifyAuth = async (ctx: QueryCtx | MutationCtx) => {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Unauthorized");
  }

  // 可以在这里添加管理员检查
  // const isAdmin = identity.email === "admin@example.com";

  return identity;
};
```

### 实践：自定义用户按钮

```tsx
import { UserButton } from "@clerk/nextjs";
import { User } from "@clerk/nextjs/server";

export function CustomUserButton() {
  return (
    <UserButton
      afterSignOutUrl="/"
      userProfilePageUrl="/user-profile"
      userProfileMode="modal"
    />
  );
}
```

---

## 11.15 总结

本节课我们了解到：

- ✅ **Clerk 认证概述**：即插即用的认证解决方案
- ✅ **ClerkProvider 配置**：全局 Provider 与组件层级
- ✅ **Middleware 配置**：请求拦截与路由保护
- ✅ **Convex Auth 配置**：auth.config.ts 与 Clerk 集成
- ✅ **verifyAuth 工具函数**：Convex 中验证用户身份
- ✅ **认证状态组件**：Authenticated、Unauthenticated、AuthLoading
- ✅ **API 路由认证**：auth() 函数获取用户 ID
- ✅ **useAuth Hook**：客户端认证状态管理
- ✅ **Clerk 组件**：SignInButton、UserButton
- ✅ **用户元数据**：publicMetadata、privateMetadata
- ✅ **Webhook 集成**：同步用户数据
- ✅ **会话管理**：登录、登出、会话生命周期

**下一课预告**：WebContainer 浏览器终端 - 深入理解 WebContainer API 和浏览器内终端实现。
