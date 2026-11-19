"""Dependency-lock generation is fail-closed; registry failures never erase locks."""

import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def locker():
    path = Path(__file__).resolve().parents[2] / "scripts/lock-python.py"
    spec = importlib.util.spec_from_file_location("omr_dependency_locker", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def distribution(name="sample", version="1.0", requires=None):
    return SimpleNamespace(metadata={"Name": name}, version=version, requires=requires or [])


def test_lock_refuses_installed_versions_outside_input_or_transitive_pin(locker, tmp_path):
    source = tmp_path / "requirements.in"
    source.write_text("sample==2.0\n")
    with pytest.raises(ValueError, match="does not satisfy"):
        locker.closure(source, {"sample": distribution()})
    source.write_text("sample==1.0\n")
    with pytest.raises(ValueError, match="does not satisfy"):
        locker.closure(
            source,
            {"sample": distribution(requires=["dependency>=2"]), "dependency": distribution("dependency", "1")},
        )


def test_lock_honors_extras_and_platform_markers(locker, tmp_path):
    source = tmp_path / "requirements.in"
    source.write_text("sample[fast]==1.0\n")
    installed = {
        "sample": distribution(requires=['speed>=2; extra == "fast"', 'unavailable; python_version < "1"']),
        "speed": distribution("speed", "2.0"),
    }
    assert locker.closure(source, installed) == {"sample", "speed"}


@pytest.mark.parametrize("version,digest", [("2.0", "a" * 64), ("1.0", "invalid-digest")])
def test_registry_identity_and_hash_validation(locker, monkeypatch, version, digest):
    payload = {
        "info": {"name": "sample", "version": version},
        "urls": [{"packagetype": "bdist_wheel", "digests": {"sha256": digest}}],
    }
    monkeypatch.setattr(locker, "urlopen", lambda *args, **kwargs: io.StringIO(json.dumps(payload)))
    with pytest.raises(ValueError):
        locker.artifact_hashes(distribution())


def test_lock_includes_platform_artifacts_but_not_yanked_or_duplicate_files(locker, monkeypatch):
    payload = {
        "info": {"name": "sample", "version": "1.0"},
        "urls": [
            {"packagetype": "bdist_wheel", "digests": {"sha256": "b" * 64}},
            {"packagetype": "sdist", "digests": {"sha256": "a" * 64}},
            {"packagetype": "bdist_wheel", "digests": {"sha256": "b" * 64}},
            {"packagetype": "bdist_wheel", "digests": {"sha256": "c" * 64}, "yanked": True},
        ],
    }
    monkeypatch.setattr(locker, "urlopen", lambda *args, **kwargs: io.StringIO(json.dumps(payload)))
    assert locker.artifact_hashes(distribution()) == ["a" * 64, "b" * 64]


def test_registry_failure_leaves_both_existing_locks_unchanged(locker, monkeypatch, tmp_path):
    backend = tmp_path / "backend"
    backend.mkdir()
    for name in ("requirements", "requirements-dev"):
        (backend / f"{name}.in").write_text("sample==1.0\n")
        (backend / f"{name}.lock").write_text("retained-lock\n")
    monkeypatch.setattr(locker, "ROOT", tmp_path)
    monkeypatch.setattr(locker, "distributions", lambda: [distribution()])

    def unavailable(*args):
        raise OSError("Synthetic registry outage")

    monkeypatch.setattr(locker, "artifact_hashes", unavailable)
    with pytest.raises(OSError, match="registry outage"):
        locker.main()
    assert all(
        (backend / f"{name}.lock").read_text() == "retained-lock\n" for name in ("requirements", "requirements-dev")
    )
    assert not list(backend.glob("*.tmp"))
