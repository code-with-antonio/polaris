# 任务 2 核心代码逐行解析

## 文件 1: convex/files.ts - 后端函数

### getFolderContents（获取文件夹内容）

```typescript
export const getFolderContents = query({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),  // ⭐ 可选参数
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get("projects", args.projectId);

    // 权限校验
    if (!project) throw new Error("Project not found");
    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized to access this project");
    }

    // ⭐ 复合索引查询
    const files = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q
          .eq("projectId", args.projectId)   // 第一个条件
          .eq("parentId", args.parentId)     // 第二个条件
      )
      .collect();
    // 注意：args.parentId 可以是 undefined
    // Convex 会自动处理 null/undefined 的匹配

    // ⭐ 排序逻辑：文件夹优先
    return files.sort((a, b) => {
      // 文件夹排在文件前面
      if (a.type === "folder" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "folder") return 1;
      // 同类型按字母顺序
      return a.name.localeCompare(b.name);
    });
  },
});
```

---

### getFilePath（获取文件路径 - 面包屑）

```typescript
/**
 * 构建文件的完整路径（用于面包屑导航）
 *
 * 示例：
 *   输入：Button.tsx 的 ID
 *   输出：[{ _id, name: "src" }, { _id, name: "components" }, { _id, name: "Button.tsx" }]
 */
export const getFilePath = query({
  args: { id: v.id("files") },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const file = await ctx.db.get("files", args.id);
    // ... 权限校验

    // ⭐ 初始化空数组
    const path: { _id: string; name: string }[] = [];
    let currentId: Id<"files"> | undefined = args.id;

    // ⭐ 循环向上查找父节点
    while (currentId) {
      // 获取当前文件/文件夹
      const file = await ctx.db.get("files", currentId);
      if (!file) break;  // 找不到就停止

      // ⭐ unshift：在数组开头插入
      // 这是因为我们从叶子向上遍历，但需要从根到叶的顺序
      path.unshift({ _id: file._id, name: file.name });

      // 继续向上查找父节点
      currentId = file.parentId;
    }

    return path;
  },
});
```

**遍历过程示例**：

```
文件结构：src/components/Button.tsx
Button.tsx 的 parentId = components 的 ID
components 的 parentId = src 的 ID
src 的 parentId = undefined（根目录）

遍历过程：
第 1 次：currentId = Button.tsx
  path.unshift("Button.tsx") → path = ["Button.tsx"]
  currentId = components

第 2 次：currentId = components
  path.unshift("components") → path = ["components", "Button.tsx"]
  currentId = src

第 3 次：currentId = src
  path.unshift("src") → path = ["src", "components", "Button.tsx"]
  currentId = undefined（结束）

最终结果：["src", "components", "Button.tsx"]
```

---

### deleteFile（递归删除）

```typescript
export const deleteFile = mutation({
  args: { id: v.id("files") },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const file = await ctx.db.get("files", args.id);
    // ... 权限校验

    // ⭐ 定义递归删除函数
    const deleteRecursive = async (fileId: Id<"files">) => {
      const item = await ctx.db.get("files", fileId);
      if (!item) return;  // 已删除，跳过

      // ⭐ 如果是文件夹，先删除所有子项
      if (item.type === "folder") {
        // 查找所有直接子项
        const children = await ctx.db
          .query("files")
          .withIndex("by_project_parent", (q) =>
            q.eq("projectId", item.projectId).eq("parentId", fileId)
          )
          .collect();

        // ⭐ 对每个子项递归调用
        for (const child of children) {
          await deleteRecursive(child._id);
        }
      }

      // ⭐ 删除二进制文件（如果有）
      if (item.storageId) {
        await ctx.storage.delete(item.storageId);
      }

      // ⭐ 最后删除本身
      await ctx.db.delete("files", fileId);
    };

    // 执行递归删除
    await deleteRecursive(args.id);

    // 更新项目的 updatedAt
    await ctx.db.patch("projects", file.projectId, {
      updatedAt: Date.now(),
    });
  },
});
```

---

### createFile（创建文件）

