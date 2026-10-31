const test = require('node:test');
const assert = require('node:assert/strict');
const Ledger = require('../js/ledger.js');

function sample() {
    return Ledger.migrate({
        year: 2026,
        accounts: [
            { id: 'chk', name: 'Checking', initialBalance: 1000 },
            { id: 'cc', name: 'Credit Card', initialBalance: -200 }
        ],
        envelopes: {
            Groceries: { color: '#336699', funding: { 1: 400 }, necessary: true },
            Fun: { color: '#993366', funding: { 1: 100, 3: 50 } },
            Insurance: { funding: { 1: 80 } },
            Transfer: {}
        },
        transactions: [
            { id: 't1', date: '2026-01-05', month: 1, accountId: 'chk', amount: -150, description: 'Store', envelope: 'Groceries' },
            { id: 't2', date: '2026-01-09', month: 1, accountId: 'cc', amount: -40, description: 'Movie', envelope: 'Fun' },
            { id: 't3a', date: '2026-01-20', month: 1, accountId: 'chk', amount: -200, description: 'Pay card (Transfer Out)', envelope: 'Transfer' },
            { id: 't3b', date: '2026-01-20', month: 1, accountId: 'cc', amount: 200, description: 'Pay card (Transfer In)', envelope: 'Transfer' },
            { id: 'paycheck-tx-d1', date: '2026-01-15', month: 1, accountId: 'chk', amount: -80, description: 'Paycheck deduction', envelope: 'Insurance', paycheckManaged: true },
            { id: 't4', date: '2026-02-03', month: 2, accountId: 'chk', amount: -500, description: 'Store', envelope: 'Groceries' }
        ],
        paychecks: [
            { id: 'p1', date: '2026-01-15', month: 1, accountId: 'chk', amount: 1920, gross: 2000, tithingType: 'tithing' },
            { id: 'd1', date: '2026-01-15', month: 1, accountId: 'chk', amount: -80, envelope: 'Insurance', linkedTransactionId: 'paycheck-tx-d1' },
            // A month with deposits but no transactions in it (used to be dropped from balances)
            { id: 'p3', date: '2026-03-15', month: 3, accountId: 'chk', amount: 1000, gross: 1000 }
        ],
        statements: [
            { id: 's1', accountId: 'chk', month: 1, startDate: '2026-01-01', endDate: '2026-01-31', startBalance: 1000, endBalance: 2570, deposits: 1920, withdrawals: 350 },
            { id: 's2', accountId: 'cc', month: 1, startDate: '2026-01-01', endDate: '2026-01-31', startBalance: -200, endBalance: -40, deposits: 200, withdrawals: 40 }
        ]
    });
}

test('migrate fills defaults and stamps the schema version', () => {
    const d = Ledger.migrate({ transactions: [{ date: '2024-05-02', amount: '-12.5', category: 'Food' }], categories: { Food: { color: '#123456' } } });
    assert.equal(d.schemaVersion, Ledger.SCHEMA_VERSION);
    assert.equal(d.year, 2024, 'year is inferred from dates');
    assert.deepEqual(d.statements, []);
    assert.deepEqual(d.paychecks, []);
    assert.equal(d.envelopes.Food.color, '#123456');
    assert.deepEqual(d.envelopes.Food.funding, {});
    assert.equal(d.envelopes.Food.necessary, false);
    assert.equal(d.categories, undefined);
    const t = d.transactions[0];
    assert.equal(t.envelope, 'Food');
    assert.equal(t.amount, -12.5);
    assert.equal(t.month, 5, 'month is derived from the date when missing');
    assert.ok(t.id);
});

test('migrate rejects files from a newer app version', () => {
    assert.throws(() => Ledger.migrate({ schemaVersion: 99 }), /data format v99/);
});

test('migrate keeps an explicit year', () => {
    assert.equal(Ledger.migrate({ year: 2019, transactions: [{ date: '2026-01-01', amount: 1 }] }).year, 2019);
});

test('account balances include paychecks in months without transactions', () => {
    const d = sample();
    // Jan: 1000 - 150 - 200 - 80 + 1920 + 80 = 2570
    assert.equal(Ledger.accountBalances(d, 1).chk, 2570);
    assert.equal(Ledger.accountBalances(d, 2).chk, 2070);
    assert.equal(Ledger.accountBalances(d, 3).chk, 3070);
    assert.equal(Ledger.accountBalances(d, 0).chk, 1000);
    assert.equal(Ledger.accountBalances(d, 1).cc, -40);
});

test('net worth splits assets and liabilities', () => {
    const nw = Ledger.netWorth(sample(), 1);
    assert.equal(nw.assets, 2570);
    assert.equal(nw.liabilities, 40);
    assert.equal(nw.netWorth, 2530);
});

test('account activity matches what a bank statement shows', () => {
    const d = sample();
    assert.deepEqual(Ledger.accountActivity(d, 'chk', 1), { deposits: 1920, withdrawals: 350 });
    assert.deepEqual(Ledger.accountActivity(d, 'cc', 1), { deposits: 200, withdrawals: 40 });
});

