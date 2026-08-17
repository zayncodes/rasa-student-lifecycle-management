"use client";

import { useEffect, type ReactNode } from "react";

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initials}
    </span>
  );
}

const toneMap: Record<string, string> = {
  Active: "success",
  Completed: "indigo",
  Extended: "warning",
  "On Hold": "neutral",
  Registered: "blue",
  Eligible: "success",
  Generated: "indigo",
  Dispatched: "blue",
  Delivered: "success",
  "Not Eligible": "neutral",
  "In Progress": "blue",
  "Under Review": "violet",
  Submitted: "violet",
  "Revision Required": "danger",
  Assigned: "neutral",
  Paid: "success",
  Partial: "warning",
  Overdue: "danger",
};

export function Badge({ label, tone }: { label: string; tone?: string }) {
  const resolvedTone = tone ?? toneMap[label] ?? "neutral";
  return <span className={`badge badge-${resolvedTone}`}>{label}</span>;
}

export function Modal({
  open,
  title,
  eyebrow,
  onClose,
  children,
  width = "medium",
}: {
  open: boolean;
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  width?: "medium" | "wide";
}) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className={`modal-card modal-${width}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function ProgressBar({ value, tone = "teal" }: { value: number; tone?: string }) {
  return (
    <div className="progress-track" aria-label={`${value}% complete`}>
      <span className={`progress-fill progress-${tone}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <span className="empty-mark">⌕</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
