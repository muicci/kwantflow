# Kwantflow user manual

Kwantflow is free, local, open source estimating software licensed under GPL-3.0.

## Download and install

Download the macOS DMG or Windows x64 installer from the Releases page of the project's GitHub repository, or build it from source. No Kwantflow account, subscription, registration, or license activation is required.

On macOS, open the DMG and drag Kwantflow into Applications. The universal application includes Apple Silicon and Intel native libraries. Community builds may be unsigned, so macOS may ask you to confirm opening the app from System Settings > Privacy & Security.

On Windows, run the x64 installer. It installs per user and includes the offline WebView2 prerequisite and native libraries. The Windows installer is unsigned. Windows may warn or block it according to the computer's security policy; managed, S mode, and Smart App Control environments may refuse unsigned software. If a native prerequisite requires administrator approval or restart, follow the installer message. Do not disable security protections to bypass an installation block.

You do not need developer tools, containers, or a database server to use the packaged application. Developer builds require the documented build tools.

## Start working locally

Create a local workspace and provide the required country, business name, and local contact details for quote preparation. These details are stored on your computer. Importing setup data and installing local AI are optional.

RFQs, contacts, catalogues, estimates, CAD/PDF files, quote documents, and local backups work without a Kwantflow server. The application does not impose subscription quotas, expire a trial, report usage automatically, or check for updates automatically.

## Optional local AI

Choose Download to install the pinned Kwantflow AI model, approximately 3.7 GB. Leave the free disk space shown in the app available. You may choose Skip and continue manual estimating.

The model needs an internet connection for its initial download. The app verifies its actual SHA-256 digest. Downloaded means the model file is installed and verified. Ready means the native engine has loaded. The first AI request loads the engine; setup does not run an unsolicited AI task.

After downloading, inference runs on your computer. It needs no paid inference API. AI drafts remain suggestions; review quantities, rates, evidence, and deterministic quote totals before applying them.

## Optional Gmail and Outlook

Email connections require internet and a provider account. They do not require a Kwantflow account. Supply your own Google Desktop OAuth client ID or Microsoft public-client registration and tenant in Settings. A registration is configured for the device; mailboxes remain workspace-specific.

Open **Settings > Connections > Email setup guide** for complete instructions bundled with the app. The Connect email guide (see "Connect email" in this manual) also explains account types, provider restrictions, and troubleshooting.

Your desktop connects directly to Google or Microsoft. Authorization uses a temporary callback on your computer, so you do not need to host a server, domain, webhook service, or integration proxy. Mail refresh and detection run while the app is open. Provider registration is optional advanced setup; installing and using the core application does not require it.

For Google, enable the Gmail API and create Desktop app credentials. Gmail read/update access uses a restricted scope. A project left in Testing can require reauthorization after seven days. Provider verification and organization policies can affect access.

For Microsoft, register a Mobile and desktop public client with the appropriate account types and loopback redirect `http://localhost`. Use delegated mail permissions and no client secret. Use the tenant selector matching your registration. Organization policy may require administrator consent.

Changing a client registration requires reconnecting affected mailboxes. Existing RFQs and imported attachments remain local. Credentials are protected by macOS Keychain or current-user Windows DPAPI and are excluded from portable backups. Local disconnect removes stored credentials; revoke provider consent separately when needed.

Offline email-file import supports EML and MSG. A provider outage does not prevent local estimating.

## What you control

| Component | Where it runs or who controls it |
| --- | --- |
| Workspaces, estimating, quote totals, attachments, and backups | Your computer |
| Optional model and inference runtime | Your computer after model download |
| Optional Gmail or Outlook registration and consent | Your provider project or organization |
| Mailbox service, internet access, policies, and any mailbox subscription | Google, Microsoft, and your organization |

No self-hosted Kwantflow backend is required. Business rules and deterministic quote calculations run in the installed application. The current BYO settings configure Gmail and Outlook; they do not add arbitrary provider APIs, IMAP/SMTP servers, or an ERP connector.

## Back up and move your work

Local scheduled backups cover the installation's workspaces. A backup on the same drive does not protect against drive failure. Use **Export backup** in Settings and keep a copy on another drive or computer.

Portable archives include settings, registered workspaces, databases, attachments, avatars, and AI reference material. They exclude mailbox credentials and the separately installed large AI model.

**Import backup** validates the complete archive before offering restore. Restore replaces the installation's local workspace data, so inspect the workspace count and confirm deliberately. Legacy databases are upgraded in staging. A failed validation or upgrade leaves the live installation intact. Restore restarts the app. Interrupted unfinished replacement is recovered before databases reopen; recovery failure stops startup instead of opening partial workspaces.

Before the first upgrade from 0.12.2, quit every legacy Kwantflow process, including other open instances and background processes, before opening the new version. The supported database v1-to-v2 upgrade removes commercial records while preserving local business data. Keep a backup before upgrading or moving data between macOS and Windows. Unsupported database versions stop with a repair message instead of resetting your data. Do not open upgraded databases with an old app version.

When damaged current data cannot form a validated safety backup, recovery retains the original databases and their SQLite sidecar files in quarantine. Keep those raw originals and recovery files; they may be needed to recover work. The recovery journal records the intended operations.

## Source, licenses, and maintenance

The desktop application is GPL-3.0-only. You may use it commercially, modify it, and distribute it under its license. Distributed covered modifications must include corresponding source. Your customer files, RFQs, and quote documents do not become GPL-licensed.

Dependencies retain their own licenses. macOS and Windows system runtimes have separate vendor terms. The complete source for each release is the matching release tag of the GitHub repository, together with its build instructions, notices, and the hash-pinned third-party source inputs it references. Never redistribute credentials or signing keys.

Kwantflow is community maintained. Anyone can use, modify, and redistribute it under the GPL-3.0 license. Support is not guaranteed, and compatibility with future operating systems or email-provider policies is not guaranteed.

Each release bundles this help, license texts, and third-party notices. **Export diagnostic logs** saves a redacted local ZIP only when you request it; it does not upload a report.

## Full offline manual

All guides below are included with this installation. In-app Help displays plain text; use the guide titles to find a topic. Optional provider setup and downloads require internet when used.

- Start Here: Welcome
- Start Here: Install Kwantflow
- Start Here: Quickstart
- Start Here: First-time setup
- Start Here: Workspaces
- Start Here: Use Settings
- Start Here: Configure business and quote defaults
- Start Here: Back up and restore workspaces
- Start Here: Data and privacy
- Start Here: Get around Kwantflow
- Start Here: Install another version
- Core Workflow: Create your first RFQ
- Core Workflow: Manage the RFQ dashboard
- Core Workflow: Daily estimating workflow
- Core Workflow: Create an RFQ from email
- Core Workflow: Work inside an RFQ
- Core Workflow: Add and review files
- Core Workflow: Group files into assets
- Core Workflow: Organise project structure
- Core Workflow: Create and review an estimate
- Core Workflow: Build takeoffs and costs
- Core Workflow: How Kwantflow AI works on your computer
- Core Workflow: Use Kwantflow AI
- Core Workflow: Ask Kwantflow AI
- Core Workflow: Review AI record proposals
- Core Workflow: Prepare a quote
- Core Workflow: Quote options and revisions
- Core Workflow: Rewrite quote emails
- Optional Email: Connect email
- Optional Email: RFQ Detector with AI
- Setup Data: Companies
- Setup Data: People and contacts
- Setup Data: Materials and rates
- Setup Data: Materials
- Setup Data: Labour rates
- Setup Data: Equipment rates
- Setup Data: Subcontract rates
- Setup Data: Build reusable setup data
- Setup Data: Templates and presets
- Setup Data: Cost presets
- Setup Data: Estimate templates
- Setup Data: Workspace AI knowledge
- Setup Data: Setup import
- Setup Data: Classifications
- Examples: Common estimating scenarios
- Examples: Email RFQ to quote
- Examples: Multi-package tender
- Examples: Repeat work with templates
- Examples: Supplier and rate review
- Troubleshooting: Install and update issues
- Troubleshooting: File and AI issues
- Troubleshooting: Import issues
- Troubleshooting: Records and relationships issues
- Troubleshooting: Workspace and backup issues
- Troubleshooting: Email and RFQ detection issues
- Troubleshooting: Estimate and quote issues
- Troubleshooting: AI answer and proposal issues
- Reference: Frequently asked questions
- Reference: Supported files
- Reference: Keyboard shortcuts
- Reference: Glossary

# Welcome

Kwantflow is free, local, open source software. It helps estimators and quoting teams turn RFQ information into organised estimates and quote outputs.

Use these docs when you want to learn the product without engineering language. Start with the quickstart if you want the shortest path, or follow the full workflow if you are setting up a real workspace.

## What you can do in Kwantflow

- Manage RFQs from the dashboard.
- Add tender files and review them in one place.
- Group related files into Assets so each part of the job has its own estimate.
- Build estimates from your own materials, labour, equipment, subcontract rates, templates, and classifications.
- Use Kwantflow AI to prepare a first estimate for review.
- Prepare quote options and quote revisions from the estimates you choose to include.

## How these docs are organised

- **Start Here** covers installation, first-time setup, workspaces, navigation, and manual replacement versions.
- **Core Workflow** walks through RFQs, files, assets, estimates, AI drafting, and quotes.
- **Setup Data** explains the shared records you reuse across jobs.
- **Troubleshooting** covers common setup, import, file, and AI problems.
- **Reference** gives file support, shortcuts, and glossary pages.
- **Examples** shows how common enquiries, addenda, repeat work, email intake, and multi-workspace setups fit together.

## Good first page

Read Kwantflow user manual (see "Kwantflow user manual" in this manual) for download, installation, optional AI, backups, and maintenance status.

Go to Quickstart (see "Quickstart" in this manual) if you want a short end-to-end path.

If you already understand the basics and want a practical pattern, open Common estimating scenarios (see "Common estimating scenarios" in this manual).

# Install Kwantflow

Kwantflow is free, open source software. Download installers from the Releases page of the project's GitHub repository, or build from source.

## Choose your download

Download the macOS `.dmg` or Windows x64 `-setup.exe` installer from the GitHub Releases page of the project repository. Each release lists SHA-256 checksums. Downloads require no account or registration. The source archive is for developers; it is not the installer.

The packaged app includes its required native libraries. You do not need developer tools, containers, or a database server. Local AI is a separate optional download of approximately 3.7 GB.

## Install on macOS

1. Download the universal `.dmg` for Apple Silicon and Intel Macs.
2. Open the DMG.
3. Drag **Kwantflow** into **Applications**.
4. Open Kwantflow from Applications.

Community builds may be unsigned or ad hoc signed, so macOS may ask you to confirm opening the app from System Settings > Privacy & Security. If macOS reports a damaged application, an invalid signature, or a security block, stop and use the installation troubleshooting guide (see "Install and update issues" in this manual).

## Install on Windows

1. Download the Windows x64 `-setup.exe` installer.
2. Run the installer and follow its prompts.
3. Open Kwantflow from the Start menu or installed shortcut.

The Windows installer is unsigned. SmartScreen, Smart App Control, S mode, or your organization's policy may warn or block it. A checksum establishes the downloaded file's identity; it does not create trusted-publisher status. Do not disable security protections to bypass a block.

The installer includes the offline WebView2 prerequisite and required native libraries. If an absent Microsoft system prerequisite requires administrator approval or a restart, the installer explains that step. Local AI setup requires internet separately.

## First launch

Create a local workspace and enter your business details. Setup import and AI installation can be skipped. There is no Kwantflow signup, subscription, trial, or license activation.

First-time setup (see "First-time setup" in this manual) explains the required local fields and optional setup steps.

# Quickstart

This quickstart gives you the fastest path from a fresh install to a quote-ready workflow.

## 1. Create your workspace

1. Open Kwantflow.
2. Enter a workspace name, usually your company name.
3. Continue through first-time setup.
4. Skip setup import and Kwantflow AI if you want to explore first.

You can return to setup import and Kwantflow AI later.
Read Workspaces (see "Workspaces" in this manual) first if you plan to keep separate business environments on the same device.

## 2. Create your first RFQ

1. Open the RFQ dashboard.
2. Create a new RFQ.
3. Add the job name, client or requester details, due date, and any notes you need.
4. Attach the initial drawings, schedules, specifications, spreadsheets, PDFs, or other tender files.
5. Save the RFQ.

## 3. Review tender files

1. Open the RFQ.
2. Review the files in the project file area.
3. Group related files into an Asset when they belong to the same part of the job.
4. Add later revisions or missing files through the RFQ file workflow when new information arrives.

## 4. Create an estimate

1. Open an Asset.
2. Start or open its estimate.
3. Add line items manually, from setup data, or from a template.
4. Check quantities, rates, units, classifications, and totals.

## 5. Use AI drafting when useful

If Kwantflow AI is configured, you can ask it to draft an estimate from the files and project context.

Always review the result. AI drafting is a starting point, not approval to quote without checking.

## 6. Prepare the quote

1. Open the quote area for the RFQ.
2. Choose which Asset estimates to include.
3. Review quote options, revisions, totals, and customer-facing details.
4. Export or share the quote output when it is ready.

## Next steps

Read the full workflow: Create your first RFQ (see "Create your first RFQ" in this manual).

Use Common estimating scenarios (see "Common estimating scenarios" in this manual) for practical examples covering simple enquiries, multi-package RFQs, addenda, repeat work, email intake, and workspace separation.

# First-time setup

First-time setup prepares a local workspace for your company’s estimating work. It does not register a Kwantflow account.

## 1. Create a workspace

Your workspace is where your RFQs, setup records, estimates, quote work, email connections, and workspace AI guidance live.

1. Open Kwantflow.
2. Enter a workspace name.
3. Continue into the workspace.

Use a name your team will recognise, such as your business name.

If you plan to keep separate operating environments on the same computer, read Workspaces (see "Workspaces" in this manual).

## 2. Add business details

Your business profile is used for quote and document output.

Enter the required country, business name, and contact fields shown by the form. Optional details, such as identifiers, can be added where relevant. These details belong to the local workspace and quote output, not a remote signup.

You can update these later in Settings.

## 3. Import setup data if you already have it

Setup import helps seed reusable records such as companies, materials, rates, presets, templates, and classifications.

You can skip this during first-time setup and import later from setup pages.

## 4. Configure Kwantflow AI if you want drafting help

Kwantflow AI is optional during setup. Choose **Download** for the approximately 3.7 GB model or **Skip** to continue manual estimating. The first download needs internet; installed AI runs locally.

You can set it up later in Settings. The engine loads for an AI task, not simply because you complete setup.

## Expected result

You land on the RFQ dashboard and can create your first RFQ.

Next: Get around Kwantflow (see "Get around Kwantflow" in this manual).

# Workspaces

Each workspace is an independent local environment inside Kwantflow.

Use separate workspaces when you need to keep different businesses, divisions, teams, or operating environments apart.

## What stays inside a workspace

Each workspace keeps its own:

- RFQs and projects
- files and assets
- estimates and quote history
- companies, people, materials, and rates
- setup preferences
- email connections and RFQ detection results
- AI playbooks, uploaded knowledge, and feedback

Switching workspaces does not mix this information.

## What is shared on the device

Some app-level items are shared on the computer, such as the installed Kwantflow app and the downloaded Kwantflow AI file.

That does not mean workspace context is shared. When you switch workspaces, the AI should use the active workspace only.

## Create a workspace

You can create a workspace during first-time setup or later from workspace management in the app.

Use a name your team will recognise, such as a business name or internal operating unit.

## Switch, rename, or delete a workspace

- Switch workspaces when you want to move into another business environment.
- Rename a workspace when the label is no longer clear.
- Delete a workspace only when you no longer need its local data on that device.

Deleting a workspace removes its local records from that installation. It does not merge them anywhere else.

## Workspace availability

Kwantflow has no limit on the number of workspaces. Available disk space and your computer's resources still determine how much data it can hold.

Backups cover the installation's registered workspaces together. A restore replaces all of them, rather than merging the selected workspace.

Next: Get around Kwantflow (see "Get around Kwantflow" in this manual).

# Use Settings

Settings is the control surface for the active workspace and your local installation.

Use it when you need to manage workspace details, business defaults, email connections, backups, or AI behavior.

## Main areas

Settings currently groups work into areas such as:

- user details
- workspace details
- business profile
- general defaults
- visible setup pages
- backups
- connections
- knowledge
- agent controls

## When to use each area

### User

Use this area for your local operator profile, including the personal details and avatar used by the app.

### Workspace

Use this area when you need to rename, create, switch, or delete local workspaces.

### Business

Use this area for the business identity that appears in quotes and customer-facing output, such as:

- business name
- contact details
- address
- identifiers
- email signature

### General

Use this area for defaults that affect everyday estimating output, such as:

- currency
- measurement style
- number and date formatting
- quote defaults

Read Configure business and quote defaults (see "Configure business and quote defaults" in this manual) for the complete setup and review checklist.

### Setup Pages

Use this area when you want to control which optional setup pages are visible in the app shell.

### Backups

Use this area to:

- review local restore points
- create a manual backup
- restore a backup
- delete an old backup
- export or import a portable backup archive

