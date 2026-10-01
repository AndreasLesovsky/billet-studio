# billet-studio API contract

Single source for request/response shapes shared by `billet-studio-rest-service` and
`billet-studio-frontend`. Backend DTOs and frontend `core/models/*Dto.ts` mirror this file 1:1.
Base URL: `/v1`. Times are ISO-8601 UTC instants. All errors use `ApiError`.

## Errors

```
ApiError { errorCode: string (UPPER_SNAKE), status: number, timestamp: string }
```

Codes (frontend has one `MESSAGES.ERROR.<CODE>` key per code, de + en):
`UNAUTHORIZED` 401, `ACCESS_DENIED` 403, `NOT_FOUND` 404 (unknown route), `METHOD_NOT_ALLOWED` 405,
`VALIDATION_ERROR` 400, `MALFORMED_REQUEST` 400, `EMAIL_ALREADY_EXISTS` 409, `USER_NOT_FOUND` 404,
`INVALID_TOKEN` 400, `TOKEN_EXPIRED` 400, `RATE_LIMIT_EXCEEDED` 429, `ACCOUNT_ALREADY_DEACTIVATED` 409,
`INVALID_PASSWORD` 400, `PASSWORD_MISMATCH` 400, `CANNOT_DELETE_SELF` 403, `CANNOT_DEACTIVATE_SELF` 403,
`ROOT_USER_PROTECTED` 403, `ROLE_NOT_FOUND` 500, `FILE_TOO_LARGE` 413, `FILE_UPLOAD_ERROR` 400,
`INVALID_FILE_TYPE` 400, `CONCURRENT_MODIFICATION` 409, `DATA_INTEGRITY_ERROR` 409,
`INTERNAL_SERVER_ERROR` 500.
Billet codes (phase P2): `BILLET_NOT_FOUND` 404, `BILLET_LIMIT_REACHED` 409,
`BILLET_MODIFIED_ELSEWHERE` 409, `UNSUPPORTED_SCHEMA_VERSION` 400, `UNKNOWN_MODEL` 400,
`MODEL_NOT_FOUND` 404.
Assistant codes (phase A2): `ASSIST_UNAVAILABLE` 503.

No account-state enumeration: login answers every failure (unknown email, wrong password, locked,
deactivated past grace) with the identical 401 `UNAUTHORIZED` body; forgot-password always 200.
Accepted exception: register answers 409 `EMAIL_ALREADY_EXISTS` (sign-up UX), rate-limited.

## Shared rules

- Password (register, reset, change, admin set): min 8 chars, max 72 UTF-8 bytes (BCrypt limit),
  at least one lowercase, one uppercase, one digit. Login only requires non-blank.
- Display name: max 30 chars, `^\p{L}+(?:[ '\-]\p{L}+)*$` (UserNameRules).
- `preferredLanguage`: `de` | `en`.
- Roles: `ROLE_USER` (id 1), `ROLE_ADMIN` (id 2).
- `DeactivationReason`: user actor `NOT_NEEDED_ANYMORE`, `PRIVACY_CONCERNS`, `TOO_COMPLICATED`,
  `OTHER_SERVICE`, `OTHER`; admin actor `SPAM`, `FRAUD`, `TERMS_VIOLATION`, `ABUSE`, `SECURITY_RISK`.
  Each side may only send its own values (else `VALIDATION_ERROR`).
- Request bodies are capped before parsing: 16 KiB for every JSON body outside `/v1/billets` (its caps
  are listed there), a declared `Content-Length` refused unread, a chunked body cut off at the cap. The
  JSON parser refuses a string over 65 536 characters, nesting deeper than 32 levels and a body over
  the import cap. All of these answer 400 `VALIDATION_ERROR`.
- Rate limits count per client IP and endpoint; an IPv6 client counts by its /64 prefix.

## DTOs

```
UserWithTokenDto { id: number, name: string, email: string, accessToken: string, role: string,
                   reactivated: boolean, avatarUrl: string | null, expiresInSeconds: number }
UserResponseDto  { id, name, email, role, preferredLanguage, avatarUrl: string | null, active: boolean,
                   protectedAccount: boolean, deactivatedAt: string | null,
                   deletionScheduledAt: string | null, deactivationReason: string | null,
                   createdAt: string, updatedAt: string }
UserRequestDto   { name, email, password (empty on admin edit = keep), role, preferredLanguage,
                   active: boolean, deactivationReason: string | null }
RegisterRequestDto { name, email, password, preferredLanguage }
AccountDto       { id, name, email, role, preferredLanguage, avatarUrl: string | null, createdAt }
AccountUpdateDto { name, preferredLanguage }
PasswordChangeDto { currentPassword, newPassword, confirmPassword }
DeactivateAccountRequestDto { password, reason: DeactivationReason | null }
PageDto<T>       { rows: T[], totalRows: number, page: number, size: number }
```

