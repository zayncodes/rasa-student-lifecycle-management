import { studentLifecycleUpdateSchema } from "@/lib/student-editor-validation";
import { getStudentsByIdsForCurrentUser } from "@/lib/students-server";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES = 80_000;
const REQUIRED_PERMISSIONS = [
  "students.update",
  "courses.view",
  "users.view",
  "attendance.manage",
  "fees.manage",
  "projects.manage",
  "projects.grade",
  "certificates.manage",
  "experience_letters.manage",
  "hr.manage",
] as const;

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function databaseError(error: { code?: string; message?: string } | null) {
  if (!error) return errorResponse("The student record could not be updated.", 500);
  if (error.code === "42501") return errorResponse("You do not have permission to edit the complete student lifecycle.", 403);
  if (error.code === "P0002") return errorResponse("The student record is no longer available.", 404);
  if (error.code === "40001") return errorResponse("This student was changed by another user. Close the editor, reopen the latest record and try again.", 409);
  if (["22023", "22P02", "23503", "23514"].includes(error.code ?? "")) {
    return errorResponse(error.message || "One or more lifecycle values are invalid.", 400);
  }
  if (error.code === "23505") return errorResponse("The update conflicts with another saved record.", 409);
  return errorResponse("The student record could not be updated.", 500);
}

export async function PATCH(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) return errorResponse("Cross-origin update requests are not allowed.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return errorResponse("Student updates must use JSON.", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse("The student update is too large.", 413);
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return errorResponse("Invalid student update request.", 400);
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return errorResponse("A student lifecycle update is required.", 400);
  }
  const { studentId, ...rawUpdate } = input as Record<string, unknown>;
  if (typeof studentId !== "string" || !UUID_PATTERN.test(studentId)) {
    return errorResponse("A valid student ID is required.", 400);
  }

  const parsed = studentLifecycleUpdateSchema.safeParse(rawUpdate);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message || "One or more lifecycle values are invalid.", 400);
  }

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return errorResponse("Authentication is required.", 401);

  const permissionResults = await Promise.all(
    REQUIRED_PERMISSIONS.map((required_permission) => supabase.rpc("has_permission", { required_permission })),
  );
  if (permissionResults.some((result) => result.error)) return errorResponse("Unable to verify lifecycle editing permission.", 500);
  if (permissionResults.some((result) => result.data !== true)) {
    return errorResponse("You do not have permission to edit the complete student lifecycle.", 403);
  }

  const { expectedUpdatedAt, ...payload } = parsed.data;
  const { error: updateError } = await supabase.rpc("update_student_lifecycle", {
    p_student_id: studentId,
    p_expected_updated_at: expectedUpdatedAt,
    p_payload: payload,
  });
  if (updateError) return databaseError(updateError);

  try {
    const [student] = await getStudentsByIdsForCurrentUser([studentId]);
    if (!student) return errorResponse("The updated student record could not be reloaded.", 409);
    return Response.json({ student }, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return errorResponse("The update was saved, but the refreshed student record could not be loaded.", 500);
  }
}
