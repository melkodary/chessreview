#!/usr/bin/env python3
"""Generate the precomputed ECO position index from the vendored Lichess TSVs.

`opening.py` needs a position_key -> (eco, name) map. Building it from the TSVs
means parsing 3,738 PGN lines and serializing a FEN per ply — ~1.5s, paid at
import by every process (API boot, pytest, explain_move, every lab script).
This freezes the finished map; loading it is ~6ms.

The TSVs stay the source of truth, and the build itself stays in `opening.py`
(it is also the runtime fallback), so the two cannot drift. The artifact embeds
a digest of the TSVs: editing one without regenerating is caught at import
(warn + rebuild) and by tests/test_opening.py.

    python -m tools.generate_eco_index
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import opening


def write_index(
    destination: Path, index: dict[str, tuple[str, str]], digest: str
) -> None:
    payload = json.dumps(
        {
            "version": opening._INDEX_VERSION,
            "sources_sha256": digest,
            "entries": [[key, eco, name] for key, (eco, name) in index.items()],
        },
        separators=(",", ":"),
    ).encode()
    # mtime=0: an unchanged rebuild produces identical bytes rather than a fresh
    # git blob.
    destination.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(opening.__file__).parent / "openings" / "eco.json.gz",
    )
    args = parser.parse_args()

    index = opening.build_index_from_tsv()
    digest = opening.sources_digest()
    write_index(args.output, index, digest)
    print(
        f"wrote {len(index):,} positions to {args.output} "
        f"({args.output.stat().st_size / 1024:.0f} KB, sources sha256 {digest[:16]}…)"
    )


if __name__ == "__main__":
    main()
