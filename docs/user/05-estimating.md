# Estimating

Each Asset can have a working estimate built from takeoff items and cost components. This page explains how to build and review it.

## Create and review an estimate

Each Asset can have a working estimate. The estimate is where you turn files, scope, quantities, rates, and assumptions into pricing.

This is the main decision area of the workflow. The estimate should be strong enough that the quote output becomes a packaging step, not a rescue step.

### Create an estimate

1. Open the Asset.
2. Start or open the estimate.
3. Add line items manually, from setup records, or from templates.
4. Check quantity, unit, rate, classification, and notes.

### Common ways to build the estimate

- Start from your own reusable setup data.
- Start from a template for repeatable work.
- Build manually when the package is unusual.
- Use AI drafting as a first pass, then review it line by line.

### Review the estimate

Before using an estimate in a quote, check:

- every required scope item is included
- rates are current
- quantities are sensible
- units match the way you price the work
- classifications and cost codes are correct
- totals match your expectations

### Good review questions

- What did we price?
- What did we not price?
- Are bought-out items using the right supplier context?
- Do units and rates match how this work is actually sold?
- If another estimator opened this tomorrow, would the logic still be clear?

### Expected result

The Asset has a reviewed estimate that can feed the quote.

## Build takeoffs and costs

A takeoff item describes a measurable piece of scope. Cost components describe what it costs to deliver that scope.

Together they form the working estimate inside an asset.

### Create a takeoff item

Use one takeoff item for one clearly measurable part of the work.

Examples:

- 250 kg of galvanised plate;
- 18 metres of handrail;
- 6 fabricated brackets;
- 2 days of site installation;
- one mobilisation allowance.

Give the item a recognisable name and record the quantity and unit. Add a description when the measurement basis or included work is not obvious.

### Add cost components

Cost components can represent:

- materials;
- labour;
- equipment;
- subcontract work;
- manual allowances.

For each row, review the category, name, quantity, unit, rate, and total.

### Link workspace records

When a matching material or rate already exists in the workspace, link it instead of typing a disconnected copy.

You can search workspace data by name, code, or alias. Linking makes the source easier to recognise and lets you start from a known unit and rate.

The current estimate remains the job-specific working record. Review the quantity and rate even when they came from reusable setup data.

### Add manual rows

Use a manual row when the cost is specific to this job and does not belong in the reusable catalogue.

Examples:

- a one-off freight allowance;
- a special permit fee;
- temporary access required only for this site;
- a customer-specific testing charge.

Do not add every one-off allowance to workspace setup data. Reusable catalogues work best when they contain rates the business expects to use again.

### Check units before rates

A correct rate with the wrong unit produces the wrong estimate.

Before accepting a total, confirm that:

- the takeoff quantity uses the intended unit;
- the cost row rate uses a compatible basis;
- conversions are deliberate;
- currency is consistent;
- decimal places have not changed the intended value.

For example, a rate per tonne must not be multiplied directly by a quantity in kilograms without conversion.

### Use classifications and cost codes

Classifications organise estimate content for review and reporting. They do not replace the takeoff or cost row.

Apply them when your business needs a consistent breakdown across jobs, such as trade, phase, cost centre, or customer coding.

### Review AI drafts

An AI draft is a starting point, not an approved estimate.

Check every proposed item against the source file. Pay particular attention to:

- dimensions and quantities;
- units;
- material grades and specifications;
- assumed rates;
- exclusions and missing scope;
- evidence references.

Keep, edit, or remove each item based on the actual RFQ evidence.

### Example: steel plate calculation

Suppose a takeoff contains 250 kg of plate and the linked material rate is 4.85 AUD per kg.

```text
250 kg × 4.85 AUD/kg = 1,212.50 AUD
```

Then add any separate cutting, fabrication, coating, freight, or installation components required by the scope.

## Related guides

- [Materials](07-setup-data.md#materials)
- [Classifications](07-setup-data.md#classifications)
- [Draft an estimate with AI](08-local-ai.md#draft-an-estimate)
- [Prepare a quote](06-quotes.md#prepare-a-quote)
- [Estimate and quote issues](11-troubleshooting.md#estimate-and-quote-issues)
