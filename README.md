# Accountable

Accountable is a personal envelope-budgeting ledger that runs entirely in the browser. Each month you record your bank statements, paychecks and transactions. The app checks the month against each statement and flags anything that doesn't add up. You assign every dollar to an envelope.

There is no server. Your data is a single JSON file, saved either locally or to an `Accountable` folder in your Google Drive. Ledger data never belongs in this repository, and `.gitignore` blocks `.json` and `.csv` files to help prevent that.

## Running it

```sh
npm start        # same as: python3 -m http.server 8080
```

Then open http://localhost:8080. Google sign-in doesn't work from a `file://` URL. To save to Drive, the OAuth client ID in `js/gdrive.js` must list your site's address (origin) as an authorized JavaScript origin.

## Tests

```sh
npm test         # node --test, no dependencies
```

The tests in `tests/` cover the ledger math in `js/ledger.js`: balances, envelopes, statement reconciliation, file migration and CSV parsing. They use made-up data only.

## Layout

| Path | What it holds |
|---|---|
| `index.html` | Page markup: the tabs and the modals |
| `js/ledger.js` | Data model and all calculations. It doesn't touch the page, so Node can run it for the tests. |
| `js/app.js` | App state, loading and saving, shared UI helpers. Loaded last; it starts the app. |
| `js/summary.js`, `accounts.js`, `paychecks.js`, `statements.js`, `envelopes.js`, `transactions.js` | One file per tab |
| `js/import.js` | CSV and JSON import |
| `js/gdrive.js` | Google Drive sign-in, open and save |
| `css/styles.css` | Styles |
| `docs/data-format.md` | The JSON file format, the import formats and the reconciliation rules |

## Monthly workflow

1. Pick the month.
2. Add or import a **statement** for each account.
3. Import **transactions** and **paychecks**, then assign an envelope to each transaction.
4. Set **envelope** funding until the Budget Gap reaches $0.
5. Clear each orange dot on the tabs. Hovering over a tab lists what's still missing.
6. Save.

## Roadmap

- An import generator with merchant lookup. It would be a separate tool that turns bank exports into import CSVs, using your rules and past transactions.
- Charts: spending by envelope over time, and account balances over time.
- Previous year's data, for comparison. Each file covers one year; the next step is a "start next year" action that carries closing balances forward.
- Automatic envelope funding rules:
  - Fund to the average monthly spending over the previous N months.
  - Fund toward a target amount by a given month.