```typescript
export const createFile = mutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),  // 父文件夹（可选）
    name: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    // ... 权限校验

    // ⭐ 检查同名文件是否存在
    const files = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q.eq("projectId", args.projectId).eq("parentId", args.parentId)
      )
      .collect();

    const existing = files.find(
      (file) => file.name === args.name && file.type === "file"
    );

    if (existing) throw new Error("File already exists");

    const now = Date.now();

    // ⭐ 创建文件
    await ctx.db.insert("files", {
      projectId: args.projectId,
      name: args.name,
      content: args.content,
      type: "file",
      parentId: args.parentId,  // 关键：关联父文件夹
      updatedAt: now,
    });

    // ⭐ 同步更新项目时间
    await ctx.db.patch("projects", args.projectId, {
      updatedAt: now,
    });
  },
});
```

---

## 文件 2: src/features/projects/hooks/use-files.ts

### sortFiles（排序函数）

```typescript
// ⭐ 泛型函数：可以处理任何有 type 和 name 的对象
const sortFiles = <T extends { type: "file" | "folder"; name: string }>(
  files: T[]
): T[] => {
  return [...files].sort((a, b) => {
    // 文件夹排在文件前面
    if (a.type === "folder" && b.type === "file") return -1;  // a 排前面
    if (a.type === "file" && b.type === "folder") return 1;   // b 排前面

    // 同类型按字母顺序排序
    // localeCompare：本地化字符串比较（支持中文等）
    return a.name.localeCompare(b.name);
  });
};
```

---

### useFolderContents（条件查询）

```typescript
export const useFolderContents = ({
  projectId,
  parentId,
  enabled = true,  // ⭐ 是否启用查询
}: {
  projectId: Id<"projects">;
  parentId?: Id<"files">;
  enabled?: boolean;
}) => {
  return useQuery(
    api.files.getFolderContents,
    // ⭐ "skip" 是 Convex 特殊值，表示不执行查询
    enabled ? { projectId, parentId } : "skip"
  );
};
```

**使用场景**：

```typescript
// 文件夹未展开时，不加载子内容
const folderContents = useFolderContents({
  projectId,
  parentId: item._id,
  enabled: item.type === "folder" && isOpen,  // 只有展开时才查询
});
```

---

### useCreateFile（乐观更新）

```typescript
export const useCreateFile = () => {
  return useMutation(api.files.createFile).withOptimisticUpdate(
    (localStore, args) => {
      // 获取当前文件夹内容
      const existingFiles = localStore.getQuery(api.files.getFolderContents, {
        projectId: args.projectId,
        parentId: args.parentId,
      });

      if (existingFiles !== undefined) {
        const now = Date.now();

        // ⭐ 创建临时文件对象
        const newFile = {
          _id: crypto.randomUUID() as Id<"files">,  // 临时 ID
          _creationTime: now,
          projectId: args.projectId,
          parentId: args.parentId,
          name: args.name,
          content: args.content,
          type: "file" as const,
          updatedAt: now,
        };

        // ⭐ 更新本地缓存（排序后）
        localStore.setQuery(
          api.files.getFolderContents,
          { projectId: args.projectId, parentId: args.parentId },
          sortFiles([...existingFiles, newFile])  // 添加新文件并排序
        );
      }
    }
  );
};
```

---

## 文件 3: src/features/projects/components/file-explorer/tree.tsx

### Tree 组件（递归渲染）

