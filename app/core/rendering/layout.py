"""本地制图的排版基线与有界 DOM 检查；检查结果不能替代最终图片审阅。"""

from app.constants.rendering_layout import (
    CROWDING_FIX_ORDER as CROWDING_FIX_ORDER,
)
from app.constants.rendering_layout import (
    DEFAULT_CSS as DEFAULT_CSS,
)
from app.constants.rendering_layout import (
    LAYOUT_AUDIT_JS as LAYOUT_AUDIT_JS,
)
from app.constants.rendering_layout import (
    VISUAL_CHECKLIST as VISUAL_CHECKLIST,
)


# 文本矩形使用空间网格与总比较预算，避免长报告触发两两比较的平方级开销。
# 几何检查仅报告可疑点；字形覆盖、阅读层级及数据一致性必须从最终 PNG 和数据核验。
