"""Build the Lambda deployment zip at `build/lambda.zip`.

    .venv/Scripts/python scripts/build_lambda.py

One zip serves every function; the repo-root `infra/` points each one at a
different handler in it.

**The wheels are Linux ones, whatever machine this runs on.** `asyncpg`,
`pydantic-core` and SQLAlchemy's C extension are compiled, and a zip built from
a Windows venv would carry Windows binaries that Lambda cannot load — the
function then fails on import with an error that names none of this. So pip is
asked for the Lambda platform explicitly, and binary wheels only, which also
means a dependency without a Linux wheel fails here rather than in AWS.

The dependency list is read from the installed package's own metadata, so
`pyproject.toml` stays the only place it is written down. Run this from the
venv the project is installed into (`pip install -e ".[dev]"`).
"""

from __future__ import annotations

import importlib.metadata
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
BUILD = BACKEND / "build"
STAGING = BUILD / "lambda"
ARTIFACT = BUILD / "lambda.zip"

# Must match `runtime` and `architectures` in infra/lambda.tf (repo root).
PYTHON_VERSION = "3.12"
PLATFORM = "manylinux2014_x86_64"

# Already in the Lambda Python runtime. Leaving them out takes roughly 20 MB
# off the zip, which keeps it under the 50 MB direct-upload limit.
PROVIDED_BY_RUNTIME = ("boto3", "botocore", "s3transfer", "jmespath")


def runtime_requirements() -> list[str]:
    declared = importlib.metadata.requires("kanji-workshop-api") or []
    # Extras (dev, aws) are marked `extra == "..."`; only the base set ships.
    return [r for r in declared if "extra ==" not in r]


def main() -> int:
    shutil.rmtree(STAGING, ignore_errors=True)
    ARTIFACT.unlink(missing_ok=True)
    STAGING.mkdir(parents=True)

    subprocess.run(
        [
            sys.executable, "-m", "pip", "install",
            "--quiet",
            "--target", str(STAGING),
            "--platform", PLATFORM,
            "--implementation", "cp",
            "--python-version", PYTHON_VERSION,
            "--only-binary=:all:",
            *runtime_requirements(),
        ],
        check=True,
    )

    for name in PROVIDED_BY_RUNTIME:
        shutil.rmtree(STAGING / name, ignore_errors=True)

    shutil.copytree(
        BACKEND / "app",
        STAGING / "app",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )

    with zipfile.ZipFile(ARTIFACT, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(STAGING.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                archive.write(path, path.relative_to(STAGING))

    size_mb = ARTIFACT.stat().st_size / 1_000_000
    print(f"{ARTIFACT.relative_to(BACKEND)}: {size_mb:.1f} MB")
    if size_mb > 50:
        print("Over the 50 MB direct-upload limit; upload it through S3 instead.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
