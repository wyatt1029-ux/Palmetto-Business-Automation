import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const money = (value = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
    .format(Number(value) / 100);
const shortDate = (value) => value
  ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(`${String(value).slice(0, 10)}T12:00:00`))
  : "—";
const today = new Date().toISOString().slice(0, 10);
const yearStart = `${new Date().getFullYear()}-01-01`;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload.error || payload || "The request failed.");
  return payload;
}

function useResource(path, initialValue) {
  const [data, setData] = useState(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api(path));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [path]);
  return { data, loading, error, reload: load, setData };
}

const navigation = [
  { id: "dashboard", label: "Overview", mark: "OV" },
  { id: "transactions", label: "Transactions", mark: "TX" },
  { id: "sales", label: "Sales & invoices", mark: "AR" },
  { id: "expenses", label: "Expenses & bills", mark: "AP" },
  { id: "reports", label: "Reports", mark: "RP" },
  { id: "settings", label: "Settings", mark: "ST" },
];

function Status({ children, tone = "neutral" }) {
  return <span className={`status status-${tone}`}>{String(children || "unknown").replaceAll("_", " ")}</span>;
}

function Notice({ message, onClose, tone = "success" }) {
  if (!message) return null;
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss message">×</button>
    </div>
  );
}

function Empty({ title, copy, action }) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">PBA</span>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

function LoadingRows() {
  return <div className="loading-lines" aria-label="Loading"><span /><span /><span /></div>;
}

