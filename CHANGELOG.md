# Changelog

## V6 — 2026-11-20

### Report publishing with photos
* Separate **public** bucket `public-report-images`; the `report-evidence` bucket stays private.
* Administrators explicitly select which image evidence is public (up to 8 per report), edit alt text, replace or
  remove photos and see each photo's status (Public / Ready / Staged / Missing). Approval alone still publishes nothing.
* Public copies are **stripped of EXIF/XMP/IPTC metadata** (GPS, camera, comments); JPEG orientation is kept.
  Width/height are stored so the gallery has no layout shift.
* Unpublishing (or archiving, or an owner edit of a published report) **deletes the public copies**; republishing
  copies them under new random names, so old public URLs stop working.
* Public feed: responsive photo carousel (scroll-snap, arrows, swipe, counter), lightbox (keyboard, swipe, focus
  return), lazy loading, loading placeholders, broken-image fallback, alt text. The API returns only URL, alt, width, height.

### Permanent report deletion (hard delete)
* New permission `delete_reports` (Founders only by default) + password re-confirmation + reason + typed report ID.
* Two-phase, retryable, verified deletion across both buckets and every report-specific table, with audit redaction;
  a minimal deletion record (keyed reference, reason, administrator, time) remains. See PERMANENT_DELETION.md.
* Database lock during deletion (edits, reviews, publication and new files refused, HTTP 423).
* V5's soft "Delete" in the dashboard was replaced by **Delete permanently**. The owner action in My Reports is now
  called **Withdraw** (unchanged behaviour); withdrawn reports are visible to administrators ("Withdrawn by owner").

### Report management
* Material edits: an editor without `approve_reports` (or anyone editing their own report) sends an approved report
  back to Pending; changing public facts (category, activity date, recovered) of a published report unpublishes it.
* Evidence uploads can no longer leave orphaned files (object removed if its row cannot be written).
* Portal: multiple evidence files per report with previews, per-file upload progress, retry and remove; a file is
  shown as uploaded only after Storage and the database confirmed it.

### AI Support redesign
* New launcher (icon morph, loading ring, unread badge, safe-area spacing), panel open/close transition, header with
  mode-aware identity and status, mode banner (waiting with request ID / connected agent / closed), timestamps,
  typing indicator, skeleton loading, error and retry states, auto-growing composer (Enter sends, Shift+Enter adds a line).
* **Fixed:** typing while a reply was pending and pressing Enter silently discarded the text.
* **Fixed:** after a page refresh during a human chat, agent and system messages were shown twice.
* **New:** failed AI replies show *Retry*, which answers the already-saved message (`retry_of`) — never stored twice;
  after a network drop the widget first asks the server whether the message was saved.
* Closed cases: new-request Telegram alerts re-check the case before **every** recipient.

### Loading system (whole platform)
* `ux.css` / `ux.js`: button states (idle, loading, success, error, disabled), duplicate-click protection, request
  timeouts and cancellation, stale-response guards, skeletons shaped like tables/cards/chat, upload progress,
  navigation progress bar, screen-reader announcements, reduced-motion support.
* Dashboard: every API call has a timeout; lists ignore stale responses and show table skeletons; dialogs show real
  loading states and can no longer stay stuck.

### Telegram
* Exactly seven commands: `/help /portal /chats /quene /offline /online /cancel`. Removed `/myreports /total /delete
  /pending /queue /report` and `/skip` (now an inline button). Retired delete buttons do nothing.
* Command menu synchronized across scopes and languages and verified by reading it back.
* `/chats` shows reference, customer, status and last activity; `/cancel` only expires your own pending step;
  `/offline` keeps your assignments.

### Other
* Homepage list label corrected to "Latest published reports". Public report endpoints are no longer CDN-cached.
* Health checks include migration 004, the new tables and the new bucket.