## Auth — `/v1/auth` (public)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/login` | `{ email, password }` | 200 `UserWithTokenDto` + `Set-Cookie: refresh_token` (HttpOnly, Secure, SameSite=Strict, Path=/v1/auth) |
| POST | `/refresh` | — (cookie) | 200 `UserWithTokenDto`, 401 when the session is gone |
| POST | `/logout` | — (cookie) | 204, cookie cleared |
| POST | `/register` | `RegisterRequestDto` | 201 `UserResponseDto` (no auto-login; client logs in afterwards) |
| POST | `/forgot-password` | `{ email }` | 200 always |
| POST | `/reset-password` | `{ token, newPassword, confirmPassword }` | 204 |

Access token: JWT HS512, 15 min, in memory only; `Authorization: Bearer`. The JWT filter never runs on
`/v1/auth/login|refresh|logout`. Sessions: user 14 d idle / 90 d absolute, admin 30 min / 12 h.
`expiresInSeconds` = time to the earlier deadline.

## Account — `/v1/account` (authenticated)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `` | — | 200 `AccountDto` |
| PUT | `` | `AccountUpdateDto` | 200 `AccountDto` |
| POST | `/change-password` | `PasswordChangeDto` | 204 + new `Set-Cookie: refresh_token` (all other sessions ended) |
| POST | `/deactivate` | `DeactivateAccountRequestDto` | 204 (all sessions ended; login within 30 days reactivates) |
| POST | `/avatar` | multipart, field `image` (jpg/png/gif/bmp/webp/avif, max 20 MB) | 200 `AccountDto` |
| DELETE | `/avatar` | — | 200 `AccountDto` |

Avatar files are served from `/uploads/avatars/...` (public, relative URL in `avatarUrl`).

## Users (admin) — `/v1/users` (ROLE_ADMIN)

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `` | `?page=0&size=20&q=&active=&sort=createdAt,desc` (`q` matches name or email, `active` = true/false/empty; sort fields `name`, `email`, `createdAt`, `role`) | 200 `PageDto<UserResponseDto>` |
| GET | `/roles` | — | 200 `string[]` |
| GET | `/{id}` | — | 200 `UserResponseDto` |
| POST | `` | `UserRequestDto` | 201 `UserResponseDto` |
| PUT | `/{id}` | `UserRequestDto` | 200 `UserResponseDto` |
| PATCH | `/{id}/active` | `{ reason: DeactivationReason \| null }` | 200 `UserResponseDto` (toggles) |
| DELETE | `/{id}` | — | 204 |

Protected (root) accounts refuse update/toggle/delete with 403 `ROOT_USER_PROTECTED`.

## Billets, models, public — phase P2

`BilletDocument` is defined in [billet-document.md](billet-document.md).

```
ModelDefaultsDto  { fitSize, yOffset, exposure, cameraDistance, cameraHeight, autoRotateSpeed }  (numbers)
ModelDto          { slug, nameDe, nameEn, occasion, fileUrl, previewUrl, fileSizeBytes, credit: string | null,
                    active: boolean, defaults: ModelDefaultsDto }
                  fileUrl / previewUrl = app.models.base-url + file_path / preview_path (absolute URLs)
BilletSummaryDto  { id, title, theme: string | null, modelSlug: string | null, previewUrl: string | null,
                    published: boolean, hasUnpublishedChanges: boolean, shareToken: string | null,
                    publishedAt: string | null, createdAt, updatedAt }
BilletDetailDto   { id, version: number, document: BilletDocument, model: ModelDto | null, published: boolean,
                    hasUnpublishedChanges: boolean, shareToken: string | null, publishedAt: string | null,
                    createdAt, updatedAt }
BilletCreateRequest { document: BilletDocument }
BilletSaveRequest   { version: number, document: BilletDocument }
BilletSaveResponse  { version: number, updatedAt: string, hasUnpublishedChanges: boolean }
PublishRequest      { version: number }
PublishResponse     { shareToken: string, publishedAt: string, version: number }
BilletImportRequest { documents: BilletDocument[] }            (1..20)
BilletImportResponse { billets: BilletSummaryDto[] }
PublicBilletDto     { document: BilletDocument, model: ModelDto | null, publishedAt: string }
```

- `published` = `published_document` not null. `hasUnpublishedChanges` = published and the normalized
  draft JSON differs from the snapshot.
- `model` is resolved from `document.scene.modelSlug` (also inactive models) when `scene.enabled`,
  else null. A slug that does not exist on write → 400 `UNKNOWN_MODEL`.
- `BilletSummaryDto.theme` is the draft's `document.theme` (stored beside the document, like `title`
  and `modelSlug`); null only for a billet stored before that column existed and not backfilled.
- The share link is built by the frontend: `<frontendUrl>/b/<shareToken>`.

