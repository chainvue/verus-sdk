# VerusID lifecycle

The SDK builds and signs every transaction in a VerusID's life: registration
(a two-step commit/reveal), updates, the lock/unlock cycle, and the
revoke/recover authority flow. Each method returns signed hex you broadcast
yourself; none of them touch the network.

Amounts are `bigint` satoshis (see [amounts](./amounts.md)). Every build here
also takes a required `expiryHeight` (omitted from the snippets below for
brevity) — see [Transaction expiry](./transfers.md#transaction-expiry-required).

## Deriving an i-address

An identity's i-address is deterministic from its name (and parent, for
sub-IDs) — you can compute it before the identity exists:

```ts
VerusSDK.deriveIdentityAddress("alice");             // "i…"
VerusSDK.deriveIdentityAddress("sub", "i…parent");   // sub-ID under a parent
```

## Registration — commit, then register

Registration is commit/reveal, two transactions. **Broadcast the commitment and
wait for it to confirm before building the registration** — the registration
spends the commitment's output.

```ts
// 1. Commit to the name.
const commit = sdk.createCommitment({
  wif,
  name: "alice",
  utxos,
  changeAddress,
  expiryHeight: tipHeight + 20,   // required
  // referral?, parent? (for a sub-ID)
});
// → { signedTx, txid, identityAddress, commitmentData }
// broadcast commit.signedTx, wait for confirmation, then read back the
// commitment UTXO it created.

// 2. Register, revealing the commitment.
const reg = sdk.registerIdentity({
  wif,
  commitmentUtxo,                 // the output created by step 1
  commitmentData: commit.commitmentData,
  primaryAddresses: ["R…"],
  minSigs: 1,
  revocationAuthority: "i…",      // optional; defaults to self
  recoveryAuthority: "i…",        // optional; defaults to self
  utxos,
  changeAddress,
  // referralChain?, registrationFee? (default 100 VRSC), sub-ID fee fields …
});
// → { signedTx, txid, identityAddress, registrationFee, referralPayments, … }
```

`commitmentData` (name, salt, referral, parent, reservation hex, commitment
hash) is the secret link between the two steps — carry it across from step 1
verbatim. Sub-IDs pass `parent` in step 1 and the parent-currency fee fields
(`registrationFeeAmount`, `nativeImportFee`) in step 2.

## Updating an identity

`updateIdentity` changes primary addresses, signing threshold, authorities, or
attached content. It needs the identity's current serialized form
(`identityHex`) and the UTXO holding it (`identityUtxo`) — both read back from
the daemon (`getidentity` / the identity's controlling output).

```ts
sdk.updateIdentity({
  wif,
  identityHex,                    // current identity, serialized
  identityUtxo,                   // the output that carries it
  primaryAddresses: ["R…", "R…"],
  minSigs: 2,
  revocationAuthority: "i…",
  recoveryAuthority: "i…",
  contentMap: { "vdxf-key": "hex" },
  contentMultimap: { "vdxf-key": ["hex", "hex"] },
  utxos,
  changeAddress,
});
// → { signedTx, txid, identityAddress, operation: "update", … }
```

## Lock and unlock

Locking an identity disables spending/updates until a height; unlocking starts
the delay timer back down.

```ts
sdk.lockIdentity({   wif, identityHex, identityUtxo, unlockAfter: 200_000, utxos, changeAddress });
sdk.unlockIdentity({ wif, identityHex, identityUtxo, utxos, changeAddress });
```

`unlockAfter` is the block height (or delay) after which the identity can be
unlocked.

## Revoke and recover

These use the identity's revocation and recovery **authorities** — sign with
the key that holds the relevant authority, not necessarily the primary key.

```ts
// Revoke — needs the revocation authority key.
sdk.revokeIdentity({ wif, identityHex, identityUtxo, utxos, changeAddress });

// Recover — needs the recovery authority key; can reset primaries/authorities.
sdk.recoverIdentity({
  wif,
  identityHex,
  identityUtxo,
  primaryAddresses: ["R…"],       // optional reset
  revocationAuthority: "i…",      // optional reset
  recoveryAuthority: "i…",        // optional reset
  utxos,
  changeAddress,
});
```

All four update-family methods return an `UpdateIdentityResult` —
`{ signedTx, txid, identityAddress, operation, inputsUsed, nativeChange }`.

## Signing and verifying messages

A VerusID can sign an arbitrary message; verification checks the signature
against the identity's controlling address.

```ts
const sig = sdk.signMessage({
  wif,
  message: "hello",
  identityAddress: "i…",
  // chainId?, blockHeight?, version? (1 | 2)
});
// → { signature, identitySignatureHex, signingAddress, blockHeight, … }

const { valid } = sdk.verifyMessage({
  message: "hello",
  signature: sig.signature,
  signingAddress: sig.signingAddress,
  identityAddress: "i…",
});
```

`blockHeight` binds the signature to a chain height (part of what the daemon
verifies); pass the height the message was signed at when verifying.