function PageHeader({ eyebrow, title, copy, actions }) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {copy && <p className="page-copy">{copy}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

function Modal({ open, title, copy, children, onClose }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header>
          <div>
            <p className="eyebrow">PBA Books</p>
            <h2 id="modal-title">{title}</h2>
            {copy && <p>{copy}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Dashboard({ setView }) {
  const resource = useResource("/api/dashboard", { summary: {}, recentTransactions: [] });
  const { summary = {}, overdueInvoices = {}, overdueBills = {}, recentTransactions = [], unreviewedCount = 0 } = resource.data;
  const net = Number(summary.revenue_cents || 0) - Number(summary.expense_cents || 0);
  return (
    <>
      <PageHeader
        eyebrow="Owner workspace"
        title="Your books, without the busywork."
        copy="A live view of cash, earned revenue, expenses, and the items that need your review."
        actions={<button className="button button-primary" onClick={() => setView("transactions")}>Review transactions</button>}
      />
      {resource.error && <Notice message={resource.error} tone="error" onClose={() => {}} />}
      <section className="metric-grid">
        <article className="metric metric-feature">
          <div className="metric-top"><span>Cash position</span><small>ledger balance</small></div>
          <strong>{money(summary.cash_cents)}</strong>
          <p>Operating bank balance recorded in PBA Books.</p>
        </article>
        <article className="metric">
          <div className="metric-top"><span>Revenue</span><small>year to date</small></div>
          <strong>{money(summary.revenue_cents)}</strong>
          <p>Posted service revenue.</p>
        </article>
        <article className="metric">
          <div className="metric-top"><span>Expenses</span><small>year to date</small></div>
          <strong>{money(summary.expense_cents)}</strong>
          <p>Posted operating expenses.</p>
        </article>
        <article className="metric">
          <div className="metric-top"><span>Net income</span><small>year to date</small></div>
          <strong className={net < 0 ? "negative" : ""}>{money(net)}</strong>
          <p>Revenue less expenses.</p>
        </article>
      </section>

      <section className="attention-grid">
        <button className="attention-card" onClick={() => setView("transactions")}>
          <span className="attention-number">{unreviewedCount}</span>
          <span><strong>Bank items to review</strong><small>Categorize, match, or exclude</small></span>
          <b>→</b>
        </button>
        <button className="attention-card" onClick={() => setView("sales")}>
          <span className="attention-number">{overdueInvoices.count || 0}</span>
          <span><strong>Overdue invoices</strong><small>{money(overdueInvoices.cents)} outstanding</small></span>
          <b>→</b>
        </button>
        <button className="attention-card" onClick={() => setView("expenses")}>
          <span className="attention-number">{overdueBills.count || 0}</span>
          <span><strong>Vendor bills due</strong><small>{money(overdueBills.cents)} outstanding</small></span>
          <b>→</b>
        </button>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Bank activity</p><h2>Recent transactions</h2></div>
          <button className="text-button" onClick={() => setView("transactions")}>View all →</button>
        </div>
        {resource.loading ? <LoadingRows /> : recentTransactions.length ? (
          <div className="transaction-list">
            {recentTransactions.map((item) => (
              <article key={item.id}>
                <span className={`transaction-symbol ${Number(item.amount_cents) >= 0 ? "incoming" : ""}`}>
                  {Number(item.amount_cents) >= 0 ? "+" : "−"}
                </span>
                <div><strong>{item.description}</strong><small>{shortDate(item.transaction_date)}</small></div>
                <Status tone={item.status === "unreviewed" ? "warn" : "good"}>{item.status}</Status>
                <b className={Number(item.amount_cents) < 0 ? "negative" : ""}>{money(item.amount_cents)}</b>
              </article>
            ))}
          </div>
        ) : <Empty title="No bank activity yet" copy="Connect a bank account or import a statement to begin reviewing transactions." />}
      </section>
    </>
  );
}

function Transactions({ accounts, expenseAccounts }) {
  const transactions = useResource("/api/bank/transactions?status=all", { transactions: [] });
  const [modal, setModal] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [working, setWorking] = useState(false);

  const connect = async () => {
    setWorking(true); setError("");
    try {
      const [connection, config] = await Promise.all([api("/api/bank/connect", { method: "POST" }), api("/api/config")]);
      if (!window.Stripe || !config.stripePublishableKey) throw new Error("Stripe.js or the Stripe publishable key is not configured.");
      const stripe = window.Stripe(config.stripePublishableKey);
      const result = await stripe.collectFinancialConnectionsAccounts({ clientSecret: connection.clientSecret });
      if (result.error) throw new Error(result.error.message);
      await api("/api/bank/complete", {
        method: "POST",
        body: JSON.stringify({ sessionId: connection.id }),
      });
      setNotice("Bank account connected securely.");
      setModal("");
      window.location.reload();
    } catch (requestError) {
      setError(requestError.message);
    } finally { setWorking(false); }
  };

  const importFile = async (event) => {
    event.preventDefault();
    setWorking(true); setError("");
    try {
      const form = new FormData(event.currentTarget);
      const file = form.get("statement");
      const result = await api("/api/bank/import", {
        method: "POST",
        body: JSON.stringify({
          financialAccountId: form.get("financialAccountId"),
          filename: file.name,
          csv: await file.text(),
        }),
      });
      setNotice(`Imported ${result.imported} transactions; skipped ${result.duplicates} duplicates.`);
      setModal("");
      transactions.reload();
    } catch (requestError) { setError(requestError.message); }
    finally { setWorking(false); }
  };

  const categorize = async (event) => {
    event.preventDefault();
    setWorking(true); setError("");
    try {
      const form = new FormData(event.currentTarget);
      await api(`/api/bank/transactions/${selected.id}/categorize`, {
        method: "POST",
        body: JSON.stringify({
          expenseAccountId: form.get("expenseAccountId"),
          description: form.get("description"),
        }),
      });
      setNotice("Transaction categorized and posted to the ledger.");
      setSelected(null); setModal(""); transactions.reload();
    } catch (requestError) { setError(requestError.message); }
    finally { setWorking(false); }
  };

  return (
    <>
      <PageHeader
        eyebrow="Banking"
        title="Review every dollar once."
        copy="Bank activity stays unposted until you categorize or match it, so the ledger remains intentional."
        actions={<>
          <button className="button button-secondary" onClick={() => setModal("import")}>Import CSV</button>
          <button className="button button-primary" onClick={() => setModal("connect")}>Connect bank</button>
        </>}
      />
      <Notice message={notice} onClose={() => setNotice("")} />
      {transactions.error && <Notice message={transactions.error} tone="error" onClose={() => {}} />}
      <section className="account-strip">
        {accounts.length ? accounts.map((account) => (
          <article key={account.id}>
            <span className="account-icon">BA</span>
            <div><strong>{account.display_name}</strong><small>{account.institution_name || account.provider} ···· {account.last4 || "—"}</small></div>
            <b>{money(account.current_balance_cents)}</b>
          </article>
        )) : (
          <article className="account-empty">
            <span className="account-icon">+</span>
            <div><strong>No account connected</strong><small>Stripe Financial Connections or CSV</small></div>
          </article>
        )}
      </section>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Transaction feed</p><h2>Bank activity</h2></div>
          <button className="text-button" onClick={async () => {
            setWorking(true);
            try { const result = await api("/api/bank/sync", { method: "POST" }); setNotice(`Bank sync complete: ${result.imported} new transactions.`); transactions.reload(); }
            catch (requestError) { setError(requestError.message); }
            finally { setWorking(false); }
          }}>{working ? "Syncing…" : "Sync now"}</button>
        </div>
        {transactions.loading ? <LoadingRows /> : transactions.data.transactions.length ? (
          <div className="data-table" role="table" aria-label="Bank transactions">
            <div className="table-row table-head" role="row">
              <span>Date</span><span>Description</span><span>Account</span><span>Status</span><span>Amount</span><span />
            </div>
            {transactions.data.transactions.map((item) => (
              <div className="table-row" role="row" key={item.id}>
                <span data-label="Date">{shortDate(item.transaction_date)}</span>
                <strong data-label="Description">{item.description}</strong>
                <span data-label="Account">{item.account_name}</span>
                <span data-label="Status"><Status tone={item.status === "unreviewed" ? "warn" : "good"}>{item.status}</Status></span>
                <b data-label="Amount" className={Number(item.amount_cents) < 0 ? "negative" : "positive"}>{money(item.amount_cents)}</b>
                <span>
                  {item.status === "unreviewed" && Number(item.amount_cents) < 0
                    ? <button className="mini-button" onClick={() => { setSelected(item); setModal("categorize"); }}>Categorize</button>
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        ) : <Empty title="Your feed is ready" copy="Connect an account or import a CSV statement to bring in transactions." />}
      </section>
      <Modal open={modal === "connect"} title="Connect PBA’s bank" copy="Stripe will open a secure bank authorization window. PBA Books receives balances and transaction history, never your bank password." onClose={() => setModal("")}>
        <Notice message={error} tone="error" onClose={() => setError("")} />
        <div className="trust-box"><strong>Permissions requested</strong><span>Balances and transactions only</span><small>Vendor payments are not enabled.</small></div>
        <button className="button button-primary button-full" onClick={connect} disabled={working}>{working ? "Opening secure connection…" : "Continue with Stripe"}</button>
      </Modal>
      <Modal open={modal === "import"} title="Import a bank statement" copy="Use a CSV with Date, Description, and Amount columns. Existing transactions are skipped automatically." onClose={() => setModal("")}>
        <Notice message={error} tone="error" onClose={() => setError("")} />
        <form className="form-grid" onSubmit={importFile}>
          <label className="full"><span>Financial account</span><select name="financialAccountId" required>{accounts.map((account) => <option value={account.id} key={account.id}>{account.display_name}</option>)}</select></label>
          <label className="file-input full"><span>CSV statement</span><input type="file" name="statement" accept=".csv,text/csv" required /></label>
          <button className="button button-primary full" disabled={working || !accounts.length}>{working ? "Importing…" : "Import statement"}</button>
        </form>
      </Modal>
      <Modal open={modal === "categorize"} title="Categorize transaction" copy={selected ? `${shortDate(selected.transaction_date)} · ${money(selected.amount_cents)}` : ""} onClose={() => setModal("")}>
        <Notice message={error} tone="error" onClose={() => setError("")} />
        <form className="form-grid" onSubmit={categorize}>
          <label className="full"><span>Description</span><input name="description" defaultValue={selected?.description} required /></label>
          <label className="full"><span>Expense category</span><select name="expenseAccountId" required>{expenseAccounts.map((account) => <option value={account.id} key={account.id}>{account.code} · {account.name}</option>)}</select></label>
          <button className="button button-primary full" disabled={working}>{working ? "Posting…" : "Categorize and post"}</button>
        </form>
      </Modal>
    </>
  );
}

function Sales({ customers, reloadCustomers }) {
  const invoices = useResource("/api/invoices", { invoices: [] });
  const [modal, setModal] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState("");
  const [invoiceLines, setInvoiceLines] = useState([{ description: "", quantity: "1", amount: "" }]);

  const createInvoice = async (event) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      const form = new FormData(event.currentTarget);
      const lines = invoiceLines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity || 1),
        unitAmountCents: Math.round(Number(line.amount) * 100),
      }));
      await api("/api/invoices", { method: "POST", body: JSON.stringify({
        customerId: form.get("customerId"),
        lines,
        taxCents: Math.round(Number(form.get("tax") || 0) * 100),
        issueDate: form.get("issueDate"),
        dueDate: form.get("dueDate"),
        paymentTerms: form.get("paymentTerms"),
        memo: form.get("memo"),
        invoiceFooter: form.get("invoiceFooter"),
        customFields: [0, 1, 2, 3].map((index) => ({ name: form.get(`customName${index}`), value: form.get(`customValue${index}`) })).filter((field) => field.name && field.value),
        recurring: form.get("recurring") === "on",
      }) });
      setModal(""); setInvoiceLines([{ description: "", quantity: "1", amount: "" }]); setNotice("Invoice created and posted to accounts receivable."); invoices.reload();
    } catch (requestError) { setError(requestError.message); }
    finally { setWorking(false); }
  };

  const addCustomer = async (event) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      const form = new FormData(event.currentTarget);
      const result = await api("/api/customers", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form)),
      });
      await reloadCustomers();
      setModal("");
      setNotice(`Customer ${result.customer.customer_number} added.`);
    } catch (requestError) { setError(requestError.message); }
    finally { setWorking(false); }
  };

  const collect = async (invoice) => {
    setWorking(true); setError("");
    try {
      const result = await api(`/api/invoices/${invoice.id}/collect`, { method: "POST" });
      setCheckoutUrl(result.checkoutUrl);
      setModal("payment-link");
    } catch (requestError) { setError(requestError.message); }
    finally { setWorking(false); }
  };

  return (
    <>
      <PageHeader
        eyebrow="Accounts receivable"
        title="From approved scope to automatic payment."
        copy="Customer numbers, invoice references, and Stripe autopay stay connected from the first SOW onward."
        actions={<>
          <button className="button button-secondary" onClick={async () => {
            setWorking(true);
            try { const result = await api("/api/customers/sync", { method: "POST" }); await reloadCustomers(); setNotice(`Customer sync complete: ${result.synced} records updated.`); }
            catch (requestError) { setError(requestError.message); }
            finally { setWorking(false); }
          }}>Sync approved SOWs</button>
          <button className="button button-secondary" onClick={() => setModal("customer")}>Add customer</button>
          <button className="button button-primary" onClick={() => setModal("invoice")}>New invoice</button>
        </>}
      />
      <Notice message={notice} onClose={() => setNotice("")} />
      <Notice message={error} tone="error" onClose={() => setError("")} />
      <section className="panel table-panel">
        <div className="panel-heading"><div><p className="eyebrow">Invoices</p><h2>Customer billing</h2></div><span className="panel-count">{invoices.data.invoices.length} total</span></div>
        {invoices.loading ? <LoadingRows /> : invoices.data.invoices.length ? (
          <div className="data-table invoices-table">
            <div className="table-row table-head"><span>Invoice</span><span>Customer</span><span>Due</span><span>Status</span><span>Balance</span><span /></div>
            {invoices.data.invoices.map((invoice) => {
              const balance = Number(invoice.total_cents) - Number(invoice.amount_paid_cents);
              return (
                <div className="table-row" key={invoice.id}>
                  <strong data-label="Invoice">{invoice.invoice_number}<small>{invoice.recurring ? "Monthly autopay" : "One-time"}</small></strong>
                  <span data-label="Customer">{invoice.customer_name}<small>{invoice.customer_number}</small></span>
                  <span data-label="Due">{shortDate(invoice.due_date)}</span>
                  <span data-label="Status"><Status tone={invoice.status === "paid" ? "good" : "warn"}>{invoice.status}</Status></span>
                  <b data-label="Balance">{money(balance)}</b>
                  <span>{balance > 0 ? <button className="mini-button" onClick={() => collect(invoice)} disabled={working}>Copy pay link</button> : "—"}</span>
                </div>
              );
            })}
          </div>
        ) : <Empty title="No invoices yet" copy="Sync an approved SOW or create your first customer invoice." action={<button className="button button-primary" onClick={() => setModal("invoice")}>Create invoice</button>} />}
      </section>
      <Modal open={modal === "customer"} title="Add a customer" copy="Use this for clients who did not begin with the online intake and SOW workflow." onClose={() => setModal("")}>
        <Notice message={error} tone="error" onClose={() => setError("")} />
        <form className="form-grid" onSubmit={addCustomer}>
          <label className="full"><span>Customer name</span><input name="name" required /></label>
          <label className="full"><span>Organization</span><input name="organization" /></label>
          <label><span>Email</span><input name="email" type="email" required /></label>
          <label><span>Phone</span><input name="phone" type="tel" /></label>
          <button className="button button-primary full" disabled={working}>{working ? "Adding…" : "Add customer"}</button>
        </form>
      </Modal>
      <Modal open={modal === "payment-link"} title="Stripe payment link" copy="Send this secure checkout link to the customer, or open it now to verify the payment experience." onClose={() => setModal("")}>
        <div className="form-grid">
          <label className="full"><span>Secure checkout URL</span><input value={checkoutUrl} readOnly /></label>
          <button className="button button-secondary" type="button" onClick={async () => {
            await navigator.clipboard.writeText(checkoutUrl);
            setNotice("Secure Stripe payment link copied to the clipboard.");
          }}>Copy link</button>
          <a className="button button-primary" href={checkoutUrl} target="_blank" rel="noreferrer">Open Stripe checkout</a>
        </div>
      </Modal>
      <Modal open={modal === "invoice"} title="Create an invoice" copy="PBA posts the invoice to accounts receivable, then Stripe sends one-time invoices or starts monthly autopay." onClose={() => setModal("")}>
        <Notice message={error} tone="error" onClose={() => setError("")} />
        <form className="form-grid" onSubmit={createInvoice}>
          <label className="full"><span>Customer</span><select name="customerId" required><option value="">Choose a customer</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.customer_number} · {customer.organization || customer.name}</option>)}</select></label>
          <div className="full invoice-lines"><div className="form-section-heading"><span>Invoice lines</span><button className="mini-button" type="button" onClick={() => setInvoiceLines([...invoiceLines, { description: "", quantity: "1", amount: "" }])}>Add line</button></div>
            {invoiceLines.map((line, index) => <div className="invoice-line" key={index}>
              <input aria-label={`Line ${index + 1} description`} placeholder="Website design and build" value={line.description} onChange={(event) => setInvoiceLines(invoiceLines.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} required />
              <input aria-label={`Line ${index + 1} quantity`} type="number" min=".001" step=".001" value={line.quantity} onChange={(event) => setInvoiceLines(invoiceLines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} required />
              <div className="money-input"><b>$</b><input aria-label={`Line ${index + 1} amount`} type="number" min=".01" step=".01" placeholder="1500.00" value={line.amount} onChange={(event) => setInvoiceLines(invoiceLines.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} required /></div>
              {invoiceLines.length > 1 && <button className="mini-button" type="button" onClick={() => setInvoiceLines(invoiceLines.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}
            </div>)}
          </div>
          <label><span>Sales tax to record</span><div className="money-input"><b>$</b><input type="number" name="tax" min="0" step=".01" defaultValue="0.00" /></div></label>
          <label><span>Issue date</span><input type="date" name="issueDate" defaultValue={today} required /></label>
          <label><span>Due date</span><input type="date" name="dueDate" defaultValue={today} required /></label>
          <label className="full"><span>Payment terms</span><input name="paymentTerms" defaultValue="Due on receipt" required /></label>
          <label className="full"><span>Memo for the customer</span><textarea name="memo" rows="3" placeholder="Thank you for partnering with PBA." /></label>
          <label className="full"><span>Footer / legal note</span><textarea name="invoiceFooter" rows="2" placeholder="Payment is due according to the terms above." /></label>
          <div className="full"><span>Custom fields <small>Optional · up to four</small></span>{[0, 1, 2, 3].map((index) => <div className="custom-field-row" key={index}><input name={`customName${index}`} placeholder={index === 0 ? "Customer number" : "Label"} /><input name={`customValue${index}`} placeholder={index === 0 ? "PBA-2026-001001" : "Value"} /></div>)}</div>
          <label className="check-label full"><input type="checkbox" name="recurring" defaultChecked /><span><strong>Monthly automatic payment</strong><small>Stripe securely saves the customer’s payment method and charges monthly.</small></span></label>
          <button className="button button-primary full" disabled={working || !customers.length}>{working ? "Creating…" : "Create and send through Stripe"}</button>
        </form>
      </Modal>
    </>
  );
}

function Expenses({ vendors, reloadVendors, expenseAccounts }) {
  const expenses = useResource("/api/expenses", { expenses: [] });
  const bills = useResource("/api/bills", { bills: [] });
  const [tab, setTab] = useState("expenses");
  const [modal, setModal] = useState("");
  const [selectedBill, setSelectedBill] = useState(null);
  const [selectedDocumentEntity, setSelectedDocumentEntity] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const submit = async (event, kind) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      const form = new FormData(event.currentTarget);
      const payload = {
        vendorId: form.get("vendorId") || null,
        expenseAccountId: form.get("expenseAccountId"),
        description: form.get("description"),
        amountCents: Math.round(Number(form.get("amount")) * 100),
      };
      if (kind === "expense") {
        payload.date = form.get("date");
        await api("/api/expenses", { method: "POST", body: JSON.stringify(payload) });
        await expenses.reload();
      } else {
        payload.issueDate = form.get("issueDate");
        payload.dueDate = form.get("dueDate");
        payload.vendorReference = form.get("vendorReference");
        await api("/api/bills", { method: "POST", body: JSON.stringify(payload) });
        await bills.reload();
      }
      setNotice(kind === "expense" ? "Expense posted to the ledger." : "Vendor bill recorded; no payment was initiated.");
      setModal("");
    } catch (requestError) { setError(requestError.message); }
    finally { setWorking(false); }
  };

  const addVendor = async (event) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      const form = new FormData(event.currentTarget);
      await api("/api/vendors", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      await reloadVendors(); setModal(""); setNotice("Vendor added.");
    } catch (requestError) { setError(requestError.message); }
    finally { setWorking(false); }
  };

  const payBill = async (event) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      const form = new FormData(event.currentTarget);
      await api(`/api/bills/${selectedBill.id}/payments`, { method: "POST", body: JSON.stringify({
        amountCents: Math.round(Number(form.get("amount")) * 100),
        date: form.get("date"),
      }) });
      await bills.reload(); setModal(""); setNotice("Bill payment recorded. PBA Books did not move money.");
    } catch (requestError) { setError(requestError.message); }
    finally { setWorking(false); }
  };

  const uploadDocument = async (event) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      const form = new FormData(event.currentTarget);
      form.set("entityType", selectedDocumentEntity.type);
      form.set("entityId", selectedDocumentEntity.id);
      await api("/api/documents", { method: "POST", body: form });
      setModal(""); setNotice("Receipt or vendor document stored privately.");
    } catch (requestError) { setError(requestError.message); }
    finally { setWorking(false); }
  };

  const rows = tab === "expenses" ? expenses.data.expenses : bills.data.bills;
  return (
    <>
      <PageHeader
        eyebrow="Accounts payable"
        title="Track what PBA spends and owes."
        copy="Capture paid expenses, save receipts, and track vendor bills without enabling money movement."
        actions={<>
          <button className="button button-secondary" onClick={() => setModal("vendor")}>Add vendor</button>
          <button className="button button-secondary" onClick={() => setModal("bill")}>Record bill</button>
          <button className="button button-primary" onClick={() => setModal("expense")}>Add expense</button>
        </>}
      />
      <Notice message={notice} onClose={() => setNotice("")} />
      <Notice message={error} tone="error" onClose={() => setError("")} />
      <div className="tabs"><button className={tab === "expenses" ? "active" : ""} onClick={() => setTab("expenses")}>Paid expenses</button><button className={tab === "bills" ? "active" : ""} onClick={() => setTab("bills")}>Vendor bills</button></div>
      <section className="panel table-panel">
        <div className="panel-heading"><div><p className="eyebrow">{tab === "expenses" ? "Operating costs" : "Amounts owed"}</p><h2>{tab === "expenses" ? "Expense register" : "Bill tracker"}</h2></div><span className="panel-count">{rows.length} records</span></div>
        {(tab === "expenses" ? expenses.loading : bills.loading) ? <LoadingRows /> : rows.length ? (
          <div className="data-table expenses-table">
            <div className="table-row table-head"><span>Date</span><span>Vendor / description</span><span>Category</span><span>Status</span><span>Amount</span><span /></div>
            {tab === "expenses" ? rows.map((item) => (
              <div className="table-row" key={item.id}>
                <span data-label="Date">{shortDate(item.expense_date)}</span>
                <strong data-label="Description">{item.vendor_name || item.description}<small>{item.vendor_name ? item.description : "Direct expense"}</small></strong>
                <span data-label="Category">{item.account_name}</span>
                <span data-label="Status"><Status tone="good">{item.status}</Status></span>
                <b data-label="Amount">{money(item.amount_cents)}</b><span><button className="mini-button" onClick={() => { setSelectedDocumentEntity({ type: "expense", id: item.id }); setModal("document"); }}>Receipt</button></span>
              </div>
            )) : rows.map((item) => {
              const remaining = Number(item.amount_cents) - Number(item.amount_paid_cents);
              return (
                <div className="table-row" key={item.id}>
                  <span data-label="Due">{shortDate(item.due_date)}</span>
                  <strong data-label="Vendor">{item.vendor_name}<small>{item.bill_number} · {item.description}</small></strong>
                  <span data-label="Reference">{item.vendor_reference || "No vendor reference"}</span>
                  <span data-label="Status"><Status tone={item.status === "paid" ? "good" : "warn"}>{item.status}</Status></span>
                  <b data-label="Balance">{money(remaining)}</b>
                  <span className="row-actions"><button className="mini-button" onClick={() => { setSelectedDocumentEntity({ type: "bill", id: item.id }); setModal("document"); }}>Document</button>{remaining > 0 && <button className="mini-button" onClick={() => { setSelectedBill(item); setModal("pay-bill"); }}>Mark paid</button>}</span>
                </div>
              );
            })}
          </div>
        ) : <Empty title={tab === "expenses" ? "No expenses recorded" : "No vendor bills"} copy={tab === "expenses" ? "Add a paid expense or categorize one from the bank feed." : "Record bills when they arrive, then match payment from the bank feed."} />}
      </section>
      <Modal open={["expense", "bill"].includes(modal)} title={modal === "expense" ? "Add a paid expense" : "Record a vendor bill"} copy={modal === "expense" ? "This posts the expense and reduces the operating-bank ledger balance." : "This records the expense and accounts payable. It will not send a payment."} onClose={() => setModal("")}>
        <Notice message={error} tone="error" onClose={() => setError("")} />
        <form className="form-grid" onSubmit={(event) => submit(event, modal)}>
          <label className="full"><span>Vendor {modal === "expense" && "(optional)"}</span><select name="vendorId" required={modal === "bill"}><option value="">Choose a vendor</option>{vendors.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.name}</option>)}</select></label>
          <label className="full"><span>Description</span><input name="description" placeholder="Software subscription" required /></label>
          <label className="full"><span>Expense category</span><select name="expenseAccountId" required>{expenseAccounts.map((account) => <option value={account.id} key={account.id}>{account.code} · {account.name}</option>)}</select></label>
          <label><span>Amount</span><div className="money-input"><b>$</b><input name="amount" type="number" step=".01" min=".01" required /></div></label>
          {modal === "expense"
            ? <label><span>Paid date</span><input name="date" type="date" defaultValue={today} required /></label>
            : <><label><span>Bill date</span><input name="issueDate" type="date" defaultValue={today} required /></label><label><span>Due date</span><input name="dueDate" type="date" defaultValue={today} required /></label><label className="full"><span>Vendor invoice/reference</span><input name="vendorReference" /></label></>}
          <button className="button button-primary full" disabled={working}>{working ? "Saving…" : modal === "expense" ? "Post expense" : "Record bill"}</button>
        </form>
      </Modal>
      <Modal open={modal === "vendor"} title="Add a vendor" copy="Vendors are businesses or contractors PBA pays." onClose={() => setModal("")}>
        <Notice message={error} tone="error" onClose={() => setError("")} />
        <form className="form-grid" onSubmit={addVendor}>
          <label className="full"><span>Vendor name</span><input name="name" required /></label>
          <label><span>Email</span><input name="email" type="email" /></label>
          <label><span>Phone</span><input name="phone" type="tel" /></label>
          <label className="full"><span>Notes</span><textarea name="notes" rows="3" /></label>
          <button className="button button-primary full" disabled={working}>{working ? "Adding…" : "Add vendor"}</button>
        </form>
      </Modal>
      <Modal open={modal === "pay-bill"} title="Record a bill payment" copy="Confirm money already moved outside PBA Books. This action only updates the books." onClose={() => setModal("")}>
        <Notice message={error} tone="error" onClose={() => setError("")} />
        <form className="form-grid" onSubmit={payBill}>
          <label><span>Amount paid</span><div className="money-input"><b>$</b><input name="amount" type="number" step=".01" min=".01" max={selectedBill ? (Number(selectedBill.amount_cents) - Number(selectedBill.amount_paid_cents)) / 100 : undefined} defaultValue={selectedBill ? ((Number(selectedBill.amount_cents) - Number(selectedBill.amount_paid_cents)) / 100).toFixed(2) : ""} required /></div></label>
          <label><span>Payment date</span><input name="date" type="date" defaultValue={today} required /></label>
          <div className="trust-box full"><strong>Tracking only</strong><span>No bank payment will be sent.</span></div>
          <button className="button button-primary full" disabled={working}>{working ? "Recording…" : "Record payment"}</button>
        </form>
      </Modal>
      <Modal open={modal === "document"} title="Store a receipt or bill" copy="PDF, JPEG, and PNG files are stored in PBA’s private R2 bucket and never exposed publicly." onClose={() => setModal("")}>
        <Notice message={error} tone="error" onClose={() => setError("")} />
        <form className="form-grid" onSubmit={uploadDocument}>
          <label className="file-input full"><span>Document</span><input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required /></label>
          <small className="full form-help">Maximum file size: 10 MB.</small>
          <button className="button button-primary full" disabled={working}>{working ? "Uploading…" : "Store privately"}</button>
        </form>
      </Modal>
    </>
  );
}

