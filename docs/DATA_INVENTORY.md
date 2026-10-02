# SkySale — Data Inventory

Every kind of data SkySale collects or stores, where it lives, who can see it,
what leaves our servers, and how long it is kept.

- **Last reviewed:** 2 October 2026 (updated for token encryption and customer notes)
- **Sources:** the production Postgres schema (table and column names only — no
  records were read), the code in `backend/src` and `backend/web`.
- **Keep it current:** when a table, column, browser-storage key, or outside
  service is added or removed, update this file in the same commit.

---

## 1. Where data lives

| Place | What's there | Notes |
|---|---|---|
| **Postgres** (Railway) | Everything the app runs on — 41 tables, listed in §3 | The system of record. Every row carries `user_id`, the shop (company) it belongs to. |
| **SQLite file** (`/data/glow.db` on the server) | Sign-in accounts from the original app (§4) | Wiped on every deploy (`DATABASE_PATH` points outside the mounted volume). Nothing depends on it surviving. |
| **Server memory** | Sign-in sessions (§5) | Express's default memory store — every session ends on a deploy or restart. |
| **The browser** | A few preferences and remembered accounts (§5) | `localStorage` / `sessionStorage` on the shop's own devices. |
| **Outside services** | What we send to Stripe, Google, Anthropic, Resend, the card processors and phone carriers (§6) | Governed by each provider's own terms. |
| **Server logs** (Railway) | Operational messages | Mostly ids and reasons ("sale alert not sent: alerts are off"). Some lines include an email address or phone-gateway address. |

---

## 2. What we collect, by subject

Sensitivity: **High** = could cause real harm if exposed (credentials, pay,
contact details); **Medium** = business-confidential; **Low** = configuration.

### The shop (our customer)
| Data | Where | Sensitivity |
|---|---|---|
| Sign-in email, its alias forms (Gmail dots) | `pos_company_emails`, `pos_known_users`, SQLite `users` | Medium |
| Store name, address, phone, email, web address (slug), timezone, tax rate | `pos_settings` | Low |
| Settings: receipts, return/exchange windows, pay schedule, booking rules, automatic-email rules, time clock and Build-your-own switches, theme, brands | `pos_settings` | Low |
| Which stores are linked together, and who linked them | `pos_company_links` | Medium |
| Subscription: Stripe customer and subscription ids, plan (full / sleep), status, trial and period dates, cancellation and deletion-warning dates | `pos_subscriptions` | Medium |
| Acceptance of the Terms/EULA: version, who accepted, **IP address**, **browser user-agent**, time | `pos_terms_acceptances` | Medium |

### Staff (the shop's employees)
| Data | Where | Sensitivity |
|---|---|---|
| Name, role (sales / manager / admin), active flag, phone, job title | `pos_employees` | Medium |
| **PIN** | `pos_employees.pin` — stored as plain text | **High** |
| Commission rate and plan (flat, or daily tier with threshold), share of the store | `pos_employees.commission_rate`, `pos_commission_plans` | High |
| **Hourly wage or yearly salary**, with the date each takes effect and who set it | `pos_employee_pay` | **High** |
| **Time clock**: clock-in/out times, notes, who edited a shift and when | `pos_time_entries` | High |
| Payroll: paydays closed and by whom, per-person payments, hand-entered adjustments (bonuses, advances), balances carried between paychecks, chargeback holds | `pos_payroll_runs`, `pos_payroll_employee_runs`, `pos_payroll_adjustments`, `pos_payroll_balances`, `pos_chargeback_holds` | High |
| Who processed and who approved each return | `pos_transactions.processed_by_*`, `approved_by_*` | Medium |

### The shop's customers (consumers)
| Data | Where | Sensitivity |
|---|---|---|
| Name, email, phone, postal address, birthday | `customers` | **High** (personal data) |
| **Free-text notes** — staff may type health details (allergies, skin conditions) | `customers.notes` | **High — may be sensitive.** The Terms (§8) ask shops not to record health information unless needed and consented to, and the app says so under the box. SkySale is not a health record system and signs no HIPAA BAAs. |
| "Never email" flag | `customers.no_email` | Medium |
| What they bought, and when | `customer_products`, `pos_transactions`, `pos_transaction_items` | High |
| Name, email and phone copied onto each receipt | `pos_transactions.customer_*` | High |
| Appointments: treatment, employee, time, status, notes, cancellation | `pos_appointments` (the booking link token is a random secret) | High |
| Emails sent to them — welcome, receipt, mass email — **including the full body** | `sent_emails`, `welcome_emails`, `campaigns`, queue in `pos_auto_emails` | High |

