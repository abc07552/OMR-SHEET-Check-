"""The optional same-branch synthetic CI log viewer must not lose failure tails."""

import io
import json
import os
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote

import pytest
import yaml


def diagnostic_source():
    workflow = yaml.safe_load((Path(__file__).resolve().parents[2] / ".github/workflows/verify.yml").read_text())
    return workflow["jobs"]["diagnostics"]["steps"][0]["run"].split("<<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]


def execute(log, *, identifier="1234", branch="qa-branch", workflow="Synthetic QA", conclusion="failure"):
    calls = []

    def output(command, **kwargs):
        calls.append(command)
        if command[1] == "api":
            return json.dumps({"head_branch": branch, "name": workflow, "conclusion": conclusion})
        return log

    environment = {
        "DIAGNOSE_RUN": identifier,
        "GH_REPO": "synthetic/repo",
        "GITHUB_REF_NAME": "qa-branch",
        "GITHUB_WORKFLOW": "Synthetic QA",
    }
    stream = io.StringIO()
    with patch.dict(os.environ, environment), patch("subprocess.check_output", output), redirect_stdout(stream):
        exec(compile(diagnostic_source(), "synthetic-diagnostic", "exec"), {})
    return calls, stream.getvalue().splitlines()


def test_ci_diagnostic_compacts_prefixes_and_preserves_long_failure_tails():
    prefix = "Long synthetic regression job\tLengthy browser step\t2026-11-17T00:00:00Z "
    text = "\n".join(prefix + f"failure line {i}: " + "x" * 220 for i in range(100))
    text += "\n" + prefix + "FINAL ERROR: 50% confidence remains unverified."
    calls, annotations = execute(text)
    assert len(calls) == 2 and 1 < len(annotations) <= 9
    parts = [unquote(line.split("::", 2)[-1]) for line in annotations]
    assert all(len(part.encode()) <= 2810 for part in parts)
    combined = "".join(parts)
    assert "FINAL ERROR: 50% confidence remains unverified." in combined
    assert "Long synthetic regression job" not in combined
    assert "2026-11-17T00:00:00Z" not in combined


@pytest.mark.parametrize(
    "arguments",
    [
        {"identifier": "1234; echo unsafe"},
        {"branch": "unrelated-private-branch"},
        {"workflow": "Unrelated private workflow"},
        {"conclusion": "success"},
    ],
)
def test_ci_diagnostic_refuses_unrelated_or_invalid_runs(arguments):
    with pytest.raises(SystemExit):
        execute("Not permitted to read this log.", **arguments)
