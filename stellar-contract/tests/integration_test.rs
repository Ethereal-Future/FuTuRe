#![cfg(feature = "testutils")]

use prediction_market::{Error, PredictionMarket, PredictionMarketClient};
use soroban_sdk::{
    testutils::Address as _,
    vec, Address, Env, String,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

fn setup() -> (Env, PredictionMarketClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PredictionMarket);
    let client = PredictionMarketClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let oracle = Address::generate(&env);
    client.init(&admin, &treasury);
    (env, client, admin, treasury, oracle)
}

fn question(env: &Env) -> String {
    String::from_str(env, "Will BTC hit 100k?")
}

// ── 1. Happy path ─────────────────────────────────────────────────────────────

#[test]
fn test_happy_path_full_lifecycle() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user_yes = Address::generate(&env);
    let user_no = Address::generate(&env);

    // create
    let mid = client.create_market(&admin, &question(&env), &oracle);

    // seed
    client.seed_market(&admin, &mid, &1_000_000);

    // buy YES
    let yes_shares = client.buy_yes(&user_yes, &mid, &100_000, &1);
    assert!(yes_shares > 0);

    // buy NO
    let no_shares = client.buy_no(&user_no, &mid, &100_000, &1);
    assert!(no_shares > 0);

    // close
    client.close_market(&admin, &mid);

    // oracle reports YES wins
    client.oracle_report(&oracle, &mid, &true);

    // dispute window passes → finalize
    client.finalize(&mid);

    // redeem YES position
    let payout = client.redeem(&user_yes, &mid);
    assert!(payout > 0);

    // NO holder gets nothing (NothingToRedeem)
    let err = client.try_redeem(&user_no, &mid).unwrap_err().unwrap();
    assert_eq!(err, Error::NothingToRedeem);
}

// ── 2. Dispute flow ───────────────────────────────────────────────────────────

#[test]
fn test_dispute_admin_upholds_emergency_resolve() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = Address::generate(&env);
    let disputer = Address::generate(&env);

    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.buy_yes(&user, &mid, &100_000, &1);
    client.close_market(&admin, &mid);
    client.oracle_report(&oracle, &mid, &false); // oracle says NO

    // disputer challenges
    client.dispute(&disputer, &mid, &50_000);

    // admin upholds → flips to YES
    client.admin_uphold_dispute(&admin, &mid, &true);

    // finalize (emergency resolved)
    client.finalize(&mid);

    // user redeems YES
    let payout = client.redeem(&user, &mid);
    assert!(payout > 0);
}

// ── 3. Dispute rejected — bond slashed ───────────────────────────────────────

#[test]
fn test_dispute_rejected_bond_slashed_to_treasury() {
    let (env, client, admin, _treasury, oracle) = setup();
    let disputer = Address::generate(&env);

    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.close_market(&admin, &mid);
    client.oracle_report(&oracle, &mid, &true);
    client.dispute(&disputer, &mid, &50_000);

    // admin rejects → bond slashed
    client.admin_reject_dispute(&admin, &mid);

    let treasury_bal = client.get_treasury_balance();
    assert_eq!(treasury_bal, 50_000);

    // market reverts to Closed → can finalize
    client.finalize(&mid);
    let market = client.get_market(&mid);
    assert_eq!(market.status, prediction_market::MarketStatus::Resolved);
}

// ── 4. Cancel flow ────────────────────────────────────────────────────────────

#[test]
fn test_cancel_and_refund_all_positions() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.buy_yes(&user_a, &mid, &100_000, &1);
    client.buy_no(&user_b, &mid, &100_000, &1);

    client.cancel_market(&admin, &mid);

    // Both users get refunds
    let refund_a = client.redeem(&user_a, &mid);
    let refund_b = client.redeem(&user_b, &mid);
    assert!(refund_a > 0);
    assert!(refund_b > 0);
}

// ── 5. LP flow ────────────────────────────────────────────────────────────────

#[test]
fn test_lp_add_trade_claim_fees_remove() {
    let (env, client, admin, _treasury, oracle) = setup();
    let lp = Address::generate(&env);
    let trader = Address::generate(&env);

    let mid = client.create_market(&admin, &question(&env), &oracle);

    // add liquidity
    let lp_shares = client.add_liquidity(&lp, &mid, &1_000_000);
    assert!(lp_shares > 0);

    // trade
    client.buy_yes(&trader, &mid, &100_000, &1);

    // claim LP fees (may be 0 in simple model, just must not error)
    let _fees = client.claim_lp_fees(&lp, &mid);

    // remove liquidity
    let returned = client.remove_liquidity(&lp, &mid, &lp_shares);
    assert!(returned > 0);
}

// ── 6. Batch redeem ───────────────────────────────────────────────────────────

#[test]
fn test_batch_redeem_across_three_markets() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = Address::generate(&env);

    let mut ids = vec![&env];
    for _ in 0..3 {
        let mid = client.create_market(&admin, &question(&env), &oracle);
        client.seed_market(&admin, &mid, &1_000_000);
        client.buy_yes(&user, &mid, &100_000, &1);
        client.close_market(&admin, &mid);
        client.oracle_report(&oracle, &mid, &true);
        client.finalize(&mid);
        ids.push_back(mid);
    }

    let total = client.batch_redeem(&user, &ids);
    assert!(total > 0);
}

// ── 7. Split / Merge ──────────────────────────────────────────────────────────

#[test]
fn test_split_sell_half_merge_remaining() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = Address::generate(&env);

    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);

    // split: get YES + NO shares for collateral
    client.split(&user, &mid, &200_000);
    let pos = client.get_position(&mid, &user);
    assert_eq!(pos.yes_shares, 200_000);
    assert_eq!(pos.no_shares, 200_000);

    // "sell half" — simulate by buying more on the other side (no sell fn needed)
    // merge remaining half
    client.merge(&user, &mid, &100_000);
    let pos2 = client.get_position(&mid, &user);
    assert_eq!(pos2.yes_shares, 100_000);
    assert_eq!(pos2.no_shares, 100_000);
}

// ── 8. Slippage exceeded ──────────────────────────────────────────────────────

#[test]
fn test_buy_yes_slippage_exceeded() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = Address::generate(&env);

    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);

    // min_shares_out impossibly high
    let err = client
        .try_buy_yes(&user, &mid, &100_000, &999_999_999)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::SlippageExceeded);
}

// ── 9. Emergency pause ────────────────────────────────────────────────────────

#[test]
fn test_emergency_pause_blocks_mutations_unpause_succeeds() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = Address::generate(&env);

    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);

    // pause
    client.pause(&admin);

    // all mutations fail with ContractPaused
    let err = client.try_buy_yes(&user, &mid, &100_000, &1).unwrap_err().unwrap();
    assert_eq!(err, Error::ContractPaused);

    let err = client.try_buy_no(&user, &mid, &100_000, &1).unwrap_err().unwrap();
    assert_eq!(err, Error::ContractPaused);

    let err = client.try_close_market(&admin, &mid).unwrap_err().unwrap();
    assert_eq!(err, Error::ContractPaused);

    let err = client
        .try_create_market(&admin, &question(&env), &oracle)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::ContractPaused);

    // unpause
    client.unpause(&admin);

    // mutations succeed again
    let shares = client.buy_yes(&user, &mid, &100_000, &1);
    assert!(shares > 0);
}
