const dateParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateLabel = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

export function currentWorkspaceDateKey(now = new Date()) {
  const parts = Object.fromEntries(dateParts.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function currentWorkspaceDateLabel(now = new Date()) {
  return dateLabel.format(now);
}

export function isBeforeCurrentWorkspaceDate(value: string | null | undefined, now = new Date()) {
  return Boolean(value && value.slice(0, 10) < currentWorkspaceDateKey(now));
}
