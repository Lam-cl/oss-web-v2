"use client";

import { useMemo, useRef, useState } from "react";
import { adminFetch } from "@/lib/admin/client";
import {
  itemVariantId,
  type SimPrefixOption,
  type SimVariantBinding,
} from "@/lib/admin/simAssignments";

export type SimAssignmentUnit = {
  orderItemId: number;
  unitNumber: number;
  productTitle: string;
  assigned: boolean;
  simPrefix: string;
  simSerial: string;
};

export type SimAssignmentResponse = {
  orderId: number;
  status: string;
  totalUnits: number;
  assignedUnits: number;
  complete: boolean;
  assignments: SimAssignmentUnit[];
  prefixOptions: SimPrefixOption[];
};

type ProductCode = "TWE" | "TWP";
type RangeDraft = {
  id: string;
  prefixId: string;
  startSerial: string;
  endSerial: string;
  status: "idle" | "validating" | "valid" | "error";
  token?: string;
  error?: string;
};

const newRange = (
  id = `${Date.now()}-${Math.random().toString(36).slice(2)}`,
): RangeDraft => ({
  id,
  prefixId: "",
  startSerial: "",
  endSerial: "",
  status: "idle",
});

function serialQuantity(range: Pick<RangeDraft, "startSerial" | "endSerial">) {
  if (
    !/^\d{10,11}$/.test(range.startSerial) ||
    !/^\d{10,11}$/.test(range.endSerial)
  )
    return 0;
  const start = Number(range.startSerial.slice(0, 10));
  const end = Number(range.endSerial.slice(0, 10));
  if (end < start) return 0;
  const quantity = end - start + 1;
  return Number.isSafeInteger(quantity) ? quantity : 0;
}

