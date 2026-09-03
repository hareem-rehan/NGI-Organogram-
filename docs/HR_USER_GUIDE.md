# HR User Guide — Dynamic Organogram Manager

A plain-language guide for HR staff using the Dynamic Organogram Manager day to day. It assumes no prior experience with the application and walks through every real feature, screen by screen, using the actual labels you will see on screen. If something described here doesn't match what you see, the application has changed since this guide was written — tell your administrator so it can be updated.

This guide covers what each of the three roles can do:

- **VIEWER** — can look at everything (Dashboard, Departments, Positions, Employees, the Organogram), search and filter, but cannot change anything.
- **HR_EDITOR** — everything a VIEWER can do, plus creating and editing departments/positions/employees, running CSV imports and exports, and viewing the Audit Log (a restricted set of categories — see §10).
- **ADMIN** — everything an HR_EDITOR can do, plus managing user accounts and company Settings, and seeing the complete Audit Log.

If a button or screen described here doesn't appear for you, it's most likely gated to a role you don't hold — that's expected, not a bug (see §12 for what ADMIN-only screens look like).

## 1. Signing in

There are no usernames or passwords in this application. You sign in with your company account through **Company SSO** — your organization's existing single sign-on system.

1. Go to the application's sign-in page. You'll see the company name and a button labeled **"Sign in with [your organization's account name]"**.
2. Click it. You'll be sent to your organization's own sign-in page (the same one you use for email, etc.).
3. Sign in there as usual. You'll be returned to the application automatically.

If you see a message after trying to sign in, it will be one of these:

- _"Your account isn't authorized to access this application, or has been disabled. Contact your administrator if you believe this is a mistake."_ — your account hasn't been set up in this application yet, or an administrator has disabled it. Contact your ADMIN.
- _"Your sign-in link has expired or was already used. Please try signing in again."_ — just try again.
- _"Something went wrong while signing in. Please try again."_ — a temporary problem; try again, and contact your administrator if it keeps happening.
- _"Sign-in is temporarily unavailable due to a configuration issue. Please contact your administrator."_

Being able to sign in at all requires that your administrator has already reserved your account (an ADMIN does this from the **Users** screen, §11, or your IT team does it before you ever try). Simply having a valid company account is not, by itself, enough — see §14 if you can't sign in.

## 2. Getting around

Once signed in, you'll see a navigation menu (a sidebar on desktop, a menu button on mobile) with some or all of these items, depending on your role:

| Menu item   | What it's for                                          | Who sees it                               |
| ----------- | ------------------------------------------------------ | ----------------------------------------- |
| Dashboard   | Company overview and key numbers                       | Everyone                                  |
| Organogram  | The interactive, automatically-generated org chart     | Everyone                                  |
| Departments | Manage departments                                     | Everyone (view); HR_EDITOR/ADMIN can edit |
| Positions   | Manage positions and reporting relationships           | Everyone (view); HR_EDITOR/ADMIN can edit |
| Employees   | Manage employee records and their position assignments | Everyone (view); HR_EDITOR/ADMIN can edit |
| Imports     | Bulk-upload data from a CSV file                       | HR_EDITOR, ADMIN                          |
| Audit Log   | History of who changed what, and when                  | HR_EDITOR, ADMIN                          |
| Users       | Manage who can sign in and what role they hold         | ADMIN only                                |
| Settings    | Company profile and organogram/export defaults         | ADMIN only                                |

A menu item that isn't shown to you is enforced on the server too — typing its address directly into the browser won't let you in either. That's intentional, not a display glitch.

## 3. Dashboard

The Dashboard is your company's home page — a live snapshot, not a saved report, so it always reflects the current data.

- **Summary cards** at the top: Active Employees, Active Positions, Occupied Positions, Vacant Positions, Planned Positions, Active Departments. Click a card to jump straight to a matching filtered list (e.g. clicking "Vacant Positions" takes you to Positions already filtered to vacant, active positions).
- **Organizational structure**: your company's root position (usually the CEO), the deepest level in the chart, and how many employees are assigned vs. unassigned, plus a simple bar breakdown of active positions by level.
- **Vacancy overview**: the percentage of eligible active positions currently vacant, with a note on what counts ("Eligible active positions are Active positions in an Active department. Planned and Inactive positions are never counted.").
- **Departments** table: a per-department count of active/occupied/vacant/planned positions and the department's deepest level.
- **Data quality** (HR_EDITOR/ADMIN only): flags structural issues worth a look (for example, a position accidentally left out of the reporting chain). If it says "No structural issues detected," there's nothing to do.
- **Quick actions**: shortcuts to add a department/position/employee (HR_EDITOR/ADMIN) or jump to the read-only lists (VIEWER).

