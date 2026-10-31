# Ledger data format (v2)

A ledger is a single JSON file that covers **one calendar year**. The app saves it locally or to the `Accountable` folder in Google Drive. Every file the app opens goes through `Ledger.migrate()` in `js/ledger.js`, which upgrades older files to this format. The migration only takes effect once the file is saved again.

All amounts are plain numbers in dollars. Months are integers from `1` to `12`. Dates are `YYYY-MM-DD` strings.

## Top level

```json
{
  "schemaVersion": 2,
  "year": 2026,
  "fileName": "data.json",
  "accounts": [],
  "transactions": [],
  "paychecks": [],
  "statements": [],
  "envelopes": {}
}
```

| Field | Meaning |
|---|---|
| `schemaVersion` | The format version. The app refuses to open files from a newer version than it understands. |
| `year` | The calendar year this file covers. Missing dates default to this year. Older files get it from the most common year among their dates. |
| `fileName` | The name the file was last opened or saved as. |

## accounts

```json
{ "id": "…", "name": "Everyday Checking", "initialBalance": 1250.00 }
```

`initialBalance` is the balance at the start of the year. A negative balance makes the account a liability, such as a credit card.

## transactions

```json
{
  "id": "…", "date": "2026-03-14", "month": 3, "accountId": "…",
  "amount": -42.17, "description": "Grocery store", "envelope": "Groceries"
}
```

- A negative `amount` is money leaving the account. A positive one is money coming in, such as a refund or a transfer in.
- `month` is the statement month the transaction counts toward. It usually matches the date's month, but it can differ when a statement period crosses a month boundary.
- `envelope` is the name of an envelope, `"Transfer"` for transfers between accounts, or `""` if no envelope has been assigned yet.
- A transfer is stored as a pair of transactions with ids `<id>-from` and `<id>-to`.
- `paycheckManaged: true` marks the transaction that a payroll deduction creates (see paychecks below). Edit it through its paycheck entry.

## paychecks

Take-home pay (a positive `amount`):

```json
{ "id": "…", "date": "2026-03-15", "month": 3, "accountId": "…", "amount": 2140.55, "gross": 2900.00, "tithingType": "tithing" }
```

Payroll deduction (a negative `amount`):

```json
{ "id": "…", "date": "2026-03-15", "month": 3, "accountId": "…", "amount": -180.00, "envelope": "Health Insurance", "linkedTransactionId": "paycheck-tx-…" }
```

`tithingType` is either `"tithing"` or `"non-tithing"`.

A deduction is spent from its envelope but never passes through the account. Here is how that's recorded:

1. The deduction gets a linked transaction (`paycheckManaged: true`) for the same negative amount. That spends it from the envelope.
2. Account balances add the deduction back as a positive amount. As a result, the account balance is unchanged overall.

For each month, the paycheck check expects net pay to equal gross pay minus all deductions.

## statements

There is one statement per account per month:

```json
{
  "id": "…", "accountId": "…", "month": 3,
  "startDate": "2026-03-01", "endDate": "2026-03-31",
  "startBalance": 1250.00, "endBalance": 1388.20, "deposits": 2140.55, "withdrawals": 2002.35
}
```

A statement is reconciled when both of these hold:

1. `startBalance + deposits − withdrawals = endBalance`.
2. The ledger's activity for that account and month matches the statement. Deposits are positive paycheck entries plus positive transactions. Withdrawals are negative transactions, not counting payroll deductions.

## envelopes

This is an object keyed by envelope name:

```json
{
  "Groceries": { "color": "#2D5F3F", "necessary": true, "openingBalance": 120.40, "funding": { "1": 600, "6": 650 } }
}
```

- `funding` holds the amount added to the envelope in each month. A month with no entry repeats the most recent earlier amount. In the example above, months 1–5 are funded with 600 and months 6–12 with 650.
- `openingBalance` is what the envelope held at the end of the previous year's file, and it defaults to 0. Starting a new year this way means January funding is only that month's allocation.
- An envelope's balance is its opening balance plus all funding so far, minus all withdrawals so far, through the selected month.
- Withdrawals are net: a refund (a positive transaction with the envelope set) puts its amount back into the envelope. The same goes for "Necessary Expenses".
- `necessary` envelopes count toward the "Necessary Expenses" figure on the Summary tab.
- `"Transfer"` is reserved and isn't a budget envelope.

## Month status

`Ledger.monthStatus(data, month)` lists what is still missing for a month. Each tab shows an orange dot until its list is empty, and the tab's tooltip lists the items.

| Tab | Complete when |
|---|---|
| Statements | Every account has a statement for the month, and each statement adds up. |
| Paychecks | Deposits match each statement, and net pay equals gross minus deductions. |
| Transactions | Withdrawals match each statement, and every transaction has an envelope. |
| Envelopes | No envelope is overspent, and the Budget Gap is $0. |

The **Budget Gap** is the total of all account balances minus the total of all envelope balances. When it is positive, some money hasn't been assigned to an envelope. When it is negative, the envelopes hold more than the accounts do.

## Import formats

Each tab's **Import** button accepts a CSV or JSON file. You can also paste the text directly onto the tab. A JSON import can be a full ledger file, in which case only the matching section is imported, or just the array or object for that tab. Accounts and envelopes that don't exist yet are created automatically.

| Tab | Required CSV columns | Optional CSV columns |
|---|---|---|
| Transactions | `date, account, amount, description` | `envelope, month` |
| Paychecks | `month, account, amount` | `date, gross, tithing_type, envelope` (an envelope is required for deductions) |
| Statements | `account, month, start_balance, end_balance, deposits, withdrawals` | `start_date, end_date` |
| Envelopes | `name` | `color, necessary, opening_balance, funding_1` … `funding_12` |

JSON items use the field names from the sections above. In JSON, an account can be given either as `account` (its name) or as `accountId`.

A transaction is skipped on import if one with the same date, account, amount and description is already in the ledger. That means importing the same statement twice won't create duplicates.
