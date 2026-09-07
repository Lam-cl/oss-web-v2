# Merchandise gateway payment selection

Bundle checkout documentation marks paymentMethodId optional. The merchandise website now omits it from the request, removes its local required allowlist and ignores legacy clients' supplied IDs. It does not invent a paymentType field. The gateway response parameters remain unchanged except for the existing storefront return URL override.

The inactive website radio selector is replaced with neutral gateway guidance. Separate SIM/ADX checkout routes are unchanged; products bought through the merchandise cart use the merchandise checkout behavior.

Requested gateway options are TNG ECOMM, FPX ONLINE BANKING and Master Credit. Their availability and the merchant recipient account are controlled upstream and are not verified by this code change. Tester must confirm gateway options and the intended recipient before making payment. No live checkout/order is created by automated verification.

Verification covers missing and legacy IDs with the real checkout handler and mocked upstream/metadata storage, amount and return URL preservation, metadata preflight/recovery, and browser submission without method/type fields. Run the full regression suite, production build and read-only release smoke before/after deployment. Release separately from baseline 23f30b56454e430ae8961ae993d0d59daf1c6bf2; prepare an additive rollback restoring that baseline, retaining its metadata fix and open checkout. Do not force-push or modify historical orders.

Pre-deploy verification: 122/123 suite checks passed; the unchanged catalogue media store check hit the runner's 60-second timeout and passed standalone, so all 123 checks passed across the suite and rerun. Next production build/TypeScript, ten local HTTP smoke checks, and built checkout desktop/mobile browser checks passed. The browser test waits for form hydration before asserting the gateway guidance. Evidence/rollback record: /root/.codex/backups/tonewow/20260907-gateway-method-B9J2AY/.
