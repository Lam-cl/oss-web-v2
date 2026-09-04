"use client";

import { useEffect, useRef, useState } from "react";
import {
  deriveSimUnits,
  indexLegacySimVariantBindings,
  type SimVariantBinding,
} from "@/lib/admin/simAssignments";
import { AdminApiError, adminFetch } from "@/lib/admin/client";
import { adminMediaUrl } from "@/lib/admin/mediaUrl";
import {
  indexAdminOrderItemPresentations,
  resolveAdminOrderItemPresentation,
} from "@/lib/admin/orderItemPresentation";
import { markReadyForCollection } from "@/lib/admin/readyCollectionEmail";
import { CATALOGUE_STOREFRONT_ENDPOINT } from "@/lib/catalogueStorefront";
import { pickupBundleStatus, pickupStatus } from "@/lib/pickup";
import {
  dateTime,
  money,
  Order,
  orderCustomer,
  orderCustomerId,
  orderDeliveryOption,
  orderEmail,
  orderFulfilmentStatus,
  orderGatewayReference,
  orderPaymentMethod,
  orderPaymentReference,
  orderPaymentStatus,
  orderPhone,
  orderPickupDate,
  orderTotal,
} from "@/lib/admin/types";
import { Icon } from "./Icons";
import { Confirm, Skeleton, StatusBadge } from "./UI";
import SimRangeAssignment, {
  type SimAssignmentResponse,
} from "./SimRangeAssignment";

const statuses = ["SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"];
const pickupLabels: Record<string, string> = {
  PENDING_COLLECTION: "Pending collection",
  READY_FOR_COLLECTION: "Ready for collection",
  COMPLETED: "Completed",
};
const collectionDateEditingEnabled = process.env.NEXT_PUBLIC_BUNDLE_COLLECTION_DATE_ENABLED !== "false";
type Courier = { id: number; name: string; code: string; isActive: boolean };
type BillingAddress = {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
};
type CourierMetadata = {
  service: string;
  trackingNo: string;
  expectedDeliveryDate: string;
  savedAt: string;
};
type FulfilmentMetadata = {
  billingAddress?: BillingAddress;
  courier?: CourierMetadata;
  updatedAt: string;
};

const formatAddress = (address?: BillingAddress) =>
  address
    ? [
        address.address,
        address.postalCode,
        address.city,
        address.state,
        address.country,
      ]
        .filter(Boolean)
        .join(", ")
    : "—";

