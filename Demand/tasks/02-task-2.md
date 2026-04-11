# 任务 2：文件树与文件系统 - 详细学习指南

## 学习目标

完成本任务后，你将理解：
1. 父子关系的数据库设计（`parentId` 字段）
2. 递归组件渲染树形结构
3. 文件路径的递归构建（面包屑导航）
4. 复合索引的使用（`by_project_parent`）
5. 递归删除的实现
6. 条件查询（enabled 参数）

---

## 第一步：理解文件数据模型

### 阅读文件：`convex/schema.ts` (第 33-44 行)

```typescript
files: defineTable({
  projectId: v.id("projects"),      // 所属项目
  parentId: v.optional(v.id("files")), // 父文件夹 ID（可选）
  name: v.string(),                  // 文件/文件夹名称
  type: v.union(v.literal("file"), v.literal("folder")), // 类型
  content: v.optional(v.string()),   // 文本内容
  storageId: v.optional(v.id("_storage")), // 二进制文件存储 ID
  updatedAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_parent", ["parentId"])
  .index("by_project_parent", ["projectId", "parentId"])
```

### 关键知识点

| 索引 | 用途 |
|------|------|
| `by_project` | 查询项目的所有文件 |
| `by_parent` | 查询某个文件夹的所有子项 |
| `by_project_parent` | **复合索引**：查询某项目某文件夹下的内容 |

### 为什么需要复合索引？

```
场景：查询项目 A 的文件夹 B 下的所有文件

单索引查询：
  1. 用 by_project 找项目 A 的所有文件（可能几千个）
  2. 再过滤 parentId === B（效率低）

复合索引查询：
  直接找到 projectId=A AND parentId=B 的文件（高效）
```

---

## 第二步：学习 Convex 文件函数

### 2.1 获取文件夹内容

阅读文件：`convex/files.ts` (第 100-137 行)

```typescript
export const getFolderContents = query({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),  // 可选：null 表示根目录
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    // ... 权限校验

    const files = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("parentId", args.parentId)  // 复合条件
      )
      .collect();

    // 排序：文件夹优先，然后按字母顺序
    return files.sort((a, b) => {
      if (a.type === "folder" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "folder") return 1;
      return a.name.localeCompare(b.name);
    });
  },
});
```

### 2.2 创建文件

阅读文件：`convex/files.ts` (第 139-190 行)

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

    // 检查同名文件是否存在
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

    await ctx.db.insert("files", {
      projectId: args.projectId,
      name: args.name,
      content: args.content,
      type: "file",
      parentId: args.parentId,
      updatedAt: now,
    });

    // 更新项目的 updatedAt
    await ctx.db.patch("projects", args.projectId, {
      updatedAt: now,
    });
  },
});
```

### 2.3 获取文件路径（面包屑）

阅读文件：`convex/files.ts` (第 62-98 行)

```typescript
/**
 * 通过向上遍历父链构建文件的完整路径
 *
 * 输入: button.tsx 的 ID
 * 输出: [{ _id, name: "src" }, { _id, name: "components" }, { _id, name: "button.tsx" }]
 *
 * 用途: 面包屑导航 (src > components > button.tsx)
 */
export const getFilePath = query({
  args: { id: v.id("files") },
  handler: async (ctx, args) => {
    // ... 权限校验

    const path: { _id: string; name: string }[] = [];
    let currentId: Id<"files"> | undefined = args.id;

    // 循环向上查找父节点
    while (currentId) {
      const file = await ctx.db.get("files", currentId);
      if (!file) break;

      // unshift: 在数组开头插入（保证顺序从根到叶）
      path.unshift({ _id: file._id, name: file.name });
      currentId = file.parentId;  // 继续向上
    }

    return path;
  },
});
```

### 2.4 递归删除

阅读文件：`convex/files.ts` (第 302-362 行)

```typescript
export const deleteFile = mutation({
  args: { id: v.id("files") },
  handler: async (ctx, args) => {
    // ... 权限校验

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

        // 递归删除每个子项
        for (const child of children) {
          await deleteRecursive(child._id);
        }
      }

      // 删除二进制文件（如果有）
      if (item.storageId) {
        await ctx.storage.delete(item.storageId);
      }

      // 删除文件/文件夹本身
      await ctx.db.delete("files", fileId);
    };

    await deleteRecursive(args.id);
  },
});
```

### 递归删除流程图

```
删除文件夹 A
    ↓
检查 A 的类型
    ↓
是文件夹 → 查找所有子项
    ↓
对每个子项递归调用 deleteRecursive
    ↓
[子文件 B] → 直接删除
[子文件夹 C] → 再次查找子项 → 递归删除
    ↓
所有子项删除完毕
    ↓
