# 第 5 课：Convex 实时数据库

> 本课目标：掌握 Convex 的 Schema 设计、CURD 操作、查询语法和前端实时订阅

---

## 5.1 Convex 简介

Convex 是一个**后端即服务（BaaS）**平台，为应用提供实时数据库、后端函数和文件存储。

### Convex 的核心特性

| 特性 | 说明 |
|------|------|
| **实时数据库** | 数据变更自动推送到客户端，无需轮询 |
| **类型安全** | 自动生成 TypeScript 类型，前后端类型一致 |
| **无 API 层** | 前端直接调用后端函数，无需手动创建 REST API |
| **索引支持** | 支持二级索引，查询效率高 |
| **文件存储** | 支持大文件存储（storage） |
| **认证集成** | 内置身份验证支持 |

### Convex vs 传统架构

**传统架构：**
```
前端 → REST API → 后端服务器 → 数据库
         ↑
      手动创建
```

**Convex 架构：**
```
前端 ────────────────────► Convex 数据库
         (自动类型安全)
              ↑
        Convex Functions
      (Query / Mutation)
```

---

## 5.2 Convex 项目结构

```
convex/
├── schema.ts          # 数据库 Schema 定义
├── projects.ts        # 项目相关 Query/Mutation
├── files.ts           # 文件相关 Query/Mutation
├── conversations.ts   # 对话相关 Query/Mutation
├── auth.ts            # 认证工具函数
├── auth.config.ts     # 认证配置
└── _generated/        # 自动生成的类型
    ├── api.d.ts       # API 函数类型
    ├── dataModel.d.ts # 数据模型类型
    └── server.d.ts    # 服务端类型
```

### 环境配置

Convex 需要一个环境变量：

```bash
# .env.local
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
```

---

## 5.3 Schema 定义

Schema 是数据库的结构蓝图，定义所有数据表和字段。

