# 本地制图工具

`render_image` 将模型编排的自包含 HTML/CSS 和内联 SVG 渲染为 PNG；`view_image` 把实际图片作为原生视觉输入交给当前模型检查。产物保存在当前用户的工作空间，聊天中可预览、放大、下载，并随会话历史保留引用。

## 安装与启用

```bash
uv sync --extra rendering
uv run playwright install chromium

# Linux 还需浏览器运行库与中文字体
uv run playwright install --with-deps chromium
# Debian / Ubuntu：sudo apt-get install fonts-noto-cjk
```

pip 安装方式为 `pip install -e '.[rendering]'`，再执行 `python -m playwright install chromium`。普通安装保持轻量；没有渲染依赖时工具返回上述配置提示，不影响其他工具。

新配置默认允许 `render_image`、`view_image`。已经保存的 `agent_tool_allowlist` 不会被自动扩大，需要在工具配置中勾选这两个工具。`view_image` 加入默认子 Agent 只读工具集；`render_image` 会写文件，默认危险工具集包含它，子 Agent 必须同时取得角色 allowlist 和危险工具授权。

## 模型调用协议

Agent 会根据当前实际可用的工具，在系统提示词末尾追加制图策略；已有自定义系统提示词同样生效，无需重置配置。静态报表、数据图和信息图优先直接调用 `render_image(html=...)`，不默认通过 bash 编写 Python、Matplotlib、Pillow 或浏览器截图脚本，也不为准备 HTML 额外编写生成脚本。已有 HTML 片段可通过 `html_path` 使用；需要保存源片段时可使用已启用的 `write_file`。

该策略保留 bash 的数据处理和计算用途，也遵循用户明确指定的绘图代码或其他渲染流程。静态 HTML/SVG 无法满足需求时，模型应说明限制再选择可用替代能力。`render_image` 是静态渲染器，照片、艺术创作等生成式图像需求需要另行提供合适的图片工具。

旧工具白名单未启用 `render_image` 时，可使用能力确实匹配当前请求的其他已启用专用图片/图表工具，包括 MCP 工具。没有合适工具时，主 Agent 应提示在工具配置中启用 `render_image`、`view_image`；受权限限制的子 Agent 则将数据和版式需求交回父 Agent。工具缺失或渲染失败不应触发静默 bash 降级，缺少依赖时应返回安装提示。没有 `view_image` 或视觉检查失败时，应明确说明尚未完成视觉检查。策略不自动扩大任何工具权限，也不通过 shell 命令关键字拦截正常计算任务；它指导模型选择工具，并非执行层的强制路由。

1. 收集一次数据，固定时间、来源、单位及数值。
2. 从同一个快照生成正文与 SVG，不在排版时重新查询数据。
3. 调用 `render_image`。输入 `html` 或用户工作空间内的 `html_path`，二者恰好一个。
4. 阅读 `layout.issues`，修正溢出、字号、重叠等问题。
5. 用 `view_image` 实际查看最终 PNG、顶部、中部、底部检查图及手机预览；确认完整内容，不能只看缩略图。
6. 发现问题后改源文件并重新渲染、查看。每次生成新的产物 ID，旧图仍可回看。

```json
{
  "html": "<h1>季度收入</h1><p>本期收入 128 万元。</p><svg viewBox=\"0 0 736 230\"><rect x=\"40\" y=\"40\" width=\"512\" height=\"80\" fill=\"#295fc2\"/><text x=\"40\" y=\"175\" font-size=\"28\">128 万元</text></svg>",
  "snapshot": {
    "as_of": "2026-09-09 · 固定演示快照",
    "sources": ["本地模拟数据，不代表真实公司"],
    "data": {"revenue": 128, "unit": "万元"}
  }
}
```

HTTP 直接执行沿用 `POST /api/v1/tools/render_image/execute`，请求体为 `{"arguments": {...}}`，需要 `tools:execute` 权限。模型内部通过标准工具注册和 allowlist 调用。

默认逻辑宽度 800 px、`scale=3`，输出宽度严格为 2400 px，高度根据完整内容测量。可指定 `logical_width=360..1200`、`scale=1..4`。所有字段严格校验，不接受自选输出路径，产物写入 `artifacts/renderings/<artifact_id>/`。

默认字号：总标题 44 px，模块标题与正文 32 px，图例、坐标/来源类 24 px。支持 `.source`、`.sources`、`.legend`、`.axis`、`.caption`；可用内联 `<style>` 定义卡片与布局。SVG 文本默认继承字号，模型仍应按最终实际大小检查轴标签。

只接收 **HTML 片段**（如 `<style>...</style><h1>...</h1>`），不接收整个 `<html>` 文档。图表使用内联 SVG；现有 ECharts/其他图表应先转成静态 SVG。第一版不运行 JavaScript、Canvas、iframe、动画或交互控件，不使用 CDN；图片使用 PNG/JPEG/WebP base64 data URI，嵌入字体通过 CSS data URI。来源网址作为普通文本显示。HTML 文件内的相对图片路径不会读取，避免将本机文件作为浏览器资源暴露。

## 输出与检查

| 字段/文件 | 含义 |
| --- | --- |
| `files.image` / `image.png` | Chromium 从 HTML/SVG 直接按设备分辨率生成的最终 PNG |
| `files.top/middle/bottom` | 从最终 PNG 裁出的检查区，不缩放 |
| `files.mobile` | 同一 PNG 缩小到 390 px 宽的阅读预览，不重新排版，不作为高清交付文件 |
| `source_path` | 完整排版源 HTML；应继续在本工具的受限环境中处理 |
| `snapshot_path` / `snapshot_sha256` | 可选数据快照及其稳定 SHA-256 |
| `document_sha256` | 排版文档摘要 |
| `manifest_path` | 尺寸、时间、诊断、源文件摘要、产物路径和审阅要求 |
| `layout.issues` | 溢出、疑似裁切/重叠、过小字号、低清位图、拉伸等诊断 |
| `visual_review.status` | 始终为 `required`，自动检查不声称完成视觉审阅 |

