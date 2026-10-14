# Examples

These examples are illustrative workflows, not customer case studies or guarantees. Adapt them to your business, scope, and review requirements.

## Common estimating scenarios

### A simple one-drawing enquiry

**Situation:** A customer sends one drawing for six identical brackets.

**Suggested workflow:**

1. Create one RFQ and attach the drawing.
2. Create one asset for the bracket package.
3. Add one takeoff item with quantity six.
4. Link the relevant material and labour rates.
5. Add any one-off finishing or delivery allowance.
6. Review the total and prepare one quote option.

**Why:** The scope is simple. Extra project structure would add work without making the estimate clearer.

### One RFQ with several work packages

**Situation:** A tender contains structural steel, stairs, handrails, and cladding.

**Suggested workflow:**

1. Keep one RFQ for the customer enquiry.
2. Group files into assets for each package.
3. Estimate each asset independently.
4. Use project structure inside a package only when it needs a deeper breakdown.
5. Include or exclude assets when preparing quote options.

**Why:** Assets separate practical estimating packages while preserving one enquiry and one commercial workspace.

### A supplier rate needs checking

**Situation:** Several suppliers can provide the same material.

**Suggested workflow:**

1. Link the material to the relevant companies in setup data.
2. Keep the reusable material record clear about its standard unit and default rate.
3. Confirm the current supplier quote before relying on the rate.
4. Update the job-specific estimate when the current price differs.

**Why:** Company relationships help discovery, but they do not automatically create supplier-specific price agreements.

### An email becomes an RFQ

**Situation:** A connected mailbox receives an enquiry with drawings attached.

**Suggested workflow:**

1. Review the email and its RFQ detection status.
2. Choose **Create RFQ**.
3. Review the prepared details and any company or person match.
4. Confirm all attachments arrived in the intake form.
5. Correct ambiguous or missing details.
6. Save the RFQ only when the preview is accurate.

**Why:** Email preparation reduces retyping while keeping the user in control of the new record.

### An addendum arrives after estimating starts

**Situation:** A customer sends a revised drawing and changes one package.

**Suggested workflow:**

1. Add the revised file to the existing RFQ.
2. Identify the affected asset.
3. Compare the new evidence with the earlier scope.
4. Update affected takeoffs, costs, exclusions, and lead time.
5. Recheck quote totals.
6. Export the revised quote to record a new commercial snapshot.

**Why:** The new file belongs with the original enquiry, but only the affected estimate scope should change.

### A repeated fabrication job

**Situation:** The business regularly quotes similar fabricated platforms.

**Suggested workflow:**

1. Create a project structure template for the repeatable phases.
2. Create an estimate template for the familiar estimating structure.
3. Create cost presets for recurring bundles such as fabrication setup or installation.
4. Apply the reusable starting points to the new RFQ.
5. Remove irrelevant items and add current-job scope.

**Why:** Reuse improves consistency, but current RFQ evidence remains authoritative.

### Ask Kwantflow to combine records and arithmetic

**Situation:** You need the cost of 250 kg of a material already stored in the workspace.

**Example request:**

> Find the galvanised steel plate in this workspace and calculate the cost of 250 kg using its recorded rate.

Kwantflow AI can search the workspace record, retrieve its details, use an exact calculation, and explain the result. Check the selected record, unit, rate, and currency before using the answer commercially.

### Prepare several records for approval

**Situation:** You want to add several known materials from a supplier list.

**Example request:**

> Prepare these materials for approval: 10 mm galvanised plate at 4.85 AUD per kg, SL82 reinforcing mesh at 72.50 AUD per sheet, and scaffold installation crew at 1,280 AUD per day.

Review the grouped proposal carefully. Nothing is written until you approve it, and grouped changes are approved or discarded together.

### Work across two businesses

**Situation:** One user estimates for two independent businesses.

**Suggested workflow:**

1. Create one workspace for each business.
2. Configure each workspace's profile, catalogues, knowledge, and email connections separately.
3. Check the active workspace before creating or importing records.
4. Switch workspaces when moving to the other business.

**Why:** Workspace separation prevents customer, pricing, mailbox, and estimating context from being mixed.

## Email RFQ to quote

This worked example is illustrative. Names, quantities, rates, and decisions are examples rather than customer results or guarantees.

### Situation

A builder emails a request for a fabricated steel access platform. The message includes a drawing, a short scope note, and a required return date.

