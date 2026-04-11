# 第 14 课：GitHub 集成开发

> **学习目标：** 掌握 Polaris 项目中 GitHub OAuth 认证、仓库导入（Import）和仓库导出（Export）的完整实现，理解后台任务与 GitHub API 的协作模式。

---

## 一、整体架构概览

Polaris 的 GitHub 集成包含三大功能：

| 功能 | 路由 | 后台任务 | 说明 |
|------|------|---------|------|
| **导入** | `POST /api/github/import` | `import-github-repo` | 从 GitHub 仓库导入到 Polaris 项目 |
| **导出** | `POST /api/github/export` | `export-to-github` | 从 Polaris 项目导出到 GitHub 仓库 |
| **取消导出** | `POST /api/github/export/cancel` | — | 中途取消正在进行的导出 |
| **重置状态** | `POST /api/github/export/reset` | — | 重置导出状态，允许重新导出 |

**完整数据流：**

```
用户操作 (点击 Import/Export)
    ↓
Next.js API Route (认证 + 授权检查)
    ↓
获取 GitHub OAuth Token (从 Clerk)
    ↓
发送 Inngest 事件
    ↓
Inngest 后台任务 (真正执行 GitHub API)
    ↓
Convex 数据库 (存储项目文件)
    ↓
前端通过 useQuery 订阅状态变化
    ↓
UI 自动更新 (Loading → Success/Failed)
```

---

## 二、GitHub OAuth 认证

### 2.1 Clerk 作为 OAuth 中间层

Polaris 使用 **Clerk** 管理 GitHub OAuth，不直接处理 OAuth 流程。用户在 Clerk 的用户面板中连接 GitHub 账号，Clerk 存储和管理 OAuth Token。

**获取 GitHub Token 的流程：**

```tsx
// src/app/api/github/import/route.ts
import { auth, clerkClient } from "@clerk/nextjs/server";

// 1. 获取当前用户
const { userId } = await auth();

// 2. 从 Clerk 获取 GitHub OAuth Token
const client = await clerkClient();
const tokens = await client.users.getUserOauthAccessToken(userId, "github");
const githubToken = tokens.data[0]?.token;

if (!githubToken) {
  return NextResponse.json(
    { error: "GitHub not connected. Please reconnect your GitHub account." },
    { status: 400 }
  );
}
```

**关键点：**
- `clerkClient().users.getUserOauthAccessToken(userId, "github")` — 从 Clerk 的 OAuth 连接中获取存储的 GitHub Token
- 这个 Token 是用户之前在 Clerk 面板中授权的，无需在应用内重新 OAuth
- 如果 Token 不存在，说明用户尚未连接 GitHub 账号

### 2.2 Plan 权限检查

```tsx
const { has } = await auth();
const hasPro = has({ plan: "pro" });

if (!hasPro) {
  return NextResponse.json({ error: "Pro plan required" }, { status: 403 });
}
```

> 只有 Pro 计划用户才能使用 GitHub 导入/导出功能。

---

## 三、仓库导入（Import）

### 3.1 API 路由

```tsx
// src/app/api/github/import/route.ts
export async function POST(request: Request) {
  // 1. 认证 + Plan 检查
  const { userId, has } = await auth();
  if (!userId || !has({ plan: "pro" })) { /* ... */ }

  // 2. 解析 GitHub URL
  const { url } = requestSchema.parse(body);
  // https://github.com/owner/repo → { owner: "owner", repo: "repo" }
  const { owner, repo } = parseGitHubUrl(url);

  // 3. 获取 GitHub Token
  const githubToken = /* ... */;

  // 4. 通过 Inngest 后台创建项目 + 触发导入
  const projectId = await convex.mutation(api.system.createProject, {
    internalKey,
    name: repo,
    ownerId: userId,
  });

  const event = await inngest.send({
    name: "github/import.repo",
    data: { owner, repo, projectId, githubToken },
  });

  // 5. 立即返回，前端开始轮询/订阅状态
  return NextResponse.json({ success: true, projectId, eventId: event.ids[0] });
}
```

