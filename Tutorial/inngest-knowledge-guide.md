# Polaris 项目中的 Inngest 知识体系

本文按“先理解 Inngest 是什么，再看项目怎么用，最后看 v3 到 v4 怎么迁移”的顺序整理。当前项目依赖的是 `inngest@^3.49.3`，也就是 TypeScript SDK v3。

相关源码入口：

- `src/inngest/client.ts`
- `src/app/api/inngest/route.ts`
- `src/app/api/messages/route.ts`
- `src/app/api/messages/cancel/route.ts`
- `src/app/api/github/import/route.ts`
- `src/app/api/github/export/route.ts`
- `src/app/api/github/export/cancel/route.ts`
- `src/features/conversations/inngest/process-message.ts`
- `src/features/projects/inngest/import-github-repo.ts`
- `src/features/projects/inngest/export-to-github.ts`
- `src/features/conversations/inngest/tools/*.ts`

官方资料参考：

- Inngest v3 `createFunction`：https://www.inngest.com/docs/reference/typescript/v3/functions/create
- Inngest v3 `send`：https://www.inngest.com/docs/reference/typescript/v3/events/send
- Inngest v4 迁移指南：https://www.inngest.com/docs/reference/typescript/v4/migrations/v3-to-v4
- Inngest v4 Trigger helpers：https://www.inngest.com/docs/reference/typescript/functions/triggers

## 1. Inngest 解决什么问题

在这个项目里，有些任务不适合直接放在 API 请求里同步执行：

- AI 对话处理可能很慢，还要读写项目文件。
- 导入 GitHub 仓库要拉取目录树、创建文件夹、下载 blob、判断二进制文件、上传存储。
- 导出 GitHub 仓库要创建仓库、创建 blob/tree/commit、更新分支引用。
- 用户取消对话或导出时，需要通知后台任务停下来。

如果全部放在普通 API 里，会遇到几个问题：

- HTTP 请求容易超时。
- 任务失败后不好重试。
- 多步骤任务执行到一半失败后，不容易从中间恢复。
- 用户点击按钮后，页面需要很快得到响应，而不是等待所有后台逻辑跑完。

Inngest 的思路是：API 只负责校验用户、写入必要的初始状态、发送事件；真正耗时的工作交给 Inngest function 执行。

项目里的典型链路是：

```txt
用户操作
  -> Next.js API Route
  -> inngest.send({ name, data })
  -> Inngest 根据事件名匹配 function
  -> 调用 /api/inngest
  -> function 内部用 step.run / step.sleep 拆分工作
  -> 更新 Convex 数据库
  -> 前端通过 Convex 实时订阅看到状态变化
```

## 2. 项目中的 Inngest 客户端

文件：`src/inngest/client.ts`

```ts
import { Inngest } from "inngest";
import { sentryMiddleware } from "@inngest/middleware-sentry";

export const inngest = new Inngest({
  id: "polaris",
  middleware: [sentryMiddleware()],
});
```

这里创建的是全项目共享的 Inngest client。

核心 API：

- `new Inngest({ id })`：创建应用级客户端。`id` 是 Inngest 识别这个应用的稳定标识。
- `middleware`：给 Inngest function 注入中间件。项目接入了 Sentry，用于错误追踪。
- `inngest.send(...)`：发送事件。
- `inngest.createFunction(...)`：定义后台函数。

为什么要单独放在 `src/inngest/client.ts`？

因为发送事件和定义 function 都需要同一个 client。集中导出可以避免每个文件重复配置，也保证 app id、middleware、环境变量读取方式一致。

## 3. Next.js 如何把 Inngest function 暴露出去

文件：`src/app/api/inngest/route.ts`

```ts
import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { processMessage } from "@/features/conversations/inngest/process-message";
import { importGithubRepo } from "@/features/projects/inngest/import-github-repo";
import { exportToGithub } from "@/features/projects/inngest/export-to-github";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processMessage,
    importGithubRepo,
    exportToGithub,
  ],
});
```

这段代码做了两件事：

- 把项目里的 Inngest functions 注册给 Inngest。
- 在 Next.js App Router 中暴露 `/api/inngest` 这个 endpoint。

核心 API：

