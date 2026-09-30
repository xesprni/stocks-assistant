"""
Memory flush manager with Deep Dream distillation.

Handles memory persistence when conversation context is trimmed or overflows:
- Uses LLM to summarize discarded messages into concise daily records
- Writes to daily memory files (lazy creation)
- Deduplicates trim flushes to avoid repeated writes
- Deep Dream: periodically distills daily memories -> refined MEMORY.md + dream diary
"""

import hashlib
import logging
import threading
import time as _time
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path

from app.constants.memory import (
    DREAM_SYSTEM_PROMPT as DREAM_SYSTEM_PROMPT,
)
from app.constants.memory import (
    DREAM_USER_PROMPT as DREAM_USER_PROMPT,
)
from app.constants.memory import (
    SUMMARIZE_SYSTEM_PROMPT as SUMMARIZE_SYSTEM_PROMPT,
)
from app.constants.memory import (
    SUMMARIZE_USER_PROMPT as SUMMARIZE_USER_PROMPT,
)
from app.schemas.memory import MemorySummaryStatus

logger = logging.getLogger("stocks-assistant.memory")


class MemoryFlushManager:
    """记忆刷新管理器

    在以下场景触发对话摘要写入每日记忆文件：
    1. 上下文裁剪：裁剪掉的旧轮次被摘要后写入
    2. 上下文溢出：API 返回 overflow 错误时紧急保存
    3. 每日总结：由调度器触发的定时总结

    Deep Dream 功能：定期将每日记忆蒸馏到 MEMORY.md 并生成梦境日记，
    实现长期记忆的自动整理和提炼。
    """

    def __init__(self, workspace_dir: Path, llm_provider=None):
        self.workspace_dir = workspace_dir
        self.llm_provider = llm_provider

        self.memory_dir = workspace_dir / "memory"
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        self.last_flush_timestamp: datetime | None = None
        self._trim_flushed_hashes: set = set()
        self._last_flushed_content_hash: str = ""
        self._last_dream_input_hash: str = ""
        self._last_flush_thread: threading.Thread | None = None

    def get_today_memory_file(
        self, user_id: str | None = None, ensure_exists: bool = False
    ) -> Path:
        today = datetime.now().strftime("%Y-%m-%d")
        if user_id:
            user_dir = self.memory_dir / "users" / user_id
            if ensure_exists:
                user_dir.mkdir(parents=True, exist_ok=True)
            today_file = user_dir / f"{today}.md"
        else:
            today_file = self.memory_dir / f"{today}.md"

        if ensure_exists and not today_file.exists():
            today_file.parent.mkdir(parents=True, exist_ok=True)
            today_file.write_text(f"# Daily Memory: {today}\n\n")
        return today_file

    def get_main_memory_file(self, user_id: str | None = None) -> Path:
        if user_id:
            user_dir = self.memory_dir / "users" / user_id
            user_dir.mkdir(parents=True, exist_ok=True)
            return user_dir / "MEMORY.md"
        return self.workspace_dir / "MEMORY.md"

    def get_status(self) -> MemorySummaryStatus:
        return MemorySummaryStatus(
            last_flush_time=self.last_flush_timestamp.isoformat()
            if self.last_flush_timestamp
            else None,
            today_file=str(self.get_today_memory_file()),
            main_file=str(self.get_main_memory_file()),
        )

    def flush_from_messages(
        self,
        messages: list[dict],
        user_id: str | None = None,
        reason: str = "trim",
        max_messages: int = 0,
        context_summary_callback: Callable[[str], None] | None = None,
    ) -> bool:
        try:
            deduped = []
            for m in messages:
                text = _extract_text_from_content(m.get("content", ""))
                if not text or not text.strip():
                    continue
                h = hashlib.md5(text.encode("utf-8")).hexdigest()
                if h not in self._trim_flushed_hashes:
                    self._trim_flushed_hashes.add(h)
                    deduped.append(m)
            if not deduped:
                return False

            import copy

            snapshot = copy.deepcopy(deduped)
            thread = threading.Thread(
                target=self._flush_worker,
                args=(snapshot, user_id, reason, max_messages, context_summary_callback),
                daemon=True,
            )
            thread.start()
            logger.info(
                "[MemoryFlush] Async flush dispatched (reason=%s, msgs=%s)", reason, len(snapshot)
            )
            self._last_flush_thread = thread
            return True
        except Exception as e:
            logger.warning("[MemoryFlush] Failed to dispatch flush (reason=%s): %s", reason, e)
            return False

    def _flush_worker(
        self,
        messages: list[dict],
        user_id: str | None,
        reason: str,
        max_messages: int,
        context_summary_callback: Callable[[str], None] | None = None,
    ):
        try:
            raw_summary = self._summarize_messages(messages, max_messages)
            if not raw_summary or not raw_summary.strip() or raw_summary.strip() == "无":
                logger.info("[MemoryFlush] No valuable content to flush (reason=%s)", reason)
                return

            daily_part = _clean_summary_output(raw_summary)
            if not daily_part:
                return

            daily_file = _ensure_daily_memory_file(self.workspace_dir, user_id)

            headers = {
                "overflow": f"## Context Overflow Recovery ({datetime.now().strftime('%H:%M')})",
                "trim": f"## Trimmed Context ({datetime.now().strftime('%H:%M')})",
                "daily_summary": f"## Daily Summary ({datetime.now().strftime('%H:%M')})",
            }
            header = headers.get(reason, f"## Session Notes ({datetime.now().strftime('%H:%M')})")

            with open(daily_file, "a", encoding="utf-8") as f:
                f.write(f"\n{header}\n\n{daily_part}\n")

            logger.info(
                "[MemoryFlush] Wrote daily memory to %s (reason=%s, chars=%s)",
                daily_file.name,
                reason,
                len(daily_part),
            )

            if context_summary_callback:
                try:
                    context_summary_callback(daily_part)
                except Exception as e:
                    logger.warning("[MemoryFlush] Context summary callback failed: %s", e)

            self.last_flush_timestamp = datetime.now()
        except Exception as e:
            logger.warning("[MemoryFlush] Async flush failed (reason=%s): %s", reason, e)

    def create_daily_summary(self, messages: list[dict], user_id: str | None = None) -> bool:
        content = "".join(_extract_text_from_content(m.get("content", "")) for m in messages)
        content_hash = hashlib.md5(content.encode("utf-8")).hexdigest()
        if content_hash == self._last_flushed_content_hash:
            logger.debug("[MemoryFlush] Daily summary skipped: no new content since last flush")
            return False
        self._last_flushed_content_hash = content_hash
        return self.flush_from_messages(
            messages=messages,
            user_id=user_id,
            reason="daily_summary",
            max_messages=0,
        )

    def deep_dream(
        self, user_id: str | None = None, lookback_days: int = 1, force: bool = False
    ) -> bool:
        if not self.llm_provider:
            logger.warning("[DeepDream] No LLM provider available, skipping")
            return False

        logger.info("[DeepDream] Starting memory distillation (lookback=%s days)", lookback_days)

        memory_content = self._read_main_memory(user_id)
        daily_content, has_content = self._read_recent_dailies(user_id, lookback_days)

        if not has_content:
            logger.info("[DeepDream] No recent daily records, skipping")
            return False

        daily_hash = hashlib.md5(daily_content.encode("utf-8")).hexdigest()
        today_str = datetime.now().strftime("%Y-%m-%d")
        dedup_key = f"{today_str}:{daily_hash}"
        if not force and dedup_key == self._last_dream_input_hash:
            logger.info("[DeepDream] Already dreamed today with same daily content, skipping")
            return False
        self._last_dream_input_hash = dedup_key

        logger.info(
            "[DeepDream] Materials: MEMORY.md=%s chars, daily=%s chars",
            len(memory_content),
            len(daily_content),
        )

        t0 = _time.monotonic()
        try:
            user_msg = DREAM_USER_PROMPT.format(
                memory_content=memory_content or "(empty)",
                days=lookback_days,
                daily_content=daily_content or "(no recent daily records)",
            )
            input_chars = len(memory_content) + len(daily_content)
            dream_max_tokens = max(2000, min(input_chars, 8000))

            from app.core.agent.models import LLMRequest

            request = LLMRequest(
                messages=[{"role": "user", "content": user_msg}],
                temperature=0.3,
                max_tokens=dream_max_tokens,
                stream=False,
                system=DREAM_SYSTEM_PROMPT,
            )
            response = self.llm_provider.call(request)
            raw = _extract_response_text(response)
            elapsed = _time.monotonic() - t0

            if not raw or not raw.strip():
                logger.warning("[DeepDream] LLM returned empty response (%ss)", f"{elapsed:.1f}")
                return False
            logger.info(
                "[DeepDream] LLM distillation completed (%ss, %s chars)", f"{elapsed:.1f}", len(raw)
            )
        except Exception as e:
            elapsed = _time.monotonic() - t0
            logger.warning("[DeepDream] LLM call failed (%ss): %s", f"{elapsed:.1f}", e)
            return False

        new_memory, dream_diary = _parse_dream_output(raw)
        if not new_memory:
            logger.warning("[DeepDream] No [MEMORY] section in LLM output, skipping")
            return False

        try:
            main_file = self.get_main_memory_file(user_id)
            old_size = len(memory_content)
            main_file.write_text(new_memory + "\n", encoding="utf-8")
            logger.info("[DeepDream] Updated MEMORY.md (%s -> %s chars)", old_size, len(new_memory))
        except Exception as e:
            logger.warning("[DeepDream] Failed to write MEMORY.md: %s", e)
            return False

        if dream_diary:
            try:
                self._write_dream_diary(dream_diary, user_id)
            except Exception as e:
                logger.warning("[DeepDream] Failed to write dream diary: %s", e)

        logger.info("[DeepDream] Deep Dream completed successfully")
        return True

    def _read_main_memory(self, user_id: str | None = None) -> str:
        main_file = self.get_main_memory_file(user_id)
        if main_file.exists():
            return main_file.read_text(encoding="utf-8").strip()
        return ""

    def _read_recent_dailies(self, user_id: str | None = None, lookback_days: int = 1) -> tuple:
        parts = []
        has_content = False
        today = datetime.now().date()

        for offset in range(lookback_days):
            day = today - timedelta(days=offset)
            date_str = day.strftime("%Y-%m-%d")
            if user_id:
                daily_file = self.memory_dir / "users" / user_id / f"{date_str}.md"
            else:
                daily_file = self.memory_dir / f"{date_str}.md"

            if daily_file.exists():
                content = daily_file.read_text(encoding="utf-8").strip()
                if content:
                    parts.append(f"### {date_str}\n\n{content}")
                    has_content = True
            else:
                parts.append(f"### {date_str}\n\n(no records)")

        return "\n\n".join(parts), has_content

    def _write_dream_diary(self, content: str, user_id: str | None = None):
        dreams_dir = self.memory_dir / "dreams"
        if user_id:
            dreams_dir = self.memory_dir / "users" / user_id / "dreams"
        dreams_dir.mkdir(parents=True, exist_ok=True)

        today = datetime.now().strftime("%Y-%m-%d")
        diary_file = dreams_dir / f"{today}.md"
        diary_file.write_text(f"# Dream Diary: {today}\n\n{content}\n", encoding="utf-8")
        logger.info("[DeepDream] Wrote dream diary to %s", diary_file)

    def _summarize_messages(self, messages: list[dict], max_messages: int = 0) -> str:
        conversation_text = _format_conversation_for_summary(messages, max_messages)
        if not conversation_text.strip():
            return ""

        if self.llm_provider:
            try:
                summary = self._call_llm_for_summary(conversation_text)
                if summary and summary.strip() and summary.strip() != "无":
                    return summary.strip()
                logger.info("[MemoryFlush] LLM returned empty or '无', skipping")
                return ""
            except Exception as e:
                logger.warning("[MemoryFlush] LLM summarization failed, using fallback: %s", e)
                return _extract_summary_fallback(messages, max_messages)
        else:
            logger.info("[MemoryFlush] No LLM provider, using rule-based fallback")
            return _extract_summary_fallback(messages, max_messages)

    def _call_llm_for_summary(self, conversation_text: str) -> str:
        from app.core.agent.models import LLMRequest

        request = LLMRequest(
            messages=[
                {
                    "role": "user",
                    "content": SUMMARIZE_USER_PROMPT.format(conversation=conversation_text),
                }
            ],
            temperature=0,
            max_tokens=500,
            stream=False,
            system=SUMMARIZE_SYSTEM_PROMPT,
        )
        response = self.llm_provider.call(request)
        return _extract_response_text(response)


