import { RasaShell } from "@/components/app/rasa-shell";
import { LocalRasaShell } from "@/components/app/local-rasa-shell";
import { WorkspaceEmpty } from "@/components/app/workspace-empty";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getStudentEditorOptions, getStudentsForCurrentUser } from "@/lib/students-server";
import { isLocalClientDataModeEnabled } from "@/lib/local-client-data.server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function isLoopbackHost(hostHeader: string | null) {
  if (!hostHeader) return false;
  const host = hostHeader.split(",", 1)[0].trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]")) === "::1";
  const hostname = host.split(":", 1)[0];
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export default async function Home() {
  if (isLocalClientDataModeEnabled()) {
    const requestHeaders = await headers();
    const requestHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (!isLoopbackHost(requestHost)) {
      throw new Error("Local client data mode accepts requests only from this computer.");
    }
    return <LocalRasaShell />;
  }
  if (!isSupabaseConfigured) return <WorkspaceEmpty />;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
    throw new Error("Authentication is required.");
  }

  const { data: isLaunchAdministrator, error: launchAccessError } = await supabase.rpc("is_launch_administrator");
  if (launchAccessError || isLaunchAdministrator !== true) redirect("/login?reason=administrator-access");

  const permissionCodes = [
    "reports.export", "students.create", "students.update", "courses.view", "users.view",
    "attendance.manage", "fees.manage", "projects.manage", "projects.grade",
    "certificates.manage", "experience_letters.manage", "hr.manage",
  ] as const;
  type PermissionCode = (typeof permissionCodes)[number];
  const [{ data: profile }, students, ...permissionResults] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    getStudentsForCurrentUser(),
    ...permissionCodes.map((required_permission) => supabase.rpc("has_permission", { required_permission })),
  ]);
  const permissions = new Map(permissionCodes.map((code, index) => [code, !permissionResults[index].error && permissionResults[index].data === true]));
  const currentUserName = profile?.full_name || String(user.user_metadata?.full_name || user.email || "RASA staff");
  const canExport = permissions.get("reports.export") === true;
  const canManageFees = permissions.get("fees.manage") === true;
  const createStudentPermissions = ["students.create", "students.update", "courses.view", "fees.manage"] satisfies PermissionCode[];
  const canCreateStudent = createStudentPermissions.every((code) => permissions.get(code) === true);
  const canEditStudent = [
    "students.update", "courses.view", "users.view", "attendance.manage", "fees.manage",
    "projects.manage", "projects.grade", "certificates.manage", "experience_letters.manage", "hr.manage",
  ] satisfies PermissionCode[];
  const hasStudentEditAccess = canEditStudent.every((code) => permissions.get(code) === true);
  const editorOptions = hasStudentEditAccess ? await getStudentEditorOptions() : { courses: [], owners: [] };
  return <RasaShell
    initialStudents={students}
    currentUserName={currentUserName}
    workspaceMode="production"
    canExport={canExport}
    canCreateStudent={canCreateStudent}
    canEditStudent={hasStudentEditAccess}
    canManageFees={canManageFees}
    editorOptions={editorOptions}
  />;
}
