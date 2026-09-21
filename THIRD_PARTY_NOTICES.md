# Third-party notices

Chess Review's own code is MIT (`LICENSE`) except `backend/`, which is GPLv3
(`backend/LICENSE`). The components below are included or depended on under
their own licenses. Not affiliated with or endorsed by Lichess.

## Stockfish (GPLv3)

- **Server engine.** `backend/Dockerfile` builds Stockfish from source at tag
  `sf_19`, commit `edb0d9db6731067ec50ce619ff372b463bc4dd5d`
  (https://github.com/official-stockfish/Stockfish; the build asserts the
  commit), and ships the binary plus its `Copying.txt` in the backend image.
  The backend drives it over UCI as a separate process.
- **Browser engine.** `frontend/public/engine/` vendors, unmodified, the
  `stockfish-19-lite.js` / `.wasm` files from the npm package
  `stockfish@19.0.0` (integrity
  `sha512-jDyYLbqNpboQcMs5HodTHI2CrKL74zkQWb1+sgoNXw5HI6avTblW4G0X7afFt3BBOc6VbTSkOV64EUxm/DWSpg==`),
  built from https://github.com/nmrugg/stockfish.js at commit
  `54fde71d90c7c403964f6cacef48f7bbec495df1`. That commit is the Corresponding
  Source, including the Emscripten build scripts; `stockfish.worker.js` is a
  byte-identical copy of the `.js` under the worker's entry name.
- The engine runs in a Web Worker and is driven purely by UCI text over
  `postMessage`, the same protocol boundary as the server process. We treat
  that as an arm's-length boundary, so the page's own code stays MIT. MIT is
  GPL-compatible, so nothing changes for you if you read the boundary
  differently.
- License text: `frontend/public/engine/COPYING.txt` (also `backend/LICENSE`).

## python-chess (GPLv3+)

`backend/` imports `chess` for board logic and engine I/O. This is why
`backend/` is GPLv3: a Python program importing a GPL module is a combined
work. https://github.com/niklasf/python-chess

## Opening data (Lichess, CC0)

- `backend/openings/*.tsv`, `eco.json.gz` — https://github.com/lichess-org/chess-openings.
- `backend/openings/elite.bin` — derived from the Lichess broadcast database
  (https://database.lichess.org/, exports released under CC0); provenance and
  pinned inputs in `backend/openings/ELITE_BOOK.md`.

## Chess piece graphics (BSD-3-Clause)

The board pieces are the **Cburnett** set by Colin M.L. Burnett, shipped as
`react-chessboard`'s default pieces and used under the BSD option of their
multi-license. Notice: `frontend/public/licenses/BSD-3-Clause-cburnett.txt`
(served at `/licenses/` by the deployed frontend).

## npm and PyPI dependencies

Everything else is MIT / ISC / BSD / Apache-2.0 / BlueOak-1.0.0 / PSF, plus
build-time only MPL-2.0 (lightningcss) and CC-BY-4.0 (caniuse-lite data).
Licenses ship inside the packages in `node_modules/` and the Python virtualenv.
No fonts or icon sets are bundled: the UI uses the system monospace stack and
hand-drawn classification glyphs.