- `serve({ client, functions })`：创建框架适配器。这里用的是 `inngest/next`，所以返回 `{ GET, POST, PUT }`，刚好适配 App Router Route Handler。
- `functions`：数组里放所有需要被 Inngest 调用的后台函数。

为什么需要这个 endpoint？

Inngest 的执行模型不是“你的代码主动轮询队列”，而是 Inngest 平台或 dev server 根据事件调度任务，然后通过 HTTP 调用你的应用里的 serve handler。也就是说，`/api/inngest` 是 Inngest 执行后台函数的入口。

## 4. 事件：API 与后台任务之间的契约

项目中的事件可以分为三类：

| 事件名 | 发送位置 | 触发的 function | 用途 |
| --- | --- | --- | --- |
| `message/sent` | `src/app/api/messages/route.ts`、`src/app/api/projects/create-with-prompt/route.ts` | `processMessage` | 处理 AI 对话 |
| `message/cancel` | `src/app/api/messages/route.ts`、`src/app/api/messages/cancel/route.ts` | 取消 `processMessage` | 取消正在处理的消息 |
| `github/import.repo` | `src/app/api/github/import/route.ts` | `importGithubRepo` | 导入 GitHub 仓库 |
| `github/export.repo` | `src/app/api/github/export/route.ts` | `exportToGithub` | 导出项目到 GitHub |
| `github/export.cancel` | `src/app/api/github/export/cancel/route.ts` | 取消 `exportToGithub` | 取消导出任务 |

发送事件的代码示例：

```ts
const event = await inngest.send({
  name: "message/sent",
  data: {
    messageId: assistantMessageId,
    conversationId,
    projectId,
    message,
  },
});

return NextResponse.json({
  success: true,
  eventId: event.ids[0],
  messageId: assistantMessageId,
});
```

核心 API：

- `inngest.send(eventPayload)`：把一个事件发送给 Inngest。
- `eventPayload.name`：事件名，用来匹配 function 的 trigger。
- `eventPayload.data`：事件数据，必须能 JSON 序列化。
- 返回值 `{ ids: string[] }`：发送成功后的事件 id 列表。

项目里事件数据的设计很克制：只传后台任务真正需要的 id、输入文本、GitHub token 等。真正的项目、文件、消息详情通过 Convex 再查询。这种设计让事件体不至于太大，也让后台任务拿到的是最新数据库状态。

## 5. v3 中如何定义 function

Inngest v3 的 `createFunction` 形式是：

```ts
inngest.createFunction(
  configuration,
  trigger,
  handler
);
```

项目里的例子：

```ts
export const importGithubRepo = inngest.createFunction(
  {
    id: "import-github-repo",
    onFailure: async ({ event, step }) => {
      // 失败时更新导入状态
    },
  },
  { event: "github/import.repo" },
  async ({ event, step }) => {
    // 真正的后台逻辑
  }
);
```

三个参数分别是：

- `configuration`：函数配置，例如 `id`、`cancelOn`、`onFailure`。
- `trigger`：触发器，例如 `{ event: "github/import.repo" }`。
- `handler`：事件发生后执行的函数。

核心配置：

- `id`：function 的稳定标识。不要随意改，否则历史运行、日志、恢复能力都会受影响。
- `cancelOn`：监听另一个事件，满足条件时取消当前 function。
- `onFailure`：function 最终失败时执行的兜底逻辑。

handler 参数：

- `event`：触发当前 function 的事件。
- `step`：Inngest 的步骤 API，用来创建可恢复、可重试、可观测的执行单元。
- `runId`：当前运行 id，项目中暂未使用。

## 6. step.run：把长任务拆成可恢复步骤

项目里的后台任务几乎都用 `step.run` 包住外部副作用：

```ts
const conversation = await step.run("get-conversation", async () => {
  return await convex.query(api.system.getConversationById, {
    internalKey,
    conversationId,
  });
});
```

核心 API：

```ts
await step.run(stepId, async () => {
  // 做一次有意义的工作
});
```

- `stepId`：步骤的稳定 id，会显示在 Inngest 日志中，也用于记忆步骤结果。
- 回调函数：真正要执行的代码。