function Reports() {
  const [type, setType] = useState("profit-loss");
  const [basis, setBasis] = useState("cash");
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today);
  const path = `/api/reports?type=${type}&basis=${basis}&from=${from}&to=${to}`;
  const report = useResource(path, { rows: [] });
  const labels = {
    "profit-loss": "Profit and loss",
    "balance-sheet": "Balance sheet",
    "trial-balance": "Trial balance",
    "general-ledger": "General ledger",
    "ar-aging": "A/R aging",
    "ap-aging": "A/P aging",
  };
  const exportCsv = () => {
    if (!report.data.rows.length) return;
    const keys = Object.keys(report.data.rows[0]);
    const safeCell = (value) => {
      const text = String(value ?? "");
      const neutralized = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${neutralized.replaceAll('"', '""')}"`;
    };
    const csv = [keys.join(","), ...report.data.rows.map((row) => keys.map((key) => safeCell(row[key])).join(","))].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `pba-${type}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const amountFor = (row) => row.amount_cents ?? row.balance_cents ?? row.debit_balance_cents;
  return (
    <>
      <PageHeader eyebrow="Financial reporting" title="Accountant-ready, owner-readable." copy="Switch between cash and accrual views, inspect the ledger, and export clean CSV files for review." actions={<button className="button button-primary" onClick={exportCsv} disabled={!report.data.rows.length}>Export CSV</button>} />
      <section className="report-controls">
        <label><span>Report</span><select value={type} onChange={(event) => setType(event.target.value)}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>Basis</span><select value={basis} onChange={(event) => setBasis(event.target.value)} disabled={type !== "profit-loss"}><option value="cash">Cash</option><option value="accrual">Accrual</option></select></label>
        <label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>Through</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </section>
      <section className="panel report-paper">
        <header className="report-title"><div><p>Palmetto Business Automation LLC</p><h2>{labels[type]}</h2><span>{shortDate(from)} through {shortDate(to)} · {report.data.basis || basis} basis</span></div><b>PBA</b></header>
        {report.loading ? <LoadingRows /> : report.error ? <Notice message={report.error} tone="error" onClose={() => {}} /> : report.data.rows.length ? (
          <div className="report-rows">
            {report.data.rows.map((row, index) => (
              <div key={`${row.code || row.invoice_number || row.bill_number || index}-${index}`}>
                <span><strong>{row.code ? `${row.code} · ` : ""}{row.name || row.customer_name || row.vendor_name || row.description || row.invoice_number || row.bill_number}</strong><small>{row.account_type || row.entry_number || row.due_date || ""}</small></span>
                {amountFor(row) !== undefined && <b>{money(amountFor(row))}</b>}
                {row.debit_cents !== undefined && <span className="report-split"><small>Debit {money(row.debit_cents)}</small><small>Credit {money(row.credit_cents)}</small></span>}
              </div>
            ))}
          </div>
        ) : <Empty title="No activity in this period" copy="Posted transactions will appear here automatically." />}
      </section>
    </>
  );
}

function Settings({ accounts, financialAccounts, owner, reloadAccounts }) {
  const [modal, setModal] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const grouped = useMemo(() => Object.groupBy
    ? Object.groupBy(accounts, (account) => account.account_type)
    : accounts.reduce((result, account) => ({ ...result, [account.account_type]: [...(result[account.account_type] || []), account] }), {}), [accounts]);
  return (
    <>
      <PageHeader eyebrow="Company settings" title="Built for PBA’s books." copy="A single-company, USD ledger with owner-only access and controlled integration points." actions={<><button className="button button-secondary" onClick={() => setModal("account")}>Add account</button><button className="button button-primary" onClick={() => setModal("opening")}>Opening balance</button></>} />
      <Notice message={notice} onClose={() => setNotice("")} />
      <Notice message={error} tone="error" onClose={() => setError("")} />
      <section className="settings-grid">
        <article className="panel settings-card">
          <div className="panel-heading"><div><p className="eyebrow">Security</p><h2>Owner access</h2></div><Status tone="good">protected</Status></div>
          <dl><div><dt>Signed in as</dt><dd>{owner.email || "Cloudflare Access owner"}</dd></div><div><dt>Authentication</dt><dd>Cloudflare Access one-time code</dd></div><div><dt>Application</dt><dd>books.palmettobusinessautomation.com</dd></div></dl>
        </article>
        <article className="panel settings-card">
          <div className="panel-heading"><div><p className="eyebrow">Banking</p><h2>Financial connections</h2></div><Status tone={financialAccounts.length ? "good" : "warn"}>{financialAccounts.length ? "connected" : "setup needed"}</Status></div>
          <dl><div><dt>Provider</dt><dd>Stripe Financial Connections</dd></div><div><dt>Fallback</dt><dd>CSV statement import</dd></div><div><dt>Permissions</dt><dd>Balances and transactions</dd></div></dl>
        </article>
        <article className="panel settings-card">
          <div className="panel-heading"><div><p className="eyebrow">Controls</p><h2>Accounting policy</h2></div></div>
          <dl><div><dt>Default reporting</dt><dd>Cash basis</dd></div><div><dt>Alternate reporting</dt><dd>Accrual basis</dd></div><div><dt>Sales tax</dt><dd>Record only · no filing</dd></div><div><dt>Vendor payments</dt><dd>Tracking only · no money movement</dd></div></dl>
        </article>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">General ledger</p><h2>Chart of accounts</h2></div><span className="panel-count">{accounts.length} accounts</span></div>
        <div className="account-groups">
          {Object.entries(grouped).map(([type, rows]) => (
            <article key={type}><h3>{type}</h3>{rows.map((account) => <div key={account.id}><code>{account.code}</code><span>{account.name}</span><Status tone={account.active ? "good" : "neutral"}>{account.active ? "active" : "inactive"}</Status></div>)}</article>
          ))}
        </div>
      </section>
      <Modal open={modal === "opening"} title="Record PBA’s opening bank balance" copy="This creates a balanced January 1 entry between the operating bank and owner equity. Confirm the amount against the December 31, 2025 statement." onClose={() => setModal("")}>
        <Notice message={error} tone="error" onClose={() => setError("")} />
        <form className="form-grid" onSubmit={async (event) => {
          event.preventDefault(); setWorking(true); setError("");
          try {
            const form = new FormData(event.currentTarget);
            await api("/api/opening-balances", { method: "POST", body: JSON.stringify({
              date: form.get("date"),
              bankBalanceCents: Math.round(Number(form.get("amount")) * 100),
            }) });
            setModal(""); setNotice("Opening balance posted to the ledger.");
          } catch (requestError) { setError(requestError.message); }
          finally { setWorking(false); }
        }}>
          <label><span>Opening date</span><input name="date" type="date" defaultValue={`${new Date().getFullYear()}-01-01`} required /></label>
          <label><span>Bank statement balance</span><div className="money-input"><b>$</b><input name="amount" type="number" min=".01" step=".01" required /></div></label>
          <div className="trust-box full"><strong>Balanced posting</strong><span>Debit Operating bank · Credit Owner equity</span></div>
          <button className="button button-primary full" disabled={working}>{working ? "Posting…" : "Post opening balance"}</button>
        </form>
      </Modal>
      <Modal open={modal === "account"} title="Add a ledger account" copy="Create an additional category without changing PBA’s protected system accounts." onClose={() => setModal("")}>
        <Notice message={error} tone="error" onClose={() => setError("")} />
        <form className="form-grid" onSubmit={async (event) => {
          event.preventDefault(); setWorking(true); setError("");
          try {
            const form = new FormData(event.currentTarget);
            await api("/api/accounts", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
            await reloadAccounts(); setModal(""); setNotice("Ledger account added.");
          } catch (requestError) { setError(requestError.message); }
          finally { setWorking(false); }
        }}>
          <label><span>Account code</span><input name="code" placeholder="6600" pattern="[0-9A-Za-z-]+" required /></label>
          <label><span>Account type</span><select name="accountType" required><option value="expense">Expense</option><option value="revenue">Revenue</option><option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Equity</option></select></label>
          <label className="full"><span>Account name</span><input name="name" placeholder="Travel expense" required /></label>
          <button className="button button-primary full" disabled={working}>{working ? "Adding…" : "Add account"}</button>
        </form>
      </Modal>
    </>
  );
}

function App() {
  const [view, setView] = useState("dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const me = useResource("/api/me", { user: {} });
  const accounts = useResource("/api/accounts", { accounts: [] });
  const customers = useResource("/api/customers", { customers: [] });
  const vendors = useResource("/api/vendors", { vendors: [] });
  const bankAccounts = useResource("/api/bank/accounts", { accounts: [] });
  const expenseAccounts = accounts.data.accounts.filter((account) => account.account_type === "expense");
  const current = navigation.find((item) => item.id === view);

  const content = {
    dashboard: <Dashboard setView={setView} />,
    transactions: <Transactions accounts={bankAccounts.data.accounts} expenseAccounts={expenseAccounts} />,
    sales: <Sales customers={customers.data.customers} reloadCustomers={customers.reload} />,
    expenses: <Expenses vendors={vendors.data.vendors} reloadVendors={vendors.reload} expenseAccounts={expenseAccounts} />,
    reports: <Reports />,
    settings: <Settings accounts={accounts.data.accounts} financialAccounts={bankAccounts.data.accounts} owner={me.data.user} reloadAccounts={accounts.reload} />,
  }[view];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">PBA</span>
          <div><strong>PBA Books</strong><small>Private accounting</small></div>
          <button className="mobile-close" onClick={() => setMobileNav(false)}>×</button>
        </div>
        <nav aria-label="Accounting navigation">
          {navigation.map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setMobileNav(false); }}>
              <span>{item.mark}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="secure-dot"><span /><strong>Cloudflare protected</strong></div>
          <p>{me.data.user.email || "Owner session"}</p>
        </div>
      </aside>
      {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <main className="workspace">
        <div className="mobile-bar"><button onClick={() => setMobileNav(true)} aria-label="Open navigation">☰</button><strong>{current?.label}</strong><span>PBA</span></div>
        <div className="workspace-inner">{content}</div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
