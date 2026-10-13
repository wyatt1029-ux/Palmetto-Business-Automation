# South Carolina sales-tax note for PBA billing

Internal owner reference. This records written guidance received from the South Carolina Department of Revenue (SCDOR); it is not a tax determination for every PBA service. Keep the original SCDOR email with the business tax records.

## Written guidance received

SCDOR's Sales & Use Tax unit responded to PBA's description of its monthly website service: hosting/deployment oversight, monitoring, routine maintenance and updates, reasonable fixes, and up to one hour of basic text or photo changes. SCDOR referred PBA to Private Letter Ruling #10-2 and said the subscription and associated fees described are subject to South Carolina sales tax, regardless of itemization. SCDOR said PBA must obtain a retail license and collect tax using the rate applicable to the subscriber's location.

Important qualification: SCDOR's advisory-opinion search currently labels PLR #10-2 “Superseded.” The written answer PBA received is specific to the facts PBA submitted, but retain the actual email and ask SCDOR whether its conclusion remains applicable before treating the old ruling as current authority or extending the answer to different services. The ruling itself explains that private letter rulings apply to the named taxpayer and can be superseded by later authority.

Treat this as guidance for the service described to SCDOR. It does not, by itself, settle the tax treatment of a separately contracted one-time website build, unrelated consulting, or every future PBA offering. Ask SCDOR or a South Carolina tax professional if scope or contract terms differ materially, or if the treatment of a one-time build is uncertain.

## Tidal Marine Electronics billing reference

- Service start: October 7, 2026.
- Monthly service: $150, including up to one hour of basic picture or text changes.
- Billing cadence discussed: full monthly fee beginning on the service start date and recurring on the 7th; no mid-month proration.
- Subscriber location supplied: 937 Wappoo Road Unit 3B, Charleston, SC 29407. The address was checked against Charleston city parcel/municipal information and appears to be within the City of Charleston.
- Current rate reference: 9% for Charleston, Charleston County, in the SCDOR municipality rate table available on the review date. Confirm the exact delivery address and current rate in SCDOR's address/rate lookup at invoice time; municipal boundaries and rates can change.

If $150 is the agreed **pre-tax** monthly price, the reference calculation is $150.00 × 9% = $13.50 tax, for $163.50 due each monthly period. Confirm the agreement permits adding tax on top before issuing. If $150 was instead agreed as a tax-inclusive total, do not add $13.50; at a 9% rate, the included tax portion of $150 is approximately $12.39 (rounded to cents), with $137.61 as the pre-tax portion. Confirm the intended price treatment with the customer and SCDOR before first billing.

Suggested invoice description, subject to the agreed tax-inclusive/exclusive price:

> Website hosting, deployment oversight, monitoring, routine maintenance, reasonable fixes, and up to one hour of basic picture or text changes — monthly service beginning October 7, 2026. Renews monthly on the 7th. Monthly service is billed in full and is not prorated for a partial month.

For each invoice, show the service subtotal, approved sales-tax amount, and total clearly. The PBA Books recurring-billing improvement is still local until its migration and code are approved and deployed. Once live, the intended flow is to send and collect the initial-period invoice first, then create a separate Stripe payment-authorization link; after the customer authorizes a card, future monthly renewals use separate service and manually entered tax lines. Until that change is deployed and verified, do not promise an itemized tax line or a renewal date aligned to the 7th from PBA Books' recurring Stripe flow. The accounting ledger records entered tax to Sales Tax Payable.

## Operational checklist

1. Confirm the retail license is active before collecting tax.
2. Confirm the customer location and current tax rate using SCDOR's official address lookup/rate table.
3. Confirm whether the written $150 price is tax-inclusive or tax-exclusive; do not assume.
4. Enter only the approved tax amount in PBA Books' manual tax field. PBA Books does not calculate a rate or file returns.
5. Check the customer-facing Stripe invoice/receipt and the ledger posting. Tax recorded in Books is credited to Sales Tax Payable; it is a liability, not service revenue.
6. Track filing frequency, collected tax, and remittance in the appropriate SCDOR account. Consult SCDOR or a qualified tax professional for licensing, sourcing, filing, and treatment questions.

## Official references

- [SCDOR: Private Letter Ruling #10-2 — Sales and Use Tax on Online Subscription Services](https://www.dor.sc.gov/sales-use-tax-online-subscription-services) (SCDOR's advisory-opinion search currently labels it superseded; see qualification above.)
- [SCDOR: Retail License](https://www.dor.sc.gov/businesses/apply-business-tax-account/licensing-retail-license)
- [SCDOR: 2026 municipality tax-rate table (ST-575)](https://dor.sc.gov/sites/dor/files/forms/ST575.pdf)
- [SCDOR: Sales and use tax index and local-rate information](https://www.dor.sc.gov/sales-use-tax-index)
- [City of Charleston: Wappoo/Dupont parcel and city rezoning information](https://www.charleston-sc.gov/DocumentCenter/View/11366/DupontWappooParcels_CityRezoningInfo08312016?bidId=)

**Review date:** October 13, 2026. Reconfirm rates and requirements before relying on this note for a later invoice or filing.
