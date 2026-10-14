# Workspaces and settings

Workspaces keep separate businesses or operating environments apart on one computer. Settings is where you manage the active workspace, your business defaults, backups, connections, and Kwantflow AI.

## Workspaces

Each workspace is an independent local environment inside Kwantflow.

Use separate workspaces when you need to keep different businesses, divisions, teams, or operating environments apart.

### What stays inside a workspace

Each workspace keeps its own:

- RFQs and projects
- files and assets
- estimates and quote history
- companies, people, materials, and rates
- setup preferences
- email connections and RFQ detection results
- AI playbooks, uploaded knowledge, and feedback

Switching workspaces does not mix this information.

### What is shared on the device

Some app-level items are shared on the computer, such as the installed Kwantflow app and the downloaded Kwantflow AI file.

That does not mean workspace context is shared. When you switch workspaces, the AI should use the active workspace only.

### Create a workspace

You can create a workspace during first-time setup or later from workspace management in the app.

Use a name your team will recognise, such as a business name or internal operating unit.

### Switch, rename, or delete a workspace

- Switch workspaces when you want to move into another business environment.
- Rename a workspace when the label is no longer clear.
- Delete a workspace only when you no longer need its local data on that device.

Deleting a workspace removes its local records from that installation. It does not merge them anywhere else.

### Workspace availability

Kwantflow has no limit on the number of workspaces. Available disk space and your computer's resources still determine how much data it can hold.

Backups cover the installation's registered workspaces together. A restore replaces all of them, rather than merging the selected workspace.

## Use Settings

Settings is the control surface for the active workspace and your local installation.

Use it when you need to manage workspace details, business defaults, email connections, backups, or AI behaviour.

### Main areas

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

### When to use each area

#### User

Use this area for your local operator profile, including the personal details and avatar used by the app.

#### Workspace

Use this area when you need to rename, create, switch, or delete local workspaces.

#### Business

Use this area for the business identity that appears in quotes and customer-facing output, such as:

- business name
- contact details
- address
- identifiers
- email signature

#### General

Use this area for defaults that affect everyday estimating output, such as:

- currency
- measurement style
- number and date formatting
- quote defaults

Read [Configure business and quote defaults](03-workspaces-and-settings.md#configure-business-and-quote-defaults) for the complete setup and review checklist.

#### Setup Pages

Use this area when you want to control which optional setup pages are visible in the app shell.

#### Backups

Use this area to:

- review local restore points
- create a manual backup
- restore a backup
- delete an old backup
- export or import a portable backup archive

Restoring a backup replaces all registered workspaces and local settings on the installation, so review its scope and date first.

Read [Back up and restore workspaces](10-backup-and-privacy.md#back-up-and-restore-workspaces) for the full recovery flow.

#### Connections

Use this area to configure your own provider registrations, then connect or disconnect Gmail and Outlook for the active workspace. [Connect email](09-email.md#connect-email) explains the provider requirements.

Choose **Email setup guide** to open the bundled instructions without internet. Paste your registration IDs, choose **Save email registrations**, then connect the mailbox. The registration belongs to you or your organisation, and the app connects directly to its provider without a Kwantflow server.

It is also where you review connection-specific controls such as detection behaviour and mailbox refresh preferences for that workspace.

#### Knowledge

Use this area to manage workspace AI playbook text, uploaded knowledge files, and related AI guidance for the current workspace.

This is also where saved AI feedback history belongs when you want the workspace AI to keep learning from repeated corrections.

#### Agent

Use this area to install or review Kwantflow AI on the device and control AI-related workspace features such as Mail RFQ Detection.

Use this area when you need to:

- install Kwantflow AI on a new device
- confirm the device AI is ready
- review workspace AI availability
- control AI-assisted mailbox behaviour for the active workspace

### Example scenarios

- You want a different business signature on outgoing quote emails.
- You need to connect Gmail in one workspace without affecting another.
- You want to restore yesterday’s local backup after a bad setup change.
- You want to add a workspace-specific playbook before using AI on a repeat kind of job.

### Good habit

Open Settings when the change should affect the workspace or installation itself.

Stay in the workflow pages when the change is specific to one RFQ, asset, estimate, or quote.

## Configure business and quote defaults

Business and general defaults help new quotes start with consistent customer-facing information.

These settings belong to the active workspace. Configure them separately when different workspaces represent different businesses or departments.

### Business identity

In **Settings > Business**, review the information that may appear in customer-facing output:

- business name;
- primary contact first and last name;
- contact email and phone;
- your role;
- business type;
- country and relevant business identifier;
- business address;
- default email signature.

Use details that customers should see. Do not enter private notes or credentials in customer-facing fields.

### Country and business identifiers

Choose the country that reflects the business issuing the quote. This helps Kwantflow use suitable defaults for identifiers, tax wording, and regional presentation.

Review any business identifier before export. The label and expected value vary by country and organisation.

### Currency and measurement style

In **Settings > General**, choose the normal:

- currency;
- metric or imperial measurement style;
- date format.

These defaults improve consistency, but individual catalogue records and commercial inputs still need the correct unit and currency.

Changing a workspace default does not make unlike values interchangeable. For example, a price per kilogram cannot be treated as a price per tonne without a deliberate conversion.

### Tax defaults

Set the normal tax rate for quotes issued by this workspace.

Before issuing a quote, confirm that the rate and tax treatment are correct for the customer, goods or services, and jurisdiction. A workspace default is a convenience, not tax advice.

### Quote numbering and validity

Configure:

- the normal quote-validity period;
- the quote-number prefix;
- the quote-number format.

Use a stable convention that your team can recognise and reconcile with its wider business process. Avoid changing numbering conventions casually after quotes have already been issued.

### Default commercial wording

You can prepare reusable defaults for:

- payment wording;
- inclusions;
- exclusions;
- terms and conditions.

These values provide a starting point for new quote output. Review and edit them for the current RFQ whenever scope or commercial conditions differ.

Keep the wording concise and approved by the business. Do not rely on a default exclusion to compensate for an unclear estimate.

### Email signature

The workspace email signature is appended to outgoing quote emails.

Keep it suitable for the business represented by that workspace. Review it after staff, role, phone, address, or branding changes.

### What changes affect existing work?

Defaults mainly guide new or newly prepared output. Previously exported quote revisions remain historical commercial snapshots.

When a business setting changes:

1. review any quote still in progress;
2. confirm the current PDF and email output;
3. create a new revision when issued commercial information changes;
4. preserve earlier exports as the record of what was issued at that time.

### Multi-workspace example

One installation manages an Australian fabrication business and a separate New Zealand services business.

Each workspace can have its own business identity, currency, tax wording, measurement style, quote numbering, commercial defaults, email connection, and signature. Switching workspaces changes the active business context without combining their RFQs or records.

### Review checklist

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

- [Back up and restore workspaces](10-backup-and-privacy.md#back-up-and-restore-workspaces)
- [Connect email](09-email.md#connect-email)
- [Workspace AI knowledge](08-local-ai.md#workspace-ai-knowledge)
- [Prepare a quote](06-quotes.md#prepare-a-quote)
