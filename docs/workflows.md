# Workflows

## Student lifecycle

Registration creates a student and enrollment, then assigns owner, course and trainer. Every significant change writes a timeline event; sensitive changes additionally write an immutable audit record. Archiving preserves history.

## Fees

A fee account stores the effective course fee inputs. Unlimited posted payments and installment schedules sit beneath it. Pending amount is derived from posted payments; voided records remain visible. Overdue and upcoming states are date-derived using the configured reminder window.

## Academic and project

Attendance uses session records when available and clearly labels imported historical percentages. Trainer assignments preserve history. Projects progress through assignment, submission, review, revision, completion and grade; overdue is derived from deadline and active status. Extensions are independent approval records.

## Certificates and experience letters

Eligibility is evaluated from versioned settings and stored as a snapshot for explanation. A manual override requires a reason, actor and timestamp. Documents are stored privately; request, generation, dispatch, tracking, delivery and issue states remain auditable.

## HR and placement

Sessions are normalized rows, so a fifth session requires configuration rather than a new column. Resume work, mock interviews, job assistance, feedback, video feedback and review activities use typed placement records.

## Notifications

Upcoming payments, overdue installments, project deadlines, course completion, certificate actions and HR sessions produce in-app notifications. External email, WhatsApp and SMS are intentionally deferred behind provider-specific integrations.

## Excel migration

Upload → choose sheet → map columns → validate → identify duplicates → preview → stage → confirm → import → reconcile. A failed validation never partially commits student and financial records. Original workbooks remain unchanged.

