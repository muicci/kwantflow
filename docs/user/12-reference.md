# Reference

Supported file types, keyboard shortcuts, frequently asked questions, and a glossary.

## Supported files

Kwantflow supports common tender and estimating file types. Support can mean different things:

- **Upload** means the file can be added to an RFQ.
- **Preview** means Kwantflow can show the file inside the app.
- **AI use** means the file can contribute useful evidence to an AI draft when it is readable.

### How to read support

One file can be:

- uploadable into an RFQ
- previewable inside the app
- useful for AI after Kwantflow prepares readable evidence

These are not always the same thing.

For example, a file may upload successfully but still need manual review if AI cannot extract enough usable information from it.

### Commonly supported file families

| File family | Examples | Typical use |
| --- | --- | --- |
| PDF | `.pdf` | Tender documents, drawings, specifications |
| Images | `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`, `.gif`, `.bmp`, `.tif`, `.tiff` | Photos, scans, screenshots |
| Text and data | `.txt`, `.md`, `.json`, `.xml`, `.csv` | Notes, logs, exports, simple tables |
| Office files | `.docx`, `.xlsx` | Schedules, scope notes, spreadsheets |
| CAD and model files | `.step`, `.stp`, `.iges`, `.igs`, `.obj`, `.stl`, `.3mf`, `.dxf`, `.dwg` | Drawings, models, fabrication or design files |
| Archives and emails | `.zip`, `.msg`, `.eml` | Tender packages and forwarded packages |

### What usually works best with AI

The strongest AI-ready inputs are usually:

- PDFs
- PNG, JPEG, and WebP images
- text-like files such as TXT, Markdown, CSV, JSON, and XML
- DOCX and XLSX when the file content can be extracted clearly
- email files where the body text matters

CAD and drawing files can still be useful, but they often depend on rendered previews or converted evidence rather than direct raw interpretation.

### Common file scenarios

#### PDF tender pack

Use PDFs for:

- specifications
- issued drawings
- scope documents
- commercial schedules

This is usually the most dependable all-round file family.

#### Image or scan

Images work well when the content is sharp and readable.

Low-quality photos, faint scans, or screenshots with tiny text may still need manual checking.

#### CAD and model files

Use CAD and model files when the geometry matters, such as:

- part shapes
- fabricated assemblies
- 2D drawing review
- model-based package understanding

DXF and DWG are treated as drawing-oriented formats. STEP, IGES, STL, OBJ, and 3MF are treated more like model evidence.

#### Office files

DOCX and XLSX are useful when the file contains:

- scope notes
- schedules
- tabular pricing context
- structured takeoff or issue lists

Older `.doc` and `.xls` formats are not part of the normal supported upload path.

#### ZIP packages

ZIP files are useful when a tender arrives as one archive.

Treat the ZIP as a container, not the final evidence. The useful result comes from the files inside it.

#### Email files

`.msg` and `.eml` files are useful when the message body, instructions, and attachments are part of the RFQ context.

These are especially helpful for forwarded tender emails.

### AI drafting note

AI drafting only uses files when Kwantflow can prepare useful evidence from them. A file may still need manual review even if it uploads successfully.

### When AI may skip a supported file

AI may still skip a supported file when:

- the document is unreadable
- the file is damaged
- the important detail is only visible in a poor scan
- the content is too weak to trust automatically
- the file is better treated as supporting reference than direct estimate evidence

### Unsupported or limited files

Some older or specialist formats may not be supported until they can be handled reliably.

If a file is important and does not preview or draft well, review it manually and include the information in your estimate.

### Best practice

Use Kwantflow to centralise the evidence, then decide which files are safe to rely on directly and which still need estimator judgement.

## Keyboard shortcuts

Keyboard shortcuts depend on your operating system, keyboard focus, and the current area of the app.

Kwantflow currently relies more on visible controls, tabs, and panels than on a large custom shortcut system.

### App shortcut

| Action | macOS | Windows |
| --- | --- | --- |
| Show or hide the main sidebar | `Command+B` | `Ctrl+B` |

### Ask Kwantflow

When the message box is focused:

| Action | Shortcut |
| --- | --- |
| Send the current message | `Enter` |
| Add a new line without sending | `Shift+Enter` |

### Viewer shortcuts

Viewer shortcuts work only when the viewer has keyboard focus.

#### 3D CAD viewer

| Action | Shortcut |
| --- | --- |
| Pan left, right, up, or down | Arrow keys |

#### 2D CAD viewer

