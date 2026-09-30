# 前端模块与多语言扩展

## 模块职责

- `src/App.tsx` 负责应用装配、路由、权限和共享配置。导航、账号菜单和移动端聊天抽屉位于 `components/shell/`。
- 页面负责组合视图；Dashboard 区块放 `components/dashboard/`。设置页各标签位于 `components/config/sections/`，持仓表单位于 `components/portfolio/drawers/`。`useSettings`、`usePortfolioPage`、`useMCPServers` 保留各自页面的状态与命令；视图仅接收实际需要的属性，不能另建同一份业务状态。
- 技术图表分为设置、数据转换、K 线、分时和渲染层；`components/charts/native/` 中的几何、绘制及类型模块不依赖页面。Canvas 生命周期仍由 `NativeStockChart` 统一管理。
- `lib/api.ts` 保留公开调用门面，具体接口按领域放在 `lib/api/`。全部请求复用 `transport.ts` 的认证、身份代次、续期和 GET 去重状态，不能在领域模块重新创建认证会话或缓存。
- `types/app.ts` 保留类型导出兼容入口，领域类型定义在 `types/` 对应文件。
- `index.css` 只声明有序导入；主题基础、外壳、金融组件、交互、动画、响应式和无障碍覆盖分到 `styles/`。顺序属于层叠契约，移动规则时必须核对最终优先级。

按职责拆分模块，避免继续向入口文件添加完整子页面或表单。拆分时保留已有权限、请求控制器和副作用生命周期；以文件行数下降为目标的机械切割不能替代清晰的依赖方向。

## 多语言框架

新代码从 `@/i18n` 引用纯函数和类型，从 `@/i18n/react` 引用 React 接口。历史 `lib/i18n.ts` 仅保留兼容导出。

| 模块 | 职责 |
| --- | --- |
| `i18n/locales/zh/`、`en/` | 按领域维护的文案资源，`index.ts` 组装语言包 |
| `i18n/types.ts` | 从默认资源推导消息结构、点路径键、部分翻译类型 |
| `i18n/core.ts` | 与 React 无关的注册、语言规范化、逐键回退、插值和 Intl 格式化 |
| `i18n/registry.ts` | 语言 ID、原生名称、Intl 地区、别名、文字方向及证券名称字段优先级 |
| `i18n/react.tsx` | 受控 Provider、`useI18n` 和 HTML `lang`/`dir` 同步 |

语言状态继续来自账号配置 `app_language`，Provider 不另存 localStorage。设置页直接遍历 `supportedLanguages`，`AppLanguage` 从注册表推导；不要在业务代码维护 `"zh" | "en"` 或按语言写条件文案。

主题色使用账号配置 `app_theme_color`，与语言复用配置草稿及自动保存队列；登录时从配置 API 恢复，退出时清理 DOM 主题色。旧版浏览器主题色不再作为配置来源，未设置的账号默认蓝色，用户可重新选择并保存到账号。

```tsx
import { useI18n } from "@/i18n/react";

function Example() {
  const { t, number, date } = useI18n();
  return <p>{t("ui.common.newChat")} · {number(1234.5)} · {date(new Date())}</p>;
}
```

已有显式 `language` 属性的页面可继续使用 `getMessages(language).dashboard` 或 `catalogsFor("dashboard")[language]`。纯函数可使用 `translate(language, key, values)`、`localeFor(language)` 或 `runtime` 的格式化方法。翻译结果是文本，交给 React 渲染，不作为 HTML 注入。

- 使用有语义的键，整句文案通过 `{name}` 插值；不同语言必须保留相同占位符。缺失参数保留占位符，便于发现错误；数值 `0` 不会被当作缺失。
- 缺失翻译按键回退到中文，数组整体回退或替换，不混合不同语言的数组位置。完整的英文资源以 `satisfies Messages` 校验。
- 用 Intl 处理日期、数字、货币和复数；`runtime.plural(language, count, forms)` 按语言规则选择分支，必须提供 `other`。
- 用户消息、已持久化会话标题、供应商返回的公司名称和错误详情是数据，不能因界面切换语言而重写。

## 添加语言

1. 新建 `locales/<id>/`，按领域提供资源，并在该目录 `index.ts` 组装。完整翻译声明 `satisfies Messages`；逐步翻译可声明 `satisfies PartialMessages<Messages>`。
2. 在 `registry.ts` 注册资源、`nativeName`、`intlLocale`、`direction`、可选 `aliases` 和 `symbolNameFields`。设置选项、语言联合类型和回退后的目录自动更新。语言别名重复会在注册时失败。
3. 同步扩展后端 `app/config.py::Settings.validate_app_language` 的允许值和相关配置测试。目前后端仍将非中英文值归一化为中文，因此仅注册前端资源不足以启用账号级持久化。
4. 更新资源一致性测试，确认键和占位符匹配；对部分翻译明确测试回退。RTL 注册只设置文字方向，正式上线前仍需核对具体页面布局、图表和键盘操作。

当前正式提供中文和英文。第三语言的注册、部分翻译回退及 RTL 方向由独立测试样例验证，不代表已提供该语言的产品翻译。

## 验证

在 `frontend/` 执行：

```sh
npm test
npm run build
npm run test:browser
npm run test:browser:watchlist
npm run test:browser:workspace
```

`frontend-boundaries.test.ts` 防止页面重新引入中英文分支、双语对象和重复插值函数。`i18n.test.ts` 校验语言别名、资源结构、占位符、回退和格式化。工作台浏览器测试验证中英文切换、HTML 语言、账号自动保存及刷新恢复。图表与 StrictMode 回归覆盖绘制、移动端布局、拖拽和聊天请求；运行条件见 `frontend/tests/README.md`。
