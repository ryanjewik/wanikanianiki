"""Secrets from SSM Parameter Store, loaded into the environment on cold start.

`Settings` reads the environment and nothing else, which is what keeps it
identical under uvicorn and Lambda. So on Lambda the secrets are put *into* the
environment before `Settings` is first built, rather than `Settings` learning
to call AWS.

Why not plain Lambda environment variables: whatever sets those — Terraform
here — has to hold the values, so the WaniKani token would sit in plaintext in
Terraform state and in the function's console page. Parameter Store keeps it
encrypted at rest and readable only by the function's role; the infrastructure
only ever names the path.

Each parameter under `SSM_PARAMETER_PATH` becomes one variable, named after the
last path segment: `/kanji-workshop/wanikani_apikey` → `wanikani_apikey`. A
variable that is already set wins, so a value can still be overridden on the
function for a one-off without touching the store.
"""

from __future__ import annotations

import os


def load_into_environment() -> int:
    """Copy every parameter under the path into `os.environ`. Returns the count.

    A no-op when `SSM_PARAMETER_PATH` is unset, which is every environment but
    a deployed function.
    """
    path = os.environ.get("SSM_PARAMETER_PATH")
    if not path:
        return 0

    # Provided by the Lambda runtime; never imported when running locally.
    import boto3

    loaded = 0
    pages = (
        boto3.client("ssm")
        .get_paginator("get_parameters_by_path")
        .paginate(Path=path, WithDecryption=True, Recursive=False)
    )
    for page in pages:
        for parameter in page["Parameters"]:
            name = parameter["Name"].rsplit("/", 1)[-1]
            os.environ.setdefault(name, parameter["Value"])
            loaded += 1
    return loaded
