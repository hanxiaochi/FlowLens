# FlowLens

[简体中文](README.md) · **English** · [v1.7.0 release](https://github.com/hanxiaochi/FlowLens/releases/tag/v1.7.0)

**[Try the live demo →](https://hanxiaochi.github.io/FlowLens/)**

No installation or API key needed. Start with a fictional supervision application, or explore approvals and 3D deployment in the interaction lab. AI generation is disabled in the public demo; your edits stay in your browser. The demo interface is currently in Chinese.

**Click a button. See where the request goes and what changes in the data.**

**Turn existing Word forms into a workflow you can fill in, run, and discuss.**

![Fictional inspection form under review](docs/images/forms-demo.png)

[Share trial feedback](https://github.com/hanxiaochi/FlowLens/issues/new?template=trial-feedback.yml) · [Launch notes and English post](docs/launch-kit.md)

[Product audit and proposed next steps (Chinese)](docs/fde-product-audit-2026-11-02.md) · [Discovery and acceptance worksheet (Chinese)](docs/fde-discovery-worksheet.md)

**New in 1.3** — Organize templates into an application, create projects, filter pending work by role, and carry fields from a completed instruction into its reply and archive record. Add repeating detail rows, preview supported natural-language rules, and export a restorable application with versioned API and SQL drafts.

![Application and project workspace](docs/images/application-workspace-1.3.jpg)

[1.3 release notes and acceptance](docs/release-1.3.0.md)

## 1.4 adds a shared team workspace

1.4.1 fixes successful logins exhausting a shared proxy's login allowance. Windows and Ubuntu each pass 70 regression tests. Linux container and Compose/Caddy checks cover writes, backup restoration, and HTTPS re-login. Relevant code changes trigger these checks automatically. [Cross-platform acceptance run](https://github.com/hanxiaochi/FlowLens/actions/runs/41479752796)

Post-release tests on main verify full rollback and retry after a late transaction failure, plus byte-for-byte attachment restoration. Windows and Ubuntu now each pass 71 tests. [Latest acceptance](https://github.com/hanxiaochi/FlowLens/actions/runs/41480784477) · [Delivery audit (Chinese)](docs/delivery-plan.md)

A Windows LAN pilot has passed five-account HTTPS workflow, restore, and browser UI checks on the server itself. Access from another computer and real-business approval remain pending. [Pilot status (Chinese)](docs/delivery-plan.md)

An owner-hosted Tencent Cloud pilot has since passed public-IP HTTPS, five-role workflow, concurrent-write conflict, and database restoration checks. Daily backups are enabled. Real-business approval and longer-term operation remain under validation. [Cloud acceptance and screenshot](docs/cloud-pilot-2026-11-03.md)

## 1.7 exports a project handoff archive

Download a project ZIP from the team workspace. It includes printable forms, workflow history, linked records, original attachments and a SHA256 manifest. Extract the archive and open index.html to find each document. The server checks current project access, limits an export to 64 MiB, and releases its transfer slot when a download ends or is interrupted. Windows, Ubuntu and container acceptance pass, with 82 automated tests. [Release notes and remaining checks (Chinese)](docs/release-1.7.0.md)

![Project handoff download](docs/images/project-handoff-1.7.png)

## 1.6 gives attachments their own storage

Attachments now live as verified binary data in SQLite. Project pages load metadata and fetch files on demand, with current membership checks, cancellation and a download timeout. Existing databases migrate with a pre-migration snapshot, and backups include every attachment. The cloud pilot passed upload, byte-for-byte download and restore checks with three synthetic 8 MiB files. All 79 automated tests pass. Real workload capacity and customer workflows remain under validation. [Upgrade and acceptance notes (Chinese)](docs/release-1.6.0.md)

![Attachment storage on the cloud pilot](docs/images/attachment-operations-1.6.png)

## 1.5 operations and delivery checks

Admins can inspect capacity, account counts, verified backup metadata, and restore markers. Instance and project checklists retain reviewers, evidence, recording accounts, and history. Revision and configuration guards handle concurrent changes, and restoration triggers review. The cloud service has been backed up and upgraded. Windows and Ubuntu each pass 73 tests. [Release notes](docs/release-1.5.0.md) · [Plan and pending decisions](docs/delivery-plan.md)

![Cloud delivery check records](docs/images/delivery-checks-1.5.png)

Import an application package into the self-hosted team service, create accounts, and assign project roles. A supervisor can issue an instruction, a contractor can reply using a separate account, and a records officer can archive it. The server stores forms, attachments, and the account behind each operation.

![Shared team workspace](docs/images/team-workspace-1.4.jpg)

The server checks project roles, workflow stages, and record revisions. Repeated requests reuse their result. This release also adds account deactivation, password changes, audit history, versioned template publication, and SQLite backup and restore tools.

Download `FlowLens-1.7.0-team.zip`, install Node.js 24 LTS, initialize the administrator, then run `npm start`. The team runtime bundles its required files and needs no npm install. See the [deployment guide (Chinese)](docs/team-deployment.md) and [release acceptance](docs/release-1.5.0.md).

The public demo runs locally in your browser. The shared service is self-hosted and intended for a small-team pilot. Cloud technical acceptance is recorded. Customer workflows, sustained capacity, and maintenance handover still need validation.

## Watch the walkthrough

The 1.3 design-workspace video follows the application through detail rows, linked forms, review returns, package restoration, and development handoff.

https://github.com/user-attachments/assets/3a3c4347-98a1-4a2f-bd33-750183186221

**English synthesized narration and subtitles, 3 minutes.** This step-by-step video uses captures from the actual Chinese interface and fictional data.

[Watch / download](https://github.com/hanxiaochi/FlowLens/releases/download/v1.3.0/FlowLens-1.3-guide.en.mp4) · [Chapters and transcript](docs/video-guide.en.md) · [Subtitles](https://github.com/hanxiaochi/FlowLens/releases/download/v1.3.0/FlowLens-1.3-guide.en.srt)

The rule assistant uses a documented local grammar and requires confirmation before applying a draft. Application data lives in the current browser. Production use needs server authentication, project permissions, shared storage, and operational backups.

## Why this exists

### Start with the forms you already use

Import DOCX files, configure fields in their original table structure, and pass the same record through review, return, revision, issue, receipt, and archive. Attachments, linked records, template snapshots, and step history stay with the record. Export a workspace package or a standalone printable HTML file.

Local acceptance checks imported 340 templates from four supervision document collections and exercised a complex inspection form. Extracted fields and workflow drafts still need business review. This is a local simulation stored in your browser, without authenticated multiuser access, electronic signatures, or production services.

[Usage guide (Chinese)](docs/forms-guide.md) · [Product goals (Chinese)](docs/forms-roadmap.md) · [Acceptance notes (Chinese)](docs/forms-acceptance.md)

You have an idea for a product, but explaining it to a developer is hard. You draw the screens, then realize the permissions, workflow, and database still need to be figured out. That is where FlowLens started.

Describe your idea or upload a prototype screenshot. FlowLens turns it into interactive pages and makes the process behind each button visible: who sends the request, which module handles it, where the rules apply, and how the data changes.

You do not need to understand the whole system before you can try it, change it, and bring something concrete to the discussion.

![A generated product page and the data changes caused by an operation](docs/images/prototype.png)

## Run it locally

You do not need an API key to start. Three built-in examples cover team management and approvals, a product catalog, and service tickets. Their interactions, execution traces, and 3D deployment scenes work offline.

Install [Node.js](https://nodejs.org/) 24 or a newer LTS version, then run:

```sh
git clone https://github.com/hanxiaochi/FlowLens.git
cd FlowLens
npm ci
npm start
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/).

On Windows, you can also double-click `启动 FlowLens.cmd`. It installs the runtime dependency on first launch. To skip that download, get the packaged ZIP from [Releases](https://github.com/hanxiaochi/FlowLens/releases), extract it, and run the launcher. You still need Node.js. The examples work offline; AI generation needs access to a model service.

## A good first run

1. Choose the team approval example (`团队与审批`) and submit a leave request.
2. Follow the steps on the right: validation, rule evaluation, and the database write. Play the sequence or advance one step at a time.
3. Switch roles and try another operation. See why some actions are allowed and others are rejected.
4. Open System Design (`系统设计`), change the approval threshold, and try the workflow again.
5. Open Deployment World (`部署世界`), simulate mobile access or a network failure, and see where the request stops.

The pages and diagrams use the same model. Change a rule and the next simulation follows it. Data writes happen during execution; this is more than a fixed animation.

![Leave approval states, branches, and editable rules](docs/images/workflow.png)

## What version 1.0 can do

| What you want to understand | How to explore it |
| --- | --- |
| What would my idea look like? | Generate a draft from text or a screenshot; edit layouts, fields, and actions; preview a phone layout |
| What happens after a click? | Follow the execution trace, permissions, business rules, and before-and-after data |
| How do the frontend, backend, and database connect? | Explore module relationships, state workflows, and entity diagrams; export SVGs |
| Where does the software run? Can people use a phone? | Explore devices, network entry points, servers, and databases in 3D; simulate failures |
| What can I hand to a developer? | Export the project JSON, development notes, OpenAPI contract, and SQL draft |
| What if I make a mistake? | Save locally, restore earlier versions, import or export a project, and review AI changes before applying them |

## Make deployment easier to picture

Servers, databases, and network entry points do not have to remain abstract terms. Rotate the scene, zoom in, and select a device to understand its job.

Deployment suggestions take the audience, scale, mobile needs, budget, region, and maintenance capacity into account. They explain a possible setup. They do not buy cloud resources or deploy a real application.

![A business server and database in the 3D deployment scene](docs/images/deployment.png)

## Connect your own model

Open the AI connection settings at the top right. Enter the service URL, model name, protocol, and API key. FlowLens supports interfaces compatible with **Chat Completions** or **Responses**. Use the API base URL; do not append `/chat/completions` or `/responses` yourself.

Text generation needs a text-capable model. Screenshot input also needs image support. Images can be PNG, JPEG, or WebP, up to 5 MB each. Compatibility and capabilities vary by provider and model, so check the provider's documentation.

Try a prompt like this:

> Build an employee directory and leave approval system. Employees submit requests, managers approve them, and requests longer than three days also need a department head's approval. Show employees and pending requests on the home page.

Review the generated pages, fields, and assumptions. To make a follow-up change, enable `在当前设计上修改` (modify the current design), then describe what should change. Failed or cancelled generation keeps the current project intact.

The API key stays in the local Node process memory and must be entered again after a restart. AI requests send your description, selected image, and—when revising—the current design to the configured provider. Offline examples make no model calls. Projects are stored in the current browser; export important work as JSON for backup.

## Current limits

FlowLens helps people understand, test, and discuss a product design. The self-hosted team service adds shared business execution.

- Screenshot reconstruction is approximate, not pixel-perfect. Inferred business rules need human review.
- The current model covers CRUD operations, roles, references, state transitions, and numeric conditions. Complex transactions, arbitrary code, and complex date calculations are outside its scope.
- The backend and database in the demo are simulated. Exported contracts and SQL are starting points; the team service now provides accounts, project access, revision checks, and backups. Record-level access and production integrations need project-specific work.
- The team service supports shared project workflows. Users refresh to fetch changes from colleagues. Push updates and record-level confidentiality remain future work.
- The design server defaults to loopback. External access to the team service requires HTTPS and a correctly configured origin. The 3D scene requires WebGL.
- The current application interface is Chinese. This README and the English video help English-speaking readers follow the workflow; they do not imply that the app has a complete English localization.

## Working on the code

There is no frontend build step. Edit a file and refresh.

| Files | Responsibility |
| --- | --- |
| `model.mjs` / `examples.mjs` | Shared model, execution rules, validation, and examples |
| `studio.js` / `studio.css` | Workspace interface and interactions |
| `layout.mjs` / `layout-ui.js` | Prototype layouts and editing |
| `diagrams.mjs` / `diagrams-ui.js` | System relationships and workflow diagrams |
| `scene.js` / `deployment.mjs` | Three.js scene and deployment suggestions |
| `server.mjs` | Local file server and model API proxy |
| `export.mjs` / `impact.mjs` | Handoff exports and change impact analysis |

```sh
npm test
```

Version 1.0 includes 46 automated tests covering model validation, permissions, state transitions, data changes, layouts, API adapters, timeouts, cancellation, migrations, and exports. Model API tests use local mock services and consume no credits. Passing them does not guarantee that every real model will generate a correct design.

The 3D scene uses [Three.js](https://threejs.org/). SQL validation tests use [PGlite](https://pglite.dev/). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency and license information. The project itself has not yet specified a license.

Found a problem or have an idea? Open an [issue](https://github.com/hanxiaochi/FlowLens/issues). Reproduction steps and a sanitized project file help. Please leave out API keys and real customer data.
