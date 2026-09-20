# Elite opening book

- Source: official Lichess broadcast database
- Source license: Creative Commons CC0 1.0 (https://database.lichess.org/)
- License and downloads: https://database.lichess.org/
- Generated UTC: 2026-07-27T19:15:23.913829+00:00
- Generator: `backend/tools/generate_opening_book.py`
- Arguments: `--max-depth 20 --min-count 25`
- Opening-name source revision: https://github.com/lichess-org/chess-openings/commit/51a55d956b7ed0b9cd7853893744b1ca39cd2a05
- Artifact: `elite.bin`
- Input games: 179370
- Malformed input games skipped: 14
- Entries: 9748
SHA-256: `b87092c0325f5a8b2bd6d4560c4333920ce6a6faaf3af8520d4ca219195f831e`

## Pinned inputs

- [lichess_db_broadcast_2026-01.pgn.zst](https://database.lichess.org/broadcast/lichess_db_broadcast_2026-01.pgn.zst) — SHA-256 `9abf10d106a8bf5ecd41359825b3bf55c2f124c8a790a380cb98844c2cca5dca`
- [lichess_db_broadcast_2026-02.pgn.zst](https://database.lichess.org/broadcast/lichess_db_broadcast_2026-02.pgn.zst) — SHA-256 `ea977569917718b33940ba5379db2adad77d58876c29084294d357f15fe6a31b`
- [lichess_db_broadcast_2026-03.pgn.zst](https://database.lichess.org/broadcast/lichess_db_broadcast_2026-03.pgn.zst) — SHA-256 `1a5ad83fc9f440dcdadde17b11cc81a953f4895aaf8b8588470b3078209dc7fc`
- [lichess_db_broadcast_2026-04.pgn.zst](https://database.lichess.org/broadcast/lichess_db_broadcast_2026-04.pgn.zst) — SHA-256 `97b036f3a3639ae3be59c1508b1e18c76ac1b2e8fada4587d1b5c5a93c438d5d`
- [lichess_db_broadcast_2026-05.pgn.zst](https://database.lichess.org/broadcast/lichess_db_broadcast_2026-05.pgn.zst) — SHA-256 `d212987f7972a70268809ff6c726acff8bf0987161aacd7647b160f8564f6a53`
- [lichess_db_broadcast_2026-06.pgn.zst](https://database.lichess.org/broadcast/lichess_db_broadcast_2026-06.pgn.zst) — SHA-256 `65905d611c0d78d90ab57cd9edd3821f4119b46c22b5489fd7e265a74c6767b3`

Every record is a standard Polyglot `(key, move, weight, learn)` record. Weight
is continuation frequency in the pinned broadcast corpus capped at 65,535;
runtime uses membership, not weight. ECO/name data remains sourced from the
vendored CC0 TSV files.

`elite.bin` is derived database material. Lichess releases its database exports
under CC0, so the book carries no license terms beyond this provenance note.
