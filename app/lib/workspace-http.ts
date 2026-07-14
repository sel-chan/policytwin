import { randomBytes } from "node:crypto";
import {
  WorkspaceHttpError,
  assertWorkspaceMutationHeaders,
  isWorkspaceCsrfToken,
  mapWorkspaceHttpError,
  readWorkspaceMutationBody as readWorkspaceMutationBodyCore,
  resolveWorkspacePublicOrigin,
} from "../../dist/workspace/http.js";

export const WORKSPACE_CSRF_COOKIE = "policytwin-workspace-csrf";
export const WORKSPACE_SESSION_COOKIE = "policytwin-workspace-session";

interface IssuedCookie {
  token: string;
  setCookie: boolean;
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return null;
}

export function workspaceJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie",
    },
  });
}

export function workspaceErrorResponse(error: unknown): Response {
  const mapped = mapWorkspaceHttpError(error);
  const response = workspaceJson({ error: mapped.code }, mapped.status);
  if (mapped.code === "WORKSPACE_CAPACITY") {
    response.headers.set("Retry-After", "3600");
  }
  return response;
}

function issueWorkspaceCookie(request: Request, name: string): IssuedCookie {
  const current = cookieValue(request.headers.get("cookie"), name);
  if (isWorkspaceCsrfToken(current)) {
    return { token: current, setCookie: false };
  }
  return { token: randomBytes(32).toString("base64url"), setCookie: true };
}

export function issueWorkspaceCsrf(request: Request): IssuedCookie {
  return issueWorkspaceCookie(request, WORKSPACE_CSRF_COOKIE);
}

export function issueWorkspaceSession(request: Request): IssuedCookie {
  secureWorkspaceCookie(request);
  const current = cookieValue(request.headers.get("cookie"), WORKSPACE_SESSION_COOKIE);
  if (isWorkspaceCsrfToken(current)) {
    return { token: current, setCookie: false };
  }
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    throw new WorkspaceHttpError(
      403,
      "FORBIDDEN_ORIGIN",
      "A new workspace session requires a same-origin browser request.",
    );
  }
  return { token: randomBytes(32).toString("base64url"), setCookie: true };
}

export function requireWorkspaceSession(request: Request): string {
  const token = cookieValue(request.headers.get("cookie"), WORKSPACE_SESSION_COOKIE);
  if (!isWorkspaceCsrfToken(token)) {
    throw new WorkspaceHttpError(403, "INVALID_SESSION", "Workspace session is invalid.");
  }
  return token;
}

export function workspacePublicOrigin(request: Request): string {
  return workspaceOriginSettings(request).origin;
}

function workspaceOriginSettings(request: Request) {
  return resolveWorkspacePublicOrigin({
    configuredOrigin: process.env.POLICYTWIN_PUBLIC_ORIGIN?.trim() || null,
    requestUrl: request.url,
    requestHost: request.headers.get("host"),
    production: process.env.NODE_ENV === "production",
    allowInsecureLoopback: process.env.POLICYTWIN_ALLOW_INSECURE_LOCALHOST === "1",
  });
}

function secureWorkspaceCookie(request: Request): boolean {
  return workspaceOriginSettings(request).secureCookie;
}

export function attachWorkspaceCookies(
  response: Response,
  request: Request,
  cookies: { csrf: IssuedCookie; session: IssuedCookie },
): Response {
  const secure = secureWorkspaceCookie(request) ? "; Secure" : "";
  for (const [name, issued] of [
    [WORKSPACE_CSRF_COOKIE, cookies.csrf],
    [WORKSPACE_SESSION_COOKIE, cookies.session],
  ] as const) {
    if (issued.setCookie) {
      response.headers.append(
        "Set-Cookie",
        `${name}=${issued.token}; Path=/api/policies/; Max-Age=86400; HttpOnly; SameSite=Strict${secure}`,
      );
    }
  }
  return response;
}

export function assertWorkspaceMutationRequest(request: Request): void {
  assertWorkspaceMutationHeaders({
    expectedOrigin: workspacePublicOrigin(request),
    contentType: request.headers.get("content-type"),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    csrfCookie: cookieValue(request.headers.get("cookie"), WORKSPACE_CSRF_COOKIE),
    csrfHeader: request.headers.get("x-policytwin-csrf"),
  });
}

export const readWorkspaceMutationBody = readWorkspaceMutationBodyCore;
