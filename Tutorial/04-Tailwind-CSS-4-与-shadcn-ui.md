# 第 4 课：Tailwind CSS 4 与 shadcn/ui

> 本课目标：掌握 Tailwind CSS 4 的新特性、shadcn/ui 组件库的使用和定制方法

---

## 4.1 什么是 Tailwind CSS？

Tailwind CSS 是一个**原子化 CSS 框架**，通过组合简短的 utility 类来构建界面，而不是编写自定义 CSS。

### 传统 CSS vs Tailwind CSS

**传统 CSS：**
```css
/* style.css */
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 1rem;
  background-color: #1a1a1a;
  color: white;
  border-radius: 0.375rem;
  font-weight: 500;
}

.button:hover {
  background-color: #333;
}
```

```html
<button class="button">Click me</button>
```

**Tailwind CSS：**
```html
<button class="inline-flex items-center justify-center px-4 py-2 bg-neutral-900 text-white rounded-md font-medium hover:bg-neutral-800">
  Click me
</button>
```

### Tailwind 的核心理念

1. **原子化**：每个类只做一件事
2. **约束设计**：通过预定义的设计令牌确保一致性
3. **零冲突**：生成的类名是唯一的，不会冲突
4. **快速开发**：不需要切换文件即可编写样式

### 常用类名速查

| 类别 | 类名示例 | 说明 |
|------|---------|------|
| 布局 | `flex`, `grid`, `block`, `hidden` | 显示类型 |
| 间距 | `p-4`, `m-2`, `gap-3`, `space-x-2` | 内边距、外边距、间隙 |
| 尺寸 | `w-10`, `h-6`, `min-w-full` | 宽度、高度 |
| 颜色 | `bg-red-500`, `text-white`, `border-gray-300` | 背景、文本、边框颜色 |
| 排版 | `text-sm`, `font-bold`, `leading-tight` | 字体大小、粗细、行高 |
| 圆角 | `rounded-sm`, `rounded-lg`, `rounded-full` | 圆角大小 |
| 阴影 | `shadow-sm`, `shadow-md`, `shadow-lg` | 阴影级别 |
| 交互 | `hover:bg-blue-500`, `focus:ring-2`, `active:scale-95` | 悬停、聚焦、点击状态 |

---

## 4.2 Tailwind CSS 4 的新特性

Tailwind CSS 4 是一个重大版本更新，带来了全新的配置方式和性能优化。

### Tailwind CSS 3 vs 4 对比

| 特性 | v3 | v4 |
|------|----|----|
| 配置方式 | `tailwind.config.js` | CSS 文件（`@theme`） |
| CSS 变量 | 需要额外配置 | 原生支持 |
| 性能 | JIT 编译器 | Lightning CSS 引擎 |
| 嵌套 | 需要 PostCSS 插件 | 原生支持 |
| 变体语法 | `@apply` | 相同，支持更好 |

### Tailwind CSS 4 的配置方式

在 v4 中，**不再需要 `tailwind.config.js`**，所有配置都在 CSS 文件中完成。

```css
/* globals.css */
@import "tailwindcss";

/* 定义主题变量 */
@theme {
  --color-primary: #1a1a1a;
  --color-secondary: #f5f5f5;
  --font-sans: "Inter", sans-serif;
  --spacing-4xl: 2rem;
}

/* 使用变量 */
.my-component {
  background-color: var(--color-primary);
  font-family: var(--font-sans);
}
```

### Polaris 项目中的 Tailwind CSS 4 配置

```css
/* src/app/globals.css */
@import "tailwindcss";

/* 自定义变体：dark 模式 */
@custom-variant dark (&:is(.dark *));

/* 定义主题变量（对应设计令牌） */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-secondary: var(--secondary);
  /* ... 更多变量 */
}

/* 主题变量定义 */
:root {
  --background: oklch(0.2925 0.0157 264.3);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  /* ... */
}

.dark {
  --background: oklch(0.15 0 0);
  --foreground: oklch(0.98 0 0);
  /* ... */
}
```