`step.run` 的价值在于“耐久执行”。如果一个 function 中有多个 step，前几个 step 已经成功，后面失败重试时，Inngest 可以复用已完成 step 的结果，而不是从头全部跑一遍。

所以项目中这些操作适合放进 `step.run`：

- 查询 Convex。
- 更新消息状态。
- 调 GitHub API。
- 上传二进制文件。
- 创建仓库、commit、tree。

不适合放进 `step.run` 的通常是纯内存计算，例如过滤数组、拼接 prompt、构造 Map。这些计算很便宜，放在 handler 普通代码中即可。

## 7. step.sleep：等待外部系统完成异步状态

项目中有两个典型 `step.sleep`：

```ts
await step.sleep("wait-for-db-sync", "1s");
```

```ts
await step.sleep("wait-for-repo-init", "3s");
```

核心 API：

```ts
await step.sleep(stepId, duration);
```

- `stepId`：稳定步骤 id。
- `duration`：等待时长，例如 `"1s"`、`"3s"`、`"10m"`。

为什么不用普通 `setTimeout`？

因为 `step.sleep` 是 Inngest 管理的等待。等待期间不需要你的服务器一直占着运行资源，之后 Inngest 会继续恢复执行。普通 `setTimeout` 更像进程内暂停，不适合长时间、可恢复的后台工作。

在本项目里：

- `wait-for-db-sync` 用于让刚写入的消息和会话状态更稳地被后续查询读到。
- `wait-for-repo-init` 用于等待 GitHub `auto_init` 创建初始提交。

## 8. NonRetriableError：告诉 Inngest 不要重试

项目中多处使用：

```ts
import { NonRetriableError } from "inngest";

if (!internalKey) {
  throw new NonRetriableError("POLARIS_CONVEX_INTERNAL_KEY is not configured");
}
```

核心 API：

- `NonRetriableError`：抛出后表示这是不可通过重试修复的错误。

适合使用它的场景：

- 环境变量缺失。
- 会话或项目不存在。
- 没有可导出的文件。
- 输入数据本身不合法。

不适合使用它的场景：

- GitHub 临时超时。
- 网络抖动。
- 第三方服务短暂 500。

后者应该允许 Inngest 正常重试。

## 9. onFailure：失败后的补偿逻辑

以导入 GitHub 为例：

```ts
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
},
```

这里要注意一个稍绕的结构：

```ts
event.data.event.data
```

在 `onFailure` 中，`event` 不是原始业务事件本身，而是 Inngest 生成的失败事件。原始业务事件被包在失败事件的 `data.event` 里面。所以项目需要通过 `event.data.event.data` 拿到原始 payload。

这个项目的 `onFailure` 主要做一件事：把业务状态改成失败，让前端能看到结果。

- `processMessage` 失败：更新 assistant message 为错误文案。
- `importGithubRepo` 失败：把 `importStatus` 设为 `failed`。
- `exportToGithub` 失败：把 `exportStatus` 设为 `failed`。

## 10. cancelOn：用事件取消正在运行的 function

AI 消息处理：

```ts
cancelOn: [
  {
    event: "message/cancel",
    if: "event.data.messageId == async.data.messageId",
  },
],
```

GitHub 导出：

```ts
cancelOn: [
  {
    event: "github/export.cancel",
    if: "event.data.projectId == async.data.projectId",
  },
],
```

核心 API：

- `cancelOn`：声明当前 function 可以被哪些事件取消。
- `event`：取消事件名。
- `if`：表达式，用来判断取消事件是否匹配当前运行。

表达式中的两个对象：

- `event`：取消事件，例如 `message/cancel`。
- `async`：启动当前 function 的原始事件，例如 `message/sent` 或 `github/export.repo`。

所以这句：

```txt
event.data.messageId == async.data.messageId
```

意思是：只有取消事件里的 `messageId` 与当前正在处理的消息 id 相等，才取消当前运行。

取消按钮对应的 API 代码：

```ts
await inngest.send({
  name: "message/cancel",
  data: {
    messageId: msg._id,
  },
});

await convex.mutation(api.system.updateMessageStatus, {
  internalKey,
  messageId: msg._id,
  status: "cancelled",
});
```

这里有两个动作：