Restoring a backup replaces all registered workspaces and local settings on the installation, so review its scope and date first.

Read Back up and restore workspaces (see "Back up and restore workspaces" in this manual) for the full recovery flow.

### Connections

Use this area to configure your own provider registrations, then connect or disconnect Gmail and Outlook for the active workspace. Email setup (see "Connect email" in this manual) explains the provider requirements.

Choose **Email setup guide** to open the bundled instructions without internet. Paste your registration IDs, choose **Save email registrations**, then connect the mailbox. The registration belongs to you or your organization, and the app connects directly to its provider without a Kwantflow server.

It is also where you review connection-specific controls such as detection behavior and mailbox refresh preferences for that workspace.

### Knowledge

Use this area to manage workspace AI playbook text, uploaded knowledge files, and related AI guidance for the current workspace.

This is also where saved AI feedback history belongs when you want the workspace AI to keep learning from repeated corrections.

### Agent

Use this area to install or review Kwantflow AI on the device and control AI-related workspace features such as Mail RFQ Detection.

Use this area when you need to:

- install Kwantflow AI on a new device
- confirm the device AI is ready
- review workspace AI availability
- control AI-assisted mailbox behavior for the active workspace

## Example scenarios

- You want a different business signature on outgoing quote emails.
- You need to connect Gmail in one workspace without affecting another.
- You want to restore yesterday’s local backup after a bad setup change.
- You want to add a workspace-specific playbook before using AI on a repeat kind of job.

## Good habit

Open Settings when the change should affect the workspace or installation itself.

Stay in the workflow pages when the change is specific to one RFQ, asset, estimate, or quote.

Next: Get around Kwantflow (see "Get around Kwantflow" in this manual).

# Configure business and quote defaults

Business and general defaults help new quotes start with consistent customer-facing information.

These settings belong to the active workspace. Configure them separately when different workspaces represent different businesses or departments.

## Business identity

In **Settings → Business**, review the information that may appear in customer-facing output:

- business name;
- primary contact first and last name;
- contact email and phone;
- your role;
- business type;
- country and relevant business identifier;
- business address;
- default email signature.

Use details that customers should see. Do not enter private notes or credentials in customer-facing fields.

## Country and business identifiers

Choose the country that reflects the business issuing the quote. This helps Kwantflow use suitable defaults for identifiers, tax wording, and regional presentation.

Review any business identifier before export. The label and expected value vary by country and organisation.

## Currency and measurement style

In **Settings → General**, choose the normal:

- currency;
- metric or imperial measurement style;
- date format.

These defaults improve consistency, but individual catalogue records and commercial inputs still need the correct unit and currency.

Changing a workspace default does not make unlike values interchangeable. For example, a price per kilogram cannot be treated as a price per tonne without a deliberate conversion.

## Tax defaults

Set the normal tax rate for quotes issued by this workspace.

Before issuing a quote, confirm that the rate and tax treatment are correct for the customer, goods or services, and jurisdiction. A workspace default is a convenience, not tax advice.

## Quote numbering and validity

Configure:

- the normal quote-validity period;
- the quote-number prefix;
- the quote-number format.

Use a stable convention that your team can recognise and reconcile with its wider business process. Avoid changing numbering conventions casually after quotes have already been issued.

## Default commercial wording

You can prepare reusable defaults for:

- payment wording;
- inclusions;
- exclusions;
- terms and conditions.

These values provide a starting point for new quote output. Review and edit them for the current RFQ whenever scope or commercial conditions differ.

Keep the wording concise and approved by the business. Do not rely on a default exclusion to compensate for an unclear estimate.

## Email signature

The workspace email signature is appended to outgoing quote emails.

Keep it suitable for the business represented by that workspace. Review it after staff, role, phone, address, or branding changes.

## What changes affect existing work?

Defaults mainly guide new or newly prepared output. Previously exported quote revisions remain historical commercial snapshots.

When a business setting changes:

1. review any quote still in progress;
2. confirm the current PDF and email output;
3. create a new revision when issued commercial information changes;
4. preserve earlier exports as the record of what was issued at that time.

## Multi-workspace example

One installation manages an Australian fabrication business and a separate New Zealand services business.

Each workspace can have its own business identity, currency, tax wording, measurement style, quote numbering, commercial defaults, email connection, and signature. Switching workspaces changes the active business context without combining their RFQs or records.

## Review checklist

Before the first live quote from a workspace, verify:

- business and contact identity;
- address and identifier;
- currency and measurement style;
- date and tax settings;
- quote numbering and validity;
- payment, inclusion, exclusion, and terms wording;
- email signature;
- a sample exported quote.

## Related guides

- Use Settings (see "Use Settings" in this manual)
- Workspaces (see "Workspaces" in this manual)
- Prepare a quote (see "Prepare a quote" in this manual)
- Quote options and revisions (see "Quote options and revisions" in this manual)

# Back up and restore workspaces

A backup covers the installation's registered workspaces together. Restoring replaces the installation's local data; it does not merge one workspace into another.

## Local restore points

Settings > Backups lists local restore points and their dates, reasons, and app versions. Use **Back Up Now** before a large import, cleanup, or other change you may need to undo. Automatic weekly backups run while the app is open and suitable for a snapshot.

A backup on the same drive cannot protect against drive failure. Use a portable archive for a separate copy.

## Export a portable backup

1. Open Settings > Backups.
2. Choose **Export backup**.
3. Save the ZIP archive to another drive or copy it to another computer.
4. Keep the archive private: it contains your business records and customer documents.

The archive includes registered workspaces, local settings, databases, managed attachments, avatars, and workspace AI reference material. It excludes mailbox credentials and the separately installed large AI model and model caches. A backup is not an installer.

## Import and restore

1. Install a compatible Kwantflow version on the destination computer.
2. Open Settings > Backups and choose **Import backup**.
3. Select the archive and let the app validate it.
4. Review the restore point and workspace count.
5. Confirm only when you intend to replace **all workspaces on this installation**.
6. Allow the app to restart and inspect your restored work.

The importer checks the archive before replacement and prepares older supported databases separately. Validation or preparation failure leaves your current installation intact. Unsupported database versions stop with a repair message rather than resetting your data.

The app keeps recovery data while completing the replacement and checking the restored installation. An interrupted unfinished restore is recovered before workspaces reopen. Do not delete recovery files or force-close an active restore.

If damaged current data cannot be read into a validated safety backup, recovery preserves the original databases and their SQLite sidecar files in quarantine. Keep these raw originals and the recovery record; they may be needed to recover work.

After moving computers, reconnect Gmail or Outlook and download AI separately if needed. Cross-platform transfer between macOS and Windows is not yet fully tested; keep the original backup until the restored workspace is checked.

## Before restoring a local point

Check its date and all-workspace scope. Later changes will be replaced. Export the current installation first if you may need those changes again.

Workspace and backup issues (see "Workspace and backup issues" in this manual) covers missing points, invalid archives, and interrupted recovery.

# Data and privacy

Kwantflow stores estimating work on your computer. It does not require a Kwantflow account or send automatic usage, incident, or subscription reports.

## Local workspace data

Each workspace contains its RFQs, customer records, materials and rates, files, assets, takeoffs, estimates, quote revisions, reusable setup data, business settings, AI reference material, and remembered email RFQ detection results.

Switching workspaces changes the active business environment without merging its records into another. Check the workspace name before importing data or creating records.

## When internet is used

- Downloading the installer and optional AI model.
- Connecting, refreshing, receiving, or sending through optional Gmail and Outlook integrations.
- Opening an external link.

Core estimating, local file review, quote export, backups, and downloaded local AI do not require a company service. Provider or hosting outages can affect the optional internet actions.

## Connected email

Email connections (see "Connect email" in this manual) are workspace-specific. Provider registration settings belong to the local installation. Only connect a mailbox when you want the selected workspace to use it.

The initial RFQ detection decision uses message information and body text. Attachments are handled separately for RFQ intake. Review recipients, attachments, totals, and generated wording before sending.

Remote email images are blocked because loading them can reveal that a message was opened. Embedded raster images can still appear locally. Expand **Links in this email** beneath the message to review the actual destination before opening an external link.

Mailbox credentials use macOS Keychain or current-user Windows DPAPI. They are not included in portable backups. A local disconnect removes the stored connection; revoke the provider grant separately if you want to withdraw provider consent.

## Local AI

After the model download, AI inference runs on your computer. The model uses active-workspace context for the task you request. AI output remains subject to review, deterministic calculations, and explicit approval for record proposals.

## Backups and diagnostics

Portable archives (see "Back up and restore workspaces" in this manual) contain business data across all registered workspaces, including customer files. Store them securely. Credentials and the downloaded AI model are excluded.

**Export diagnostic logs** saves a local redacted ZIP when you request it. It does not submit a report. Inspect any archive before sharing it yourself.

Customer files, RFQs, and quote outputs do not become GPL-licensed because you use Kwantflow. Follow your organization's policies for confidential and personal information.

# Get around Kwantflow

Kwantflow uses a dashboard, sidebar, pages, and tabs so you can keep estimating work open while checking related information.

## Dashboard

The dashboard is where you manage active RFQs and jobs. Start here when you want to open an existing RFQ or create a new one.

## Sidebar

The sidebar is the main navigation area.

Common areas include:

- **Projects** for RFQs and active jobs.
- **Explorer** for files and project structure.
- **Pages** for setup records such as materials, rates, templates, and classifications.
- **Mail** for workspace email review where available.

## Tabs

Tabs let you keep multiple pieces of work open.

For example, you can keep a quote open while checking the material catalogue.

## Settings

Use Settings for workspace details, business profile, setup defaults, Kwantflow AI, email connections, and your local operator profile.

Read Use Settings (see "Use Settings" in this manual) if you want the full breakdown of workspace manager, backups, connections, knowledge, and agent controls.

Next: Create your first RFQ (see "Create your first RFQ" in this manual).

# Install another version

Kwantflow does not check for updates automatically. Download newer versions from the project's GitHub Releases page when you choose to update.

## Before replacing the app

1. Save your work.
2. Export a backup (see "Back up and restore workspaces" in this manual) and keep it outside the installation's drive.
3. Check the new release's source, license, supported systems, upgrade notes, and maintainer identity.
4. Quit every Kwantflow instance and background process before running the installer. For the first upgrade from 0.12.x, confirm that no legacy Kwantflow process is still running before opening the new version.

Install the replacement application without deleting workspace data. The first upgrade from 0.12.2 moves the supported databases from v1 to v2, removes commercial records, and preserves local business data. An old process must not reopen a database after it has been upgraded.

## After installation

Check each workspace's RFQs, attachments, estimates, quote revisions, setup records, and business details. Reconnect email using your own provider registration when prompted.

Do not open an upgraded database with an older app version. If you need to return to an older version, use a compatible backup and its matching app version deliberately; replacing only the binary is not a data rollback.

Kwantflow is community maintained, so compatibility with future operating-system and email-provider changes is not guaranteed. Install and update issues (see "Install and update issues" in this manual) covers download, launch, and upgrade failures.

# Create your first RFQ

An RFQ is the top-level job in Kwantflow. Use it to collect tender information, attach initial files, organise assets, build estimates, and prepare quote output.

You can start an RFQ manually from the dashboard or prepare one from a connected email when the request arrives through Gmail or Outlook.

## Before you start

Have the basic job details ready:

- job or project name
- requester or client
- due date
- project notes or scope summary
- initial tender files when they are already available

## Create an RFQ

1. Open the RFQ dashboard.
2. Choose the action to create a new RFQ.
3. Enter the job details.
4. Attach the initial files you want stored with the RFQ.
5. Save the RFQ.

## Typical details to capture

Good RFQ records usually include:

- job or package name
- client or requester
- due date
- site or project reference
- scope notes
- any early assumptions or exclusions
- drawings, specifications, spreadsheets, emails, or other initial files

## Common starting scenarios

- A builder sends a tender package with drawings, schedules, and due date.
- A repeat customer asks for pricing on a known material or fabricated part.
- A supplier or subcontractor forwards a package that needs fast review.
- An email arrives first, and you prepare the RFQ from the message before saving it.

## Expected result

The RFQ opens with the reviewed details and any saved initial files ready for asset grouping and estimating work.

Next: Create an RFQ from email (see "Create an RFQ from email" in this manual) or Add and review files (see "Add and review files" in this manual).

# Manage the RFQ dashboard

The RFQ dashboard is the main list of enquiries in the active workspace.

Use it to decide what needs attention, open an RFQ workspace, and keep completed work out of the active queue without losing its record.

## Understand the columns

The dashboard can show information such as:

- RFQ number;
- customer company and requester;
- project or package name;
- priority;
- status;
- file count;
- submission deadline.

Use search, sorting, and view controls to narrow a busy list.

## Use statuses consistently

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

## Set priority

Priority can be Low, Medium, High, or Critical.

Use priority for business urgency, not as a replacement for the deadline. A high-value opportunity due next month and a small quote due today may need different kinds of attention.

## Review deadlines

Record the submission deadline supplied by the customer. If the date changes, update the RFQ and review whether the estimating plan or lead time must also change.

## Active, archived, and all views

- **Active** keeps current work visible.
- **Archived** contains RFQs removed from the active queue.
- **All** helps search across both.

Archive completed, cancelled, or dormant work when it no longer belongs in the daily queue. Restore an archived RFQ if work resumes.

## Reorder and bulk actions

Active RFQs can be manually reordered when the list is not currently sorted by a column.

Use bulk actions carefully for archive, restore, or delete operations. Review the selected rows before confirming because one action can affect several RFQs.

## A practical daily review

At the start of the day:

1. Review critical and high-priority RFQs.
2. Check deadlines due soon.
3. Move active work into **Estimating** when review begins.
4. Open RFQs waiting for files or clarification and update their notes.
5. Archive work that no longer needs to remain active.

## Related guides

- Create your first RFQ (see "Create your first RFQ" in this manual)
- Work inside an RFQ (see "Work inside an RFQ" in this manual)
- Create an RFQ from email (see "Create an RFQ from email" in this manual)

# Daily estimating workflow

Kwantflow does not require one rigid process. A consistent daily routine can still reduce missed deadlines, duplicated work, and stale rates.

## Start with the RFQ dashboard

At the beginning of the day:

1. Review active RFQs by due date and priority.
2. Check newly received enquiries.
3. Confirm which RFQs are waiting for information, ready to estimate, or ready to quote.
4. Archive work that is no longer active when your team no longer needs it in the active view.

Use Manage the RFQ dashboard (see "Manage the RFQ dashboard" in this manual) for statuses, priorities, deadlines, and bulk actions.

## Triage connected email

If a mailbox is connected for the active workspace:

- review messages identified as possible RFQs;
- open the message before accepting the detection result;
- create a reviewable RFQ intake when the enquiry belongs in Kwantflow;
- confirm the requester, company, dates, and attachments before saving;
- leave unrelated messages outside the RFQ workflow.

Mail RFQ Detection helps prioritise review. It does not replace your decision about whether an enquiry should become an RFQ.

## Progress the highest-priority RFQ

Inside the RFQ:

1. Review the latest files and customer notes.
2. Confirm whether any addendum or revised drawing changes the scope.
3. Group files into practical assets when the enquiry contains separate packages.
4. Update takeoffs and costs against the current evidence.
5. Record assumptions, inclusions, exclusions, and unresolved questions while they are fresh.

When information is missing, keep the uncertainty visible. Do not turn an assumption into a reusable workspace fact.

## Review calculations and sources

Before treating an estimate as ready:

- verify quantities and units;
- check linked material, labour, equipment, and subcontract rates;
- confirm the currency and rate basis;
- inspect manual allowances;
- check whether current supplier information differs from the workspace default;
- confirm totals after every material scope change.

Kwantflow AI can help find records and calculate exact arithmetic, but the selected records and commercial assumptions still require review.

## Prepare the commercial response

When the estimate is stable:

1. Choose which asset estimates belong in the quote.
2. Review quote options and markups.
3. Check customer details, identifiers, currency, tax, totals, lead time, inclusions, exclusions, and terms.
4. Export the intended revision.
5. Review any rewritten email before sending it.

An exported revision is a commercial snapshot. If the scope changes later, update the estimate and create the next reviewed revision.

## Improve reusable data after the job

When you discover something worth reusing:

- update a verified material or rate;
- link the relevant supplier or subcontractor;
- save a recurring cost pattern as a cost preset;
- save a genuinely repeatable estimate as a template;
- add a stable classification or cost code;
- improve workspace AI guidance when the correction should apply again.

Do not add one-off customer details merely because they appeared in the latest RFQ.

## End-of-day check

Before closing the app:

- confirm urgent RFQs have clear next actions;
- save or finish any important edits;
- create a manual backup before a major setup change when appropriate;
- verify that you are working in the correct workspace if you manage more than one business.

## Related guides

- Work inside an RFQ (see "Work inside an RFQ" in this manual)
- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)
- Prepare a quote (see "Prepare a quote" in this manual)
- Build reusable setup data (see "Build reusable setup data" in this manual)

# Create an RFQ from email

Create an RFQ from email when the request arrives in a connected mailbox and you want Kwantflow to prepare the intake details for review.

This is a preparation flow, not an automatic job-creation flow.

