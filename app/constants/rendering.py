"""rendering 领域常量的唯一定义。"""

MAX_SOURCE_BYTES = 2_000_000

MAX_OUTPUT_PIXELS = 50_000_000

MAX_LOGICAL_HEIGHT = 12_000

RENDER_ORIGIN = "https://render.invalid/"

CONTENT_SECURITY_POLICY = (
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; "
    "img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; "
    "object-src 'none'; base-uri 'none'; form-action 'none'; "
    "frame-ancestors 'none'"
)


INSTALL_HELP = (
    "Local rendering requires Playwright, Pillow and Chromium. "
    "Run: uv sync --extra rendering; uv run playwright install chromium. "
    "On Linux install Chromium system dependencies and fonts-noto-cjk "
    "(uv run playwright install --with-deps chromium)."
)


MAX_CONCURRENT_RENDERS = 2
RENDER_TIMEOUT_SECONDS = 60
RENDER_STOP_GRACE_SECONDS = 3
RENDER_PROCESS_REAP_SECONDS = 1


_IMAGE_FILES = frozenset({"image.png", "top.png", "middle.png", "bottom.png", "mobile.png"})


MAX_AS_OF_LENGTH = 200
MAX_SOURCES_LENGTH = 30
MAX_HTML_PATH_LENGTH = 4096
DEFAULT_LOGICAL_WIDTH = 800
MIN_LOGICAL_WIDTH = 360
MAX_LOGICAL_WIDTH = 1200
DEFAULT_SCALE = 3
MAX_SCALE = 4