export default function SimRangeAssignment({
  orderId,
  data,
  orderItems,
  variantBindings,
  onSaved,
  onError,
  onReload,
}: {
  orderId: number;
  data: SimAssignmentResponse;
  orderItems: any[];
  variantBindings: SimVariantBinding;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
  onReload: () => Promise<void>;
}) {
  const groups = useMemo(() => {
    const grouped = new Map<number, SimAssignmentUnit[]>();
    data.assignments.forEach((unit) =>
      grouped.set(unit.orderItemId, [
        ...(grouped.get(unit.orderItemId) || []),
        unit,
      ]),
    );
    return Array.from(grouped.entries()).map(([orderItemId, units]) => {
      const item = orderItems.find(
        (candidate) =>
          Number(candidate.id || candidate.orderItemId) === orderItemId,
      );
      return {
        orderItemId,
        units,
        item,
        productCode:
          variantBindings[itemVariantId(item) || 0]?.productCode || "",
      };
    });
  }, [data.assignments, orderItems, variantBindings]);
  const [rangesByItem, setRangesByItem] = useState<
    Record<number, RangeDraft[]>
  >({});
  const [legacyCodes, setLegacyCodes] = useState<
    Record<number, ProductCode | "">
  >({});
  const [busyItem, setBusyItem] = useState<number | null>(null);
  const [scanner, setScanner] = useState<{
    orderItemId: number;
    rangeId: string;
    field: "startSerial" | "endSerial";
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControls = useRef<{ stop: () => void } | null>(null);

  const initialRange = (orderItemId: number) =>
    newRange(`initial-${orderItemId}`);
  const rangesFor = (orderItemId: number) =>
    rangesByItem[orderItemId] || [initialRange(orderItemId)];
  const commitRanges = (
    orderItemId: number,
    updater: (ranges: RangeDraft[]) => RangeDraft[],
  ) => {
    setRangesByItem((previous) => ({
      ...previous,
      [orderItemId]: updater(
        previous[orderItemId] || [initialRange(orderItemId)],
      ),
    }));
  };
  const patchRange = (
    orderItemId: number,
    rangeId: string,
    patch: Partial<RangeDraft>,
  ) =>
    commitRanges(orderItemId, (ranges) =>
      ranges.map((range) =>
        range.id === rangeId
          ? {
              ...range,
              ...patch,
              status: patch.status || "idle",
              token: patch.status === "valid" ? patch.token : undefined,
              error: patch.error,
            }
          : range,
      ),
    );

  async function startScanner(target: {
    orderItemId: number;
    rangeId: string;
    field: "startSerial" | "endSerial";
  }) {
    setScanner(target);
    window.setTimeout(async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        if (!videoRef.current) return;
        scannerControls.current = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result) => {
            if (!result) return;
            const barcode = result.getText().replace(/\D/g, "");
            if (barcode.length !== 20) {
              onError("SIM barcode must contain exactly 20 digits.");
              return;
            }
            const prefix = data.prefixOptions.find(
              (option) => option.prefix === barcode.slice(0, 9),
            );
            if (!prefix) {
              onError("The scanned SIM prefix is not recognised.");
              return;
            }
            patchRange(target.orderItemId, target.rangeId, {
              prefixId: prefix.id,
              [target.field]: barcode.slice(9),
            });
            scannerControls.current?.stop();
            scannerControls.current = null;
            setScanner(null);
          },
        );
      } catch {
        setScanner(null);
        onError(
          "Camera scanning is unavailable. Enter the 11-digit SIM serial manually.",
        );
      }
    }, 0);
  }

  function closeScanner() {
    scannerControls.current?.stop();
    scannerControls.current = null;
    setScanner(null);
  }

  async function validateLine(
    orderItemId: number,
    productCode: ProductCode,
    requiredQuantity: number,
  ) {
    const ranges = rangesFor(orderItemId);
    const quantity = ranges.reduce(
      (total, range) => total + serialQuantity(range),
      0,
    );
    if (quantity !== requiredQuantity) {
      onError(
        `Range quantity must equal ${requiredQuantity} unassigned SIM units.`,
      );
      return;
    }
    if (
      ranges.some(
        (range) =>
          !range.prefixId ||
          !/^\d{10,11}$/.test(range.startSerial) ||
          !/^\d{10,11}$/.test(range.endSerial),
      )
    ) {
      onError(
        "Select a prefix and enter the first 10 digits of the Starting and Ending SN. An optional 11th digit is accepted.",
      );
      return;
    }
    const intervals = ranges.map((range) => ({
      prefixId: range.prefixId,
      start: Number(range.startSerial.slice(0, 10)),
      end: Number(range.endSerial.slice(0, 10)),
    }));
    if (
      intervals.some((range, index) =>
        intervals.some(
          (other, otherIndex) =>
            index !== otherIndex &&
            range.prefixId === other.prefixId &&
            range.start <= other.end &&
            other.start <= range.end,
        ),
      )
    ) {
      onError("SIM ranges for the same prefix must not overlap.");
      return;
    }
    setBusyItem(orderItemId);
    try {
      for (const range of ranges) {
        patchRange(orderItemId, range.id, {
          status: "validating",
          error: undefined,
        });
        const prefix = data.prefixOptions.find(
          (option) => option.id === range.prefixId,
        );
        if (!prefix) throw new Error("Selected SIM prefix is unavailable.");
        try {
          const result = await adminFetch<{
            quantity: number;
            assignmentToken: string;
          }>(`orders/${orderId}/sim-range-validation`, {
            method: "POST",
            timeoutMs: 30_000,
            body: JSON.stringify({
              orderItemId,
              productCode,
              prefixId: prefix.id,
              simPrefix: prefix.prefix,
              startSerial: range.startSerial,
              endSerial: range.endSerial,
            }),
          });
          patchRange(orderItemId, range.id, {
            status: "valid",
            token: result.assignmentToken,
            error: undefined,
          });
        } catch (reason) {
          patchRange(orderItemId, range.id, {
            status: "error",
            error:
              reason instanceof Error ? reason.message : "Validation failed.",
          });
          throw reason;
        }
      }
      onSaved(
        `All ${quantity} SIM serials are valid. Review and save the assignments.`,
      );
    } catch (reason) {
      onError(
        reason instanceof Error ? reason.message : "SIM validation failed.",
      );
    } finally {
      setBusyItem(null);
    }
  }

  async function saveLine(orderItemId: number) {
    const ranges = rangesFor(orderItemId);
    if (ranges.some((range) => range.status !== "valid" || !range.token)) {
      onError("Validate every SIM range before saving.");
      return;
    }
    setBusyItem(orderItemId);
    try {
      await adminFetch(`orders/${orderId}/sim-range-assignments`, {
        method: "PUT",
        body: JSON.stringify({ tokens: ranges.map((range) => range.token) }),
      });
      setRangesByItem((previous) => ({
        ...previous,
        [orderItemId]: [initialRange(orderItemId)],
      }));
      onSaved("SIM assignments saved and locked.");
      await onReload();
    } catch (reason) {
      onError(
        reason instanceof Error
          ? reason.message
          : "Unable to save SIM assignments.",
      );
    } finally {
      setBusyItem(null);
    }
  }

  return (
    <section className="adm-section">
      <div className="adm-sim-head">
        <h3 className="adm-section-title">SIM Assignment</h3>
        <span className="adm-sim-count">
          {data.assignedUnits} / {data.totalUnits} complete
        </span>
      </div>
      {groups.map((group) => {
        const unassigned = group.units.filter(
          (unit: SimAssignmentUnit) => !unit.assigned,
        );
        const assigned = group.units.filter(
          (unit: SimAssignmentUnit) => unit.assigned,
        );
        const ranges = rangesFor(group.orderItemId);
        const productCode =
          group.productCode || legacyCodes[group.orderItemId] || "";
        const totalQuantity = ranges.reduce(
          (total, range) => total + serialQuantity(range),
          0,
        );
        return (
          <article className="adm-sim-line" key={group.orderItemId}>
            <div className="adm-sim-line-head">
              <div>
                <strong>{group.units[0]?.productTitle}</strong>
                <small>
                  {unassigned.length} unassigned unit
                  {unassigned.length === 1 ? "" : "s"}
                </small>
              </div>
              <span
                className={
                  totalQuantity === unassigned.length ? "is-complete" : ""
                }
              >
                {totalQuantity} / {unassigned.length}
              </span>
            </div>
            {!group.productCode && unassigned.length > 0 && (
              <label className="adm-field adm-sim-legacy">
                Variant for historical order
                <select
                  value={productCode}
                  onChange={(event) =>
                    setLegacyCodes((previous) => ({
                      ...previous,
                      [group.orderItemId]: event.target.value as ProductCode,
                    }))
                  }
                >
                  <option value="">Select variant</option>
                  <option value="TWE">Tone Excel</option>
                  <option value="TWP">Tone Plus</option>
                </select>
              </label>
            )}
            {assigned.length > 0 && (
              <div className="adm-sim-assigned">
                {assigned.map((unit: SimAssignmentUnit) => (
                  <span key={unit.unitNumber}>
                    {unit.simPrefix}
                    {unit.simSerial}
                  </span>
                ))}
              </div>
            )}
            {unassigned.length > 0 && (
              <>
                <div className="adm-sim-ranges">
                  {ranges.map((range, index) => (
                    <div
                      className={`adm-sim-range is-${range.status}`}
                      key={range.id}
                    >
                      <strong>Range {index + 1}</strong>
                      <label className="adm-field">
                        SIM prefix
                        <select
                          value={range.prefixId}
                          disabled={busyItem === group.orderItemId}
                          onChange={(event) =>
                            patchRange(group.orderItemId, range.id, {
                              prefixId: event.target.value,
                            })
                          }
                        >
                          <option value="">Select prefix</option>
                          {data.prefixOptions.map((option) => (
                            <option value={option.id} key={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="adm-field">
                        Starting SN
                        <div className="adm-sim-scan-input">
                          <input
                            inputMode="numeric"
                            maxLength={11}
                            placeholder="First 10 digits"
                            value={range.startSerial}
                            disabled={busyItem === group.orderItemId}
                            onChange={(event) =>
                              patchRange(group.orderItemId, range.id, {
                                startSerial: event.target.value
                                  .replace(/\D/g, "")
                                  .slice(0, 11),
                              })
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              startScanner({
                                orderItemId: group.orderItemId,
                                rangeId: range.id,
                                field: "startSerial",
                              })
                            }
                          >
                            Scan
                          </button>
                        </div>
                      </label>
                      <label className="adm-field">
                        Ending SN
                        <div className="adm-sim-scan-input">
                          <input
                            inputMode="numeric"
                            maxLength={11}
                            placeholder="First 10 digits"
                            value={range.endSerial}
                            disabled={busyItem === group.orderItemId}
                            onChange={(event) =>
                              patchRange(group.orderItemId, range.id, {
                                endSerial: event.target.value
                                  .replace(/\D/g, "")
                                  .slice(0, 11),
                              })
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              startScanner({
                                orderItemId: group.orderItemId,
                                rangeId: range.id,
                                field: "endSerial",
                              })
                            }
                          >
                            Scan
                          </button>
                        </div>
                      </label>
                      <div className="adm-sim-range-qty">
                        <small>Quantity</small>
                        <strong>{serialQuantity(range)}</strong>
                        {range.status === "validating" && (
                          <span>Checking…</span>
                        )}
                        {range.status === "valid" && <span>Valid</span>}
                        {range.error && <span>{range.error}</span>}
                      </div>
                      {ranges.length > 1 && (
                        <button
                          type="button"
                          className="adm-sim-remove"
                          disabled={busyItem === group.orderItemId}
                          onClick={() =>
                            commitRanges(group.orderItemId, (current) =>
                              current.filter((item) => item.id !== range.id),
                            )
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="adm-sim-actions">
                  <button
                    type="button"
                    className="adm-button secondary"
                    disabled={busyItem === group.orderItemId}
                    onClick={() =>
                      commitRanges(group.orderItemId, (current) => [
                        ...current,
                        newRange(),
                      ])
                    }
                  >
                    Add Range
                  </button>
                  <button
                    type="button"
                    className="adm-button secondary"
                    disabled={busyItem === group.orderItemId || !productCode}
                    onClick={() =>
                      productCode &&
                      validateLine(
                        group.orderItemId,
                        productCode,
                        unassigned.length,
                      )
                    }
                  >
                    {busyItem === group.orderItemId
                      ? "Validating…"
                      : "Validate ranges"}
                  </button>
                  <button
                    type="button"
                    className="adm-button"
                    disabled={
                      busyItem === group.orderItemId ||
                      ranges.some((range) => range.status !== "valid")
                    }
                    onClick={() => saveLine(group.orderItemId)}
                  >
                    Save SIM
                  </button>
                </div>
              </>
            )}
          </article>
        );
      })}
      {scanner && (
        <div
          className="adm-scan-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Scan SIM barcode"
        >
          <button
            type="button"
            className="adm-modal-backdrop"
            onClick={closeScanner}
          />
          <div>
            <h3>Scan 20-digit SIM barcode</h3>
            <video ref={videoRef} muted playsInline />
            <p>Keep the complete barcode inside the camera frame.</p>
            <button
              type="button"
              className="adm-button secondary"
              onClick={closeScanner}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
