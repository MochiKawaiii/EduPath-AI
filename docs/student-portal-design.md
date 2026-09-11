# Student portal visual refresh

The student portal uses compact white cards, restrained borders, a neutral background and a consistent type scale, informed by the public product screenshots on https://www.stellic.com/progress. EduPath retains its own brand and application features. The local `ui-ux-pro-max` skill informed hierarchy, responsive layout and keyboard interaction choices.

The text navigation remains alongside the logo. The menu toggle stays to the logo's right, opens a fixed sidebar, and restores focus on Escape. Profile and logout remain in the avatar dropdown. The public introduction page retains its session-aware return link.

The overview shows profile identity, imported course-row and semester counts, the saved career goal, and a selectable semester result table. It selects the latest term containing numeric grades, falling back to the latest available term. Transfer credits remain in the full transcript but are excluded from semester counts. GPA is the original printed semester summary, never an inferred or recalculated value. The four-item checklist measures supplied profile fields and transcript availability, not academic or graduation progress. Features without implemented services remain marked as upcoming.

Profile editing and PDF operations keep their existing APIs. Only the overview adds a read of the current student's existing transcript endpoint. No database migration or provider configuration changes are needed.

Validation:

- Full API and frontend production build.
- 140 API tests and 27 frontend tests (including four academic overview data cases).
- Browser checks with isolated API fixtures at 1440, 768 and 375 pixel widths: populated/empty/error states, retry, term selection and missing GPA, profile editing, account menu, sidebar/Escape/focus, navigation and the introduction page return link.
- Screenshots are local artifacts under `output/playwright/`; fixture records and screenshots are not shipped or written to the database.

Browser checks do not verify Microsoft login or a live Supabase/Render deployment.