删除文件夹 A 本身
```

---

## 第三步：学习 React Hooks 封装

### 3.1 文件排序函数

阅读文件：`src/features/projects/hooks/use-files.ts` (第 5-14 行)

```typescript
// 通用排序函数：文件夹优先，然后按字母顺序
const sortFiles = <T extends { type: "file" | "folder"; name: string }>(
  files: T[]
): T[] => {
  return [...files].sort((a, b) => {
    // 文件夹排在文件前面
    if (a.type === "folder" && b.type === "file") return -1;
    if (a.type === "file" && b.type === "folder") return 1;
    // 同类型按名称排序
    return a.name.localeCompare(b.name);
  });
};
```

### 3.2 条件查询

阅读文件：`src/features/projects/hooks/use-files.ts` (第 149-162 行)

```typescript
export const useFolderContents = ({
  projectId,
  parentId,
  enabled = true,  // 是否启用查询
}: {
  projectId: Id<"projects">;
  parentId?: Id<"files">;
  enabled?: boolean;
}) => {
  return useQuery(
    api.files.getFolderContents,
    enabled ? { projectId, parentId } : "skip"  // "skip" 表示不执行查询
  );
};
```

### 为什么需要 `enabled` 参数？

```
场景：文件夹未展开时不需要加载子内容

没有 enabled：
  所有文件夹的内容都会加载（浪费资源）

有 enabled：
  只在文件夹展开时才加载内容（性能优化）
```

---

## 第四步：学习递归树组件

### 4.1 Tree 组件结构

阅读文件：`src/features/projects/components/file-explorer/tree.tsx`

组件的核心逻辑：

```typescript
export const Tree = ({
  item,      // 当前文件/文件夹
  level = 0, // 嵌套层级（用于缩进）
  projectId,
}) => {
  // 状态：文件夹是否展开、是否正在重命名、是否正在创建
  const [isOpen, setIsOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);

  // 只在文件夹展开时才查询子内容
  const folderContents = useFolderContents({
    projectId,
    parentId: item._id,
    enabled: item.type === "folder" && isOpen,  // 条件查询
  });

  // 如果是文件，渲染文件节点（无子项）
  if (item.type === "file") {
    return <TreeItemWrapper item={item} level={level} ... />;
  }

  // 如果是文件夹，渲染文件夹节点 + 递归渲染子项
  return (
    <>
      <TreeItemWrapper item={item} level={level} ... />
      {isOpen && folderContents?.map((subItem) => (
        <Tree
          key={subItem._id}
          item={subItem}
          level={level + 1}  // 层级 +1（子项缩进更深）
          projectId={projectId}
        />
      ))}
    </>
  );
};
```

### 递归渲染流程

```
Tree(item=src, level=0)
    ↓
渲染文件夹节点 <TreeItemWrapper>
    ↓
isOpen=true
    ↓
查询 folderContents (components, utils)
    ↓
对每个子项递归调用 Tree
    ↓
Tree(item=components, level=1)
    ├── Tree(item=Button.tsx, level=2)  // 文件，结束
    ├── Tree(item=Input.tsx, level=2)   // 文件，结束
    └── Tree(item=forms, level=2)       // 文件夹，继续递归
        ├── Tree(item=LoginForm.tsx, level=3)
        └── ...
```

---

## 第五步：学习缩进计算

### 阅读文件：`src/features/projects/components/file-explorer/constants.ts`

```typescript
// 根层级的基础缩进
export const BASE_PADDING = 12;

// 每增加一层，增加的缩进
export const LEVEL_PADDING = 12;