```typescript
export const Tree = ({
  item,      // 当前文件/文件夹数据
  level = 0, // 嵌套层级（用于计算缩进）
  projectId,
}: {
  item: Doc<"files">;
  level?: number;
  projectId: Id<"projects">;
}) => {
  // ⭐ 组件内部状态
  const [isOpen, setIsOpen] = useState(false);      // 文件夹是否展开
  const [isRenaming, setIsRenaming] = useState(false); // 是否正在重命名
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);

  // ⭐ hooks
  const renameFile = useRenameFile({ projectId, parentId: item.parentId });
  const deleteFile = useDeleteFile({ projectId, parentId: item.parentId });
  const createFile = useCreateFile();
  const createFolder = useCreateFolder();
  const { openFile, closeTab, activeTabId } = useEditor(projectId);

  // ⭐ 条件查询：只在文件夹展开时加载子内容
  const folderContents = useFolderContents({
    projectId,
    parentId: item._id,
    enabled: item.type === "folder" && isOpen,  // 关键条件
  });

  // ⭐ 分支 1：如果是文件，渲染文件节点（无子项）
  if (item.type === "file") {
    const fileName = item.name;
    const isActive = activeTabId === item._id;

    if (isRenaming) {
      return <RenameInput ... />;
    }

    return (
      <TreeItemWrapper
        item={item}
        level={level}
        isActive={isActive}
        onClick={() => openFile(item._id, { pinned: false })}
        onDoubleClick={() => openFile(item._id, { pinned: true })}
        onRename={() => setIsRenaming(true)}
        onDelete={() => {
          closeTab(item._id);      // 先关闭编辑器标签
          deleteFile({ id: item._id })  // 再删除文件
        }}
      >
        <FileIcon fileName={fileName} autoAssign className="size-4" />
        <span className="truncate text-sm">{fileName}</span>
      </TreeItemWrapper>
    );
  }

  // ⭐ 分支 2：如果是文件夹，渲染文件夹节点 + 递归渲染子项

  // 文件夹的渲染内容
  const folderRender = (
    <>
      <div className="flex items-center gap-0.5">
        <ChevronRightIcon className={cn(
          "size-4 shrink-0 text-muted-foreground",
          isOpen && "rotate-90"  // 展开时箭头旋转
        )} />
        <FolderIcon folderName={folderName} className="size-4" />
      </div>
      <span className="truncate text-sm">{folderName}</span>
    </>
  );

  // 主渲染
  return (
    <>
      {/* 文件夹节点 */}
      <TreeItemWrapper
        item={item}
        level={level}
        onClick={() => setIsOpen((value) => !value)}  // 点击切换展开
        onRename={() => setIsRenaming(true)}
        onDelete={() => deleteFile({ id: item._id })}
        onCreateFile={() => startCreating("file")}
        onCreateFolder={() => startCreating("folder")}
      >
        {folderRender}
      </TreeItemWrapper>

      {/* ⭐ 递归渲染子项 */}
      {isOpen && (
        <>
          {folderContents === undefined && <LoadingRow level={level + 1} />}
          {folderContents?.map((subItem) => (
            <Tree
              key={subItem._id}
              item={subItem}
              level={level + 1}  // ⭐ 层级 +1（更深）
              projectId={projectId}
            />
          ))}
        </>
      )}
    </>
  );
};
```

---

### TreeItemWrapper（节点包装器 - 右键菜单）

```typescript
export const TreeItemWrapper = ({
  item,
  children,
  level,
  isActive,
  onClick,
  onDoubleClick,
  onRename,
  onDelete,
  onCreateFile,
  onCreateFolder,
}: {
  item: Doc<"files">;
  children: React.ReactNode;
  level: number;
  // ... 其他 props
}) => {
  return (
    // ⭐ ContextMenu：右键菜单组件
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onRename?.();  // Enter 键触发重命名
            }
          }}
          className={cn(
            "group flex items-center gap-1 w-full h-5.5 hover:bg-accent/30",
            isActive && "bg-accent/30",
          )}
          // ⭐ 动态缩进
          style={{ paddingLeft: getItemPadding(level, item.type === "file") }}
        >
          {children}
        </button>
      </ContextMenuTrigger>

      {/* ⭐ 右键菜单内容 */}
      <ContextMenuContent className="w-64">
        {/* 文件夹特有的选项 */}
        {item.type === "folder" && (
          <>
            <ContextMenuItem onClick={onCreateFile}>
              New File...
            </ContextMenuItem>
            <ContextMenuItem onClick={onCreateFolder}>
              New Folder...
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {/* 通用的选项 */}
        <ContextMenuItem onClick={onRename}>
          Rename...
          <ContextMenuShortcut>Enter</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onDelete}>
          Delete Permanently
          <ContextMenuShortcut>⌘Backspace</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
```

---

## 文件 4: src/features/projects/components/file-explorer/constants.ts

```typescript
// ⭐ 根层级的基准缩进
export const BASE_PADDING = 12;

// ⭐ 每增加一层，增加的缩进量
export const LEVEL_PADDING = 12;

// 计算缩进的函数
export const getItemPadding = (level: number, isFile: boolean) => {
  // ⭐ 文件需要额外缩进（因为没有展开箭头图标）
  const fileOffset = isFile ? 16 : 0;

  // 公式：基准 + 层级*增量 + 文件偏移
  return BASE_PADDING + level * LEVEL_PADDING + fileOffset;
};
```

