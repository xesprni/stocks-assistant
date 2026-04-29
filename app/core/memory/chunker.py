"""文本分块器

将长文本按 token 估算切分为多个重叠块，
用于记忆索引的粒度控制。

分块策略：
- 按行累积，超出 max_tokens 时切分
- 相邻块保留 overlap_tokens 的重叠内容
- 超长单行强制切分
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List


@dataclass
class TextChunk:
    """文本块"""
    text: str  # 块文本内容
    start_line: int  # 起始行号（从 1 开始）
    end_line: int  # 结束行号


class TextChunker:
    """文本分块器

    按 token 估算将长文本切分为重叠块。
    token 估算采用 chars_per_token=4 的简化比率。
    """

    def __init__(self, max_tokens: int = 500, overlap_tokens: int = 50):
        self.max_tokens = max_tokens  # 单块最大 token 数
        self.overlap_tokens = overlap_tokens  # 相邻块重叠 token 数
        self.chars_per_token = 4  # 字符/token 比率

    def chunk_text(self, text: str) -> List[TextChunk]:
        """将文本切分为多个重叠块"""
        if not text.strip():
            return []
        lines = text.split('\n')
        chunks = []
        max_chars = self.max_tokens * self.chars_per_token  # 单块最大字符数
        overlap_chars = self.overlap_tokens * self.chars_per_token  # 重叠字符数
        current_chunk = []
        current_chars = 0
        start_line = 1
        for i, line in enumerate(lines, start=1):
            line_chars = len(line)
            # 超长单行：强制切分
            if line_chars > max_chars:
                if current_chunk:
                    chunks.append(TextChunk(text='\n'.join(current_chunk), start_line=start_line, end_line=i - 1))
                    current_chunk, current_chars = [], 0
                for sub in self._split_long_line(line, max_chars):
                    chunks.append(TextChunk(text=sub, start_line=i, end_line=i))
                start_line = i + 1
                continue
            # 累积到当前块，超出时切分并保留重叠
            if current_chars + line_chars > max_chars and current_chunk:
                chunks.append(TextChunk(text='\n'.join(current_chunk), start_line=start_line, end_line=i - 1))
                overlap_lines = self._get_overlap(current_chunk, overlap_chars)
                current_chunk = overlap_lines + [line]
                current_chars = sum(len(l) for l in current_chunk)
                start_line = i - len(overlap_lines)
            else:
                current_chunk.append(line)
                current_chars += line_chars
        # 处理剩余内容
        if current_chunk:
            chunks.append(TextChunk(text='\n'.join(current_chunk), start_line=start_line, end_line=len(lines)))
        return chunks

    def _split_long_line(self, line: str, max_chars: int) -> List[str]:
        """强制切分超长单行"""
        return [line[i:i + max_chars] for i in range(0, len(line), max_chars)]

    def _get_overlap(self, lines: List[str], target_chars: int) -> List[str]:
        """从块末尾提取重叠行"""
        overlap, chars = [], 0
        for line in reversed(lines):
            if chars + len(line) > target_chars:
                break
            overlap.insert(0, line)
            chars += len(line)
        return overlap
