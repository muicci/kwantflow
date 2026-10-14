# Setup data

Setup data is the shared layer of companies, people, materials, rates, presets, templates, and classifications you reuse across many RFQs.

## Build reusable setup data

Reusable setup data is the shared layer you want to use again across many RFQs.

The goal is not to store everything. The goal is to store the records that genuinely save time and improve consistency.

### Good candidates for reusable setup data

Add setup records when they are likely to be used again, such as:

- common companies and people
- frequently priced materials
- standard labour, equipment, and subcontract rates
- repeatable classifications and cost codes
- reusable cost presets or estimate templates

### Keep one-off details out of the catalogue

Leave information in the RFQ or estimate instead when it is:

- unique to one customer request
- temporary or not verified yet
- too vague to reuse safely
- only relevant because of one unusual package

### A simple way to decide

Ask:

- Will we use this again?
- Would another estimator understand why this record exists?
- Is the value stable enough to trust later?
- Is this better as a reusable record or just a job note?

If the answer is unclear, keep it in the RFQ first.

### Example decisions

#### Good reusable record

`Mild steel plate 10 mm, kg rate, linked suppliers`

This is a normal reusable setup record.

#### Better left in the RFQ

`Urgent weekend crane allowance for Builder X tender revision`

This is job-specific and should usually stay in the estimate or quote notes instead of the shared catalogue.

#### Good reusable company relationship

Linking a supplier to materials or subcontract rates you buy from repeatedly is usually worth keeping.

#### Better reviewed before import

A spreadsheet that mixes old archived suppliers, duplicate names, and unclear currencies should be cleaned first instead of imported directly.

### Build in layers

The simplest reliable order is:

1. companies and people
2. materials and rates
3. classifications
4. presets and templates

This keeps dependencies easier to review.

### Use AI carefully here

Ask Kwantflow can prepare grouped setup-record proposals, but you still approve or discard them yourself.

Use AI to save setup time, not to lower the review standard.

## Companies

Companies are shared records in your workspace. They can represent clients, suppliers, subcontractors, consultants, builders, or other organisations you work with.

### When to add a company

Add a company when you want to reuse it across RFQs, rates, quotes, or contact details.

### People linked to companies

People are linked under company records. This keeps company details and person contact details together.

### Company links to catalogue records

You can also link companies to reusable catalogue records such as:

- materials
- labour rates
- equipment rates
- subcontract rates

These links help you keep supplier and delivery context attached to the records you reuse most often.

You can manage these links from either side:

- from the company record
- from the catalogue record

Removing a relationship does not delete either record.

### Good company records include

- company name
- role or type
- contact person
- email and phone
- address
- tax or business identifier where relevant

### Importing companies

