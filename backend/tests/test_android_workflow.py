"""Native CI must expose compiler failures, not just a later missing APK.

The tiny executable below exercises shell exit-code plumbing only. It is not a
mocked native-compilation result; the real compiler/JVM/lint run remains in CI.
"""

import io
import subprocess
from contextlib import redirect_stdout
from pathlib import Path
from urllib.parse import unquote

import yaml

ROOT = Path(__file__).resolve().parents[2]


def workflow_step(prefix):
    workflow = yaml.safe_load((ROOT / ".github/workflows/main.yml").read_text())
    return next(step for step in workflow["jobs"]["build"]["steps"] if step.get("name", "").startswith(prefix))


def compiler_step(tmp_path, status):
    android = tmp_path / "android"
    android.mkdir()
    executable = android / "gradlew"
    executable.write_text(f"#!/bin/sh\necho 'SYNTHETIC COMPILER EXIT {status}'\nexit {status}\n")
    executable.chmod(0o700)
    step = workflow_step("Compile APK")
    assert step["working-directory"] == "android"
    # Match the default implicit Actions bash invocation: the script itself must
    # preserve failure through tee, even without an implicit global pipefail.
    result = subprocess.run(["bash", "-e", "-c", step["run"]], cwd=android, capture_output=True, text=True)
    return result, tmp_path / ".cache/android/gradle.log"


def test_android_gradle_failure_survives_log_capture(tmp_path):
    result, log = compiler_step(tmp_path, 17)
    assert result.returncode == 17, "tee must never replace the compiler's nonzero exit code"
    assert "SYNTHETIC COMPILER EXIT 17" in log.read_text()


def test_android_gradle_success_retains_console_output(tmp_path):
    result, log = compiler_step(tmp_path, 0)
    assert result.returncode == 0
    assert "SYNTHETIC COMPILER EXIT 0" in log.read_text()


def annotations(tmp_path, monkeypatch, log):
    path = tmp_path / ".cache/android/gradle.log"
    path.parent.mkdir(parents=True)
    path.write_text(log)
    monkeypatch.chdir(tmp_path)
    source = workflow_step("Summarize native")["run"].split("<<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
    output = io.StringIO()
    with redirect_stdout(output):
        exec(compile(source, "android-ci-diagnostics", "exec"), {})
    return output.getvalue().splitlines()


def test_android_failure_annotation_preserves_cause_before_long_stacktrace(tmp_path, monkeypatch):
    cause = "Cannot invoke method toInteger() on null object"
    log = "FAILURE: Build failed with an exception.\n* What went wrong:\n" + cause + "\n* Try:\n"
    log += "\n".join("    at synthetic.StackFrame." + "x" * 120 for _ in range(500))
    log += "\nBUILD FAILED\n"
    combined = "".join(unquote(line.split("::", 2)[-1]) for line in annotations(tmp_path, monkeypatch, log))
    assert cause in combined
    assert "BUILD FAILED" in combined


def test_android_failure_annotation_bounds_percent_heavy_logs(tmp_path, monkeypatch):
    log = "* What went wrong:\n" + "\n".join("%" * 2000 for _ in range(35))
    lines = annotations(tmp_path, monkeypatch, log)
    assert lines
    assert all(len(line.encode()) < 4096 for line in lines)
    combined = "".join(unquote(line.split("::", 2)[-1]) for line in lines)
    assert "%" * 100 in combined
