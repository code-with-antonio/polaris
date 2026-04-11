# 第 12 课：WebContainer 浏览器终端

> 本课目标：掌握 WebContainer API、xterm.js 终端集成、文件同步与预览服务

---

## 12.1 WebContainer 简介

WebContainer 是一个**在浏览器中运行 Node.js 的运行时**，允许用户在网页中执行 npm 命令、启动开发服务器。

### WebContainer 的能力

| 能力 | 说明 |
|------|------|
| **Node.js 运行时** | 在浏览器中运行真正的 Node.js |
| **npm/yarn/pnpm** | 安装和使用包管理器 |
| **文件系统** | 虚拟文件系统，支持读、写、创建文件 |
| **进程管理** | 启动、停止、监控进程 |
| **网络访问** | 运行开发服务器，预览应用 |

### WebContainer vs iframe

| 特性 | WebContainer | iframe |
|------|-------------|--------|
| 真正的 Node.js | ✅ | ❌（需要服务器） |
| npm 命令 | ✅ | ❌ |
| 文件系统访问 | ✅ | ❌ |
| 进程控制 | ✅ | ❌ |
| 性能 | 快 | 一般 |

---

## 12.2 WebContainer 核心概念

### WebContainer 生命周期

```
WebContainer.boot()
    ↓
状态：booting（启动中）
    ↓
container.mount(fileTree)
    ↓
状态：ready（就绪）
    ↓
spawn() 启动进程
    ↓
状态：running（运行中）
```

### 核心 API

| API | 说明 |
|-----|------|
| `WebContainer.boot()` | 启动 WebContainer 实例 |
| `container.mount(fileTree)` | 挂载虚拟文件系统 |
| `container.spawn()` | 启动进程 |
| `container.fs` | 文件系统操作 |
| `container.on()` | 监听事件 |
| `container.teardown()` | 清理资源 |

---

## 12.3 WebContainer 初始化

### 单例模式

Polaris 使用单例模式确保只有一个 WebContainer 实例：

```typescript
// src/features/preview/hooks/use-webcontainer.ts

// 单例实例
let webcontainerInstance: WebContainer | null = null;
let bootPromise: Promise<WebContainer> | null = null;

// 获取或创建 WebContainer
const getWebContainer = async (): Promise<WebContainer> => {
  if (webcontainerInstance) {
    return webcontainerInstance;
  }

  // 防止重复启动
  if (!bootPromise) {
    bootPromise = WebContainer.boot({ coep: "credentialless" });
  }

  webcontainerInstance = await bootPromise;
  return webcontainerInstance;
};

// 清理函数
const teardownWebContainer = () => {
  if (webcontainerInstance) {
    webcontainerInstance.teardown();
    webcontainerInstance = null;
  }
  bootPromise = null;
};
```

### Boot 配置

```typescript
// COEP/COOP 配置（跨域隔离）
WebContainer.boot({ coep: "credentialless" });

// 其他配置选项
WebContainer.boot({
  // COEP: "require-corp" | "credentialless" | null
  // COOP: "same-origin" | "same-origin-allow-popups" | "no-window" | null
});
```

---

## 12.4 useWebContainer Hook

### Hook 结构

```typescript
// src/features/preview/hooks/use-webcontainer.ts
export const useWebContainer = ({
  projectId,
  enabled,
  settings,
}: UseWebContainerProps) => {
  // 状态
  const [status, setStatus] = useState<
    "idle" | "booting" | "installing" | "running" | "error"
  >("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState("");

  // refs
  const containerRef = useRef<WebContainer | null>(null);
  const hasStartedRef = useRef(false);

  // ...
};
```

### 状态类型

| 状态 | 说明 |
|------|------|
| `idle` | 空闲，未启动 |
| `booting` | 正在启动 WebContainer |
| `installing` | 正在安装依赖 |
| `running` | 开发服务器运行中 |
| `error` | 发生错误 |

---

## 12.5 文件系统操作

### FileSystemTree 结构

WebContainer 使用嵌套的目录结构：

```typescript
// WebContainer API 类型
interface FileSystemTree {
  [name: string]: {
    directory?: FileSystemTree;  // 目录
    file?: { contents: string };  // 文件
  };
}
```

### buildFileTree 函数

将 Convex 的扁平文件结构转换为 WebContainer 的嵌套结构：

```typescript
// src/features/preview/utils/file-tree.ts
export const buildFileTree = (files: FileDoc[]): FileSystemTree => {
  const tree: FileSystemTree = {};
  const filesMap = new Map(files.map((f) => [f._id, f]));

  // 构建路径
  const getPath = (file: FileDoc): string[] => {
    const parts: string[] = [file.name];
    let parentId = file.parentId;

    // 向上遍历父文件夹
    while (parentId) {
      const parent = filesMap.get(parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parentId;
    }

    return parts;
  };

  // 构建树
  for (const file of files) {
    const pathParts = getPath(file);
    let current = tree;

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const isLast = i === pathParts.length - 1;

      if (isLast) {
        if (file.type === "folder") {
          current[part] = { directory: {} };
        } else if (file.content !== undefined) {
          current[part] = { file: { contents: file.content } };
        }
      } else {
        if (!current[part]) {
          current[part] = { directory: {} };
        }
        const node = current[part];
        if ("directory" in node) {
          current = node.directory;
        }
      }
    }
  }

  return tree;
};
```