**URL 解析函数：**

```tsx
function parseGitHubUrl(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new Error("Invalid GitHub URL");
  }
  // 支持 .git 后缀
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}
```

### 3.2 前端：ImportGithubDialog

```tsx
// src/features/projects/components/import-github-dialog.tsx
export const ImportGithubDialog = ({ open, onOpenChange }) => {
  const router = useRouter();
  const { openUserProfile } = useClerk();

  const form = useForm({
    defaultValues: { url: "" },
    validators: { onSubmit: z.object({ url: z.url() }) },
    onSubmit: async ({ value }) => {
      // 调用导入 API
      const { projectId } = await ky
        .post("/api/github/import", { json: { url: value.url } })
        .json();

      toast.success("Importing repository...");
      onOpenChange(false);
      // 跳转到新项目页面
      router.push(`/projects/${projectId}`);
    },
  });
};
```

**表单验证：** 使用 Zod schema 确保 URL 格式正确（`z.url()`）。

### 3.3 后台任务：importGithubRepo

Inngest 函数按步骤执行，这是整个导入的核心逻辑：

```tsx
// src/features/projects/inngest/import-github-repo.ts
export const importGithubRepo = inngest.createFunction(
  { id: "import-github-repo", onFailure: async ({ event, step }) => { /* 失败处理 */ } },
  { event: "github/import.repo" },
  async ({ event, step }) => {
    const { owner, repo, projectId, githubToken } = event.data;
    const octokit = new Octokit({ auth: githubToken });

    // Step 1: 清理项目现有文件
    await step.run("cleanup-project", async () => {
      await convex.mutation(api.system.cleanup, { internalKey, projectId });
    });

    // Step 2: 获取 GitHub 仓库文件树
    const tree = await step.run("fetch-repo-tree", async () => {
      // 优先尝试 main 分支，fallback 到 master
      try {
        const { data } = await octokit.rest.git.getTree({
          owner, repo, tree_sha: "main", recursive: "1",
        });
        return data;
      } catch {
        const { data } = await octokit.rest.git.getTree({
          owner, repo, tree_sha: "master", recursive: "1",
        });
        return data;
      }
    });

    // Step 3: 按深度排序，创建所有文件夹
    const folderIdMap = await step.run("create-folders", async () => {
      const folders = tree.tree
        .filter((item) => item.type === "tree" && item.path)
        .sort((a, b) => a.path.split("/").length - b.path.split("/").length);

      const map: Record<string, Id<"files">> = {};
      for (const folder of folders) {
        const pathParts = folder.path.split("/");
        const name = pathParts.pop()!;
        const parentPath = pathParts.join("/");
        const parentId = parentPath ? map[parentPath] : undefined;

        const folderId = await convex.mutation(api.system.createFolder, {
          internalKey, projectId, name, parentId,
        });
        map[folder.path] = folderId;
      }
      return map;
    });

    // Step 4: 创建所有文件
    await step.run("create-files", async () => {
      const allFiles = tree.tree.filter(
        (item) => item.type === "blob" && item.path && item.sha
      );

      for (const file of allFiles) {
        // 获取文件 blob 内容
        const { data: blob } = await octokit.rest.git.getBlob({
          owner, repo, file_sha: file.sha,
        });

        const buffer = Buffer.from(blob.content, "base64");
        const isBinary = await isBinaryFile(buffer);

        const pathParts = file.path.split("/");
        const name = pathParts.pop()!;
        const parentPath = pathParts.join("/");
        const parentId = parentPath ? folderIdMap[parentPath] : undefined;

        if (isBinary) {
          // 二进制文件：上传到 Convex Storage
          const uploadUrl = await convex.mutation(api.system.generateUploadUrl, { internalKey });
          const { storageId } = await ky.post(uploadUrl, {
            headers: { "Content-Type": "application/octet-stream" },
            body: buffer,
          }).json();

          await convex.mutation(api.system.createBinaryFile, {
            internalKey, projectId, name, storageId, parentId,
          });
        } else {
          // 文本文件：直接存储内容
          const content = buffer.toString("utf-8");
          await convex.mutation(api.system.createFile, {
            internalKey, projectId, name, content, parentId,
          });
        }
      }
    });

    // Step 5: 更新状态为完成
    await step.run("set-completed-status", async () => {
      await convex.mutation(api.system.updateImportStatus, {
        internalKey, projectId, status: "completed",
      });
    });

    return { success: true, projectId };
  }
);
```

