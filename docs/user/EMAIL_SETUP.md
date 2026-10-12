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
