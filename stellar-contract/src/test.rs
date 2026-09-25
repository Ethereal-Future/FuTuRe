#![cfg(test)]

use super::{Error, PredictionMarket, PredictionMarketClient, MAX_BATCH_REDEEM_SIZE};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn setup() -> (Env, PredictionMarketClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PredictionMarket);
    let client = PredictionMarketClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.init(&admin, &treasury);
    (env, client)
}

fn market_ids(env: &Env, len: u32) -> Vec<u32> {
    let mut ids = Vec::new(env);
    for id in 0..len {
        ids.push_back(id);
    }
    ids
}

// ── Batch redeem size bound (#1261) ──────────────────────────────────────────

#[test]
fn test_batch_redeem_rejects_oversized_batch() {
    let (env, client) = setup();
    let redeemer = Address::generate(&env);
    let ids = market_ids(&env, MAX_BATCH_REDEEM_SIZE + 1);

    let err = client
        .try_batch_redeem(&redeemer, &ids)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidAmount);
}

#[test]
fn test_batch_redeem_accepts_batch_at_limit() {
    let (env, client) = setup();
    let redeemer = Address::generate(&env);
    let ids = market_ids(&env, MAX_BATCH_REDEEM_SIZE);

    // None of these markets exist, so every entry is reported as a per-market
    // failure — but the batch itself must not be rejected by the size guard.
    let result = client.batch_redeem(&redeemer, &ids);
    assert_eq!(result.successes.len(), 0);
    assert_eq!(result.failures.len(), MAX_BATCH_REDEEM_SIZE);
    assert_eq!(result.failures.get(0).unwrap().error, Error::MarketNotFound);
}
