-- Shop-request photo uploads.
--
-- Lets members attach a snapped photo or an image they found online to
-- their "request an item" submission. Single URL column — if members ever
-- need multiple photos per request, convert to a sibling `shop_request_images`
-- table later. One photo covers 95% of the expected use case and keeps
-- the frontend simple.

alter table public.shop_requests add column if not exists image_url text;