---

## 文件 5: src/features/editor/components/file-breadcrumbs.tsx

```typescript
export const FileBreadcrumbs = ({ projectId }) => {
  // 获取当前激活的文件 ID
  const { activeTabId } = useEditor(projectId);

  // ⭐ 获取文件路径数组
  // 例如：[{ _id, name: "src" }, { _id, name: "components" }, { _id, name: "Button.tsx" }]
  const filePath = useFilePath(activeTabId);

  // 加载中状态
  if (filePath === undefined || !activeTabId) {
    return <Breadcrumb>...</Breadcrumb>;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {filePath.map((item, index) => {
          const isLast = index === filePath.length - 1;

          return (
            <React.Fragment key={item._id}>
              <BreadcrumbItem>
                {/* ⭐ 最后一项是当前页面，不可点击 */}
                {isLast ? (
                  <BreadcrumbPage className="flex items-center gap-1">
                    <FileIcon fileName={item.name} autoAssign className="size-4" />
                    {item.name}
                  </BreadcrumbPage>
                ) : (
                  {/* ⭐ 非最后一项是链接 */}
                  <BreadcrumbLink href="#">
                    {item.name}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {/* ⭐ 最后一项不需要分隔符 */}
              {!isLast && <BreadcrumbSeparator />}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
};
```

---

## 文件 6: src/features/preview/utils/file-tree.ts

### buildFileTree（构建 WebContainer 文件树）

```typescript
/**
 * 将扁平的 Convex 文件数组转换为嵌套的 FileSystemTree
 * 这是 WebContainer API 需要的格式
 */
export const buildFileTree = (files: FileDoc[]): FileSystemTree => {
  const tree: FileSystemTree = {};
  const filesMap = new Map(files.map((f) => [f._id, f]));  // ⭐ 建立 ID 映射

  // ⭐ 获取文件的完整路径（数组形式）
  const getPath = (file: FileDoc): string[] => {
    const parts: string[] = [file.name];
    let parentId = file.parentId;

    while (parentId) {
      const parent = filesMap.get(parentId);
      if (!parent) break;
      parts.unshift(parent.name);  // 向上遍历，父名插入开头
      parentId = parent.parentId;
    }

    return parts;  // ["src", "components", "Button.tsx"]
  };

  // ⭐ 构建嵌套树结构
  for (const file of files) {
    const pathParts = getPath(file);
    let current = tree;  // 当前层级指针

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const isLast = i === pathParts.length - 1;

      if (isLast) {
        // ⭐ 最后一个元素：创建文件/文件夹节点
        if (file.type === "folder") {
          current[part] = { directory: {} };
        } else if (!file.storageId && file.content !== undefined) {
          current[part] = { file: { contents: file.content } };
        }
      } else {
        // ⭐ 中间元素：确保目录存在，并进入下一层
        if (!current[part]) {
          current[part] = { directory: {} };
        }
        const node = current[part];
        if ("directory" in node) {
          current = node.directory;  // 进入子目录
        }
      }
    }
  }

  return tree;
};
```

---

## 关键概念总结

| 概念 | 位置 | 作用 |
|------|------|------|
| `parentId` | Schema | 建立父子关系 |
| 复合索引 `by_project_parent` | Schema | 高效查询某文件夹下的内容 |
| `path.unshift` | getFilePath | 从叶子向上遍历时，保证路径顺序 |
| 递归删除 | deleteFile | 删除文件夹时先删除所有子项 |
| `enabled` 参数 | useFolderContents | 条件查询，只在展开时加载 |
| `level` 参数 | Tree 组件 | 控制缩进深度 |
| 递归组件 | Tree 组件 | 渲染无限深度的树结构 |

---

## 数据流示意图

```
用户点击文件夹
    ↓
setIsOpen(true)
    ↓
useFolderContents(enabled=true)
    ↓
查询 Convex (by_project_parent)
    ↓
返回子项数组（已排序）
    ↓
folderContents?.map((subItem) => (
  <Tree item={subItem} level={level+1} />
))
    ↓
递归渲染所有子项
```