| Action | Shortcut |
| --- | --- |
| Return to selection mode | `Esc` |
| Erase the selected entities | `Delete` or `Backspace` |

Review the selection before using an erase shortcut.

### Standard text shortcuts

Standard desktop text behaviour is available where the current control supports it.

| Action | macOS | Windows |
| --- | --- | --- |
| Copy | `Command+C` | `Ctrl+C` |
| Paste | `Command+V` | `Ctrl+V` |
| Select all | `Command+A` | `Ctrl+A` |

### Where shortcuts are most useful

- copying values or notes
- pasting data into dialogs
- selecting text or table content
- writing a multi-line AI request
- moving around a focused CAD view

### App navigation

Use visible buttons, tabs, panels, and sidebar items as the primary navigation controls.

### Practical expectation

If a shortcut does not work in the current area, click the relevant viewer or input first, or use the visible control instead.

Kwantflow intentionally keeps important estimating, deletion, approval, and quote actions available through visible controls rather than relying on hidden shortcuts.

## Frequently asked questions

### Workspaces and data

#### What is a workspace?

A workspace is an independent local environment for one business, department, or operating context. It keeps its own RFQs, records, estimates, settings, email connections, and AI knowledge.

#### Can information move between workspaces automatically?

No. Switching workspaces changes the active environment; it does not merge records or estimating context.

#### Is the AI download repeated for every workspace?

No. The downloaded AI is shared by the installation, while the records and guidance supplied to it remain workspace-specific.

#### What happens if I delete a workspace?

Its local records are removed from that installation. Create a suitable backup first if you may need the workspace again.

### RFQs, files, and assets

#### What is the difference between an RFQ and an asset?

An RFQ is the top-level customer enquiry. An asset is a practical estimating bundle inside the RFQ, often representing a part, package, trade, or work area.

#### Do I need an asset for every file?

No. Group files according to how the work should be estimated. Several related files may belong to one asset.

#### What should I do with a revised drawing?

Add it to the existing RFQ, identify the affected asset, compare the change, update the relevant estimate, and export a revised quote when the commercial output changes.

#### Can I create an RFQ from email?

Yes. A connected Gmail or Outlook message can prepare a reviewable intake form. The RFQ is not created until you review and save it.

### Setup data and relationships

#### When should I create a reusable material or rate?

Create it when the business expects to use the record again. Keep one-off job allowances inside the relevant estimate.

#### Can one material be linked to several companies?

Yes. Materials, labour rates, equipment rates, and subcontract rates can be linked to multiple companies.

#### Does deleting a company relationship delete the records?

No. Removing a relationship leaves both the company and catalogue record intact.

#### Does linking a company create supplier-specific pricing?

No. The relationship helps identify relevant companies. Confirm current supplier pricing before using it commercially.

#### What is the difference between a template and a preset?

A template is a broader reusable starting structure. A preset is usually a smaller repeatable bundle or commercial arrangement used inside a workflow.

#### What is the difference between a cost preset and an estimate template?

A cost preset reuses the cost rows from one takeoff item. An estimate template reuses the broader estimate scaffold. Both remain editable after use.

#### Should I update a reusable rate for every supplier quote?

No. Update the workspace default when the value should be reused broadly. Keep unusual freight, urgency, minimum-order, or job-specific pricing in the relevant estimate.

#### Why can I not delete a company?

It may still be required by a linked person, RFQ, or another protected business record. Review and resolve those dependencies instead of deleting useful history blindly.

### Estimates and quotes

#### What is a takeoff item?

A takeoff item is a measurable piece of scope, such as 250 kg of plate, 18 metres of handrail, or six brackets.

#### What is a cost component?

A cost component is a material, labour, equipment, subcontract, or manual cost used to deliver a takeoff item.

#### Should I use Project Structure on every job?

No. Use it when a job benefits from a hierarchy of phases, levels, rooms, zones, trades, or packages. Keep simple estimates flat.

#### What is the difference between the estimate and quote workspace?

The estimate holds detailed internal scope and costing. The quote workspace assembles the customer-facing commercial output, including options, markups, terms, and PDF export.

#### When should I create a quote revision?

Create a revision when issued commercial output changes, such as after an addendum, scope change, new option, or changed terms. Do not create revisions for ordinary edits to an unissued draft.

#### Can several assets be included in one quote?

Yes. Assets keep estimating packages separate inside one RFQ, while quote options can assemble the intended reviewed packages into a commercial response.

### Kwantflow AI

