# Using the project review checklist

Applies to the 1.19.0-rc.1 release candidate. The stable cloud service remains on 1.18.0. Printed pagination has not yet been accepted.

Open a project and choose **交付前资料核对** (pre-delivery review). The report checks server-saved records against their historical form definitions. Unsaved browser drafts are excluded.

| Category | Meaning | What to do |
| --- | --- | --- |
| 待补齐 — missing current-stage content | Required fields or details are missing at the current stage | Open the record and have an authorized member complete it |
| 需核对 — needs review | Saved content, format, upstream references, or attachment integrity needs checking | Compare source material and workflow history before changing anything |
| 未完成校验 — unchecked | Attachment content was not fully checked in this report | Verify/download that file individually or ask the maintainer to investigate |

Future-stage empty fields are not automatically treated as current-stage omissions. A structural check cannot establish factual accuracy or replace business sign-off. Missing attachments are not flagged unless a requirement is configured.

## Find a record

Filter by issue category, or search record IDs, titles, and displayed business summaries (up to 200 characters). This is not a full-text search of every field. Filtering runs before pagination, with up to 50 matching records per page. Matching records still show all their issues.

The “records I can handle” filter uses actual project roles. Administrators without a business role may see no matches. The full-project totals remain visible separately. Opening a record and returning to the review preserves the filters and page.

## Attachment verification

Each report checks at most 64 MiB of attachment content and deduplicates identical content. Remaining files are marked unchecked. The individual download action checks current permission and file integrity before downloading. It does not rewrite the old report's unchecked status. Repeating the report may encounter the same limit.

## Download and share

The download contains the entire project's latest review, regardless of the on-screen filters. The HTML file can be read offline and records its generation time and workspace/record revisions. It does not update automatically.

Downloaded files include business summaries and issue information. Handle them under your project's data rules; revoking server access cannot recall an offline copy. If a full report exceeds the size limit, use pagination and resolve issues before trying again. A partial screenshot is not a complete handoff report.

Screen reading has been checked; printed pagination remains pending. Trial feedback should include version, steps, expected behavior, and actual results using fictional or redacted data. Do not publish credentials, customer attachments, or databases.
