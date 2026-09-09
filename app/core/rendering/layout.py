"""本地制图的排版基线与有界 DOM 检查；检查结果不能替代最终图片审阅。"""

DEFAULT_CSS = r"""
:root {
  color-scheme: light;
  font-family: "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  font-size: 32px;
  line-height: 1.55;
  color: #172033;
  background: #ffffff;
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; width: 100%; min-height: 0; }
body { padding: 32px; overflow-wrap: anywhere; }
h1 { font-size: 44px; line-height: 1.18; margin: 0 0 28px; }
h2, h3 { font-size: 32px; line-height: 1.35; margin: 32px 0 20px; }
p, ul, ol, figure { margin: 0 0 24px; }
small, figcaption, .source, .sources, .legend, .axis, .caption {
  font-size: 24px;
  line-height: 1.5;
}
img, svg { max-width: 100%; height: auto; }
img { object-fit: contain; }
svg { overflow: visible; }
svg text { font-family: inherit; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: start; vertical-align: top; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
"""

VISUAL_CHECKLIST: list[str] = [
    "实际查看最终 PNG 的顶部、中部、底部，确认全部内容完整。",
    "确认中文正常显示，数字和单位清晰；DOM 检查无法保证字体实际覆盖中文。",
    "确认标题、图例、坐标轴和标签没有重叠。",
    "确认卡片和文本没有溢出边界。",
    "确认内容没有被裁切、挤压或拉伸。",
    "按手机宽度查看，确认主次清楚；放大后文字与线条仍然清晰。",
    "核对图表和正文使用同一数据快照；自动排版检查不能验证数据语义。",
]

CROWDING_FIX_ORDER: list[str] = [
    "减少重复标签",
    "简化文字",
    "调整列数",
    "增加图表高度和间距",
    "增加整图高度",
]