## When to use it

Use this when:

- a tender invitation arrives by email
- the sender included useful scope notes in the email body
- you want attachments brought into the RFQ review flow
- you want help matching the sender to existing companies or people

## Before you start

Check that:

- the correct workspace mailbox is connected
- the email belongs to the current workspace
- the message looks worth turning into a real RFQ

## How it works

1. Open the email inside Kwantflow.
2. Choose **Create RFQ from email**.
3. Review the prepared intake form.
4. Check the suggested company and person matches.
5. Check the job name, notes, dates, and other extracted details.
6. Review the attachments that were added alongside the intake.
7. Save the RFQ only after the form looks right.

## What Kwantflow can prepare

The review form can help with:

- sender and company context
- requester or contact matching
- job or package naming
- notes pulled from the email body
- attachments added into the intake workflow

If the same email is already linked to one or more RFQs, you can open those RFQs directly from the email preview.

If a company or person match is unclear, review it yourself instead of assuming it is correct.

## Example

If an email says:

`Please quote the attached steel frame package. Price due Friday.`

Kwantflow can help prepare:

- a draft RFQ title
- linked sender details where a clear match exists
- the body text as intake context
- the attached files ready for review

You still decide whether the draft should become a real RFQ.

## Useful actions in email preview

From the email preview you can also:

- download attachments individually
- create a company or contact from the sender
- open an existing RFQ already linked to the same email
- review the full sender, recipients, date, and subject before creating the RFQ
- expand **Links in this email** beneath the message and select a displayed destination to open it

## Common scenarios

- A clean tender invite arrives with clear dates and attachments, so most intake fields are prepared for review.
- A forwarded message has partial context, so Kwantflow prepares what it can and leaves the rest for manual review.
- A repeat customer sends another package, and Kwantflow can often match the existing company or requester record.
- One email leads to more than one RFQ over time, and the email stays a useful reference point.

## Important review rule

No RFQ is created until you review and save the intake form.

Next: Add and review files (see "Add and review files" in this manual).

# Work inside an RFQ

An RFQ workspace keeps the information, files, estimating work, and quote output for one enquiry together.

Use it after creating an RFQ from the dashboard or preparing one from a connected email.

## The RFQ workflow

Most jobs move through the same broad sequence:

1. Review the RFQ details and deadline.
2. Review the received files.
3. Group related files into practical assets or work packages.
4. Organise the project structure when the job needs a deeper breakdown.
5. Build and review an estimate for each asset.
6. Prepare quote options and commercial details.
7. Export the quote and prepare the covering email.

You can return to an earlier step whenever new information arrives.

## RFQ details

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

## Files and assets

Files are the documents received for review. Assets are the estimating bundles you create from those files.

For example, one RFQ may contain:

- a drawing set for a steel frame;
- a spreadsheet for doors and hardware;
- a specification for coatings;
- an addendum that changes one drawing.

You could group these into separate assets when they need independent takeoffs or pricing. A small enquiry with one drawing may need only one asset.

## Project structure

Project Structure is optional. Use it when an asset still needs an internal breakdown by phase, level, room, zone, trade, or another practical grouping.

Do not create structure simply because the feature exists. A flat estimate is easier to review when the job is simple.

## Estimates and quotes

The estimate is where quantities, units, rates, and cost components are prepared. The quote is where the reviewed estimate information is turned into a commercial offer.

This separation lets you keep detailed internal costing while presenting a clearer customer-facing quote.

## When new information arrives

Treat an addendum or revised drawing as new evidence:

1. Add the new file through the RFQ file workflow.
2. Review what changed.
3. Update the affected asset and estimate.
4. Recheck totals, exclusions, and lead time.
5. Export a new quote when the commercial output has changed.

Do not assume that a revised file affects every asset. Update only the scope that is actually changed.

## Example: one enquiry, three packages

A builder requests pricing for structural steel, stairs, and handrails.

- Create one RFQ for the enquiry.
- Group the files into three assets: Structural steel, Stairs, and Handrails.
- Build one working estimate in each asset.
- Include the relevant assets in the quote.
- Create quote options if the customer should be able to accept packages separately.

## Related guides

- Add and review files (see "Add and review files" in this manual)
- Group files into assets (see "Group files into assets" in this manual)
- Organise project structure (see "Organise project structure" in this manual)
- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)
- Prepare a quote (see "Prepare a quote" in this manual)

# Add and review files

Files usually arrive before the estimate is ready. Attach the initial file set while creating or reviewing the RFQ, then organise those files into Assets when you understand what they belong to.

The goal at this stage is simple: make sure the workspace has the real quoting evidence before anyone starts pricing.

## Review files

1. Open the RFQ.
2. Review the tender files saved with the RFQ.
3. Wait for previews or file summaries where available.
4. Open each important file and check that it is readable.

## Add later files

When an addendum, revised drawing, or missing schedule arrives later, add it to the existing RFQ through the supported RFQ file workflow, then review what changed before updating assets or estimates.

## Review files

Look for:

- drawings and specifications
- schedules and bills
- addenda
- spreadsheets
- images
- emails or attachments

## A practical review pass

Before grouping files into Assets, ask:

- Which files define scope?
- Which files change scope?
- Which files are only supporting reference?
- Which files belong to the same package or trade area?
- Is anything missing that would block pricing confidence?

## Common scenarios

- A multi-sheet drawing pack and one addendum belong to the same fabricated package.
- A schedule spreadsheet should stay linked to the same asset as the drawings it supports.
- An email attachment may explain the urgency or due date even when the PDF set looks complete.

## Expected result

You know which files belong together and which files are ready to group into Assets.

Next: Group files into assets (see "Group files into assets" in this manual).

# Group files into assets

An Asset is a bundle of related files and estimating work inside an RFQ.

Use Assets when a job has separate areas, systems, packages, buildings, stages, or work types.

Files that are not grouped yet stay in a review queue until you place them into an Asset.

## Group files

1. Select files that belong together.
2. Choose **Group into Asset**.
3. Name the Asset clearly.
4. Confirm the group.

You can also rename an Asset, add more review files into an existing Asset, remove a file from an Asset, or ungroup an Asset when you need to send its files back to the review queue.

## Good Asset names

Use names that will still make sense when preparing the quote, such as:

- Block A structure
- Fire protection
- Level 3 fitout
- External works
- Mechanical package

Avoid temporary names such as `Misc files`, `RFQ docs`, or `New group`.

## Common grouping patterns

- one Asset per trade package
- one Asset per building or zone
- one Asset per drawing set when the customer expects split pricing
- one Asset per fabrication package or deliverable

## When to regroup

Regroup when:

- one Asset covers unrelated scope
- you need different estimate logic for different parts of the RFQ
- one file belongs to the wrong package
- the customer wants separated pricing by building, area, or option

## Expected result

Each Asset should represent one estimate-ready work package with a clear purpose.

If another estimator opened the RFQ, they should understand why each file belongs where it does.

Next: Create and review an estimate (see "Create and review an estimate" in this manual).

# Organise project structure

Project Structure helps you organise a complex job into sections that are easier to estimate and review.

It is sometimes called a work breakdown structure, or WBS.

## When to use it

Use Project Structure when one RFQ or asset contains meaningful internal divisions, such as:

- design, fabrication, finishing, and installation phases;
- building levels or rooms;
- plant areas or site zones;
- trades or disciplines;
- assemblies, packages, or deliverables.

Skip it when a short list of takeoff items already explains the job clearly.

## Create a structure

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

## Choose useful names

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

## Reorder and place nodes

Placement controls where a node sits in the hierarchy. Order controls how sibling nodes appear.

Before moving a node, check whether its children should move with it. A parent cannot be placed underneath one of its own descendants.

## Save a structure template

If the same breakdown appears on many jobs, save the current structure as a template.

Examples include:

- a standard fabrication lifecycle;
- a repeatable building-level structure;
- a maintenance shutdown package;
- a standard machine-build sequence.

Templates are starting points. After applying one, adjust it to match the current RFQ rather than treating it as fixed.

## Example: fabrication and installation

For a fabricated platform, a useful structure might be:

1. Engineering and detailing
2. Material procurement
3. Workshop fabrication
4. Surface treatment
5. Transport
6. Site installation

This makes omissions easier to spot and lets reviewers understand where each cost belongs.

## Related guides

- Work inside an RFQ (see "Work inside an RFQ" in this manual)
- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)
- Templates and presets (see "Templates and presets" in this manual)
- Classifications (see "Classifications" in this manual)

# Create and review an estimate

Each Asset can have a working estimate. The estimate is where you turn files, scope, quantities, rates, and assumptions into pricing.

This is the main decision area of the workflow. The estimate should be strong enough that the quote output becomes a packaging step, not a rescue step.

## Create an estimate

1. Open the Asset.
2. Start or open the estimate.
3. Add line items manually, from setup records, or from templates.
4. Check quantity, unit, rate, classification, and notes.

## Common ways to build the estimate

- Start from your own reusable setup data.
- Start from a template for repeatable work.
- Build manually when the package is unusual.
- Use AI drafting as a first pass, then review it line by line.

## Review the estimate

Before using an estimate in a quote, check:

- every required scope item is included
- rates are current
- quantities are sensible
- units match the way you price the work
- classifications and cost codes are correct
- totals match your expectations

## Good review questions

- What did we price?
- What did we not price?
- Are bought-out items using the right supplier context?
- Do units and rates match how this work is actually sold?
- If another estimator opened this tomorrow, would the logic still be clear?

## Expected result

The Asset has a reviewed estimate that can feed the quote.

Next: Use AI drafting (see "Use Kwantflow AI" in this manual) or Prepare a quote (see "Prepare a quote" in this manual).

# Build takeoffs and costs

A takeoff item describes a measurable piece of scope. Cost components describe what it costs to deliver that scope.

Together they form the working estimate inside an asset.

## Create a takeoff item

Use one takeoff item for one clearly measurable part of the work.

Examples:

- 250 kg of galvanised plate;
- 18 metres of handrail;
- 6 fabricated brackets;
- 2 days of site installation;
- one mobilisation allowance.

Give the item a recognisable name and record the quantity and unit. Add a description when the measurement basis or included work is not obvious.

## Add cost components

Cost components can represent:

- materials;
- labour;
- equipment;
- subcontract work;
- manual allowances.

For each row, review the category, name, quantity, unit, rate, and total.

## Link workspace records

When a matching material or rate already exists in the workspace, link it instead of typing a disconnected copy.

You can search workspace data by name, code, or alias. Linking makes the source easier to recognise and lets you start from a known unit and rate.

The current estimate remains the job-specific working record. Review the quantity and rate even when they came from reusable setup data.

## Add manual rows

Use a manual row when the cost is specific to this job and does not belong in the reusable catalogue.

Examples:

- a one-off freight allowance;
- a special permit fee;
- temporary access required only for this site;
- a customer-specific testing charge.

Do not add every one-off allowance to workspace setup data. Reusable catalogues work best when they contain rates the business expects to use again.

## Check units before rates

A correct rate with the wrong unit produces the wrong estimate.

Before accepting a total, confirm that:

- the takeoff quantity uses the intended unit;
- the cost row rate uses a compatible basis;
- conversions are deliberate;
- currency is consistent;
- decimal places have not changed the intended value.

For example, a rate per tonne must not be multiplied directly by a quantity in kilograms without conversion.

## Use classifications and cost codes

Classifications organise estimate content for review and reporting. They do not replace the takeoff or cost row.

Apply them when your business needs a consistent breakdown across jobs, such as trade, phase, cost centre, or customer coding.

## Review AI drafts

An AI draft is a starting point, not an approved estimate.

Check every proposed item against the source file. Pay particular attention to:

- dimensions and quantities;
- units;
- material grades and specifications;
- assumed rates;
- exclusions and missing scope;
- evidence references.

Keep, edit, or remove each item based on the actual RFQ evidence.

## Example: steel plate calculation

Suppose a takeoff contains 250 kg of plate and the linked material rate is 4.85 AUD per kg.

```text
250 kg × 4.85 AUD/kg = 1,212.50 AUD
```

Then add any separate cutting, fabrication, coating, freight, or installation components required by the scope.

## Related guides

- Materials and rates (see "Materials and rates" in this manual)
- Create and review an estimate (see "Create and review an estimate" in this manual)
- Use Kwantflow AI (see "Use Kwantflow AI" in this manual)
- Classifications (see "Classifications" in this manual)

# How Kwantflow AI works on your computer

Kwantflow AI is a language model that runs entirely on your own computer. There is no Kwantflow server, no account, no API key, and no usage charge.

## The model

- Kwantflow uses Google's Gemma 4 E4B instruction model in the LiteRT-LM format, published under the Apache 2.0 license.
- The model file is about 3.7 GB. It is downloaded once, from Hugging Face, when you choose **Download** during setup or in **Settings > Agent**.
- Before first use, Kwantflow checks the file's size and SHA-256 fingerprint against the exact version pinned in the app. A file that does not match is rejected.
- The model is not included in the installer, so you can skip AI completely and still use every manual estimating and quoting feature.

## The engine

- The model runs inside Kwantflow using Google's LiteRT-LM on-device runtime.
- Kwantflow uses your graphics processor (GPU) when it can and automatically falls back to the processor (CPU) if the GPU is unavailable.
- The engine only loads when you ask for an AI task. The first request after starting the app can take a little while; later requests are faster.
- On computers with 8 GB of memory, Kwantflow uses a shorter context (how much text the model can consider at once). 16 GB or more is recommended for longer documents and conversations.

## Privacy

- Your prompts, files, records, and AI answers stay on your computer. Nothing is uploaded.
- After the one-time download, Kwantflow AI works offline.
- Kwantflow does not log raw prompts or customer documents.

## What the assistant can do

Ask Kwantflow AI and AI drafting use a small set of built-in tools rather than guessing:

- search the active workspace's records (materials, rates, contacts, RFQs, estimates, and so on);
- run exact decimal calculations;
- look at the screen or record you attached to the conversation;
- read supported attached files and images;
- use the workspace playbook and knowledge files you add in **Settings > Knowledge**;
- prepare grouped create or update proposals for supported records.

## What it cannot do

- It cannot change records without your approval. Proposals are written only after you approve them.
- It does not delete business records.
- It does not change quote math. Quote totals are always calculated by Kwantflow's deterministic quote engine.
- It does not browse the internet or contact any service.
- It only sees the active workspace.

## Good practice

Treat every AI answer and draft as a starting point. Check quantities, units, rates, scope, inclusions, exclusions, and customer-facing wording before you rely on it.

# Use Kwantflow AI

Kwantflow AI helps prepare a first version of an estimate. It does not replace estimator review.

It runs on your device after a one-time download and should only start loading when you request an AI task.

## When to use Kwantflow AI

Use AI drafting when:

- the Asset has useful files or notes
- you want a structured first pass
- you are prepared to check the output

Do not use AI drafting as the only review before quoting.

## Draft an estimate

1. Open the Asset.
2. Open the estimate or AI drafting area.
3. Check that useful files are attached and readable.
4. Start the draft.
5. Wait for Kwantflow AI to prepare the draft.
6. Review every line before saving or quoting.

## What to check

Check scope, quantities, units, rates, inclusions, exclusions, and assumptions.

If a file is not used by Kwantflow AI, review it manually.

## Review rule

Treat every AI draft as a starting point.

Check quantities, inclusions, exclusions, assumptions, rates, scope interpretation, and any customer-facing wording before you issue a quote.

## Expected result

You have a draft estimate that you can edit, approve, or discard.

Next: Prepare a quote (see "Prepare a quote" in this manual).

# Ask Kwantflow AI

Ask Kwantflow AI is the assistant sidebar inside Kwantflow.

Use it when you want help understanding what is open, preparing draft content, checking next steps, or asking product questions while you work.

It runs on your device after a one-time AI download. It starts when you request an AI task, not just because the sidebar is open.

## What it can help with

- Answer questions about the current workspace.
- Search workspace records when it needs exact information.
- Calculate exact values instead of relying on rough mental arithmetic.
- Help prepare estimate or quote drafting ideas.
- Inspect the current page or record context you attached to the conversation.
- Take several steps when the task needs lookup, calculation, and a final answer.
- Accept images when you need to show a visual detail.
- Queue a message while Kwantflow AI is starting.
- Prepare grouped create or update proposals for supported records.

## How to use it

1. Open Ask Kwantflow from the toolbar.
2. Type your question or request.
3. Attach the current page context when it is useful.
4. Add images only when they help explain the request.
5. Review the answer before using it in an estimate, quote, or customer message.

## Record changes need approval

If Ask Kwantflow AI prepares record changes, it stages them as proposals for review.

Nothing is written until you approve the grouped proposal set. You approve or discard the set together.

Ask Kwantflow AI does not delete business records for you.

## Workspace scope

Ask Kwantflow AI should use the active workspace only.

Workspace playbooks, uploaded knowledge, records, and feedback stay tied to that workspace and should not appear after you switch to another one.

## Important review rule

Treat every answer as a draft. Check facts, quantities, assumptions, rates, proposals, and customer-facing language before you rely on it.

Next: Use Kwantflow AI (see "Use Kwantflow AI" in this manual).

# Review AI record proposals

