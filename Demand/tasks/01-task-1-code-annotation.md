# 任务 1 核心代码逐行解析

## 文件 1: convex/projects.ts - 后端函数

### create mutation（创建项目）

```typescript
// 导出一个名为 create 的 mutation
// mutation 用于写操作（创建、更新、删除）
export const create = mutation({
  // 定义参数类型
  // v.string() 表示参数必须是字符串
  args: {
    name: v.string(),
  },

  // handler 是实际执行的函数
  // ctx 包含数据库、认证等上下文
  // args 是传入的参数
  handler: async (ctx, args) => {
    // 第 1 步：验证用户身份
    // verifyAuth 从 Clerk 获取当前登录用户
    const identity = await verifyAuth(ctx);

    // 第 2 步：插入新项目到数据库
    // ctx.db.insert 返回新记录的 ID
    const projectId = await ctx.db.insert("projects", {
      name: args.name,              // 项目名称（来自参数）
      ownerId: identity.subject,    // 所有者 ID（来自认证）
      updatedAt: Date.now(),        // 更新时间戳
    });

    // 第 3 步：返回新项目 ID
    return projectId;
  },
});
```

### get query（获取项目列表）

```typescript
// 导出一个名为 get 的 query
// query 用于读操作（不能修改数据）
export const get = query({
  // 没有参数，所以是空对象
  args: {},

  handler: async (ctx) => {
    // 第 1 步：验证用户身份
    const identity = await verifyAuth(ctx);

    // 第 2 步：查询数据库
    return await ctx.db
      .query("projects")           // 查询 projects 表
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", identity.subject)  // 只查当前用户的项目
      )
      .order("desc")               // 按更新时间倒序排列
      .collect();                  // 收集所有结果（数组）
  },
});
```

### rename mutation（重命名项目）

```typescript
export const rename = mutation({
  args: {
    id: v.id("projects"),   // 项目 ID（凸类型验证）
    name: v.string(),       // 新名称
  },
  handler: async (ctx, args) => {
    // 第 1 步：验证用户身份
    const identity = await verifyAuth(ctx);

    // 第 2 步：获取项目信息
    const project = await ctx.db.get("projects", args.id);

    // 第 3 步：检查项目是否存在
    if (!project) {
      throw new Error("Project not found");
    }

    // 第 4 步：权限校验（核心安全逻辑）
    // 只有项目所有者才能修改
    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to this project");
    }

    // 第 5 步：更新项目
    // ctx.db.patch 只更新指定字段
    await ctx.db.patch("projects", args.id, {
      name: args.name,          // 新名称
      updatedAt: Date.now(),    // 更新时间戳
    });
  },
});
```

---

## 文件 2: src/features/projects/hooks/use-projects.ts

### useProjects（获取所有项目）

```typescript
// 自定义 Hook：获取用户的所有项目
export const useProjects = () => {
  // useQuery 会自动订阅数据变化
  // 当数据库变化时，组件自动重新渲染
  return useQuery(api.projects.get);
  //           ^^^^^^^^^^^^^^^^^^
  //           指向 convex/projects.ts 中的 get 函数
};
```

### useProjectsPartial（获取部分项目）

```typescript
// 自定义 Hook：获取前 N 个项目（用于首页预览）
export const useProjectsPartial = (limit: number) => {
  return useQuery(api.projects.getPartial, {
    limit,  // 限制返回数量
  });
};
```

### useCreateProject（创建项目 + 乐观更新）