- 发 `message/cancel` 给 Inngest，让后台任务停止。
- 立刻更新 Convex 状态，让前端马上显示 cancelled。

## 11. processMessage：AI 对话后台任务怎么跑

文件：`src/features/conversations/inngest/process-message.ts`

整体流程：

```txt
message/sent
  -> 校验 internalKey
  -> sleep 1s
  -> 查询 conversation
  -> 查询最近消息
  -> 组装 system prompt
  -> 如果会话还是默认标题，生成标题
  -> 创建 coding agent
  -> 创建 network
  -> network.run(message)
  -> 提取最终 assistant 文本
  -> 更新 Convex message content
```

触发这个任务的 API 先做了这些事：

```ts
await convex.mutation(api.system.createMessage, {
  role: "user",
  content: message,
});

const assistantMessageId = await convex.mutation(api.system.createMessage, {
  role: "assistant",
  content: "",
  status: "processing",
});

await inngest.send({
  name: "message/sent",
  data: {
    messageId: assistantMessageId,
    conversationId,
    projectId,
    message,
  },
});
```

为什么先创建空 assistant message？

因为前端需要立刻显示“正在处理”。后台任务完成后，只需要更新这条 message 的内容和状态即可。这比等 AI 完成后再创建消息更适合实时 UI。

### 11.1 查询上下文

```ts
const recentMessages = await step.run("get-recent-messages", async () => {
  return await convex.query(api.system.getRecentMessages, {
    internalKey,
    conversationId,
    limit: 10,
  });
});
```

这里取最近 10 条消息，用于构造 prompt。注意项目排除了当前空的 processing assistant message，避免 AI 看到一个空回复。

### 11.2 生成标题

```ts
const titleAgent = createAgent({
  name: "title-generator",
  system: TITLE_GENERATOR_SYSTEM_PROMPT,
  model: anthropic({
    model: "claude-3-5-haiku-20241022",
    defaultParameters: { temperature: 0, max_tokens: 50 },
  }),
});

const { output } = await titleAgent.run(message, { step });
```

这里用的是 `@inngest/agent-kit`。虽然它不是 `inngest` 主包的一部分，但它和 Inngest step 集成。`titleAgent.run(message, { step })` 表示 agent 内部的模型调用和工具调用可以被纳入 Inngest 的执行上下文。

### 11.3 创建 coding agent 与 tools

```ts
const codingAgent = createAgent({
  name: "polaris",
  description: "An expert AI coding assistant",
  system: systemPrompt,
  model: anthropic({
    model: "claude-opus-4-20250514",
    defaultParameters: { temperature: 0.3, max_tokens: 16000 }
  }),
  tools: [
    createListFilesTool({ internalKey, projectId }),
    createReadFilesTool({ internalKey }),
    createUpdateFileTool({ internalKey }),
    createCreateFilesTool({ projectId, internalKey }),
    createCreateFolderTool({ projectId, internalKey }),
    createRenameFileTool({ internalKey }),
    createDeleteFilesTool({ internalKey }),
    createScrapeUrlsTool(),
  ],
});
```

这里把“AI 能做什么”显式限制在 tools 中。AI 不能直接操作本地文件系统，而是通过 Convex system functions 修改项目文件。

### 11.4 createNetwork 的作用

```ts
const network = createNetwork({
  name: "polaris-network",
  agents: [codingAgent],
  maxIter: 20,
  router: ({ network }) => {
    const lastResult = network.state.results.at(-1);
    const hasTextResponse = lastResult?.output.some(
      (m) => m.type === "text" && m.role === "assistant"
    );
    const hasToolCalls = lastResult?.output.some(
      (m) => m.type === "tool_call"
    );

    if (hasTextResponse && !hasToolCalls) {
      return undefined;
    }
    return codingAgent;
  }
});
```

`createNetwork` 像一个 agent 调度器。项目虽然只有一个 agent，但仍然用 network 来控制循环：

- 如果模型只返回最终文本，没有工具调用，就结束。
- 如果还有工具调用，就继续让同一个 coding agent 执行。
- `maxIter: 20` 防止无限循环。

## 12. Agent Kit tools 如何与 Convex 连接

工具文件在 `src/features/conversations/inngest/tools/*.ts`。

