# 任务 1：项目列表与基础 CRUD - 详细学习指南

## 学习目标

完成本任务后，你将理解：
1. Convex 数据模型设计
2. Query 和 Mutation 的编写
3. React Hooks 与 Convex 集成
4. 乐观更新 (Optimistic Update) 原理
5. 用户认证与权限校验

---

## 第一步：理解数据模型 (Schema)

### 阅读文件：`convex/schema.ts` (第 5-31 行)

```typescript
projects: defineTable({
  name: v.string(),
  ownerId: v.string(),
  updatedAt: v.number(),
  importStatus: v.optional(...),
  exportStatus: v.optional(...),
  exportRepoUrl: v.optional(v.string()),
  settings: v.optional(v.object({...})),
}).index("by_owner", ["ownerId"]),
```

### 关键知识点

| 概念 | 说明 |
|------|------|
| `defineTable` | 定义数据库表 |
| `v.string()` | 字段类型验证器 |
| `v.optional()` | 可选字段 |
| `index("by_owner", ["ownerId"])` | 创建索引，支持按 ownerId 查询 |

### 思考问题
1. 为什么要给 `ownerId` 创建索引？
2. 为什么 `settings` 是可选的？

---

## 第二步：学习 Convex 函数

### 2.1 Mutation - 创建项目

阅读文件：`convex/projects.ts` (第 34-49 行)

```typescript
export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);  // ① 验证用户身份

    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      ownerId: identity.subject,  // ② 自动关联当前用户
      updatedAt: Date.now(),
    });

    return projectId;
  },
});
```

### 2.2 Query - 获取项目列表

阅读文件：`convex/projects.ts` (第 66-77 行)

```typescript
export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await verifyAuth(ctx);  // ① 验证用户身份

    return await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))  // ② 使用索引查询
      .order("desc")  // ③ 按时间倒序
      .collect();  // ④ 获取所有结果
  },
});
```

### 2.3 Mutation - 重命名项目

阅读文件：`convex/projects.ts` (第 100-123 行)

```typescript
export const rename = mutation({
  args: {
    id: v.id("projects"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get("projects", args.id);

    // 权限校验：只有项目所有者才能修改
    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to this project");
    }

    await ctx.db.patch("projects", args.id, {
      name: args.name,
      updatedAt: Date.now(),
    });
  },
});
```

### 关键知识点

| Convex API | 用途 |
|-----------|------|
| `ctx.db.insert(table, data)` | 插入新记录 |
| `ctx.db.get(table, id)` | 根据 ID 获取单条记录 |
| `ctx.db.patch(table, id, data)` | 更新记录 |
| `ctx.db.query(table).withIndex(...)` | 使用索引查询 |

---

## 第三步：学习认证机制

### 阅读文件：`convex/auth.ts`

```typescript
export const verifyAuth = async (ctx: QueryCtx | MutationCtx) => {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Authentication required");
  }

  return identity;
};
```

### 认证流程

```
用户登录 (Clerk)
    ↓
请求 Convex 函数
    ↓
ctx.auth.getUserIdentity() 获取用户身份
    ↓
identity.subject 包含用户 ID
    ↓
用于 ownerId 校验和权限控制
```

---

## 第四步：React Hooks 封装

### 4.1 使用 useQuery 获取数据

阅读文件：`src/features/projects/hooks/use-projects.ts` (第 12-20 行)

```typescript
export const useProjects = () => {
  return useQuery(api.projects.get);
};

export const useProjectsPartial = (limit: number) => {
  return useQuery(api.projects.getPartial, { limit });
};
```

### 4.2 使用 useMutation 执行变更

阅读文件：`src/features/projects/hooks/use-projects.ts` (第 22-44 行)

```typescript
export const useCreateProject = () => {
  return useMutation(api.projects.create).withOptimisticUpdate(
    (localStore, args) => {
      const existingProjects = localStore.getQuery(api.projects.get);

      if (existingProjects !== undefined) {
        const now = Date.now();
        const newProject = {
          _id: crypto.randomUUID() as Id<"projects">,
          _creationTime: now,
          name: args.name,
          ownerId: "anonymous",  // 临时值，服务器会更新
          updatedAt: now,
        };

        localStore.setQuery(api.projects.get, {}, [
          newProject,
          ...existingProjects,
        ]);
      }
    }
  )
};
```

### 关键知识点