### 挂载文件系统

```typescript
const start = async () => {
  // 启动 WebContainer
  const container = await getWebContainer();
  containerRef.current = container;

  // 构建文件树并挂载
  const fileTree = buildFileTree(files);
  await container.mount(fileTree);

  // 监听服务器就绪事件
  container.on("server-ready", (_port, url) => {
    setPreviewUrl(url);
    setStatus("running");
  });

  // 运行安装和启动命令
  // ...
};
```

---

## 12.6 进程管理

### spawn 启动进程

```typescript
// 解析命令
const installCmd = settings?.installCommand || "npm install";
const [installBin, ...installArgs] = installCmd.split(" ");

// 启动进程
const installProcess = await container.spawn(installBin, installArgs);

// 捕获输出
installProcess.output.pipeTo(
  new WritableStream({
    write(data) {
      appendOutput(data);
    },
  })
);

// 等待进程结束
const installExitCode = await installProcess.exit;

if (installExitCode !== 0) {
  throw new Error(`${installCmd} failed with code ${installExitCode}`);
}
```

### Process 对象

```typescript
interface Process {
  // 输出流
  output: ReadableStream<string>;

  // 输入流（可用于交互式输入）
  input: WritableStream<string>;

  // 退出码
  exit: Promise<number>;

  // 杀死进程
  kill(): void;
}
```

### 完整启动流程

```typescript
// 1. 安装依赖
const installProcess = await container.spawn("npm", ["install"]);
installProcess.output.pipeTo(writableStream);
const installExitCode = await installProcess.exit;

// 2. 启动开发服务器
const devProcess = await container.spawn("npm", ["run", "dev"]);
devProcess.output.pipeTo(writableStream);
```

---

## 12.7 文件热同步

当 Convex 中的文件变化时，实时同步到 WebContainer：

```typescript
// src/features/preview/hooks/use-webcontainer.ts

// 监听文件变化
useEffect(() => {
  const container = containerRef.current;
  if (!container || !files || status !== "running") return;

  const filesMap = new Map(files.map((f) => [f._id, f]));

  for (const file of files) {
    // 只同步文件（跳过文件夹和二进制文件）
    if (file.type !== "file" || file.storageId || !file.content) continue;

    // 获取完整路径
    const filePath = getFilePath(file, filesMap);

    // 写入文件
    container.fs.writeFile(filePath, file.content);
  }
}, [files, status]);
```

### getFilePath 辅助函数

```typescript
// src/features/preview/utils/file-tree.ts
export const getFilePath = (
  file: FileDoc,
  filesMap: Map<Id<"files">, FileDoc>
): string => {
  const parts: string[] = [file.name];
  let parentId = file.parentId;

  // 向上遍历构建路径
  while (parentId) {
    const parent = filesMap.get(parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    parentId = parent.parentId;
  }

  return parts.join("/");
};
```

---

## 12.8 服务器就绪事件

WebContainer 会自动检测开发服务器的启动：

```typescript
container.on("server-ready", (port, url) => {
  // port: 服务器端口
  // url: 服务器地址
  setPreviewUrl(url);
  setStatus("running");
});
```

---

## 12.9 xterm.js 终端集成

xterm.js 是一个终端模拟器组件，用于渲染终端界面。

### PreviewTerminal 组件

```typescript
// src/features/preview/components/preview-terminal.tsx
export const PreviewTerminal = ({ output }: PreviewTerminalProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  // 初始化终端
  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;

    const terminal = new Terminal({
      convertEol: true,
      disableStdin: true,
      fontSize: 12,
      fontFamily: "monospace",
      theme: { background: "#1f2228" },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // 写入现有输出
    if (output) {
      terminal.write(output);
    }

    // 响应式调整大小
    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, []);

  // 追加新输出
  useEffect(() => {
    if (!terminalRef.current) return;

    if (output.length < lastLengthRef.current) {
      terminalRef.current.clear();
      lastLengthRef.current = 0;
    }

    const newData = output.slice(lastLengthRef.current);
    if (newData) {
      terminalRef.current.write(newData);
      lastLengthRef.current = output.length;
    }
  }, [output]);

  return <div ref={containerRef} className="..." />;
};
```

### Terminal 配置

```typescript
const terminal = new Terminal({
  convertEol: true,        // 使用正确的 EOL 字符
  disableStdin: true,      // 禁用输入（只读）
  fontSize: 12,            // 字体大小
  fontFamily: "monospace", // 字体
  theme: { background: "#1f2228" },  // 主题
});
```

### Addons（插件）

