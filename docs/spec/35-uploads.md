intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: File and image upload, storage, and serving system
  action: Defines upload mechanisms (button, drag-drop, paste), constraints (size, type, count), upload flow, chat display (inline images, download rows), lightbox, error handling, storage structure, path traversal protection, access control, and file cleanup on room deletion

| | |
|---|---|
| **Layer** | Cross-Cutting |
| **Status** | aktuell |
| **spec_version** | 1.2.0 |
| **Konsumiert** | overview, 10-domain, 30-chat, 80-admin |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2): §35.2 magic-byte table updated to reflect multi-part WebP signature (RIFF at offset 0 + WEBP at offset 8), with multi-part-before-single-part check order (F-CSD-3501) — prior F-CSD-062 weak-magic bypass resolved in commit 9ff3aea. §35.3 step 5 corrected: transport is `fetch`, not XHR; progress plumbing is post-v1 (F-CSD-3502). §35.3 step 7 now documents the F-CSD-067 composer re-populate behavior (commit 04d2dd9) as current, with in-list `[ retry ]` as the remaining target state (F-CSD-3503). §35.8 closing sentence corrected — no separate admin room-delete route, single `DELETE /api/rooms/:roomId` endpoint handles both creator and admin (F-CSD-3505). §35.11 Client-Side Image Resize renumbered from duplicate §35.10 (F-CSD-3508); algorithm step 6 now documents the PNG → JPEG filename-extension rewrite (F-CSD-3506). F-CSD-3504 10MB guard bypass resolved in commit fba0821 (post-resize `MAX_FILE_SIZE` check — no spec change needed, code now matches). History: 2026-04-14 — Task 009 Batch 2 retroactive sync. |

## Was diese Spec beschreibt

This spec defines the file upload system: three upload mechanisms (button, drag-and-drop, clipboard paste), constraints (10 MB max, 5 files per message, content-type whitelist with magic byte validation), the upload flow with progress indicators, how images and files are displayed in chat (inline previews, lightbox, download rows), storage on the filesystem via bind mount, path traversal protection, auth-protected file serving, and file cleanup when rooms are deleted.

---

# 35. File & Image Uploads (Normative)

## 35.1 Upload Mechanisms

<!-- DIM-Map §35.1 Upload Mechanisms
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

Three ways to attach files to a message:

1. **Button**: Attach button next to the message input. Rendered as the ASCII
   glyph `+F` (terminal-style, not a paperclip image). Opens the native file
   picker via a hidden `<input type="file" multiple accept="...">` where the
   `accept` attribute is populated from the allowed MIME whitelist (§35.2).
2. **Drag & Drop**: Drop target is the **message input area** (including its
   padding), not the entire chat area. Dragging files onto the message list
   itself is not a drop target. Visual feedback on drag-over:
   - The input area background shifts to `var(--bg-elevated)`.
   - A `1px dashed var(--accent)` box labeled `Drop files here` is rendered
     above the composer.
3. **Clipboard Paste**: `Ctrl+V` / `Cmd+V` in the message input. Only items
   whose MIME type starts with `image/` are captured (primarily screenshots).
   Non-image clipboard content is silently ignored.

Multiple files may be attached to a single message (up to the per-message cap
in §35.2).

## 35.2 Constraints

<!-- DIM-Map §35.2 Constraints
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

- **Max file size**: 10 MB per file
- **Max files per message**: 5
- **Allowed content types** (whitelist):
  - Images: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
  - Documents: `application/pdf`, `text/plain`
  - Archives: `application/zip`
  - Audio: `audio/mpeg`, `audio/ogg`
  - Video: `video/mp4`, `video/webm`

### Two-layer enforcement

Size and count limits are enforced at two server layers:

1. **Multipart parser layer** (`fastify-multipart`): configured with
   `limits: { fileSize: 10 * 1024 * 1024, files: 5 }`. Requests exceeding
   these limits are rejected by the plugin **before** reaching any application
   validator.
2. **Application validation layer** (`validateFile` + `validateFileCount` in
   `lib/uploads.ts`): after parsing, each file is re-checked for size, allowed
   content type, magic-byte match, and total count.

Either layer rejecting yields a 400 validation error.

### Magic-byte signatures

The server validates the declared Content-Type against the actual file content
using a fixed signature table:

| Content-Type          | Offset | Bytes                                         | Notes                           |
|-----------------------|--------|-----------------------------------------------|---------------------------------|
| `image/jpeg`          | 0      | `FF D8 FF`                                    |                                 |
| `image/png`           | 0      | `89 50 4E 47 0D 0A 1A 0A`                     |                                 |
| `image/webp`          | 0 + 8  | `52 49 46 46` (`RIFF`) + `57 45 42 50` (`WEBP`) | **Two-part signature.** RIFF container marker at offset 0 AND WEBP form-type marker at offset 8. Multi-part signatures are checked before single-part so a RIFF-only prefix (not actually WebP) is rejected. Hardened against the pre-9ff3aea weak-magic bypass (F-CSD-062). |
| `image/gif`           | 0      | `47 49 46 38` (`GIF8`)                        | covers GIF87a + GIF89a          |
| `application/pdf`     | 0      | `25 50 44 46` (`%PDF`)                        |                                 |
| `application/zip`     | 0      | `50 4B 03 04` (`PK\x03\x04`)                  |                                 |
| `audio/mpeg`          | 0      | `49 44 33` (`ID3`) OR `FF FB`                 | ID3 tag or MPEG-1 Layer-3 sync  |
| `audio/ogg`           | 0      | `4F 67 67 53` (`OggS`)                        |                                 |
| `video/mp4`           | 4      | `66 74 79 70` (`ftyp`)                        | ISO base-media `ftyp` box       |
| `video/webm`          | 0      | `1A 45 DF A3`                                 | EBML / Matroska header          |

### `text/plain` exemption

Files declared `text/plain` **skip** magic-byte validation (no reliable plain-
text signature exists). Only the size limit and the Content-Type whitelist are
enforced; any byte sequence up to 10 MB can be uploaded as `text/plain`.

### Filename sanitization

Filenames are sanitized server-side by `sanitizeFilename()`:

- Path separators `/` and `\` are replaced with `_`.
- Control characters `0x00`–`0x1F` and `0x7F` are stripped.
- `..` sequences are replaced with `_`.
- Leading/trailing whitespace is trimmed.
- If the result is empty, falls back to the literal `file`.
- The name is truncated to **200 characters**, preserving the extension.

Sanitization is invoked twice per attachment:
1. Once in `routes/messages.ts` before the `Attachment` DB row is created
   (the sanitized value is what `Attachment.filename` — VarChar(200) — stores).
2. Once again inside `storeFile()` to build the on-disk filename
   `{attachmentId}_{sanitized}`. The second pass is a no-op in practice because
   the input is already sanitized; it exists as defense-in-depth.

## 35.3 Upload Flow

<!-- DIM-Map §35.3 Upload Flow
  Completeness:        Partial — progress-bar surfacing is open (CGL-ledger)
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

1. User attaches file(s) via any mechanism (35.1).
2. Attached files appear as preview chips below the message input:
   - **Images**: 36×36 thumbnail with `object-fit: cover`, `borderRadius: 0`,
     generated via `URL.createObjectURL()` (revoked on removal).
   - **Other files**: ASCII `[]` glyph as file icon, followed by filename +
     formatted size.
   - Each chip has a remove button rendered as the lowercase ASCII `x`
     (text color `--text-muted`, hover color `--error`).
3. User types optional text and presses Enter (or clicks Send). Send is gated
   on `content.trim() || files.length > 0` (empty-empty send is rejected).
4. Client sends message via `POST /api/messages` as `multipart/form-data`:
   - Text fields (may be empty if only files).
   - File(s) as binary `file` parts.
5. Progress is not plumbed in v1 — the client uses `fetch`, which does
   not expose upload progress. A per-file progress bar is the target
   state per this spec (switching to `XMLHttpRequest` or streams +
   progress events is part of that work — see §35.9 AC).
6. On success: message appears in chat with inline attachments.
7. On failure (network / validation) — **current (post-F-CSD-067,
   commit 04d2dd9)**: the composer re-populates content + files so
   the user can adjust and re-send manually. No in-list error row is
   rendered for file-bearing sends (unlike text-only sends, which do
   get an in-list `[ retry ]` row — see 30-chat §30.4 Optimistic Send
   Failure).
   **Target state (future)**: message marked with error indicator +
   in-list `[ retry ]` button, consistent with text-message retry (see
   25-websocket.md §25.7). See §35.9 AC.

## 35.4 Display in Chat

<!-- DIM-Map §35.4 Display in Chat
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

### Images

- Inline preview: `max-width: 400px`, `max-height: 300px`,
  `object-fit: contain`.
- `1px solid var(--border-default)` border.
- `loading="lazy"` on the `<img>` (defers off-screen loads).
- `cursor: pointer`; `borderRadius: 0` (TTY constraint).
- Click opens Lightbox (see §35.5).
- GIF: plays inline, no autoplay controls needed (small group, trust-based).
- Multiple images in one message: displayed vertically stacked
  (`flex-direction: column`, `gap: var(--space-2)`).

### Other Files

Rendered as a single `<a download>` row (click triggers browser download):

- `1px solid var(--border-default)` border, `borderRadius: 0`,
  `background: var(--bg-surface)`, `max-width: 400px`.
- Hover: border transitions to `var(--accent-dim)` over 150 ms.
- Layout left-to-right:
  1. ASCII `[]` glyph as file icon (color `--text-secondary`).
  2. Middle block stacked: filename (truncated with ellipsis) + formatted size
     (color `--text-muted`).
  3. Right-aligned `DL` marker in `--accent` color (indicates download).
- No per-type icons in v1.
- No inline preview for non-image files in v1.

### Mixed Content

A message may contain text + files. Display order: text first, then
attachments below.

## 35.5 Lightbox

<!-- DIM-Map §35.5 Lightbox
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

Clicking an inline image preview opens a Lightbox overlay:

- Image displayed at native resolution, constrained to viewport
  (`max-width: 90vw`, `max-height: 90vh`, `object-fit: contain`).
- Backdrop: semi-transparent dark overlay (`rgba(0, 0, 0, 0.85)`).
- **Close**: click backdrop, press `Escape`, or click `[ x ]` button top-right.
- Clicking the **image itself** is a no-op — `onClick` calls
  `e.stopPropagation()`; only the backdrop, `Escape`, and the `[ x ]` button
  close the lightbox.
- **Navigation**: when the scope contains more than one image, prev/next
  buttons appear on the sides. Navigation rules:
  - **Boundary-hide**: the prev button is hidden at `currentIndex === 0`;
    the next button is hidden at `currentIndex === images.length - 1`. No
    wrap-around.
  - Button glyphs: prev renders the ASCII `<`, next renders the ASCII `>`
    (single angle brackets).
  - Arrow keys (`ArrowLeft` / `ArrowRight`) also navigate.
- **Counter**: when more than one image is in scope, a `current / total`
  counter (1-indexed) is rendered below the image
  (color `--text-secondary`, font-size `--text-sm`).
- No border-radius, no drop shadows (TTY constraint).
- No zoom in v1 — native resolution only.

### Navigation scope

The lightbox image set is built by `collectAllImages(messages)`, which
iterates every **non-tombstone** message currently rendered in the message
list and collects all `image/*` attachments across those messages. This
means:

- The scope is the **client-side loaded history** (whatever pages the client
  has fetched + any newly arrived messages), **not** the full server-side
  conversation history.
- Ordering follows the message order in the list (oldest→newest as rendered).
- Images inside tombstoned (soft-deleted) messages are excluded.

## 35.6 Error Handling

<!-- DIM-Map §35.6 Error Handling
  Completeness:        Partial — file-attached retry UX is open (CGL-ledger)
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

- **File too large**: Inline error below message input:
  `File exceeds 10 MB limit: {filename}` — the offending file is not attached;
  other files in the same selection batch continue to be evaluated.
- **Invalid file type**: Inline error:
  `File type not allowed: {filename}` — the offending file is not attached;
  other files in the same selection batch continue to be evaluated.
- **Too many files**: Inline error: `Maximum 5 files per message`. When the
  existing+combined count reaches 5, the remaining files in the current
  selection batch are silently dropped (loop `break`).
- **Upload failure (network)**: Message shows error state with `[ retry ]`
  button (same as regular message failure, see `25-websocket.md` §25.7).
  Target state — see §35.9 AC.
- **Server rejection (validation)**: Error message displayed; files not stored.

### Mixed-batch behavior

When a single selection batch (button pick, drag-drop, paste) contains a mix
of valid and invalid files:

- Valid files **are** still attached (loop uses `continue` on size/type errors).
- Each invalid file is skipped individually; only the **last** error message
  from the batch is surfaced in the inline error row.
- Once the 5-file cap is reached (`combined.length >= MAX_FILES`), the loop
  `break`s and any remaining files in the batch are silently dropped (the
  `Maximum 5 files per message` error is surfaced for the first overflow).

## 35.7 Storage

<!-- DIM-Map §35.7 Storage & Serving
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

### Uploads base directory resolution

The container uploads root is resolved in this order:

1. `UPLOAD_DIR` env var (preferred).
2. `UPLOADS_DIR` env var (legacy alias, still honored).
3. Fallback: `path.join(process.cwd(), 'uploads')`.

Runtime bindings:
- **Dev**: no env set → `{cwd}/uploads` (local directory).
- **Prod docker**: `UPLOAD_DIR=/data/uploads`, with a bind mount from
  `${UPLOAD_HOST_DIR:-./data/uploads}` on the host to `/data/uploads` in the
  container (see `docker-compose.yml`).

### Storage structure

```
{UPLOAD_DIR}/{year}/{month}/{attachment_id}_{sanitized_filename}
```

Example: `/data/uploads/2026/03/abc123_screenshot.png`

`year` is the 4-digit year, `month` is zero-padded 2-digit month, both from
the server clock at the time of `storeFile()`.

### Serving

- Route: `GET /api/uploads/:attachmentId/:filename`
- Auth-protected via `requireAuth` preHandler — a valid session cookie is
  required (same as all API routes).
- Lookup-by-ID: the DB row for `:attachmentId` resolves to a trusted
  `storagePath`; the `:filename` URL segment is used only for display and is
  **not** used to build the disk path.
- Response body is a readable stream from the resolved absolute path.

### Response headers

| Header                    | Value                                                                     |
|---------------------------|---------------------------------------------------------------------------|
| `Content-Type`            | `attachment.contentType` (from DB)                                        |
| `Content-Disposition`     | `inline; filename="<url-encoded>"` for `image/*`, `attachment; ...` else  |
| `Cache-Control`           | `private, max-age=86400` (24h private cache)                              |
| `X-Content-Type-Options`  | `nosniff`                                                                 |

Notes:
- `Content-Disposition` splits on the `image/*` prefix: images render inline
  in the browser, everything else forces a download.
- The filename parameter is URL-encoded (`encodeURIComponent`) and wrapped in
  double quotes (e.g. `filename="screenshot.png"`). **This is not RFC 6266
  compliant** (no `filename*=UTF-8''...` form); non-ASCII filenames may
  display with percent-escapes in some browsers. Acceptable for v1.

### Path Traversal Protection (Normative)

The disk path served by `GET /api/uploads/:attachmentId/:filename` is
constructed exclusively from the DB-resolved `storagePath`; the `:filename`
URL segment is never concatenated into the path. `getAbsolutePath(storagePath)`
re-validates defensively: it calls `path.resolve(base, storagePath)` and
asserts that the result either starts with `path.resolve(base) + path.sep`
or exactly equals `path.resolve(base)`. Any violation throws
`Error('Path traversal detected')`.

**Failure semantics**: a thrown traversal error surfaces as an unhandled 500
(not a 400). This is acceptable because:
- Classic `../../etc/passwd`-style URL inputs cannot reach the filesystem
  (the URL filename is not used to build the path).
- The throw would only fire on a corrupted `storagePath` DB row — an
  operator-fix situation, not a user-facing flow.

### Access Control

File serving requires a valid session and scope-based access:

- **Room uploads**: the requesting user must have a `GroupMembership` for the
  message's `scopeId`. Denied (403) when the membership is missing or in
  state `not_joined`. State `joined` and `left` both retain read access —
  left members keep read access to history including uploaded files.
- **DM uploads**: the requesting user must be a participant of the
  `DirectConversation` (`participantAId` or `participantBId`). Non-
  participants are denied (403).

This ensures uploaded files are only accessible to users who have (or had)
access to the conversation where the file was posted.

## 35.8 File Deletion & Cleanup

<!-- DIM-Map §35.8 File Deletion & Cleanup
  Completeness:        Partial — DM cleanup is explicitly absent in v1; documented
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

Files cannot be individually deleted by users in v1.

### Room Deletion File Cleanup (Normative)

When a room is deleted (by its creator via `DELETE /api/rooms/:id` or by an
admin via the admin route), the server follows this sequence:

1. **Before the transaction**: query all `Attachment` rows belonging to
   messages in the room (`where: { message: { scopeType: 'room', scopeId } }`)
   and collect their `storagePath` values (filtering out falsy values).
2. **DB transaction**: `message.deleteMany` → `groupMembership.deleteMany` →
   `room.delete`. `Attachment` and `Reaction` rows cascade-delete via the
   message FK.
3. **After the transaction commits**: iterate the collected `storagePath`
   values and call `unlink(getAbsolutePath(storagePath)).catch(() => {})` for
   each.
   - The unlink is **fire-and-forget** — no `await`, no sequencing guarantees.
   - Errors are **silently swallowed** (no logging in v1; divergence from
     the original intent "errors are logged").
   - If the process crashes between commit and unlink, files can become
     orphans on disk; admin can clean them up via filesystem access.

A single `DELETE /api/rooms/:roomId` route handles both creator-
initiated and admin-initiated deletion (the route accepts either the
room creator or any admin). There is no separate admin delete endpoint.

### DM Attachment Cleanup (v1 Gap)

DirectConversations have **no deletion flow** in v1:

- There is no server-side `DELETE /api/direct/:id` endpoint.
- DM attachment files are **retained indefinitely**. DM storage grows
  monotonically with upload volume.

### Soft-Deleted Messages Retain On-Disk Files

`DELETE /api/messages/:id` is a **soft delete**: it sets `deletedAt` +
`deletedBy` and leaves the `Attachment` rows intact on disk:

- `mapMessageToResponse` returns `attachments: []` for tombstoned messages
  (the client sees no attachments on a tombstone).
- However the `Attachment` rows and their on-disk files **persist**.
- `GET /api/uploads/:attachmentId/:filename` does **not** check tombstone
  state — an authorized user (same membership/participant rules as §35.7)
  who retains a known attachment ID can still fetch the file after the
  parent message has been tombstoned.
- This is intentional within v1 scope (keeps deletion cheap and reversible
  at the DB layer); admin can clean up orphaned files via filesystem access.

## 35.11 Client-Side Image Resize

> **Note on numbering:** this section appears before §35.9 / §35.10 in
> file order; it was renumbered from §35.10 to §35.11 on 2026-04-24 to
> resolve a duplicate `§35.10` heading introduced by the T-030
> migration. File order is preserved for git-blame continuity; the
> normative numbering is the heading.

### When

After file selection, before the file is added to the attachment chip.
The user sees the post-resize file size in the chip.

### Which Files

- **Processed:** `image/jpeg`, `image/png`, `image/webp` — only when >1 MB.
- **Skipped:** `image/gif` (animation must be preserved), all non-image types,
  and images ≤1 MB.

### Algorithm

1. Load the image into an `HTMLImageElement` via `URL.createObjectURL`.
2. Read natural dimensions (`naturalWidth`, `naturalHeight`).
3. **Dimension reduction:** if either dimension exceeds 2048px, scale
   proportionally so the largest dimension equals 2048px.
   - iOS Safari canvas limit: ~16 megapixels. If `width * height > 16_777_216`
     after step 3, reduce further until within the limit.
4. Create a `<canvas>` at the target dimensions. Draw the image with
   `drawImage(img, 0, 0, targetWidth, targetHeight)`.
5. **Export with quality loop:**
   - JPEG source → `canvas.toBlob('image/jpeg', quality)`, start at 0.92.
   - WebP source → `canvas.toBlob('image/webp', quality)`, start at 0.92.
   - PNG source → `canvas.toBlob('image/png')` first (no quality param).
     If result >1 MB → fallback to `canvas.toBlob('image/jpeg', 0.85)`.
     PNG-to-JPEG conversion loses transparency. This is accepted as a
     trade-off; transparent PNGs >1 MB are rare in chat usage.
   - If output >1 MB: reduce quality by 0.05, retry. Minimum quality: 0.5.
   - If still >1 MB at quality 0.5: accept the result (do not over-compress).
6. Wrap the Blob in a `new File(blob, filename, { type: blob.type })`.
   **Filename on format change**: when a resize transcodes to a
   different format (PNG → JPEG in the fallback path), the filename
   extension is rewritten via regex `/\.[^.]+$/ → '.jpg'` so the
   extension matches the actual output content-type. The original
   filename stem is preserved. E.g. `screenshot.png` that compressed
   as JPEG is returned as `screenshot.jpg` with `type: 'image/jpeg'`.
7. Revoke the object URL from step 1.

### Threshold

1 MB = 1,048,576 bytes (`1024 * 1024`). This matches how browsers report
`File.size`.

### Feedback

While resize is in progress, the attachment chip shows `"Resizing..."` in
place of the file size. No progress bar (resize is typically <1 second).

### Error Handling

| Failure | Handling |
|---------|----------|
| Image fails to load (corrupt file, unsupported format) | Show error: `"Could not process image"`. File is NOT added. |
| Canvas creation fails (out of memory, iOS limit) | Keep original file unchanged. Show warning: `"Image too large to resize, uploading original"`. |
| `toBlob` returns null (unsupported format, e.g. WebP on old Safari) | Retry as JPEG. If JPEG also fails: keep original file. |

### Function Signature

```typescript
// src/client/src/lib/imageResize.ts
export async function resizeImage(file: File): Promise<File>;
```

Returns the original file unchanged if ≤1 MB or if it's a GIF. Returns a
resized File otherwise. Throws on unrecoverable error (caller catches and
shows error message).

## 35.9 Acceptance Criteria

- [ ] Files can be attached via button, drag & drop, and clipboard paste
- [ ] File size limit (10 MB) enforced client-side, by the multipart parser,
      and by the post-parse application validator
- [ ] File-count limit (5) enforced client-side, by the multipart parser, and
      by the post-parse application validator
- [ ] Content-type whitelist enforced server-side with magic byte validation
      for all whitelisted types except `text/plain`
- [ ] Images display inline with correct max dimensions and `loading="lazy"`
- [ ] Lightbox opens on image click with backdrop, close, and navigation
- [ ] Lightbox shows `N / Total` counter and hides prev/next at boundaries
- [ ] Non-image files display as download rows with `DL` marker
- [ ] Upload progress shown per file (target state — see CGL)
- [ ] Failed uploads show `[ retry ]` button in message list (target state —
      see CGL for file-attached sends)
- [ ] Files are served auth-protected
- [ ] Multiple files per message supported (up to 5)
- [ ] No border-radius on any upload-related UI element

## 35.10 Failure Modes

| Failure                                         | Layer                    | Behavior                                                           |
|-------------------------------------------------|--------------------------|--------------------------------------------------------------------|
| File > 10 MB                                    | Client                   | Inline error, file not attached                                    |
| File > 10 MB (client bypassed)                  | Multipart parser         | 400, request rejected before validator                             |
| File > 10 MB (post-parse)                       | Application validator    | 400 `FILE_TOO_LARGE`                                               |
| > 5 files in selection batch                    | Client                   | Silent drop after cap, inline error for first overflow             |
| > 5 files in request (bypass)                   | Multipart parser         | 400, request rejected before validator                             |
| > 5 files in request (post-parse)               | Application validator    | 400 `TOO_MANY_FILES`                                               |
| MIME not whitelisted                            | Application validator    | 400 `INVALID_TYPE`                                                 |
| Declared/detected MIME mismatch                 | Application validator    | 400 `MAGIC_MISMATCH` (except `text/plain`, which is exempt)        |
| Unrecognized magic bytes                        | Application validator    | 400 `MAGIC_MISMATCH`                                               |
| Filename with path sep / control chars / `..`   | Application (sanitize)   | Sanitized; upload proceeds                                         |
| Filename empty after sanitization               | Application (sanitize)   | Falls back to literal `file`; upload proceeds                      |
| Filename > 200 chars                            | Application (sanitize)   | Truncated preserving extension                                     |
| Upload request interrupted (network)            | Client                   | `MessageInput` re-populates content + files (target: `[ retry ]`)  |
| Uploaded attachment not found in DB             | Serving route            | 404 `NOT_FOUND`                                                    |
| Uploaded file missing on disk                   | Serving route            | 404 `NOT_FOUND` (`File not found on disk`)                         |
| Requester lacks membership or is `not_joined`   | Serving route (room)     | 403 `FORBIDDEN`                                                    |
| Requester is not a DM participant               | Serving route (direct)   | 403 `FORBIDDEN`                                                    |
| Corrupted `storagePath` escaping uploads base   | `getAbsolutePath`        | Throws `Path traversal detected` → unhandled 500                   |
| Room delete: unlink fails post-commit           | Room-delete cleanup      | Silently swallowed; file orphaned; DB delete stands                |
| Process crashes between commit and unlink loop  | Room-delete cleanup      | File orphaned; admin filesystem cleanup                            |
| DM containing attachments                       | (No DM delete in v1)     | Files retained indefinitely                                        |
| Message soft-delete                             | Tombstone route          | `Attachment` rows + files retained; hidden in list, still fetchable|
