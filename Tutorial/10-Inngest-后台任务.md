# 第 10 课：Inngest 后台任务

> 本课目标：深入掌握 Inngest 的高级特性、Step 模式、GitHub 集成实战和错误处理

---

## 10.1 Inngest 高级特性概述

上一课我们学习了 AI 功能集成中的 Inngest 基本用法。本课将进一步深入 Inngest 的高级特性，包括更复杂的 Step 模式、GitHub 集成实战和监控调试。

### Polaris 中的 Inngest Functions

| Function | 事件 | 功能 |
|----------|------|------|
| `processMessage` | `message/sent` | AI 消息处理 |
| `importGithubRepo` | `github/import.repo` | GitHub 仓库导入 |
| `exportToGithub` | `github/export.repo` | GitHub 仓库导出 |
| `demoGenerate` | `demo/generate` | Demo 生成 |
| `demoError` | `demo/error` | Demo 错误演示 |

---

## 10.2 Step 进阶模式

### Step.run 返回值

Step 的返回值会被自动序列化存储，可以被后续 Step 使用：

```typescript
async ({ step }) => {
  // Step 1: 获取数据
  const user = await step.run("get-user", async () => {
    return { id: "123", name: "Alice" };
  });

  // Step 2: 使用 Step 1 的返回值
  const result = await step.run("process", async () => {
    // user 来自前一个 Step
    return `Hello, ${user.name}!`;
  });

  return result;
}
```

### 多个并行 Step

使用 `Promise.all` 可以并行执行多个 Step：

```typescript
async ({ step }) => {
  // 并行获取多个数据源
  const [user, settings, preferences] = await Promise.all([
    step.run("get-user", async () => fetchUser()),
    step.run("get-settings", async () => fetchSettings()),
    step.run("get-preferences", async () => fetchPreferences()),
  ]);

  return { user, settings, preferences };
}
```

### sleep 延迟

```typescript
async ({ step }) => {
  // 等待 3 秒（GitHub API 需要时间初始化）
  await step.sleep("wait-for-repo-init", "3s");

  // 继续执行
  const data = await step.run("get-data", async () => {...});
}
```

---

## 10.3 NonRetriableError

有些错误不应该重试（如业务逻辑错误），使用 `NonRetriableError`：

```typescript
import { NonRetriableError } from "inngest";

async ({ step }) => {
  const files = await step.run("check-files", async () => {
    if (files.length === 0) {
      // 这类错误不需要重试
      throw new NonRetriableError("No files to export");
    }
    return files;
  });
}
```

### 对比：普通 Error vs NonRetriableError

| 类型 | 行为 | 使用场景 |
|------|------|---------|
| `Error` | 自动重试（最多 5 次） | 网络错误、临时故障 |
| `NonRetriableError` | 直接失败，不重试 | 业务逻辑错误、无效输入 |

```typescript
// 普通 Error - 会重试
throw new Error("Network timeout");

// NonRetriableError - 不重试
throw new NonRetriableError("No files to export");
throw new NonRetriableError("Invalid input: missing required field");
```

---

## 10.4 GitHub 导入实战

### importGithubRepo 函数结构

```typescript
// src/features/projects/inngest/import-github-repo.ts
export const importGithubRepo = inngest.createFunction(
  {
    id: "import-github-repo",
    onFailure: async ({ event, step }) => {
      // 失败处理：更新状态为 failed
    },
  },
  { event: "github/import.repo" },
  async ({ event, step }) => {
    // 1. 清理项目
    // 2. 获取仓库文件树
    // 3. 按深度排序创建文件夹
    // 4. 创建文件
    // 5. 更新状态为完成
  }
);
```

### Step 1: 清理项目

```typescript
await step.run("cleanup-project", async () => {
  await convex.mutation(api.system.cleanup, {
    internalKey,
    projectId,
  });
});
```

### Step 2: 获取仓库文件树

```typescript
const tree = await step.run("fetch-repo-tree", async () => {
  try {
    // 尝试 main 分支
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: "main",
      recursive: "1",
    });
    return data;
  } catch {
    // 降级到 master 分支
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: "master",
      recursive: "1",
    });
    return data;
  }
});
```

### Step 3: 按深度排序创建文件夹

文件夹必须按深度排序，确保父文件夹先创建：