**导入流程图解：**

```
GitHub Repo (多个文件和文件夹)
  ↓ getTree (一次 API 调用获取完整树)
[文件树对象]
  ↓
  ├── 文件夹 (tree) → 按深度排序 → 逐个 createFolder
  └── 文件 (blob)  → 逐个处理
        ├── 文本文件 → base64 解码 → convex mutation createFile
        └── 二进制文件 → base64 解码 → Convex Storage → convex mutation createBinaryFile
```

**关键设计：**

1. **文件夹按深度排序** — 必须先创建父文件夹，再创建子文件夹
2. **文件夹 ID Map** — 记录文件夹路径到 ID 的映射，用于确定文件的 parentId
3. **二进制文件检测** — 使用 `isbinaryfile` 判断文件类型，二进制文件走 Storage 上传
4. **main → master fallback** — 兼容不同仓库的默认分支名

---

## 四、仓库导出（Export）

### 4.1 API 路由

```tsx
// src/app/api/github/export/route.ts
export async function POST(request: Request) {
  // 认证 + Plan 检查
  const { userId, has } = await auth();
  if (!userId || !has({ plan: "pro" })) { /* ... */ }

  const { projectId, repoName, visibility, description } = requestSchema.parse(body);

  // 获取 GitHub Token
  const githubToken = /* ... */;

  // 发送导出事件
  const event = await inngest.send({
    name: "github/export.repo",
    data: { projectId, repoName, visibility, description, githubToken },
  });

  return NextResponse.json({ success: true, projectId, eventId: event.ids[0] });
}
```

### 4.2 前端：ExportPopover

ExportPopover 是一个状态驱动的 Popover，展示了导出前、导出中、完成、失败四种状态：

```tsx
// src/features/projects/components/export-popover.tsx
export const ExportPopover = ({ projectId }: { projectId: Id<"projects"> }) => {
  const project = useProject(projectId);
  const exportStatus = project?.exportStatus;
  const exportRepoUrl = project?.exportRepoUrl;

  const renderContent = () => {
    if (exportStatus === "exporting") {
      return (
        <div className="flex flex-col items-center gap-3">
          <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Exporting to GitHub...</p>
          <Button size="sm" variant="outline" className="w-full" onClick={handleCancelExport}>
            Cancel
          </Button>
        </div>
      );
    }

    if (exportStatus === "completed" && exportRepoUrl) {
      return (
        <div className="flex flex-col items-center gap-3">
          <CheckCircle2Icon className="size-6 text-emerald-500" />
          <p className="text-sm font-medium">Repository created</p>
          <Button size="sm" className="w-full" asChild>
            <Link href={exportRepoUrl} target="_blank">
              <ExternalLinkIcon className="size-4 mr-1" />
              View on GitHub
            </Link>
          </Button>
        </div>
      );
    }

    if (exportStatus === "failed") {
      return (
        <div className="flex flex-col items-center gap-3">
          <XCircleIcon className="size-6 text-rose-500" />
          <p className="text-sm font-medium">Unable to export</p>
          <Button size="sm" variant="outline" onClick={handleResetExport}>Retry</Button>
        </div>
      );
    }

    // 默认：导出表单
    return <ExportForm />;
  };

  const getStatusIcon = () => {
    if (exportStatus === "exporting") return <LoaderIcon className="size-3.5 animate-spin" />;
    if (exportStatus === "completed") return <CheckCheckIcon className="size-3.5 text-emerald-500" />;
    if (exportStatus === "failed") return <XCircleIcon className="size-3.5 text-red-500" />;
    return <FaGithub className="size-3.5" />;
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className="flex items-center gap-1.5 h-full px-3 cursor-pointer text-muted-foreground border-l hover:bg-accent/30">
          {getStatusIcon()}
          <span className="text-sm">Export</span>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        {renderContent()}
      </PopoverContent>
    </Popover>
  );
};
```

