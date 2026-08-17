# Database schema

```mermaid
erDiagram
  PROFILES ||--o{ USER_ROLES : has
  ROLES ||--o{ USER_ROLES : assigned
  ROLES ||--o{ ROLE_PERMISSIONS : grants
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : included
  STUDENTS ||--o{ ENROLLMENTS : takes
  COURSES ||--o{ ENROLLMENTS : contains
  ENROLLMENTS ||--o{ TRAINER_ASSIGNMENTS : assigned
  TRAINERS ||--o{ TRAINER_ASSIGNMENTS : teaches
  ENROLLMENTS ||--o{ ATTENDANCE_RECORDS : records
  ENROLLMENTS ||--|| FEE_ACCOUNTS : billed
  FEE_ACCOUNTS ||--o{ PAYMENTS : receives
  FEE_ACCOUNTS ||--o{ PAYMENT_SCHEDULES : schedules
  ENROLLMENTS ||--o{ STUDENT_PROJECTS : includes
  STUDENT_PROJECTS ||--o{ PROJECT_REVIEWS : reviewed
  ENROLLMENTS ||--o{ EXTENSIONS : extends
  ENROLLMENTS ||--o| CERTIFICATES : earns
  ENROLLMENTS ||--o| EXPERIENCE_LETTERS : earns
  ENROLLMENTS ||--o{ HR_SESSIONS : schedules
  ENROLLMENTS ||--o{ PLACEMENT_ACTIVITIES : supports
  STUDENTS ||--o{ DOCUMENTS : owns
  STUDENTS ||--o{ TIMELINE_EVENTS : records
```

UUIDs are used for operational entities; money uses `numeric(12,2)` and timestamps use `timestamptz`. Historical course name, code and fee are snapshotted on enrollment. Payments are posted or voided, never normally deleted. Student codes are allocated with a row-locked annual sequence rather than `COUNT(*) + 1`.

Spayee passwords are intentionally absent. If credential custody becomes mandatory, it requires a separately approved encrypted server-only design with dedicated access auditing.

