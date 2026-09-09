"""Check deployment preflight without invoking system tools or touching a VPS."""

import os
import shlex
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def python_stub(path: Path, minor: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    code = f"import sys; sys.version_info = (3, {minor}, 0); exec(sys.stdin.read())"
    path.write_text("#!/bin/sh\nexec " + shlex.join([sys.executable, "-c", code]) + "\n")
    path.chmod(0o755)
    return path


def preflight(script: str, app_dir: Path, interpreter: Path) -> subprocess.CompletedProcess[str]:
    # 函数桩记录后续动作，确保检查失败时没有进入部署变更阶段。
    command = """source "$1"
ensure_python
printf 'PREFLIGHT_PASSED\\n'
"""
    return subprocess.run(
        ["bash", "-c", command, "preflight", str(SCRIPTS / script)],
        env={**os.environ, "APP_DIR": str(app_dir), "PYTHON_BIN": str(interpreter)},
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize("script", ["deploy_vps.sh", "update_vps.sh"])
@pytest.mark.parametrize("minor", [12, 14])
def test_supported_interpreter_passes(script: str, minor: int, tmp_path: Path) -> None:
    result = preflight(script, tmp_path, python_stub(tmp_path / "python", minor))
    assert result.returncode == 0, result.stderr
    assert "PREFLIGHT_PASSED" in result.stdout


@pytest.mark.parametrize("script", ["deploy_vps.sh", "update_vps.sh"])
@pytest.mark.parametrize("failure", ["old", "missing", "old_venv", "broken_venv"])
def test_invalid_interpreter_stops_preflight(script: str, failure: str, tmp_path: Path) -> None:
    interpreter = tmp_path / "python"
    if failure != "missing":
        python_stub(interpreter, 11 if failure == "old" else 12)
    if failure == "old_venv":
        python_stub(tmp_path / ".venv" / "bin" / "python", 11)
    elif failure == "broken_venv":
        (tmp_path / ".venv").mkdir()
    result = preflight(script, tmp_path, interpreter)
    assert result.returncode != 0
    assert "PREFLIGHT_PASSED" not in result.stdout
    assert "Python" in result.stderr


def test_update_checks_python_before_source_or_installation(tmp_path: Path) -> None:
    command = """source "$1"
need_root() { :; }
init_logging() { :; }
on_error() { exit 1; }
print_plan() { :; }
backup_database() { printf 'MUTATION\\n'; }
update_source() { printf 'MUTATION\\n'; }
install_backend_dependencies() { printf 'MUTATION\\n'; }
restart_service() { printf 'MUTATION\\n'; }
main
"""
    result = subprocess.run(
        ["bash", "-c", command, "preflight", str(SCRIPTS / "update_vps.sh")],
        env={
            **os.environ,
            "APP_DIR": str(tmp_path),
            "PYTHON_BIN": str(python_stub(tmp_path / "python", 11)),
        },
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "MUTATION" not in result.stdout