test('envelope funding carries forward from the last explicit month', () => {
    const d = sample();
    assert.equal(Ledger.envelopeFunding(d, 'Fun', 1), 100);
    assert.equal(Ledger.envelopeFunding(d, 'Fun', 2), 100);
    assert.equal(Ledger.envelopeFunding(d, 'Fun', 3), 50);
    assert.equal(Ledger.envelopeFunding(d, 'Fun', 12), 50);
    assert.equal(Ledger.envelopeFunding(d, 'Missing', 1), 0);
});

test('envelope balance is cumulative funding minus withdrawals', () => {
    const d = sample();
    assert.equal(Ledger.envelopeBalance(d, 'Groceries', 1), 250);
    assert.equal(Ledger.envelopeBalance(d, 'Groceries', 2), 150);
    assert.equal(Ledger.envelopeBalance(d, 'Insurance', 1), 0);
});

test('envelope opening balance carries last year into every month', () => {
    const d = sample();
    d.envelopes.Groceries.openingBalance = 75;
    assert.equal(Ledger.envelopeBalance(d, 'Groceries', 1), 325);
    assert.equal(Ledger.envelopeBalance(d, 'Groceries', 2), 225);
    assert.equal(Ledger.budgetGap(d, 1), 2145);
});

test('migrate defaults envelope opening balance to 0', () => {
    const d = Ledger.migrate({ envelopes: { A: {}, B: { openingBalance: '12.5' } } });
    assert.equal(d.envelopes.A.openingBalance, 0);
    assert.equal(d.envelopes.B.openingBalance, 12.5);
});

test('Transfer is not a budget envelope', () => {
    assert.deepEqual(Ledger.envelopeNames(sample()).sort(), ['Fun', 'Groceries', 'Insurance']);
});

test('budget gap is account balances minus envelope balances', () => {
    const d = sample();
    // Accounts 2570 - 40 = 2530; envelopes 250 + 60 + 0 = 310
    assert.equal(Ledger.budgetGap(d, 1), 2220);
});

test('necessary expenses count only necessary envelopes in the month', () => {
    assert.equal(Ledger.necessaryExpenses(sample(), 1), 150);
    assert.equal(Ledger.necessaryExpenses(sample(), 2), 500);
});

test('statement check verifies start + deposits - withdrawals = end', () => {
    assert.equal(Ledger.statementCheck({ startBalance: 100, deposits: 50, withdrawals: 30, endBalance: 120 }).ok, true);
    const bad = Ledger.statementCheck({ startBalance: 100, deposits: 50, withdrawals: 30, endBalance: 100 });
    assert.equal(bad.ok, false);
    assert.equal(bad.diff, 20);
});

test('month status reconciles against statements', () => {
    const d = sample();
    const s = Ledger.monthStatus(d, 1);
    assert.deepEqual(s.statements, []);
    assert.deepEqual(s.paychecks, []);
    assert.deepEqual(s.transactions, []);
    assert.equal(s.envelopes.length, 1, 'unbudgeted money is reported');
    assert.match(s.envelopes[0], /not assigned/);

    d.transactions.push({ id: 'x', month: 1, accountId: 'chk', amount: -10, envelope: '' });
    const s2 = Ledger.monthStatus(d, 1);
    assert.equal(s2.transactions.length, 2);
    assert.match(s2.transactions[0], /Checking: withdrawals \$360\.00 vs statement \$350\.00/);
    assert.match(s2.transactions[1], /1 transaction\(s\) without an envelope/);

    const feb = Ledger.monthStatus(d, 2);
    assert.deepEqual(feb.statements, ['Checking: no statement', 'Credit Card: no statement']);
});

test('month status flags overspent envelopes and paycheck mismatch', () => {
    const d = sample();
    d.paychecks[0].gross = 2100;
    d.envelopes.Groceries.funding[2] = 0;
    const s = Ledger.monthStatus(d, 2);
    assert.ok(s.envelopes.some(x => /Groceries is overspent by \$250\.00/.test(x)));
    assert.equal(Ledger.monthStatus(d, 1).paychecks.length, 1);
});

test('parseCSV handles quotes, commas, CRLF and blank lines', () => {
    const { header, rows } = Ledger.parseCSV('﻿Date,Account,Amount,Description\r\n2026-01-02,Checking,-5,"Coffee, large"\r\n\r\n2026-01-03,"Kid\'s ""Fund""",10,"two\nlines"\n');
    assert.deepEqual(header, ['date', 'account', 'amount', 'description']);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { date: '2026-01-02', account: 'Checking', amount: '-5', description: 'Coffee, large' });
    assert.equal(rows[1].account, 'Kid\'s "Fund"');
    assert.equal(rows[1].description, 'two\nlines');
});

test('parseCSV rejects files without data rows', () => {
    assert.throws(() => Ledger.parseCSV('date,amount\n'), /no data rows/);
});

test('defaultDate uses the ledger year', () => {
    assert.equal(Ledger.defaultDate(2025, 3), '2025-03-01');
});