Ask Kwantflow AI can prepare record changes for review when you ask it to create or update supported setup records.

These are proposals, not automatic writes.

## What this is for

Use AI record proposals when you want help preparing changes such as:

- creating several new material records
- updating an existing rate
- preparing a company and linked contacts for review
- drafting reusable setup records from a clear written request

## How grouped proposals work

Kwantflow groups the proposed changes into one review set for that request.

You then choose one of two outcomes:

- **Approve all**
- **Discard all**

This keeps related changes together and avoids silent partial updates.

## What to check before approving

Review:

- names and labels
- rates, units, and currencies
- which records are being created or updated
- optional details the AI may have included
- whether the group matches what you asked for

If anything is wrong or incomplete, discard the set and ask again more clearly.

## What AI does not do here

- it does not write records before approval
- it does not delete business records
- it should not invent unsupported fields just to fill space

## Example

If you ask:

`Create three materials for approval: 10mm plate, mesh sheet, and scaffold day rate.`

Ask Kwantflow AI can return one grouped proposal set containing the prepared records.

You review the whole set, then approve or discard it together.

## Best practice

Use AI proposals to save setup time, not to skip checking.

Treat the proposal set as a draft prepared for a human decision.

Next: Materials and rates (see "Materials and rates" in this manual).

# Prepare a quote

The quote area brings reviewed Asset estimates together into customer-facing quote output.

This is where you decide how the pricing should be presented, not where you discover whether the estimate was ready.

## Before preparing a quote

Check that:

- the RFQ details are correct
- included Assets have reviewed estimates
- business profile details are current
- customer or requester details are correct
- exclusions and assumptions are clear

## Prepare the quote

1. Open the RFQ quote area.
2. Choose which Asset estimates to include.
3. Review quote options, markups, lead time, and totals.
4. Add or update notes, terms, assumptions, and exclusions.
5. Save a quote revision when you need a record of the output at that point in time.
6. Export or share the quote when ready.

## What lives in the quote workspace

The quote workspace is where you control:

- which Asset estimates are included in the customer-facing quote
- quantity and inclusion choices for each Asset
- quote options for different commercial paths
- overall or category-specific markups
- lead time wording
- quote notes
- exported outputs such as PDF and spreadsheet exports

## Quote options and presets

Use quote options when you want different commercial versions of the same reviewed estimate set.

Typical examples:

- base offer and premium offer
- standard lead time and expedited lead time
- one option with bought-out items included and another with them excluded

If you reuse the same commercial structure often, save it as a preset so it can be reused on future RFQs.

## Revisions

Save a quote revision when you want a dated record of what was sent or approved at a point in time.

Use revisions when:

- the customer asks for a changed scope
- an addendum changes the offer
- the markup or lead time changes
- you need to compare what was sent yesterday with what will be sent now

## Export and handover

When the quote is ready, export or share it in the format that fits the conversation.

That can include:

- a customer-facing quote PDF
- a spreadsheet export for internal review or commercial checking
- a reviewed email draft built around the current quote

## Common quote scenarios

- one clear offer for a straightforward package
- several quote options for different scope or pricing paths
- a revision after customer feedback or addenda
- a polished email handover around the same quote

## Before sending

Check:

- the right asset estimates are included
- the option names are understandable
- commercial notes are clear
- assumptions and exclusions are visible
- the customer-facing message matches the actual offer
- the selected lead time and markup logic match the intended option

If you want help polishing the message, use Rewrite quote emails (see "Rewrite quote emails" in this manual).

## Resetting the quote workspace

If the quote workspace drifts too far from what you want, reset it instead of manually undoing every commercial edit.

Resetting clears quote-workspace decisions for that RFQ, such as:

- saved estimate content in the quote workspace
- default quote option state
- inclusion choices
- quantity changes
- rounding preferences

Use this carefully when you want to rebuild the quote presentation from a clean starting point.

## Expected result

You have quote output based on the estimates you chose to include.

Next: Companies (see "Companies" in this manual) if you need to improve reusable setup data.

# Quote options and revisions

Quote options let you present alternative commercial choices. Revisions preserve a record of quote output that was issued or exported.

They solve different problems.

## Use quote options for choices

Create options when the customer needs to compare different scopes or prices.

Examples:

- supply only versus supply and install;
- standard finish versus premium finish;
- full package versus separate work packages;
- base scope versus an optional add-on;
- different quantities or delivery arrangements.

Give each option a clear label that explains the choice. Avoid labels such as “Option 1” when a customer-facing description would be clearer.

## Use markups deliberately

The quote workspace can apply overall or category-specific markups. Check how those adjustments affect the final totals before export.

Document the commercial reasoning in the quote notes when a reviewer may otherwise mistake a deliberate adjustment for an error.

## Set lead time and commercial text

Review:

- lead time;
- inclusions;
- exclusions;
- payment terms;
- validity or other terms;
- customer and project references.

These statements are part of the offer. They should be as carefully reviewed as the total.

## Save and reuse presets

Use a quote preset when the same option layout or commercial presentation appears regularly.

Presets save preparation time, but they do not remove the need to review the current customer, scope, rates, dates, and terms.

## Understand revisions

A working edit changes the current quote before it is issued. A revision records a new commercial output after the quote has changed.

Examples that may justify a revision:

- a customer addendum changes quantities;
- a drawing revision changes scope;
- the customer asks for a different option;
- an exclusion becomes included;
- lead time or commercial terms change;
- pricing is updated after the original quote was issued.

Exporting quote output creates a commercial snapshot in revision history. Revision history is read-only so prior output is not silently rewritten.

## Recommended revision workflow

1. Add and review the new source information.
2. Update only the affected estimate items.
3. Recheck quote options and totals.
4. Update inclusions, exclusions, and lead time where needed.
5. Export the updated quote.
6. Use revision history to compare the recorded commercial snapshots.

## Example: customer removes installation

The first quote includes supply and installation. The customer later asks for supply only.

- Keep the original issued snapshot in revision history.
- Update the current quote or create a supply-only option.
- Remove installation only after checking related equipment, travel, and supervision costs.
- Export the revised commercial output.

## Avoid these mistakes

- Do not use revisions as a substitute for correcting an unissued draft.
- Do not overwrite the meaning of an existing option label.
- Do not assume removing one visible line removes every related cost.
- Do not send an AI-rewritten email without checking the attached quote and commercial facts.

## Related guides

- Prepare a quote (see "Prepare a quote" in this manual)
- Rewrite quote emails (see "Rewrite quote emails" in this manual)
- Work inside an RFQ (see "Work inside an RFQ" in this manual)

# Rewrite quote emails

Rewrite quote emails when you want a stronger customer-facing message around the current quote.

This helps with wording, structure, and tone. It does not remove your responsibility to check the commercial facts.

## When to use it

Use this when:

- the draft email sounds too raw or repetitive
- you want a clearer customer summary
- you need a more polished handover with the same quote facts

## Before you start

Check that:

- the correct RFQ and quote option are open
- the totals and commercial details are already right
- the current draft contains the main message you want to send

## Rewrite the draft

1. Open the quote email area.
2. Review the existing subject and body.
3. Choose **Rewrite with AI**.
4. Review the rewritten subject and body.
5. Adjust anything that still needs your voice or commercial judgment.
6. Send only after final review.

## What stays important

The AI can improve the message, but you still need to confirm:

- totals
- currency
- what is included
- what is excluded
- timing, delivery, and validity statements

## Example uses

- make a short draft sound more professional
- tighten a long draft into a clearer summary
- restate the offer after a revision without rewriting from scratch

## Important review rule

Never send a rewritten quote email without reading it first.

Next: Prepare a quote (see "Prepare a quote" in this manual).

# Connect email

Email integration is optional. Manual estimating and importing `.eml` or `.msg` files work without a connected provider. Gmail and Outlook need internet and a suitable provider account. They need no Kwantflow account or hosted Kwantflow service.

Open **Settings > Connections > Email setup guide** to read this guide from the installed application, including offline. Other bundled guides are available through **Settings > General > Help**.

## What you provide

You create a provider registration that you or your organization control, paste its public client ID into Kwantflow, and authorize a mailbox in the provider's browser. The registration identifies your copy of the application. It is separate from the mailbox account and is configured once per installation; mailbox connections belong to individual workspaces.

```text
Your Google or Microsoft registration
                |
Your browser authorizes your mailbox
                |
Kwantflow on your computer <--> Gmail API or Microsoft Graph
                |
Local workspace databases, attachments and optional local AI
```

Authorization returns to a temporary listener on your own computer. You do not need to host a website, callback service, webhook receiver, database server, or integration proxy. Mail refresh and RFQ detection run while Kwantflow is open. This is desktop synchronization, with no always-on cloud worker.

## Google Gmail registration

1. Sign in to Google Cloud Console and create or select a project you control. Open **APIs & Services > Library**, find **Gmail API**, and enable it.
2. Open **Google Auth platform > Branding**. If prompted, choose **Get Started**. Enter a recognizable app name, such as your own Kwantflow installation, and your support/contact email.
3. Under **Audience**, select **External** for personal Gmail. While its publishing status is **Testing**, add the exact Google account you will connect under **Test users**. An organization-owned Workspace project may instead use **Internal** for its own members.
4. Under **Data Access**, add `https://www.googleapis.com/auth/gmail.modify` and `https://www.googleapis.com/auth/userinfo.email`.
5. Under **Clients**, create a client of type **Desktop app**. Copy its client ID, ending in `.apps.googleusercontent.com`.
6. In Kwantflow, open **Settings > Connections**, paste the ID into **Google Desktop client ID**, and choose **Save email registrations**.