### CSS 变量与 Tailwind 类名的映射

在 `@theme inline` 块中定义的变量会自动生成对应的 Tailwind 类名：

```css
@theme inline {
  --color-primary: oklch(0.205 0 0);
}

/* 生成以下类名： */
.bg-primary    → background-color: var(--color-primary)
.text-primary  → color: var(--color-primary)
.border-primary → border-color: var(--color-primary)
```

---

## 4.3 CSS 变量与 oklch 颜色

Polaris 使用 **oklch** 颜色空间定义设计系统，这是一种更符合人类视觉感知的颜色表示方式。

### 什么是 oklch？

oklch 是 OKLab 颜色空间的表示方式，包含：
- **L**：明度（Lightness，0-1）
- **C**：色度（Chroma，色彩饱和度）
- **H**：色相（Hue，0-360 度）

### 为什么使用 oklch？

```css
/* oklch 的优势：*/
/* 1. 亮度感知均匀 - 渐变更自然 */
background: oklch(0.5 0.2 240);  /* 蓝色 */
/* 调整亮度时，色彩饱和度保持一致 */
background: oklch(0.7 0.2 240);  /* 更亮的蓝色 */

/* 2. 支持透明通道 */
background: oklch(0.5 0.2 240 / 50%);  /* 50% 透明度 */
```

### 常用颜色模式对比

```css
/* HEX - 不直观，难以调整 */
background: #1a1a1a;

/* RGB - 不直观 */
background: rgb(26, 26, 26);

/* HSL - 较好，但不完美 */
background: hsl(0, 0%, 10%);

/* OKLCH - 最好！直观且准确 */
background: oklch(0.15 0 0);
```

### 深色模式切换

```css
:root {
  --color-bg: oklch(1 0 0);  /* 白色 */
  --color-text: oklch(0.15 0 0);  /* 黑色 */
}

.dark {
  --color-bg: oklch(0.15 0 0);  /* 黑色 */
  --color-text: oklch(1 0 0);  /* 白色 */
}
```

---

## 4.4 shadcn/ui 组件库

shadcn/ui 不是一个传统意义的组件库，而是一组**可复制粘贴的组件源码**，基于 Radix UI 和 Tailwind CSS。

### shadcn/ui vs 传统组件库

| 特性 | shadcn/ui | 传统组件库（如 Material UI） |
|------|-----------|---------------------------|
| 使用方式 | 复制源码到项目中 | 安装 npm 包 |
| 定制性 | 源码在手，完全可控 | 受 API 限制 |
| 包大小 | 0（无运行时） | 可能很大 |
| 更新方式 | 手动合并更新 | npm update |
| 样式 | Tailwind CSS | 自有样式系统 |

### Polaris 的组件结构

```
src/components/ui/
├── button.tsx      # 按钮组件
├── dialog.tsx      # 对话框组件
├── input.tsx       # 输入框组件
├── card.tsx        # 卡片组件
├── dropdown-menu.tsx  # 下拉菜单
├── tabs.tsx        # 标签页
├── ...
└── tooltip.tsx     # 工具提示
```

### components.json 配置

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",     // 组件风格
  "rsc": true,              // 支持 React Server Components
  "tsx": true,             // 使用 TypeScript
  "tailwind": {
    "css": "src/app/globals.css",  // CSS 文件位置
    "baseColor": "neutral",        // 基础颜色
    "cssVariables": true           // 启用 CSS 变量
  },
  "iconLibrary": "lucide",  // 图标库
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

---

## 4.5 Button 组件详解

Button 是最基础的组件，通过 **CVA（Class Variance Authority）** 实现变体管理。

### Button 源码解析

```typescript
// src/components/ui/button.tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// 使用 CVA 定义变体
const buttonVariants = cva(
  // 基础类名
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      // 变体类型
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        outline: "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        highlight: "bg-transparent hover:bg-accent-foreground/5",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// 组件实现
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean  // 是否作为 Slot 使用
  }) {
  // asChild 模式：将 props 传递给子元素
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
```

