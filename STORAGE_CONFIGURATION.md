# Supabase Storage configuration (V6)

| Bucket | Public? | Contents | Size / types | Created by |
|---|---|---|---|---|
| `report-evidence` | **No (private)** | Original report evidence uploaded in the portal or dashboard | 3 MB; JPG, PNG, WebP, PDF | migration 002 (004 re-asserts `public = false`) |
| `public-report-images` | **Yes** | Copies of photos an administrator explicitly selected for a **published** report | 5 MB; JPG, PNG, WebP | migration **004** |
| `team-photos` | Yes | Public team directory photos | 2 MB | 002 |
| `backups` | No | Verified JSON exports | 50 MB | 002 |

## Setup

Migration 004 creates `public-report-images` automatically. If your project's `storage` schema is not reachable
from the SQL editor, create it by hand: **Supabase → Storage → New bucket** → name `public-report-images`,
**Public bucket: on**, file size limit `5 MB`, allowed MIME types `image/jpeg, image/png, image/webp`.
Confirm `report-evidence` is **not** public. Then open **Dashboard → System Health**: "missing buckets" must be empty.

## Policies

No `storage.objects` RLS policies are added, on purpose:

* Browsers never talk to Supabase Storage directly. Every upload, copy, signed URL and deletion goes through
  `/api/*` with the **service role key**, which only exists on the server (Vercel environment).
* Private evidence is reachable only through short-lived **signed URLs** (120–300 s) issued after a permission
  check; each view is audited.
* A public bucket lets anyone fetch an object **by its exact URL**; listing the bucket still needs a policy, and
  there is none for `anon`/`authenticated`. Object names are 128-bit random (`<report ID>/<32 hex>.jpg`).

Do **not** add an "allow all" policy to make something work. If you use other Supabase clients, keep
`storage.objects` closed to `anon` and `authenticated` for both report buckets.

## Publishing workflow and object lifecycle

1. Evidence is uploaded to `report-evidence` (private). 2. The report is reviewed and **approved** (approval alone
publishes nothing). 3. An administrator with `publish_reports` selects photos in the report drawer → each is
downloaded server-side, **stripped of EXIF/XMP/IPTC metadata (GPS, camera, comments; only JPEG orientation is kept)**,
measured, and uploaded to `public-report-images` under a new random name. 4. The administrator publishes the report.
5. `/api/public/reports` returns only approved + published reports and, for each, only the selected photos
(URL, alt text, width, height). Private paths, evidence IDs and file metadata are never returned.

| Event | Public objects |
|---|---|
| Select / replace / remove a photo | copied / new copy + old copy deleted / deleted |
| Unpublish, archive, owner edit of a published report, re-review after a material edit | **deleted** (selection kept; status "staged") |
| Publish again | copied again under **new** names — earlier public URLs never work again |
| Permanent deletion | everything in both buckets for the report is deleted and verified (PERMANENT_DELETION.md) |

Public copies are uploaded with `Cache-Control: public, max-age=300`, so a removed photo disappears from caches
within about five minutes. Uploads are written before their database row and removed again if the row cannot be
written, so failed operations do not leave untracked objects.

## Limits

Up to 10 evidence files per report (3 MB each; the portal compresses photos in the browser before upload) and up
to 8 public photos per report. Vercel's 4.5 MB request limit is why files are uploaded one request per file.