export default function OrderDrawer({
  id,
  onClose,
  onSaved,
  onError,
}: {
  id: number;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [readyEmailOutcome, setReadyEmailOutcome] = useState<"unknown" | "failed" | null>(null);
  const statusOperationRef = useRef(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState("");
  const [simData, setSimData] = useState<SimAssignmentResponse | null>(null);
  const [metadata, setMetadata] = useState<FulfilmentMetadata | null>(null);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [courierId, setCourierId] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [collectionDate, setCollectionDate] = useState("");
  const [collectionDateBusy, setCollectionDateBusy] = useState(false);
  const [courierBusy, setCourierBusy] = useState(false);
  const [presentationIndex, setPresentationIndex] = useState(
    () => indexAdminOrderItemPresentations({ products: [] }),
  );
  const [simVariantBindings, setSimVariantBindings] =
    useState<SimVariantBinding>({});

  async function load() {
    try {
      const value = await adminFetch<Order>(`orders/${id}`);
      setOrder(value);
      setCollectionDate(orderPickupDate(value));
      const pickupOrder = orderDeliveryOption(value) === "PICKUP";
      setDraftStatus(
        pickupOrder
          ? pickupStatus(value.status)
          : statuses.includes(value.status)
            ? value.status
            : "",
      );
      const [savedMetadata, savedSims, liveCouriers, projection] =
        await Promise.all([
          adminFetch<FulfilmentMetadata>(`orders/${id}/fulfilment-metadata`),
          adminFetch<SimAssignmentResponse>(`orders/${id}/sim-assignments`),
          adminFetch<Courier[]>("couriers"),
          fetch(CATALOGUE_STOREFRONT_ENDPOINT, { cache: "no-store" }).then(
            (response) => (response.ok ? response.json() : { products: [] }),
          ),
        ]);
      setPresentationIndex(indexAdminOrderItemPresentations(projection));
      setSimVariantBindings(indexLegacySimVariantBindings(projection));
      setMetadata(savedMetadata);
      setSimData(
        savedSims.totalUnits > 0
          ? {
              ...savedSims,
              assignments: savedSims.assignments.map((unit) => ({
                ...unit,
                simPrefix: unit.simPrefix || "",
                simSerial: unit.simSerial || "",
              })),
            }
          : null,
      );
      setCouriers(liveCouriers);
      const bundleCourierId = Number(
        (value as any).courierId ||
          (value as any).courier?.id ||
          liveCouriers.find(
            (courier) => courier.name === savedMetadata.courier?.service,
          )?.id ||
          0,
      );
      setCourierId(bundleCourierId ? String(bundleCourierId) : "");
      setTrackingNo(
        String(
          (value as any).trackingCode ||
            savedMetadata.courier?.trackingNo ||
            "",
        ),
      );
      setExpectedDeliveryDate(
        savedMetadata.courier?.expectedDeliveryDate || "",
      );
    } catch (reason) {
      onError(
        reason instanceof Error ? reason.message : "Unable to load order.",
      );
    }
  }
  useEffect(() => {
    setReadyEmailOutcome(null);
    load();
  }, [id]);

  async function saveCourier() {
    if (!order || !courierId || !trackingNo.trim()) {
      onError("Select a courier service and enter a tracking number.");
      return;
    }
    setCourierBusy(true);
    try {
      await adminFetch(`orders/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({
          status: order.status,
          trackingCode: trackingNo.trim(),
          courierId: Number(courierId),
        }),
      });
      if (expectedDeliveryDate && !metadata?.courier) {
        const courier = couriers.find((item) => item.id === Number(courierId));
        if (courier)
          await adminFetch<FulfilmentMetadata>(
            `orders/${id}/fulfilment-metadata`,
            {
              method: "PUT",
              body: JSON.stringify({
                service: courier.name,
                trackingNo: trackingNo.trim(),
                expectedDeliveryDate,
              }),
            },
          );
      }
      onSaved("Courier information saved to Bundle.");
      await load();
    } catch (reason) {
      onError(
        reason instanceof Error
          ? reason.message
          : "Unable to save courier information.",
      );
    } finally {
      setCourierBusy(false);
    }
  }

  async function saveCollectionDate() {
    if (!order || !collectionDateEditingEnabled || !collectionDate || collectionDate === orderPickupDate(order)) return;
    setCollectionDateBusy(true);
    try {
      await adminFetch(`orders/${id}/collection-date`, {
        method: "PUT",
        body: JSON.stringify({
          collectionDate,
          expectedCollectionDate: orderPickupDate(order) || null,
        }),
      });
      onSaved("Collection date updated in Bundle. Future Ready for Collection emails will use the new date.");
      await load();
    } catch (reason) {
      if (reason instanceof AdminApiError && reason.status === 409) await load();
      onError(reason instanceof Error ? reason.message : "Unable to update the collection date.");
    } finally {
      setCollectionDateBusy(false);
    }
  }

  async function statusUpdate() {
    if (statusOperationRef.current) return;
    if (!order || !pendingStatus) return;
    if (
      pendingStatus === "CANCELLED" &&
      !["PENDING", "PROCESSING", "PAID"].includes(
        String(order.status).toUpperCase(),
      )
    ) {
      setPendingStatus(null);
      onError(
        "Only PENDING, PROCESSING or PAID orders can be cancelled and restocked.",
      );
      return;
    }
    if (
      pendingStatus === "SHIPPED" &&
      simData?.totalUnits &&
      simData.assignedUnits !== simData.totalUnits
    ) {
      setPendingStatus(null);
      onError(
        `Complete SIM assignments for all ${simData.totalUnits} SIM units before shipping.`,
      );
      return;
    }
    statusOperationRef.current = true;
    setBusy(true);
    try {
      const emailResult = pickup && pendingStatus === "READY_FOR_COLLECTION"
        ? await markReadyForCollection(id)
        : (await adminFetch(`orders/${id}/status`, {
            method: "PUT",
            body: JSON.stringify({
              status: pickup ? pickupBundleStatus(pendingStatus) : pendingStatus,
              trackingCode: trackingNo.trim() || undefined,
              courierId: courierId ? Number(courierId) : undefined,
            }),
          }), null);
      if (emailResult?.outcome === "status-unknown") {
        setReadyEmailOutcome(null);
        setPendingStatus(null);
        onError("Pickup status outcome is uncertain, so no email was sent. Retry Ready for collection to reconcile safely.");
        await load();
        return;
      }
      setReadyEmailOutcome(emailResult?.outcome === "unknown" || emailResult?.outcome === "failed" ? emailResult.outcome : null);
      setPendingStatus(null);
      onSaved(
        emailResult?.outcome === "sent"
          ? "Pickup status changed to Ready for collection. Ready for Collection email sent."
          : emailResult?.outcome === "unknown"
            ? "Pickup status changed to Ready for collection. Email outcome is uncertain; check with the recipient before any resend."
            : emailResult?.outcome === "failed"
              ? "Pickup status changed to Ready for collection. Ready for Collection email was not sent."
              : pickup
                ? `Pickup status changed to ${pickupLabels[pendingStatus]}.`
                : `Order status changed to ${draftStatus}.`,
      );
      await load();
    } catch (reason) {
      onError(
        reason instanceof Error ? reason.message : "Status update failed.",
      );
    } finally {
      statusOperationRef.current = false;
      setBusy(false);
    }
  }

  const address =
    order?.shippingAddresses ||
    order?.shippingAddress ||
    order?.deliveryAddress ||
    {};
  const items = order?.items || order?.orderItems || [];
  const pickup = order ? orderDeliveryOption(order) === "PICKUP" : false;
  const deliveryAddress =
    [
      address.address1 || address.address,
      address.address2,
      address.postcode || address.postalCode,
      address.city,
      address.state,
      address.country,
    ]
      .filter(Boolean)
      .join(", ") || "—";
  const availableStatuses = statuses.filter(
    (status) =>
      status !== "CANCELLED" ||
      ["PENDING", "PROCESSING", "PAID", "CANCELLED"].includes(
        String(order?.status || "").toUpperCase(),
      ),
  );
  const pickupFacingStatus = order && pickup ? pickupStatus(order.status) : "";
  const pickupTerminalStatus = Boolean(pickupFacingStatus && ![
    "PENDING_COLLECTION",
    "READY_FOR_COLLECTION",
    "COMPLETED",
  ].includes(pickupFacingStatus));

  return (
    <div className="adm-drawer-wrap">
      <button className="adm-modal-backdrop" onClick={onClose} />
      <section className="adm-drawer">
        <header className="adm-drawer-head">
          <div>
            <h2>Order #{id}</h2>
            <p>
              {order ? dateTime(order.createdAt) : "Loading order details…"}
            </p>
          </div>
          {order && <StatusBadge status={orderFulfilmentStatus(order)} />}
          <button className="adm-icon-btn" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="adm-drawer-body">
          {!order ? (
            <Skeleton rows={7} />
          ) : (
            <>
              <section className="adm-section">
                <h3 className="adm-section-title">Customer & delivery</h3>
                <div className="adm-kv">
                  <div>
                    <small>Customer</small>
                    <strong>{orderCustomer(order)}</strong>
                  </div>
                  <div>
                    <small>Email</small>
                    <strong>{orderEmail(order)}</strong>
                  </div>
                  <div>
                    <small>Phone</small>
                    <strong>{orderPhone(order)}</strong>
                  </div>
                  <div>
                    <small>NRIC / Passport</small>
                    <strong>{orderCustomerId(order) || "—"}</strong>
                  </div>
                  <div className="adm-kv-wide">
                    <small>
                      {pickup ? "Pickup location" : "Delivery address"}
                    </small>
                    <strong>{deliveryAddress}</strong>
                  </div>
                </div>
              </section>
              {pickup && (
                <section className="adm-section">
                  <h3 className="adm-section-title">Billing Address</h3>
                  <div className="adm-kv">
                    <div>
                      <small>Name</small>
                      <strong>
                        {metadata?.billingAddress?.fullName || "—"}
                      </strong>
                    </div>
                    <div>
                      <small>Phone</small>
                      <strong>{metadata?.billingAddress?.phone || "—"}</strong>
                    </div>
                    <div className="adm-kv-wide">
                      <small>Invoice address</small>
                      <strong>{formatAddress(metadata?.billingAddress)}</strong>
                    </div>
                  </div>
                </section>
              )}
              <section className="adm-section">
                <h3 className="adm-section-title">Items</h3>
                <div className="adm-items">
                  {items.length ? (
                    items.map((item: any, index: number) => {
                      const presentation = resolveAdminOrderItemPresentation(item, presentationIndex, index);
                      return (
                        <div className="adm-order-item" key={item.id || index}>
                          {item.product?.images?.[0]?.url && (
                            <img src={adminMediaUrl(item.product.images[0].url)} alt="" />
                          )}
                          <div>
                            <strong>
                              {presentation.title}
                            </strong>
                            <small>
                              {presentation.variantLabels.length
                                ? `Variant: ${presentation.variantLabels.join(" · ")} · `
                                : ""}
                              {presentation.productCode}{" "}
                              · Qty {item.quantity || 1}
                            </small>
                          </div>
                          <strong>
                            {money(
                              item.total ||
                                Number(item.price || 0) *
                                  Number(item.quantity || 1),
                            )}
                          </strong>
                        </div>
                      );
                    })
                  ) : (
                    <p className="adm-hint">No item data returned.</p>
                  )}
                </div>
              </section>
              {simData && simData.totalUnits > 0 && (
                <SimRangeAssignment
                  orderId={id}
                  data={simData}
                  orderItems={items}
                  variantBindings={simVariantBindings}
                  onSaved={onSaved}
                  onError={onError}
                  onReload={load}
                />
              )}
              {!pickup && (
                <section className="adm-section">
                  <h3 className="adm-section-title">Courier</h3>
                  <div className="adm-form-grid">
                    <label className="adm-field">
                      Courier service
                      <select
                        value={courierId}
                        onChange={(event) => setCourierId(event.target.value)}
                      >
                        <option value="" disabled>
                          Select courier
                        </option>
                        {couriers.map((courier) => (
                          <option key={courier.id} value={courier.id}>
                            {courier.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="adm-field">
                      Tracking number
                      <input
                        value={trackingNo}
                        onChange={(event) => setTrackingNo(event.target.value)}
                      />
                    </label>
                    <label className="adm-field">
                      Expected delivery date
                      <input
                        type="date"
                        value={expectedDeliveryDate}
                        disabled={Boolean(metadata?.courier)}
                        onChange={(event) =>
                          setExpectedDeliveryDate(event.target.value)
                        }
                      />
                    </label>
                    <div className="adm-field adm-field-action">
                      <button
                        type="button"
                        className="adm-button courier-save"
                        disabled={courierBusy}
                        onClick={saveCourier}
                      >
                        {courierBusy ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                </section>
              )}
              <section className="adm-section">
                <h3 className="adm-section-title">Payment</h3>
                <div className="adm-kv">
                  <div>
                    <small>Total</small>
                    <strong>{money(orderTotal(order))}</strong>
                  </div>
                  <div>
                    <small>Method</small>
                    <strong>{orderPaymentMethod(order)}</strong>
                  </div>
                  <div>
                    <small>Payment status</small>
                    <strong>{orderPaymentStatus(order)}</strong>
                  </div>
                  <div>
                    <small>PO Number</small>
                    <strong>{orderPaymentReference(order)}</strong>
                  </div>
                  <div>
                    <small>Reference Number</small>
                    <strong>{orderGatewayReference(order)}</strong>
                  </div>
                </div>
              </section>
              <form id="order-fields">
                <section className="adm-section">
                  <h3 className="adm-section-title">Fulfilment status</h3>
                  <div className="adm-form-grid">
                    <label className="adm-field">
                      Delivery option
                      <select
                        name="deliveryOption"
                        defaultValue={
                          orderDeliveryOption(order) === "—"
                            ? ""
                            : orderDeliveryOption(order)
                        }
                      >
                        <option value="">Not set</option>
                        <option value="DELIVER">Deliver</option>
                        <option value="PICKUP">Pickup</option>
                      </select>
                    </label>
                    {pickup && (
                      <>
                        <label className="adm-field">
                          Collection date
                          <input
                            type="date"
                            value={collectionDate}
                            disabled={!collectionDateEditingEnabled || collectionDateBusy}
                            onChange={(event) => setCollectionDate(event.target.value)}
                          />
                          {!collectionDateEditingEnabled && <small>Collection date editing is disabled by configuration.</small>}
                        </label>
                        {collectionDateEditingEnabled && (
                          <div className="adm-field adm-field-action">
                            <button
                              type="button"
                              className="adm-button secondary"
                              disabled={collectionDateBusy || !collectionDate || collectionDate === orderPickupDate(order)}
                              onClick={() => void saveCollectionDate()}
                            >
                              {collectionDateBusy ? "Saving…" : "Save date"}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                    <label className="adm-field">
                      {pickup ? "Pickup status" : "Order status"}
                      <select
                        value={draftStatus}
                        onChange={(event) => setDraftStatus(event.target.value)}
                      >
                        {pickup ? (
                          <>
                            {pickupTerminalStatus && (
                              <option value={pickupFacingStatus} disabled>
                                {pickupFacingStatus.replaceAll("_", " ")}
                              </option>
                            )}
                            <option value="PENDING_COLLECTION" disabled>
                              Pending collection
                            </option>
                            <option value="READY_FOR_COLLECTION">
                              Ready for collection
                            </option>
                            <option value="COMPLETED">Completed</option>
                          </>
                        ) : (
                          <>
                            <option value="" disabled>
                              Select next status
                            </option>
                            {availableStatuses.map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </label>
                  </div>
                </section>
              </form>
              {readyEmailOutcome && (
                <div className="adm-hint" role="alert">
                  {readyEmailOutcome === "unknown"
                    ? "Status updated, but the email outcome is uncertain. Check with the recipient before any future resend."
                    : "Status updated, but the Ready for Collection email was not sent."}
                </div>
              )}
            </>
          )}
        </div>
        <footer className="adm-drawer-foot">
          <button className="adm-button secondary" onClick={onClose}>
            Close
          </button>
          {order && (
            <button
              className="adm-button"
              disabled={
                busy ||
                pickupTerminalStatus ||
                !draftStatus ||
                draftStatus ===
                  (pickup ? pickupStatus(order.status) : order.status)
              }
              onClick={() => setPendingStatus(draftStatus)}
            >
              Update status
            </button>
          )}
        </footer>
      </section>
      <Confirm
        open={Boolean(pendingStatus)}
        title="Change order status?"
        message={
          pickup
            ? `Order #${id} pickup will change to ${pickupLabels[pendingStatus || ""]}.`
            : `Order #${id} will change from ${order?.status} to ${pendingStatus}. This may affect fulfilment and customer communication.`
        }
        confirmLabel={
          pickup
            ? `Change to ${pickupLabels[pendingStatus || ""]}`
            : `Change to ${pendingStatus}`
        }
        danger={["CANCELLED", "REFUNDED"].includes(pendingStatus || "")}
        busy={busy}
        onClose={() => setPendingStatus(null)}
        onConfirm={statusUpdate}
      />
    </div>
  );
}
