import "server-only";

export function isLocalClientDataModeEnabled() {
  return process.env.NODE_ENV !== "production"
    && process.env.APP_ENV === "development"
    && process.env.ENABLE_LOCAL_CLIENT_DATA === "true";
}
