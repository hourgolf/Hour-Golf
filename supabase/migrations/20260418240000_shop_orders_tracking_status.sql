-- Live shipment tracking from Shippo webhooks. Adds three columns to
-- shop_orders to capture the latest tracking status and detail, plus
-- one column to tenant_shippo_config for the webhook signing secret.
--
-- shipping_status uses Shippo's broad status taxonomy lowercased:
--   label_created   our marker after purchaseLabel; before any
--                   carrier scan
--   pre_transit     label scanned but not yet picked up by carrier
--   transit         in motion through the carrier network
--   delivered       successfully delivered
--   returned        returned to sender
--   failure         delivery failed (lost, damaged, refused)
--   unknown         carrier hasn't reported anything actionable
-- shipping_status_detail holds the latest human-readable line from
-- the carrier (e.g. "Out for delivery in Portland, OR"). The
-- granularity Shippo passes through varies by carrier.
-- shipping_status_updated_at records the carrier's event timestamp.

alter table public.shop_orders
  add column if not exists shipping_status text,
  add column if not exists shipping_status_detail text,
  add column if not exists shipping_status_updated_at timestamptz;

alter table public.tenant_shippo_config
  add column if not exists tracking_webhook_secret text;
