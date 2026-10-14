# RFQs and files

An RFQ is the top-level job in Kwantflow. This page covers creating RFQs, running the dashboard, bringing in files, grouping them into Assets, and organising project structure.

## Create your first RFQ

An RFQ is the top-level job in Kwantflow. Use it to collect tender information, attach initial files, organise assets, build estimates, and prepare quote output.

You can start an RFQ manually from the dashboard or prepare one from a connected email when the request arrives through Gmail or Outlook.

### Before you start

Have the basic job details ready:

- job or project name
- requester or client
- due date
- project notes or scope summary
- initial tender files when they are already available

### Create an RFQ

1. Open the RFQ dashboard.
2. Choose the action to create a new RFQ.
3. Enter the job details.
4. Attach the initial files you want stored with the RFQ.
5. Save the RFQ.

### Typical details to capture

Good RFQ records usually include:

- job or package name
- client or requester
- due date
- site or project reference
- scope notes
- any early assumptions or exclusions
- drawings, specifications, spreadsheets, emails, or other initial files

### Common starting scenarios

- A builder sends a tender package with drawings, schedules, and due date.
- A repeat customer asks for pricing on a known material or fabricated part.
- A supplier or subcontractor forwards a package that needs fast review.
- An email arrives first, and you prepare the RFQ from the message before saving it.

### Expected result

The RFQ opens with the reviewed details and any saved initial files ready for asset grouping and estimating work.

## Manage the RFQ dashboard

The RFQ dashboard is the main list of enquiries in the active workspace.

Use it to decide what needs attention, open an RFQ workspace, and keep completed work out of the active queue without losing its record.

### Understand the columns

The dashboard can show information such as:

- RFQ number;
- customer company and requester;
- project or package name;
- priority;
- status;
- file count;
- submission deadline.

Use search, sorting, and view controls to narrow a busy list.

### Use statuses consistently

Kwantflow supports these RFQ statuses:

| Status | Suggested meaning |
| --- | --- |
| Draft | The enquiry record is being prepared and is not ready for active estimating. |
| Open | The enquiry is accepted into the active queue. |
| Estimating | Scope review or pricing is underway. |
| Quoted | A quote has been prepared or issued. |
| Won | The customer accepted the work. |
| Lost | The opportunity will not proceed with your business. |
| Archived | The RFQ is removed from the active view but retained for reference. |

The labels are shared by the product, but your team should agree on when each transition happens.

### Set priority

Priority can be Low, Medium, High, or Critical.

Use priority for business urgency, not as a replacement for the deadline. A high-value opportunity due next month and a small quote due today may need different kinds of attention.

### Review deadlines

Record the submission deadline supplied by the customer. If the date changes, update the RFQ and review whether the estimating plan or lead time must also change.

### Active, archived, and all views

- **Active** keeps current work visible.
- **Archived** contains RFQs removed from the active queue.
- **All** helps search across both.

Archive completed, cancelled, or dormant work when it no longer belongs in the daily queue. Restore an archived RFQ if work resumes.

### Reorder and bulk actions

Active RFQs can be manually reordered when the list is not currently sorted by a column.

Use bulk actions carefully for archive, restore, or delete operations. Review the selected rows before confirming because one action can affect several RFQs.

### A practical daily review

At the start of the day:

1. Review critical and high-priority RFQs.
2. Check deadlines due soon.
3. Move active work into **Estimating** when review begins.
4. Open RFQs waiting for files or clarification and update their notes.
5. Archive work that no longer needs to remain active.

## Daily estimating workflow

Kwantflow does not require one rigid process. A consistent daily routine can still reduce missed deadlines, duplicated work, and stale rates.

### Start with the RFQ dashboard

At the beginning of the day:

1. Review active RFQs by due date and priority.
2. Check newly received enquiries.
3. Confirm which RFQs are waiting for information, ready to estimate, or ready to quote.
4. Archive work that is no longer active when your team no longer needs it in the active view.

