#!/usr/bin/env python3
from __future__ import annotations

from headless_runner.config import build_parser, load_config
from headless_runner.runner import run_experiment


def main() -> None:
    parser = build_parser()
    config = load_config(parser.parse_args())
    run_dir = run_experiment(config)
    print(f"Experiment artifacts written to: {run_dir}")


if __name__ == "__main__":
    main()