The estimator wants to avoid retyping the enquiry while keeping control of every business record and commercial decision.

### 1. Review the email

Mail RFQ Detection marks the message as a possible RFQ.

The estimator opens it and checks the sender, subject, body, requested date, listed attachments, and whether the enquiry belongs to the active workspace.

The detection result is a review aid. The estimator still decides whether to create an RFQ.

### 2. Prepare the RFQ intake

The estimator chooses **Create RFQ**. Kwantflow prepares a reviewable intake using the email details.

The estimator checks the RFQ name and number, company and requester, priority and dates, notes, and attachments. A possible existing person match is confirmed rather than assumed.

No RFQ exists until the reviewed intake is saved.

### 3. Organise the evidence

Inside the new RFQ, the estimator reviews the drawing and scope note, then creates one asset for the platform package.

Because this is one coherent assembly, a complex project hierarchy would add little value. The estimator keeps the structure simple.

### 4. Build the estimate

The estimator creates takeoff items for the main platform components and links reviewed workspace records where appropriate:

- steel material by its normal pricing unit;
- workshop labour;
- equipment or consumable allowances;
- subcontract finishing if required;
- site installation where included.

Any quantity taken from the drawing is checked against dimensions and notes. Any allowance not supported by evidence is recorded clearly as an assumption.

### 5. Review current rates

The workspace contains a default steel rate and linked suppliers. The estimator checks the latest supplier information before relying on the default.

If the current supplier quote differs, the job estimate is updated. The shared catalogue is changed only when the new value should become the reusable default.

### 6. Prepare the quote

The estimator includes the platform asset, reviews the markup, and checks customer identity, scope, price, tax, lead time, inclusions, exclusions, validity, and revision label.

The first export becomes the reviewed commercial snapshot for that response.

### 7. Generate the email draft

The estimator chooses **Generate draft** so Kwantflow AI prepares the email draft around the quote.

Before sending, the estimator confirms that the generated subject and body agree with the quote, especially the total, currency, RFQ number, option, and lead time.

### What this example demonstrates

- Email can reduce intake retyping without creating records automatically.
- Attachments stay visible for review rather than being hidden inside an AI step.
- Existing company and person matches require confirmation.
- Reusable rates are starting points, not proof of a current supplier price.
- Quote and email output remain user-reviewed.

## Multi-package tender

This worked example is illustrative. Adapt the structure to the actual tender, responsibilities, and review process.

### Situation

A tender contains structural frames, stairs, handrails, and cladding. Several drawings apply across packages, while specialist files apply to only one package.

The estimator needs separate working estimates but one commercial response.

### 1. Keep one RFQ

The customer issued one enquiry with one due date, so the estimator keeps it as one RFQ.

The shared RFQ area holds the customer and requester, common correspondence, due date, priority, full file set, and project-wide notes.

### 2. Create practical assets

The estimator groups the work into four assets:

1. Structural frames
2. Stairs
3. Handrails
4. Cladding

An asset represents a practical package that can be reviewed and estimated independently. A drawing may still need to be considered across more than one package.

### 3. Add deeper structure only where useful

The frame package needs separate engineering, fabrication, coating, and erection sections. The estimator applies a project structure template and removes irrelevant nodes.

The handrail package is simple enough to estimate without a deeper hierarchy.

### 4. Estimate each package

Each asset receives its own takeoff items and cost rows. The estimator links reusable records, checks quantities, records package assumptions, avoids counting shared mobilisation twice, and keeps exclusions visible.

### 5. Handle shared costs deliberately

Site mobilisation applies across several assets. The estimator chooses one clear treatment according to the business process.

The important point is that the cost is included once and remains understandable during review.

### 6. Prepare quote options

The estimator creates options such as:

- Base: frames, stairs, and handrails
- Alternative: base scope plus cladding
- Supply only: selected fabricated packages without installation

Each option is reviewed against the intended asset selection and commercial conditions.

### 7. Respond to an addendum

A revised stair drawing arrives before submission.

The estimator adds the file to the existing RFQ, updates the Stairs asset, reviews shared consequences, recalculates quote options, and exports a new revision.

The unaffected package estimates remain intact unless the addendum changes them.

### What this example demonstrates

- One customer enquiry does not require one oversized estimate.
- Assets separate working packages while preserving common RFQ context.
- Project structure is optional and should clarify rather than inflate the job.
- Shared costs need an explicit treatment to prevent duplication.
- Quote options can recombine reviewed packages for different commercial offers.