#### Does opening the AI sidebar load the AI?

No. The AI starts when an AI task is requested, not merely when the sidebar opens.

#### Can Kwantflow AI search my records?

Yes. It can search supported records in the active workspace and use the results in a multi-step answer.

#### Should I trust AI arithmetic?

Kwantflow AI can use an exact calculator for arithmetic, but you should still verify the selected records, units, rates, currency, and commercial assumptions.

#### Can AI create or update records without asking?

No. Supported create or update requests appear as a reviewable proposal. Nothing is written until you approve it.

#### Can I approve only one item in a grouped proposal?

No. A grouped proposal is approved or discarded together. If one item is wrong, discard the set and ask for a corrected proposal.

#### Can AI delete records?

No. Delete business records through the normal app controls with the appropriate confirmation.

#### Why can AI still make mistakes?

AI output is probabilistic. Exact workspace records, deterministic tools, structured proposals, and user approval reduce risk, but they do not replace review.

### Email

#### Is an email connection shared across workspaces?

No. Each workspace manages its own Gmail or Outlook connections and remembered detection results.

#### Does RFQ detection scan attachment contents?

The initial detection decision uses message information and body text. Attachments are handled separately when preparing an RFQ intake.

#### Why are remote email images blocked?

Loading a remote image can reveal that a message was opened. Kwantflow blocks remote email images. Embedded raster images can still appear without contacting the sender's server. To view remote images, open the original message in your email provider.

#### Will the same email be classified repeatedly?

Successful RFQ detection results are remembered for the current classifier version. Failed attempts remain retryable.


### Backups and recovery

#### Are backups shared between computers?

Local restore points stay on the device. Export a portable backup and import it on another compatible installation when moving computers.

#### What does restoring a backup do?

It replaces all registered workspaces and local settings with the selected restore point. Later changes may be lost. Credentials and the downloaded model are excluded from portable archives.

#### When should I create a manual backup?

Before a large import, major cleanup, or another local change you may need to undo.

## Glossary

### Asset

A group of related RFQ files and estimating work. An Asset usually represents a package, area, stage, system, or part of a job.

### Classification

A way to organise estimate content with systems and cost codes.

### BOM

Bill of Materials. A customer-supplied or internally prepared list of parts, materials, quantities, or assemblies that may help prepare an RFQ estimate.

### BOQ

Bill of Quantities. A structured quantity list used to review measurable scope before it becomes quote output.

### Company relationship

A workspace link between a company and a material, labour rate, equipment rate, or subcontract rate. It identifies relevant businesses without creating supplier-specific pricing.

### Cost component

A material, labour, equipment, subcontract, preset, or manual cost row used to deliver a takeoff item.

### Cost preset

A reusable snapshot of the cost rows from one takeoff item.

### Estimate

The working price build-up for an Asset.

### Estimate template

A reusable estimate scaffold saved from reviewed estimating work.

### Connected email

The optional Gmail or Outlook connection that lets a workspace bring RFQ emails and attachments into the estimating workflow.

### Kwantflow AI

Optional AI help that runs on your computer after a one-time download.

### Ask Kwantflow

The assistant sidebar inside Kwantflow. Use it to ask questions, search the current workspace, calculate exact values, and prepare drafts or proposals for review.

### Quote

Customer-facing output built from reviewed estimates.

### Quote revision

A saved version of quote output at a point in time.

### Project structure

An optional hierarchy used to organise work by phases, areas, levels, trades, packages, or another useful breakdown.

### Proposal set

A grouped set of AI-prepared record changes waiting for user approval. The set is approved or discarded together.

### RFQ

Request for Quote. The top-level job record in Kwantflow.

### RFQ Detector

Kwantflow AI support for identifying connected emails that look like RFQs so you can review them and create records faster.

### Workspace

An independent local business environment inside Kwantflow. Each workspace keeps its own records, estimates, settings, email connections, and AI guidance.

### Workspace AI knowledge

Workspace-specific playbook text, files, and feedback that guide AI behaviour in that workspace.

### Setup data

Reusable workspace records such as companies, materials, labour rates, equipment rates, subcontract rates, presets, templates, and classifications.

### Takeoff item

A measurable piece of scope inside an estimate, such as a quantity of plate, metres of handrail, or number of fabricated brackets.

## Related guides

- [Quickstart](02-quickstart.md#quickstart-in-six-steps)
- [Group files into assets](04-rfqs-and-files.md#group-files-into-assets)
- [Troubleshooting](11-troubleshooting.md)
