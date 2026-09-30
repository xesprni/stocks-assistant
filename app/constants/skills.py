"""skills 领域常量的唯一定义。"""

import re

CLAW_HUB_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")

MAX_ARCHIVE_BYTES = 50 * 1024 * 1024

MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024

SKILLS_CONFIG_FILE = "skills_config.json"


CLAW_HUB_TIMEOUT_SECONDS = 20.0
CLAW_HUB_SEARCH_LIMIT = 20
CLAW_HUB_MAX_SEARCH_LIMIT = 50


_KNOWN_NS = {"cowagent", "openclaw"}