### projects.ts 源码解析

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // projects 表
  projects: defineTable({
    name: v.string(),                    // 项目名称
    ownerId: v.string(),                 // 所有者 ID（Clerk 用户 ID）
    updatedAt: v.number(),               // 更新时间戳
    importStatus: v.optional(            // 导入状态（可选）
      v.union(
        v.literal("importing"),          // 导入中
        v.literal("completed"),          // 导入完成
        v.literal("failed"),             // 导入失败
      ),
    ),
    exportStatus: v.optional(            // 导出状态（可选）
      v.union(
        v.literal("exporting"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
    exportRepoUrl: v.optional(v.string()), // 导出的仓库 URL
    settings: v.optional(                // 项目设置（可选）
      v.object({
        installCommand: v.optional(v.string()),
        devCommand: v.optional(v.string()),
      })
    ),
  })
    .index("by_owner", ["ownerId"]),     // 索引：按所有者查询

  // files 表
  files: defineTable({
    projectId: v.id("projects"),        // 关联项目 ID
    parentId: v.optional(v.id("files")), // 父文件夹 ID（支持嵌套）
    name: v.string(),                    // 文件名
    type: v.union(                      // 类型：文件或文件夹
      v.literal("file"),
      v.literal("folder")
    ),
    content: v.optional(v.string()),     // 文件内容（文本文件）
    storageId: v.optional(v.id("_storage")), // 大文件存储 ID
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])           // 索引：按项目查询
    .index("by_parent", ["parentId"])             // 索引：按父文件夹查询
    .index("by_project_parent", ["projectId", "parentId"]), // 复合索引

  // conversations 表
  conversations: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  // messages 表
  messages: defineTable({
    conversationId: v.id("conversations"),
    projectId: v.id("projects"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    status: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("completed"),
        v.literal("cancelled")
      )
    ),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_project_status", ["projectId", "status"]),
});
```

### v 验证器类型

Convex 使用 `v` 模块定义字段类型验证器：

```typescript
import { v } from "convex/values";

// 基础类型
v.string()      // 字符串
v.number()      // 数字
v.boolean()     // 布尔值
v.null()         // null

// 可选字段
v.optional(v.string())  // 可选字符串

// ID 引用
v.id("projects")       // projects 表的 ID
v.id("files")          // files 表的 ID

// 联合类型
v.union(
  v.literal("importing"),
  v.literal("completed"),
  v.literal("failed"),
)

// 对象
v.object({
  name: v.string(),
  age: v.number(),
})

// 数组
v.array(v.string())

// 字典
v.map(v.string())
```

---

## 5.4 Query 函数（读取数据）

Query 是只读的服务器函数，用于从数据库读取数据。

### Query 基本结构

```typescript
import { query } from "./_generated/server";
import { v } from "convex/values";

export const getById = query({
  // 参数定义
  args: {
    id: v.id("projects"),
  },
  // 处理函数
  handler: async (ctx, args) => {
    // ctx.db - 数据库访问
    // args - 验证后的参数

    // 方式1：直接获取
    const project = await ctx.db.get("projects", args.id);

    // 方式2：使用索引查询
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", "user123"))
      .take(10);

    return project;
  },
});
```

### ctx.db API

```typescript
// 获取单个文档
const doc = await ctx.db.get("projects", "abc123");

// 查询表（返回 Query 对象，需进一步处理）
const query = ctx.db.query("projects");

// 插入文档
const id = await ctx.db.insert("projects", {
  name: "My Project",
  ownerId: "user123",
  updatedAt: Date.now(),
});

// 更新文档
await ctx.db.patch("projects", id, {
  name: "New Name",
});

// 删除文档
await ctx.db.delete("projects", id);
```

### 索引查询

```typescript
// 单字段索引查询
const projects = await ctx.db
  .query("projects")
  .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
  .collect();

// 复合索引查询
const files = await ctx.db
  .query("files")
  .withIndex("by_project_parent", (q) =>
    q
      .eq("projectId", projectId)
      .eq("parentId", null)  // 根目录
  )
  .collect();

// 排序
const sortedFiles = await ctx.db
  .query("files")
  .withIndex("by_project", (q) => q.eq("projectId", projectId))
  .order("desc")  // 或 .order("asc")
  .take(100);     // 限制返回数量
```

### Query 示例：projects.ts

```typescript
// 获取用户的项目列表
export const get = query({
  args: {},
  handler: async (ctx) => {
    // 1. 验证用户身份
    const identity = await verifyAuth(ctx);

    // 2. 使用索引查询
    return await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .order("desc")
      .collect();
  },
});

// 获取单个项目
export const getById = query({
  args: {
    id: v.id("projects")
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);

    // 1. 获取项目
    const project = await ctx.db.get("projects", args.id);

    if (!project) {
      throw new Error("Project not found");
    }

    // 2. 权限检查
    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to this project");
    }

    return project;
  },
});
```

---

## 5.5 Mutation 函数（修改数据）

Mutation 是写操作的服务器函数，用于创建、更新、删除数据。

### Mutation 基本结构

```typescript
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. 验证身份
    const identity = await verifyAuth(ctx);

    // 2. 验证业务逻辑（可选）

    // 3. 插入数据
    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      ownerId: identity.subject,
      updatedAt: Date.now(),
    });

    // 4. 返回新记录的 ID
    return projectId;
  },
});
```

### Mutation 示例：创建项目

```typescript
export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    // 验证身份
    const identity = await verifyAuth(ctx);

    // 插入项目
    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      ownerId: identity.subject,
      updatedAt: Date.now(),
    });

    return projectId;
  },
});
```

### Mutation 示例：更新文件

```typescript
export const updateFile = mutation({
  args: {
    id: v.id("files"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);

    // 1. 获取文件
    const file = await ctx.db.get("files", args.id);
    if (!file) throw new Error("File not found");

    // 2. 获取关联项目
    const project = await ctx.db.get("projects", file.projectId);
    if (!project) throw new Error("Project not found");

    // 3. 权限检查
    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized to access this project");
    }

    const now = Date.now();

    // 4. 更新文件
    await ctx.db.patch("files", args.id, {
      content: args.content,
      updatedAt: now,
    });

    // 5. 更新项目的时间戳
    await ctx.db.patch("projects", file.projectId, {
      updatedAt: now,
    });
  },
});
```

### Mutation 示例：递归删除

```typescript
export const deleteFile = mutation({
  args: {
    id: v.id("files"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const file = await ctx.db.get("files", args.id);
    if (!file) throw new Error("File not found");

    const project = await ctx.db.get("projects", file.projectId);
    if (!project) throw new Error("Project not found");

    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized to access this project");
    }

    // 递归删除函数
    const deleteRecursive = async (fileId: Id<"files">) => {
      const item = await ctx.db.get("files", fileId);
      if (!item) return;

      // 如果是文件夹，先删除所有子项
      if (item.type === "folder") {
        const children = await ctx.db
          .query("files")
          .withIndex("by_project_parent", (q) =>
            q.eq("projectId", item.projectId).eq("parentId", fileId)
          )
          .collect();

        for (const child of children) {
          await deleteRecursive(child._id);
        }
      }

      // 删除存储文件（如果有大文件）
      if (item.storageId) {
        await ctx.storage.delete(item.storageId);
      }

      // 删除文件记录
      await ctx.db.delete("files", fileId);
    };

    await deleteRecursive(args.id);
  },
});
```

---

## 5.6 自动生成的类型

运行 `npx convex dev` 后，Convex 自动生成类型文件。

### dataModel.d.ts

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
// 相当于：
// {
//   _id: Id<"projects">;
//   _creationTime: number;
//   name: string;
//   ownerId: string;
//   updatedAt: number;
//   importStatus?: "importing" | "completed" | "failed" | undefined;
//   ...
// }

// 类型安全的 ID
const projectId: Id<"projects"> = "abc123" as Id<"projects">;

// 函数参数类型
function updateProject(projectId: Id<"projects">, name: string) {
  // ...
}
```