These console names and requirements are controlled by Google. [Consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent), [Gmail Desktop client setup](https://developers.google.com/workspace/gmail/api/quickstart/python).

Kwantflow uses desktop authorization with PKCE. Enter the client ID only. This flow needs no API key, service account, hosted redirect, or client secret. Google documents the Desktop client secret as optional for both token exchange and refresh. [Desktop authorization](https://developers.google.com/identity/protocols/oauth2/native-app).

### Avoid recurring Testing expiry

For Gmail scopes, an External project left in **Testing** loses both authorization and refresh access after seven days. Reconnecting is then necessary.

Google permits a verification exception for your own use or a few users you personally know. If your project qualifies, **Audience > Publish app** changes it to **In production**. An unverified warning and the lifetime limit of 100 new users still apply. Reconnect after the change. This exception does not cover sharing one unverified registration with the general public. Broader use may require verification. [Audience and expiry](https://support.google.com/cloud/answer/15549945), [Verification exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

Google Workspace administrators can restrict both internal and external registrations. Ask the administrator to review your specific client and requested Gmail scopes in **API controls > Manage App Access**. [Workspace app controls](https://knowledge.workspace.google.com/admin/apps/control-which-apps-access-google-workspace-data).

`gmail.modify` covers reading messages, sending quotes, and updating read status. It is a restricted scope; read-only access would not support all these operations. [Gmail scope definitions](https://developers.google.com/workspace/gmail/api/auth/scopes).

Standard Gmail API usage is currently available at no additional cost. Provider quotas and future pricing remain Google's responsibility; this setup does not require a paid Kwantflow service. [Gmail quotas and pricing](https://developers.google.com/workspace/gmail/api/reference/quota).

## Microsoft Outlook registration

Registration requires access to a Microsoft Entra tenant and permission to register applications. A personal Outlook.com mailbox alone does not guarantee that registration is available. If your organization's registration or consent policy blocks you, ask its administrator for a registration you are permitted to use. [Registration prerequisites](https://learn.microsoft.com/en-us/graph/auth-register-app-v2), [Registration permissions](https://learn.microsoft.com/en-us/entra/fundamentals/users-default-permissions).

1. Open Microsoft Entra admin center in the intended tenant, then **App registrations > New registration**.
2. Give the registration a recognizable name and choose supported account types from the table below.
3. Open **Authentication > Add a platform > Mobile and desktop applications**. Add the redirect **`http://localhost`**. Use the native platform for this callback. Kwantflow chooses a temporary port; Microsoft matches this localhost redirect independently of that port.
4. Under **API permissions**, add Microsoft Graph **delegated** `Mail.ReadWrite`, `Mail.Send`, and `User.Read`. Kwantflow also requests `offline_access` during authorization for refresh access. Organization policy may require administrator approval.
5. On **Overview**, copy **Application (client) ID**, not Object ID. Paste it into **Microsoft native client ID** in Kwantflow's **Settings > Connections**.
6. Enter the matching **Microsoft tenant** from the table and choose **Save email registrations**. A tenant UUID is the **Directory (tenant) ID** from Overview.

| Mailboxes you intend to connect | Supported account types | Microsoft tenant in Kwantflow |
| --- | --- | --- |
| Personal Outlook.com accounts | Personal Microsoft accounts only | `consumers` |
| One work or school organization | Accounts in this organizational directory only | That directory's tenant UUID |
| Any work or school organization | Accounts in any organizational directory | `organizations` |
| Personal and work or school accounts | Any organizational directory and personal Microsoft accounts | `common` |

`common` does not expand the audience of a single-tenant registration. No client secret is used. The native redirect identifies this public-client flow; enabling unrelated password or device-code flows is unnecessary. [Desktop configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration), [Localhost matching](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url), [Authorization protocol](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [Delegated permissions](https://learn.microsoft.com/en-us/graph/permissions-reference).

This connection reads a cloud Outlook.com or Exchange Online mailbox. Installing Outlook does not expose its local PST files or other providers configured inside it. On-premises Exchange and in-place archives are unsupported. A work mailbox may require the organization's existing Exchange Online subscription. [Supported cloud mailboxes](https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview), [Hybrid support ended](https://learn.microsoft.com/en-us/graph/hybrid-rest-support).

The current connection uses Microsoft's global cloud endpoints. GCC High, DoD, and China sovereign clouds are unsupported. Organization policies, MFA, consent changes, and provider token expiry can require reconnection; access is not permanent. [Cloud endpoints](https://learn.microsoft.com/en-us/graph/deployments), [Refresh and revocation](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens).

## Connect a mailbox

1. Open **Settings > Connections** in the intended workspace after saving your registration.
2. Choose **Connect with Gmail** or **Connect with Outlook** and review the requested permissions.
3. Complete authorization in the external browser using the intended account, then return to Kwantflow. Keep the app open while authorizing.
4. Refresh the mailbox and review messages before creating an RFQ or sending a quote.

RFQ classification, when enabled, uses the installed local model. Sending a quote or refreshing email communicates directly with your provider. Review any outgoing quote before sending it. RFQ Detector with AI (see "RFQ Detector with AI" in this manual) explains local classification.

Changing a provider client ID or Microsoft tenant requires affected connections to be reauthorized. Saved RFQs, attachments, and classification results remain local.

## Disconnect, transfer, and revoke access

Disconnect from the mailbox menu in its workspace. This deletes that connection's stored credentials on this installation, without contacting the provider or revoking its consent. Other connections using your registration remain independent.

For account-level revocation, remove the application grant separately in your Google or Microsoft account. Google's project-level revocation can invalidate that account's tokens across other clients, workspaces, and devices using the same project. [Google revocation behavior](https://developers.google.com/identity/protocols/oauth2/native-app#tokenrevoke).

Tokens are protected by macOS Keychain or current-user Windows DPAPI. They are not stored in the browser or included in portable backups. A backup includes the public registration settings; reconnect each restored mailbox, using a registration you are permitted to use. Older backups that omit these settings preserve the current installation's registrations. On another computer, configure your own registration before reconnecting. You can replace these settings with your own IDs. Your imported business data remains available.

Keep ownership of the provider project and registration after installing Kwantflow. Provider deletion, policy changes, and organization restrictions can interrupt connections even though local estimating continues. The project does not provide a shared registration or proxy.

## Use email files without registration

If provider setup is unavailable, export a message and import its `.eml` or `.msg` file into Kwantflow. Gmail's **More > Download message** saves an `.eml` file. Email-file import works offline without OAuth setup. You can export a quote PDF and send it through your usual mail application. [Download Gmail messages](https://support.google.com/mail/answer/9261412).

Kwantflow blocks remote email images. Open the original message in your provider to view them. See Email and RFQ detection issues (see "Email and RFQ detection issues" in this manual) for setup and refresh troubleshooting.

# RFQ Detector with AI

RFQ Detector with AI marks connected messages that may be requests for quote. It helps you review mail while the app is open.

## Before using it

- Connect Gmail or Outlook (see "Connect email" in this manual) in the active workspace.
- Download Kwantflow AI and allow the engine to load for an AI task.
- Enable **Mail RFQ Detection** for the workspace.
- Keep internet available for mailbox synchronization.

There is no trial expiry or paid AI allowance. Classification uses the installed model; mailbox access still depends on the provider.

## Review the results

The app reviews message information and body text, remembers successful results, and leaves failed classifications retryable. Attachment contents are handled separately for intake.

Check sender, subject, instructions, due date, and attachments yourself. Some RFQs may be missed and some ordinary messages may be flagged. No RFQ is created until you review and save it.

Kwantflow blocks remote email images. Open the original message in your email provider to view them. Email and RFQ detection issues (see "Email and RFQ detection issues" in this manual) covers connection and classifier problems.

# Companies

Companies are shared records in your workspace. They can represent clients, suppliers, subcontractors, consultants, builders, or other organisations you work with.

## When to add a company

Add a company when you want to reuse it across RFQs, rates, quotes, or contact details.

## People linked to companies

People are linked under company records. This keeps company details and person contact details together.

## Company links to catalogue records

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

## Good company records include

- company name
- role or type
- contact person
- email and phone
- address
- tax or business identifier where relevant

## Importing companies

Use Setup import (see "Setup import" in this manual) when you already have company data in a spreadsheet.

If setup import can match a supplier or company clearly, it can create the relationship for you. If the match is ambiguous, it should stop and ask for review instead of guessing.

# People and contacts

People are individual contacts in the active workspace. Link a person to a company when they represent that organisation.

## What to record

A person can include:

- first and last name;
- role or job title;
- email address;
- phone number;
- linked company.

Use the role field for a recognisable position such as Estimator, Buyer, Project Manager, Engineer, or Accounts Payable.

## Create a person from a company

Open the company and add the person from its **People** area when the relationship is already known.

This is useful when entering several contacts for one customer or supplier.

## Create or match a requester during RFQ intake

When creating an RFQ, select an existing person when the requester is already known.

If the email address or name is ambiguous, review the match instead of linking the wrong person. Two people can share a name, and one person can use different email addresses.

## Choose a useful role

Role examples:

- **Estimator** — prepares or reviews the customer's tender package.
- **Buyer** — requests pricing or places purchase orders.
- **Project Manager** — coordinates scope, dates, and delivery.
- **Engineer** — answers technical questions or issues revisions.
- **Accounts Payable** — handles invoices rather than RFQ scope.

Roles help users recognise who to contact, but they do not grant app permissions.

## Keep company and person details separate

Use the company record for organisation-level information such as business identity, address, website, and commercial notes.

Use the person record for the individual's name, role, email, and phone.

Avoid replacing the person name with a department label such as “Estimating Team” unless that is genuinely how the requester identifies the contact.

## Example: one company, several contacts

**Atlas Structural** may have:

- Mina Hart — Estimator
- Noah Kim — Project Manager
- Priya Shah — Accounts Payable

Link the RFQ requester to Mina while retaining Noah and Priya for later project or payment communication.

## When a person changes company

Update the link only after confirming the change. Keep the person's contact information current and avoid changing historical RFQ meaning without review.

## Before deleting a person

Check whether the person is referenced by active RFQs or other records. Kwantflow may prevent deletion when removing the person would break an important business relationship.

## Related guides

- Companies (see "Companies" in this manual)
- Create your first RFQ (see "Create your first RFQ" in this manual)
- Create an RFQ from email (see "Create an RFQ from email" in this manual)

# Materials and rates

Setup data saves time by letting you reuse common pricing information instead of rebuilding it for every RFQ.

Read Build reusable setup data (see "Build reusable setup data" in this manual) if you want a practical rule for what belongs in the shared catalogue and what should stay inside a single RFQ.

## Materials

Use the material catalogue for materials you commonly price or refer to.

Good material records include name, unit, rate, notes, useful aliases, and linked companies where that context helps.

Read Materials (see "Materials" in this manual) for naming, units, categories, specifications, rates, aliases, and supplier relationships.

## Labour rates

Use labour rates for people, roles, crews, or labour categories you price repeatedly.

You can link one or more companies when a rate is associated with a known supplier or labour provider.

Read Labour rates (see "Labour rates" in this manual) for work centres, categories, time units, and rate conventions.

## Equipment rates

Use equipment rates for machinery, plant, vehicles, tools, or hire items.

You can link one or more companies when a rate is tied to a known hire or supply source.

Read Equipment rates (see "Equipment rates" in this manual) for plant, machinery, operating inclusions, and hire relationships.

## Subcontract rates

Use subcontract rates for subcontracted work or supplier-priced units.

You can link one or more companies when a rate belongs to a known subcontractor or supply source.

Read Subcontract rates (see "Subcontract rates" in this manual) for service naming, units, supplier links, and job-specific quotes.

## Cost presets

Use cost presets for reusable groups of cost components.

## Estimate templates

Use estimate templates when similar jobs need the same starting structure.

Read Templates and presets (see "Templates and presets" in this manual) to compare all reusable starting points.

## A practical structure

Many teams get the best result by treating setup data in layers:

- companies and people first
- materials and rates next
- classifications after that
- presets and templates once the underlying data is stable

## Importing setup records

Use Setup import (see "Setup import" in this manual) when your data already exists in CSV or XLSX files.

If the importer can match a company clearly, it can create the link. If not, it leaves the relationship for review rather than guessing.

# Materials

Materials are reusable workspace records for items you regularly price in estimates.

## Material fields

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

## Use specific names

Choose a name that distinguishes the material from similar records.

Good examples:

- Galvanised Steel Plate 10 mm
- Reinforcing Mesh SL82
- SHS 100 × 100 × 6 mm
- Stainless Steel 316 Sheet 2 mm

Avoid a catalogue full of names such as “Steel”, “Plate”, or “Mesh” with no identifying detail.

## Choose the unit first

The unit defines how the default rate should be interpreted.

Examples:

- kg for material sold by mass;
- m for linear products;
- m² for sheet or coating area;
- ea for discrete items;
- sheet for standard sheet products.

Do not enter a per-tonne rate against a per-kilogram unit without converting it.

## Category and specification

Use **Category** for broad grouping, such as Steel, Concrete, Timber, Consumable, or Fastener.

Use **Specification** for distinguishing technical detail, such as grade, finish, thickness, treatment, or standard.

Example:

```text
Name: Galvanised Steel Plate 10 mm
Category: Steel
Specification: 10 mm, hot-dip galvanised
Unit: kg
```

## Codes and aliases

Use a code when the business already has a catalogue or purchasing reference.

Aliases improve search for alternative names, abbreviations, or supplier terminology. For example:

- gal plate
- 10 mm plate
- HDG plate

Do not use aliases to store unrelated products.

## Default rates

A default rate is a reusable starting value. It is not proof of a current supplier quote.

Before using it commercially, confirm:

- currency;
- unit;
- effective pricing date or source outside the record where relevant;
- whether freight, waste, tax, cutting, or finishing is included;
- whether the job needs a different supplier or quantity break.

## Linked companies

Link companies that supply or are otherwise associated with the material. More than one company can be linked.

The relationship improves discovery; it does not create supplier-specific price tiers or contracts.

## Example: plate with two suppliers

Create one clear material record, then link both approved suppliers. Use the estimate's job-specific rate when the current quotes differ.

## Related guides

- Companies (see "Companies" in this manual)
- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)
- Setup import (see "Setup import" in this manual)

# Labour rates

Labour rates represent the cost or charge used for a type of work in an estimate.

## Labour rate fields

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

## Name the activity clearly

Good examples:

- Workshop Fabrication Labour
- Certified Welder
- Site Installation Crew
- Mechanical Design Engineer
- Project Supervision

Avoid using one generic “Labour” rate when materially different activities have different costs.

## Work centre and category

Use **Work Centre** for the practical location, machine area, or operational centre, such as Welding, Laser, Workshop, or Site.

Use **Category** for a broader grouping, such as Fabrication, Installation, Engineering, or Site Labour.

Keep the distinction consistent across the workspace so search and review remain useful.

## Choose a time unit

Common labour units include hour and day.

Check whether a day rate represents:

- one person-day;
- one crew-day;
- a standard number of hours;
- overtime or ordinary time.

If the meaning is not obvious from the name, clarify it in the business's reusable guidance or estimate notes.

## Default rate considerations

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

## Linked companies

Link a company when the rate is associated with an external labour provider or another relevant organisation. Internal labour rates do not require a company link.

## Example: workshop and site labour

Keep separate records for workshop fabrication and site installation when the units, costs, or operating conditions differ. This makes later review clearer than applying one blended rate everywhere.

## Related guides

- Equipment rates (see "Equipment rates" in this manual)
- Subcontract rates (see "Subcontract rates" in this manual)
- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)

# Equipment rates

Equipment rates represent the cost or charge for using plant, machinery, vehicles, tooling, or other equipment in an estimate.

## Equipment rate fields

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

## Use recognisable names

Examples:

- 20 t Mobile Crane
- CNC Laser Cutter
- Welding Generator
- Scissor Lift
- Delivery Truck

Include capacity or type when it materially changes the rate.

## Category and work centre

Use **Category** for a broad family such as Plant, Machine, Vehicle, Access Equipment, or Tooling.

Use **Work Centre** for where the equipment belongs or is normally used, such as Workshop, Site Plant, Cutting, or Logistics.

## Choose a rate unit

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

## Internal equipment versus hired plant

An internal machine rate may include ownership and operating costs. A hired-equipment rate may come from a supplier quote.

Keep them as separate records when the commercial basis differs.

## Linked companies

Link relevant hire companies, suppliers, or service providers. Multiple companies can be linked to one equipment rate.

Confirm current availability and pricing before committing to a quote.

## Example: crane hire

A crane estimate may need separate rows for crane time, mobilisation, dogman or rigger labour, travel, and permits. Whether these are bundled depends on the supplier offer and how your team wants the estimate reviewed.

## Related guides

- Labour rates (see "Labour rates" in this manual)
- Subcontract rates (see "Subcontract rates" in this manual)
- Companies (see "Companies" in this manual)
- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)

# Subcontract rates

Subcontract rates represent work delivered by an external trade, specialist, or service provider.

## Subcontract rate fields

A subcontract rate can include:

- rate name;
- optional reference code;
- category or trade;
- aliases;
- unit;
- default rate;
- currency;
- linked companies.

## Name the service, not only the supplier

Good examples:

- Scaffold Installation Crew
- Hot-Dip Galvanising per kg
- NDT Weld Inspection
- Powder Coating per m²
- Structural Engineering Review

The supplier relationship belongs in linked companies. Keeping the service name independent makes the record easier to reuse with several providers.

## Category and aliases

Use a category for the trade or service family, such as Coating, Access, Testing, Engineering, Transport, or Installation.

Aliases help users find the same service under familiar wording, such as:

- scaffold crew
- access scaffold
- temporary works

## Choose the right unit

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

## Linked companies

Link every relevant approved provider. More than one provider can be linked to the same service.

The linked companies are references, not a live supplier quote comparison. Use current job evidence when suppliers offer different prices or conditions.

## Default rates and one-off quotes

Store a default rate when it is a useful repeatable starting point. Keep a one-off supplier quotation in the RFQ files and use its job-specific value in the estimate.

## Example: galvanising

A reusable galvanising rate may be priced per kilogram, while the current supplier also applies a minimum batch charge and freight. Add those separate job-specific costs when they are not included in the reusable rate.

## Related guides

- Companies (see "Companies" in this manual)
- Materials (see "Materials" in this manual)
- Equipment rates (see "Equipment rates" in this manual)
- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)

# Build reusable setup data

Reusable setup data is the shared layer you want to use again across many RFQs.

The goal is not to store everything. The goal is to store the records that genuinely save time and improve consistency.

## Good candidates for reusable setup data

Add setup records when they are likely to be used again, such as:

- common companies and people
- frequently priced materials
- standard labour, equipment, and subcontract rates
- repeatable classifications and cost codes
- reusable cost presets or estimate templates

## Keep one-off details out of the catalogue

Leave information in the RFQ or estimate instead when it is:

- unique to one customer request
- temporary or not verified yet
- too vague to reuse safely
- only relevant because of one unusual package

## A simple way to decide

Ask:

- Will we use this again?
- Would another estimator understand why this record exists?
- Is the value stable enough to trust later?
- Is this better as a reusable record or just a job note?

If the answer is unclear, keep it in the RFQ first.

## Example decisions

### Good reusable record

`Mild steel plate 10 mm, kg rate, linked suppliers`

This is a normal reusable setup record.

### Better left in the RFQ

`Urgent weekend crane allowance for Builder X tender revision`

This is job-specific and should usually stay in the estimate or quote notes instead of the shared catalogue.

### Good reusable company relationship

Linking a supplier to materials or subcontract rates you buy from repeatedly is usually worth keeping.

### Better reviewed before import

A spreadsheet that mixes old archived suppliers, duplicate names, and unclear currencies should be cleaned first instead of imported directly.

## Build in layers

The simplest reliable order is:

1. companies and people
2. materials and rates
3. classifications
4. presets and templates

This keeps dependencies easier to review.

## Use AI carefully here

Ask Kwantflow AI can prepare grouped setup-record proposals, but you still approve or discard them yourself.

Use AI to save setup time, not to lower the review standard.

Next: Materials and rates (see "Materials and rates" in this manual).

# Templates and presets

Templates and presets reduce repeated setup while keeping each job editable.

Use them for repeatable patterns, not as permanent rules that must fit every RFQ.

## Choose the right reusable item

| Reusable item | What it helps you reuse | Example |
| --- | --- | --- |
| Project structure template | A hierarchy of phases, areas, trades, or packages | Engineering → Fabrication → Coating → Installation |
| Estimate template | A broader starting structure for a familiar type of estimate | Standard fabricated stair estimate |
| Cost preset | A smaller bundle of recurring cost components | Workshop fabrication labour and consumables |
| Quote preset | A repeatable quote option or commercial presentation | Supply only / Supply and install options |

## Project structure templates

Use these when similar jobs share the same internal organisation.

After applying a template, remove irrelevant nodes and add job-specific sections. A template should make the current structure clearer, not force unnecessary sections into the estimate.

## Estimate templates

Use an estimate template when a familiar job usually starts with the same broader estimating structure.

Examples:

- fabricated platform;
- structural frame package;
- machine rebuild;
- recurring maintenance scope.

Review every inherited item before relying on it. A template cannot know which scope has changed in the current RFQ.

## Cost presets

Use a cost preset for a smaller group of costs that appears inside many estimates.

Examples:

- mobilisation and demobilisation;
- workshop setup;
- coating preparation;
- standard installation crew;
- testing and documentation.

Keep job-specific quantities and rates editable after adding the preset.

## Quote presets

Use a quote preset when option structure or commercial presentation repeats across customers or jobs.

Always check customer details, totals, lead time, inclusions, exclusions, and terms before export.

## Names, codes, aliases, and notes

Use:

- a clear name for people browsing the list;
- an optional code when your business already uses one;
- aliases for common alternative names that improve search;
- notes for concise internal guidance.

Do not put job-specific customer information in a workspace-wide template unless it is intentionally reusable.

## When to update a template

Update a reusable item when the business has learned a repeatable improvement, such as a missing standard cost or a clearer project breakdown.

Do not change a template merely to fix one unusual job. Adjust that job directly unless the change should apply to future work.

## Related guides

- Build reusable setup data (see "Build reusable setup data" in this manual)
- Cost presets (see "Cost presets" in this manual)
- Estimate templates (see "Estimate templates" in this manual)
- Organise project structure (see "Organise project structure" in this manual)
- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)
- Prepare a quote (see "Prepare a quote" in this manual)

# Cost presets

A cost preset saves the cost rows from one takeoff item so you can reuse that cost pattern elsewhere.

It is useful when the same combination of materials, labour, equipment, subcontract work, or allowances appears repeatedly.

## When to use a cost preset

Use a cost preset for a repeatable group of costs inside a larger estimate, such as:

- workshop fabrication labour and consumables;
- a standard installation crew and equipment allowance;
- coating preparation and application;
- testing, documentation, or mobilisation;
- a recurring bought-out service.

Use an estimate template (see "Estimate templates" in this manual) when you want to reuse the broader estimate, including its takeoff-item structure.

## Save a cost preset

1. Open an RFQ asset and its estimate.
2. Build and review the cost rows on the takeoff item you want to reuse.
3. Choose the action to save those rows as a cost preset.
4. Give the preset a clear name.
5. Add an optional code, description, and aliases.
6. Review the save warning and confirm.

The saved preset belongs to the current workspace.

## Name presets for recognition

Choose a name that explains the included work, not the job where it was created.

Good examples:

- Workshop fabrication pack
- Standard site installation crew
- Galvanising preparation
- Mobilisation and closeout

Use the description to record what the preset is intended to include. Add aliases when your team uses other names for the same work.

## Apply a preset

When adding or editing a takeoff item, select the preset as a reusable cost source. Review the inserted rows before relying on the result.

After applying it, you can adjust job-specific quantities, rates, units, notes, and links without changing the saved preset.

## Keep presets reliable

- Build the source takeoff item carefully before saving it.
- Remove customer-specific wording that should not appear on future jobs.
- Check whether linked workspace rates still represent current commercial values.
- Keep one clear preset for each recurring pattern instead of creating near-duplicates.
- Mark an obsolete preset inactive when it should remain in history but should not be selected for new work.

## Example

A fabrication takeoff item regularly needs cutting labour, welding labour, workshop equipment, and consumables.

Save those reviewed rows as **Workshop fabrication pack**. On the next RFQ, apply the preset and change the quantities and any job-specific rates rather than rebuilding the same rows manually.

## Related guides

- Estimate templates (see "Estimate templates" in this manual)
- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)
- Materials and rates (see "Materials and rates" in this manual)
- Templates and presets (see "Templates and presets" in this manual)

# Estimate templates

An estimate template saves a broader estimate scaffold so a similar RFQ can start from a reviewed structure.

It is most useful when your business repeatedly prices the same kind of assembly, package, or service but still needs to adjust each job.

## When to use an estimate template

Use an estimate template for repeatable estimate structures such as:

- a fabricated stair or platform;
- a structural frame package;
- a machine rebuild;
- a standard maintenance scope;
- a supply-and-install package with familiar work sections.

Use a cost preset (see "Cost presets" in this manual) when you only need to reuse the cost rows from one takeoff item.

## Save an estimate template

1. Open an asset estimate that has a useful, reviewed structure.
2. Confirm its takeoff items and cost rows are suitable for future work.
3. Choose **Save template** in the estimate setup area.
4. Enter a clear name.
5. Add an optional code, description, and aliases.
6. Review the save warning and confirm.

The template is saved in the current workspace and does not become available in other workspaces.

## Apply a template

1. Open the target asset estimate.
2. Open the Estimate Template selector.
3. Choose the relevant active template.
4. Review the resulting estimate before continuing.

Treat the template as a starting point. Remove irrelevant work, add missing job-specific scope, and verify every quantity, rate, assumption, and source against the current RFQ.

## Name templates clearly

Prefer names that describe the reusable work:

- Basic fabricated platform
- Structural frame supply only
- Pump overhaul standard scope
- Small site installation package

Use aliases for terms your team may search for. Use the description to explain when the template is appropriate and what still requires review.

## What a template cannot decide

A template does not prove that the current RFQ contains the same:

- dimensions or quantities;
- materials and specifications;
- access or installation conditions;
- exclusions and commercial terms;
- supplier rates or lead times.

Current RFQ evidence remains the source of truth.

## Maintain templates

- Update a template when a change is genuinely reusable across future work.
- Fix one unusual RFQ in that estimate instead of changing the shared template.
- Avoid duplicate templates with slightly different names.
- Mark old templates inactive when they should no longer be selected for new work.
- Review templates periodically after rates, methods, or standard scope change.

## Related guides

- Cost presets (see "Cost presets" in this manual)
- Create and review an estimate (see "Create and review an estimate" in this manual)
- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)
- Templates and presets (see "Templates and presets" in this manual)

# Workspace AI knowledge

Workspace AI knowledge helps Kwantflow AI behave more like your team expects inside one workspace.

It does not become a shared global memory across every workspace on the device.

## What you can add

Workspace AI knowledge can include:

- playbook text
- uploaded knowledge files
- feedback that reinforces preferred corrections

## What it affects

This guidance can influence AI-supported drafting, Ask Kwantflow AI, and other workspace AI tasks where the current workspace context matters.

## Scope

Knowledge stays inside the workspace where you added it.

If you switch workspaces, the AI should use the active workspace knowledge instead.

## Priority

Use workspace knowledge for instructions, terminology, commercial rules, and reusable estimating guidance that should apply repeatedly.

Use direct prompt instructions when the task is specific to the current job.

## Review and removal

Remove or replace outdated playbook text, files, or feedback when your process changes.

Keep this information current so AI suggestions stay useful instead of repeating old rules.

## Important rule

Workspace AI knowledge improves guidance, not authority.

You still need to review AI-generated estimates, drafts, detections, and record proposals before using them.

Next: Setup import (see "Setup import" in this manual).

# Setup import

Setup import helps seed shared workspace data from spreadsheets.

It is for setup records, not for importing full RFQs or completed estimates.

## What you can import

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

## Import a file

1. Open the setup page you want to seed, or choose setup import from an empty state.
2. Choose a CSV or XLSX file.
3. Review the sheets Kwantflow finds.
4. Confirm what each sheet should import into.
5. Match spreadsheet columns to Kwantflow fields.
6. Review row issues.
7. Import ready rows.

## What to expect

Kwantflow suggests matches where it can. If something is unclear, it asks you to review instead of silently guessing.

That includes supplier or company relationships. A catalogue row can name more than one company by separating names with semicolons. Kwantflow adds every clear match without removing existing links. Missing or ambiguous matches must be reviewed before that sheet can be imported.

When you choose **Update matched**, Kwantflow changes only the spreadsheet fields you mapped. Other saved details and company links stay unchanged. Currency can be imported for materials and rates; when it is omitted, the workspace currency is used.

For a spreadsheet row that contains both a company and a named contact, company details stay on the company and the contact's email, phone, and job title are saved on the linked person.

## Common issues

Go to Import issues (see "Import issues" in this manual) if rows are blocked or fields do not map correctly.

# Classifications

Classifications help organise estimate information in a consistent way.

Use them when your company, client, reporting process, or estimating method needs cost codes or structured categories.

If your team prices similar work repeatedly, classifications make reviews faster because everyone can follow the same structure.

## Classification systems

A classification system is the overall coding structure.

Examples include:

- company cost code system
- trade package structure
- project reporting structure
- custom estimating breakdown

## Cost codes

Cost codes are the individual codes inside a classification system.

Use clear names and codes so estimators can choose the right one while reviewing an estimate.

## Using classifications in estimates

Apply classifications to estimate items when you want better review, filtering, reporting, or quote structure.

## Common use cases

- separate trade or discipline areas clearly
- keep internal reporting consistent across estimators
- map estimate lines to customer-required code structures
- make quote reviews easier when several people work on the same RFQ

## When to keep it simple

Do not force a complicated classification model into every workspace.

If your team does not need reporting or structured coding yet, start with a small, clear system and expand later.

## Importing classifications

Use Setup import (see "Setup import" in this manual) if you already have classification systems or cost codes in a spreadsheet.

# Common estimating scenarios

These examples are illustrative workflows, not customer case studies or guarantees. Adapt them to your business, scope, and review requirements.

## A simple one-drawing enquiry

**Situation:** A customer sends one drawing for six identical brackets.

**Suggested workflow:**

1. Create one RFQ and attach the drawing.
2. Create one asset for the bracket package.
3. Add one takeoff item with quantity six.
4. Link the relevant material and labour rates.
5. Add any one-off finishing or delivery allowance.
6. Review the total and prepare one quote option.

**Why:** The scope is simple. Extra project structure would add work without making the estimate clearer.

## One RFQ with several work packages

**Situation:** A tender contains structural steel, stairs, handrails, and cladding.

**Suggested workflow:**

1. Keep one RFQ for the customer enquiry.
2. Group files into assets for each package.
3. Estimate each asset independently.
4. Use project structure inside a package only when it needs a deeper breakdown.
5. Include or exclude assets when preparing quote options.

**Why:** Assets separate practical estimating packages while preserving one enquiry and one commercial workspace.

## A supplier rate needs checking

**Situation:** Several suppliers can provide the same material.

**Suggested workflow:**

1. Link the material to the relevant companies in setup data.
2. Keep the reusable material record clear about its standard unit and default rate.
3. Confirm the current supplier quote before relying on the rate.
4. Update the job-specific estimate when the current price differs.

**Why:** Company relationships help discovery, but they do not automatically create supplier-specific price agreements.

## An email becomes an RFQ

**Situation:** A connected mailbox receives an enquiry with drawings attached.

**Suggested workflow:**

1. Review the email and its RFQ detection status.
2. Choose **Create RFQ**.
3. Review the prepared details and any company or person match.
4. Confirm all attachments arrived in the intake form.
5. Correct ambiguous or missing details.
6. Save the RFQ only when the preview is accurate.

**Why:** Email preparation reduces retyping while keeping the user in control of the new record.

## An addendum arrives after estimating starts

**Situation:** A customer sends a revised drawing and changes one package.

**Suggested workflow:**

1. Add the revised file to the existing RFQ.
2. Identify the affected asset.
3. Compare the new evidence with the earlier scope.
4. Update affected takeoffs, costs, exclusions, and lead time.
5. Recheck quote totals.
6. Export the revised quote to record a new commercial snapshot.

**Why:** The new file belongs with the original enquiry, but only the affected estimate scope should change.

## A repeated fabrication job

**Situation:** The business regularly quotes similar fabricated platforms.

**Suggested workflow:**

1. Create a project structure template for the repeatable phases.
2. Create an estimate template for the familiar estimating structure.
3. Create cost presets for recurring bundles such as fabrication setup or installation.
4. Apply the reusable starting points to the new RFQ.
5. Remove irrelevant items and add current-job scope.

**Why:** Reuse improves consistency, but current RFQ evidence remains authoritative.

## Ask Kwantflow AI to combine records and arithmetic

**Situation:** You need the cost of 250 kg of a material already stored in the workspace.

**Example request:**

> Find the galvanised steel plate in this workspace and calculate the cost of 250 kg using its recorded rate.

Kwantflow AI can search the workspace record, retrieve its details, use an exact calculation, and explain the result. Check the selected record, unit, rate, and currency before using the answer commercially.

## Prepare several records for approval

**Situation:** You want to add several known materials from a supplier list.

**Example request:**

> Prepare these materials for approval: 10 mm galvanised plate at 4.85 AUD per kg, SL82 reinforcing mesh at 72.50 AUD per sheet, and scaffold installation crew at 1,280 AUD per day.

Review the grouped proposal carefully. Nothing is written until you approve it, and grouped changes are approved or discarded together.

## Work across two businesses

**Situation:** One user estimates for two independent businesses.

**Suggested workflow:**

1. Create one workspace for each business.
2. Configure each workspace's profile, catalogues, knowledge, and email connections separately.
3. Check the active workspace before creating or importing records.
4. Switch workspaces when moving to the other business.

**Why:** Workspace separation prevents customer, pricing, mailbox, and estimating context from being mixed.

## Related guides

- Email RFQ to quote (see "Email RFQ to quote" in this manual)
- Multi-package tender (see "Multi-package tender" in this manual)
- Repeat work with templates (see "Repeat work with templates" in this manual)
- Supplier and rate review (see "Supplier and rate review" in this manual)
- Workspaces (see "Workspaces" in this manual)
- Work inside an RFQ (see "Work inside an RFQ" in this manual)
- Templates and presets (see "Templates and presets" in this manual)
- Ask Kwantflow AI (see "Ask Kwantflow AI" in this manual)

# Email RFQ to quote

This worked example is illustrative. Names, quantities, rates, and decisions are examples rather than customer results or guarantees.

## Situation

A builder emails a request for a fabricated steel access platform. The message includes a drawing, a short scope note, and a required return date.

The estimator wants to avoid retyping the enquiry while keeping control of every business record and commercial decision.

## 1. Review the email

Mail RFQ Detection marks the message as a possible RFQ.

The estimator opens it and checks the sender, subject, body, requested date, listed attachments, and whether the enquiry belongs to the active workspace.

The detection result is a review aid. The estimator still decides whether to create an RFQ.

## 2. Prepare the RFQ intake

The estimator chooses **Create RFQ**. Kwantflow prepares a reviewable intake using the email details.

The estimator checks the RFQ name and number, company and requester, priority and dates, notes, and attachments. A possible existing person match is confirmed rather than assumed.

No RFQ exists until the reviewed intake is saved.

## 3. Organise the evidence

Inside the new RFQ, the estimator reviews the drawing and scope note, then creates one asset for the platform package.

Because this is one coherent assembly, a complex project hierarchy would add little value. The estimator keeps the structure simple.

## 4. Build the estimate

The estimator creates takeoff items for the main platform components and links reviewed workspace records where appropriate:

- steel material by its normal pricing unit;
- workshop labour;
- equipment or consumable allowances;
- subcontract finishing if required;
- site installation where included.

Any quantity taken from the drawing is checked against dimensions and notes. Any allowance not supported by evidence is recorded clearly as an assumption.

## 5. Review current rates

The workspace contains a default steel rate and linked suppliers. The estimator checks the latest supplier information before relying on the default.

If the current supplier quote differs, the job estimate is updated. The shared catalogue is changed only when the new value should become the reusable default.

## 6. Prepare the quote

The estimator includes the platform asset, reviews the markup, and checks customer identity, scope, price, tax, lead time, inclusions, exclusions, validity, and revision label.

The first export becomes the reviewed commercial snapshot for that response.

## 7. Rewrite the email draft

The estimator asks Kwantflow AI to improve the current email draft.

Before sending, the estimator confirms that the rewritten subject and body agree with the quote, especially the total, currency, RFQ number, option, and lead time.

## What this example demonstrates

- Email can reduce intake retyping without creating records automatically.
- Attachments stay visible for review rather than being hidden inside an AI step.
- Existing company and person matches require confirmation.
- Reusable rates are starting points, not proof of a current supplier price.
- Quote and email output remain user-reviewed.

## Related guides

- Connect email (see "Connect email" in this manual)
- Create an RFQ from email (see "Create an RFQ from email" in this manual)
- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)
- Rewrite quote emails (see "Rewrite quote emails" in this manual)