Click **Refresh** any time to reload the latest numbers.

## 4. Departments

Departments group positions for reporting and for the organogram's color-coding. Open **Departments** from the menu.

- **Search**: the box labeled "Search by name or code…" filters the list as you type.
- **Add Department** (HR_EDITOR/ADMIN): opens a form with:
  - **Name** (required)
  - **Code** (required — a short unique identifier; it's automatically compared without regard to upper/lower case, so "ENG" and "eng" are treated as the same code)
  - **Description** (optional)
  - **Color** (optional — used for the department's color coding on the organogram; pick one that's visually distinct from other departments)
  - **Parent department** (optional — pick this to make the new department a sub-department of an existing one, e.g. "Platform Engineering" under "Engineering")

  Click **Create department** to save.

- **Edit**: opens the same form pre-filled, with a **Save changes** button.
- **Deactivate / Reactivate**: a department with active positions can still be deactivated — deactivating never deletes it or breaks anything referencing it; it simply marks the department inactive. You'll be asked to confirm. Reactivating flips it back.

A department cannot be permanently deleted through the application — deactivating is the correct way to retire one you no longer need. This is deliberate: the app never allows a delete that could silently strand data.

## 5. Positions & the reporting hierarchy

Positions are the building blocks of your org chart. A position is a _role_ (e.g. "VP of Engineering") — it exists independently of whoever currently holds it. Open **Positions** from the menu.

**Important distinction:** Position and Employee are two separate things in this application. Removing or transferring an employee never deletes their position — the position simply becomes Vacant and stays exactly where it was in the chart.

### 5.1 Position status vs. occupancy

Every position has a **status** — Active, Planned, or Inactive — plus a separately-computed **occupancy** (Occupied or Vacant, based on whether an employee is currently assigned). These are independent:

- **Active** + occupied → shown normally, filled.
- **Active** + vacant → a real, currently-open role.
- **Planned** → approved for the future, not yet active; always shown vacant, with a distinct badge in the organogram.
- **Inactive** → archived; kept in the system (so history and any still-active descendants remain intact) but not part of the "live" chart the way an Active position is.

### 5.2 Creating and editing a position (HR_EDITOR/ADMIN)

Click **Add Position**. You'll be asked for:

- **Title** (required)
- **Code** (required — unique, case-insensitive, like department codes)
- **Department** (required — pick from your active departments)
- **Job grade** (optional — a seniority band such as "Manager" or "Director"; your administrator maintains the list of available grades)
- **Reports to** (search and select the manager position this one reports to — leave blank only for your company's single root position, e.g. the CEO)
- **Location** (optional, free text)
- **Description** (optional)

Click **Create position** to save. **Edit** opens the same fields pre-filled with a **Save changes** button — editing never changes who the position reports to (see below).

### 5.3 Organizational Level and Job Grade — not the same thing

- **Organizational Level** is calculated automatically by the system: your root position is Level 1, and every position is exactly one level below whoever it reports to. You cannot set this yourself, anywhere in the app — it's always derived from the reporting chain.
- **Job Grade** is a separate, HR-maintained value (seniority/pay band) you choose from a list. It has nothing to do with a position's depth in the chart — a Director-grade position can sit at Level 2 in one department and Level 4 in another. Never assume one implies the other.

### 5.4 Changing who a position reports to

Click **Change Reports-To** on a position. Search for and select the new manager position, then confirm. Behind the scenes, the system:

- Rejects the change outright if it would create a loop (a position reporting to itself, or to one of its own descendants).
- Recalculates the organizational level of the position you moved **and every position beneath it**, all at once, so the chart stays consistent.
- Either the whole move succeeds, or none of it does — you'll never end up with a half-moved branch.

### 5.5 Archiving and reactivating a position

Use the **Deactivate**/**Reactivate** button (labeled "Reactivate" for a currently-inactive position, "Deactivate" otherwise) to retire a position that's no longer needed, or bring one back. Archiving is safe even if the position has direct reports — the hierarchy stays intact; only the one position's status changes.

## 6. Employees & assignments

Open **Employees** from the menu.

- **Search**: "Search by name, code, or email…".
- **Add Employee** (HR_EDITOR/ADMIN): **Employee code** (required, unique), **First name** and **Last name** (required), **Preferred name** (optional — shown instead of the full name wherever an occupant's name is displayed, e.g. on the organogram), **Work email** (optional but must be unique if provided), **Joining date** (optional). Click **Create employee**.

An employee created this way starts with **no position** — creating an employee never assigns them to anything. This is intentional and is exactly how you'd represent a new hire who hasn't been placed yet, or record someone between roles.

Open an employee's record to see their current position (if any) and take action:

- **Assign to Position** (only shown when the employee currently has no position): search for and pick an eligible position, set a start date, confirm.
- **Transfer** (only shown when currently assigned): pick the destination position and a transfer date. The system ends the old assignment and starts the new one at the same moment — the old position becomes vacant as of that instant, never leaving the employee unassigned in between.
- **End Assignment**: ends the employee's current assignment as of the date you choose, without assigning them anywhere new — their position reverts to Vacant.
- **Terminate Employee**: the guided way to record someone leaving the organization entirely. You must type the employee's own code to confirm (a deliberate extra step, since this is hard to casually undo). Terminating ends any active assignment automatically and sets the employee's status to Terminated — their former position stays exactly where it is in the chart, now Vacant.

**Assignment history**: every employee's record shows their full history of position assignments — past (ended) ones and the current one, each with start/end dates. Note that this view always shows a position's _current_ title/code/department, not what it was called at the time of that historical assignment — the app doesn't keep a separate historical snapshot of position details.

## 7. The Organogram

Open **Organogram** from the menu — this is the automatically-generated chart. Nobody manually drags or positions a card here; the whole layout is computed from Positions and their Reports-To relationships every time you open it.

- **Visual View / Outline View**: toggle at the top. Visual View is the interactive chart (pan, zoom, expand/collapse). Outline View is a plain, fully keyboard-and-screen-reader-accessible indented list of the same data — use it if the visual canvas doesn't work well for you.
- **Expand All / Collapse All**: show or hide every branch at once.
- **Fit to View / Reset View**: re-center and re-fit the chart (Visual View only).
- **Show planned positions**: a checkbox to include or hide Planned positions.
- **Search** (top of the page): type a name, title, position code, or department — matches are highlighted and the chart jumps to them.
- **Filters** (the drawer/panel next to Search): narrow the chart by Department, Organizational Level, Job Grade, Occupancy (All/Occupied/Vacant), or Position Status.
- **Focus**: click a position or department in the Details Panel (opened by clicking a card) to switch into **Position Focus** or **Department Focus** — a zoomed-in view of just that branch or department. A focus bar appears with:
  - A depth selector (Position Focus only): Direct Reports Only / Two Levels / Three Levels / All Descendants.
  - **Copy View Link**: copies a link that reopens this exact focused view for anyone who opens it (subject to their own permissions — sharing a link never gives someone access they don't already have).
  - **Full Company View**: returns to the whole chart.
- **Export** (HR_EDITOR/ADMIN only): opens a dialog to generate a PDF or PNG of the chart. Choose:
  - **Format**: PDF or PNG (image).
  - **Scope**: Full Company, Current View (whatever is on screen right now, including any active focus/filters), Position Focus, or Department Focus.
  - PDF-specific: page size (A3 or A4 landscape) and layout (Auto/Single page/Multi-page tiled).
  - PNG-specific: image scale (1x/2x/3x).
  - Display options: include legend, include company name/date header, include a "Confidential" label — all on by default.

  Click **Generate export**, then **Download** once it's ready. There is no separate "print" screen — if you need a physical copy for a meeting, generate a PDF and print it from your PDF viewer.

## 8. Bulk-importing data with CSV (HR_EDITOR/ADMIN)

Open **Imports** from the menu. This is for loading many departments, positions, employees, or position assignments at once from a spreadsheet, instead of entering them one by one.

1. **Choose an import type**: Departments, Positions, Employees, or Position Assignments — you cannot mix types in one file.
2. **Choose a mode**: "Create or update (UPSERT)" (a row matching an existing code updates it; a new code creates it) or "Create only" (every row must be brand new, or the whole file is rejected). Position Assignment imports don't have a mode — they use an explicit `operation` column instead (`ASSIGN`, `TRANSFER`, or `END_ASSIGNMENT`).
3. Click **Download template** for a starter file with the exact column headers and one clearly-fictional example row for the type you picked.
4. Fill it in (comma-separated, UTF-8, up to 5,000 rows and 10MB) and click **Upload CSV file**.
5. The system validates every row and shows you a full preview before anything is saved: total rows, and counts of rows that will be created, updated, left unchanged, or have errors/warnings — plus, for every row that would update an existing record, exactly which fields would change (current value → proposed value).
6. If there are **warnings** (currently: an unrecognized column that will simply be ignored), tick the acknowledgement checkbox before you can continue.
7. If there are any **errors**, nothing can be saved yet — fix the file and re-upload. There is no "save the good rows and skip the bad ones" option; a file with even one error commits nothing, on purpose, so you always know exactly what state your data is in.
8. Click **Confirm import**, then **Execute import**. You'll see how many rows were created vs. updated. If a **"Download error report"** button appears instead, download it — it lists exactly what's wrong with each problem row.

A few things the import can never do (by design, not an oversight): it can never set a position's organizational level directly (always computed), never directly mark something occupied/vacant (always derived from assignments), never create a Planned position, never set an employee's manager/department/level/job grade (those live on Position/Assignment records, not Employee), and never touches salary, passwords, or sign-in information.

**A note on very large files:** imports of a few hundred rows work quickly. If you're importing a very large file (several hundred to a few thousand rows) and it fails outright with an error rather than a normal validation result, this is a known limitation at that scale — see your administrator or `docs/SUPPORT_RUNBOOK.md`, and consider splitting the file into smaller batches in the meantime.

Ready-to-use example files for each of the four import types live in `docs/uat-fixtures/` if you want to see a working example before building your own file.

## 9. Confidential information

There is no employee photo field, and no phone number or personal email is ever shown on the organogram — only position title, department, level, and the occupant's name. Salary and other compensation data are not modeled anywhere in this application at all.

## 10. Audit Log (HR_EDITOR/ADMIN)

Open **Audit Log** from the menu — a complete, permanent history of every structural change: who did it, when, what changed (before/after), and (for CSV imports/exports) which job it belonged to. Nobody, at any role, can edit or delete an audit entry — it is enforced by the database itself, not just the interface.

- Filter by Category, Action, Entity type, Actor email, or a date range (up to 366 days at once).
- Click **View Details** on any row for the full before/after comparison and any additional context.
- **If you're an HR_EDITOR**, you'll only see organization-change categories (Department, Position, Hierarchy, Employee, Assignment, Import, Export) — user-administration, settings, security, and authentication events are only visible to ADMIN. This is a deliberate, conservative default, not a bug — if you need to see one of those events, ask an ADMIN.

## 11. User Administration (ADMIN only)

Open **Users** from the menu. This is where you control who can sign in and what they can do.

- **Provision User**: reserve an identity for someone by entering their **Company email** and choosing a **Role** (VIEWER/HR_EDITOR/ADMIN). No password is ever set here — the person gains access the next time they successfully sign in through Company SSO with that exact email. Granting HR_EDITOR or ADMIN requires you to explicitly tick a confirmation checkbox first.
- **Change Role**: change an existing user's role. The same confirmation checkbox appears for any change involving ADMIN.
- **Disable / Reactivate**: disabling immediately ends that person's ability to use the app (their active sessions are cut off right away, not just on their next login) without touching their linked Employee record, if any. Reactivating restores access without changing their role.
- **Link Employee / Unlink**: optionally connect a User account to an Employee record (so, for example, you know which login belongs to which person in the org chart). Linking or unlinking never changes the person's role, their position assignment, or their employment status.

**A safeguard you should know about:** the application will never let you demote or disable the _last_ remaining active ADMIN — including yourself. If you try, you'll get a clear rejection rather than accidentally locking everyone out of administration.

## 12. Settings (ADMIN only)

Open **Settings** from the menu.

- **Company Profile**: name, legal name, and timezone. The company **code** is shown but cannot be changed here once set up.
- **Organogram Defaults**: default expansion depth (1–10), default view (Visual/Outline), and whether Planned positions show by default. _(Note: as of this writing, these defaults are saved and audited but not yet actually applied when someone opens the Organogram — the chart still uses its own built-in default. This is a known, documented gap, not something you're doing wrong.)_
- **Export Defaults**: default PDF page size/layout, default PNG scale, whether the legend and "Confidential" label are included by default, and how many days (1–30) a generated export file stays downloadable before it expires. _(Same note as above — these are saved and audited, but the Export dialog doesn't read them yet.)_
- **Company SSO** (read-only): shows the sign-in provider's name, the allowed email domains, and whether unrecognized-but-allowed users are automatically granted VIEWER access. The actual SSO secret/credentials are never shown here — they live only in server configuration your IT team controls.

Every settings save is protected against two people overwriting each other's changes at once — if someone else saved first, you'll see a message asking you to reload and try again, rather than silently losing their change.

## 13. A note on what this application does not do

To avoid confusion, a few things are deliberately **not** part of this application (by design, not because they were forgotten): dragging chart nodes around by hand, dotted-line/secondary reporting relationships, viewing the org chart as it looked at a past date, multi-step approval workflows for structural changes, and automatic syncing with any other HR system. If you need one of these, that's a conversation for your administrator/product owner, not something to work around inside the app.

## 14. Getting help

If something in the app isn't working the way this guide describes, or you get an error message you don't understand, contact your system administrator (an ADMIN in this application) or your internal IT support. `docs/SUPPORT_RUNBOOK.md` is the reference they'll use to help you.
