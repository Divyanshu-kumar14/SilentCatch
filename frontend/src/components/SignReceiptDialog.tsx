"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck } from "lucide-react";

interface SignReceiptDialogProps {
  open: boolean;
  onClose: () => void;
  encounterId: string;
  diagnosis: string;
  elapsedMs: number | null;
  costLabel: string;
}

function SignReceiptDialog({
  open,
  onClose,
  encounterId,
  diagnosis,
  elapsedMs,
  costLabel,
}: SignReceiptDialogProps) {
  const doneRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    doneRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.getElementById("sign-discharge-btn")?.focus();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            onClick={() => onCloseRef.current()}
            className="absolute inset-0 bg-ink/45"
          />
          <motion.div
            data-testid="sign-receipt-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-receipt-title"
            aria-describedby="sign-receipt-desc"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-sm border border-edge bg-sheet"
          >
            <div className="border-b border-edge px-4 py-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-safe" aria-hidden />
                <h2
                  id="sign-receipt-title"
                  className="text-[14px] font-medium tracking-[-0.01em] text-ink"
                >
                  Discharge authorized
                </h2>
              </div>
              <p
                id="sign-receipt-desc"
                className="mt-1.5 text-[12.5px] leading-[1.5] text-muted"
              >
                Discharge authorized: patient packet signed and transmitted to the
                EHR.
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-2 px-4 py-3">
              <div className="border border-edge bg-sheet-2 px-2.5 py-2">
                <dt className="label mb-1">Encounter</dt>
                <dd
                  className="mono truncate text-[11.5px] text-ink-2"
                  title={encounterId}
                >
                  {encounterId}
                </dd>
              </div>
              <div className="border border-edge bg-sheet-2 px-2.5 py-2">
                <dt className="label mb-1">Diagnosis</dt>
                <dd
                  className="truncate text-[11.5px] leading-[1.45] text-ink-2"
                  title={diagnosis}
                >
                  {diagnosis}
                </dd>
              </div>
              <div className="border border-edge bg-sheet-2 px-2.5 py-2">
                <dt className="label mb-1">Audit time</dt>
                <dd className="mono text-[11.5px] text-ink-2">
                  {elapsedMs === null ? "—" : `${elapsedMs} ms`}
                </dd>
              </div>
              <div className="border border-edge bg-sheet-2 px-2.5 py-2">
                <dt className="label mb-1">Cost</dt>
                <dd className="mono text-[11.5px] text-ink-2">{costLabel}</dd>
              </div>
            </dl>

            <div className="flex justify-end border-t border-edge px-4 py-3">
              <button
                ref={doneRef}
                onClick={onClose}
                className="flex h-8 items-center bg-ink px-4 text-[12px] font-medium text-sheet transition-colors hover:bg-ink-2"
              >
                Done
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default SignReceiptDialog;