# Multi-package tender

This worked example is illustrative. Adapt the structure to the actual tender, responsibilities, and review process.

## Situation

A tender contains structural frames, stairs, handrails, and cladding. Several drawings apply across packages, while specialist files apply to only one package.

The estimator needs separate working estimates but one commercial response.

## 1. Keep one RFQ

The customer issued one enquiry with one due date, so the estimator keeps it as one RFQ.

The shared RFQ area holds the customer and requester, common correspondence, due date, priority, full file set, and project-wide notes.

## 2. Create practical assets

The estimator groups the work into four assets:

1. Structural frames
2. Stairs
3. Handrails
4. Cladding

An asset represents a practical package that can be reviewed and estimated independently. A drawing may still need to be considered across more than one package.

## 3. Add deeper structure only where useful

The frame package needs separate engineering, fabrication, coating, and erection sections. The estimator applies a project structure template and removes irrelevant nodes.

The handrail package is simple enough to estimate without a deeper hierarchy.

## 4. Estimate each package

Each asset receives its own takeoff items and cost rows. The estimator links reusable records, checks quantities, records package assumptions, avoids counting shared mobilisation twice, and keeps exclusions visible.

## 5. Handle shared costs deliberately

Site mobilisation applies across several assets. The estimator chooses one clear treatment according to the business process.

The important point is that the cost is included once and remains understandable during review.

## 6. Prepare quote options

The estimator creates options such as:

- Base: frames, stairs, and handrails
- Alternative: base scope plus cladding
- Supply only: selected fabricated packages without installation

Each option is reviewed against the intended asset selection and commercial conditions.

## 7. Respond to an addendum

A revised stair drawing arrives before submission.

The estimator adds the file to the existing RFQ, updates the Stairs asset, reviews shared consequences, recalculates quote options, and exports a new revision.

The unaffected package estimates remain intact unless the addendum changes them.

## What this example demonstrates

- One customer enquiry does not require one oversized estimate.
- Assets separate working packages while preserving common RFQ context.
- Project structure is optional and should clarify rather than inflate the job.
- Shared costs need an explicit treatment to prevent duplication.
- Quote options can recombine reviewed packages for different commercial offers.

## Related guides

- Work inside an RFQ (see "Work inside an RFQ" in this manual)
- Group files into assets (see "Group files into assets" in this manual)
- Organise project structure (see "Organise project structure" in this manual)
- Quote options and revisions (see "Quote options and revisions" in this manual)

# Repeat work with templates

This worked example is illustrative. Templates improve consistency, but they do not prove the current scope.

## Situation

A fabrication business regularly quotes access platforms with similar engineering, workshop, coating, and installation activities.

The assemblies are related, but dimensions, materials, access conditions, and customer requirements vary.

## 1. Build the first estimate carefully

The estimator completes a reviewed platform estimate with clear takeoff items, linked sources, separate workshop and site activities, documented assumptions, and a sensible project structure.

This estimate becomes a candidate for reuse only after it is understandable without relying on memory of the original job.

## 2. Save reusable layers

The estimator saves:

- an estimate template for the broader platform estimate;
- a cost preset for recurring workshop fabrication rows;
- a project structure template for the standard phases.

These layers solve different problems. They should not become three duplicate ways to store the same vague idea.

## 3. Start the next RFQ

A new platform RFQ arrives with different dimensions and no site installation.

The estimator applies the estimate template, then:

- replaces quantities using the new drawing;
- confirms the material specification;
- removes installation scope;
- reviews current rates;
- changes coating requirements;
- updates inclusions and exclusions.

## 4. Use aliases and descriptions

The workspace uses both “platform” and “access deck.” The estimator adds a useful alias so the template is easier to find.

The description states when the template is appropriate and warns that installation may need to be removed.

## 5. Decide whether to update the template

The new RFQ has an unusual weekend access allowance. The estimator keeps that allowance in the job instead of adding it to the shared template.

Later, the business adopts a new standard inspection step for every platform. That repeatable improvement belongs in the template.

## What this example demonstrates

- Reuse should begin from a reviewed estimate.
- Estimate templates, cost presets, and project structure templates have different scopes.
- Applying a template is the beginning of review, not the end.
- One-off conditions belong in the job.
- Repeatable process improvements belong in shared setup data.

## Related guides

- Estimate templates (see "Estimate templates" in this manual)
- Cost presets (see "Cost presets" in this manual)
- Templates and presets (see "Templates and presets" in this manual)
- Build reusable setup data (see "Build reusable setup data" in this manual)

# Supplier and rate review