```typescript
export const useCreateProject = () => {
  // useMutation 返回一个可调用函数
  return useMutation(api.projects.create)
    // withOptimisticUpdate 实现乐观更新
    .withOptimisticUpdate(
      // localStore: 本地缓存存储
      // args: 传入 mutation 的参数
      (localStore, args) => {
        // 第 1 步：获取当前项目列表
        const existingProjects = localStore.getQuery(api.projects.get);

        // 第 2 步：如果数据已加载，执行乐观更新
        if (existingProjects !== undefined) {
          const now = Date.now();

          // 创建临时项目对象
          const newProject = {
            // 生成临时 ID（UUID 格式）
            _id: crypto.randomUUID() as Id<"projects">,
            _creationTime: now,
            name: args.name,
            // 注意：这里用 "anonymous" 只是占位
            // 服务器会用真实的 ownerId 替换
            ownerId: "anonymous",
            updatedAt: now,
          };

          // 第 3 步：更新本地缓存
          // 将新项目添加到列表开头
          localStore.setQuery(
            api.projects.get,  // 更新哪个查询
            {},                // 查询参数（空对象）
            [newProject, ...existingProjects]  // 新数据
          );
        }
      }
    )
};
```

### useRenameProject（重命名项目 + 乐观更新）

```typescript
export const useRenameProject = () => {
  return useMutation(api.projects.rename).withOptimisticUpdate(
    (localStore, args) => {
      // 第 1 步：更新单个项目的缓存
      const existingProject = localStore.getQuery(
        api.projects.getById,
        { id: args.id }
      );

      if (existingProject !== undefined && existingProject !== null) {
        // 更新单个项目详情
        localStore.setQuery(
          api.projects.getById,
          { id: args.id },
          {
            ...existingProject,
            name: args.name,
            updatedAt: Date.now(),
          }
        );
      }

      // 第 2 步：更新项目列表的缓存
      const existingProjects = localStore.getQuery(api.projects.get);

      if (existingProjects !== undefined) {
        localStore.setQuery(
          api.projects.get,
          {},
          // 遍历所有项目，更新匹配的项目
          existingProjects.map((project) => {
            return project._id === args.id
              ? { ...project, name: args.name, updatedAt: Date.now() }
              : project
          })
        );
      }
    }
  )
};
```

---

## 文件 3: src/features/projects/components/projects-list.tsx

### 格式化时间函数

```typescript
// 将时间戳转换为相对时间（如 "3 天前"）
const formatTimestamp = (timestamp: number) => {
  // date-fns 是一个轻量级日期处理库
  return formatDistanceToNow(new Date(timestamp), {
    addSuffix: true  // 添加后缀（" ago" 或 "后"）
  });
};
```

### 获取项目图标函数

```typescript
// 根据项目状态返回不同图标
const getProjectIcon = (project: Doc<"projects">) => {
  // 从 GitHub 导入完成
  if (project.importStatus === "completed") {
    return <FaGithub className="size-3.5 text-muted-foreground" />
  }

  // 导入失败
  if (project.importStatus === "failed") {
    return <AlertCircleIcon className="size-3.5 text-muted-foreground" />;
  }

  // 正在导入
  if (project.importStatus === "importing") {
    return (
      <Loader2Icon className="size-3.5 text-muted-foreground animate-spin" />
      // animate-spin 让图标旋转
    );
  }

  // 普通项目（默认图标）
  return <GlobeIcon className="size-3.5 text-muted-foreground" />;
};
```

### ContinueCard 组件（最近项目卡片）

```typescript
const ContinueCard = ({ data }: { data: Doc<"projects"> }) => {
  return (
    <div className="flex flex-col gap-2">
      {/* 标题 */}
      <span className="text-xs text-muted-foreground">
        Last updated
      </span>

      {/* 卡片按钮 */}
      <Button
        variant="outline"
        asChild          // asChild 让 Button 渲染为子组件（Link）
        className="..."
      >
        <Link href={`/projects/${data._id}`} className="group">
          {/* 顶部：项目名和图标 */}
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              {getProjectIcon(data)}
              <span className="font-medium truncate">
                {data.name}
              </span>
              {/* truncate 文本超出省略 */}
            </div>
            {/* 箭头图标，悬停时右移 */}
            <ArrowRightIcon
              className="size-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform"
            />
          </div>

          {/* 底部：更新时间 */}
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(data.updatedAt)}
          </span>
        </Link>
      </Button>
    </div>
  )
};
```

### ProjectsList 主组件