### `/v1/billets` (authenticated, owner only — another user's id is always 404 `BILLET_NOT_FOUND`)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `` | — | 200 `BilletSummaryDto[]` (newest `updatedAt` first) |
| POST | `` | `BilletCreateRequest` | 201 `BilletDetailDto`; 409 `BILLET_LIMIT_REACHED` beyond `app.billet.max-per-user` |
| GET | `/{id}` | — | 200 `BilletDetailDto` |
| PUT | `/{id}` | `BilletSaveRequest` | 200 `BilletSaveResponse`; stale `version` → 409 `BILLET_MODIFIED_ELSEWHERE` |
| DELETE | `/{id}` | — | 204 |
| POST | `/{id}/duplicate` | — | 201 `BilletDetailDto` (title + " (Kopie)"/" (copy)" by user language, never published) |
| POST | `/{id}/publish` | `PublishRequest` | 200 `PublishResponse`; snapshot = current draft; token minted on first publish, reused after |
| POST | `/{id}/unpublish` | — | 204 (snapshot cleared, token kept) |
| POST | `/import` | `BilletImportRequest` | 201 `BilletImportResponse`; all-or-nothing; limit counts the whole batch |

Rate limits (per IP): create 30/h, import 5/h, publish 30/h, duplicate 30/h.
Document size cap `app.billet.max-document-bytes` (default 256 KiB) → 400 `VALIDATION_ERROR`.
Request bodies over 2 × `max-document-bytes` (import: × 20) are refused before parsing (400
`VALIDATION_ERROR`). Bodies are `application/json` only. Concurrent first publishes of one billet
are serialised, so a billet only ever gets one share token.

### `/v1/models` (public)

| Method | Path | Response |
|---|---|---|
| GET | `` | 200 `ModelDto[]` — active only, ordered by `position` |
| GET | `/{slug}` | 200 `ModelDto` (also inactive) / 404 `MODEL_NOT_FOUND` |

### `/files/models/**` (public, static, optional)

Outside `/v1`: the model files themselves, served only while `app.models.directory`
(`MODELS_DIRECTORY`) is set; `app.models.base-url` then points at `https://<api-host>/files/`
(README "Modelle vom Backend ausliefern"). GET only; `.glb` (`model/gltf-binary`) and `.webp`
(`image/webp`), `Cache-Control: max-age=31536000, public, immutable`, CORS as for the API. Any
other file, or no directory configured: 404 `NOT_FOUND`; a path with `..` (also encoded): 400.

### `/v1/public/billets` (public)

| Method | Path | Response |
|---|---|---|
| GET | `/{shareToken}` | 200 `PublicBilletDto` (the published snapshot) / 404 `BILLET_NOT_FOUND` when unknown or unpublished — identical body |

A link works only while its owner's account is active: an admin lock or a self-deactivation (also
during the 30-day grace period before deletion) answers the same 404 `BILLET_NOT_FOUND`, and
reactivating the account (login within the grace period, an admin unlock) restores its links with
their tokens. Deleting the account deletes its billets.

Rate limit 120/min per IP. Response header `X-Robots-Tag: noindex`.

## Billet assistant — `/v1/assist` (public), phase A2

The questionnaire, its labels and the prompt rules are in [assist.md](assist.md). The model only picks
labels; every text the user sees comes from the frontend's i18n.

```
AssistStatus    READY | IDLE | OFFLINE | DISABLED
AssistStatusDto { status: AssistStatus }
AssistBilletDto { template, theme, particles, divider, colorMode, lang, model }   (labels, see assist.md)
AssistTurnDto   { role: 'user' | 'assistant', content: string | null, billet: AssistBilletDto | null }
AssistRequest   { conversation: AssistTurnDto[] }                                  (1..10, oldest first)
AssistReply     { billet: AssistBilletDto, notes: string[] }
```

- A user entry holds `content` (1..300 characters, no control characters but `\n`) and no `billet`; an
  assistant entry holds a `billet` and no `content`; the last entry is the user's new message. A billet
  label outside the questionnaire (KEEP and NOT_SUPPORTED included; for `model` any slug-shaped value
  is accepted) → 400 `VALIDATION_ERROR`.
- `notes`: `OFF_TOPIC` (the message is not about a billet; `billet` unchanged), `NOTHING_RECOGNISED`
  (first message, nothing recognised: the blank start), `NO_CHANGE`, `PARTICLES_NOT_SUPPORTED`,
  `MODEL_NOT_SUPPORTED` (the value stays as it was).
- `status`: READY = the model is loaded, IDLE = it is there but the first answer waits for it to load,
  OFFLINE = the model server does not answer or lacks the model, DISABLED = `app.assist.enabled` is
  false. Never loads the model; cached for 10 s.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/status` | — | 200 `AssistStatusDto` (`Cache-Control: no-store`) |
| POST | `/warm-up` | — | 202; starts loading the model (no-op while DISABLED) |
| POST | `` | `AssistRequest` | 200 `AssistReply`; 503 `ASSIST_UNAVAILABLE` (switched off, model server down, too slow, unusable answer); 429 `RATE_LIMIT_EXCEEDED` when another answer still runs after `app.assist.timeout` |

Rate limits (per IP): status 120/min, warm-up 20/h, questions `app.assist.rate-limit` (default 20 per
10 min). A stale bearer token is ignored, as on the other public routes.