### api.d.ts

```typescript
// convex/_generated/api.d.ts
import type * as projects from "../projects.js";
import type * as files from "../files.js";

// 完整的 API 类型
export declare const api: {
  projects: typeof projects;
  files: typeof files;
};

// 前端使用方式
import { api } from "@/convex/_generated/api";

// 调用
const projects = await api.projects.get.query();
const projectId = await api.projects.create.mutation({ name: "My Project" });
```

---

## 5.7 前端实时订阅

在前端使用 `useQuery` 和 `useMutation` Hook 进行实时数据订阅。

### ConvexProvider 设置

```typescript
// src/components/providers.tsx
"use client";

import { ConvexProvider } from "convex/react";
import { ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <ConvexProvider client={convex}>
        {children}
      </ConvexProvider>
    </ClerkProvider>
  );
}
```

### useQuery - 实时查询

```typescript
// src/features/projects/hooks/use-projects.ts
import { useMutation, useQuery } from "convex/react";
import { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";

// 基础查询
export const useProjects = () => {
  return useQuery(api.projects.get);
};

// 带参数查询
export const useProject = (projectId: Id<"projects">) => {
  return useQuery(api.projects.getById, { id: projectId });
};

// 条件查询（跳过）
export const useFiles = (projectId: Id<"projects"> | null) => {
  return useQuery(
    api.files.getFiles,
    projectId ? { projectId } : "skip"  // projectId 为 null 时跳过查询
  );
};
```

### 组件中使用

```typescript
// src/features/projects/components/projects-list.tsx
import { useProjectsPartial } from "../hooks/use-projects";

export const ProjectsList = () => {
  const projects = useProjectsPartial(6);

  if (projects === undefined) {
    return <Spinner />;  // 加载中
  }

  return (
    <ul>
      {projects.map((project) => (
        <li key={project._id}>{project.name}</li>
      ))}
    </ul>
  );
};
```

### useMutation - 修改数据

```typescript
// 创建项目
export const useCreateProject = () => {
  return useMutation(api.projects.create);
};

// 在组件中使用
function NewProjectButton() {
  const createProject = useCreateProject();

  const handleCreate = async () => {
    const projectId = await createProject({ name: "My Project" });
    console.log("Created:", projectId);
  };

  return <Button onClick={handleCreate}>Create Project</Button>;
}
```

### 乐观更新

乐观更新在 mutation 执行前就更新 UI，让界面响应更快。

```typescript
export const useCreateFile = () => {
  return useMutation(api.files.createFile).withOptimisticUpdate(
    (localStore, args) => {
      // 获取当前文件列表
      const existingFiles = localStore.getQuery(api.files.getFolderContents, {
        projectId: args.projectId,
        parentId: args.parentId,
      });

      if (existingFiles !== undefined) {
        // 创建新文件的乐观副本
        const now = Date.now();
        const newFile = {
          _id: crypto.randomUUID() as Id<"files">,
          _creationTime: now,
          projectId: args.projectId,
          parentId: args.parentId,
          name: args.name,
          content: args.content,
          type: "file" as const,
          updatedAt: now,
        };

        // 乐观更新本地状态
        localStore.setQuery(
          api.files.getFolderContents,
          { projectId: args.projectId, parentId: args.parentId },
          sortFiles([...existingFiles, newFile])
        );
      }
    }
  );
};
```

---

## 5.8 认证与权限

### verifyAuth 工具函数

```typescript
// convex/auth.ts
import { MutationCtx, QueryCtx } from "./_generated/server";

export const verifyAuth = async (ctx: QueryCtx | MutationCtx) => {
  // 获取用户身份
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Unauthorized");
  }

  return identity;
};
```

### Query 中的权限检查

