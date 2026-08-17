import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

const workbookPath = process.argv[2];
const outputPath = process.argv[3] ?? path.resolve("data/client-students.json");
if (!workbookPath) throw new Error("Usage: node scripts/import-client-workbook.mjs <workbook.xlsx> [output.json]");

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(workbookPath);
const workbookUses1904Dates = Boolean(workbook.properties.date1904);
const yearSheets = workbook.worksheets.filter((sheet) => /January\s+20\d{2}.*December\s+20\d{2}/i.test(sheet.name));
const oldRecordsSheet = workbook.worksheets.find((sheet) => normalizedHeader(sheet.name) === "old records");

const FIELD_KEYS = [
  "serialNumber", "studentName", "registrationDate", "joiningDate", "tentativeCompletionDate", "courseName", "certificates",
  "timeRequirement", "syllabusCustomized", "comment", "owner", "email", "contactNumber", "feesStatus", "nextPayment",
  "platformAccount", "studyMaterial", "attendance", "status", "trainerFeedback", "projectDetails", "reviewDetails", "extension",
  "grade", "experienceLetterEligibility", "trainingCompletionDate", "hrFeedback", "certificateDispatchedDate", "certificateStatus",
  "videoFeedback", "hrSession1", "hrSession2", "hrSession3", "hrSession4", "googleReview",
];

const HEADER_ALIASES = new Map([
  ["student name", "studentName"], ["registration date", "registrationDate"], ["joining date", "joiningDate"],
  ["course completion date tentative", "tentativeCompletionDate"], ["course name", "courseName"], ["certificates", "certificates"],
  ["time requirement if any", "timeRequirement"], ["syllabus if customised", "syllabusCustomized"], ["syllabus if customized", "syllabusCustomized"],
  ["comment", "comment"], ["owner", "owner"], ["lead owner", "owner"], ["gmail id", "email"], ["contact number", "contactNumber"],
  ["fees status", "feesStatus"], ["next payment date and amount", "nextPayment"], ["spayee username and password created", "platformAccount"],
  ["spayee study material assigned", "studyMaterial"], ["attendance", "attendance"], ["status", "status"], ["trainer feedback", "trainerFeedback"],
  ["project details", "projectDetails"], ["review details", "reviewDetails"], ["extension", "extension"], ["grade", "grade"],
  ["experience letter eligibility", "experienceLetterEligibility"], ["training completion date", "trainingCompletionDate"], ["feedback", "hrFeedback"],
  ["certificate dispached date", "certificateDispatchedDate"], ["certificate dispatched date", "certificateDispatchedDate"],
  ["certificate status", "certificateStatus"], ["video feedback", "videoFeedback"], ["feedback video", "videoFeedback"],
  ["hr session 1", "hrSession1"], ["hr session 2", "hrSession2"], ["hr session 3", "hrSession3"], ["hr session 4", "hrSession4"],
  ["google review", "googleReview"],
]);

function normalizedHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r\n/g, "\n").trim();
}

function isPopulated(value) {
  return value !== null && value !== undefined && text(value) !== "";
}

function columnLabel(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function excelEpoch() {
  return workbookUses1904Dates ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
}

function dateToExcelSerial(value) {
  return (value.getTime() - excelEpoch()) / 86400000;
}

function normalizedCellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return dateToExcelSerial(value);
  if (Array.isArray(value)) return value.map(normalizedCellValue);
  if (typeof value !== "object") return value;
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? "").join("");
  if ("hyperlink" in value) return normalizedCellValue(value.text ?? value.hyperlink ?? null);
  if ("error" in value) return value.error;
  return value.text ?? String(value);
}

function extractedCell(cell) {
  if (cell.isMerged && cell.master?.address !== cell.address) return { value: null, formula: null, sharedFormula: null };
  const raw = cell.value;
  if (raw && typeof raw === "object" && "formula" in raw) {
    return { value: normalizedCellValue(raw.result), formula: `=${raw.formula}`, sharedFormula: null };
  }
  if (raw && typeof raw === "object" && "sharedFormula" in raw) {
    return { value: normalizedCellValue(raw.result), formula: null, sharedFormula: raw.sharedFormula };
  }
  return { value: normalizedCellValue(raw), formula: null, sharedFormula: null };
}

