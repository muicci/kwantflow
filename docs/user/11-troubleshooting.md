# Troubleshooting

Common problems grouped by area. Start with the page for the feature you are using.

## Install and update issues

[Start with the installation guide](01-install.md#download-and-install) and published release notes.

### Check the download

Use the project's versioned GitHub installer links, including those in its README. Confirm the download completed and matches the intended platform. Obtain a fresh installer when the file is incomplete or its published checksum does not match.

Do not run a source archive as an installer. The Mac DMG is universal; the Windows installer is x64.

### Windows blocks the installer

The Windows installer is unsigned. SmartScreen, Smart App Control, S mode, and organisation rules can restrict unsigned software. A published checksum does not grant trusted-publisher status. Do not disable protection to bypass a block; ask your device administrator where applicable.

A missing bundled system prerequisite can request administrator approval or restart. Declining required installation can leave the application unable to launch. The installer should explain which prerequisite failed.

### macOS reports a security or damaged-app error

Community builds may be unsigned or ad hoc signed. Open the app once from System Settings > Privacy & Security if macOS asks you to confirm it. Do not disable Gatekeeper. Verify the download and its checksum from the project's GitHub Releases page before retrying.

### Workspace or database repair error after upgrading

Quit and reopen once, record the exact error, and preserve your data. Do not delete workspace files or open upgraded databases with an older binary. Use a compatible backup only after reviewing the installation-wide restore scope.

Check each workspace rather than assuming records are missing from the installation. [Workspace and backup issues](11-troubleshooting.md#workspace-and-backup-issues) covers recovery.

### A feature is unavailable

Check the active workspace, optional AI model status, and provider configuration if the feature uses email.

### Reporting a reproducible problem

Kwantflow is community maintained and has no guaranteed support. When you open a GitHub issue, include app version, operating system, steps, and exact error. Inspect a locally exported diagnostic archive before sharing it. The app does not upload reports automatically.

## File and AI issues

Some files can be uploaded, previewed, and used by AI. Others may only be useful for manual review.

The important distinction is not just file type. It is whether the file is readable enough to trust.

### If a file does not preview

Check whether the file type is supported in [Supported files](12-reference.md#supported-files).

If the file is supported but still does not preview:

- confirm the file opens outside Kwantflow
- try adding the file again
- check whether it is password-protected or damaged
- check whether the issue is with the file itself rather than the workspace

### If a ZIP package does not help

ZIP files are only containers.

If the files inside the ZIP are weak, damaged, or unsupported, the ZIP itself will not solve that.

### If AI does not use a file

AI may skip a file when it cannot extract useful evidence from it.

Common reasons include:

- the file type is not useful for AI drafting
- the file is blank, damaged, unreadable, or very low quality
- the drawing or image is too faint
- the file needs manual review
- the useful detail is in an attachment, addendum, or later revision rather than the file you expected
- the file uploads successfully but is still weak evidence for automatic drafting

### Common real-world examples

- A blurry phone photo uploads but is too poor for reliable quantity logic.
- A CAD file previews, but the pricing still depends on notes from the RFQ email body.
- A spreadsheet uploads, but the important commercial assumption is only written in a separate PDF.
- A scanned addendum is readable to a person but too faint to treat as strong AI evidence.

### What to do when AI output feels incomplete

Check whether:

- the key file was attached to the right RFQ or Asset
- the most useful file was actually opened and reviewed
- the missing fact only exists in a supporting attachment
- the estimate should be adjusted manually instead of forcing another AI pass

### What to do next

Review skipped files manually and update the estimate yourself where needed.

If the file is critical, keep the file in the RFQ anyway so the full package stays together for human review.

## Import issues

Setup import asks for review when spreadsheet data is unclear.

That is intentional. Import should stop on weak data instead of silently creating bad reusable records.

### Columns do not map correctly

Check that your spreadsheet has clear column names such as:

- company name
- material name
- unit
- rate
- email
- phone
- code
- description

You can manually choose the matching Kwantflow field during review.

### Rows are blocked

Rows may be blocked when required information is missing, duplicate, ambiguous, or invalid.

Fix the row in the review step or update the spreadsheet and import again.

Common examples:

- a material row has no name
- a rate row has a unit but no rate
- the same record appears twice with conflicting details
- a company link points to a name that could match more than one record

### Company or supplier links are unclear

If a rate refers to a supplier or company, make sure the company name matches an existing or imported company record clearly.

If the match is not clear, import the row first and link it later during review.

### Cost codes do not import

Cost codes need a classification system. Import or select the classification system first, then review the cost-code sheet.

### When to clean the spreadsheet first

Clean the source file before importing when:

- headings are inconsistent across sheets
- one column mixes units and notes
- supplier names vary from row to row for the same company
- rates use mixed currencies without clear labels
- old archived records are mixed with live records

### Best practice

Import clear, reusable setup data first.

Leave one-off job details in the RFQ or estimate instead of forcing them into your long-term catalogue.

## Records and relationships issues

Workspace records are reusable. A correction can affect future RFQs and estimates, so check the active workspace and the exact record before changing it.

### A record is missing from a selector

Check that:

- you are in the workspace where the record was created;
- the record is active;
- you opened the correct selector, such as Materials rather than Subcontract rates;
- the name, code, or alias matches your search;
- the page has finished loading its current workspace records.

Archived or inactive records may remain visible where they are already linked, but may not be offered for new selections.

### A company relationship is missing

Open either the company or the catalogue record and review its relationship selection.

Confirm that the selected contact is a company rather than a person. Company relationships are supported for materials, labour rates, equipment rates, and subcontract rates.

Save the relationship from one side, then reopen the other record to confirm it appears there too.

### Removing a relationship did not delete the records

This is expected. A relationship only records that the company is relevant to the material or rate.

Removing it leaves both records available. Delete or archive a record separately only when that is the intended business action.

### I cannot delete a company

The company may still be required by another record, such as a linked person or RFQ.

Review the warning, find the dependent records, and decide whether they should be reassigned, archived, or removed first. Do not remove useful history merely to clear a warning.

Catalogue relationships do not delete catalogue records when a company is removed, but other protected business relationships may prevent deletion.

### I created a duplicate

Compare the records before deleting either one:

- names, codes, and aliases;
- units and currencies;
- rates and rate basis;
- linked companies;
- use in existing estimates or RFQs;
- active or archived status.

Keep the clearer reusable record. Update references deliberately where the app permits, then archive or delete the duplicate only when it is safe.

### A linked company has the wrong price

Company relationships and prices are separate.

Linking a supplier does not copy a supplier quote into the material or rate record. Update the reusable default only when the new value should apply broadly. Keep unusual freight, minimum order, urgency, or customer-specific pricing in the job estimate.

### A unit or currency is wrong

Correct the reusable record when its normal unit or currency was entered incorrectly.

Before changing it, review existing estimates that may rely on the earlier interpretation. A value of `4.85 per kg` is not interchangeable with `4.85 per tonne`, sheet, metre, or each.

### A setup record is no longer used

Mark it inactive when you want to preserve history but prevent normal future selection.

Delete it only when you are confident it is not needed for understanding existing work and the app permits deletion.

### AI proposed the wrong fields

Discard the proposal. State the exact record family, name, action, and values again.

Example:

> Prepare an update for the material “Galvanised Steel Plate 10mm”. Change only the default rate to 5.55 AUD per kg and preserve the other fields.

Nothing is written when you discard a grouped proposal.

## Workspace and backup issues

### I cannot create another workspace

Kwantflow has no workspace cap. Check the displayed error, available disk space, and permissions.

### Records appear missing after switching

Check the workspace name, clear table filters, and inspect archived views where available. Switching does not merge records or business environments.

### A workspace cannot be deleted

Confirm the intended workspace, protect its data, and complete the required name confirmation. The app protects the only remaining workspace and data that are currently in use.

### A backup is not listed

Local restore points belong to the installation on the computer where they were created. A portable ZIP on disk must be imported through **Import backup** before it appears as a restore candidate.

### The archive is invalid or incompatible

Stop and keep the original file. Import validates archive contents, required files, databases, and supported versions before replacing live data. A failed check should leave current workspaces intact. Do not edit the archive to bypass validation.

### What will be replaced?

Restore replaces **all registered workspaces and local settings on this installation** with the selected backup. It does not merge old and new data. Check the backup date and workspace count, and export current data if it may be needed later.

### Restore is slow or was interrupted

Allow an active restore to finish. Do not remove staging or recovery data. On restart, unfinished replacement recovery runs before workspaces open. If recovery cannot finish, startup stops instead of continuing against partial databases. Keep the error and recovery files for diagnosis.

If the current databases are damaged, recovery may retain their raw originals and SQLite sidecar files in quarantine instead of creating a normal safety backup. Preserve every retained file and the recovery record. Do not edit, combine, or delete them to bypass the repair message.

### Email or AI needs setup after moving computers

Portable backups exclude OAuth credentials and the downloaded model. Configure your own provider registration and reconnect each mailbox. Download the optional AI model on the destination installation.

Transfers between macOS and Windows are not yet fully tested. [Backup instructions](10-backup-and-privacy.md#back-up-and-restore-workspaces) explain the supported user flow.

## Email and RFQ detection issues

### Provider setup or consent is rejected

Open **Settings > Connections > Email setup guide** or read [Connect email](09-email.md#connect-email). Enter the correct Desktop/public-client ID and Microsoft tenant, then choose **Save email registrations** before connecting. Do not enter a client secret.

For Gmail:

- Check that Gmail API is enabled in the same project as the Desktop client ID.
- For External Testing, add the exact connecting account as a test user. Gmail grants and refresh tokens expire after seven days. Eligible own-use projects can follow the guide's In production route, then reconnect.
- An `org_internal` error means the connecting account is outside the project's organisation. Use an eligible account or the appropriate External audience.
- For blocked scopes or administrator restrictions, ask your Workspace administrator to review that specific client. Creating another registration does not override organisation policy.

For Outlook:

- Copy Application (client) ID rather than Object ID.
- Match the registration's supported account types and Kwantflow's tenant. A single organisation needs its tenant UUID; `common` is for a registration supporting both organisational and personal accounts.
- For a redirect mismatch, configure `http://localhost` under Mobile and desktop applications. Do not use Web/SPA or a fixed guessed port.
- Check delegated Graph mail permissions and administrator consent requirements. A request for administrator approval must be resolved by the organisation.
- Confirm that the account has a supported cloud mailbox. A local Outlook installation, PST file, or on-premises Exchange account does not provide Graph mailbox access.

Provider screens can give more specific error codes. Review the setup guide and provider registration before retrying. Keep tokens, authorisation codes, and callback URLs out of shared screenshots or support messages. Provider restrictions and approval cannot be removed by Kwantflow.

Connections whose client registration changed require reconnection. Saved RFQs and attachments remain available locally.

### The browser says connected but the app is still waiting

Keep Kwantflow open and return to it after the browser confirms the connection.

If the app does not finish:

1. Cancel the waiting connection.
2. Confirm you are in the intended workspace.
3. Start the connection again from Settings.
4. Complete the newest browser window only.

Do not reuse an old browser consent page after starting a new attempt.

### The browser does not open

- Check that the app is allowed to open your default browser.
- Cancel any connection attempt that is already waiting.
- Start a fresh attempt.
- Confirm the computer has internet access.

### The wrong mailbox was connected

Disconnect it from the active workspace, then connect again and choose the intended account in the provider's browser page.

Changing workspaces does not move the mailbox connection.

### Messages do not appear

Check:

- the intended workspace is active;
- the mailbox connection still shows as connected;
- auto-refresh is enabled if you expect periodic checks;
- the message exists in the connected account;
- the app is open when you expect synchronisation or detection to run.

Use a manual refresh when available.

If authorisation has expired or been revoked, reconnect the mailbox in Settings. Do not retry an outgoing quote automatically after an uncertain send result; check the provider's Sent folder first. Changing client IDs or Microsoft tenant also requires reconnection. Gmail Testing expiry, Microsoft sign-in policy, and organisation changes can all interrupt previously working access.

If access cannot be restored, export the message from your provider and import its EML or MSG file. Local RFQs, imported attachments, and estimating remain available.

### RFQ detection does not run

Confirm **Mail RFQ Detection** is enabled for the active workspace and the optional model is downloaded. An AI task must be able to load the local engine. Mailbox access still requires internet.

Detection does not need to run again for messages that already have a successful result under the current detection version. Failed attempts remain eligible for retry.

### A message was classified incorrectly

RFQ detection is an aid, not a replacement for reviewing the email. Open the message and decide whether to prepare an RFQ yourself.

Do not delete a real enquiry simply because the detector did not label it.

### Open a link from a message

Expand **Links in this email** beneath the message. Each action shows its actual destination so you can review it before opening it. Links inside the message body are displayed as text.

Only web, email, and telephone links are available. Relative links and links to local files or app commands are excluded.

### Remote images are blank

Kwantflow blocks remote email images for privacy. To view remote images, open the original message in your email provider.

Embedded raster images may still appear without contacting the sender's server.

### An email opens with the wrong content

Close the preview and open the message again from the current mailbox list. If the issue continues, refresh the mailbox before opening another message.

### RFQ intake is missing information

AI preparation uses message details and body text, then attachments are added separately.

Before saving:

- verify the customer and requester;
- check RFQ number and references;
- check received and due dates;
- review priority and notes;
- confirm attachments are present;
- leave ambiguous company or person matches unlinked until you can confirm them.

## Estimate and quote issues

### A total looks wrong

Check the calculation from the smallest level upward:

1. Takeoff quantity.
2. Takeoff unit.
3. Cost component quantity.
4. Cost component unit and rate basis.
5. Rate and currency.
6. Markup.
7. Included assets and quote options.

Do not start by changing the final quote total. Find the source row that produced it.

### A linked rate is missing

- Confirm the record exists in the active workspace.
- Search by name, code, or alias.
- Check that the record is active.
- Confirm you are looking in the correct category: material, labour, equipment, or subcontract.

Add a manual cost row when the value is genuinely job-specific.

### Units do not match

Convert the quantity deliberately before multiplying it by a rate with a different basis.

Examples:

- kilograms and tonnes;
- millimetres and metres;
- hours and days;
- each and packs.

Record the assumption in the estimate description or notes when a reviewer needs to understand it.

### The quote total differs from the estimate

Check:

- which asset estimates are included;
- which quote option is active;
- overall and category-specific markups;
- exclusions or optional packages;
- whether an estimate changed after the quote workspace was last reviewed.

The quote is a commercial assembly of estimate information, not simply a screenshot of one estimate.

### A quote option has the wrong scope

Review the assets, labels, and commercial content included in that option. Rename the option so its meaning is clear to the customer.

### Revision history does not change while editing

Revision history records commercial snapshots when quote output is exported. Ordinary working edits do not rewrite an earlier snapshot.

### Reset removed quote decisions

Resetting the quote workspace intentionally clears quote-workspace decisions for that RFQ. Rebuild the quote from the reviewed estimate data or restore a suitable workspace backup if a broader rollback is required.

### AI draft quantities look uncertain

Open the source evidence and verify the item manually. Correct or remove uncertain rows rather than repeatedly generating drafts without changing the evidence.

## AI answer and proposal issues

Kwantflow AI can use workspace records and tools, but it can still misunderstand an instruction. Treat its response as work to review.

### The answer used the wrong record

Give a more specific identifier, such as:

- exact or partial record name;
- company;
- code or alias;
- unit;
- project or RFQ context.

Example:

> Use “Galvanised Steel Plate 10mm” in materials, not the similarly named contact.

If the record remains ambiguous, open the normal record page and verify it directly.

### The calculated answer looks wrong

Ask the AI to state the selected record, quantity, unit, rate, and currency. Check each value before relying on the total.

Example:

> Show the material name, recorded rate, unit, quantity, and calculation used for this answer.

### The AI asks for information I already provided

Restate the minimum missing detail clearly. Long corrective messages can introduce more ambiguity.

For an update, provide the exact record name and changed field. For a create request, provide each required value in a consistent list.

### A multi-record proposal is incomplete

Do not approve an incomplete grouped set.

Discard it and ask for the complete corrected set, naming every expected record again.

Example:

> Discard that proposal. Prepare one grouped proposal containing all five materials below, with the exact names, rates, units, currencies, and rate bases.

### One proposal item is wrong

Grouped proposals are approved or discarded together. Discard the set and request a corrected version rather than approving known bad data.

### An update cannot find the record ID

Ask the AI to search for the record first and confirm the match before proposing the update.

Example:

> Find “KF Multi Plate A” in materials, confirm its current rate, then prepare an update to 5.55 AUD per kg.

### The AI repeats the same step

Stop the request if it continues repeating. Nothing hidden should be approved or written after cancellation.

Start a new request with a smaller, more explicit task. If the same repeat occurs consistently, report it with the prompt and visible response.

### Thinking text looks repetitive

Reasoning text is generated by the AI and may be verbose or repetitive. Judge the result by the verified records, calculations, proposal card, and final answer—not by polished-looking reasoning.

### The AI is unavailable

- Confirm Kwantflow AI is installed and ready in Settings.
- Wait for another AI task to finish.
- Retry after cancellation has completed.
- Restart the app if the previous task did not release cleanly.

Opening or closing the sidebar alone should not install, load, or unload the AI.

### Report a repeatable problem

Include:

- the exact prompt;
- the active workspace and page;
- the record names involved;
- the visible final answer or proposal;
- whether you stopped, discarded, or approved it;
- screenshots where useful.

Do not include confidential customer information unless it is required and permitted by your organisation.

## Related guides

- [Install Kwantflow](01-install.md#download-and-install)
- [Supported files](12-reference.md#supported-files)
- [Frequently asked questions](12-reference.md#frequently-asked-questions)
