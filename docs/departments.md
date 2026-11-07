# Departments

Departments are salon sections (for example Hair, Nails and Beauty), not physical
locations. Physical locations use the separate Outlet model.

- Admins (`SUPER_ADMIN`) and managers can open **Departments** in the sidebar at
  `/departments`, create departments, rename them and delete eligible departments.
- This is core configuration, not a separately purchasable or switchable module.
  The API keeps its existing core `catalogue` guard for picker compatibility.
- Staff and cashiers retain read access for department selection in existing forms.
- Suspended salons can read departments but cannot create, rename or delete them.
- Names are trimmed, required, limited to 100 characters and unique within a salon
  using the existing database constraint (case-sensitive).
- Renaming preserves the department id and its existing assignments.
- Deletion requires confirmation with affected product/service/staff/customer counts.
  Products and services become unassigned; staff/customer membership links are removed.
  Related business records and other department assignments are not deleted.
- Any department commission rule blocks deletion, including historical, future and
  null-rate rules. These are retained as historical evidence, not removed to enable
  deletion. There is currently no self-service way to delete such a department.
- Unassigned services accept any otherwise eligible staff member, and future
  commission selection may change. The confirmation explicitly warns about this.
- Preview counts are advisory. Deletion rechecks references and records an audit
  entry atomically, using the commission-publication tenant lock to prevent racing
  rule publication. No changes to frozen payroll or historical rules are made.
- Existing legacy “branch” labels are not a migration to Outlet; department and
  outlet relationships remain unchanged.

## API

All endpoints require a signed-in tenant session. Responses use `{ data: ... }`.

| Method | Path                                   | Result                                                                                       |
| ------ | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/api/departments`                     | Existing array of `{ id, name }`                                                             |
| POST   | `/api/departments`                     | Create with `{ name }`; 201 and `{ id, name }`                                               |
| PATCH  | `/api/departments/:id`                 | Rename with `{ name }`; 200 and `{ id, name }`                                               |
| GET    | `/api/departments/:id/deletion-impact` | Admin/manager preview: `{ id, name, products, services, staff, customers, commissionRules }` |
| DELETE | `/api/departments/:id`                 | Delete and unassign; 200 with actual deletion impact                                         |

Writes additionally require admin/manager access and a writable salon. Unknown body
fields are rejected. Invalid input returns 422, duplicate names return 409 with
`DEPARTMENT_NAME_EXISTS` and a `body.name` field error, and unknown/foreign ids return 404. Deletion with department commission references returns 409 with
`DEPARTMENT_HAS_COMMISSION_RULES`. No new database migration is needed.
