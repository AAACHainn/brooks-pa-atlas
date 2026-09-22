"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { annotationBaseColors, uniqueAnnotationColors } from "@/lib/annotation-colors";

type AnnotationColorPickerProps = {
  value: string;
  usedColors: string[];
  onChange: (color: string) => void;
  labels: {
    color: string;
    usedColors: string;
    baseColors: string;
    moreColors: string;
  };
};

function ColorSwatch({
  color,
  isSelected,
  onSelect,
}: {
  color: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid h-6 w-6 place-items-center rounded-full border transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-1 ${
        isSelected ? "border-cyan-700 ring-2 ring-cyan-600 ring-offset-1" : "border-zinc-300"
      }`}
      aria-label={color}
      title={color}
    >
      <span
        className="h-[18px] w-[18px] rounded-full border border-black/5"
        style={{ backgroundColor: color }}
      />
    </button>
  );
}

export default function AnnotationColorPicker({
  value,
  usedColors,
  onChange,
  labels,
}: AnnotationColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const customColorInputRef = useRef<HTMLInputElement | null>(null);
  const menuId = useId();
  const paletteUsedColors = uniqueAnnotationColors([value, ...usedColors]);
  const normalizedValue = value.toUpperCase();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  function chooseColor(color: string) {
    onChange(color);
    setIsOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-1.5 transition hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        aria-label={labels.color}
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={labels.color}
      >
        <span
          className="h-4 w-7 rounded-sm border border-zinc-300 shadow-inner"
          style={{ backgroundColor: value }}
        />
        <ChevronDown className={`h-3.5 w-3.5 text-zinc-500 transition ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen ? (
        <div
          id={menuId}
          role="dialog"
          aria-label={labels.color}
          className="absolute bottom-[calc(100%+6px)] left-0 z-50 w-64 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl shadow-zinc-950/15"
        >
          <div className="mb-3">
            <p className="mb-2 text-[11px] font-medium text-zinc-500">{labels.usedColors}</p>
            <div className="grid grid-cols-8 gap-1">
              {paletteUsedColors.map((color) => (
                <ColorSwatch
                  key={color}
                  color={color}
                  isSelected={normalizedValue === color}
                  onSelect={() => chooseColor(color)}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-medium text-zinc-500">{labels.baseColors}</p>
            <div className="grid grid-cols-8 gap-1">
              {annotationBaseColors.map((color) => (
                <ColorSwatch
                  key={color}
                  color={color}
                  isSelected={normalizedValue === color}
                  onSelect={() => chooseColor(color)}
                />
              ))}
            </div>
          </div>

          <div className="mt-3 border-t border-zinc-100 pt-2">
            <button
              type="button"
              onClick={() => customColorInputRef.current?.click()}
              className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              <span
                className="h-4 w-4 rounded-full border border-white shadow ring-1 ring-zinc-200"
                style={{
                  background:
                    "conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ef4444)",
                }}
              />
              <span className="flex-1">{labels.moreColors}</span>
              <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
            </button>
            <input
              ref={customColorInputRef}
              type="color"
              value={value}
              onChange={(event) => chooseColor(event.target.value)}
              className="sr-only"
              aria-label={labels.moreColors}
              tabIndex={-1}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