| Hook | 用途 |
|------|------|
| `useQuery(api, args)` | 订阅 Convex 查询，自动更新 |
| `useMutation(api)` | 执行 Convex mutation |
| `.withOptimisticUpdate()` | 乐观更新，立即反映到 UI |
| `localStore.setQuery()` | 手动更新本地缓存 |

### 乐观更新原理

```
用户点击创建
    ↓
立即更新本地 UI（不等待服务器）
    ↓
后台发送请求到服务器
    ↓
服务器成功后，UI 已经是正确状态
    ↓
如果失败，回滚更改
```

---

## 第五步：组件层实现

### 5.1 项目列表组件

阅读文件：`src/features/projects/components/projects-list.tsx`

关键函数：
- `getProjectIcon()` - 根据项目状态显示不同图标
- `formatTimestamp()` - 格式化时间为相对时间
- `ContinueCard` - 显示最近项目（大卡片）
- `ProjectItem` - 显示其他项目（列表项）

### 5.2 新建项目对话框

阅读文件：`src/features/projects/components/new-project-dialog.tsx`

关键逻辑：
```typescript
const handleSubmit = async (message: PromptInputMessage) => {
  if (!message.text) return;

  setIsSubmitting(true);

  try {
    // 调用 API 创建项目
    const { projectId } = await ky.post("/api/projects/create-with-prompt", {
      json: { prompt: message.text.trim() },
    }).json<{ projectId: Id<"projects"> }>();

    toast.success("Project created");
    router.push(`/projects/${projectId}`);  // 跳转到项目页
  } catch {
    toast.error("Unable to create project");
  } finally {
    setIsSubmitting(false);
  }
};
```

---

## 第六步：实践练习

### 练习 1：添加项目删除功能

**目标**：实现删除项目的完整流程

**步骤**：

1. 在 `convex/projects.ts` 添加删除函数：

```typescript
export const remove = mutation({
  args: {
    id: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get("projects", args.id);

    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized");
    }

    // TODO: 先删除关联的文件、对话等
    await ctx.db.delete("projects", args.id);
  },
});
```

2. 在 `src/features/projects/hooks/use-projects.ts` 添加 hook：

```typescript
export const useDeleteProject = () => {
  return useMutation(api.projects.remove).withOptimisticUpdate(
    (localStore, args) => {
      const existingProjects = localStore.getQuery(api.projects.get);

      if (existingProjects !== undefined) {
        localStore.setQuery(
          api.projects.get,
          {},
          existingProjects.filter((p) => p._id !== args.id)
        );
      }
    }
  );
};
```

3. 在项目列表中添加删除按钮

### 练习 2：添加项目描述字段

**步骤**：

1. 修改 `convex/schema.ts`：
```typescript
projects: defineTable({
  name: v.string(),
  description: v.optional(v.string()),  // 新增字段
  ownerId: v.string(),
  // ...
})
```

2. 修改 `convex/projects.ts` 的 `create` 和 `rename` 函数
3. 添加 `updateDescription` mutation

### 练习 3：添加项目创建时间显示

**步骤**：

1. 在 schema 中添加 `createdAt` 字段
2. 在创建项目时设置 `createdAt: Date.now()`
3. 在 UI 中显示 "创建于 X 天前"

---

## 第七步：运行和调试

### 启动项目

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 查看 Convex 函数

访问 https://dashboard.convex.dev 查看：
- 函数执行日志
- 数据库内容
- 实时查询

---

## 检查清单

完成以下任务后，标记为 ✅：

- [ ] 能解释 `defineTable` 的作用
- [ ] 能解释 `v.string()` 和 `v.optional()` 的区别
- [ ] 能解释索引的作用
- [ ] 能解释 `verifyAuth` 的工作原理
- [ ] 能解释 `useQuery` 和 `useMutation` 的区别
- [ ] 能解释乐观更新的原理
- [ ] 完成练习 1（删除功能）
- [ ] 完成练习 2（描述字段）

---

## 常见问题

### Q1: 为什么 `useQuery` 可以自动更新？
**A**: Convex 建立了 WebSocket 连接，当数据库变化时，自动推送新数据给订阅的组件。

### Q2: 乐观更新失败怎么办？
**A**: Convex 会自动回滚乐观更新，UI 会恢复到之前的状态。

### Q3: 为什么要验证 `ownerId`？
**A**: 防止用户 A 修改用户 B 的项目，这是基本的安全措施。

---

## 下一步

完成本任务后，继续学习 **任务 2：文件树与文件系统**
