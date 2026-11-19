"""Record the installed, tested dependency closure without optional QA binaries.

Run after installing backend/requirements-dev.in in a clean CPython 3.11 venv.
Runtime and development inputs are deliberately separate from local PostgreSQL
QA binaries. Requirements markers are resolved for this interpreter/platform.
"""

from importlib.metadata import distributions
from pathlib import Path

from packaging.requirements import Requirement

root = Path(__file__).resolve().parent.parent
installed = {d.metadata["Name"].lower().replace("_", "-"): d for d in distributions()}


def resolve(file):
    roots = []
    for line in file.read_text().splitlines():
        line = line.strip()
        if line.startswith("-r "):
            roots.extend(resolve(file.parent / line[3:]))
        elif line and not line.startswith("#"):
            roots.append(Requirement(line))
    return roots


for name in ("requirements", "requirements-dev"):
    seen, expanded = set(), set()

    def add(requirement):
        key = requirement.name.lower().replace("_", "-")
        token = (key, tuple(sorted(requirement.extras)))
        if token in expanded:
            return
        expanded.add(token)
        if key not in installed:
            raise SystemExit(f"Install {key} before locking dependencies.")
        seen.add(key)
        for dependency in installed[key].requires or []:
            req = Requirement(dependency)
            if req.marker is None or any(req.marker.evaluate({"extra": extra}) for extra in {"", *requirement.extras}):
                add(req)

    for requirement in resolve(root / f"backend/{name}.in"):
        add(requirement)
    output = "# Tested CPython 3.11 dependency closure. Regenerate with scripts/lock-python.py.\n"
    output += "\n".join(f"{installed[key].metadata['Name']}=={installed[key].version}" for key in sorted(seen)) + "\n"
    (root / f"backend/{name}.lock").write_text(output)
