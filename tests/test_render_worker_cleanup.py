"""制图超时的有限清理与错误信息边界。"""

import json
import signal
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.core.rendering import service, worker


@pytest.mark.skipif(service.os.name == "nt", reason="POSIX process group signal ordering")
def test_timeout_cleanup_signals_driver_then_kills_detached_descendants(monkeypatch):
    operations = []

    class ProcessError(Exception):
        pass

    class Node:
        def __init__(self, pid, children=()):
            self.pid = pid
            self.descendants = list(children)

        def create_time(self):
            return 1.0

        def children(self, recursive):
            assert recursive
            return self.descendants

        def kill(self):
            operations.append(("kill", self.pid))

    browser = Node(102)
    parent = Node(100, [browser])
    inspector = SimpleNamespace(Error=ProcessError, Process=lambda pid: parent, wait_procs=Mock())
    process = Mock(pid=100)
    process.communicate.side_effect = [
        subprocess.TimeoutExpired("render", 3),
        subprocess.TimeoutExpired("render", 3),
    ]
    monkeypatch.setattr(service.os, "killpg", lambda pid, sig: operations.append(("signal", sig)))
    service._stop_worker(process, inspector)
    assert operations[0] == ("signal", signal.SIGTERM)
    assert ("kill", browser.pid) in operations
    assert operations[-1] == ("signal", signal.SIGKILL)
    assert [call.kwargs for call in process.communicate.call_args_list] == [
        {"timeout": 3},
        {"timeout": 3},
    ]
    process.stdout.close.assert_called_once()
    process.stderr.close.assert_called_once()


def test_worker_timeout_uses_bounded_tree_cleanup(tmp_path, monkeypatch):
    pytest.importorskip("psutil")
    process = Mock()
    process.communicate.side_effect = subprocess.TimeoutExpired("render", 60)
    cleanup = Mock()
    monkeypatch.setattr(service.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(service, "_stop_worker", cleanup)
    with pytest.raises(RuntimeError, match="exceeded 60 seconds"):
        service._run_worker(tmp_path / "job.json")
    cleanup.assert_called_once()
    assert cleanup.call_args.args[0] is process
    process.communicate.assert_called_once_with(timeout=60)


def test_worker_error_omits_browser_logs_and_html(monkeypatch, capsys):
    def fail(path):
        raise RuntimeError("Browser rendering failed\nPRIVATE_BROWSER_LOG\n<secret-html>")

    monkeypatch.setattr(worker, "render", fail)
    monkeypatch.setattr(worker.sys, "argv", ["worker", "/tmp/job.json"])
    original_handler = signal.getsignal(signal.SIGTERM)
    with pytest.raises(SystemExit):
        worker.main()
    assert json.loads(capsys.readouterr().out) == {"error": "Browser rendering failed"}
    assert signal.getsignal(signal.SIGTERM) == original_handler
