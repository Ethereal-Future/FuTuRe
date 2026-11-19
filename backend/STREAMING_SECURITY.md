# Streaming Payment Security

## Delegated Soroban Escrow (current)

Payment streams are **non-custodial**. The backend never stores user private keys.

### Architecture

1. User deploys / interacts with the `StreamPayment` Soroban contract
   (`stellar-contract/src/stream_payment.rs`).
2. User deposits an allowance into contract escrow via `create_stream`
   (requires sender auth on-chain only).
3. Backend stores only `escrowContractId` + `contractStreamId` — never `senderSecret`.
4. The streaming worker calls permissionless `tick_stream(stream_id)` to release
   one interval payment. Compromise of the backend cannot drain the user's
   primary account — only the remaining escrowed allowance is at risk, and only
   via the contract's rate/interval rules.

### Rejected / purged

- `senderSecret` column is always `NULL`. Existing encrypted secrets are purged
  by migration `20261015160000_delegated_stream_escrow`.
- API rejects any request that still sends `senderSecret`
  (`CUSTODIAL_SECRET_REJECTED`).

### Creating a stream

```javascript
const stream = await createStream({
  senderPublicKey: 'G...',
  recipientPublicKey: 'G...',
  escrowContractId: 'C...',      // StreamPayment contract
  contractStreamId: '42',        // on-chain stream id
  rateAmount: 10,
  intervalSeconds: 60,
  allowance: 1000,
});
```

### Environment

Optional platform invoker for RPC submits (cannot spend user primary balances):

```bash
STREAM_CONTRACT_ID=C...
# SOROBAN_RPC_URL=...
```
