#!/usr/bin/env python3
"""Contract conformance check for the Verdant engine contract.

Validates every schema under vN/ against JSON Schema Draft 2020-12, and every
*.example.json under vN/examples/ against the matching schema. This is the test
surface of the seam: if an example stops conforming, the contract changed.

This is a contract-level dev/CI check only — it commits nothing about the
application stack (the runtime bindings in TS/R/Python are a separate concern).

Usage:  python3 contracts/validate.py
Requires:  pip install jsonschema
Exit code: 0 if everything conforms, 1 otherwise.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator
except ImportError:
    sys.exit("error: this check needs 'jsonschema' (pip install jsonschema)")

ROOT = Path(__file__).resolve().parent

# Which schema each example file is validated against, by filename stem prefix.
SCHEMA_FOR = {
    "request": "analysis-request.schema.json",
    "bundle": "result-bundle.schema.json",
}


def schema_key(example_path: Path) -> str | None:
    name = example_path.name
    for key in SCHEMA_FOR:
        if key in name:
            return key
    return None


def main() -> int:
    failures = 0
    checked = 0

    for version_dir in sorted(p for p in ROOT.iterdir() if p.is_dir() and p.name.startswith("v")):
        # 1. Every schema must be a valid Draft 2020-12 schema.
        for schema_file in sorted(version_dir.glob("*.schema.json")):
            try:
                Draft202012Validator.check_schema(json.loads(schema_file.read_text()))
                print(f"VALID schema   {schema_file.relative_to(ROOT)}")
            except Exception as exc:  # noqa: BLE001 - report any meta-schema failure
                failures += 1
                print(f"FAIL  schema   {schema_file.relative_to(ROOT)}: {exc}")
            checked += 1

        # 2. Every example must conform to its matching schema.
        examples_dir = version_dir / "examples"
        for example_file in sorted(examples_dir.glob("*.example.json")) if examples_dir.is_dir() else []:
            key = schema_key(example_file)
            if key is None:
                failures += 1
                print(f"FAIL  example  {example_file.relative_to(ROOT)}: cannot map to a schema (name needs one of {list(SCHEMA_FOR)})")
                continue
            schema = json.loads((version_dir / SCHEMA_FOR[key]).read_text())
            doc = json.loads(example_file.read_text())
            errors = sorted(Draft202012Validator(schema).iter_errors(doc), key=lambda e: list(e.path))
            checked += 1
            if errors:
                failures += 1
                print(f"FAIL  example  {example_file.relative_to(ROOT)}")
                for err in errors:
                    loc = "/".join(map(str, err.path)) or "(root)"
                    print(f"    - at {loc}: {err.message}")
            else:
                print(f"VALID example  {example_file.relative_to(ROOT)} -> {SCHEMA_FOR[key]}")

    print(f"\n{checked} checked, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
