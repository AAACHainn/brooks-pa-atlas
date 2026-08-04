"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Info,
  PencilLine,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type AppDialogTone = "info" | "success" | "warning" | "danger";

type AppDialogRequest = {
  kind: "alert" | "confirm" | "prompt";
  title: string;
  message?: string;
  tone?: AppDialogTone;
  confirmLabel?: string;
  cancelLabel?: string;
  inputLabel?: string;
  initialValue?: string;
  placeholder?: string;
  required?: boolean;
};

type ActiveDialog = AppDialogRequest & { id: number };

const toneStyles = {
  info: {
    icon: Info,
    iconClass: "border-cyan-100 bg-cyan-50 text-cyan-700",
    buttonClass: "bg-zinc-950 text-white hover:bg-zinc-800 focus-visible:ring-zinc-400",
  },
  success: {
    icon: CheckCircle2,
    iconClass: "border-emerald-100 bg-emerald-50 text-emerald-700",
    buttonClass: "bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-300",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "border-amber-100 bg-amber-50 text-amber-700",
    buttonClass: "bg-zinc-950 text-white hover:bg-zinc-800 focus-visible:ring-zinc-400",
  },
  danger: {
    icon: CircleAlert,
    iconClass: "border-rose-100 bg-rose-50 text-rose-700",
    buttonClass: "bg-rose-700 text-white hover:bg-rose-800 focus-visible:ring-rose-300",
  },
} as const;

export function useAppDialog(defaultLabels: { confirm: string; cancel: string }) {
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const resolverRef = useRef<((value: boolean | string | null) => void) | null>(null);
  const sequenceRef = useRef(0);

  const open = useCallback((request: AppDialogRequest) => {
    resolverRef.current?.(null);
    return new Promise<boolean | string | null>((resolve) => {
      resolverRef.current = resolve;
      sequenceRef.current += 1;
      setDialog({ ...request, id: sequenceRef.current });
    });
  }, []);

  const close = useCallback((value: boolean | string | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolve?.(value);
  }, []);

  const showAlert = useCallback(
    async (request: Omit<AppDialogRequest, "kind">) => {
      await open({ ...request, kind: "alert" });
    },
    [open],
  );

  const showConfirm = useCallback(
    async (request: Omit<AppDialogRequest, "kind">) =>
      (await open({ ...request, kind: "confirm" })) === true,
    [open],
  );

  const showPrompt = useCallback(
    async (request: Omit<AppDialogRequest, "kind">) => {
      const result = await open({ ...request, kind: "prompt" });
      return typeof result === "string" ? result : null;
    },
    [open],
  );

  const dialogElement = dialog ? (
    <AppDialog
      key={dialog.id}
      dialog={dialog}
      defaultConfirmLabel={defaultLabels.confirm}
      defaultCancelLabel={defaultLabels.cancel}
      onClose={close}
    />
  ) : null;

  return { showAlert, showConfirm, showPrompt, dialogElement };
}

function AppDialog({
  dialog,
  defaultConfirmLabel,
  defaultCancelLabel,
  onClose,
}: {
  dialog: ActiveDialog;
  defaultConfirmLabel: string;
  defaultCancelLabel: string;
  onClose: (value: boolean | string | null) => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const inputId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [value, setValue] = useState(dialog.initialValue ?? "");
  const tone = dialog.tone ?? "info";
  const style = toneStyles[tone];
  const Icon = dialog.kind === "prompt" ? PencilLine : style.icon;
  const canConfirm = dialog.kind !== "prompt" || !dialog.required || value.trim().length > 0;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      (dialog.kind === "prompt" ? inputRef.current : confirmRef.current)?.focus();
      inputRef.current?.select();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(dialog.kind === "alert" ? true : null);
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [dialog.kind, onClose]);

  function confirm() {
    if (!canConfirm) return;
    onClose(dialog.kind === "prompt" ? value.trim() : true);
  }

  const content = (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-zinc-950/45 p-4 backdrop-blur-[2px]"
      role={dialog.kind === "alert" ? "alertdialog" : "dialog"}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={dialog.message ? messageId : undefined}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose(dialog.kind === "alert" ? true : null);
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/80 bg-white shadow-2xl shadow-zinc-950/20"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="h-1 bg-gradient-to-r from-cyan-500 via-cyan-300 to-transparent" />
        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-3.5">
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${style.iconClass}`}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <h2 id={titleId} className="text-base font-semibold tracking-tight text-zinc-950">
                {dialog.title}
              </h2>
              {dialog.message ? (
                <p id={messageId} className="mt-1.5 whitespace-pre-line text-sm leading-6 text-zinc-600">
                  {dialog.message}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onClose(dialog.kind === "alert" ? true : null)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              aria-label={defaultCancelLabel}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {dialog.kind === "prompt" ? (
            <div className="mt-5">
              {dialog.inputLabel ? (
                <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-zinc-600">
                  {dialog.inputLabel}
                </label>
              ) : null}
              <input
                ref={inputRef}
                id={inputId}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    confirm();
                  }
                }}
                placeholder={dialog.placeholder}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50/70 px-3.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100"
              />
            </div>
          ) : null}

          <div className="mt-6 flex justify-end gap-2.5">
            {dialog.kind !== "alert" ? (
              <button
                type="button"
                onClick={() => onClose(null)}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                {dialog.cancelLabel ?? defaultCancelLabel}
              </button>
            ) : null}
            <button
              ref={confirmRef}
              type="button"
              onClick={confirm}
              disabled={!canConfirm}
              className={`inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-medium shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${style.buttonClass}`}
            >
              {dialog.confirmLabel ?? defaultConfirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