### CVA 的核心概念

**CVA（Class Variance Authority）** 是 shadcn/ui 的核心，用于管理组件的变体：

```typescript
import { cva, type VariantProps } from "class-variance-authority"

// 定义变体
const buttonVariants = cva("基础类名", {
  variants: {
    变体属性: {
      变体值: "对应的类名",
    },
  },
  defaultVariants: {
    变体属性: "默认值",
  },
});

// 使用
buttonVariants({ variant: "default", size: "lg" })
// → "基础类名 bg-primary text-primary-foreground hover:bg-primary/90 h-10 rounded-md px-6"
```

### Button 使用示例

```tsx
import { Button } from "@/components/ui/button"

// 默认按钮
<Button>Default</Button>

// 不同变体
<Button variant="destructive">Destructive</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

// 不同尺寸
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
<Button size="icon">
  <XIcon className="h-4 w-4" />
</Button>

// asChild 模式（传递 props 给子元素）
<Button asChild>
  <Link href="/projects">Go to Projects</Link>
</Button>
```

---

## 4.6 Dialog 组件与 Radix UI

Dialog 组件基于 **Radix UI** 的无样式、可访问的原始组件构建。

### Radix UI 简介

Radix UI 提供**无样式、可访问**的 UI 原始组件，需要配合 Tailwind CSS 使用：

```
Radix Dialog 原始组件
       ↓
    shadcn/ui 添加样式
       ↓
    Polaris 使用
```

### Dialog 组件结构

```tsx
// 使用方式
<Dialog>
  <DialogTrigger asChild>
    <Button variant="outline">Open Dialog</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Dialog Title</DialogTitle>
      <DialogDescription>Dialog description</DialogDescription>
    </DialogHeader>
    {/* 你的内容 */}
    <DialogFooter>
      <Button variant="outline">Cancel</Button>
      <Button>Confirm</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Dialog 源码解析

```tsx
// src/components/ui/dialog.tsx
"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// Dialog 根组件
function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

// 触发器
function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

// 遮罩层
function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        // 动画类名
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "fixed inset-0 z-50 bg-black/50",  // 遮罩样式
        className
      )}
      {...props}
    />
  )
}