def _clean_summary_output(raw: str) -> str:
    raw = raw.strip()
    if not raw or raw == "无":
        return ""
    if "[DAILY]" in raw:
        start = raw.index("[DAILY]") + len("[DAILY]")
        end = raw.index("[MEMORY]") if "[MEMORY]" in raw else len(raw)
        raw = raw[start:end].strip()
    if "[MEMORY]" in raw:
        raw = raw[: raw.index("[MEMORY]")].strip()
    raw = raw.replace("```", "").strip()
    return raw


def _parse_dream_output(raw: str) -> tuple:
    raw = raw.strip().replace("```", "")
    new_memory = ""
    dream_diary = ""
    if "[MEMORY]" in raw:
        start = raw.index("[MEMORY]") + len("[MEMORY]")
        end = raw.index("[DREAM]") if "[DREAM]" in raw else len(raw)
        new_memory = raw[start:end].strip()
    if "[DREAM]" in raw:
        start = raw.index("[DREAM]") + len("[DREAM]")
        dream_diary = raw[start:].strip()
    return new_memory, dream_diary


def _extract_response_text(response) -> str:
    if not response:
        return ""
    if isinstance(response, dict):
        if response.get("error"):
            raise RuntimeError(response.get("message", "LLM call failed"))
        content = response.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    return block.get("text", "")
        choices = response.get("choices", [])
        if choices:
            return choices[0].get("message", {}).get("content", "")
    if hasattr(response, "choices") and response.choices:
        return response.choices[0].message.content or ""
    return ""