**设计亮点：** 状态完全由 Convex 数据库驱动，前端只负责渲染和交互。当导出完成后，`exportStatus` 更新为 `"completed"`，前端自动切换到成功视图。

### 4.3 后台任务：exportToGithub

导出比导入复杂，因为需要使用 Git 的底层 API（而非文件 API）来创建仓库。

```tsx
// src/features/projects/inngest/export-to-github.ts
export const exportToGithub = inngest.createFunction(
  {
    id: "export-to-github",
    // 支持取消：发送 github/export.cancel 事件时停止
    cancelOn: [
      { event: "github/export.cancel", if: "event.data.projectId == async.data.projectId" }
    ],
    onFailure: async ({ event, step }) => {
      // 失败时更新状态
      await step.run("set-failed-status", async () => {
        await convex.mutation(api.system.updateExportStatus, {
          internalKey, projectId, status: "failed",
        });
      });
    },
  },
  { event: "github/export.repo" },
  async ({ event, step }) => {
    const { projectId, repoName, visibility, description, githubToken } = event.data;
    const octokit = new Octokit({ auth: githubToken });

    // Step 1: 更新状态为 exporting
    await step.run("set-exporting-status", async () => {
      await convex.mutation(api.system.updateExportStatus, {
        internalKey, projectId, status: "exporting",
      });
    });

    // Step 2: 获取 GitHub 认证用户
    const { data: user } = await step.run("get-github-user", async () => {
      return await octokit.rest.users.getAuthenticated();
    });

    // Step 3: 创建仓库 (auto_init 自动生成初始提交)
    const { data: repo } = await step.run("create-repo", async () => {
      return await octokit.rest.repos.createForAuthenticatedUser({
        name: repoName,
        description: description || `Exported from Polaris`,
        private: visibility === "private",
        auto_init: true,
      });
    });

    // Step 4: 等待 GitHub 完成初始化
    await step.sleep("wait-for-repo-init", "3s");

    // Step 5: 获取初始提交的 SHA（作为新提交的父提交）
    const initialCommitSha = await step.run("get-initial-commit", async () => {
      const { data: ref } = await octokit.rest.git.getRef({
        owner: user.login, repo: repoName, ref: "heads/main",
      });
      return ref.object.sha;
    });

    // Step 6: 获取项目所有文件（包含 storage URL）
    const files = await step.run("fetch-project-files", async () => {
      return (await convex.query(api.system.getProjectFilesWithUrls, {
        internalKey, projectId,
      })) as FileWithUrl[];
    });

    // Step 7: 构建文件路径映射
    const buildFilePaths = (files: FileWithUrl[]) => {
      const fileMap = new Map<Id<"files">, FileWithUrl>();
      files.forEach((f) => fileMap.set(f._id, f));

      const getFullPath = (file: FileWithUrl): string => {
        if (!file.parentId) return file.name;
        const parent = fileMap.get(file.parentId);
        if (!parent) return file.name;
        return `${getFullPath(parent)}/${file.name}`;
      };

      const paths: Record<string, FileWithUrl> = {};
      files.forEach((file) => { paths[getFullPath(file)] = file; });
      return paths;
    };

    const filePaths = buildFilePaths(files);

    // Step 8: 为每个文件创建 Git blob
    const treeItems = await step.run("create-blobs", async () => {
      const items = [];
      const fileEntries = Object.entries(filePaths).filter(([, file]) => file.type === "file");

      for (const [path, file] of fileEntries) {
        let content: string;
        let encoding: "utf-8" | "base64" = "utf-8";

        if (file.content !== undefined) {
          content = file.content;  // 文本文件
        } else if (file.storageUrl) {
          // 二进制文件：从 Storage 下载并 base64 编码
          const response = await ky.get(file.storageUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          content = buffer.toString("base64");
          encoding = "base64";
        } else {
          continue;
        }

        const { data: blob } = await octokit.rest.git.createBlob({
          owner: user.login, repo: repoName, content, encoding,
        });

        items.push({ path, mode: "100644", type: "blob", sha: blob.sha });
      }
      return items;
    });

    // Step 9: 创建 Git tree
    const { data: tree } = await step.run("create-tree", async () => {
      return await octokit.rest.git.createTree({
        owner: user.login, repo: repoName, tree: treeItems,
      });
    });

    // Step 10: 创建 Git commit
    const { data: commit } = await step.run("create-commit", async () => {
      return await octokit.rest.git.createCommit({
        owner: user.login,
        repo: repoName,
        message: "Initial commit from Polaris",
        tree: tree.sha,
        parents: [initialCommitSha],
      });
    });

    // Step 11: 更新 main 分支指向新提交
    await step.run("update-branch-ref", async () => {
      return await octokit.rest.git.updateRef({
        owner: user.login, repo: repoName,
        ref: "heads/main", sha: commit.sha, force: true,
      });
    });

    // Step 12: 更新状态为完成
    await step.run("set-completed-status", async () => {
      await convex.mutation(api.system.updateExportStatus, {
        internalKey, projectId, status: "completed", repoUrl: repo.html_url,
      });
    });

    return { success: true, repoUrl: repo.html_url, filesExported: treeItems.length };
  }
);
```

