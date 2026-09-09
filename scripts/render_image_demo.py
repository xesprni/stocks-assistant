"""Render a reproducible Chinese report from one explicitly simulated snapshot."""

import argparse
import json
from html import escape

from app.core.tools.render_image import RenderImageTool


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workspace", required=True, help="Output workspace, e.g. /tmp/render-demo"
    )
    args = parser.parse_args()
    snapshot = {
        "as_of": "2026-09-09 · 固定演示快照",
        "sources": ["本地合成数据，仅用于验证排版与导出，不代表真实公司或行情。"],
        "data": {
            "unit": "万元",
            "quarters": ["一季度", "二季度", "三季度"],
            "revenue": [86, 104, 128],
        },
    }
    data = snapshot["data"]
    previous, latest = data["revenue"][-2:]
    growth = (latest / previous - 1) * 100
    bars = []
    for index, (label, value) in enumerate(zip(data["quarters"], data["revenue"], strict=True)):
        x, bar_height = 90 + index * 204, value * 2
        bars.append(
            f'<rect x="{x}" y="{340 - bar_height}" width="108" height="{bar_height}" '
            f'rx="8" fill="{["#b4c7ef", "#7599df", "#295fc2"][index]}"/>'
            f'<text x="{x + 54}" y="{324 - bar_height}" text-anchor="middle">{value}</text>'
            f'<text x="{x + 54}" y="383" text-anchor="middle">{escape(label)}</text>'
        )
    html = f"""
<style>
  body {{ background:#f0f3f8; color:#192942; }}
  h1 {{ margin:16px 0 24px; font-weight:750; }}
  h2 {{ margin:0 0 22px; }}
  .eyebrow {{ font-size:24px; color:#486189; letter-spacing:2px; margin:0; }}
  .lede {{ color:#486189; margin-bottom:32px; }}
  .card {{ padding:28px; margin-bottom:28px; background:white; border-radius:20px;
           border:1px solid #dce3ed; }}
  .metrics {{ display:grid; grid-template-columns:1fr 1fr; gap:24px; }}
  .metric {{ font-size:44px; line-height:1.3; font-weight:700; color:#295fc2; margin:8px 0; }}
  .muted {{ color:#5d6d83; font-size:26px; margin:0; }}
  .badge {{ display:inline-block; padding:6px 14px; border-radius:8px;
            font-size:24px; background:#e7eefc; color:#295fc2; }}
  svg {{ display:block; width:100%; }}
  svg text {{ font-size:28px; fill:#30435f; }}
  .source {{ padding:8px 4px; color:#596c83; }}
  .source p {{ margin-bottom:12px; }}
  li {{ margin-bottom:14px; }}
</style>
<p class="eyebrow">LOCAL REPORT / 本地制图示例</p>
<h1>季度经营观察</h1>
<p class="lede">一份数据快照，生成正文、指标与图表。</p>
<div class="card metrics">
  <div><p class="muted">三季度收入</p><p class="metric">{latest} 万元</p><p class="muted">固定演示数据</p></div>
  <div><p class="muted">环比变化</p><p class="metric">+{growth:.1f}%</p><p class="muted">相较二季度</p></div>
</div>
<section class="card">
  <h2>收入逐季变化</h2><p class="muted">单位：{data["unit"]} · 柱高从零起算</p>
  <svg viewBox="0 0 676 410" xmlns="http://www.w3.org/2000/svg" aria-label="三季度收入柱状图">
    <line x1="48" y1="340" x2="656" y2="340" stroke="#c9d4e3" stroke-width="2"/>
    <text x="24" y="350" text-anchor="middle">0</text>
    {"".join(bars)}
  </svg>
</section>
<section class="card">
  <h2>从图表回到数据</h2>
  <p>三季度收入为 {latest} 万元，较二季度的 {previous} 万元增加 {latest - previous} 万元，环比增长 {growth:.1f}%。</p>
  <p class="muted">上述数字和柱状图均由同一个 snapshot.data 生成，避免排版时混入其他时间的数据。</p>
</section>
<section class="card">
  <h2>阅读与导出检查</h2>
  <ul><li>原生 SVG 以 3 倍分辨率输出。</li><li>整图高度随正文自然展开。</li><li>最终 PNG 需检查中文、单位与完整性。</li></ul>
  <span class="badge">模拟数据 · 用于功能验证</span>
</section>
"""
    result = RenderImageTool(args.workspace).execute({"html": html, "snapshot": snapshot})
    print(
        json.dumps({"status": result.status, "result": result.result}, ensure_ascii=False, indent=2)
    )
    if result.status != "success":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
