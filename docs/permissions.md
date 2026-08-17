# Permissions and RLS

| Capability | Super Admin | Admin | HR | Trainer |
|---|---:|---:|---:|---:|
| All students | Yes | Yes | Yes | No |
| Assigned students | Yes | Yes | Yes | Yes |
| Fees and payments | Yes | Yes | Yes | No |
| Attendance | Yes | Yes | Relevant | Assigned only |
| Projects, reviews, grades | Yes | Yes | View as needed | Assigned only |
| Certificates and experience letters | Yes | Yes | Yes | No |
| HR and placement | Yes | Yes | Yes | No |
| Users, roles, settings | Yes | Restricted | No | No |
| Audit logs | Yes | Configurable | No | No |

Menu visibility mirrors permissions for usability, but RLS is the security boundary. Trainer access is joined through an active `trainer_assignments` record. Related attendance, feedback, projects and reviews repeat the same enrollment scope at the database layer. Fee tables require `fees.view`, which the trainer role does not receive.

Disabled profiles fail permission helper checks even when Auth still has a session. Service-role credentials bypass RLS and are therefore limited to explicit server-only administration or controlled import jobs.