```typescript
// 按深度排序
// Input:  [{ path: "src/components" }, { path: "src" }, { path: "src/components/ui" }]
// Output: [{ path: "src" }, { path: "src/components" }, { path: "src/components/ui" }]
const folders = tree.tree
  .filter((item) => item.type === "tree" && item.path)
  .sort((a, b) => {
    const aDepth = a.path ? a.path.split("/").length : 0;
    const bDepth = b.path ? b.path.split("/").length : 0;
    return aDepth - bDepth;
  });

// 创建文件夹并建立路径映射
const folderIdMap = await step.run("create-folders", async () => {
  const map: Record<string, Id<"files">> = {};

  for (const folder of folders) {
    if (!folder.path) continue;

    const pathParts = folder.path.split("/");
    const name = pathParts.pop()!;
    const parentPath = pathParts.join("/");
    const parentId = parentPath ? map[parentPath] : undefined;

    // 创建文件夹
    const folderId = await convex.mutation(api.system.createFolder, {
      internalKey,
      projectId,
      name,
      parentId,
    });

    // 记录路径到 ID 的映射
    map[folder.path] = folderId;
  }

  return map;
});
```

### Step 4: 创建文件

```typescript
await step.run("create-files", async () => {
  for (const file of allFiles) {
    if (!file.path || !file.sha) continue;

    try {
      // 获取文件内容
      const { data: blob } = await octokit.rest.git.getBlob({
        owner,
        repo,
        file_sha: file.sha,
      });

      const buffer = Buffer.from(blob.content, "base64");
      const isBinary = await isBinaryFile(buffer);

      // 确定父文件夹 ID
      const pathParts = file.path.split("/");
      const name = pathParts.pop()!;
      const parentPath = pathParts.join("/");
      const parentId = parentPath ? folderIdMap[parentPath] : undefined;

      if (isBinary) {
        // 二进制文件：上传到存储
        const uploadUrl = await convex.mutation(
          api.system.generateUploadUrl,
          { internalKey }
        );

        const { storageId } = await ky
          .post(uploadUrl, {
            headers: { "Content-Type": "application/octet-stream" },
            body: buffer,
          })
          .json<{ storageId: Id<"_storage"> }>();

        await convex.mutation(api.system.createBinaryFile, {
          internalKey,
          projectId,
          name,
          storageId,
          parentId,
        });
      } else {
        // 文本文件：直接存储内容
        const content = buffer.toString("utf-8");
        await convex.mutation(api.system.createFile, {
          internalKey,
          projectId,
          name,
          content,
          parentId,
        });
      }
    } catch {
      console.error(`Failed to import file: ${file.path}`);
    }
  }
});
```

---

## 10.5 GitHub 导出实战

### exportToGithub 函数结构

```typescript
// src/features/projects/inngest/export-to-github.ts
export const exportToGithub = inngest.createFunction(
  {
    id: "export-to-github",
    cancelOn: [
      {
        event: "github/export.cancel",
        if: "event.data.projectId == async.data.projectId"
      },
    ],
    onFailure: async ({ event, step }) => {
      // 失败处理
    },
  },
  { event: "github/export.repo" },
  async ({ event, step }) => {
    // 1. 设置状态为 exporting
    // 2. 获取 GitHub 用户
    // 3. 创建仓库
    // 4. 获取初始提交 SHA
    // 5. 获取项目文件
    // 6. 创建 blobs
    // 7. 创建 tree
    // 8. 创建 commit
    // 9. 更新分支引用
    // 10. 设置状态为 completed
  }
);
```

### 多步骤 GitHub 操作

```typescript
// 创建仓库
const { data: repo } = await step.run("create-repo", async () => {
  return await octokit.rest.repos.createForAuthenticatedUser({
    name: repoName,
    description: description || `Exported from Polaris`,
    private: visibility === "private",
    auto_init: true,
  });
});

// 等待 GitHub 初始化
await step.sleep("wait-for-repo-init", "3s");

// 获取初始提交的 SHA
const initialCommitSha = await step.run("get-initial-commit", async () => {
  const { data: ref } = await octokit.rest.git.getRef({
    owner: user.login,
    repo: repoName,
    ref: "heads/main",
  });
  return ref.object.sha;
});
```

### 递归文件路径构建

```typescript
const buildFilePaths = (files: FileWithUrl[]) => {
  const fileMap = new Map<Id<"files">, FileWithUrl>();
  files.forEach((f) => fileMap.set(f._id, f));

  const getFullPath = (file: FileWithUrl): string => {
    if (!file.parentId) {
      return file.name;
    }
    const parent = fileMap.get(file.parentId);
    if (!parent) {
      return file.name;
    }
    return `${getFullPath(parent)}/${file.name}`;
  };

  const paths: Record<string, FileWithUrl> = {};
  files.forEach((file) => {
    paths[getFullPath(file)] = file;
  });

  return paths;
};

const filePaths = buildFilePaths(files);
```

### 创建 Git Data（Blob/Tree/Commit）