典型结构类似：

```ts
import { createTool } from "@inngest/agent-kit";
import { z } from "zod";

export const createReadFilesTool = ({ internalKey }) =>
  createTool({
    name: "read_files",
    description: "Read project files",
    parameters: z.object({
      fileIds: z.array(z.string()),
    }),
    handler: async ({ fileIds }) => {
      return await convex.query(api.system.getFilesByIds, {
        internalKey,
        fileIds,
      });
    },
  });
```

核心概念：

- `name`：给模型看的工具名。
- `description`：告诉模型什么时候该用这个工具。
- `parameters`：用 Zod 定义工具入参。
- `handler`：真正执行的代码。

项目这样设计的好处是：

- AI 只能通过白名单工具操作项目。
- 每个工具都走 `internalKey` 保护的 Convex system API。
- 前端、AI、数据库之间的边界清晰。

## 13. importGithubRepo：导入仓库的 durable workflow

文件：`src/features/projects/inngest/import-github-repo.ts`

整体流程：

```txt
github/import.repo
  -> 校验 internalKey
  -> Octokit(githubToken)
  -> cleanup-project
  -> fetch-repo-tree
  -> create-folders
  -> create-files
  -> set-completed-status
```

关键步骤：

```ts
const tree = await step.run("fetch-repo-tree", async () => {
  try {
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: "main",
      recursive: "1",
    });

    return data;
  } catch {
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

这里先尝试 `main`，失败后 fallback 到 `master`，适配不同仓库默认分支。

创建文件夹时有一个重要细节：

```ts
const folders = tree.tree
  .filter((item) => item.type === "tree" && item.path)
  .sort((a, b) => {
    const aDepth = a.path ? a.path.split("/").length : 0;
    const bDepth = b.path ? b.path.split("/").length : 0;

    return aDepth - bDepth;
  });
```

为什么要按深度排序？

因为创建 `src/components/ui` 之前，必须先创建 `src` 和 `src/components`。父目录 id 是子目录创建时的 `parentId`。

另一个细节：

```ts
const folderIdMap = await step.run("create-folders", async () => {
  const map: Record<string, Id<"files">> = {};
  // ...
  return map;
});
```

注释里也写了原因：Inngest 会序列化 step 结果，所以这里返回普通对象，而不是 `Map`。这是一条很实用的经验：step 返回值最好是普通 JSON 数据。

## 14. exportToGithub：导出仓库的 durable workflow

文件：`src/features/projects/inngest/export-to-github.ts`

整体流程：

```txt
github/export.repo
  -> set-exporting-status
  -> get-github-user
  -> create-repo
  -> sleep 3s
  -> get-initial-commit
  -> fetch-project-files
  -> build file paths
  -> create-blobs
  -> create-tree
  -> create-commit
  -> update-branch-ref
  -> set-completed-status
