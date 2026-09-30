# Third-party notices

Chess Review is licensed under the GNU GPLv3 (`LICENSE`). The components below
are included or depended on under their own licenses. Not affiliated with or
endorsed by Lichess.

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
- License text: `LICENSE` (copied beside the engine as
  `frontend/public/engine/COPYING.txt`).

## python-chess (GPLv3+)

`backend/` imports `chess` for board logic and engine I/O.
https://github.com/niklasf/python-chess

## Opening data (Lichess, CC0 and CC BY-SA 4.0)

- `backend/openings/*.tsv`, `eco.json.gz` — CC0 / public domain,
  https://github.com/lichess-org/chess-openings.
- `backend/openings/elite.bin` — derived from the Lichess broadcast database
  by Lichess and broadcast contributors (https://database.lichess.org/#broadcasts).
  The broadcasts and derived book are licensed under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  Attribution, transformation details, and pinned inputs are retained in
  `backend/openings/ELITE_BOOK.md`, which ships with the book in the backend image.
  This data license does not replace the application's code licenses.

## Chess piece graphics (BSD-3-Clause)

The board pieces are the **Cburnett** set by Colin M.L. Burnett, shipped as
`react-chessboard`'s default pieces and used under the BSD option of their
multi-license. Notice: `frontend/public/licenses/BSD-3-Clause-cburnett.txt`
(served at `/licenses/` by the deployed frontend).

## npm and PyPI dependencies

Everything else is MIT / ISC / BSD / Apache-2.0 / BlueOak-1.0.0 / PSF, plus
build-time only MPL-2.0 (lightningcss) and CC-BY-4.0 (caniuse-lite data).
The frontend build automatically collects production npm dependencies' copyright
notices and license texts into `dist/licenses/THIRD_PARTY.txt`, served at
`/licenses/THIRD_PARTY.txt` and included in the frontend Docker image. The
generator uses npm's installed production dependency tree, including transitive
code prebundled by upstream packages; there is no manually maintained dependency
list. Builds fail if a package has no license text. Vendored Stockfish and Cburnett
graphics retain the separate notices described above. Python dependency
licenses ship inside their installed packages in the backend image.
No fonts or icon sets are bundled: the UI uses the system monospace stack and
hand-drawn classification glyphs.
