# Examples

Runnable, offline scripts — no daemon, no network, no funds. They generate a
throwaway key and a synthetic UTXO, so they are safe to run as-is.

```bash
pnpm install
pnpm build && pnpm bundle
node examples/transfer.cjs
```

In **your** project you import the package by name:

```ts
import { VerusSDK, utils } from "@chainvue/verus-sdk";
```

These scripts load the freshly built bundle by relative path
(`require("../dist/bundle.js")`) so they run inside this repo without a publish
or a link step — the one line that differs from consumer code.

| File | Shows |
|---|---|
| `amounts.cjs` | `parseSats` / `toCoins` / `toSafeNumber` — the money edge |
| `keygen-and-address.cjs` | `generateWif`, `deriveAddress`, `deriveIdentityAddress`, `validate*` |
| `transfer.cjs` | build + sign a native transfer offline, then decode it back |
| `sign-verify-message.cjs` | VerusID message sign → verify roundtrip |
| `create-currency.cjs` | build token / fractional-basket / NFT definition scripts offline |
