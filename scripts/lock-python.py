"""Record the installed, tested CPython 3.11 closure with PyPI artifact hashes.

Install backend/requirements-dev.in in a clean venv before regenerating. Optional
local PostgreSQL QA binaries are intentionally excluded. No dependency versions
are upgraded here. Every selected distribution must satisfy its input/dependency
specifier. PyPI metadata is read over HTTPS; failure leaves both locks unchanged.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from importlib.metadata import distributions
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

from packaging.requirements import Requirement

ROOT = Path(__file__).resolve().parent.parent


def normalized(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def resolve(file):
    roots = []
    for line in file.read_text().splitlines():
        line = line.strip()
        if line.startswith("-r "):
            roots.extend(resolve(file.parent / line[3:]))
        elif line and not line.startswith("#"):
            roots.append(Requirement(line))
    return roots


def closure(file, installed):
    seen, expanded = set(), set()

    def add(requirement):
        key = normalized(requirement.name)
        if key not in installed:
            raise ValueError(f"Install {key} before locking dependencies.")
        version = installed[key].version
        if requirement.specifier and version not in requirement.specifier:
            raise ValueError(f"Installed {key}=={version} does not satisfy {requirement.specifier}.")
        token = (key, tuple(sorted(requirement.extras)))
        if token in expanded:
            return
        expanded.add(token)
        seen.add(key)
        for dependency in installed[key].requires or []:
            req = Requirement(dependency)
            if req.marker is None or any(req.marker.evaluate({"extra": extra}) for extra in {"", *requirement.extras}):
                add(req)

    for requirement in resolve(file):
        add(requirement)
    return seen


def artifact_hashes(distribution):
    name, version = distribution.metadata["Name"], distribution.version
    url = f"https://pypi.org/pypi/{quote(name, safe='')}/{quote(version, safe='')}/json"
    with urlopen(url, timeout=30) as response:
        metadata = json.load(response)
    if normalized(metadata["info"]["name"]) != normalized(name) or metadata["info"]["version"] != version:
        raise ValueError(f"Unexpected registry metadata for {name}=={version}.")
    hashes = {
        artifact.get("digests", {}).get("sha256", "")
        for artifact in metadata.get("urls", [])
        if not artifact.get("yanked") and artifact.get("packagetype") in {"bdist_wheel", "sdist"}
    }
    if not hashes or any(not re.fullmatch(r"[a-f0-9]{64}", digest) for digest in hashes):
        raise ValueError(f"No valid non-yanked SHA-256 artifacts for {name}=={version}.")
    # Include published platform wheels, not only the machine used to regenerate.
    # Deployment additionally uses --only-binary=:all: to avoid unpinned build deps.
    return sorted(hashes)


def main():
    installed = {normalized(d.metadata["Name"]): d for d in distributions()}
    closures = {name: closure(ROOT / f"backend/{name}.in", installed) for name in ("requirements", "requirements-dev")}
    packages = sorted(set.union(*closures.values()))
    with ThreadPoolExecutor(max_workers=6) as pool:
        hashes = dict(zip(packages, pool.map(lambda key: artifact_hashes(installed[key]), packages)))
    outputs = {}
    for name, names in closures.items():
        output = (
            "# Tested CPython 3.11 closure. Regenerate with scripts/lock-python.py.\n"
            "# SHA-256 hashes of published non-yanked PyPI artifacts; review updates.\n"
            "# Install with --require-hashes --only-binary=:all:.\n"
        )
        for key in sorted(names):
            dist = installed[key]
            output += f"{dist.metadata['Name']}=={dist.version} \\\n"
            output += " \\\n".join(f"    --hash=sha256:{digest}" for digest in hashes[key]) + "\n"
        outputs[ROOT / f"backend/{name}.lock"] = output
    # Complete registry reads/validation for BOTH closures before replacing either.
    for path, output in outputs.items():
        temporary = path.with_suffix(".lock.tmp")
        temporary.write_text(output)
        temporary.replace(path)
    print(f"Locked {len(packages)} installed distributions with verified-format PyPI artifact hashes.")


if __name__ == "__main__":
    main()