// 内容区域
function DialogContent({
  className,
  children,
  showCloseButton = true,  // 自定义 prop
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg",
          className
        )}
        {...props}
      >
        {children}

        {/* 自定义关闭按钮 */}
        {showCloseButton && (
          <DialogPrimitive.Close className="...">
            <XIcon />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}
```

### Radix 状态动画类名

Radix UI 通过 `data-state` 属性报告组件状态，shadcn/ui 利用这一点实现动画：

```css
/* 淡入淡出 */
data-[state=open]:animate-in
data-[state=closed]:animate-out
data-[state=closed]:fade-out-0
data-[state=open]:fade-in-0

/* 缩放 */
data-[state=closed]:zoom-out-95
data-[state=open]:zoom-in-95
```

---

## 4.7 Input 组件与表单

Input 组件展示了如何构建一个符合设计系统的表单元素。

### Input 源码

```tsx
// src/components/ui/input.tsx
import * as React from "react"
import { cn } from "@/lib/utils"

function Input({
  className,
  type,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // 基础样式
        "flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm",
        "file:text-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "placeholder:text-muted-foreground",
        // 聚焦样式
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        // 错误状态
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        // 禁用状态
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
```

### 组合使用

```tsx
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function MyForm() {
  return (
    <div className="space-y-2">
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  )
}
```

### 文件输入

```tsx
<Input type="file" accept=".pdf,.doc,.docx" />
```

---

## 4.8 cn 工具函数

`cn`（或 `clsx` + `tailwind-merge`）是连接类名的关键工具。

### 源码解析

```typescript
// src/lib/utils.ts
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### clsx - 条件类名

```typescript
import { clsx } from "clsx"

// 基本用法
clsx("foo", "bar")  // "foo bar"

// 条件类名
clsx("foo", condition && "bar")  // 条件为 false 时忽略
clsx("foo", null, undefined, false)  // 忽略假值

// 对象语法
clsx({
  "foo": true,
  "bar": false,
  "baz": condition,
})
```

### twMerge - 合并冲突类名

```typescript
import { twMerge } from "tailwind-merge"

// 合并冲突的类名
twMerge("px-2 px-4")  // "px-4"（后者覆盖前者）
twMerge("bg-red-500 bg-blue-500")  // "bg-blue-500"

// 在 cn 中自动处理
cn("px-2 py-2", "p-4")  // "py-2 p-4"（保留非冲突的 px-2）
```

### 实际使用

```tsx
// 基础用法
<Button className="px-4 py-2">Hello</Button>

// 动态类名
<Button className={cn(
  "w-full",
  isActive && "bg-primary",
  isDisabled && "opacity-50"
)}>
  Dynamic Button
</Button>

// 覆盖默认样式
<Input className="h-12 text-lg" />
```

---

## 4.9 常用组件一览

Polaris 项目包含以下 shadcn/ui 组件：

### 表单组件

| 组件 | 用途 | 关键文件 |
|------|------|---------|
| Button | 按钮 | `button.tsx` |
| Input | 输入框 | `input.tsx` |
| Label | 标签 | `label.tsx` |
| Textarea | 多行文本 | `textarea.tsx` |
| Checkbox | 复选框 | `checkbox.tsx` |
| RadioGroup | 单选组 | `radio-group.tsx` |
| Switch | 开关 | `switch.tsx` |
| Select | 选择器 | `select.tsx` |
| Slider | 滑块 | `slider.tsx` |

### 布局组件

| 组件 | 用途 | 关键文件 |
|------|------|---------|
| Card | 卡片 | `card.tsx` |
| Separator | 分隔线 | `separator.tsx` |
| AspectRatio | 宽高比 | `aspect-ratio.tsx` |

### 反馈组件

| 组件 | 用途 | 关键文件 |
|------|------|---------|
| Alert | 警告提示 | `alert.tsx` |
| Progress | 进度条 | `progress.tsx` |
| Skeleton | 骨架屏 | `skeleton.tsx` |
| Spinner | 加载动画 | `spinner.tsx` |
| Sonner | Toast 通知 | `sonner.tsx` |

### 导航组件

| 组件 | 用途 | 关键文件 |
|------|------|---------|
| Tabs | 标签页 | `tabs.tsx` |
| NavigationMenu | 导航菜单 | `navigation-menu.tsx` |
| Breadcrumb | 面包屑 | `breadcrumb.tsx` |
| Pagination | 分页 | `pagination.tsx` |

### 覆盖组件

| 组件 | 用途 | 关键文件 |
|------|------|---------|
| Dialog | 对话框 | `dialog.tsx` |
| Popover | 弹出框 | `popover.tsx` |
| Tooltip | 工具提示 | `tooltip.tsx` |
| Sheet | 侧边抽屉 | `sheet.tsx` |
| DropdownMenu | 下拉菜单 | `dropdown-menu.tsx` |
| ContextMenu | 右键菜单 | `context-menu.tsx` |
| HoverCard | 悬停卡片 | `hover-card.tsx` |

### 高级组件

| 组件 | 用途 | 关键文件 |
|------|------|---------|
| Command | 命令面板 | `command.tsx` |
| Calendar | 日历 | `calendar.tsx` |
| Carousel | 轮播 | `carousel.tsx` |
| Chart | 图表 | `chart.tsx` |
| DataTable | 数据表格 | `table.tsx` + `data-table` |
| Sidebar | 侧边栏 | `sidebar.tsx` |
| Menubar | 菜单栏 | `menubar.tsx` |

---

## 4.10 组件定制与扩展

### 添加新变体

在 `buttonVariants` 中添加新的变体：

```typescript
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 ...",
  {
    variants: {
      variant: {
        // ... 现有变体
        success: "bg-green-600 text-white hover:bg-green-700",
      },
    },
  }
)
```

### 创建新组件

```tsx
// src/components/ui/my-button.tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const myButtonVariants = cva("...", {
  variants: {
    variant: {
      success: "bg-green-600 text-white hover:bg-green-700",
    },
  },
})

export function MyButton({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof myButtonVariants>) {
  return (
    <button
      className={cn(myButtonVariants({ variant, className }))}
      {...props}
    />
  )
}
```

### 使用 Slot 模式（asChild）

Slot 允许将 props 传递给子元素：

```tsx
// Button 组件使用 Slot
const Comp = asChild ? Slot : "button"

<Comp {...props}>
  {/* 如果 asChild 为 true，props 会传递给 Slot 的子元素 */}
  {children}
</Comp>

// 使用
<Button asChild>
  <Link to="/about">About</Link>
</Button>
// 渲染为：<Link to="/about" class="button classes">About</Link>
```

---

## 4.11 全局样式与基础配置

### globals.css 结构

```css
/* 1. 导入 Tailwind CSS */
@import "tailwindcss";

/* 2. 导入动画库 */
@import "tw-animate-css";

/* 3. 自定义变体 */
@custom-variant dark (&:is(.dark *));

/* 4. 定义主题变量映射 */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  /* ... */
}

/* 5. 主题变量值 */
:root {
  --background: oklch(...);
  --foreground: oklch(...);
  /* ... */
}

/* 6. 暗色模式 */
.dark {
  --background: oklch(...);
  /* ... */
}

/* 7. 基础样式层 */
@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}

/* 8. 自定义动画 */
@theme inline {
  --animate-cell-ripple: cell-ripple ...;
  @keyframes cell-ripple { ... }
}

/* 9. 滚动条样式 */
::-webkit-scrollbar { ... }
```

### PostCSS 配置

```javascript
// postcss.config.mjs
const config = {
  plugins: {
    "@tailwindcss/postcss": {},  // Tailwind CSS 4 的 PostCSS 插件
  },
};

export default config;
```

---

## 4.12 练习建议

1. **查看组件源码**：阅读 `src/components/ui/` 下的组件源码
2. **使用 Button**：尝试使用不同的 variant 和 size
3. **创建 Dialog**：实现一个自定义对话框
4. **定制组件**：为 Button 添加一个新变体（如 `success`）
5. **修改主题**：在 `globals.css` 中修改颜色变量，观察变化

### 实践：创建自定义按钮

```tsx
// 1. 添加 success 变体到 button.tsx
variant: {
  // ... 现有变体
  success: "bg-green-600 text-white hover:bg-green-700",
}

// 2. 使用
<Button variant="success">Success!</Button>
```

### 实践：创建自定义卡片

```tsx
// src/components/ui/my-card.tsx
import * as React from "react"
import { cn } from "@/lib/utils"

function MyCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-sm",
        className
      )}
      {...props}
    />
  )
}

// 使用
<MyCard className="p-6">
  <h2>Card Title</h2>
  <p>Card content...</p>
</MyCard>
```

---

## 4.13 总结

本节课我们了解到：

- ✅ **Tailwind CSS 原子化理念**：通过组合 utility 类构建界面
- ✅ **Tailwind CSS 4 新特性**：`@theme` 配置、CSS 变量、oklch 颜色
- ✅ **shadcn/ui 组件库**：可复制粘贴的源码，完全可控
- ✅ **CVA 变体管理**：通过 `class-variance-authority` 管理组件变体
- ✅ **Radix UI 基础**：无样式、可访问的原始组件
- ✅ **cn 工具函数**：合并类名，处理冲突
- ✅ **组件定制**：添加变体、创建新组件、Slot 模式

**下一课预告**：Convex 实时数据库 - 深入理解 Convex 的 Schema 设计、CURD 操作和实时数据订阅。