**导出流程图解：**

```
Polaris 项目 (Convex 文件)
  ↓ getProjectFilesWithUrls
[文件列表 + storage URLs]
  ↓ buildFilePaths
{ "src/index.ts": File, "package.json": File }
  ↓
  ├── 文本文件: 直接读取 content
  └── 二进制文件: 从 storageUrl 下载 → base64 编码
        ↓ createBlob (每个文件一次 API 调用)
[{ path, mode, type, sha }]
  ↓ createTree (一次 API 调用)
Git Tree SHA
  ↓ createCommit (一次 API 调用)
Commit SHA
  ↓ updateRef (一次 API 调用)
GitHub Repo main 分支 → 新提交
```

**关键设计：**

1. **`auto_init: true`** — 创建仓库时自动生成一个 README 提交，省去初始化
2. **等待 3 秒** — GitHub 的 `auto_init` 是异步的，需要等待完成
3. **父子提交链** — 使用初始提交作为父提交，这样仓库历史完整
4. **支持取消** — `cancelOn` 配置使得发送 `github/export.cancel` 事件可以中断正在执行的导出

### 4.4 取消导出

```tsx
// src/app/api/github/export/cancel/route.ts
export async function POST(request: Request) {
  // 发送取消事件，Inngest 会自动根据 cancelOn 条件停止
  const event = await inngest.send({
    name: "github/export.cancel",
    data: { projectId },
  });

  // 同步更新状态
  await convex.mutation(api.system.updateExportStatus, {
    internalKey, projectId, status: "cancelled",
  });

  return NextResponse.json({ success: true, projectId, eventId: event.ids[0] });
}
```

---

## 五、Convex 系统 Mutations

所有 GitHub 相关的后台操作都通过 `convex/system.ts` 中的系统级 mutations 完成，这些 mutations 都使用 `internalKey` 进行验证：