### Sales and money
| Data | Where | Sensitivity |
|---|---|---|
| Every sale and return: receipt number, totals, tax, discounts, notes, original sale for returns | `pos_transactions` | Medium |
| Line items: product, brand, quantity, price, discount | `pos_transaction_items` | Medium |
| Payments: method, amount, **last 4 digits of the card only** | `pos_transaction_payments`, `pos_transactions.card_last4` | Medium |
| Who sold it and their commission on it | `pos_transaction_employees` | High |
| Chargebacks/disputes: amount, card last 4, status, dates, notes, which paycheck held it | `pos_transaction_chargebacks` | High |
| Products: catalogue overrides (price, minimum price, **cost**), visibility, the shop's own products, product notes used in welcome emails | `pos_product_prices`, `pos_product_visibility`, `pos_custom_products`, `pos_product_email` | Medium |

**Never collected:** full card numbers, expiry dates, CVVs, bank account
numbers, Social Security numbers. Card payments happen on the shop's own
terminal; SkySale records only the method, amount and last four digits.

### Reconciliation (the audit)
| Data | Where | Sensitivity |
|---|---|---|
| **Processor credentials**: Maverick DBA id and API token, Payarc bearer token and merchant id | `pos_settings.maverick_*`, `payarc_*` — tokens stored as plain text, never sent to the browser | **High** |
| Batch figures read from the processor at audit time | Not stored — fetched each time an audit runs | — |
| Nightly results (days off, difference, whether a text went out), saved audits, who reviewed which day or line | `pos_audit_auto_runs`, `pos_saved_audits`, `pos_audit_reviews`, `pos_audit_line_reviews` | Medium |
| Text-alert recipients: phone numbers or email addresses, and carrier | `pos_settings.sale_alert_*` | High |

