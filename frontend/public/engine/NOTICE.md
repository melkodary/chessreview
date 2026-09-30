This directory vendors, unmodified, the Stockfish.js 19 lite build (multi-
threaded WASM, embedded NNUE) from the npm package `stockfish@19.0.0`:
`stockfish-19-lite.js`, `stockfish-19-lite.wasm`, and `stockfish.worker.js` (a
byte-identical copy of the `.js`, kept as the worker entry name).

Stockfish is licensed under the **GNU GPLv3** (`COPYING.txt` in this
directory). Corresponding Source for these exact files, including the
Emscripten build: https://github.com/nmrugg/stockfish.js at commit
54fde71d90c7c403964f6cacef48f7bbec495df1 (npm integrity
sha512-jDyYLbqNpboQcMs5HodTHI2CrKL74zkQWb1+sgoNXw5HI6avTblW4G0X7afFt3BBOc6VbTSkOV64EUxm/DWSpg==).
Upstream engine: https://github.com/official-stockfish/Stockfish

This repository is also GPLv3 (`/LICENSE`). See `/THIRD_PARTY_NOTICES.md`.