Use [Manage the RFQ dashboard](04-rfqs-and-files.md#manage-the-rfq-dashboard) for statuses, priorities, deadlines, and bulk actions.

### Triage connected email

If a mailbox is connected for the active workspace:

- review messages identified as possible RFQs;
- open the message before accepting the detection result;
- create a reviewable RFQ intake when the enquiry belongs in Kwantflow;
- confirm the requester, company, dates, and attachments before saving;
- leave unrelated messages outside the RFQ workflow.

Mail RFQ Detection helps prioritise review. It does not replace your decision about whether an enquiry should become an RFQ.

### Progress the highest-priority RFQ

Inside the RFQ:

1. Review the latest files and customer notes.
2. Confirm whether any addendum or revised drawing changes the scope.
3. Group files into practical assets when the enquiry contains separate packages.
4. Update takeoffs and costs against the current evidence.
5. Record assumptions, inclusions, exclusions, and unresolved questions while they are fresh.

When information is missing, keep the uncertainty visible. Do not turn an assumption into a reusable workspace fact.

### Review calculations and sources

Before treating an estimate as ready:

- verify quantities and units;
- check linked material, labour, equipment, and subcontract rates;
- confirm the currency and rate basis;
- inspect manual allowances;
- check whether current supplier information differs from the workspace default;
- confirm totals after every material scope change.

Kwantflow AI can help find records and calculate exact arithmetic, but the selected records and commercial assumptions still require review.

### Prepare the commercial response

When the estimate is stable:

1. Choose which asset estimates belong in the quote.
2. Review quote options and markups.
3. Check customer details, identifiers, currency, tax, totals, lead time, inclusions, exclusions, and terms.
4. Export the intended revision.
5. Review any generated email draft before sending it.

An exported revision is a commercial snapshot. If the scope changes later, update the estimate and create the next reviewed revision.

### Improve reusable data after the job

When you discover something worth reusing:

- update a verified material or rate;
- link the relevant supplier or subcontractor;
- save a recurring cost pattern as a cost preset;
- save a genuinely repeatable estimate as a template;
- add a stable classification or cost code;
- improve workspace AI guidance when the correction should apply again.

Do not add one-off customer details merely because they appeared in the latest RFQ.

### End-of-day check

Before closing the app:

- confirm urgent RFQs have clear next actions;
- save or finish any important edits;
- create a manual backup before a major setup change when appropriate;
- verify that you are working in the correct workspace if you manage more than one business.

## Create an RFQ from email

Create an RFQ from email when the request arrives in a connected mailbox and you want Kwantflow to prepare the intake details for review.

This is a preparation flow, not an automatic job-creation flow.

### When to use it

Use this when:

- a tender invitation arrives by email
- the sender included useful scope notes in the email body
- you want attachments brought into the RFQ review flow
- you want help matching the sender to existing companies or people

### Before you start

Check that:

- the correct workspace mailbox is connected
- the email belongs to the current workspace
- the message looks worth turning into a real RFQ

### How it works

1. Open the email inside Kwantflow.
2. Choose **Create RFQ from email**.
3. Review the prepared intake form.
4. Check the suggested company and person matches.
5. Check the job name, notes, dates, and other extracted details.
6. Review the attachments that were added alongside the intake.
7. Save the RFQ only after the form looks right.

### What Kwantflow can prepare

The review form can help with:

- sender and company context
- requester or contact matching
- job or package naming
- notes pulled from the email body
- attachments added into the intake workflow

If the same email is already linked to one or more RFQs, you can open those RFQs directly from the email preview.

If a company or person match is unclear, review it yourself instead of assuming it is correct.

### Example

If an email says:

`Please quote the attached steel frame package. Price due Friday.`

Kwantflow can help prepare:

- a draft RFQ title
- linked sender details where a clear match exists
- the body text as intake context
- the attached files ready for review

You still decide whether the draft should become a real RFQ.

### Useful actions in email preview

From the email preview you can also:

- download attachments individually
- create a company or contact from the sender
- open an existing RFQ already linked to the same email
- review the full sender, recipients, date, and subject before creating the RFQ
- expand **Links in this email** beneath the message and select a displayed destination to open it

### Common scenarios

- A clean tender invite arrives with clear dates and attachments, so most intake fields are prepared for review.
- A forwarded message has partial context, so Kwantflow prepares what it can and leaves the rest for manual review.
- A repeat customer sends another package, and Kwantflow can often match the existing company or requester record.
- One email leads to more than one RFQ over time, and the email stays a useful reference point.

### Important review rule

No RFQ is created until you review and save the intake form.

## Work inside an RFQ

An RFQ workspace keeps the information, files, estimating work, and quote output for one enquiry together.

Use it after creating an RFQ from the dashboard or preparing one from a connected email.

### The RFQ workflow

Most jobs move through the same broad sequence:

1. Review the RFQ details and deadline.
2. Review the received files.
3. Group related files into practical assets or work packages.
4. Organise the project structure when the job needs a deeper breakdown.
5. Build and review an estimate for each asset.
6. Prepare quote options and commercial details.
7. Export the quote and prepare the covering email.

You can return to an earlier step whenever new information arrives.

### RFQ details

The RFQ record identifies the enquiry. It can include:

- an RFQ number;
- customer company and requester;
- project or package name;
- received date and submission deadline;
- estimator or package owner;
- customer reference;
- priority and status;
- notes and attachments.

Keep the RFQ number and customer reference distinct. Your RFQ number is your own identifier; the customer reference is the identifier supplied by the requester.

### Files and assets

Files are the documents received for review. Assets are the estimating bundles you create from those files.

For example, one RFQ may contain:

- a drawing set for a steel frame;
- a spreadsheet for doors and hardware;
- a specification for coatings;
- an addendum that changes one drawing.

You could group these into separate assets when they need independent takeoffs or pricing. A small enquiry with one drawing may need only one asset.

### Project structure

Project Structure is optional. Use it when an asset still needs an internal breakdown by phase, level, room, zone, trade, or another practical grouping.

Do not create structure simply because the feature exists. A flat estimate is easier to review when the job is simple.

### Estimates and quotes

The estimate is where quantities, units, rates, and cost components are prepared. The quote is where the reviewed estimate information is turned into a commercial offer.

This separation lets you keep detailed internal costing while presenting a clearer customer-facing quote.

### When new information arrives

Treat an addendum or revised drawing as new evidence:

1. Add the new file through the RFQ file workflow.
2. Review what changed.
3. Update the affected asset and estimate.
4. Recheck totals, exclusions, and lead time.
5. Export a new quote when the commercial output has changed.

Do not assume that a revised file affects every asset. Update only the scope that is actually changed.

### Example: one enquiry, three packages

A builder requests pricing for structural steel, stairs, and handrails.

- Create one RFQ for the enquiry.
- Group the files into three assets: Structural steel, Stairs, and Handrails.
- Build one working estimate in each asset.
- Include the relevant assets in the quote.
- Create quote options if the customer should be able to accept packages separately.

## Add and review files

Files usually arrive before the estimate is ready. Attach the initial file set while creating or reviewing the RFQ, then organise those files into Assets when you understand what they belong to.

The goal at this stage is simple: make sure the workspace has the real quoting evidence before anyone starts pricing.

### Review files

1. Open the RFQ.
2. Review the tender files saved with the RFQ.
3. Wait for previews or file summaries where available.
4. Open each important file and check that it is readable.

### Add later files

When an addendum, revised drawing, or missing schedule arrives later, add it to the existing RFQ through the supported RFQ file workflow, then review what changed before updating assets or estimates.

### What to look for

Look for:

- drawings and specifications
- schedules and bills
- addenda
- spreadsheets
- images
- emails or attachments

### A practical review pass

Before grouping files into Assets, ask:

- Which files define scope?
- Which files change scope?
- Which files are only supporting reference?
- Which files belong to the same package or trade area?
- Is anything missing that would block pricing confidence?

### Common scenarios

- A multi-sheet drawing pack and one addendum belong to the same fabricated package.
- A schedule spreadsheet should stay linked to the same asset as the drawings it supports.
- An email attachment may explain the urgency or due date even when the PDF set looks complete.

### Expected result

You know which files belong together and which files are ready to group into Assets.

## Group files into assets

An Asset is a bundle of related files and estimating work inside an RFQ.

Use Assets when a job has separate areas, systems, packages, buildings, stages, or work types.

Files that are not grouped yet stay in a review queue until you place them into an Asset.

### Group files

1. Select files that belong together.
2. Choose **Create Asset**.
3. Name the Asset clearly.
4. Confirm the group.

You can also rename an Asset, add more review files into an existing Asset, remove a file from an Asset, or ungroup an Asset when you need to send its files back to the review queue.

### Good Asset names

Use names that will still make sense when preparing the quote, such as:

- Block A structure
- Fire protection
- Level 3 fitout
- External works
- Mechanical package

Avoid temporary names such as `Misc files`, `RFQ docs`, or `New group`.

### Common grouping patterns

- one Asset per trade package
- one Asset per building or zone
- one Asset per drawing set when the customer expects split pricing
- one Asset per fabrication package or deliverable

### When to regroup

Regroup when:

- one Asset covers unrelated scope
- you need different estimate logic for different parts of the RFQ
- one file belongs to the wrong package
- the customer wants separated pricing by building, area, or option

### Expected result

Each Asset should represent one estimate-ready work package with a clear purpose.

If another estimator opened the RFQ, they should understand why each file belongs where it does.

## Organise project structure

Project Structure helps you organise a complex job into sections that are easier to estimate and review.

It is sometimes called a work breakdown structure, or WBS.

### When to use it

Use Project Structure when one RFQ or asset contains meaningful internal divisions, such as:

- design, fabrication, finishing, and installation phases;
- building levels or rooms;
- plant areas or site zones;
- trades or disciplines;
- assemblies, packages, or deliverables.

Skip it when a short list of takeoff items already explains the job clearly.

### Create a structure

Open **Project Structure** from the RFQ workspace, then add a structure node.

For each node, you can define:

- a name;
- an optional code;
- a type;
- its parent or placement;
- its display order.

Parent and child nodes create a hierarchy. For example:

```text
Building A
  Level 1
    Structural steel
    Handrails
  Level 2
    Structural steel
    Handrails
```

### Choose useful names

Use names that an estimator can recognise without opening the drawing again.

Good names:

- Workshop fabrication
- Level 02 handrails
- North elevation cladding
- Site installation

Less useful names:

- Section 1
- Miscellaneous
- Other

Codes are optional. Use them when your business or customer already works with a known coding system.

### Reorder and place nodes

Placement controls where a node sits in the hierarchy. Order controls how sibling nodes appear.

Before moving a node, check whether its children should move with it. A parent cannot be placed underneath one of its own descendants.

### Save a structure template

If the same breakdown appears on many jobs, save the current structure as a template.

Examples include:

- a standard fabrication lifecycle;
- a repeatable building-level structure;
- a maintenance shutdown package;
- a standard machine-build sequence.

Templates are starting points. After applying one, adjust it to match the current RFQ rather than treating it as fixed.

### Example: fabrication and installation

For a fabricated platform, a useful structure might be:

1. Engineering and detailing
2. Material procurement
3. Workshop fabrication
4. Surface treatment
5. Transport
6. Site installation

This makes omissions easier to spot and lets reviewers understand where each cost belongs.

## Related guides

- [Create and review an estimate](05-estimating.md#create-and-review-an-estimate)
- [Connect email](09-email.md#connect-email)
- [Supported files](12-reference.md#supported-files)
- [Multi-package tender](13-examples.md#multi-package-tender)
