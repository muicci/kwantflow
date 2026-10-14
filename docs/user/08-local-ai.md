# Local AI

Kwantflow AI is an optional language model that runs entirely on your own computer. It needs no API key and has no usage charge. Install it during first-time setup or later from **Settings > Agent**, or leave it out and use every manual estimating and quoting feature.

## How it works

### The model

- Kwantflow uses Google's Gemma 4 E4B instruction model in the LiteRT-LM format, published under the Apache 2.0 licence.
- The model file is about 3.7 GB. It is downloaded once, from Hugging Face, when you choose **Download Kwantflow AI** during setup or in **Settings > Agent**. Leave the free disk space shown in the app available.
- Before first use, Kwantflow checks the file's size and SHA-256 fingerprint against the exact version pinned in the app. A file that does not match is rejected.
- **Downloaded** means the model file is installed and verified. **Ready** means the native engine has loaded.
- The model is not included in the installer, so you can skip AI completely and still use every manual estimating and quoting feature.
- The downloaded model is shared by the installation. The records and guidance supplied to it remain workspace-specific.

### The engine

- The model runs inside Kwantflow using Google's LiteRT-LM on-device runtime.
- Kwantflow uses your graphics processor (GPU) when it can and automatically falls back to the processor (CPU) if the GPU is unavailable.
- The engine only loads when you ask for an AI task. Opening the Ask Kwantflow sidebar or completing setup does not load it. The first request after starting the app can take a little while; later requests are faster.
- On computers with 8 GB of memory, Kwantflow uses a shorter context (how much text the model can consider at once). 16 GB or more is recommended for longer documents and conversations.

### Privacy

- Your prompts, files, records, and AI answers stay on your computer. Nothing is uploaded.
- After the one-time download, Kwantflow AI works offline.
- Kwantflow does not log raw prompts or customer documents.
- The AI only sees the active workspace. Workspace playbooks, uploaded knowledge, records, and feedback stay tied to that workspace and should not appear after you switch to another one.

### What the assistant can do

Ask Kwantflow and AI drafting use a small set of built-in tools rather than guessing:

- search the active workspace's records (materials, rates, contacts, RFQs, estimates, and so on);
- run exact decimal calculations;
- look at the screen or record you attached to the conversation;
- read supported attached files and images;
- use the workspace playbook and knowledge files you add in **Settings > Knowledge**;
- prepare grouped create or update proposals for supported records;
- take several steps when the task needs lookup, calculation, and a final answer;
- queue a message while Kwantflow AI is starting.

### What it cannot do

- It cannot change records without your approval. Proposals are written only after you approve them.
- It does not delete business records.
- It does not change quote maths. Quote totals are always calculated by Kwantflow's deterministic quote engine.
- It does not browse the internet or contact any service.
- It only sees the active workspace.

## Using it and approving proposals

Treat every AI answer and draft as a starting point. Check facts, quantities, units, rates, scope, inclusions, exclusions, assumptions, proposals, and customer-facing wording before you rely on it.

### Ask Kwantflow

Ask Kwantflow is the assistant sidebar inside Kwantflow. Use it when you want help understanding what is open, preparing draft content, checking next steps, or asking product questions while you work. It starts when you request an AI task, not just because the sidebar is open.

It can:

- answer questions about the current workspace;
- search workspace records when it needs exact information;
- calculate exact values instead of relying on rough mental arithmetic;
- help prepare estimate or quote drafting ideas;
- inspect the current page or record context you attached to the conversation;
- accept images when you need to show a visual detail;
- prepare grouped create or update proposals for supported records.

To use it:

1. Open Ask Kwantflow from the toolbar.
2. Type your question or request. Press `Enter` to send and `Shift+Enter` for a new line.
3. Attach the current page context when it is useful.
4. Add images only when they help explain the request.
5. Review the answer before using it in an estimate, quote, or customer message.

### Draft an estimate

AI drafting helps prepare a first version of an estimate. It does not replace estimator review.

Use AI drafting when:

- the Asset has useful files or notes
- you want a structured first pass
- you are prepared to check the output

Do not use AI drafting as the only review before quoting.

1. Open the Asset.
2. Open the estimate or AI drafting area.
3. Check that useful files are attached and readable.
4. Start the draft.
5. Wait for Kwantflow AI to prepare the draft.
6. Review every line before saving or quoting.

Check scope, quantities, units, rates, inclusions, exclusions, and assumptions. If a file is not used by Kwantflow AI, review it manually. You end up with a draft estimate that you can edit, approve, or discard. [Build takeoffs and costs](05-estimating.md#build-takeoffs-and-costs) explains what to check in each drafted row, and [Supported files](12-reference.md#supported-files) explains which files make good evidence.

### Approve record proposals

Ask Kwantflow can prepare record changes for review when you ask it to create or update supported setup records. These are proposals, not automatic writes.

Use AI record proposals when you want help preparing changes such as:

- creating several new material records
- updating an existing rate
- preparing a company and linked contacts for review
- drafting reusable setup records from a clear written request

Kwantflow groups the proposed changes into one review set for that request. You then choose one of two outcomes:

- **Approve all**
- **Discard all**

This keeps related changes together and avoids silent partial updates. Nothing is written until you approve the grouped proposal set.

Before approving, review:

- names and labels
- rates, units, and currencies
- which records are being created or updated
- optional details the AI may have included
- whether the group matches what you asked for

If anything is wrong or incomplete, discard the set and ask again more clearly. The AI does not write records before approval, does not delete business records, and should not invent unsupported fields just to fill space.

For example, if you ask:

`Create three materials for approval: 10mm plate, mesh sheet, and scaffold day rate.`

Ask Kwantflow can return one grouped proposal set containing the prepared records. You review the whole set, then approve or discard it together. Use AI proposals to save setup time, not to skip checking.

### Other AI tasks

- **Quote emails:** choose **Generate draft** in the quote email area to prepare a customer-facing message around the current quote. See [Generate a quote email draft](06-quotes.md#generate-a-quote-email-draft).
- **Mail RFQ Detection:** flags connected mailbox messages that look like RFQs. See [RFQ Detector with AI](09-email.md#rfq-detector-with-ai).

## Workspace AI knowledge

Workspace AI knowledge helps Kwantflow AI behave more like your team expects inside one workspace. It does not become a shared global memory across every workspace on the device. Manage it in **Settings > Knowledge**.

### What you can add

- playbook text
- uploaded knowledge files
- feedback that reinforces preferred corrections

### What it affects

This guidance can influence AI-supported drafting, Ask Kwantflow, and other workspace AI tasks where the current workspace context matters.

### Scope and priority

Knowledge stays inside the workspace where you added it. If you switch workspaces, the AI should use the active workspace knowledge instead.

Use workspace knowledge for instructions, terminology, commercial rules, and reusable estimating guidance that should apply repeatedly. Use direct prompt instructions when the task is specific to the current job.

### Review and removal

Remove or replace outdated playbook text, files, or feedback when your process changes. Keep this information current so AI suggestions stay useful instead of repeating old rules.

Workspace AI knowledge improves guidance, not authority. You still need to review AI-generated estimates, drafts, detections, and record proposals before using them.

## Related guides

- [Build takeoffs and costs](05-estimating.md#build-takeoffs-and-costs)
- [Generate a quote email draft](06-quotes.md#generate-a-quote-email-draft)
- [RFQ Detector with AI](09-email.md#rfq-detector-with-ai)
- [AI answer and proposal issues](11-troubleshooting.md#ai-answer-and-proposal-issues)