This worked example is illustrative. Linked companies and default rates organise knowledge; they do not replace a current supplier quotation.

## Situation

An estimator needs 250 kg of galvanised steel plate. The workspace contains one material record linked to three possible suppliers.

The material has a default rate, but the current job has an urgent delivery requirement.

## 1. Find the reusable material

The estimator searches the Materials catalogue using the normal name or an alias such as “gal plate.”

The record provides a consistent material identity, unit, category and specification context, default rate and currency, and list of linked companies.

## 2. Check linked companies

The company relationships identify businesses that commonly supply the material. They do not establish a preferred supplier, an exclusive agreement, or a price for this RFQ.

The estimator reviews the available companies and obtains current commercial information as required.

## 3. Compare like with like

Before comparing supplier values, the estimator confirms:

- the same material specification;
- the same pricing unit;
- the same currency;
- whether freight, cutting, minimum order, or tax is included;
- the required delivery date;
- the validity of each quotation.

A lower number is not automatically the better job cost if the basis differs.

## 4. Calculate the material cost

If the selected reviewed rate is 4.85 AUD per kg, the direct arithmetic for 250 kg is:

`250 × 4.85 = 1,212.50 AUD`

The estimator may ask Kwantflow AI to find the material and calculate the result. The record, unit, rate, currency, and any additional supplier charges are still checked before use.

## 5. Decide what to update

If 4.85 AUD per kg represents the new normal reusable rate, the estimator updates the material record.

If it is an urgent one-off quote including special freight, the estimator keeps that value in the job estimate instead of replacing the workspace default.

## 6. Maintain relationships separately

Adding or removing a company relationship does not delete the company or material.

The relationship answers “who is relevant to this record?” It does not copy rates between records or create supplier-specific pricing automatically.

## What this example demonstrates

- Aliases improve record discovery.
- Multiple companies can be related to one catalogue record.
- Relationships and prices remain separate concepts.
- Units, currencies, and rate basis must match before arithmetic is commercially meaningful.
- Reusable defaults should not be overwritten by unusual job conditions.

## Related guides

- Materials (see "Materials" in this manual)
- Companies (see "Companies" in this manual)
- Build reusable setup data (see "Build reusable setup data" in this manual)
- Ask Kwantflow AI (see "Ask Kwantflow AI" in this manual)

# Install and update issues

Start with the installation guide (see "Install Kwantflow" in this manual) and published release notes.

## Check the download

Use the project's versioned GitHub installer links, including those in its README. Confirm the download completed and matches the intended platform. Obtain a fresh installer when the file is incomplete or its published checksum does not match.

Do not run a source archive as an installer. The Mac DMG is universal; the Windows installer is x64.

## Windows blocks the installer

The Windows installer is unsigned. SmartScreen, Smart App Control, S mode, and organization rules can restrict unsigned software. A published checksum does not grant trusted-publisher status. Do not disable protection to bypass a block; ask your device administrator where applicable.

A missing bundled system prerequisite can request administrator approval or restart. Declining required installation can leave the application unable to launch. The installer should explain which prerequisite failed.

## macOS reports a security or damaged-app error

Community builds may be unsigned or ad hoc signed. Open the app once from System Settings > Privacy & Security if macOS asks you to confirm it. Do not disable Gatekeeper. Verify the download and its checksum from the project's GitHub Releases page before retrying.

## Workspace or database repair error after upgrading

Quit and reopen once, record the exact error, and preserve your data. Do not delete workspace files or open upgraded databases with an older binary. Use a compatible backup only after reviewing the installation-wide restore scope.

Check each workspace rather than assuming records are missing from the installation. Workspace and backup issues (see "Workspace and backup issues" in this manual) covers recovery.

## A feature is unavailable

Check the active workspace, optional AI model status, and provider configuration if the feature uses email. There is no account linking, subscription refresh, or device-slot check in Kwantflow.

## Reporting a reproducible problem

Kwantflow is community maintained and has no guaranteed support. When you open a GitHub issue, include app version, operating system, steps, and exact error. Inspect a locally exported diagnostic archive before sharing it. The app does not upload reports automatically.

# File and AI issues

Some files can be uploaded, previewed, and used by AI. Others may only be useful for manual review.

The important distinction is not just file type. It is whether the file is readable enough to trust.

## If a file does not preview

Check whether the file type is supported in Supported files (see "Supported files" in this manual).

If the file is supported but still does not preview:

- confirm the file opens outside Kwantflow
- try adding the file again
- check whether it is password-protected or damaged
- check whether the issue is with the file itself rather than the workspace

## If a ZIP package does not help

ZIP files are only containers.

If the files inside the ZIP are weak, damaged, or unsupported, the ZIP itself will not solve that.

## If AI does not use a file

AI may skip a file when it cannot extract useful evidence from it.

Common reasons include:

- the file type is not useful for AI drafting
- the file is blank, damaged, unreadable, or very low quality
- the drawing or image is too faint
- the file needs manual review
- the useful detail is in an attachment, addendum, or later revision rather than the file you expected
- the file uploads successfully but is still weak evidence for automatic drafting

## Common real-world examples

- A blurry phone photo uploads but is too poor for reliable quantity logic.
- A CAD file previews, but the pricing still depends on notes from the RFQ email body.
- A spreadsheet uploads, but the important commercial assumption is only written in a separate PDF.
- A scanned addendum is readable to a person but too faint to treat as strong AI evidence.

## What to do when AI output feels incomplete

Check whether:

- the key file was attached to the right RFQ or Asset
- the most useful file was actually opened and reviewed
- the missing fact only exists in a supporting attachment
- the estimate should be adjusted manually instead of forcing another AI pass

## What to do next

Review skipped files manually and update the estimate yourself where needed.

If the file is critical, keep the file in the RFQ anyway so the full package stays together for human review.

# Import issues

Setup import asks for review when spreadsheet data is unclear.

That is intentional. Import should stop on weak data instead of silently creating bad reusable records.

## Columns do not map correctly

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

## Rows are blocked

Rows may be blocked when required information is missing, duplicate, ambiguous, or invalid.

Fix the row in the review step or update the spreadsheet and import again.

Common examples:

- a material row has no name
- a rate row has a unit but no rate
- the same record appears twice with conflicting details
- a company link points to a name that could match more than one record

## Company or supplier links are unclear

If a rate refers to a supplier or company, make sure the company name matches an existing or imported company record clearly.

If the match is not clear, import the row first and link it later during review.

## Cost codes do not import

Cost codes need a classification system. Import or select the classification system first, then review the cost-code sheet.

## When to clean the spreadsheet first

Clean the source file before importing when:

- headings are inconsistent across sheets
- one column mixes units and notes
- supplier names vary from row to row for the same company
- rates use mixed currencies without clear labels
- old archived records are mixed with live records

## Best practice

Import clear, reusable setup data first.

Leave one-off job details in the RFQ or estimate instead of forcing them into your long-term catalogue.

# Records and relationships issues

Workspace records are reusable. A correction can affect future RFQs and estimates, so check the active workspace and the exact record before changing it.

## A record is missing from a selector

Check that:

- you are in the workspace where the record was created;
- the record is active;
- you opened the correct selector, such as Materials rather than Subcontract rates;
- the name, code, or alias matches your search;
- the page has finished loading its current workspace records.

Archived or inactive records may remain visible where they are already linked, but may not be offered for new selections.

## A company relationship is missing

Open either the company or the catalogue record and review its relationship selection.

Confirm that the selected contact is a company rather than a person. Company relationships are supported for materials, labour rates, equipment rates, and subcontract rates.

Save the relationship from one side, then reopen the other record to confirm it appears there too.

## Removing a relationship did not delete the records

This is expected. A relationship only records that the company is relevant to the material or rate.

Removing it leaves both records available. Delete or archive a record separately only when that is the intended business action.

## I cannot delete a company

The company may still be required by another record, such as a linked person or RFQ.

Review the warning, find the dependent records, and decide whether they should be reassigned, archived, or removed first. Do not remove useful history merely to clear a warning.

Catalogue relationships do not delete catalogue records when a company is removed, but other protected business relationships may prevent deletion.

## I created a duplicate

Compare the records before deleting either one:

- names, codes, and aliases;
- units and currencies;
- rates and rate basis;
- linked companies;
- use in existing estimates or RFQs;
- active or archived status.

Keep the clearer reusable record. Update references deliberately where the app permits, then archive or delete the duplicate only when it is safe.

## A linked company has the wrong price

Company relationships and prices are separate.

Linking a supplier does not copy a supplier quote into the material or rate record. Update the reusable default only when the new value should apply broadly. Keep unusual freight, minimum order, urgency, or customer-specific pricing in the job estimate.

## A unit or currency is wrong

Correct the reusable record when its normal unit or currency was entered incorrectly.

Before changing it, review existing estimates that may rely on the earlier interpretation. A value of `4.85 per kg` is not interchangeable with `4.85 per tonne`, sheet, metre, or each.

## A setup record is no longer used

Mark it inactive when you want to preserve history but prevent normal future selection.

Delete it only when you are confident it is not needed for understanding existing work and the app permits deletion.

## AI proposed the wrong fields

Discard the proposal. State the exact record family, name, action, and values again.

Example:

> Prepare an update for the material “Galvanised Steel Plate 10mm”. Change only the default rate to 5.55 AUD per kg and preserve the other fields.

Nothing is written when you discard a grouped proposal.

## Related guides

- Companies (see "Companies" in this manual)
- Materials and rates (see "Materials and rates" in this manual)
- Build reusable setup data (see "Build reusable setup data" in this manual)
- AI answer and proposal issues (see "AI answer and proposal issues" in this manual)

# Workspace and backup issues

## I cannot create another workspace

Kwantflow has no workspace cap. Check the displayed error, available disk space, and permissions. Do not delete another workspace merely to release a paid slot.

## Records appear missing after switching

Check the workspace name, clear table filters, and inspect archived views where available. Switching does not merge records or business environments.

## A workspace cannot be deleted

Confirm the intended workspace, protect its data, and complete the required name confirmation. The app protects the only remaining workspace and data that are currently in use.

## A backup is not listed

Local restore points belong to the installation on the computer where they were created. A portable ZIP on disk must be imported through **Import backup** before it appears as a restore candidate.

## The archive is invalid or incompatible

Stop and keep the original file. Import validates archive contents, required files, databases, and supported versions before replacing live data. A failed check should leave current workspaces intact. Do not edit the archive to bypass validation.

## What will be replaced?

Restore replaces **all registered workspaces and local settings on this installation** with the selected backup. It does not merge old and new data. Check the backup date and workspace count, and export current data if it may be needed later.

## Restore is slow or was interrupted

Allow an active restore to finish. Do not remove staging or recovery data. On restart, unfinished replacement recovery runs before workspaces open. If recovery cannot finish, startup stops instead of continuing against partial databases. Keep the error and recovery files for diagnosis.

If the current databases are damaged, recovery may retain their raw originals and SQLite sidecar files in quarantine instead of creating a normal safety backup. Preserve every retained file and the recovery record. Do not edit, combine, or delete them to bypass the repair message.

## Email or AI needs setup after moving computers

Portable backups exclude OAuth credentials and the downloaded model. Configure your own provider registration and reconnect each mailbox. Download the optional AI model on the destination installation.

Transfers between macOS and Windows are not yet fully tested. Backup instructions (see "Back up and restore workspaces" in this manual) explain the supported user flow.

# Email and RFQ detection issues

## Provider setup or consent is rejected

Open **Settings > Connections > Email setup guide** or read Connect email (see "Connect email" in this manual). Enter the correct Desktop/public-client ID and Microsoft tenant, then choose **Save email registrations** before connecting. Do not enter a client secret.

For Gmail:

- Check that Gmail API is enabled in the same project as the Desktop client ID.
- For External Testing, add the exact connecting account as a test user. Gmail grants and refresh tokens expire after seven days. Eligible own-use projects can follow the guide's In production route, then reconnect.
- An `org_internal` error means the connecting account is outside the project's organization. Use an eligible account or the appropriate External audience.
- For blocked scopes or administrator restrictions, ask your Workspace administrator to review that specific client. Creating another registration does not override organization policy.

For Outlook:

- Copy Application (client) ID rather than Object ID.
- Match the registration's supported account types and Kwantflow's tenant. A single organization needs its tenant UUID; `common` is for a registration supporting both organizational and personal accounts.
- For a redirect mismatch, configure `http://localhost` under Mobile and desktop applications. Do not use Web/SPA or a fixed guessed port.
- Check delegated Graph mail permissions and administrator consent requirements. A request for administrator approval must be resolved by the organization.
- Confirm that the account has a supported cloud mailbox. A local Outlook installation, PST file, or on-premises Exchange account does not provide Graph mailbox access.

Provider screens can give more specific error codes. Review the setup guide and provider registration before retrying. Keep tokens, authorization codes, and callback URLs out of shared screenshots or support messages. Provider restrictions and approval cannot be removed by Kwantflow.

Connections whose client registration changed require reconnection. Saved RFQs and attachments remain available locally.

## The browser says connected but the app is still waiting

Keep Kwantflow open and return to it after the browser confirms the connection.

If the app does not finish:

1. Cancel the waiting connection.
2. Confirm you are in the intended workspace.
3. Start the connection again from Settings.
4. Complete the newest browser window only.

Do not reuse an old browser consent page after starting a new attempt.

## The browser does not open

- Check that the app is allowed to open your default browser.
- Cancel any connection attempt that is already waiting.
- Start a fresh attempt.
- Confirm the computer has internet access.

## The wrong mailbox was connected

Disconnect it from the active workspace, then connect again and choose the intended account in the provider's browser page.

Changing workspaces does not move the mailbox connection.

## Messages do not appear

Check:

- the intended workspace is active;
- the mailbox connection still shows as connected;
- auto-refresh is enabled if you expect periodic checks;
- the message exists in the connected account;
- the app is open when you expect synchronization or detection to run.

Use a manual refresh when available.

If authorization has expired or been revoked, reconnect the mailbox in Settings. Do not retry an outgoing quote automatically after an uncertain send result; check the provider's Sent folder first. Changing client IDs or Microsoft tenant also requires reconnection. Gmail Testing expiry, Microsoft sign-in policy, and organization changes can all interrupt previously working access.

If access cannot be restored, export the message from your provider and import its EML or MSG file. Local RFQs, imported attachments, and estimating remain available.

## RFQ detection does not run

Confirm **Mail RFQ Detection** is enabled for the active workspace and the optional model is downloaded. An AI task must be able to load the local engine. Mailbox access still requires internet.

Detection does not need to run again for messages that already have a successful result under the current detection version. Failed attempts remain eligible for retry.

## A message was classified incorrectly

RFQ detection is an aid, not a replacement for reviewing the email. Open the message and decide whether to prepare an RFQ yourself.

Do not delete a real enquiry simply because the detector did not label it.

## Open a link from a message

Expand **Links in this email** beneath the message. Each action shows its actual destination so you can review it before opening it. Links inside the message body are displayed as text.

Only web, email, and telephone links are available. Relative links and links to local files or app commands are excluded.

## Remote images are blank

Kwantflow blocks remote email images for privacy. To view remote images, open the original message in your email provider.

Embedded raster images may still appear without contacting the sender's server.

## An email opens with the wrong content

Close the preview and open the message again from the current mailbox list. If the issue continues, refresh the mailbox before opening another message.

## RFQ intake is missing information

AI preparation uses message details and body text, then attachments are added separately.

Before saving:

- verify the customer and requester;
- check RFQ number and references;
- check received and due dates;
- review priority and notes;
- confirm attachments are present;
- leave ambiguous company or person matches unlinked until you can confirm them.

## Related guides

- Connect email (see "Connect email" in this manual)
- RFQ Detector with AI (see "RFQ Detector with AI" in this manual)
- Create an RFQ from email (see "Create an RFQ from email" in this manual)
- Data and privacy (see "Data and privacy" in this manual)

# Estimate and quote issues

## A total looks wrong

Check the calculation from the smallest level upward:

1. Takeoff quantity.
2. Takeoff unit.
3. Cost component quantity.
4. Cost component unit and rate basis.
5. Rate and currency.
6. Markup.
7. Included assets and quote options.

Do not start by changing the final quote total. Find the source row that produced it.

## A linked rate is missing

- Confirm the record exists in the active workspace.
- Search by name, code, or alias.
- Check that the record is active.
- Confirm you are looking in the correct category: material, labour, equipment, or subcontract.

Add a manual cost row when the value is genuinely job-specific.

## Units do not match

Convert the quantity deliberately before multiplying it by a rate with a different basis.

Examples:

- kilograms and tonnes;
- millimetres and metres;
- hours and days;
- each and packs.

Record the assumption in the estimate description or notes when a reviewer needs to understand it.

## The quote total differs from the estimate

Check:

- which asset estimates are included;
- which quote option is active;
- overall and category-specific markups;
- exclusions or optional packages;
- whether an estimate changed after the quote workspace was last reviewed.

The quote is a commercial assembly of estimate information, not simply a screenshot of one estimate.

## A quote option has the wrong scope

Review the assets, labels, and commercial content included in that option. Rename the option so its meaning is clear to the customer.

## Revision history does not change while editing