function worksheetMatrices(sheet) {
  const values = Array.from({ length: sheet.rowCount }, () => Array(sheet.columnCount).fill(null));
  const formulas = Array.from({ length: sheet.rowCount }, () => Array(sheet.columnCount).fill(null));
  const sharedFormulas = Array.from({ length: sheet.rowCount }, () => Array(sheet.columnCount).fill(null));
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const extracted = extractedCell(cell);
      values[rowNumber - 1][columnNumber - 1] = extracted.value;
      formulas[rowNumber - 1][columnNumber - 1] = extracted.formula;
      sharedFormulas[rowNumber - 1][columnNumber - 1] = extracted.sharedFormula;
    });
  });
  return { values, formulas, sharedFormulas };
}

function excelDate(serial) {
  if (typeof serial !== "number" || serial < 25000 || serial > 60000) return null;
  const date = new Date(excelEpoch() + Math.round(serial) * 86400000);
  return date.toISOString().slice(0, 10);
}

function monthHeadingYear(row) {
  if (row.filter(isPopulated).length > 2) return null;
  for (const value of row.slice(0, 2)) {
    const serialDate = excelDate(value);
    if (serialDate) return Number(serialDate.slice(0, 4));
    const raw = text(value);
    const year = raw.match(/\b(19|20)\d{2}\b/)?.[0];
    if (year && /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(raw)) return Number(year);
  }
  return null;
}

function operationalEndIndex(values, headerRow, sourceYear) {
  for (let index = headerRow + 1; index < values.length; index += 1) {
    const headingYear = monthHeadingYear(values[index]);
    if (headingYear && headingYear > sourceYear) return index;
  }
  return values.length;
}