| Addon | 说明 |
|-------|------|
| `FitAddon` | 自动调整终端大小适应容器 |
| `WebLinksAddon` | 点击 URL 自动打开 |
| `WebglAddon` | 启用 WebGL 渲染 |

---

## 12.10 PreviewSettingsPopover

用户可以自定义安装和启动命令：

```typescript
// src/features/preview/components/preview-settings-popover.tsx
interface PreviewSettingsPopoverProps {
  projectId: Id<"projects">;
  initialValues?: Doc<"projects">["settings"];
  onSave?: () => void;
};

export const PreviewSettingsPopover = ({
  projectId,
  initialValues,
}: PreviewSettingsPopoverProps) => {
  const updateSettings = useUpdateProjectSettings();

  const form = useForm({
    defaultValues: {
      installCommand: initialValues?.installCommand ?? "",
      devCommand: initialValues?.devCommand ?? "",
    },
    onSubmit: async ({ value }) => {
      await updateSettings({
        id: projectId,
        settings: {
          installCommand: value.installCommand || undefined,
          devCommand: value.devCommand || undefined,
        },
      });
    }
  });

  // ...
};
```

### 默认命令

| 命令 | 默认值 |
|------|-------|
| Install Command | `npm install` |
| Start Command | `npm run dev` |

---

## 12.11 重启机制

### restart 函数

```typescript
const restart = useCallback(() => {
  // 1. 清理 WebContainer
  teardownWebContainer();

  // 2. 重置 refs
  containerRef.current = null;
  hasStartedRef.current = false;

  // 3. 重置状态
  setStatus("idle");
  setPreviewUrl(null);
  setError(null);

  // 4. 触发重新渲染
  setRestartKey((k) => k + 1);
}, []);
```

### 禁用时清理

```typescript
useEffect(() => {
  if (!enabled) {
    hasStartedRef.current = false;
    setStatus("idle");
    setPreviewUrl(null);
    setError(null);
  }
}, [enabled]);
```

---

## 12.12 完整流程图

```
┌─────────────────────────────────────────────────────────────┐
│                   WebContainer 完整流程                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  用户打开预览面板                                             │
│         │                                                     │
│         ▼                                                     │
│  useWebContainer 启用                                         │
│         │                                                     │
│         ▼                                                     │
│  WebContainer.boot() 启动                                    │
│         │                                                     │
│         ▼                                                     │
│  buildFileTree(files) 构建文件树                              │
│         │                                                     │
│         ▼                                                     │
│  container.mount(fileTree) 挂载文件系统                       │
│         │                                                     │
│         ▼                                                     │
│  container.spawn("npm", ["install"]) 安装依赖                 │
│         │                                                     │
│         ├─── 捕获输出 ────► PreviewTerminal                  │
│         │                                                     │
│         ▼                                                     │
│  安装失败？ ──► 错误处理                                      │
│         │                                                     │
│         ▼                                                     │
│  container.spawn("npm", ["run", "dev"]) 启动开发服务器        │
│         │                                                     │
│         ├─── 捕获输出 ────► PreviewTerminal                  │
│         │                                                     │
│         ▼                                                     │
│  container.on("server-ready") 监听服务器就绪                   │
│         │                                                     │
│         ▼                                                     │
│  设置 previewUrl ──► iframe 预览                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 12.13 练习建议

1. **阅读源码**：仔细阅读 `use-webcontainer.ts` 和 `file-tree.ts`
2. **添加预览 URL 显示**：在界面上显示当前预览 URL
3. **添加日志清空**：添加清空终端输出的功能
4. **支持自定义端口**：添加端口配置选项

### 实践：添加终端清空按钮

```typescript
// 添加清空函数
const clearTerminal = useCallback(() => {
  setTerminalOutput("");
}, []);

// 在 UI 中添加按钮
<Button onClick={clearTerminal}>Clear</Button>
```

### 实践：添加进程杀死功能

```typescript
const killProcess = async () => {
  const container = containerRef.current;
  if (!container) return;

  // 杀死所有运行中的进程
  // WebContainer 没有直接的 kill all 方法
  // 可以通过存储进程引用来单独杀死
};
```

---

## 12.14 总结

本节课我们了解到：

- ✅ **WebContainer 简介**：浏览器中运行 Node.js 的技术
- ✅ **核心 API**：boot、mount、spawn、fs、on
- ✅ **单例模式**：避免重复创建实例
- ✅ **FileSystemTree**：WebContainer 的文件系统结构
- ✅ **buildFileTree**：将 Convex 文件转换为 WebContainer 格式
- ✅ **进程管理**：spawn、output、exit
- ✅ **文件热同步**：文件变化时实时同步
- ✅ **xterm.js 集成**：终端渲染组件
- ✅ **PreviewSettingsPopover**：自定义安装/启动命令
- ✅ **重启机制**：清理和重新初始化

**下一课预告**：Feature-First 架构实战 - 通过实际案例掌握 Feature-First 架构的设计思想和实践方法。