```typescript
// 创建 blobs
const treeItems = await step.run("create-blobs", async () => {
  const items = [];

  for (const [path, file] of fileEntries) {
    let content: string;
    let encoding: "utf-8" | "base64" = "utf-8";

    if (file.content !== undefined) {
      content = file.content;  // 文本文件
    } else if (file.storageUrl) {
      // 二进制文件：获取并 base64 编码
      const response = await ky.get(file.storageUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      content = buffer.toString("base64");
      encoding = "base64";
    }

    const { data: blob } = await octokit.rest.git.createBlob({
      owner: user.login,
      repo: repoName,
      content,
      encoding,
    });

    items.push({
      path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  return items;
});

// 创建 tree
const { data: tree } = await step.run("create-tree", async () => {
  return await octokit.rest.git.createTree({
    owner: user.login,
    repo: repoName,
    tree: treeItems,
  });
});

// 创建 commit
const { data: commit } = await step.run("create-commit", async () => {
  return await octokit.rest.git.createCommit({
    owner: user.login,
    repo: repoName,
    message: "Initial commit from Polaris",
    tree: tree.sha,
    parents: [initialCommitSha],
  });
});

// 更新分支引用
await step.run("update-branch-ref", async () => {
  return await octokit.rest.git.updateRef({
    owner: user.login,
    repo: repoName,
    ref: "heads/main",
    sha: commit.sha,
    force: true,
  });
});
```

---

## 10.6 事件触发与取消

### 发送事件

```typescript
// src/app/api/github/export/route.ts
import { inngest } from "@/inngest/client";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, repoName, visibility, githubToken } = await request.json();

  // 发送导出事件
  await inngest.send({
    name: "github/export.repo",
    data: {
      projectId,
      repoName,
      visibility,
      githubToken,
    },
  });

  return NextResponse.json({ success: true });
}
```

### 取消事件

```typescript
// src/app/api/github/export/cancel/route.ts
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await request.json();

  // 发送取消事件
  await inngest.send({
    name: "github/export.cancel",
    data: { projectId },
  });

  return NextResponse.json({ success: true });
}
```

### cancelOn 配置

```typescript
export const exportToGithub = inngest.createFunction(
  {
    id: "export-to-github",
    cancelOn: [
      {
        event: "github/export.cancel",
        // 只有当 projectId 匹配时才取消
        if: "event.data.projectId == async.data.projectId"
      },
    ],
  },
  { event: "github/export.repo" },
  async ({ event, step }) => {
    // 如果收到匹配的取消事件，这个函数会被中断
  }
);
```

### cancelOn 的匹配条件

```typescript
cancelOn: [
  {
    event: "message/cancel",
    if: "event.data.messageId == async.data.messageId",
    // event.data.messageId 来自触发事件
    // async.data.messageId 是当前函数开始时保存的数据
  },
]
```

---

## 10.7 onFailure 失败处理

### 基本结构

```typescript
export const myFunction = inngest.createFunction(
  {
    id: "my-function",
    onFailure: async ({ event, step }) => {
      // event 包含失败信息
      const { data } = event;
      const { messageId } = data.event.data;

      // 执行清理或通知
      await step.run("cleanup", async () => {
        await convex.mutation(api.system.updateStatus, {
          messageId,
          status: "failed",
        });
      });
    },
  },
  { event: "my-event" },
  async ({ event, step }) => {
    // 主逻辑...
  }
);
```

### 导入失败处理

```typescript
onFailure: async ({ event, step }) => {
  const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;
  if (!internalKey) return;

  const { projectId } = event.data.event.data as ImportGithubRepoEvent;

  await step.run("set-failed-status", async () => {
    await convex.mutation(api.system.updateImportStatus, {
      internalKey,
      projectId,
      status: "failed",
    });
  });
}
```

### 导出失败处理

```typescript
onFailure: async ({ event, step }) => {
  const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;
  if (!internalKey) return;

  const { projectId } = event.data.event.data as ExportToGithubEvent;

  await step.run("set-failed-status", async () => {
    await convex.mutation(api.system.updateExportStatus, {
      internalKey,
      projectId,
      status: "failed",
    });
  });
}
```

---

## 10.8 Octokit 与 GitHub API

### Octokit 初始化

```typescript
import { Octokit } from "octokit";

// 使用 GitHub Token 认证
const octokit = new Octokit({ auth: githubToken });
```

### 常用 API 调用

