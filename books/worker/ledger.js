export const ACCOUNT_CODES = {
  BANK: "1000",
  STRIPE_CLEARING: "1050",
  ACCOUNTS_RECEIVABLE: "1100",
  ACCOUNTS_PAYABLE: "2000",
  SALES_TAX_PAYABLE: "2100",
  OWNER_EQUITY: "3000",
  SERVICE_REVENUE: "4000",
  SOFTWARE_EXPENSE: "6100",
  CONTRACTOR_EXPENSE: "6200",
  MERCHANT_FEES: "6300",
  GENERAL_EXPENSE: "6900",
};

export function assertBalanced(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error("A journal entry requires at least two lines.");
  }
  const debit = lines.reduce((sum, line) => sum + Number(line.debitCents || 0), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.creditCents || 0), 0);
  if (!Number.isInteger(debit) || !Number.isInteger(credit) || debit !== credit || debit <= 0) {
    throw new Error("Journal entry is not balanced.");
  }
  if (lines.some((line) => Number(line.debitCents || 0) < 0 || Number(line.creditCents || 0) < 0)) {
    throw new Error("Journal amounts cannot be negative.");
  }
  if (lines.some((line) => Boolean(line.debitCents) === Boolean(line.creditCents))) {
    throw new Error("Each journal line must contain either a debit or a credit.");
  }
  return { debitCents: debit, creditCents: credit };
}

export function invoiceJournal({ subtotalCents, taxCents = 0 }) {
  const total = subtotalCents + taxCents;
  const lines = [
    { code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debitCents: total, creditCents: 0 },
    { code: ACCOUNT_CODES.SERVICE_REVENUE, debitCents: 0, creditCents: subtotalCents },
  ];
  if (taxCents) lines.push({ code: ACCOUNT_CODES.SALES_TAX_PAYABLE, debitCents: 0, creditCents: taxCents });
  assertBalanced(lines);
  return lines;
}

export function customerPaymentJournal(amountCents) {
  const lines = [
    { code: ACCOUNT_CODES.STRIPE_CLEARING, debitCents: amountCents, creditCents: 0 },
    { code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debitCents: 0, creditCents: amountCents },
  ];
  assertBalanced(lines);
  return lines;
}

export function stripeFeeJournal(amountCents) {
  const lines = [
    { code: ACCOUNT_CODES.MERCHANT_FEES, debitCents: amountCents, creditCents: 0 },
    { code: ACCOUNT_CODES.STRIPE_CLEARING, debitCents: 0, creditCents: amountCents },
  ];
  assertBalanced(lines);
  return lines;
}

export function stripePayoutJournal(amountCents) {
  const lines = [
    { code: ACCOUNT_CODES.BANK, debitCents: amountCents, creditCents: 0 },
    { code: ACCOUNT_CODES.STRIPE_CLEARING, debitCents: 0, creditCents: amountCents },
  ];
  assertBalanced(lines);
  return lines;
}

export function paidExpenseJournal(amountCents, expenseCode = ACCOUNT_CODES.GENERAL_EXPENSE) {
  const lines = [
    { code: expenseCode, debitCents: amountCents, creditCents: 0 },
    { code: ACCOUNT_CODES.BANK, debitCents: 0, creditCents: amountCents },
  ];
  assertBalanced(lines);
  return lines;
}

export function billJournal(amountCents, expenseCode = ACCOUNT_CODES.GENERAL_EXPENSE) {
  const lines = [
    { code: expenseCode, debitCents: amountCents, creditCents: 0 },
    { code: ACCOUNT_CODES.ACCOUNTS_PAYABLE, debitCents: 0, creditCents: amountCents },
  ];
  assertBalanced(lines);
  return lines;
}

export function billPaymentJournal(amountCents) {
  const lines = [
    { code: ACCOUNT_CODES.ACCOUNTS_PAYABLE, debitCents: amountCents, creditCents: 0 },
    { code: ACCOUNT_CODES.BANK, debitCents: 0, creditCents: amountCents },
  ];
  assertBalanced(lines);
  return lines;
}

export function refundJournal(amountCents) {
  const lines = [
    { code: ACCOUNT_CODES.SERVICE_REVENUE, debitCents: amountCents, creditCents: 0 },
    { code: ACCOUNT_CODES.STRIPE_CLEARING, debitCents: 0, creditCents: amountCents },
  ];
  assertBalanced(lines);
  return lines;
}