```

这个 function 比导入更像“事务脚本”。每个外部 API 调用都被拆成 step，所以失败时可以清楚知道卡在哪一步。

例如创建 blob：

```ts
const treeItems = await step.run("create-blobs", async () => {
  const items: {
    path: string;
    mode: "100644";
    type: "blob";
    sha: string;
  }[] = [];

  for (const [path, file] of fileEntries) {
    let content: string;
    let encoding: "utf-8" | "base64" = "utf-8";

    if (file.content !== undefined) {
      content = file.content;
    } else if (file.storageUrl) {
      const response = await ky.get(file.storageUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      content = buffer.toString("base64");
      encoding = "base64";
    } else {
      continue;
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
```

这里同时处理了文本文件和二进制文件：

- 文本文件走 `file.content`。
- 二进制文件先从 Convex storage URL 下载，再转成 base64。
- GitHub tree item 需要 `{ path, mode, type, sha }`。

## 15. Inngest 与 Convex 的边界设计

项目没有让 Inngest function 直接读写数据库底层，而是通过 Convex system API：

```ts
await convex.mutation(api.system.updateMessageContent, {
  internalKey,
  messageId,
  content: assistantResponse,
});
```

这个设计很重要：

- 普通前端用户不能调用 system API。
- Inngest function 拥有 `POLARIS_CONVEX_INTERNAL_KEY`，可以执行后台任务所需的内部操作。
- 权限校验集中在 Convex system 层，而不是散落在每个后台步骤里。

可以把它理解成：

```txt
前端用户 -> public Convex functions
后台任务 -> system Convex functions + internalKey
```

这让“用户可做的事”和“后台可信任务可做的事”分开了。

## 16. 项目中 Inngest 的设计思路

这个项目的 Inngest 设计可以概括成四层：

```txt
UI 层
  用户点击发送消息、导入、导出、取消

API 层
  认证、校验、创建初始数据库记录、发送事件

Inngest 层
  执行耗时任务、拆分 step、处理取消、处理失败补偿

Convex 层
  存储项目、文件、会话、消息状态，驱动前端实时更新
```

为什么这样设计？

第一，API 层保持轻。用户请求不用等待 AI 或 GitHub 完整跑完，只要事件发送成功就返回。

第二，后台任务可观测。每个 `step.run` 都有名字，Inngest UI 里可以看到执行到哪一步。

第三，任务可恢复。失败重试时，已经成功的 durable step 不需要重复执行。

第四，前端体验自然。前端只关心 Convex 状态，比如 `processing`、`completed`、`cancelled`、`failed`，不用直接关心后台任务细节。

## 17. v3 代码在 v4 中哪些已经不适用

下面是和本项目直接相关的 v4 破坏性变化。

### 17.1 `createFunction` 的第二个 trigger 参数不再适用

项目当前 v3 写法：

```ts
export const importGithubRepo = inngest.createFunction(
  {
    id: "import-github-repo",
    onFailure: async ({ event, step }) => {
      // ...
    },
  },
  { event: "github/import.repo" },
  async ({ event, step }) => {
    // ...
  }
);
```

v4 中触发器要放进第一个 options 参数：

```ts
export const importGithubRepo = inngest.createFunction(
  {
    id: "import-github-repo",
    triggers: [{ event: "github/import.repo" }],
    onFailure: async ({ event, step }) => {
      // ...
    },
  },
  async ({ event, step }) => {
    // ...
  }
);
```

所以本项目这三个文件都需要改：

- `src/features/conversations/inngest/process-message.ts`
- `src/features/projects/inngest/import-github-repo.ts`
- `src/features/projects/inngest/export-to-github.ts`

对应改法：

```ts
// v3
inngest.createFunction(
  { id: "process-message", cancelOn: [...] },
  { event: "message/sent" },
  handler
);

// v4
inngest.createFunction(
  {
    id: "process-message",
    triggers: [{ event: "message/sent" }],
    cancelOn: [...],
  },
  handler
);
```

### 17.2 建议用 `eventType()` 替代裸字符串事件

项目当前大量使用裸字符串：

```ts
await inngest.send({
  name: "message/sent",
  data: {
    messageId,
    conversationId,
    projectId,
    message,
  },
});
```

v4 推荐用 `eventType()` 定义事件，并通过 `.create()` 发送：

```ts
import { eventType } from "inngest";
import { z } from "zod";

export const messageSent = eventType("message/sent", {
  schema: z.object({
    messageId: z.string(),
    conversationId: z.string(),
    projectId: z.string(),
    message: z.string(),
  }),
});

await inngest.send(
  messageSent.create({
    messageId,
    conversationId,
    projectId,
    message,
  })
);
```

function 也可以直接使用这个事件类型：

```ts
export const processMessage = inngest.createFunction(
  {
    id: "process-message",
    triggers: [messageSent],
  },
  async ({ event, step }) => {
    event.data.message;
  }
);
```

这个不是单纯语法洁癖，而是能获得：

- 发送事件时的类型检查。
- function handler 中的 `event.data` 类型推断。
- 可选的运行时校验。
- `step.waitForEvent`、`step.sendEvent`、`inngest.send` 使用同一份事件定义。

### 17.3 v4 默认是 cloud 模式，本地开发要显式设置

项目当前 client：

```ts
export const inngest = new Inngest({
  id: "polaris",
  middleware: [sentryMiddleware()],
});
```

v4 中默认模式变成 `cloud`。如果本地没有 `INNGEST_SIGNING_KEY`，可能会报 signing key 缺失。

本地开发可以这样处理：

```ts
export const inngest = new Inngest({
  id: "polaris",
  isDev: process.env.NODE_ENV !== "production",
  middleware: [sentryMiddleware()],
});
```

或者通过环境变量启动：

```bash
INNGEST_DEV=1 npm run dev
```

生产环境则需要配置：

```txt
INNGEST_SIGNING_KEY=...
INNGEST_EVENT_KEY=...
```

### 17.4 middleware API 重写，`@inngest/middleware-sentry` 需要确认兼容 v4

项目当前：

```ts
import { sentryMiddleware } from "@inngest/middleware-sentry";

export const inngest = new Inngest({
  id: "polaris",
  middleware: [sentryMiddleware()],
});
```

v4 官方说明 middleware 系统被重写。因此升级时不能只升级 `inngest` 主包，还要确认：

- `@inngest/middleware-sentry` 是否有兼容 v4 的版本。
- `sentryMiddleware()` 的配置方式是否变化。
- TypeScript 是否能通过。

如果 middleware 包暂时不兼容，可能需要先移除或改用 v4 新 middleware API 重写。

### 17.5 serve 配置项迁移到 client

项目当前 `serve` 只传了：

```ts
serve({
  client: inngest,
  functions: [...],
});
```

这部分本身不受影响。

但如果未来在 `serve()` 里加过这些配置：

```ts
serve({
  client,
  functions,
  signingKey,
  signingKeyFallback,
  baseUrl,
  fetch,
});
```

v4 中要移到 client：

```ts
const inngest = new Inngest({
  id: "polaris",
  signingKey,
  signingKeyFallback,
  baseUrl,
  fetch,
});
```

### 17.6 `serveHost` 改名为 `serveOrigin`

项目当前没有使用 `serveHost`，所以不需要改。

如果未来看到：

```txt
INNGEST_SERVE_HOST
```

v4 推荐改为：

```txt
INNGEST_SERVE_ORIGIN
```

### 17.7 `streaming` 选项语义变化

项目当前没有传 `streaming`。

如果未来有 v3 写法：

```ts
serve({
  client,
  functions,
  streaming: "force",
});
```

v4 要改成：

```ts
serve({
  client,
  functions,
  streaming: true,
});
```

`"allow"` 在 v4 中不再是推荐写法。

### 17.8 checkpointing v4 默认开启，serverless 要设置 maxRuntime

项目部署在类似 Vercel 的 serverless 环境时，v4 默认 checkpointing 可能会让多个 step 在一次请求里连续执行。官方建议配置 `maxRuntime`，让 Inngest 知道单次请求最多跑多久。

示例：

```ts
export const inngest = new Inngest({
  id: "polaris",
  checkpointing: {
    maxRuntime: "50s",
  },
});
```

同时 Next.js route 可以显式声明：

```ts
export const maxDuration = 300;
```

对本项目尤其重要的是：

- `processMessage` 可能调用大模型和多个 tools。
- `importGithubRepo` 可能处理大量文件。
- `exportToGithub` 可能创建很多 GitHub blobs。

这些都属于长任务，升级 v4 时要认真评估 `maxDuration` 和 `checkpointing.maxRuntime`。

### 17.9 optimized parallelism 默认开启，避免依赖 `Promise.race` 的早返回

项目当前没有明显依赖 `Promise.race` 包裹多个 `step.run`，所以暂时不受影响。

但如果以后写：

```ts
const winner = await Promise.race([
  step.run("a", async () => "a"),
  step.run("b", async () => "b"),
]);
```

v4 中由于 optimized parallelism 默认开启，`Promise.race` 行为可能不是你直觉中的“第一个完成就立即返回”。需要使用 v4 提供的 `group.parallel()` 方式。

### 17.10 `step.invoke()` 不再支持字符串 function id

项目当前没有使用 `step.invoke()`，所以不需要改。

但 v3 中这样的写法在 v4 不再适用：

```ts
await step.invoke("my-step", {
  function: "my-app-other-fn",
  data: { foo: "bar" },
});
```

v4 要传 function 实例，或用 `referenceFunction()`：

```ts
await step.invoke("my-step", {
  function: otherFn,
  data: { foo: "bar" },
});
```

或者：

```ts
import { referenceFunction } from "inngest";

await step.invoke("my-step", {
  function: referenceFunction({
    appId: "my-app",
    functionId: "other-fn",
  }),
  data: { foo: "bar" },
});
```

## 18. 按本项目迁移到 v4 的建议步骤

如果未来要升级到 Inngest v4，建议按这个顺序做：

1. 升级包版本：

```bash
npm install inngest@latest
```

同时确认：

```bash
npm view @inngest/middleware-sentry version
npm view @inngest/agent-kit version
```

2. 修改 `src/inngest/client.ts`：

```ts
import { Inngest } from "inngest";
import { sentryMiddleware } from "@inngest/middleware-sentry";

export const inngest = new Inngest({
  id: "polaris",
  isDev: process.env.NODE_ENV !== "production",
  checkpointing: {
    maxRuntime: "50s",
  },
  middleware: [sentryMiddleware()],
});
```

如果 Sentry middleware 类型不兼容，先按 v4 middleware 文档处理。

3. 新增事件定义文件，例如 `src/inngest/events.ts`：

```ts
import { eventType } from "inngest";
import { z } from "zod";

export const messageSent = eventType("message/sent", {
  schema: z.object({
    messageId: z.string(),
    conversationId: z.string(),
    projectId: z.string(),
    message: z.string(),
  }),
});

export const messageCancel = eventType("message/cancel", {
  schema: z.object({
    messageId: z.string(),
  }),
});

export const githubImportRepo = eventType("github/import.repo", {
  schema: z.object({
    owner: z.string(),
    repo: z.string(),
    projectId: z.string(),
    githubToken: z.string(),
  }),
});

export const githubExportRepo = eventType("github/export.repo", {
  schema: z.object({
    projectId: z.string(),
    repoName: z.string(),
    visibility: z.enum(["public", "private"]),
    description: z.string().optional(),
    githubToken: z.string(),
  }),
});

export const githubExportCancel = eventType("github/export.cancel", {
  schema: z.object({
    projectId: z.string(),
  }),
});
```

4. 改 function trigger：

```ts
export const processMessage = inngest.createFunction(
  {
    id: "process-message",
    triggers: [messageSent],
    cancelOn: [
      {
        event: messageCancel,
        if: "event.data.messageId == async.data.messageId",
      },
    ],
    onFailure: async ({ event, step }) => {
      // ...
    },
  },
  async ({ event, step }) => {
    // event.data 自动带类型
  }
);
```

如果 v4 的 `cancelOn.event` 在当前安装版本中不接受 `eventType` 对象，则退回字符串：

```ts
cancelOn: [
  {
    event: "message/cancel",
    if: "event.data.messageId == async.data.messageId",
  },
]
```

5. 改事件发送：

```ts
await inngest.send(
  messageSent.create({
    messageId: assistantMessageId,
    conversationId,
    projectId,
    message,
  })
);
```

6. 跑类型检查和构建：

```bash
npm run lint
npm run build
```

重点看这些文件：

- `src/inngest/client.ts`
- `src/app/api/inngest/route.ts`
- 所有 `inngest.createFunction(...)`
- 所有 `inngest.send(...)`
- `@inngest/agent-kit` 的 `createAgent`、`createNetwork` 类型是否兼容。

## 19. 学习时可以抓住的主线

读这个项目的 Inngest，不要一开始陷入所有细节。可以按这条线理解：

第一层：事件驱动。

```ts
await inngest.send({
  name: "message/sent",
  data: { ... },
});
```

第二层：function 匹配事件。

```ts
inngest.createFunction(
  { id: "process-message" },
  { event: "message/sent" },
  async ({ event, step }) => {}
);
```

第三层：用 step 拆后台流程。

```ts
await step.run("update-message", async () => {
  await convex.mutation(...);
});
```

第四层：用 Convex 状态驱动 UI。

```txt
processing -> completed
processing -> cancelled
exporting -> completed
importing -> failed
```

第五层：用 `cancelOn` 和 `onFailure` 处理真实世界里的取消与失败。

理解完这五层，再看 AI Agent、GitHub 导入导出，就会发现它们只是“不同业务流程填进同一个 durable workflow 模型里”。