Revision history records commercial snapshots when quote output is exported. Ordinary working edits do not rewrite an earlier snapshot.

## Reset removed quote decisions

Resetting the quote workspace intentionally clears quote-workspace decisions for that RFQ. Rebuild the quote from the reviewed estimate data or restore a suitable workspace backup if a broader rollback is required.

## AI draft quantities look uncertain

Open the source evidence and verify the item manually. Correct or remove uncertain rows rather than repeatedly generating drafts without changing the evidence.

## Related guides

- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)
- Create and review an estimate (see "Create and review an estimate" in this manual)
- Prepare a quote (see "Prepare a quote" in this manual)
- Quote options and revisions (see "Quote options and revisions" in this manual)

# AI answer and proposal issues

Kwantflow AI can use workspace records and tools, but it can still misunderstand an instruction. Treat its response as work to review.

## The answer used the wrong record

Give a more specific identifier, such as:

- exact or partial record name;
- company;
- code or alias;
- unit;
- project or RFQ context.

Example:

> Use “Galvanised Steel Plate 10mm” in materials, not the similarly named contact.

If the record remains ambiguous, open the normal record page and verify it directly.

## The calculated answer looks wrong

Ask the AI to state the selected record, quantity, unit, rate, and currency. Check each value before relying on the total.

Example:

> Show the material name, recorded rate, unit, quantity, and calculation used for this answer.

## The AI asks for information I already provided

Restate the minimum missing detail clearly. Long corrective messages can introduce more ambiguity.

For an update, provide the exact record name and changed field. For a create request, provide each required value in a consistent list.

## A multi-record proposal is incomplete

Do not approve an incomplete grouped set.

Discard it and ask for the complete corrected set, naming every expected record again.

Example:

> Discard that proposal. Prepare one grouped proposal containing all five materials below, with the exact names, rates, units, currencies, and rate bases.

## One proposal item is wrong

Grouped proposals are approved or discarded together. Discard the set and request a corrected version rather than approving known bad data.

## An update cannot find the record ID

Ask the AI to search for the record first and confirm the match before proposing the update.

Example:

> Find “KF Multi Plate A” in materials, confirm its current rate, then prepare an update to 5.55 AUD per kg.

## The AI repeats the same step

Stop the request if it continues repeating. Nothing hidden should be approved or written after cancellation.

Start a new request with a smaller, more explicit task. If the same repeat occurs consistently, report it with the prompt and visible response.

## Thinking text looks repetitive

Reasoning text is generated by the AI and may be verbose or repetitive. Judge the result by the verified records, calculations, proposal card, and final answer—not by polished-looking reasoning.

## The AI is unavailable

- Confirm Kwantflow AI is installed and ready in Settings.
- Wait for another AI task to finish.
- Retry after cancellation has completed.
- Restart the app if the previous task did not release cleanly.

Opening or closing the sidebar alone should not install, load, or unload the AI.

## Report a repeatable problem

Include:

- the exact prompt;
- the active workspace and page;
- the record names involved;
- the visible final answer or proposal;
- whether you stopped, discarded, or approved it;
- screenshots where useful.

Do not include confidential customer information unless it is required and permitted by your organisation.

## Related guides

- Ask Kwantflow AI (see "Ask Kwantflow AI" in this manual)
- Review AI record proposals (see "Review AI record proposals" in this manual)
- Workspace AI knowledge (see "Workspace AI knowledge" in this manual)
- File and AI issues (see "File and AI issues" in this manual)

# Frequently asked questions

## Workspaces and data

### What is a workspace?

A workspace is an independent local environment for one business, department, or operating context. It keeps its own RFQs, records, estimates, settings, email connections, and AI knowledge.

### Can information move between workspaces automatically?

No. Switching workspaces changes the active environment; it does not merge records or estimating context.

### Is the AI download repeated for every workspace?

No. The downloaded AI is shared by the installation, while the records and guidance supplied to it remain workspace-specific.

### Do I need to sign up or buy a subscription?

No. Kwantflow has no signup, subscription, trial expiry, or commercial workspace and RFQ caps. Optional provider email authorization is separate.

### What happens if I delete a workspace?

Its local records are removed from that installation. Create a suitable backup first if you may need the workspace again.

## RFQs, files, and assets

### What is the difference between an RFQ and an asset?

An RFQ is the top-level customer enquiry. An asset is a practical estimating bundle inside the RFQ, often representing a part, package, trade, or work area.

### Do I need an asset for every file?

No. Group files according to how the work should be estimated. Several related files may belong to one asset.

### What should I do with a revised drawing?

Add it to the existing RFQ, identify the affected asset, compare the change, update the relevant estimate, and export a revised quote when the commercial output changes.

### Can I create an RFQ from email?

Yes. A connected Gmail or Outlook message can prepare a reviewable intake form. The RFQ is not created until you review and save it.

## Setup data and relationships

### When should I create a reusable material or rate?

Create it when the business expects to use the record again. Keep one-off job allowances inside the relevant estimate.

### Can one material be linked to several companies?

Yes. Materials, labour rates, equipment rates, and subcontract rates can be linked to multiple companies.

### Does deleting a company relationship delete the records?

No. Removing a relationship leaves both the company and catalogue record intact.

### Does linking a company create supplier-specific pricing?

No. The relationship helps identify relevant companies. Confirm current supplier pricing before using it commercially.

### What is the difference between a template and a preset?

A template is a broader reusable starting structure. A preset is usually a smaller repeatable bundle or commercial arrangement used inside a workflow.

### What is the difference between a cost preset and an estimate template?

A cost preset reuses the cost rows from one takeoff item. An estimate template reuses the broader estimate scaffold. Both remain editable after use.

### Should I update a reusable rate for every supplier quote?

No. Update the workspace default when the value should be reused broadly. Keep unusual freight, urgency, minimum-order, or job-specific pricing in the relevant estimate.

### Why can I not delete a company?

It may still be required by a linked person, RFQ, or another protected business record. Review and resolve those dependencies instead of deleting useful history blindly.

## Estimates and quotes

### What is a takeoff item?

A takeoff item is a measurable piece of scope, such as 250 kg of plate, 18 metres of handrail, or six brackets.

### What is a cost component?

A cost component is a material, labour, equipment, subcontract, or manual cost used to deliver a takeoff item.

### Should I use Project Structure on every job?

No. Use it when a job benefits from a hierarchy of phases, levels, rooms, zones, trades, or packages. Keep simple estimates flat.

### What is the difference between the estimate and quote workspace?

The estimate holds detailed internal scope and costing. The quote workspace assembles the customer-facing commercial output, including options, markups, terms, and PDF export.

### When should I create a quote revision?

Create a revision when issued commercial output changes, such as after an addendum, scope change, new option, or changed terms. Do not create revisions for ordinary edits to an unissued draft.

### Can several assets be included in one quote?

Yes. Assets keep estimating packages separate inside one RFQ, while quote options can assemble the intended reviewed packages into a commercial response.

## Kwantflow AI

### Does opening the AI sidebar load the AI?

No. The AI starts when an AI task is requested, not merely when the sidebar opens.

### Can Kwantflow AI search my records?

Yes. It can search supported records in the active workspace and use the results in a multi-step answer.

### Should I trust AI arithmetic?

Kwantflow AI can use an exact calculator for arithmetic, but you should still verify the selected records, units, rates, currency, and commercial assumptions.

### Can AI create or update records without asking?

No. Supported create or update requests appear as a reviewable proposal. Nothing is written until you approve it.

### Can I approve only one item in a grouped proposal?

No. A grouped proposal is approved or discarded together. If one item is wrong, discard the set and ask for a corrected proposal.

### Can AI delete records?

No. Delete business records through the normal app controls with the appropriate confirmation.

### Why can AI still make mistakes?

AI output is probabilistic. Exact workspace records, deterministic tools, structured proposals, and user approval reduce risk, but they do not replace review.

## Email

### Is an email connection shared across workspaces?

No. Each workspace manages its own Gmail or Outlook connections and remembered detection results.

### Does RFQ detection scan attachment contents?

The initial detection decision uses message information and body text. Attachments are handled separately when preparing an RFQ intake.

### Why are remote email images blocked?

Loading a remote image can reveal that a message was opened. Kwantflow blocks remote email images. Embedded raster images can still appear without contacting the sender's server. To view remote images, open the original message in your email provider.

### Will the same email be classified repeatedly?

Successful RFQ detection results are remembered for the current classifier version. Failed attempts remain retryable.

## License and maintenance

### Can I use Kwantflow commercially?

Yes. The application is GPL-3.0-only, with dependencies retaining their own licenses. Distributed covered modifications require corresponding source. Your own RFQs, files, and quote outputs do not become GPL-licensed.

### Who will provide future updates?

Kwantflow is community maintained under the GPL-3.0 license. Anyone can fork and improve it. Support and compatibility with future operating systems or provider rules are not guaranteed.

## Backups and recovery

### Are backups shared between computers?

Local restore points stay on the device. Export a portable backup and import it on another compatible installation when moving computers.

### What does restoring a backup do?

It replaces all registered workspaces and local settings with the selected restore point. Later changes may be lost. Credentials and the downloaded model are excluded from portable archives.

### When should I create a manual backup?

Before a large import, major cleanup, or another local change you may need to undo.

## Find the full guides

- Workspaces (see "Workspaces" in this manual)
- Work inside an RFQ (see "Work inside an RFQ" in this manual)
- Build takeoffs and costs (see "Build takeoffs and costs" in this manual)
- Templates and presets (see "Templates and presets" in this manual)
- Records and relationships issues (see "Records and relationships issues" in this manual)
- Ask Kwantflow AI (see "Ask Kwantflow AI" in this manual)
- Connect email (see "Connect email" in this manual)
- Kwantflow user manual (see "Kwantflow user manual" in this manual)
- Data and privacy (see "Data and privacy" in this manual)

# Supported files

Kwantflow supports common tender and estimating file types. Support can mean different things:

- **Upload** means the file can be added to an RFQ.
- **Preview** means Kwantflow can show the file inside the app.
- **AI use** means the file can contribute useful evidence to an AI draft when it is readable.

## How to read support

One file can be:

- uploadable into an RFQ
- previewable inside the app
- useful for AI after Kwantflow prepares readable evidence

These are not always the same thing.

For example, a file may upload successfully but still need manual review if AI cannot extract enough usable information from it.

## Commonly supported file families

| File family | Examples | Typical use |
| --- | --- | --- |
| PDF | `.pdf` | Tender documents, drawings, specifications |
| Images | `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`, `.gif`, `.bmp`, `.tif`, `.tiff` | Photos, scans, screenshots |
| Text and data | `.txt`, `.md`, `.json`, `.xml`, `.csv` | Notes, logs, exports, simple tables |
| Office files | `.docx`, `.xlsx` | Schedules, scope notes, spreadsheets |
| CAD and model files | `.step`, `.stp`, `.iges`, `.igs`, `.obj`, `.stl`, `.3mf`, `.dxf`, `.dwg` | Drawings, models, fabrication or design files |
| Archives and emails | `.zip`, `.msg`, `.eml` | Tender packages and forwarded packages |

## What usually works best with AI

The strongest AI-ready inputs are usually:

- PDFs
- PNG, JPEG, and WebP images
- text-like files such as TXT, Markdown, CSV, JSON, and XML
- DOCX and XLSX when the file content can be extracted clearly
- email files where the body text matters

CAD and drawing files can still be useful, but they often depend on rendered previews or converted evidence rather than direct raw interpretation.

## Common file scenarios

### PDF tender pack

Use PDFs for:

- specifications
- issued drawings
- scope documents
- commercial schedules

This is usually the most dependable all-round file family.

### Image or scan

Images work well when the content is sharp and readable.

Low-quality photos, faint scans, or screenshots with tiny text may still need manual checking.

### CAD and model files

Use CAD and model files when the geometry matters, such as:

- part shapes
- fabricated assemblies
- 2D drawing review
- model-based package understanding

DXF and DWG are treated as drawing-oriented formats. STEP, IGES, STL, OBJ, and 3MF are treated more like model evidence.

### Office files

DOCX and XLSX are useful when the file contains:

- scope notes
- schedules
- tabular pricing context
- structured takeoff or issue lists

Older `.doc` and `.xls` formats are not part of the normal supported upload path.

### ZIP packages

ZIP files are useful when a tender arrives as one archive.

Treat the ZIP as a container, not the final evidence. The useful result comes from the files inside it.

### Email files

`.msg` and `.eml` files are useful when the message body, instructions, and attachments are part of the RFQ context.

These are especially helpful for forwarded tender emails.

## AI drafting note

AI drafting only uses files when Kwantflow can prepare useful evidence from them. A file may still need manual review even if it uploads successfully.

## When AI may skip a supported file

AI may still skip a supported file when:

- the document is unreadable
- the file is damaged
- the important detail is only visible in a poor scan
- the content is too weak to trust automatically
- the file is better treated as supporting reference than direct estimate evidence

## Unsupported or limited files

Some older or specialist formats may not be supported until they can be handled reliably.

If a file is important and does not preview or draft well, review it manually and include the information in your estimate.

## Best practice

Use Kwantflow to centralise the evidence, then decide which files are safe to rely on directly and which still need estimator judgment.

# Keyboard shortcuts

Keyboard shortcuts depend on your operating system, keyboard focus, and the current area of the app.

Kwantflow currently relies more on visible controls, tabs, and panels than on a large custom shortcut system.

## App shortcut

| Action | macOS | Windows |
| --- | --- | --- |
| Show or hide the main sidebar | `Command+B` | `Ctrl+B` |

## Ask Kwantflow AI

When the message box is focused:

| Action | Shortcut |
| --- | --- |
| Send the current message | `Enter` |
| Add a new line without sending | `Shift+Enter` |

## Viewer shortcuts

Viewer shortcuts work only when the viewer has keyboard focus.

### 3D CAD viewer

| Action | Shortcut |
| --- | --- |
| Pan left, right, up, or down | Arrow keys |

### 2D CAD viewer

| Action | Shortcut |
| --- | --- |
| Return to selection mode | `Esc` |
| Erase the selected entities | `Delete` or `Backspace` |

Review the selection before using an erase shortcut.

## Standard text shortcuts

Standard desktop text behavior is available where the current control supports it.

| Action | macOS | Windows |
| --- | --- | --- |
| Copy | `Command+C` | `Ctrl+C` |
| Paste | `Command+V` | `Ctrl+V` |
| Select all | `Command+A` | `Ctrl+A` |

## Where shortcuts are most useful

- copying values or notes
- pasting data into dialogs
- selecting text or table content
- writing a multi-line AI request
- moving around a focused CAD view

## App navigation

Use visible buttons, tabs, panels, and sidebar items as the primary navigation controls.

## Practical expectation

If a shortcut does not work in the current area, click the relevant viewer or input first, or use the visible control instead.

Kwantflow intentionally keeps important estimating, deletion, approval, and quote actions available through visible controls rather than relying on hidden shortcuts.

# Glossary

## Asset

A group of related RFQ files and estimating work. An Asset usually represents a package, area, stage, system, or part of a job.

## Classification

A way to organise estimate content with systems and cost codes.

## BOM

Bill of Materials. A customer-supplied or internally prepared list of parts, materials, quantities, or assemblies that may help prepare an RFQ estimate.

## BOQ

Bill of Quantities. A structured quantity list used to review measurable scope before it becomes quote output.

## Company relationship

A workspace link between a company and a material, labour rate, equipment rate, or subcontract rate. It identifies relevant businesses without creating supplier-specific pricing.

## Cost component

A material, labour, equipment, subcontract, preset, or manual cost row used to deliver a takeoff item.

## Cost preset

A reusable snapshot of the cost rows from one takeoff item.

## Estimate

The working price build-up for an Asset.

## Estimate template

A reusable estimate scaffold saved from reviewed estimating work.

## Connected email

The optional Gmail or Outlook connection that lets a workspace bring RFQ emails and attachments into the estimating workflow.

## Kwantflow AI

Optional AI help that runs on your computer after a one-time download.

## Ask Kwantflow AI

The assistant sidebar inside Kwantflow. Use it to ask questions, search the current workspace, calculate exact values, and prepare drafts or proposals for review.

## Quote

Customer-facing output built from reviewed estimates.

## Quote revision

A saved version of quote output at a point in time.

## Project structure

An optional hierarchy used to organise work by phases, areas, levels, trades, packages, or another useful breakdown.

## Proposal set

A grouped set of AI-prepared record changes waiting for user approval. The set is approved or discarded together.

## RFQ

Request for Quote. The top-level job record in Kwantflow.

## RFQ Detector

Kwantflow AI support for identifying connected emails that look like RFQs so you can review them and create records faster.

## Workspace

An independent local business environment inside Kwantflow. Each workspace keeps its own records, estimates, settings, email connections, and AI guidance.

## Workspace AI knowledge

Workspace-specific playbook text, files, and feedback that guide AI behavior in that workspace.

## Setup data

Reusable workspace records such as companies, materials, labour rates, equipment rates, subcontract rates, presets, templates, and classifications.

## Takeoff item

A measurable piece of scope inside an estimate, such as a quantity of plate, metres of handrail, or number of fabricated brackets.