### Sign-in and security
| Data | Where | Sensitivity |
|---|---|---|
| Sign-in links: **hashed** token, email, expiry, when used | `pos_login_links` | High |
| **Gmail access** for sending as the shop: refresh token and address | `pos_gmail_tokens` — **encrypted at rest** (AES-256-GCM, `lib/secrets.js`, key in Railway's `TOKEN_ENCRYPTION_KEY`; on since 2 Oct 2026) | **High** |
| Session cookie (`connect.sid`), 30 days, http-only, secure in production | Browser + server memory | High |

---

## 3. Postgres — every table

Columns as they stand in production. `user_id` is the shop on every table
that has it.

| Table | Columns | Purpose |
|---|---|---|
| `campaigns` | id, subject, body, recipient_count, user_id, sent_at | Mass emails sent |
| `customer_products` | id, customer_id, product_id, product_name, purchased_at | What each customer has bought |
| `customers` | id, name, email, phone, address, notes, user_id, created_at, updated_at, birthday, no_email | The shop's customer list |
| `pos_appointments` | id, user_id, token, customer_id, customer_name, customer_email, customer_phone, employee_id, employee_name, treatment_id, treatment_name, duration_min, starts_at, status, notes, created_at, updated_at, cancelled_at, cancelled_by | Calendar bookings |
| `pos_audit_auto_runs` | user_id, audited_day, ran_at, days_off, difference, alerted, note | Nightly reconciliation results |
| `pos_audit_line_reviews` | user_id, audit_date, side, ref, reviewed_by, reviewed_at | Audit lines marked reviewed |
| `pos_audit_reviews` | user_id, audit_date, reviewed, reviewed_by, reviewed_at, status | Audit days marked reviewed |
| `pos_auto_emails` | id, user_id, transaction_id, kind, to_email, send_after, status, reason, attempts, created_at, finished_at | Queue of automatic emails after a sale |
| `pos_availability` | user_id, weekday, open, start_time, end_time | Bookable hours |
| `pos_chargeback_holds` | chargeback_id, employee_id, held_payday, released_payday, created_by, created_at, manual | Which paycheck held/released each person's share of a dispute |
| `pos_closed_dates` | id, user_id, closed_on, reason | Days the shop is closed |
| `pos_commission_plans` | id, employee_id, plan_type, base_rate, tier_rate, tier_threshold, user_id, store_rate | Commission plans |
| `pos_company_emails` | canonical_email, user_id, email, created_at | Sign-in address aliases (e.g. Gmail dots) |
| `pos_company_links` | user_id, linked_user_id, linked_by, created_at | Stores linked for combined payroll/reports |
| `pos_custom_products` | id, name, brand, description, image, price, min_price, user_id, active, created_at, category, usage_notes, source_url, usage_frequency, routine_step, benefits, ingredients | The shop's own products |
| `pos_employee_pay` | id, employee_id, user_id, pay_type, hourly_rate, annual_salary, effective_from, created_by, created_at | Wage/salary history |
| `pos_employees` | id, name, pin, role, commission_rate, user_id, active, created_at, phone, title | Staff |
| `pos_gmail_tokens` | user_id, refresh_token, email, updated_at | Gmail access for sending as the shop |
| `pos_known_users` | user_id, created_at | Accounts seen before (wording of sign-in emails) |
| `pos_login_links` | token_hash, email, expires_at, used_at, created_at | Email sign-in links |
| `pos_migrations` | name, applied_at | Schema bookkeeping (not shop data) |
| `pos_payroll_adjustments` | id, user_id, payday, employee_id, amount, note, created_at, created_by | Hand-entered paycheck lines |
| `pos_payroll_balances` | payday, employee_id, user_id, net_total, recorded_at | What a closed paycheck came to |
| `pos_payroll_employee_runs` | payday, employee_id, user_id, paid_at, paid_by | One person paid |
| `pos_payroll_runs` | user_id, payday, paid_at, paid_by | A whole payday closed |
| `pos_product_email` | product_id, user_id, usage_notes, usage_frequency, routine_step, benefits, description, updated_at | Product notes for welcome emails |
| `pos_product_prices` | id, product_id, price, min_price, cost, user_id | Price/cost overrides |
| `pos_product_visibility` | product_id, user_id, visible | Products hidden from the register |
| `pos_saved_audits` | id, user_id, label, date_from, date_to, created_at | Saved audit ranges |
| `pos_settings` | user_id, store_name, receipt_footer, timezone, store_address, tax_rate, theme, brands, maverick_dba_id, maverick_token, store_city, store_state, store_zip, receipt_copies, payarc_token, payarc_merchant_id, payarc_env, payroll_paydays, payroll_lag, sale_alert_phone, sale_alert_carrier, sale_alert_enabled, sale_alert_recipients, store_email, store_phone, company_name, booking_slot_step, booking_lead_hours, slug, return_policy_title, return_policy_points, audit_auto_enabled, audit_alert_enabled, audit_auto_time, return_window_days, exchange_window_days, auto_email_enabled, auto_email_welcome, auto_email_receipt, auto_email_min_total, auto_email_first_only, auto_email_cooldown_days, auto_email_delay_min, auto_email_excluded, time_clock_enabled, build_your_own_enabled | One row per shop |
| `pos_subscriptions` | user_id, stripe_customer_id, stripe_subscription_id, status, trial_end, current_period_end, cancel_at_period_end, canceled_at, created_at, updated_at, plan, ended_at, deletion_warned_at | Billing state |
| `pos_terms_acceptances` | id, user_id, email, version, accepted_by, ip, user_agent, accepted_at | Terms/EULA acceptance record |
| `pos_time_entries` | id, user_id, employee_id, clock_in, clock_out, note, edited_by, edited_at, created_at | Time clock shifts |
| `pos_transaction_chargebacks` | id, transaction_id, user_id, amount, card_last4, status, opened_at, closed_at, note, created_at, withheld_payday, withheld_at, withheld_by, released_payday | Disputes |
| `pos_transaction_employees` | id, transaction_id, employee_id, commission_type, commission_value, commission_amount | Who sold what, and their commission |
| `pos_transaction_items` | id, transaction_id, product_id, product_name, brand, quantity, unit_price, discount, line_total | Line items |
| `pos_transaction_payments` | id, transaction_id, method, amount, card_last4, created_at | Tenders (split payments) |
| `pos_transactions` | id, type, employee_id, customer_id, customer_name, customer_email, subtotal, tax_rate, tax_amount, discount_amount, total, payment_method, card_last4, notes, receipt_number, original_transaction_id, original_sale_date, user_id, created_at, employees_changed, customer_phone, charged_back, charged_back_at, charged_back_note, chargeback_status, chargeback_closed_at, chargeback_amount, processed_by_id, processed_by_name, approved_by_id, approved_by_name | Sales and returns |
| `pos_treatments` | id, user_id, name, duration_min, active, created_at | Bookable treatments |
| `sent_emails` | id, user_id, to_email, to_name, subject, body, kind, sent_at | Every email sent to a customer, with its body |
| `welcome_emails` | id, customer_name, customer_email, products, user_id, sent_at | Welcome emails sent |

---

## 4. SQLite (legacy)

`backend/src/db/schema.sql`, opened by `backend/src/db/index.js`. Still read
at sign-in to resolve an email to its account id; wiped on every deploy.

| Table | Holds | Notes |
|---|---|---|
| `users` | id, email, company_name, theme, websites, brands, **Google access/refresh tokens** (encrypted, like Postgres), push token, Gmail history id | Sending falls back to `pos_gmail_tokens` in Postgres when this is empty (`lib/sending-user.js`) |
| `emails` | Gmail thread/message ids, sender, subject, snippet, body, draft | Left from the removed Smart Inbox; nothing writes to it now |
| `customers`, `customer_products`, `campaigns`, `welcome_emails` | Older copies of the Postgres tables | Superseded by Postgres |

`backend/src/db/pos-schema.sql` / `db/pos.js` (including `pos_clock_entries`)
are an older SQLite POS that **nothing requires any more** — dead code.

---

## 5. Browser storage and cookies

| Key | Kind | Holds |
|---|---|---|
| `connect.sid` | Cookie (http-only, 30 days) | The sign-in session id |
| `glowEmail`, `glowCompany` | localStorage | The signed-in address and shop name |
| `glowLinkedAccounts` | localStorage | Shops signed into on this device (email + name), for the company switcher |
| `skysale.payrollHidden` | localStorage | Which people are collapsed on the payroll page |
| `skysale.settingsGroup` | localStorage | Last Settings tab opened |
| tour-offer key (`tourOfferKey()`) | localStorage | Whether the guided tour was offered/dismissed |
| `skysale_goto_import` | sessionStorage | One-time hop to the import screen after signup |

No PINs, pay, or customer data are kept in browser storage. PINs typed to
unlock a tab are held in page memory only and cleared on leaving the tab.
The server never sends PINs or wages/salaries to the browser.

---

## 6. What leaves our servers

| Service | What we send | Why |
|---|---|---|
| **Stripe** | Shop's email, billing name and address, tax id (if given) | Subscriptions, invoices, tax. Card details go to Stripe Checkout directly and never touch SkySale. |
| **Google (Gmail API)** | Customer emails — receipts, welcome, mass email — sent *as the shop*; sale and audit text alerts | Using the shop's own Gmail (scope: `gmail.send` only). |
| **Phone carriers' email-to-SMS gateways** | Sale/refund alerts (amount, seller, store, customer name, receipt no.), audit alerts | Via Gmail, to `<number>@<carrier gateway>`. |
| **Anthropic (Claude API)** | Help-chat questions typed by staff; supplier catalogue pages when importing products | Answers and product extraction. Not stored by SkySale. |
| **Resend** | Sign-in links, feature requests (text + sender + shop), retention warnings, system email | Our own transactional mail (`support@sky-sale.com`). |
| **Maverick Payments / Payarc** | The shop's own processor credentials, in API calls | To read settled batches for the audit. |
| **Supplier websites** | Fetches of public product pages, as `SkySale-ProductImport/1.0` | Importing a brand's catalogue. |
| **Railway** | Hosts the app, Postgres and logs | Infrastructure. |
| **Netlify** | Hosts the marketing site (sky-sale.com) — no forms, no data collected | Infrastructure. |

---

## 7. Retention and deletion

- **While a shop subscribes:** everything is kept.
- **After cancelling:** kept 30 days, with a warning email at least 7 days
  before deletion; then `deleteCompany()` (`backend/src/db/postgres.js`)
  removes the shop's sales, items, payments, disputes, payroll, commission
  plans, appointments, availability, products, audits, emails sent, customers,
  Gmail token, employees (and with them, through `ON DELETE CASCADE`, their
  time clock shifts, pay history and chargeback holds), terms acceptances,
  automatic-email queue, settings and sign-in links, plus the subscription row
  (`services/retention.js`).
- **Exempt from the Terms prompt:** `TERMS_EXEMPT_SLUGS` (Glow SF, Desert Wellness).
- **Sign-in links** expire; **sessions** end on restart; **SQLite** is wiped on deploy.

### Gaps found while writing this
These are **not** removed when a cancelled shop is deleted, and should be:

| Table | Holds |
|---|---|
| `pos_audit_auto_runs` | Nightly audit results |
| `pos_company_links` | Links to other stores |
| `pos_company_emails` | The shop's sign-in address and its aliases |
| `pos_product_email` | Product notes |

### Other risks worth knowing
- **PINs are stored as plain text.** They're never sent to the browser, but a
  database leak would expose them. Hashing them is the fix.
- **Gmail tokens are encrypted at rest** (`lib/secrets.js`, AES-256-GCM) with
  `TOKEN_ENCRYPTION_KEY`, an environment variable kept out of the database.
  On each start, any token still in plain text is encrypted in place. **If the
  key is lost or changed, every shop has to reconnect Gmail** — keep a copy.
  Processor tokens (Maverick, Payarc) are still plain text; the same helper
  would cover them.
- **Who controls customer data:** the shop is the controller; SkySale is its
  processor/service provider (Terms §8, Privacy Policy §2).
- **Sessions live in server memory**, so everyone is signed out on each deploy.
- **Full email bodies** are kept in `sent_emails` and `campaigns` for as long as
  the shop exists.