```typescript
export const ProjectsList = ({ onViewAll }: ProjectsListProps) => {
  // 获取前 6 个项目
  const projects = useProjectsPartial(6);

  // 加载中状态
  if (projects === undefined) {
    return <Spinner className="size-4 text-ring" />
  }

  // 解构数组：第一个是最近项目，其余是其他项目
  const [mostRecent, ...rest] = projects;

  return (
    <div className="flex flex-col gap-4">
      {/* 显示最近项目（如果有） */}
      {mostRecent ? <ContinueCard data={mostRecent} /> : null}

      {/* 显示其他项目列表（如果有） */}
      {rest.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* 标题和"查看全部"按钮 */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Recent projects
            </span>
            <button
              onClick={onViewAll}
              className="..."
            >
              <span>View all</span>
              <Kbd className="bg-accent border">
                ⌘K
              </Kbd>
            </button>
          </div>

          {/* 项目列表 */}
          <ul className="flex flex-col">
            {rest.map((project) => (
              <ProjectItem
                key={project._id}
                data={project}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
};
```

---

## 文件 4: src/features/projects/components/new-project-dialog.tsx

### 提交处理函数

```typescript
const handleSubmit = async (message: PromptInputMessage) => {
  // 防御性检查：没有文本则不提交
  if (!message.text) return;

  // 设置提交中状态
  setIsSubmitting(true);

  try {
    // 调用 API 创建项目
    // ky 是一个轻量级 HTTP 客户端
    const { projectId } = await ky
      .post("/api/projects/create-with-prompt", {
        json: { prompt: message.text.trim() },
      })
      .json<{ projectId: Id<"projects"> }>();
    //            ^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //            TypeScript 泛型：指定返回类型

    // 显示成功提示
    toast.success("Project created");

    // 关闭对话框
    onOpenChange(false);

    // 清空输入框
    setInput("");

    // 跳转到新项目页面
    router.push(`/projects/${projectId}`);
  } catch {
    // 显示错误提示
    toast.error("Unable to create project");
  } finally {
    // 无论成功失败，都重置提交状态
    setIsSubmitting(false);
  }
};
```

---

## 数据流示意图

```
用户操作流程
    ↓
[用户点击新建项目]
    ↓
[输入项目名称]
    ↓
[点击提交]
    ↓
handleSubmit 执行
    ↓
┌───────────────────────────────────┐
│ 乐观更新（立即执行）                 │
│ localStore.setQuery(...)          │
│ UI 立即显示新项目                  │
└───────────────────────────────────┘
    ↓
┌───────────────────────────────────┐
│ 后台请求（异步执行）                 │
│ ky.post('/api/...')               │
│ 发送到 Convex 服务器                │
└───────────────────────────────────┘
    ↓
Convex Server 执行
    ↓
┌───────────────────────────────────┐
│ verifyAuth(ctx)                    │
│ 验证用户身份（Clerk）               │
└───────────────────────────────────┘
    ↓
┌───────────────────────────────────┐
│ ctx.db.insert("projects", {...})   │
│ 插入数据库                         │
└───────────────────────────────────┘
    ↓
┌───────────────────────────────────┐
│ Convex 推送更新给所有订阅的客户端   │
│ WebSocket 广播                       │
└───────────────────────────────────┘
    ↓
客户端接收更新
    ↓
useQuery 自动触发重新渲染
    ↓
UI 显示最新数据（与乐观更新一致）
```

---

## 关键概念总结

| 概念 | 位置 | 作用 |
|------|------|------|
| `mutation` | convex/projects.ts | 写操作（创建/更新/删除） |
| `query` | convex/projects.ts | 读操作（获取数据） |
| `verifyAuth` | convex/auth.ts | 验证用户身份 |
| `useQuery` | React hooks | 订阅 Convex 数据 |
| `useMutation` | React hooks | 执行 Convex mutation |
| `withOptimisticUpdate` | React hooks | 乐观更新，立即反映到 UI |
| `localStore.setQuery` | 乐观更新回调 | 手动更新本地缓存 |