def _extract_text_from_content(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts)
    return ""


def _format_conversation_for_summary(messages: list[dict], max_messages: int = 0) -> str:
    msgs = messages if max_messages == 0 else messages[-max_messages * 2 :]
    lines = []
    for msg in msgs:
        role = msg.get("role", "")
        text = _extract_text_from_content(msg.get("content", ""))
        if not text or not text.strip():
            continue
        text = text.strip()
        if role == "user":
            lines.append(f"用户: {text[:500]}")
        elif role == "assistant":
            lines.append(f"助手: {text[:500]}")
    return "\n".join(lines)


def _extract_first_meaningful_line(text: str, max_len: int = 120) -> str:
    import re

    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        if re.match(r"^(#{1,4}\s|```|---|\*\*\*|[-*]\s*$|[^\w一-鿿]{1,5}$)", line):
            continue
        cleaned = re.sub(r"^[\*#>\-\s]+", "", line).strip()
        cleaned = re.sub(r"^[\U0001f300-\U0001f9ff☀-➿\s]+", "", cleaned).strip()
        if len(cleaned) >= 5:
            return cleaned[:max_len]
    return text.split("\n")[0].strip()[:max_len]


def _extract_summary_fallback(messages: list[dict], max_messages: int = 0) -> str:
    msgs = messages if max_messages == 0 else messages[-max_messages * 2 :]
    events: list[str] = []
    current_user_text = ""
    for msg in msgs:
        role = msg.get("role", "")
        text = _extract_text_from_content(msg.get("content", ""))
        if not text or not text.strip():
            continue
        text = text.strip()
        if role == "user":
            if len(text) <= 3:
                continue
            current_user_text = text[:120]
        elif role == "assistant" and current_user_text:
            reply_summary = _extract_first_meaningful_line(text)
            if reply_summary:
                events.append(f"- 用户: {current_user_text} → 回复: {reply_summary}")
            else:
                events.append(f"- 用户: {current_user_text}")
            current_user_text = ""
    if current_user_text:
        events.append(f"- 用户: {current_user_text}")
    return "\n".join(events[:10])


def create_memory_files_if_needed(workspace_dir: Path, user_id: str | None = None):
    memory_dir = workspace_dir / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)

    if user_id:
        user_dir = memory_dir / "users" / user_id
        user_dir.mkdir(parents=True, exist_ok=True)
        main_memory = user_dir / "MEMORY.md"
    else:
        main_memory = workspace_dir / "MEMORY.md"

    if not main_memory.exists():
        main_memory.write_text("")


def _ensure_daily_memory_file(workspace_dir: Path, user_id: str | None = None) -> Path:
    memory_dir = workspace_dir / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)

    today = datetime.now().strftime("%Y-%m-%d")
    if user_id:
        user_dir = memory_dir / "users" / user_id
        user_dir.mkdir(parents=True, exist_ok=True)
        today_memory = user_dir / f"{today}.md"
    else:
        today_memory = memory_dir / f"{today}.md"

    if not today_memory.exists():
        today_memory.write_text(f"# Daily Memory: {today}\n\n")
    return today_memory
