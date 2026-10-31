// ─── Ledger model ────────────────────────────────────────────────────────────
// Pure data logic: no DOM access, so it runs both in the browser (as the global
// `Ledger`) and under Node for tests (`require('./js/ledger.js')`).
// The file format is documented in docs/data-format.md.

(function (root) {
    const SCHEMA_VERSION = 2;
    const DEFAULT_COLOR = '#2D5F3F';
    const TRANSFER_ENVELOPE = 'Transfer';
    const EPSILON = 0.005;
    const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    function newId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    function emptyLedger(year) {
        return {
            schemaVersion: SCHEMA_VERSION,
            year: year || new Date().getFullYear(),
            accounts: [], transactions: [], envelopes: {}, statements: [], paychecks: [],
            fileName: null
        };
    }

    function roundCents(n) { return Math.round(n * 100) / 100; }
    function nearlyEqual(a, b) { return Math.abs(a - b) < EPSILON; }
    function sum(items, fn) { return items.reduce((s, x) => s + fn(x), 0); }

    // ── Dates ────────────────────────────────────────────────────────────────

    function monthFromDate(date) {
        const m = /^\d{4}-(\d{2})-\d{2}$/.exec(date || '');
        return m ? parseInt(m[1], 10) : null;
    }

    function yearFromDate(date) {
        const m = /^(\d{4})-\d{2}-\d{2}$/.exec(date || '');
        return m ? parseInt(m[1], 10) : null;
    }

    // First day of a month in the ledger's year, used when an entry has no date.
    function defaultDate(year, month) {
        return `${year}-${String(month).padStart(2, '0')}-01`;
    }

    // The most common year among dated entries, or the current year.
    function inferYear(data) {
        const counts = {};
        [...(data.transactions || []), ...(data.paychecks || []), ...(data.statements || [])].forEach(x => {
            const y = yearFromDate(x.date || x.endDate);
            if (y) counts[y] = (counts[y] || 0) + 1;
        });
        const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        return best ? parseInt(best, 10) : new Date().getFullYear();
    }

    // ── Migration ────────────────────────────────────────────────────────────
    // Every load (local file, Google Drive) goes through here so older files are
    // brought up to the current format in one place.

    function toMonth(value, date) {
        const m = parseInt(value, 10);
        if (m >= 1 && m <= 12) return m;
        return monthFromDate(date);
    }

    function toNumber(value) {
        const n = parseFloat(value);
        return isNaN(n) ? 0 : n;
    }

    function migrate(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Not a ledger file');
        const data = raw;
        if (data.schemaVersion > SCHEMA_VERSION) {
            throw new Error(`This file uses data format v${data.schemaVersion}, but this version of the app only understands up to v${SCHEMA_VERSION}.`);
        }

        ['accounts', 'transactions', 'statements', 'paychecks'].forEach(k => {
            if (!Array.isArray(data[k])) data[k] = [];
        });
        if (!data.envelopes || typeof data.envelopes !== 'object' || Array.isArray(data.envelopes)) data.envelopes = {};

        // v0: "categories" were renamed to envelopes, and transactions carried `category`.
        if (data.categories && typeof data.categories === 'object') {
            Object.entries(data.categories).forEach(([name, c]) => {
                if (!data.envelopes[name]) data.envelopes[name] = { color: (c && c.color) || DEFAULT_COLOR };
            });
            delete data.categories;
        }

        Object.values(data.envelopes).forEach(env => {
            if (!env.funding || typeof env.funding !== 'object') env.funding = {};
            if (env.necessary === undefined) env.necessary = false;
            env.openingBalance = toNumber(env.openingBalance);
            if (!env.color) env.color = DEFAULT_COLOR;
        });

        data.accounts.forEach(a => {
            if (!a.id) a.id = newId();
            a.initialBalance = toNumber(a.initialBalance);
        });

        data.transactions.forEach(t => {
            if (!t.id) t.id = newId();
            if (t.envelope === undefined && t.category !== undefined) { t.envelope = t.category; delete t.category; }
            if (t.envelope === undefined) t.envelope = '';
            t.amount = toNumber(t.amount);
            t.month = toMonth(t.month, t.date);
        });

        data.paychecks.forEach(p => {
            if (!p.id) p.id = newId();
            p.amount = toNumber(p.amount);
            p.month = toMonth(p.month, p.date);
        });

        data.statements.forEach(s => {
            if (!s.id) s.id = newId();
            s.month = toMonth(s.month, s.endDate);
            ['startBalance', 'endBalance', 'deposits', 'withdrawals'].forEach(k => s[k] = toNumber(s[k]));
        });

        if (!Number.isInteger(data.year)) data.year = inferYear(data);
        data.schemaVersion = SCHEMA_VERSION;
        return data;
    }

    // ── Accounts ─────────────────────────────────────────────────────────────

    // Balance of each account after all activity in months 1..throughMonth
    // (throughMonth 0 gives opening balances).
    // Positive paycheck entries are deposits. Deduction entries (negative) are
    // added back as positive because their linked transaction already withdraws
    // the same amount: a payroll deduction is spent from its envelope but never
    // passes through the account.
    function accountBalances(data, throughMonth) {
        const balances = {};
        data.accounts.forEach(a => balances[a.id] = a.initialBalance || 0);
        const has = id => Object.prototype.hasOwnProperty.call(balances, id);
        data.transactions.forEach(t => {
            if (t.month <= throughMonth && has(t.accountId)) balances[t.accountId] += t.amount;
        });
        data.paychecks.forEach(p => {
            if (p.month <= throughMonth && has(p.accountId)) balances[p.accountId] += Math.abs(p.amount);
        });
        return balances;
    }

    // Money that actually moved through an account in one month, as it would
    // appear on the bank statement: net paychecks and other credits in, spending
    // and transfers out. Payroll deductions never touch the account, so both the
    // deduction entry and its linked transaction are left out.
    function accountActivity(data, accountId, month) {
        const txs = data.transactions.filter(t => t.accountId === accountId && t.month === month && !t.paycheckManaged);
        const pays = data.paychecks.filter(p => p.accountId === accountId && p.month === month && p.amount > 0);
        const deposits = sum(pays, p => p.amount) + sum(txs.filter(t => t.amount > 0), t => t.amount);
        const withdrawals = sum(txs.filter(t => t.amount < 0), t => -t.amount);
        return { deposits: roundCents(deposits), withdrawals: roundCents(withdrawals) };
    }

    function netWorth(data, throughMonth) {
        const balances = accountBalances(data, throughMonth);
        let assets = 0, liabilities = 0;
        Object.values(balances).forEach(b => { if (b >= 0) assets += b; else liabilities -= b; });
        return { assets, liabilities, netWorth: assets - liabilities };
    }

    // ── Envelopes ────────────────────────────────────────────────────────────

    function envelopeNames(data) {
        return Object.keys(data.envelopes).filter(n => n !== TRANSFER_ENVELOPE);
    }

    // Funding for a month. A month without an explicit amount carries forward the
    // most recent earlier one; before any explicit amount it is 0.
    function envelopeFunding(data, name, month) {
        const env = data.envelopes[name];
        if (!env) return 0;
        const funding = env.funding || {};
        for (let m = month; m >= 1; m--) {
            if (funding[m] !== undefined && funding[m] !== null) return toNumber(funding[m]);
        }
        return 0;
    }

    // Net spending from an envelope in a month. A refund (a positive transaction
    // with the envelope set) puts money back, so it reduces the total.
    function envelopeWithdrawals(data, name, month) {
        return sum(data.transactions.filter(t => t.month === month && t.envelope === name), t => -t.amount);
    }

    // Running balance: the balance carried in from last year, plus funding minus
    // withdrawals for months 1..throughMonth.
    function envelopeBalance(data, name, throughMonth) {
        const env = data.envelopes[name];
        let total = env ? env.openingBalance || 0 : 0;
        for (let m = 1; m <= throughMonth; m++) {
            total += envelopeFunding(data, name, m) - envelopeWithdrawals(data, name, m);
        }
        return total;
    }

    // Money in accounts that no envelope accounts for. Zero means every dollar is
    // budgeted; negative means envelopes promise more than the accounts hold.
    function budgetGap(data, throughMonth) {
        const accounts = sum(Object.values(accountBalances(data, throughMonth)), b => b);
        const envelopes = sum(envelopeNames(data), n => envelopeBalance(data, n, throughMonth));
        return roundCents(accounts - envelopes);
    }

    function necessaryExpenses(data, month) {
        const necessary = new Set(envelopeNames(data).filter(n => data.envelopes[n].necessary));
        return sum(data.transactions.filter(t => t.month === month && necessary.has(t.envelope)), t => -t.amount);
    }

    // ── Statements ───────────────────────────────────────────────────────────

    function statementCheck(s) {
        const expected = s.startBalance + s.deposits - s.withdrawals;
        const diff = Math.abs(expected - s.endBalance);
        return { expected, diff, ok: diff < EPSILON };
    }

    function findStatement(data, accountId, month) {
        return data.statements.find(s => s.accountId === accountId && s.month === month) || null;
    }

    // ── Month status ─────────────────────────────────────────────────────────
    // What still needs doing before a month is reconciled, grouped by tab. Each
    // list is empty when that part of the month is complete.

    function accountName(data, id) {
        const a = data.accounts.find(x => x.id === id);
        return a ? a.name : 'Unknown account';
    }

    function money(n) { return '$' + roundCents(n).toFixed(2); }

    function monthStatus(data, month) {
        const status = { statements: [], paychecks: [], transactions: [], envelopes: [] };

        data.accounts.forEach(a => {
            const s = findStatement(data, a.id, month);
            if (!s) { status.statements.push(`${a.name}: no statement`); return; }
            if (!statementCheck(s).ok) status.statements.push(`${a.name}: statement doesn't add up`);
            const act = accountActivity(data, a.id, month);
            if (!nearlyEqual(act.deposits, s.deposits)) {
                status.paychecks.push(`${a.name}: deposits ${money(act.deposits)} vs statement ${money(s.deposits)}`);
            }
            if (!nearlyEqual(act.withdrawals, s.withdrawals)) {
                status.transactions.push(`${a.name}: withdrawals ${money(act.withdrawals)} vs statement ${money(s.withdrawals)}`);
            }
        });

        const income = data.paychecks.filter(p => p.month === month && p.amount > 0);
        const deductions = data.paychecks.filter(p => p.month === month && p.amount < 0);
        if (income.length) {
            const net = sum(income, p => p.amount);
            const gross = sum(income, p => p.gross || p.amount);
            const deducted = sum(deductions, p => -p.amount);
            if (!nearlyEqual(net, gross - deducted)) {
                status.paychecks.push(`Net pay ${money(net)} ≠ gross ${money(gross)} − deductions ${money(deducted)}`);
            }
        }

        const unassigned = data.transactions.filter(t => t.month === month && !t.envelope).length;
        if (unassigned) status.transactions.push(`${unassigned} transaction(s) without an envelope`);

        envelopeNames(data).forEach(n => {
            const b = envelopeBalance(data, n, month);
            if (b < -EPSILON) status.envelopes.push(`${n} is overspent by ${money(-b)}`);
        });
        const gap = budgetGap(data, month);
        if (envelopeNames(data).length && !nearlyEqual(gap, 0)) {
            status.envelopes.push(gap > 0 ? `${money(gap)} not assigned to an envelope` : `Envelopes exceed account balances by ${money(-gap)}`);
        }

        return status;
    }

    // ── CSV ──────────────────────────────────────────────────────────────────
    // RFC 4180: quoted fields may contain commas, quotes ("") and line breaks.
    // Returns { header: lowercased column names, rows: [{ column: value }] }.

    function parseCSV(text) {
        const records = [];
        let field = '', record = [], inQuotes = false;
        const src = text.replace(/^﻿/, '');
        for (let i = 0; i < src.length; i++) {
            const c = src[i];
            if (inQuotes) {
                if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
                else if (c === '"') inQuotes = false;
                else field += c;
            } else if (c === '"') inQuotes = true;
            else if (c === ',') { record.push(field); field = ''; }
            else if (c === '\n' || c === '\r') {
                if (c === '\r' && src[i + 1] === '\n') i++;
                record.push(field); records.push(record); field = ''; record = [];
            } else field += c;
        }
        if (field !== '' || record.length) { record.push(field); records.push(record); }

        const nonEmpty = records.filter(r => r.some(v => v.trim() !== ''));
        if (nonEmpty.length < 2) throw new Error('CSV file is empty or has no data rows');
        const header = nonEmpty[0].map(h => h.trim().toLowerCase());
        const rows = nonEmpty.slice(1).map(values => {
            const row = {};
            header.forEach((col, idx) => { row[col] = (values[idx] || '').trim(); });
            return row;
        });
        return { header, rows };
    }

    const Ledger = {
        SCHEMA_VERSION, DEFAULT_COLOR, TRANSFER_ENVELOPE, EPSILON, MONTHS,
        newId, emptyLedger, roundCents, nearlyEqual,
        monthFromDate, yearFromDate, defaultDate, inferYear, migrate,
        accountBalances, accountActivity, netWorth,
        envelopeNames, envelopeFunding, envelopeWithdrawals, envelopeBalance, budgetGap, necessaryExpenses,
        statementCheck, findStatement, monthStatus,
        parseCSV
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Ledger;
    else root.Ledger = Ledger;
})(typeof globalThis !== 'undefined' ? globalThis : this);