Use [Setup import](07-setup-data.md#setup-import) when you already have company data in a spreadsheet.

If setup import can match a supplier or company clearly, it can create the relationship for you. If the match is ambiguous, it should stop and ask for review instead of guessing.

## People and contacts

People are individual contacts in the active workspace. Link a person to a company when they represent that organisation.

### What to record

A person can include:

- first and last name;
- role or job title;
- email address;
- phone number;
- linked company.

Use the role field for a recognisable position such as Estimator, Buyer, Project Manager, Engineer, or Accounts Payable.

### Create a person from a company

Open the company and add the person from its **People** area when the relationship is already known.

This is useful when entering several contacts for one customer or supplier.

### Create or match a requester during RFQ intake

When creating an RFQ, select an existing person when the requester is already known.

If the email address or name is ambiguous, review the match instead of linking the wrong person. Two people can share a name, and one person can use different email addresses.

### Choose a useful role

Role examples:

- **Estimator** — prepares or reviews the customer's tender package.
- **Buyer** — requests pricing or places purchase orders.
- **Project Manager** — coordinates scope, dates, and delivery.
- **Engineer** — answers technical questions or issues revisions.
- **Accounts Payable** — handles invoices rather than RFQ scope.

Roles help users recognise who to contact, but they do not grant app permissions.

### Keep company and person details separate

Use the company record for organisation-level information such as business identity, address, website, and commercial notes.

Use the person record for the individual's name, role, email, and phone.

Avoid replacing the person name with a department label such as “Estimating Team” unless that is genuinely how the requester identifies the contact.

### Example: one company, several contacts

**Atlas Structural** may have:

- Mina Hart — Estimator
- Noah Kim — Project Manager
- Priya Shah — Accounts Payable

Link the RFQ requester to Mina while retaining Noah and Priya for later project or payment communication.

### When a person changes company

Update the link only after confirming the change. Keep the person's contact information current and avoid changing historical RFQ meaning without review.

### Before deleting a person

Check whether the person is referenced by active RFQs or other records. Kwantflow may prevent deletion when removing the person would break an important business relationship.

## Materials

Materials are reusable workspace records for items you regularly price in estimates.

### Material fields

A material can include:

- name;
- optional code;
- unit;
- category;
- specification;
- aliases;
- default rate;
- currency;
- linked companies.

### Use specific names

Choose a name that distinguishes the material from similar records.

Good examples:

- Galvanised Steel Plate 10 mm
- Reinforcing Mesh SL82
- SHS 100 × 100 × 6 mm
- Stainless Steel 316 Sheet 2 mm

Avoid a catalogue full of names such as “Steel”, “Plate”, or “Mesh” with no identifying detail.

### Choose the unit first

The unit defines how the default rate should be interpreted.

Examples:

- kg for material sold by mass;
- m for linear products;
- m² for sheet or coating area;
- ea for discrete items;
- sheet for standard sheet products.

Do not enter a per-tonne rate against a per-kilogram unit without converting it.

### Category and specification

Use **Category** for broad grouping, such as Steel, Concrete, Timber, Consumable, or Fastener.

Use **Specification** for distinguishing technical detail, such as grade, finish, thickness, treatment, or standard.

Example:

```text
Name: Galvanised Steel Plate 10 mm
Category: Steel
Specification: 10 mm, hot-dip galvanised
Unit: kg
```

### Codes and aliases

Use a code when the business already has a catalogue or purchasing reference.

Aliases improve search for alternative names, abbreviations, or supplier terminology. For example:

- gal plate
- 10 mm plate
- HDG plate

Do not use aliases to store unrelated products.

### Default rates

A default rate is a reusable starting value. It is not proof of a current supplier quote.

Before using it commercially, confirm:

- currency;
- unit;
- effective pricing date or source outside the record where relevant;
- whether freight, waste, tax, cutting, or finishing is included;
- whether the job needs a different supplier or quantity break.

### Linked companies

Link companies that supply or are otherwise associated with the material. More than one company can be linked.

The relationship improves discovery; it does not create supplier-specific price tiers or contracts.

### Example: plate with two suppliers

Create one clear material record, then link both approved suppliers. Use the estimate's job-specific rate when the current quotes differ.

## Labour rates

Labour rates represent the cost or charge used for a type of work in an estimate.

### Labour rate fields

A labour rate can include:

- rate name;
- optional code;
- work centre;
- category;
- aliases;
- unit;
- currency;
- default rate;
- linked companies.

### Name the activity clearly

Good examples:

- Workshop Fabrication Labour
- Certified Welder
- Site Installation Crew
- Mechanical Design Engineer
- Project Supervision

Avoid using one generic “Labour” rate when materially different activities have different costs.

### Work centre and category

Use **Work Centre** for the practical location, machine area, or operational centre, such as Welding, Laser, Workshop, or Site.

Use **Category** for a broader grouping, such as Fabrication, Installation, Engineering, or Site Labour.

Keep the distinction consistent across the workspace so search and review remain useful.

### Choose a time unit

Common labour units include hour and day.

Check whether a day rate represents:

- one person-day;
- one crew-day;
- a standard number of hours;
- overtime or ordinary time.

If the meaning is not obvious from the name, clarify it in the business's reusable guidance or estimate notes.

### Default rate considerations

Decide whether the rate is intended as internal cost, selling rate, or another business convention, then use that convention consistently.

Review allowances such as:

- payroll overhead;
- leave and statutory costs;
- supervision;
- travel;
- overtime;
- consumables;
- margin.

Do not silently mix rates based on different conventions.

### Linked companies

Link a company when the rate is associated with an external labour provider or another relevant organisation. Internal labour rates do not require a company link.

### Example: workshop and site labour

Keep separate records for workshop fabrication and site installation when the units, costs, or operating conditions differ. This makes later review clearer than applying one blended rate everywhere.

## Equipment rates

Equipment rates represent the cost or charge for using plant, machinery, vehicles, tooling, or other equipment in an estimate.

### Equipment rate fields

An equipment rate can include:

- rate name;
- optional code;
- category;
- work centre;
- aliases;
- unit;
- default rate;
- currency;
- linked companies.

### Use recognisable names

Examples:

- 20 t Mobile Crane
- CNC Laser Cutter
- Welding Generator
- Scissor Lift
- Delivery Truck

Include capacity or type when it materially changes the rate.

### Category and work centre

Use **Category** for a broad family such as Plant, Machine, Vehicle, Access Equipment, or Tooling.

Use **Work Centre** for where the equipment belongs or is normally used, such as Workshop, Site Plant, Cutting, or Logistics.

### Choose a rate unit

Common units include hour, day, week, each, or kilometre where supported by the business workflow.

Confirm what the rate includes:

- operator;
- fuel or power;
- mobilisation;
- delivery and collection;
- minimum hire period;
- standby time;
- attachments or accessories.

Add separate estimate rows when these costs should remain visible rather than hiding them inside one rate.

### Internal equipment versus hired plant

An internal machine rate may include ownership and operating costs. A hired-equipment rate may come from a supplier quote.

Keep them as separate records when the commercial basis differs.

### Linked companies

Link relevant hire companies, suppliers, or service providers. Multiple companies can be linked to one equipment rate.

Confirm current availability and pricing before committing to a quote.

### Example: crane hire

A crane estimate may need separate rows for crane time, mobilisation, dogman or rigger labour, travel, and permits. Whether these are bundled depends on the supplier offer and how your team wants the estimate reviewed.

## Subcontract rates

Subcontract rates represent work delivered by an external trade, specialist, or service provider.

### Subcontract rate fields

A subcontract rate can include:

- rate name;
- optional reference code;
- category or trade;
- aliases;
- unit;
- default rate;
- currency;
- linked companies.

### Name the service, not only the supplier

Good examples:

- Scaffold Installation Crew
- Hot-Dip Galvanising per kg
- NDT Weld Inspection
- Powder Coating per m²
- Structural Engineering Review

The supplier relationship belongs in linked companies. Keeping the service name independent makes the record easier to reuse with several providers.

### Category and aliases

Use a category for the trade or service family, such as Coating, Access, Testing, Engineering, Transport, or Installation.

Aliases help users find the same service under familiar wording, such as:

- scaffold crew
- access scaffold
- temporary works

### Choose the right unit

The rate may be per hour, day, item, mass, area, length, or lump sum depending on the service.

Confirm whether the supplier's rate includes:

- materials;
- labour;
- mobilisation;
- minimum charges;
- testing certificates;
- freight;
- tax;
- travel or accommodation.

### Linked companies

Link every relevant approved provider. More than one provider can be linked to the same service.

The linked companies are references, not a live supplier quote comparison. Use current job evidence when suppliers offer different prices or conditions.

### Default rates and one-off quotes

Store a default rate when it is a useful repeatable starting point. Keep a one-off supplier quotation in the RFQ files and use its job-specific value in the estimate.

### Example: galvanising

A reusable galvanising rate may be priced per kilogram, while the current supplier also applies a minimum batch charge and freight. Add those separate job-specific costs when they are not included in the reusable rate.

## Templates and presets

Templates and presets reduce repeated setup while keeping each job editable. Use them for repeatable patterns, not as permanent rules that must fit every RFQ.

| Reusable item | What it helps you reuse | Example | Where to read more |
| --- | --- | --- | --- |
| Project structure template | A hierarchy of phases, areas, trades, or packages | Engineering, Fabrication, Coating, Installation | [Organise project structure](04-rfqs-and-files.md#organise-project-structure) |
| Estimate template | A broader starting structure for a familiar type of estimate | Standard fabricated stair estimate | [Estimate templates](07-setup-data.md#estimate-templates) |
| Cost preset | A smaller bundle of recurring cost components | Workshop fabrication labour and consumables | [Cost presets](07-setup-data.md#cost-presets) |
| Quote preset | A repeatable quote option or commercial presentation | Supply only / Supply and install options | [Quote options and revisions](06-quotes.md#quote-options-and-revisions) |

### Names, codes, aliases, and notes

Use:

- a clear name for people browsing the list;
- an optional code when your business already uses one;
- aliases for common alternative names that improve search;
- notes for concise internal guidance.

Do not put job-specific customer information in a workspace-wide template unless it is intentionally reusable.

### When to update a template

Update a reusable item when the business has learned a repeatable improvement, such as a missing standard cost or a clearer project breakdown.

Do not change a template merely to fix one unusual job. Adjust that job directly unless the change should apply to future work.

## Cost presets

A cost preset saves the cost rows from one takeoff item so you can reuse that cost pattern elsewhere.

It is useful when the same combination of materials, labour, equipment, subcontract work, or allowances appears repeatedly.

### When to use a cost preset

Use a cost preset for a repeatable group of costs inside a larger estimate, such as:

- workshop fabrication labour and consumables;
- a standard installation crew and equipment allowance;
- coating preparation and application;
- testing, documentation, or mobilisation;
- a recurring bought-out service.

[Use an estimate template](07-setup-data.md#estimate-templates) when you want to reuse the broader estimate, including its takeoff-item structure.

### Save a cost preset

1. Open an RFQ asset and its estimate.
2. Build and review the cost rows on the takeoff item you want to reuse.
3. Choose the action to save those rows as a cost preset.
4. Give the preset a clear name.
5. Add an optional code, description, and aliases.
6. Review the save warning and confirm.

The saved preset belongs to the current workspace.

### Name presets for recognition

Choose a name that explains the included work, not the job where it was created.

Good examples:

- Workshop fabrication pack
- Standard site installation crew
- Galvanising preparation
- Mobilisation and closeout

Use the description to record what the preset is intended to include. Add aliases when your team uses other names for the same work.

### Apply a preset

When adding or editing a takeoff item, select the preset as a reusable cost source. Review the inserted rows before relying on the result.

After applying it, you can adjust job-specific quantities, rates, units, notes, and links without changing the saved preset.

### Keep presets reliable

- Build the source takeoff item carefully before saving it.
- Remove customer-specific wording that should not appear on future jobs.
- Check whether linked workspace rates still represent current commercial values.
- Keep one clear preset for each recurring pattern instead of creating near-duplicates.
- Mark an obsolete preset inactive when it should remain in history but should not be selected for new work.

### Example

A fabrication takeoff item regularly needs cutting labour, welding labour, workshop equipment, and consumables.

Save those reviewed rows as **Workshop fabrication pack**. On the next RFQ, apply the preset and change the quantities and any job-specific rates rather than rebuilding the same rows manually.

## Estimate templates

An estimate template saves a broader estimate scaffold so a similar RFQ can start from a reviewed structure.

It is most useful when your business repeatedly prices the same kind of assembly, package, or service but still needs to adjust each job.

### When to use an estimate template

Use an estimate template for repeatable estimate structures such as:

- a fabricated stair or platform;
- a structural frame package;
- a machine rebuild;
- a standard maintenance scope;
- a supply-and-install package with familiar work sections.

[Use a cost preset](07-setup-data.md#cost-presets) when you only need to reuse the cost rows from one takeoff item.

### Save an estimate template

1. Open an asset estimate that has a useful, reviewed structure.
2. Confirm its takeoff items and cost rows are suitable for future work.
3. Choose **Save template** in the estimate setup area.
4. Enter a clear name.
5. Add an optional code, description, and aliases.
6. Review the save warning and confirm.

The template is saved in the current workspace and does not become available in other workspaces.

### Apply a template

1. Open the target asset estimate.
2. Open the Estimate Template selector.
3. Choose the relevant active template.
4. Review the resulting estimate before continuing.

Treat the template as a starting point. Remove irrelevant work, add missing job-specific scope, and verify every quantity, rate, assumption, and source against the current RFQ.

### Name templates clearly

Prefer names that describe the reusable work:

- Basic fabricated platform
- Structural frame supply only
- Pump overhaul standard scope
- Small site installation package

Use aliases for terms your team may search for. Use the description to explain when the template is appropriate and what still requires review.

### What a template cannot decide

A template does not prove that the current RFQ contains the same:

- dimensions or quantities;
- materials and specifications;
- access or installation conditions;
- exclusions and commercial terms;
- supplier rates or lead times.

Current RFQ evidence remains the source of truth.

### Maintain templates

- Update a template when a change is genuinely reusable across future work.
- Fix one unusual RFQ in that estimate instead of changing the shared template.
- Avoid duplicate templates with slightly different names.
- Mark old templates inactive when they should no longer be selected for new work.
- Review templates periodically after rates, methods, or standard scope change.

## Classifications

Classifications help organise estimate information in a consistent way.

Use them when your company, client, reporting process, or estimating method needs cost codes or structured categories.

If your team prices similar work repeatedly, classifications make reviews faster because everyone can follow the same structure.

### Classification systems

A classification system is the overall coding structure.

Examples include:

- company cost code system
- trade package structure
- project reporting structure
- custom estimating breakdown

### Cost codes

Cost codes are the individual codes inside a classification system.

Use clear names and codes so estimators can choose the right one while reviewing an estimate.

### Using classifications in estimates

Apply classifications to estimate items when you want better review, filtering, reporting, or quote structure.

### Common use cases

- separate trade or discipline areas clearly
- keep internal reporting consistent across estimators
- map estimate lines to customer-required code structures
- make quote reviews easier when several people work on the same RFQ

### When to keep it simple

Do not force a complicated classification model into every workspace.

If your team does not need reporting or structured coding yet, start with a small, clear system and expand later.

### Importing classifications

Use [Setup import](07-setup-data.md#setup-import) if you already have classification systems or cost codes in a spreadsheet.

## Setup import

Setup import helps seed shared workspace data from spreadsheets.

It is for setup records, not for importing full RFQs or completed estimates.

### What you can import

You can import setup data such as:

- companies
- materials
- labour rates
- equipment rates
- subcontract rates
- cost presets
- estimate templates
- project structure templates
- classification systems
- cost codes

### Import a file

1. Open the setup page you want to seed, or choose setup import from an empty state.
2. Choose a CSV or XLSX file.
3. Review the sheets Kwantflow finds.
4. Confirm what each sheet should import into.
5. Match spreadsheet columns to Kwantflow fields.
6. Review row issues.
7. Import ready rows.

### What to expect

Kwantflow suggests matches where it can. If something is unclear, it asks you to review instead of silently guessing.

That includes supplier or company relationships. A catalogue row can name more than one company by separating names with semicolons. Kwantflow adds every clear match without removing existing links. Missing or ambiguous matches must be reviewed before that sheet can be imported.

When you choose **Update matched**, Kwantflow changes only the spreadsheet fields you mapped. Other saved details and company links stay unchanged. Currency can be imported for materials and rates; when it is omitted, the workspace currency is used.

For a spreadsheet row that contains both a company and a named contact, company details stay on the company and the contact's email, phone, and job title are saved on the linked person.

### Common issues

Go to [Import issues](11-troubleshooting.md#import-issues) if rows are blocked or fields do not map correctly.

## Related guides

- [Build takeoffs and costs](05-estimating.md#build-takeoffs-and-costs)
- [Approve record proposals](08-local-ai.md#approve-record-proposals)
- [Import issues](11-troubleshooting.md#import-issues)
- [Records and relationships issues](11-troubleshooting.md#records-and-relationships-issues)