# 文本矩形使用空间网格与总比较预算，避免长报告触发两两比较的平方级开销。
# 几何检查仅报告可疑点；字形覆盖、阅读层级及数据一致性必须从最终 PNG 和数据核验。
LAYOUT_AUDIT_JS = r"""
() => {
  const limits = {elements: 3000, textNodes: 4000, textRects: 1200,
                  comparisons: 20000, issues: 160};
  const root = document.documentElement;
  const body = document.body || root;
  const width = Math.ceil(root.clientWidth || window.innerWidth);
  // 根元素 scrollHeight 至少等于初始视口高度；短图应取内容高度，避免强留 600px 空白。
  const height = Math.ceil(Math.max(body.scrollHeight, body.offsetHeight,
    body.getBoundingClientRect().bottom + window.scrollY,
    root.scrollHeight > root.clientHeight ? root.scrollHeight : 0));
  const issues = [];
  const seen = new Set();
  const elementIds = new WeakMap();
  const styleCache = new WeakMap();
  const stats = {totalElements: document.getElementsByTagName('*').length,
    inspectedElements: 0, inspectedTextNodes: 0, inspectedTextRects: 0,
    overlapComparisons: 0, issueCount: 0, droppedIssues: 0,
    truncated: false, manualReviewRequired: true,
    deviceScaleFactor: window.devicePixelRatio, limits};
  const style = element => {
    if (!styleCache.has(element)) styleCache.set(element, getComputedStyle(element));
    return styleCache.get(element);
  };
  const describe = element => {
    if (!element) return 'document';
    const tag = element.tagName.toLowerCase();
    if (element.id) return `${tag}#${element.id.slice(0, 80)}`;
    const classes = (element.getAttribute('class') || '').trim().split(/\s+/)
      .filter(Boolean).slice(0, 2).join('.').slice(0, 80);
    return `${tag}${classes ? '.' + classes : ''} [${elementIds.get(element) || '?'}]`;
  };
  const report = (code, severity, element, message) => {
    const label = describe(element);
    const key = `${code}:${label}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    stats.issueCount++;
    if (issues.length >= limits.issues) { stats.droppedIssues++; return; }
    issues.push({code, severity, element: label, message});
  };
  const visible = element => {
    const css = style(element);
    return css.display !== 'none' && css.visibility !== 'hidden' &&
      css.visibility !== 'collapse' && element.getClientRects().length > 0;
  };
  const exceeds = (inner, outer, horizontal = true, vertical = true) =>
    (horizontal && (inner.left < outer.left - 2 || inner.right > outer.right + 2)) ||
    (vertical && (inner.top < outer.top - 2 || inner.bottom > outer.bottom + 2));
  const clips = value => ['hidden', 'clip', 'auto', 'scroll'].includes(value);
  const containerFor = (element, includeSelf = false) => {
    let ancestor = includeSelf ? element : element.parentElement;
    for (let i = 0; ancestor && i < 12; i++, ancestor = ancestor.parentElement) {
      if (/^(block|flow-root|flex|grid|inline-flex|inline-grid|table-cell|list-item)$/
          .test(style(ancestor).display)) return ancestor;
    }
    return null;
  };
  if (root.scrollWidth > width + 2 || body.scrollWidth > width + 2) {
    report('horizontal_overflow', 'error', body, '页面内容超出逻辑宽度，导出可能裁切横向内容。');
  }
  const elements = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  let element = elements.currentNode;
  while (element && stats.inspectedElements < limits.elements) {
    elementIds.set(element, ++stats.inspectedElements);
    if (visible(element)) {
      const rect = element.getBoundingClientRect();
      const css = style(element);
      if (rect.width && (rect.left < -2 || rect.right > width + 2)) {
        // 负坐标通常不增加 scrollWidth，但仍会被从 x=0 开始的导出裁切。
        report('horizontal_overflow', 'error', body,
          '页面内容超出逻辑宽度，导出可能裁切横向内容。');
        report('element_outside_page', 'warning', element, '元素超出页面左右边界。');
      }
      if (rect.height && (rect.top < -2 || rect.bottom > height + 2)) {
        report('vertical_clipping', 'warning', element, '元素超出页面顶部或底部，可能被导出裁切。');
      }
      // overflow 容器的隐藏/滚动内容不会自动随 full-page 截图展开。
      if ((clips(css.overflowX) && element.scrollWidth > element.clientWidth + 2) ||
          (clips(css.overflowY) && element.scrollHeight > element.clientHeight + 2)) {
        report('clipped_container', 'warning', element,
          '容器存在被隐藏或需滚动才能看到的内容，请展开容器后导出。');
      }
      if (element instanceof HTMLCanvasElement && rect.width > 0 && rect.height > 0) {
        const required = window.devicePixelRatio || 1;
        if (element.width < rect.width * required - 2 ||
            element.height < rect.height * required - 2) {
          report('low_resolution_canvas', 'warning', element,
            `Canvas 像素不足：${element.width}×${element.height}，应按 ${required} 倍尺寸绘制。`);
        }
      }
      if (element instanceof HTMLImageElement) {
        if (!element.complete || !element.naturalWidth) {
          report('image_not_loaded', 'error', element, '图片未成功加载。');
        } else if (rect.width > 0 && rect.height > 0) {
          const boxWidth = element.clientWidth - parseFloat(css.paddingLeft || 0) -
            parseFloat(css.paddingRight || 0);
          const boxHeight = element.clientHeight - parseFloat(css.paddingTop || 0) -
            parseFloat(css.paddingBottom || 0);
          const naturalRatio = element.naturalWidth / element.naturalHeight;
          if (css.objectFit === 'fill' && boxHeight > 0 &&
              Math.abs(boxWidth / boxHeight / naturalRatio - 1) > 0.03) {
            report('stretched_image', 'warning', element, '图片显示比例与原图不同，可能被拉伸。');
          }
          let drawnWidth = boxWidth;
          let drawnHeight = boxHeight;
          if (['contain', 'cover', 'scale-down', 'none'].includes(css.objectFit)) {
            const fit = css.objectFit === 'cover'
              ? Math.max(boxWidth / element.naturalWidth, boxHeight / element.naturalHeight)
              : Math.min(boxWidth / element.naturalWidth, boxHeight / element.naturalHeight);
            const factor = css.objectFit === 'none' ? 1
              : css.objectFit === 'scale-down' ? Math.min(1, fit) : fit;
            drawnWidth = element.naturalWidth * factor;
            drawnHeight = element.naturalHeight * factor;
          }
          const required = window.devicePixelRatio || 1;
          if (element.naturalWidth < drawnWidth * required - 2 ||
              element.naturalHeight < drawnHeight * required - 2) {
            report('low_resolution_image', 'warning', element,
              `原图像素不足：${element.naturalWidth}×${element.naturalHeight}，` +
              `当前显示尺寸需要 ${required} 倍像素；请使用更高清的原图。`);
          }
        }
      }
      if (['svg', 'canvas', 'img'].includes(element.tagName.toLowerCase())) {
        const container = containerFor(element);
        if (container && exceeds(rect, container.getBoundingClientRect())) {
          report('graphic_outside_container', 'warning', element, '图形超出所属容器边界。');
        }
      }
      if (element.tagName.toLowerCase() === 'svg' &&
          element.getAttribute('preserveAspectRatio') === 'none') {
        report('svg_aspect_ratio', 'warning', element,
          'SVG 禁用了宽高比保持，请确认图形没有被挤压或拉伸。');
      }
    }
    element = elements.nextNode();
  }
  if (element) stats.truncated = true;

  const textWalker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const textRects = [];
  let textNode = textWalker.nextNode();
  while (textNode && stats.inspectedTextNodes < limits.textNodes) {
    stats.inspectedTextNodes++;
    const parent = textNode.parentElement;
    if (parent && textNode.textContent.trim() && visible(parent) &&
        !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(parent.tagName)) {
      if (parseFloat(style(parent).fontSize) < 24) {
        report('small_text', 'warning', parent, '可见文字字号小于 24 个逻辑像素，请检查手机可读性。');
      }
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rects = range.getClientRects();
      const container = containerFor(parent, true);
      const enclosingContainer = containerFor(parent);
      for (const rect of rects) {
        if (!rect.width || !rect.height) continue;
        if (textRects.length >= limits.textRects) {
          stats.truncated = true;
          break;
        }
        // 字体的字形框可以高于标题自身 line-height；垂直越界以外层容器为准。
        if ((container && exceeds(rect, container.getBoundingClientRect(), true, false)) ||
            (enclosingContainer &&
             exceeds(rect, enclosingContainer.getBoundingClientRect(), false, true))) {
          report('text_outside_container', 'warning', parent, '文字超出所属容器边界。');
        }
        let ancestor = parent;
        for (let i = 0; ancestor && i < 12; i++, ancestor = ancestor.parentElement) {
          const css = style(ancestor);
          if (exceeds(rect, ancestor.getBoundingClientRect(),
                      clips(css.overflowX), clips(css.overflowY))) {
            report('clipped_text', 'warning', parent, '文字超出裁切容器，部分内容可能不可见。');
            break;
          }
        }
        if (parent.ownerSVGElement &&
            exceeds(rect, parent.ownerSVGElement.getBoundingClientRect())) {
          report('svg_text_outside_chart', 'warning', parent, 'SVG 文字超出图表边界。');
        }
        textRects.push({rect, parent});
      }
    }
    textNode = textWalker.nextNode();
  }
  if (textNode) stats.truncated = true;
  stats.inspectedTextRects = textRects.length;

  const grid = new Map();
  const gridSize = 96;
  let comparisonLimitReached = false;
  for (let i = 0; i < textRects.length && !comparisonLimitReached; i++) {
    const {rect, parent} = textRects[i];
    const minX = Math.floor(rect.left / gridSize);
    const maxX = Math.floor(rect.right / gridSize);
    const minY = Math.floor(rect.top / gridSize);
    const maxY = Math.floor(rect.bottom / gridSize);
    // 异常巨大矩形不能放大网格工作量；这类内容仍有越界诊断。
    if ((maxX - minX + 1) * (maxY - minY + 1) > 200) {
      stats.truncated = true;
      continue;
    }
    const compared = new Set();
    for (let x = minX; x <= maxX && !comparisonLimitReached; x++) {
      for (let y = minY; y <= maxY && !comparisonLimitReached; y++) {
        const key = `${x}:${y}`;
        const bucket = grid.get(key) || [];
        for (const otherIndex of bucket) {
          if (compared.has(otherIndex)) continue;
          compared.add(otherIndex);
          if (stats.overlapComparisons >= limits.comparisons) {
            comparisonLimitReached = true;
            stats.truncated = true;
            break;
          }
          stats.overlapComparisons++;
          const other = textRects[otherIndex];
          if (parent === other.parent || parent.contains(other.parent) ||
              other.parent.contains(parent)) continue;
          const intersectionWidth = Math.min(rect.right, other.rect.right) -
            Math.max(rect.left, other.rect.left);
          const intersectionHeight = Math.min(rect.bottom, other.rect.bottom) -
            Math.max(rect.top, other.rect.top);
          if (intersectionWidth > 3 &&
              intersectionHeight > Math.max(4, Math.min(rect.height, other.rect.height) * 0.25)) {
            report('text_overlap', 'warning', parent,
              `文字与 ${describe(other.parent)} 可能重叠，请查看最终 PNG。`);
          }
        }
        bucket.push(i);
        grid.set(key, bucket);
      }
    }
  }
  if (stats.truncated || stats.droppedIssues) {
    // 保留一个状态项，即使普通问题达到数量上限，也明确指出不是完整检查。
    issues.push({code: 'inspection_limit', severity: 'warning', element: 'document',
      message: '内容或问题数量达到检查上限，部分内容未自动检查；请人工检查完整 PNG。'});
  }
  issues.push({code: 'manual_review_required', severity: 'info', element: 'document',
    message: 'DOM 检查不能代替图片审阅；请实际查看最终 PNG，核对中文、布局和数据快照。'});
  return {width, height, issues, stats};
}
"""