## Repeat work with templates

This worked example is illustrative. Templates improve consistency, but they do not prove the current scope.

### Situation

A fabrication business regularly quotes access platforms with similar engineering, workshop, coating, and installation activities.

The assemblies are related, but dimensions, materials, access conditions, and customer requirements vary.

### 1. Build the first estimate carefully

The estimator completes a reviewed platform estimate with clear takeoff items, linked sources, separate workshop and site activities, documented assumptions, and a sensible project structure.

This estimate becomes a candidate for reuse only after it is understandable without relying on memory of the original job.

### 2. Save reusable layers

The estimator saves:

- an estimate template for the broader platform estimate;
- a cost preset for recurring workshop fabrication rows;
- a project structure template for the standard phases.

These layers solve different problems. They should not become three duplicate ways to store the same vague idea.

### 3. Start the next RFQ

A new platform RFQ arrives with different dimensions and no site installation.

The estimator applies the estimate template, then:

- replaces quantities using the new drawing;
- confirms the material specification;
- removes installation scope;
- reviews current rates;
- changes coating requirements;
- updates inclusions and exclusions.

### 4. Use aliases and descriptions

The workspace uses both “platform” and “access deck.” The estimator adds a useful alias so the template is easier to find.

The description states when the template is appropriate and warns that installation may need to be removed.

### 5. Decide whether to update the template

The new RFQ has an unusual weekend access allowance. The estimator keeps that allowance in the job instead of adding it to the shared template.

Later, the business adopts a new standard inspection step for every platform. That repeatable improvement belongs in the template.

### What this example demonstrates

- Reuse should begin from a reviewed estimate.
- Estimate templates, cost presets, and project structure templates have different scopes.
- Applying a template is the beginning of review, not the end.
- One-off conditions belong in the job.
- Repeatable process improvements belong in shared setup data.

## Supplier and rate review

This worked example is illustrative. Linked companies and default rates organise knowledge; they do not replace a current supplier quotation.

### Situation

An estimator needs 250 kg of galvanised steel plate. The workspace contains one material record linked to three possible suppliers.

The material has a default rate, but the current job has an urgent delivery requirement.

### 1. Find the reusable material

The estimator searches the Materials catalogue using the normal name or an alias such as “gal plate.”

The record provides a consistent material identity, unit, category and specification context, default rate and currency, and list of linked companies.

### 2. Check linked companies

The company relationships identify businesses that commonly supply the material. They do not establish a preferred supplier, an exclusive agreement, or a price for this RFQ.

The estimator reviews the available companies and obtains current commercial information as required.

### 3. Compare like with like

Before comparing supplier values, the estimator confirms:

- the same material specification;
- the same pricing unit;
- the same currency;
- whether freight, cutting, minimum order, or tax is included;
- the required delivery date;
- the validity of each quotation.

A lower number is not automatically the better job cost if the basis differs.

### 4. Calculate the material cost

If the selected reviewed rate is 4.85 AUD per kg, the direct arithmetic for 250 kg is:

`250 × 4.85 = 1,212.50 AUD`

The estimator may ask Kwantflow AI to find the material and calculate the result. The record, unit, rate, currency, and any additional supplier charges are still checked before use.

### 5. Decide what to update

If 4.85 AUD per kg represents the new normal reusable rate, the estimator updates the material record.

If it is an urgent one-off quote including special freight, the estimator keeps that value in the job estimate instead of replacing the workspace default.

### 6. Maintain relationships separately

Adding or removing a company relationship does not delete the company or material.

The relationship answers “who is relevant to this record?” It does not copy rates between records or create supplier-specific pricing automatically.

### What this example demonstrates

- Aliases improve record discovery.
- Multiple companies can be related to one catalogue record.
- Relationships and prices remain separate concepts.
- Units, currencies, and rate basis must match before arithmetic is commercially meaningful.
- Reusable defaults should not be overwritten by unusual job conditions.

## Related guides

- [Work inside an RFQ](04-rfqs-and-files.md#work-inside-an-rfq)
- [Build takeoffs and costs](05-estimating.md#build-takeoffs-and-costs)
- [Quote options and revisions](06-quotes.md#quote-options-and-revisions)
- [Build reusable setup data](07-setup-data.md#build-reusable-setup-data)