```typescript
export const getById = query({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    // 1. 验证身份
    const identity = await verifyAuth(ctx);

    // 2. 获取数据
    const project = await ctx.db.get("projects", args.id);

    if (!project) {
      throw new Error("Project not found");
    }

    // 3. 检查所有权
    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to this project");
    }

    return project;
  },
});
```

### Mutation 中的权限检查

```typescript
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    // 验证身份（未登录会抛出错误）
    const identity = await verifyAuth(ctx);

    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      ownerId: identity.subject,  // 使用 identity.subject 作为 ownerId
      updatedAt: Date.now(),
    });

    return projectId;
  },
});
```

---

## 5.9 常用查询模式

### 分页查询

```typescript
export const getPaginated = query({
  args: {
    cursor: v.optional(v.string()),  // 游标（上一页最后一项的 ID）
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .order("desc");

    // 使用游标进行分页
    if (args.cursor) {
      query = query.cursor(args.cursor);
    }

    const projects = await query.take(args.limit);

    // 返回下一批的游标
    const nextCursor = projects.length === args.limit
      ? projects[projects.length - 1]._id
      : null;

    return { projects, nextCursor };
  },
});
```

### 统计查询

```typescript
export const getStats = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    return {
      totalFiles: files.length,
      totalFolders: files.filter((f) => f.type === "folder").length,
      totalSize: files.reduce((acc, f) => acc + (f.content?.length ?? 0), 0),
    };
  },
});
```

### 文件路径查询

```typescript
export const getFilePath = query({
  args: { id: v.id("files") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get("files", args.id);
    if (!file) throw new Error("File not found");

    // 向上遍历父文件夹链，构建完整路径
    const path: { _id: string; name: string }[] = [];
    let currentId: Id<"files"> | undefined = args.id;

    while (currentId) {
      const current = (await ctx.db.get("files", currentId)) as Doc<"files"> | undefined;
      if (!current) break;

      path.unshift({ _id: current._id, name: current.name });
      currentId = current.parentId;
    }

    return path;
  },
});
```

---

## 5.10 文件存储

Convex 支持大文件存储（如图片、视频）。

### 存储 API

```typescript
// 上传文件
const storageId = await ctx.storage.store(new Uint8Array(data));

// 读取文件
const url = await ctx.storage.getUrl(storageId);

// 删除文件
await ctx.storage.delete(storageId);
```

### Schema 中的存储字段

```typescript
files: defineTable({
  // ... 其他字段
  storageId: v.optional(v.id("_storage")),  // 大文件存储 ID
}).index(...)
```

---

## 5.11 练习建议

1. **查看 Schema**：阅读 `convex/schema.ts`，理解所有表的结构
2. **创建新 Query**：在 `convex/files.ts` 中添加 `searchFiles` 查询
3. **添加索引**：为 `files` 表添加按名称搜索的索引
4. **前端订阅**：创建一个页面，实时显示文件列表
5. **乐观更新**：为一个 mutation 添加乐观更新逻辑

### 实践：创建文件搜索功能

```typescript
// 1. 在 schema.ts 中添加索引
files: defineTable({
  // ...
})
  .index("by_project_name", ["projectId", "name"]);  // 新增

// 2. 添加搜索 Query
export const searchFiles = query({
  args: {
    projectId: v.id("projects"),
    searchTerm: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get("projects", args.projectId);

    if (!project || project.ownerId !== identity.subject) {
      throw new Error("Unauthorized");
    }

    const files = await ctx.db
      .query("files")
      .withIndex("by_project_name", (q) =>
        q.eq("projectId", args.projectId)
      )
      .collect();

    // 在内存中过滤（简单实现，生产环境可用搜索引擎）
    return files.filter((f) =>
      f.name.toLowerCase().includes(args.searchTerm.toLowerCase())
    );
  },
});
```

---

## 5.12 总结

本节课我们了解到：

- ✅ **Convex 简介**：实时数据库、无 API 层、自动类型生成
- ✅ **Schema 定义**：defineTable、索引、v 验证器
- ✅ **Query 函数**：只读查询、索引查询、排序分页
- ✅ **Mutation 函数**：创建、更新、删除、递归操作
- ✅ **自动生成类型**：Doc、Id、api 的使用
- ✅ **前端 Hooks**：useQuery、useMutation、乐观更新
- ✅ **认证与权限**：verifyAuth、ownerId 检查
- ✅ **文件存储**：ctx.storage.store/getUrl/delete

**下一课预告**：Zustand 状态管理 - 深入理解 Zustand 在编辑器状态管理中的应用。