function parseDate(value, fallbackYear) {
  if (!value && value !== 0) return null;
  const fromSerial = excelDate(value);
  if (fromSerial) return fromSerial;
  let candidate = text(value).replace(/(\d+)(st|nd|rd|th)/gi, "$1").replace(/\s+/g, " ").trim();
  if (!candidate || ["-", "/", "na", "n/a", "nil", "completed"].includes(candidate.toLowerCase())) return null;
  if (!/\b(19|20)\d{2}\b/.test(candidate) && /[a-z]/i.test(candidate)) candidate += ` ${fallbackYear}`;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parsePercent(value) {
  if (typeof value === "number") return Math.round((value <= 1 ? value * 100 : value) * 10) / 10;
  const matches = [...text(value).matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
  return matches.length ? Math.round((matches.reduce((sum, number) => sum + number, 0) / matches.length) * 10) / 10 : null;
}

function parseFeePercent(value) {
  if (typeof value === "number") return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
  const raw = text(value).toLowerCase();
  if (/completed|complete|fully|full|100\s*%/.test(raw)) return 100;
  const percent = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  return percent ? Math.max(0, Math.min(100, Number(percent[1]))) : null;
}

function inferLifecycleStatus(rawStatus, completionDate, certificateStatus) {
  const raw = `${text(rawStatus)} ${text(certificateStatus)}`.toLowerCase();
  if (/cancel|drop|terminat/.test(raw)) return "Cancelled";
  if (/hold|pause|suspend/.test(raw)) return "On Hold";
  if (/extend/.test(raw)) return "Extended";
  if (/complete|completion|certificate|all done|training sent/.test(raw) || completionDate) return "Completed";
  return "Active";
}

function inferProjectStatus(value) {
  const raw = text(value).toLowerCase();
  if (!raw || /^(na|n\/a|-)$/.test(raw)) return "Assigned";
  if (/terminat|reject/.test(raw)) return "Revision Required";
  if (/complete|done|approved/.test(raw)) return "Completed";
  if (/review|submitted/.test(raw)) return "Under Review";
  return "In Progress";
}

function inferCertificateStatus(value, certificates, lifecycleStatus) {
  const raw = `${text(value)} ${text(certificates)}`.toLowerCase();
  if (/dispatch/.test(raw)) return "Dispatched";
  if (/deliver/.test(raw)) return "Delivered";
  if (/ready|generated|done/.test(raw)) return "Generated";
  if (lifecycleStatus === "Completed") return "Eligible";
  return "Not Eligible";
}

function slug(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 18) || "COURSE";
}

function headerMap(values, headerRow) {
  const map = new Map();
  const row = values[headerRow];
  row.forEach((value, column) => {
    const normalized = normalizedHeader(value);
    const key = HEADER_ALIASES.get(normalized);
    if (key) map.set(key, column);
    if (/^sr\s*no/.test(normalized)) map.set("serialNumber", column);
  });
  if (!map.has("certificates") && headerRow === 1) map.set("certificates", 6);
  return map;
}

const sheetCache = new Map();
const rawSheets = workbook.worksheets.map((sheet, sheetIndex) => {
  const { values, formulas, sharedFormulas } = worksheetMatrices(sheet);
  sheetCache.set(sheet.name, { values, formulas, sharedFormulas });
  const rows = [];
  let nonBlankCellCount = 0;
  let formulaCellCount = 0;
  let sharedFormulaCellCount = 0;
  values.forEach((row, rowIndex) => {
    const formulaRow = formulas[rowIndex] ?? [];
    const sharedFormulaRow = sharedFormulas[rowIndex] ?? [];
    const cells = [];
    const columnCount = Math.max(row.length, formulaRow.length, sharedFormulaRow.length);
    for (let column = 0; column < columnCount; column += 1) {
      const value = row[column] ?? null;
      const formula = formulaRow[column] ?? null;
      const sharedFormula = sharedFormulaRow[column] ?? null;
      if (!isPopulated(value) && !isPopulated(formula) && !isPopulated(sharedFormula)) continue;
      nonBlankCellCount += 1;
      if (isPopulated(formula)) formulaCellCount += 1;
      if (isPopulated(sharedFormula)) sharedFormulaCellCount += 1;
      cells.push({
        column: column + 1,
        columnLabel: columnLabel(column),
        value,
        formula: isPopulated(formula) ? formula : null,
        sharedFormula: isPopulated(sharedFormula) ? sharedFormula : null,
      });
    }
    if (cells.length) rows.push({ sourceRow: rowIndex + 1, cells });
  });
  return {
    sheetIndex,
    sheet: sheet.name.trim(),
    originalSheetName: sheet.name,
    usedRows: values.length,
    usedColumns: values.reduce((maximum, row) => Math.max(maximum, row.length), 0),
    nonBlankRowCount: rows.length,
    nonBlankCellCount,
    formulaCellCount,
    sharedFormulaCellCount,
    rows,
  };
});

const records = [];
const archivedRecords = [];
const sheetSummaries = [];
for (const sheet of yearSheets) {
  const values = sheetCache.get(sheet.name).values;
  const sourceYear = Number(sheet.name.match(/20\d{2}/)?.[0]);
  const headerRow = values.findIndex((row) => row.some((value) => normalizedHeader(value) === "student name"));
  const map = headerMap(values, headerRow);
  // Columns after the historical blank spacer are stable, though some early sheets omit them.
  const fixedTail = sourceYear >= 2023
    ? { hrFeedback: 27, certificateDispatchedDate: 28, certificateStatus: 29, videoFeedback: 30, hrSession1: 31, hrSession2: 32, hrSession3: 33, hrSession4: 34, googleReview: 35 }
    : sourceYear === 2022
      ? { hrFeedback: 26, certificateStatus: 27, hrSession1: 28, hrSession2: 29, hrSession3: 30, hrSession4: 31, googleReview: 32, videoFeedback: 33 }
      : { hrFeedback: 27, certificateStatus: 28, hrSession1: 29, hrSession2: 30, hrSession3: 31, hrSession4: 32 };
  Object.entries(fixedTail).forEach(([key, column]) => map.set(key, column));
  if (sourceYear <= 2022) map.set("trainerFeedback", 17);
  if (sourceYear <= 2022) map.set("projectDetails", 18);
  if (sourceYear <= 2022) map.set("reviewDetails", 19);
  if (sourceYear <= 2022) map.set("extension", 20);
  if (sourceYear <= 2022) map.set("grade", 21);
  if (sourceYear <= 2022) map.set("trainingCompletionDate", 22);

  let imported = 0;
  const operationalEnd = operationalEndIndex(values, headerRow, sourceYear);
  values.slice(headerRow + 1, operationalEnd).forEach((row, offset) => {
    const get = (key) => map.has(key) ? row[map.get(key)] : null;
    const rawName = text(get("studentName"));
    const email = text(get("email"));
    const phone = text(get("contactNumber"));
    const courseName = text(get("courseName"));
    const registrationRaw = text(get("registrationDate"));
    const certificates = text(get("certificates"));
    const serial = get("serialNumber");
    const hasSerial = typeof serial === "number" && excelDate(serial) === null;
    const populatedCellCount = row.filter(isPopulated).length;
    const hasIdentity = Boolean(rawName || email || phone);
    const hasOperationalEvidence = Boolean(hasSerial || email || phone || courseName || registrationRaw || certificates);
    const isLikelyStudent = populatedCellCount >= 2 && hasIdentity && hasOperationalEvidence;
    if (!isLikelyStudent) return;
    const sourceRow = offset + headerRow + 2;
    const name = rawName || `Name not recorded (source row ${sourceRow})`;
    const registrationDate = parseDate(get("registrationDate"), sourceYear);
    const joiningDate = parseDate(get("joiningDate"), sourceYear);
    const tentativeCompletionDate = parseDate(get("tentativeCompletionDate"), sourceYear);
    const trainingCompletionDate = parseDate(get("trainingCompletionDate"), sourceYear);
    const lifecycleStatus = inferLifecycleStatus(get("status"), trainingCompletionDate, get("certificateStatus"));
    const attendance = parsePercent(get("attendance"));
    const feePaidPercent = parseFeePercent(get("feesStatus"));
    const certificateStatus = inferCertificateStatus(get("certificateStatus"), get("certificates"), lifecycleStatus);
    const original = Object.fromEntries(FIELD_KEYS.map((key) => [key, map.has(key) ? get(key) : null]));
    records.push({
      id: `xlsx-${sourceYear}-${sourceRow}`,
      code: `RASA-${sourceYear}-${String(imported + 1).padStart(6, "0")}`,
      recordCategory: "operational",
      sourceYear,
      sourceSheet: sheet.name.trim(),
      sourceRow,
      name,
      email,
      phone,
      registrationDate,
      joiningDate,
      completionDate: trainingCompletionDate ?? tentativeCompletionDate,
      tentativeCompletionDate,
      course: courseName || "Course not recorded",
      courseCode: slug(courseName),
      certificates: text(get("certificates")),
      timeRequirement: text(get("timeRequirement")),
      syllabusCustomized: text(get("syllabusCustomized")),
      comment: text(get("comment")),
      owner: text(get("owner")) || "Unassigned",
      status: lifecycleStatus,
      trainer: "Unassigned",
      feesStatus: text(get("feesStatus")),
      feePaidPercent,
      nextPayment: text(get("nextPayment")),
      platformStatus: /created/i.test(text(get("platformAccount"))) ? (/assign/i.test(text(get("studyMaterial"))) ? "Material Assigned" : "Created") : "Not Created",
      studyMaterial: text(get("studyMaterial")),
      attendance: attendance ?? 0,
      attendanceRecorded: attendance !== null,
      rawAttendance: text(get("attendance")),
      trainerFeedback: text(get("trainerFeedback")),
      project: text(get("projectDetails")) || "Not recorded",
      projectStatus: inferProjectStatus(get("projectDetails")),
      reviewDetails: text(get("reviewDetails")),
      extension: text(get("extension")),
      grade: text(get("grade")) || null,
      experienceLetterEligibility: text(get("experienceLetterEligibility")),
      certificateStatus,
      certificateDispatchedDate: parseDate(get("certificateDispatchedDate"), sourceYear),
      videoFeedback: text(get("videoFeedback")),
      hrFeedback: text(get("hrFeedback")),
      hrSessions: [get("hrSession1"), get("hrSession2"), get("hrSession3"), get("hrSession4")].map(text),
      googleReview: text(get("googleReview")),
      notes: [text(get("comment")), text(get("trainerFeedback"))].filter(Boolean).join("\n\n"),
      importWarnings: [rawName ? null : "missing_student_name", registrationDate ? null : "registration_date_unparsed"].filter(Boolean),
      original,
    });
    imported += 1;
  });
  sheetSummaries.push({
    sheet: sheet.name.trim(),
    sourceYear,
    imported,
    headerRow: headerRow + 1,
    operationalStartRow: headerRow + 2,
    operationalEndRow: operationalEnd,
    stoppedBeforeRow: operationalEnd < values.length ? operationalEnd + 1 : null,
  });
}


if (oldRecordsSheet) {
  const values = sheetCache.get(oldRecordsSheet.name).values;
  const headerRow = values.findIndex((row) => row.some((value) => normalizedHeader(value) === "student name"));
  const map = headerMap(values, headerRow);
  let imported = 0;
  values.slice(headerRow + 1).forEach((row, offset) => {
    const get = (key) => map.has(key) ? row[map.get(key)] : null;
    const name = text(get("studentName"));
    if (!name || row.filter(isPopulated).length === 0) return;
    const sourceRow = offset + headerRow + 2;
    const registrationDate = parseDate(get("registrationDate"), 2020);
    const joiningDate = parseDate(get("joiningDate"), 2020);
    const tentativeCompletionDate = parseDate(get("tentativeCompletionDate"), 2020);
    const trainingCompletionDate = parseDate(get("trainingCompletionDate"), 2020);
    const attendance = parsePercent(get("attendance"));
    const courseName = text(get("courseName"));
    const original = Object.fromEntries(FIELD_KEYS.map((key) => [key, map.has(key) ? get(key) : null]));
    archivedRecords.push({
      id: `xlsx-old-records-${sourceRow}`,
      code: `RASA-ARCHIVE-${String(imported + 1).padStart(6, "0")}`,
      recordCategory: "archive",
      sourceYear: null,
      sourceSheet: oldRecordsSheet.name,
      sourceRow,
      name,
      email: text(get("email")),
      phone: text(get("contactNumber")),
      registrationDate,
      joiningDate,
      completionDate: trainingCompletionDate ?? tentativeCompletionDate,
      tentativeCompletionDate,
      course: courseName || "Course not recorded",
      courseCode: slug(courseName),
      certificates: text(get("certificates")),
      timeRequirement: text(get("timeRequirement")),
      syllabusCustomized: text(get("syllabusCustomized")),
      comment: text(get("comment")),
      owner: "Unassigned",
      status: "Archived",
      trainer: "Unassigned",
      feesStatus: text(get("feesStatus")),
      feePaidPercent: parseFeePercent(get("feesStatus")),
      nextPayment: "",
      platformStatus: /created/i.test(text(get("platformAccount"))) ? (/assign/i.test(text(get("studyMaterial"))) ? "Material Assigned" : "Created") : "Not Created",
      studyMaterial: text(get("studyMaterial")),
      attendance: attendance ?? 0,
      attendanceRecorded: attendance !== null,
      rawAttendance: text(get("attendance")),
      trainerFeedback: text(get("trainerFeedback")),
      project: text(get("projectDetails")) || "Not recorded",
      projectStatus: inferProjectStatus(get("projectDetails")),
      reviewDetails: text(get("reviewDetails")),
      extension: text(get("extension")),
      grade: text(get("grade")) || null,
      experienceLetterEligibility: "",
      certificateStatus: inferCertificateStatus(get("certificateStatus"), get("certificates"), "Archived"),
      certificateDispatchedDate: null,
      videoFeedback: text(get("videoFeedback")),
      hrFeedback: text(get("hrFeedback")),
      hrSessions: [get("hrSession1"), get("hrSession2"), get("hrSession3"), get("hrSession4")].map(text),
      googleReview: text(get("googleReview")),
      notes: [text(get("comment")), text(get("trainerFeedback"))].filter(Boolean).join("\n\n"),
      importWarnings: ["archival_record_requires_review"],
      original,
    });
    imported += 1;
  });
  sheetSummaries.push({ sheet: oldRecordsSheet.name, sourceYear: null, imported, headerRow: headerRow + 1, recordCategory: "archive" });
}

const output = {
  source: {
    filename: path.basename(workbookPath),
    importedAt: new Date().toISOString(),
    operationalCount: records.length,
    archivedCount: archivedRecords.length,
    sheets: sheetSummaries,
  },
  records,
  archivedRecords,
  rawSheets,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify({ outputPath, operational: records.length, archived: archivedRecords.length, sheets: sheetSummaries }, null, 2));