| Mutation | 用途 |
|---------|------|
| `createProject` | 创建新项目（Import 时调用） |
| `createFolder` | 创建文件夹 |
| `createFile` | 创建文本文件 |
| `createBinaryFile` | 创建二进制文件（关联 Storage） |
| `generateUploadUrl` | 为二进制文件生成上传 URL |
| `cleanup` | 清理项目所有文件（Import 前调用） |
| `updateImportStatus` | 更新导入状态 |
| `updateExportStatus` | 更新导出状态 |
| `getProjectFilesWithUrls` | 获取文件列表（含 Storage URL） |

**`internalKey` 安全机制：**

```tsx
const validateInternalKey = (key: string) => {
  const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;
  if (!internalKey || key !== internalKey) {
    throw new Error("Invalid internal key");
  }
};
```

所有系统 mutations 都需要传入正确的 `internalKey`，这样即使用户的 Token 被盗，攻击者也无法从外部调用这些内部 API。

---

## 六、状态追踪机制

### 6.1 项目 Schema 中的状态字段

```tsx
// convex/schema.ts (projects 表)
defineTable({
  // ... 其他字段
  importStatus: v.optional(v.union(
    v.literal("importing"),
    v.literal("completed"),
    v.literal("failed")
  )),
  exportStatus: v.optional(v.union(
    v.literal("exporting"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled")
  )),
  exportRepoUrl: v.optional(v.string()),
})
```

### 6.2 前端订阅状态

```tsx
// src/features/projects/hooks/use-projects.ts
export const useProject = (projectId: Id<"projects">) => {
  return useQuery(api.projects.get, { projectId });
};

// 在 ExportPopover 中使用
const project = useProject(projectId);
const exportStatus = project?.exportStatus;  // 自动响应式更新
```

---

## 七、关键依赖

| 包 | 作用 |
|---|------|
| `octokit` | GitHub REST API 客户端 |
| `ky` | HTTP 客户端（用于下载 Storage 文件） |
| `isbinaryfile` | 检测文件是否为二进制 |
| `inngest` | 后台任务框架 |
| `@clerk/nextjs` | 认证和 OAuth Token 管理 |

---

## 八、API 限流处理

GitHub API 有严格的速率限制：

| 类型 | 限制 |
|------|------|
| 未认证请求 | 60 请求/小时 |
| OAuth 认证请求 | 5,000 请求/小时 |

Polaris 的处理策略：

1. **分步骤限流** — 每个 Inngest Step 之间有自然延迟，GitHub 会自动处理
2. **串行处理** — 文件创建在循环中串行执行，避免并发过高
3. **错误跳过** — 单个文件导入失败时打印错误但不中断整体流程：
   ```tsx
   try {
     // 导入文件
   } catch {
     console.error(`Failed to import file: ${file.path}`);
     // 继续下一个文件
   }
   ```

---

## 九、扩展练习

### 练习 1：分析导出取消流程

阅读以下三个文件的代码，绘制完整的取消导出时序图：
- `src/app/api/github/export/cancel/route.ts`
- `src/features/projects/inngest/export-to-github.ts` 的 `cancelOn` 配置
- `convex/system.ts` 的 `updateExportStatus`

### 练习 2：添加分支选择功能

当前导入只使用 `main` 或 `master` 分支。请设计如何添加分支选择器，允许用户选择导入哪个分支。

### 练习 3：实现增量同步

当前 Export 是全量导出（创建新仓库）。思考如何实现增量同步——将项目文件的变更推送到已存在的 GitHub 仓库。

---

## 扩展阅读

- [GitHub REST API 文档](https://docs.github.com/en/rest) — Git Data API 的详细说明
- [Clerk OAuth 文档](https://clerk.com/docs/references/javascript/types/oauth-strategy) — 如何获取 OAuth Token
- [Inngest 取消函数](https://www.inngest.com/docs/functions/cancellation) — `cancelOn` 的详细用法
- [Git 底层对象模型](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects) — 理解 blob/tree/commit/ref 的关系