export const getItemPadding = (level: number, isFile: boolean) => {
  // 文件需要额外缩进（因为没有箭头图标）
  const fileOffset = isFile ? 16 : 0;
  return BASE_PADDING + level * LEVEL_PADDING + fileOffset;
};
```

### 缩进计算示例

| 类型 | 层级 | 计算公式 | 缩进值 |
|------|------|----------|--------|
| 文件夹 | 0 | 12 + 0*12 + 0 | 12px |
| 文件 | 0 | 12 + 0*12 + 16 | 28px |
| 文件夹 | 1 | 12 + 1*12 + 0 | 24px |
| 文件 | 2 | 12 + 2*12 + 16 | 52px |

---

## 第六步：学习面包屑组件

### 阅读文件：`src/features/editor/components/file-breadcrumbs.tsx`

```typescript
export const FileBreadcrumbs = ({ projectId }) => {
  const { activeTabId } = useEditor(projectId);
  const filePath = useFilePath(activeTabId);  // 获取路径数组

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {filePath.map((item, index) => {
          const isLast = index === filePath.length - 1;

          return (
            <>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{item.name}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink>{item.name}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
};
```

### 面包屑显示效果

```
filePath = [
  { _id: "a", name: "src" },
  { _id: "b", name: "components" },
  { _id: "c", name: "Button.tsx" }
]

渲染结果:
src > components > Button.tsx
```

---

## 第七步：学习文件树构建（WebContainer）

### 阅读文件：`src/features/preview/utils/file-tree.ts`

```typescript
/**
 * 将扁平的 Convex 文件转换为嵌套的 FileSystemTree
 * 用于 WebContainer 挂载
 */
export const buildFileTree = (files: FileDoc[]): FileSystemTree => {
  const tree: FileSystemTree = {};
  const filesMap = new Map(files.map((f) => [f._id, f]));

  // 获取文件的完整路径数组
  const getPath = (file: FileDoc): string[] => {
    const parts: string[] = [file.name];
    let parentId = file.parentId;

    while (parentId) {
      const parent = filesMap.get(parentId);
      if (!parent) break;
      parts.unshift(parent.name);  // 在开头插入父名
      parentId = parent.parentId;
    }

    return parts;  // ["src", "components", "Button.tsx"]
  };

  // 构建嵌套树
  for (const file of files) {
    const pathParts = getPath(file);
    let current = tree;

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const isLast = i === pathParts.length - 1;

      if (isLast) {
        // 最后一个元素，创建文件/文件夹节点
        if (file.type === "folder") {
          current[part] = { directory: {} };
        } else if (file.content !== undefined) {
          current[part] = { file: { contents: file.content } };
        }
      } else {
        // 中间元素，确保目录存在
        if (!current[part]) {
          current[part] = { directory: {} };
        }
        current = current[part].directory;  // 进入下一层
      }
    }
  }

  return tree;
};
```

### 转换结果示例

```
输入（扁平数组）:
[
  { name: "src", type: "folder", parentId: null },
  { name: "components", type: "folder", parentId: "src" },
  { name: "Button.tsx", type: "file", parentId: "components", content: "..." }
]

输出（嵌套树）:
{
  src: {
    directory: {
      components: {
        directory: {
          Button.tsx: {
            file: { contents: "..." }
          }
        }
      }
    }
  }
}
```

---

## 第八步：实践练习

### 练习 1：添加文件复制功能

**目标**：实现复制文件到另一个文件夹

**步骤**：

1. 在 `convex/files.ts` 添加复制函数：

```typescript
export const copyFile = mutation({
  args: {
    id: v.id("files"),
    targetParentId: v.optional(v.id("files")),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const file = await ctx.db.get("files", args.id);

    if (!file || file.type !== "file") {
      throw new Error("Only files can be copied");
    }

    // 检查目标位置是否有同名文件
    // ...

    await ctx.db.insert("files", {
      projectId: file.projectId,
      parentId: args.targetParentId,
      name: file.name,
      type: "file",
      content: file.content,
      updatedAt: Date.now(),
    });
  },
});
```

2. 在 UI 中添加复制按钮
3. 实现目标文件夹选择

### 练习 2：添加文件移动功能

**步骤**：

1. 添加 `moveFile` mutation（修改 `parentId`）
2. 添加乐观更新
3. 实现拖拽移动（高级）

### 练习 3：添加右键菜单的"新建文件"快捷键

**步骤**：

1. 监听 `Cmd+N` 快捷键
2. 在当前选中的文件夹下创建输入框
3. 自动聚焦到输入框

---

## 第九步：运行和调试

### 测试文件树功能

1. 创建一个新项目
2. 点击"新建文件夹"按钮
3. 在文件夹中创建文件
4. 测试重命名和删除
5. 观察面包屑导航的变化

### 查看 Convex 数据

访问 Convex Dashboard 查看文件数据结构，理解 `parentId` 关系。

---

## 检查清单

- [ ] 能解释 `parentId` 的作用
- [ ] 能解释为什么需要复合索引 `by_project_parent`
- [ ] 能解释递归组件渲染的原理
- [ ] 能解释 `enabled` 参数的作用
- [ ] 能解释 `path.unshift` 的作用（构建路径）
- [ ] 能解释递归删除的实现
- [ ] 能解释缩进计算公式
- [ ] 完成练习 1（复制功能）

---

## 常见问题

### Q1: 为什么文件夹要排在文件前面？
**A**: 符合 IDE 习惯，文件夹可以展开，放在前面更方便操作。

### Q2: 递归删除会不会很慢？
**A**: Convex mutation 有超时限制，深层嵌套可能需要优化（比如批量删除）。

### Q3: 为什么用 `unshift` 而不是 `push`？
**A**: 我们是从叶子节点向上遍历，需要把父节点插入到数组开头，保证顺序从根到叶。

---

## 下一步

完成本任务后，继续学习 **任务 3：代码编辑器集成**