出图前等待字体完成加载、所有图片解码和两帧布局稳定。静态 SVG 没有额外的异步图表生命周期。缺失资源、外部资源请求、横向超宽、尺寸超限或超时会失败，不发布半成品。疑似重叠等几何问题随 PNG 返回，便于模型查看后修改。

嵌入字体加载失败时，错误保留 `An embedded font failed to load` 前缀，并列出失败字体的 `family`、`weight`、`style` 和 `status`，便于区分同名字体的不同字重。最多列出四个失败字体，更多失败项以数量提示；各描述符有长度上限并清理控制字符，错误不附带 CSS `src` 或字体 data URI。检查依据是 `document.fonts.ready` 完成后字体集合中的 `status=error`；未参与布局且仍为 `unloaded` 的字体不会被主动加载验证。发生字体错误仍会终止渲染，不会静默忽略；同一个 `@font-face` 的 `src` 列表中若有后续资源成功加载，该字体为 `loaded`，可正常导出。

排查服务器上的间歇性字体错误，可在仓库根目录运行诊断脚本，把原始 frag 和候选 frag 的实际路径作为参数（工作空间不在仓库内时传绝对路径）：

```bash
uv run --extra rendering python scripts/diagnose_render_fonts.py original.html candidate.html \
  --repeat 10 --output /tmp/font-diagnostics.json
```

每轮交替检查各输入，每次新建 Python、Playwright 和 Chromium 进程，沿用 worker 的 `https://render.invalid/` 路由、CSP、默认宽度/DPR 和 `_READY_JS`。不使用 `set_content` 或 `file://`，不主动加载未使用字体，也不修改源文件。报告包含 HTML/内嵌字体 SHA256、字体长度和文件签名、浏览器/依赖版本、每个字体的状态（最多 64 项）、CSP/请求阻断计数和有界 OTS 错误，不包含字体 base64。`passed` 只表示资源就绪检查通过；还应检查 `all_fonts_loaded`，防止候选方案没有实际使用自定义字体而误判成功；即使全部 `loaded`，也仍需查看 PNG 确认字形覆盖和实际显示。若输入是完整 HTML（例如产物 `source.html`），加 `--full-document`；如原请求更改了宽度或 DPR，使用相同的 `--width` 和 `--scale`。输出文件必须不存在；任一轮失败时退出码为 1。该脚本不执行截图和排版审核，修复候选仍须经 `render_image → view_image` 验证。

DOM 检查有元素、文本与比较次数上限，达到上限会返回 `inspection_limit`，不能声称全检。它不能证明中文字形正确、视觉层级合理，也不能验证正文与图表数字语义一致。快照摘要记录输入版本；`snapshot_consistency` 仍标为 `requires_review`，没有快照时标为 `not_provided`。

`view_image` 支持当前用户工作空间内的静态 PNG/JPEG，最多 20 MiB、5000 万像素。图片通过 Chat Completions 的 `image_url` 或 Responses/Codex OAuth 的 `input_image` 传递，要求所配置模型支持视觉。图片数据不进入公共 SSE、追踪和会话持久化；历史仅保留路径，需要复查时重新调用 `view_image`。模型服务仍可能按其视觉输入策略缩放整图，因此需同时查看局部检查图。很长的报告应拆图，确保所有内容被检查。

遇到拥挤依次：减少重复标签 → 简化文字 → 调整列数 → 增加图表高度和间距 → 增加整图高度。不要通过缩小正文字号或放大低清位图掩盖问题。

## 本地与权限边界

- 每个任务使用独立 Chromium 进程、临时 browser context，不连接用户浏览器或复用登录态。
- 输入仅可读取用户工作空间内的文件，输出为独立不可覆盖的产物目录。
- CSP 禁止脚本、外网、嵌套页面等主动内容，浏览器路由另行阻断网络和 WebSocket。
- 每进程最多两个并发制图任务，任务最多 60 秒；HTML 和快照分别最多 2 MB，输出最多 5000 万像素、逻辑高度最多 12000 px。超限应拆图。
- 图片 API `GET /api/v1/tools/render-image/{artifact_id}/{filename}` 需要 `chat:read` 和当前用户认证；只允许五种 PNG 文件名，拒绝跨用户/目录/符号链接访问。HTML 和快照不通过该接口提供。
- 制图不发送数据到外部服务。调用 `view_image` 时，会按现有模型配置将选中的图片发送给模型服务以便视觉检查。

## 验证与示例

```bash
uv run --extra rendering python scripts/render_image_demo.py --workspace /tmp/stocks-render-demo
uv run --extra rendering pytest tests/test_render_image.py tests/test_view_image.py
RUN_RENDERING_BROWSER_TESTS=1 uv run --extra rendering pytest tests/test_rendering_browser.py
```

演示脚本从一份明确标为模拟的数据快照同时生成数字、正文与 SVG；输出 JSON 包含可直接打开的工作空间相对路径。浏览器测试检查最终 PNG 尺寸、完整高度、检查图像素一致性、资源失败和排版诊断；正常测试不自动下载或启动浏览器。

实现参考：[Playwright 高清截图](https://playwright.dev/python/docs/screenshots)、[设备分辨率配置](https://playwright.dev/python/docs/emulation)、[浏览器上下文与请求拦截](https://playwright.dev/python/docs/api/class-browsercontext)。
