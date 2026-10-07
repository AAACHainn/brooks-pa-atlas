import "server-only";
import { NextResponse } from "next/server";
import { RobotRequestError } from "@/lib/ai-robot-service";
import { robotErrorMessage, type RobotLocale } from "@/lib/ai-robot-types";

/** Keep database and upstream diagnostics out of browser responses. */
export function robotApiErrorDetails(error: unknown) {
  if (error instanceof RobotRequestError) return { code: error.code, status: error.status };
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "P2021" || code === "P2022") return { code: "storage_upgrade_required", status: 503 };
  if (code === "P2025") return { code: "not_found", status: 404 };
  return { code: "execution_failed", status: 500 };
}

export function robotApiErrorResponse(error: unknown, locale: RobotLocale = "zh") {
  const { code, status } = robotApiErrorDetails(error);
  return NextResponse.json({ code, error: robotErrorMessage(code, locale) }, { status });
}