```typescript
// 获取认证用户
const { data: user } = await octokit.rest.users.getAuthenticated();

// 创建仓库
const { data: repo } = await octokit.rest.repos.createForAuthenticatedUser({
  name: repoName,
  description: description,
  private: visibility === "private",
  auto_init: true,
});

// 获取 Git 树
const { data } = await octokit.rest.git.getTree({
  owner,
  repo,
  tree_sha: "main",
  recursive: "1",
});

// 获取 Blob
const { data: blob } = await octokit.rest.git.getBlob({
  owner,
  repo,
  file_sha: fileSha,
});

// 创建 Blob
const { data: newBlob } = await octokit.rest.git.createBlob({
  owner,
  repo,
  content,
  encoding,
});

// 创建 Tree
const { data: tree } = await octokit.rest.git.createTree({
  owner,
  repo,
  tree: treeItems,
});

// 创建 Commit
const { data: commit } = await octokit.rest.git.createCommit({
  owner,
  repo,
  message,
  tree: treeSha,
  parents: [parentSha],
});

// 更新引用
await octokit.rest.git.updateRef({
  owner,
  repo,
  ref: "heads/main",
  sha: commitSha,
  force: true,
});
```

---

## 10.9 Inngest Dev Server

### 本地开发

Inngest 提供本地开发服务器，可以本地运行和调试 functions：

```bash
# 安装
npm install inngest

# 运行开发服务器
npx inngest dev
```

### 开发服务器功能

| 功能 | 说明 |
|------|------|
| 事件模拟 | 可以手动触发事件测试 |
| 函数执行 | 本地运行 Inngest Functions |
| 步骤追踪 | 查看每个 Step 的执行情况 |
| 日志 | 查看函数执行的详细日志 |
| 重试调试 | 模拟失败和重试 |

### 环境变量配置

```bash
# .env.local
INNGEST_DEV=true
INNGEST_EVENT_KEY=your-event-key
POLARIS_CONVEX_INTERNAL_KEY=your-convex-key
```

---

## 10.10 Inngest Dashboard

### 生产环境监控

Inngest Dashboard 提供生产环境的函数监控：

1. **函数执行历史**：查看每次执行的状态、耗时、步骤
2. **错误追踪**：查看失败的原因和堆栈
3. **性能分析**：查看每个 Step 的执行时间
4. **重试历史**：查看重试的次数和间隔

### 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 函数未触发 | 事件名称不匹配 | 检查 `inngest.send` 的事件名 |
| 函数超时 | Step 执行时间过长 | 拆分 Step 或优化逻辑 |
| 无限重试 | Error 未转换为 NonRetriableError | 检查错误处理逻辑 |
| 状态不一致 | 并发执行或取消 | 检查 `cancelOn` 配置 |

---

## 10.11 练习建议

1. **阅读导入导出源码**：仔细阅读 `import-github-repo.ts` 和 `export-to-github.ts`
2. **添加新事件**：为某个操作添加 Inngest 事件处理
3. **调试函数**：使用 `npx inngest dev` 本地调试
4. **添加取消功能**：为 processMessage 添加取消功能

### 实践：添加批量导入功能

```typescript
export const batchImportRepos = inngest.createFunction(
  {
    id: "batch-import-repos",
    onFailure: async ({ event, step }) => {
      // 失败处理
    },
  },
  { event: "github/batch.import" },
  async ({ event, step }) => {
    const { repos, projectId, githubToken } = event.data;

    const results = [];
    for (const { owner, repo } of repos) {
      // 并行导入（有限并发）
      const result = await step.run(`import-${repo}`, async () => {
        const { data } = await octokit.rest.git.getTree({...});
        // ... 导入逻辑
        return { owner, repo, success: true };
      });
      results.push(result);
    }

    return { imported: results.length, results };
  }
);
```

### 实践：添加进度追踪

```typescript
// 在 Convex 中添加进度表
const progress = await step.run("get-progress", async () => {
  return await convex.query(api.system.getImportProgress, {
    internalKey,
    projectId,
  });
});

if (progress.status === "cancelled") {
  throw new NonRetriableError("Import was cancelled");
}
```

---

## 10.12 总结

本节课我们了解到：

- ✅ **Step 进阶模式**：返回值传递、并行执行、sleep 延迟
- ✅ **NonRetriableError**：业务错误不重试
- ✅ **GitHub 导入实战**：文件树获取、文件夹排序、文件创建
- ✅ **GitHub 导出实战**：仓库创建、Git Data 操作、分支更新
- ✅ **事件触发与取消**：cancelOn 配置、匹配条件
- ✅ **onFailure 失败处理**：清理、状态更新
- ✅ **Octokit 与 GitHub API**：认证、仓库操作、Git Data
- ✅ **Inngest Dev Server**：本地开发和调试
- ✅ **Inngest Dashboard**：生产环境监控

**下一课预告**：Clerk 认证系统 - 深入理解 Clerk 认证的实现和用户会话管理。
