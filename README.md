# Slate Notes v2

STABLE VERSION: [AlexAilend/slate-notes](https://github.com/AlexAilend/slate-notes)

NEW VERSION: [AlexAilend/slate-notes-v2](https://github.com/AlexAilend/slate-notes-v2)

Website: https://alexailend.github.io/slate-notes-v2/

The stable repository and its Pages settings are not deployment targets. The initial v2 copy has the exact stable source tree `95c576b8a13133852cf5b0ff02913cd433d85ca8` (stable commit `cf59ecade2d384444e2fb44f2e15933161a28b4d`).

## Architecture

Static HTML/CSS/JavaScript on GitHub Pages, with Supabase Auth and PostgreSQL. `banks.js` remains the authored source for FortiGate and FortiSIEM questions and exhibits. `app.js` extends the existing Slate Workspace interface; `auth.js` gates application startup on an authenticated active profile. The pinned Supabase JS client loads from the CDN in `index.html`.

Study retains navigation, search, wrong/unanswered filters, random questions, checking and exhibits. Exam supports any whole question count from 1 through the selected bank size, independent question/answer shuffling, fixed per-session option IDs, navigation, local recovery and cloud resume. Ordering questions retain their own ordering logic. Notes remain source metadata and are not rendered. FortiSIEM Q69 is B; Q74 remains B+C.

Finished exams retain every answer, question position, option order, original question snapshot, duration and shuffle settings. History opens the full review with All/Correct/Incorrect filters and retry incorrect. Statistics are calculated from completed cloud attempts. Study progress is browser-local and scoped by user; exam history is cloud-backed.

## Authentication and roles

Email/password authentication uses Supabase Auth, with persistent refreshable sessions. Create account requires email confirmation according to project Auth settings. Passwords are never stored in this repository. Set the Supabase Auth Site URL and allowed redirect to `https://alexailend.github.io/slate-notes-v2/` before onboarding users.

Profiles are provisioned by a database trigger with role `user`. Admin authorization uses the protected `profiles.role` column, never user metadata. An administrator must explicitly verify the intended owner email before populating the private owner identity table. No owner email or admin password is shipped. The confirmation trigger promotes only a confirmed matching owner. Existing confirmed accounts require an explicit privileged role update after identity approval. Do not grant clients role update permissions.

## Database and RLS

Version-controlled migrations live in `supabase/migrations/`:

- `profiles`: Auth UUID, email, display name, protected role, created/last-seen dates and active status.
- `exam_attempts`: owner, bank, mode, timing, aggregates, shuffle settings and session snapshot.
- `exam_answers`: owned attempt, stable question/option IDs, selections, trusted correctness, order and question snapshot.
- Private tables hold scoring keys derived from banks.js and the approved owner identity.

All public tables have RLS. Authenticated active users can read only their own rows; admins can read all rows. Profile updates are column-limited. Attempt writes require matching auth.uid() with USING and WITH CHECK for updates, and completed attempts cannot be edited by clients. Answers and final scores are written atomically through the finish RPC; the database recalculates correctness from protected keys. Private functions fix search_path and restrict execution. Clients cannot change roles, submit another owner's records, or directly set final scores.

Question banks are intentionally public static learning material. This application is not a secure high-stakes exam/proctoring platform: users can inspect public answer banks. RLS protects personal data and the backend prevents fabricated score fields.

When editing banks.js, include a new migration updating the derived private question keys, retaining previous snapshots for historical reviews. Never silently edit an already-applied migration.

## Local development

Use Node 18+ for checks:

```sh
node --check app.js
node --check auth.js
node tests/core.test.cjs
python3 -m http.server 8000
```

Open http://localhost:8000. Configure localhost in Supabase allowed redirect URLs for local signup testing. The frontend requires network access to Supabase and the SDK CDN.

`config.example.js` documents `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; `config.js` contains only the deployed project's public values. Public keys are not privileged secrets. Never add a service_role/secret key, database password, user password, or access token to frontend files or Git.

For another backend, use Supabase CLI login/link and `supabase db push` to apply migrations to that explicitly selected project. Review the project ref before applying. The v2 project ref is `sjasfizcvssqtjqnfxia`.

## Deployment and GitHub Actions

Pages is configured with GitHub Actions. `.github/workflows/pages.yml` checks JavaScript and core regression tests and publishes only the frontend files and exhibits on main pushes. The workflow is guarded to run only in AlexAilend/slate-notes-v2. SQL, tests, documentation and local QA fixtures are not published as Pages artifacts.

`.github/workflows/supabase-keepalive.yml` makes a bounded read-only Auth health request three times daily (00:17, 08:17, 16:17 UTC). Required repository Actions secrets:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

It creates no fake records. This is availability monitoring; an Auth health request is not a guarantee against Supabase Free project pausing. GitHub may also suspend schedules on inactive public repositories. Inspect Actions results and Supabase project status when diagnosing availability.

## Verification

Core regression tests cover both banks, count boundaries, unique random sampling, stable option order, single/multiple-answer scoring, ordering questions, Q69/Q74, hidden notes and exhibit file existence. Database integration checks exercised user isolation, role/score/owner tampering rejection and admin reads. Real Auth/API checks exercised login, token refresh/logout, draft upsert, trusted finish scoring and answer persistence. Browser presentation checks are separate from API authentication checks; local QA fixtures are excluded from deployment.

Run Supabase security advisors after migrations. The latest review found no table/RLS/function advisories; Auth reports leaked-password protection disabled. Enable that feature where the project plan supports it: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection .
