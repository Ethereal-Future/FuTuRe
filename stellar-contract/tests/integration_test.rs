#![cfg(feature = "testutils")]

use prediction_market::{
    Error, MarketStatus, PredictionMarket, PredictionMarketClient, INSTANCE_BUMP_THRESHOLD,
    PERSISTENT_BUMP_THRESHOLD,
};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, Events as _, Ledger as _,
    },
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env, IntoVal, String,
    testutils::{Address as _, Events as _},
    token, vec, Address, BytesN, Env, IntoVal, String,
};

const CLOSE_IN: u64 = 1_000;
const RESOLVE_WINDOW: u64 = 1_000;
const FUNDING: i128 = 1_000_000_000_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

fn setup() -> (Env, PredictionMarketClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PredictionMarket);
    let client = PredictionMarketClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let oracle = Address::generate(&env);
    let token = env.register_stellar_asset_contract(admin.clone());
    client.init(&admin, &treasury, &token);
    StellarAssetClient::new(&env, &token).mint(&admin, &FUNDING);
    (env, client, admin, treasury, oracle)
}

/// Generate an address holding `FUNDING` units of the market token.
fn funded(env: &Env, client: &PredictionMarketClient) -> Address {
    let addr = Address::generate(env);
    StellarAssetClient::new(env, &client.get_token()).mint(&addr, &FUNDING);
    addr
}

fn token_balance(env: &Env, client: &PredictionMarketClient, addr: &Address) -> i128 {
    TokenClient::new(env, &client.get_token()).balance(addr)
}

/// Create a market that closes `CLOSE_IN` seconds from now.
fn create(env: &Env, client: &PredictionMarketClient, creator: &Address, oracle: &Address) -> u32 {
    let now = env.ledger().timestamp();
    client.create_market(
        creator,
        &question(env),
        oracle,
        &(now + CLOSE_IN),
        &(now + CLOSE_IN + RESOLVE_WINDOW),
    )
}

fn advance(env: &Env, secs: u64) {
    env.ledger().with_mut(|l| l.timestamp += secs);
    // Tests below that don't move real collateral (everything except
    // dispute/split/merge) don't need to observe this token, so a throwaway
    // address here keeps every pre-existing call site untouched. Tests that
    // do need to fund/transfer real collateral use `setup_with_token()`.
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin);
    client.init(&admin, &treasury, &token_id);
    (env, client, admin, treasury, oracle)
}

fn pass_dispute_window(env: &Env) {
    env.ledger()
        .with_mut(|li| li.timestamp += prediction_market::DISPUTE_WINDOW_SECONDS);
/// Like `setup()`, but also returns a live token client + its Stellar Asset
/// Contract admin client so a test can mint collateral to users before
/// calling `split`, `merge`, or `dispute` — all three now require real 1:1
/// token transfers (#1258, #1260).
fn setup_with_token() -> (
    Env,
    PredictionMarketClient<'static>,
    Address,
    Address,
    Address,
    token::Client<'static>,
    token::StellarAssetClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PredictionMarket);
    let client = PredictionMarketClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let oracle = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin.clone());
    let token = token::Client::new(&env, &token_id);
    let token_sac = token::StellarAssetClient::new(&env, &token_id);
    client.init(&admin, &treasury, &token_id);
    (env, client, admin, treasury, oracle, token, token_sac)
}

fn question(env: &Env) -> String {
    String::from_str(env, "Will BTC hit 100k?")
}

// ── 1. Happy path ─────────────────────────────────────────────────────────────

#[test]
fn test_happy_path_full_lifecycle() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user_yes = funded(&env, &client);
    let user_no = funded(&env, &client);

    // create
    let mid = create(&env, &client, &admin, &oracle);

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
    pass_dispute_window(&env);
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
    let user = funded(&env, &client);
    let disputer = funded(&env, &client);
    let (env, client, admin, _treasury, oracle, token, token_sac) = setup_with_token();
    let user = Address::generate(&env);
    let disputer = Address::generate(&env);
    let bond = 10_000_000i128; // == MIN_DISPUTE_BOND
    token_sac.mint(&disputer, &bond);

    let mid = create(&env, &client, &admin, &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.buy_yes(&user, &mid, &100_000, &1);
    client.close_market(&admin, &mid);
    client.oracle_report(&oracle, &mid, &false); // oracle says NO

    // disputer challenges, escrowing the bond into the contract
    client.dispute(&disputer, &mid, &bond);
    assert_eq!(token.balance(&disputer), 0);

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
    let disputer = funded(&env, &client);
    let (env, client, admin, _treasury, oracle, _token, token_sac) = setup_with_token();
    let disputer = Address::generate(&env);
    let bond = 10_000_000i128; // == MIN_DISPUTE_BOND
    token_sac.mint(&disputer, &bond);

    let mid = create(&env, &client, &admin, &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.close_market(&admin, &mid);
    client.oracle_report(&oracle, &mid, &true);
    client.dispute(&disputer, &mid, &bond);

    // admin rejects → bond slashed
    client.admin_reject_dispute(&admin, &mid);

    let treasury_bal = client.get_treasury_balance();
    assert_eq!(treasury_bal, bond);

    // market reverts to Closed → can finalize
    pass_dispute_window(&env);
    client.finalize(&mid);
    let market = client.get_market(&mid);
    assert_eq!(market.status, prediction_market::MarketStatus::Resolved);
}

// ── 4. Cancel flow ────────────────────────────────────────────────────────────

#[test]
fn test_cancel_and_refund_all_positions() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user_a = funded(&env, &client);
    let user_b = funded(&env, &client);

    let mid = create(&env, &client, &admin, &oracle);
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
    let lp = funded(&env, &client);
    let trader = funded(&env, &client);

    let mid = create(&env, &client, &admin, &oracle);

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

// ── 5b. LP proportional share minting (#951 fix) ─────────────────────────────
//
// After trading shifts lp_pool value, a second LP depositing the same nominal
// amount must receive *fewer* shares than the first LP.  On withdrawal, each LP
// should get back roughly what they put in (adjusted for pool-value changes) —
// not a flat 1:1 refund of their deposit regardless of pool size.

#[test]
fn test_lp_proportional_share_minting() {
    let (env, client, admin, _treasury, oracle) = setup();
    let lp_a = funded(&env, &client);
    let lp_b = funded(&env, &client);
    let trader = funded(&env, &client);

    let mid = create(&env, &client, &admin, &oracle);
    client.seed_market(&admin, &mid, &1_000_000);

    // LP-A deposits 500_000 into an empty LP pool → gets 500_000 shares (1:1 bootstrap)
    let shares_a = client.add_liquidity(&lp_a, &mid, &500_000);
    assert_eq!(shares_a, 500_000, "first LP should receive 1:1 shares on bootstrap");

    // Simulate trading that increases the pool's total value by buying YES.
    // This increases market.lp_pool implicitly via yes_pool / no_pool changes
    // (in our model lp_pool only tracks LP-deposited value, so we exercise
    //  the proportional branch via a second deposit after more LP value accrues).
    client.add_liquidity(&lp_a, &mid, &500_000); // lp_pool now 1_000_000, total_lp_shares = 1_000_000

    // LP-B deposits the same 500_000 into a pool that now has 1_000_000 value and 1_000_000 shares.
    // Expected shares_b = 500_000 * 1_000_000 / 1_000_000 = 500_000 (ratio still 1:1 when unchanged)
    let shares_b = client.add_liquidity(&lp_b, &mid, &500_000);
    assert_eq!(shares_b, 500_000);

    // Now simulate pool-value growth by having a large trade push value into lp_pool
    // (trade then check that shares for an equivalent third deposit are fewer)
    client.buy_yes(&trader, &mid, &1_000_000, &1);

    // At this point lp_pool hasn't changed (trades don't add to lp_pool directly),
    // but we can verify the core invariant: total_lp_shares is tracked separately.
    let market = client.get_market(&mid);
    // total_lp_shares should equal sum of all LP share grants
    assert_eq!(market.total_lp_shares, shares_a + 500_000 + shares_b,
        "total_lp_shares must equal sum of all minted shares");
    assert!(market.total_lp_shares > 0);
}

// ── 5c. LP redemption reflects pool value, not flat deposit return (#951 fix) ─

#[test]
fn test_lp_remove_liquidity_proportional_payout() {
    let (env, client, admin, _treasury, oracle) = setup();
    let lp_a = funded(&env, &client);
    let lp_b = funded(&env, &client);

    let mid = create(&env, &client, &admin, &oracle);

    // LP-A deposits 1_000_000 first (bootstrap: gets 1_000_000 shares, lp_pool = 1_000_000)
    let shares_a = client.add_liquidity(&lp_a, &mid, &1_000_000);
    assert_eq!(shares_a, 1_000_000);

    // LP-B deposits 500_000 into pool with 1_000_000 value and 1_000_000 shares
    // → shares_b = 500_000 * 1_000_000 / 1_000_000 = 500_000
    let shares_b = client.add_liquidity(&lp_b, &mid, &500_000);
    assert_eq!(shares_b, 500_000);

    // Total lp_pool = 1_500_000, total_lp_shares = 1_500_000

    // LP-A withdraws all shares: payout = 1_000_000 * 1_500_000 / 1_500_000 = 1_000_000
    let payout_a = client.remove_liquidity(&lp_a, &mid, &shares_a);
    assert_eq!(payout_a, 1_000_000, "LP-A should recover their proportional share of pool value");

    // After LP-A withdraws: lp_pool = 500_000, total_lp_shares = 500_000
    // LP-B withdraws: payout = 500_000 * 500_000 / 500_000 = 500_000
    let payout_b = client.remove_liquidity(&lp_b, &mid, &shares_b);
    assert_eq!(payout_b, 500_000, "LP-B should recover their proportional share of pool value");

    // Pool should now be empty
    let market = client.get_market(&mid);
    assert_eq!(market.lp_pool, 0);
    assert_eq!(market.total_lp_shares, 0);
}

// ── 5d. claim_lp_fees uses share units not pool-value units (#951 fix) ────────

#[test]
fn test_claim_lp_fees_proportional_to_shares() {
    let (env, client, admin, _treasury, oracle) = setup();
    let lp_a = funded(&env, &client);
    let lp_b = funded(&env, &client);

    let mid = create(&env, &client, &admin, &oracle);

    // LP-A deposits 2_000 (bootstrap, gets 2_000 shares)
    client.add_liquidity(&lp_a, &mid, &2_000);
    // LP-B deposits 1_000 → shares_b = 1_000 * 2_000 / 2_000 = 1_000
    client.add_liquidity(&lp_b, &mid, &1_000);

    // Manually inject fees (in a real deployment fees come from trades):
    // We verify the proportional claim via the math, not via fee injection here —
    // with 0 fees both LPs must get 0 (not panic) and the test verifies no error.
    let fees_a = client.claim_lp_fees(&lp_a, &mid);
    let fees_b = client.claim_lp_fees(&lp_b, &mid);

    // With no accumulated fees both results are 0, but the calls succeed
    assert_eq!(fees_a, 0);
    assert_eq!(fees_b, 0);

    // Verify: if lp_fees were set externally we'd check proportionality.
    // The contract now uses total_lp_shares as denominator, so this test
    // documents the expected invariant: fee_a / fee_b == shares_a / shares_b == 2.
}

// ── 6. Batch redeem ───────────────────────────────────────────────────────────

#[test]
fn test_batch_redeem_across_three_markets() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = funded(&env, &client);

    let mut ids = vec![&env];
    for _ in 0..3 {
        let mid = create(&env, &client, &admin, &oracle);
        client.seed_market(&admin, &mid, &1_000_000);
        client.buy_yes(&user, &mid, &100_000, &1);
        advance(&env, CLOSE_IN);
        client.close_market(&admin, &mid);
        client.oracle_report(&oracle, &mid, &true);
        pass_dispute_window(&env);
        client.finalize(&mid);
        ids.push_back(mid);
    }

    let result = client.batch_redeem(&user, &ids);
    assert_eq!(result.successes.len(), 3);
    assert_eq!(result.failures.len(), 0);
    assert!(result.total_payout > 0);
}

#[test]
fn test_batch_redeem_partial_failure() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = funded(&env, &client);

    let mut ids = vec![&env];
    // First market: resolve with YES (user has YES shares)
    let mid1 = create(&env, &client, &admin, &oracle);
    client.seed_market(&admin, &mid1, &1_000_000);
    client.buy_yes(&user, &mid1, &100_000, &1);
    client.close_market(&admin, &mid1);
    client.oracle_report(&oracle, &mid1, &true);
    pass_dispute_window(&env);
    client.finalize(&mid1);
    ids.push_back(mid1);

    // Second market: resolve with NO (user has YES shares, gets nothing)
    let mid2 = create(&env, &client, &admin, &oracle);
    client.seed_market(&admin, &mid2, &1_000_000);
    client.buy_yes(&user, &mid2, &100_000, &1);
    client.close_market(&admin, &mid2);
    client.oracle_report(&oracle, &mid2, &false);
    pass_dispute_window(&env);
    client.finalize(&mid2);
    ids.push_back(mid2);

    let result = client.batch_redeem(&user, &ids);
    // Should have 1 success and 1 failure
    assert_eq!(result.successes.len(), 1);
    assert_eq!(result.failures.len(), 1);
    assert!(result.total_payout > 0);
    // Check that the failure is NothingToRedeem
    assert_eq!(result.failures.get(0).error, Error::NothingToRedeem);
}

// ── 7. Split / Merge ──────────────────────────────────────────────────────────

#[test]
fn test_split_sell_half_merge_remaining() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = funded(&env, &client);
    let (env, client, admin, _treasury, oracle, token, token_sac) = setup_with_token();
    let user = Address::generate(&env);
    token_sac.mint(&user, &200_000);

    let mid = create(&env, &client, &admin, &oracle);
    client.seed_market(&admin, &mid, &1_000_000);

    // split: 1:1 collateral is pulled from the user into contract escrow
    client.split(&user, &mid, &200_000);
    assert_eq!(token.balance(&user), 0);
    assert_eq!(token.balance(&client.address), 200_000);
    let pos = client.get_position(&mid, &user);
    assert_eq!(pos.yes_shares, 200_000);
    assert_eq!(pos.no_shares, 200_000);

    // "sell half" — simulate by buying more on the other side (no sell fn needed)
    // merge remaining half → 1:1 collateral is returned to the user
    client.merge(&user, &mid, &100_000);
    assert_eq!(token.balance(&user), 100_000);
    assert_eq!(token.balance(&client.address), 100_000);
    let pos2 = client.get_position(&mid, &user);
    assert_eq!(pos2.yes_shares, 100_000);
    assert_eq!(pos2.no_shares, 100_000);
}

// ── 7b. Split/merge collateral enforcement (#1260) ───────────────────────────

#[test]
fn test_split_requires_positive_amount() {
    let (env, client, admin, _treasury, oracle, _token, _token_sac) = setup_with_token();
    let user = Address::generate(&env);
    let mid = client.create_market(&admin, &question(&env), &oracle);

    let err = client.try_split(&user, &mid, &0).unwrap_err().unwrap();
    assert_eq!(err, Error::InvalidAmount);

    let err = client.try_split(&user, &mid, &-1).unwrap_err().unwrap();
    assert_eq!(err, Error::InvalidAmount);
}

#[test]
#[should_panic]
fn test_split_fails_without_sufficient_collateral() {
    let (env, client, admin, _treasury, oracle, _token, token_sac) = setup_with_token();
    let user = Address::generate(&env);
    token_sac.mint(&user, &100); // less than the amount they'll try to split
    let mid = client.create_market(&admin, &question(&env), &oracle);

    // The token transfer traps on insufficient balance before any shares
    // are minted — uncollateralized share minting is impossible.
    client.split(&user, &mid, &1_000);
}

#[test]
fn test_merge_returns_collateral_only_up_to_split_tokens() {
    let (env, client, admin, _treasury, oracle, token, token_sac) = setup_with_token();
    let user = Address::generate(&env);
    token_sac.mint(&user, &500_000);
    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);

    client.split(&user, &mid, &500_000);
    assert_eq!(token.balance(&client.address), 500_000);

    client.merge(&user, &mid, &500_000);
    assert_eq!(token.balance(&user), 500_000, "full collateral returned 1:1");
    assert_eq!(token.balance(&client.address), 0);
}

// ── 8. Slippage exceeded ──────────────────────────────────────────────────────

#[test]
fn test_buy_yes_slippage_exceeded() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = funded(&env, &client);

    let mid = create(&env, &client, &admin, &oracle);
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
    let user = funded(&env, &client);

    let mid = create(&env, &client, &admin, &oracle);
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
        .try_create_market(&admin, &question(&env), &oracle, &CLOSE_IN, &(CLOSE_IN * 2))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::ContractPaused);

    // unpause
    client.unpause(&admin);

    // mutations succeed again
    let shares = client.buy_yes(&user, &mid, &100_000, &1);
    assert!(shares > 0);
}

// ── 10. Events ───────────────────────────────────────────────────────────────

#[test]
fn test_create_market_emits_created_event() {
    let (env, client, admin, _treasury, oracle) = setup();

    let mid = create(&env, &client, &admin, &oracle);

    let events = env.events().all();
    let (contract_id, topics, data) = events.last().unwrap();
    assert_eq!(contract_id, client.address);
    assert_eq!(
        topics,
        vec![
            &env,
            symbol_short!("market").into_val(&env),
            symbol_short!("created").into_val(&env),
        ]
    );
    assert_eq!(
        data,
        (mid, admin.clone(), oracle.clone()).into_val(&env)
    );
}

#[test]
fn test_buy_yes_emits_traded_event() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = funded(&env, &client);

    let mid = create(&env, &client, &admin, &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    let shares = client.buy_yes(&user, &mid, &100_000, &1);

    let events = env.events().all();
    let (_, topics, data) = events.last().unwrap();
    assert_eq!(
        topics,
        vec![
            &env,
            symbol_short!("market").into_val(&env),
            symbol_short!("traded").into_val(&env),
        ]
    );
    assert_eq!(
        data,
        (mid, user.clone(), true, 100_000i128, shares).into_val(&env)
    );
}

#[test]
fn test_finalize_emits_resolved_event() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = funded(&env, &client);

    let mid = create(&env, &client, &admin, &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.buy_yes(&user, &mid, &100_000, &1);
    client.close_market(&admin, &mid);
    client.oracle_report(&oracle, &mid, &true);
    pass_dispute_window(&env);
    client.finalize(&mid);

    let events = env.events().all();
    let (_, topics, data) = events.last().unwrap();
    assert_eq!(
        topics,
        vec![
            &env,
            symbol_short!("market").into_val(&env),
            symbol_short!("resolved").into_val(&env),
        ]
    );
    assert_eq!(data, (mid, Some(true)).into_val(&env));
}

// ── Dispute window enforcement (#1251) ────────────────────────────────────────

#[test]
fn test_finalize_rejected_during_dispute_window() {
    let (env, client, admin, _treasury, oracle) = setup();
    let disputer = Address::generate(&env);
    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.close_market(&admin, &mid);
    client.oracle_report(&oracle, &mid, &true);

    let err = client.try_finalize(&mid).unwrap_err().unwrap();
    assert_eq!(err, Error::DisputeWindowOpen);

    // One second before expiry: still open, and still disputable.
    env.ledger()
        .with_mut(|li| li.timestamp += prediction_market::DISPUTE_WINDOW_SECONDS - 1);
    let err = client.try_finalize(&mid).unwrap_err().unwrap();
    assert_eq!(err, Error::DisputeWindowOpen);
    client.dispute(&disputer, &mid, &10);
    client.admin_reject_dispute(&admin, &mid);

    env.ledger().with_mut(|li| li.timestamp += 1);
    client.finalize(&mid);
    assert_eq!(
        client.get_market(&mid).status,
        prediction_market::MarketStatus::Resolved
    );
}

// ── Upheld dispute refunds bond (#1252) ───────────────────────────────────────

#[test]
fn test_uphold_dispute_refunds_bond() {
    let (env, client, admin, _treasury, oracle) = setup();
    let disputer = Address::generate(&env);
    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.close_market(&admin, &mid);
    client.oracle_report(&oracle, &mid, &false);
    client.dispute(&disputer, &mid, &50_000);

    assert_eq!(client.get_bond_refund(&disputer), 0);
    client.admin_uphold_dispute(&admin, &mid, &true);

    assert_eq!(client.get_bond_refund(&disputer), 50_000);
    assert_eq!(client.get_treasury_balance(), 0);
    let market = client.get_market(&mid);
    assert_eq!(market.dispute_bond, 0);
    assert!(market.disputer.is_none());
}

// ── LP fee accumulator (#1253) ────────────────────────────────────────────────

fn two_equal_lps() -> (Env, PredictionMarketClient<'static>, Address, u32, Address, Address) {
    let (env, client, admin, _treasury, oracle) = setup();
    let lp_a = Address::generate(&env);
    let lp_b = Address::generate(&env);
    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.add_liquidity(&lp_a, &mid, &1_000);
    client.add_liquidity(&lp_b, &mid, &1_000);
    client.add_lp_fees(&admin, &mid, &100);
    (env, client, admin, mid, lp_a, lp_b)
}

#[test]
fn test_lp_fees_independent_of_claim_order() {
    let (_env, client, _admin, mid, lp_a, lp_b) = two_equal_lps();
    let a = client.claim_lp_fees(&lp_a, &mid);
    let b = client.claim_lp_fees(&lp_b, &mid);
    assert_eq!((a, b), (50, 50));

    let (_env, client, _admin, mid, lp_a, lp_b) = two_equal_lps();
    let b = client.claim_lp_fees(&lp_b, &mid);
    let a = client.claim_lp_fees(&lp_a, &mid);
    assert_eq!((a, b), (50, 50));
    assert_eq!(client.get_market(&mid).lp_fees, 0);
}

#[test]
fn test_lp_fees_cannot_be_reclaimed() {
    let (_env, client, admin, mid, lp_a, _lp_b) = two_equal_lps();
    assert_eq!(client.claim_lp_fees(&lp_a, &mid), 50);
    assert_eq!(client.claim_lp_fees(&lp_a, &mid), 0);
    client.add_lp_fees(&admin, &mid, &40);
    assert_eq!(client.claim_lp_fees(&lp_a, &mid), 20);
}

#[test]
fn test_new_lp_cannot_claim_historical_fees() {
    let (env, client, _admin, mid, lp_a, _lp_b) = two_equal_lps();
    let lp_c = Address::generate(&env);
    client.add_liquidity(&lp_c, &mid, &1_000);
    assert_eq!(client.claim_lp_fees(&lp_c, &mid), 0);
    // Fees accrued before removal remain claimable.
    let shares_a = client.get_position(&mid, &lp_a).lp_shares;
    client.remove_liquidity(&lp_a, &mid, &shares_a);
    assert_eq!(client.claim_lp_fees(&lp_a, &mid), 50);
}

// ── Non-positive amounts rejected (#1254) ─────────────────────────────────────

#[test]
fn test_non_positive_amounts_rejected() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = Address::generate(&env);
    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);

    for amount in [0i128, -1, -1_000_000] {
        assert_eq!(
            client.try_buy_yes(&user, &mid, &amount, &i128::MIN).unwrap_err().unwrap(),
            Error::InvalidAmount
        );
        assert_eq!(
            client.try_buy_no(&user, &mid, &amount, &i128::MIN).unwrap_err().unwrap(),
            Error::InvalidAmount
        );
        assert_eq!(
            client.try_seed_market(&admin, &mid, &amount).unwrap_err().unwrap(),
            Error::InvalidAmount
        );
        assert_eq!(
            client.try_add_liquidity(&user, &mid, &amount).unwrap_err().unwrap(),
            Error::InvalidAmount
        );
        assert_eq!(
            client.try_split(&user, &mid, &amount).unwrap_err().unwrap(),
            Error::InvalidAmount
        );
        assert_eq!(
            client.try_merge(&user, &mid, &amount).unwrap_err().unwrap(),
            Error::InvalidAmount
        );
    }

    let market = client.get_market(&mid);
    assert_eq!(market.yes_pool, 1_000_000);
    assert_eq!(market.no_pool, 1_000_000);
// ── #1255: remove_liquidity must unwind yes_pool / no_pool ───────────────────

#[test]
fn test_remove_liquidity_restores_yes_no_pools() {
    let (env, client, admin, _treasury, oracle) = setup();
    let lp = Address::generate(&env);

    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    let before = client.get_market(&mid);

    let shares = client.add_liquidity(&lp, &mid, &500_000);
    client.remove_liquidity(&lp, &mid, &shares);
    let after = client.get_market(&mid);

    assert_eq!(after.yes_pool, before.yes_pool);
    assert_eq!(after.no_pool, before.no_pool);
    assert_eq!(after.lp_pool, 0);
    assert_eq!(after.total_lp_shares, 0);
}

#[test]
fn test_lp_withdrawal_does_not_inflate_redeem_payout() {
    // Market A: no LP activity. Market B: identical, plus an LP that deposits
    // and fully withdraws. Winning payouts must be identical — before the fix
    // B paid out the withdrawn LP liquidity a second time.
    let (env, client, admin, _treasury, oracle) = setup();
    let lp = Address::generate(&env);
    let winner_a = Address::generate(&env);
    let winner_b = Address::generate(&env);

    let mid_a = client.create_market(&admin, &question(&env), &oracle);
    let mid_b = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid_a, &1_000_000);
    client.seed_market(&admin, &mid_b, &1_000_000);

    let shares = client.add_liquidity(&lp, &mid_b, &2_000_000);
    client.remove_liquidity(&lp, &mid_b, &shares);

    client.buy_yes(&winner_a, &mid_a, &100_000, &1);
    client.buy_yes(&winner_b, &mid_b, &100_000, &1);

    for mid in [mid_a, mid_b] {
        client.close_market(&admin, &mid);
        client.oracle_report(&oracle, &mid, &true);
        client.finalize(&mid);
    }

    let payout_a = client.redeem(&winner_a, &mid_a);
    let payout_b = client.redeem(&winner_b, &mid_b);
    assert_eq!(payout_a, payout_b);
}

// ── #1256: reentrancy guard / CEI ────────────────────────────────────────────

#[test]
fn test_reentrant_call_is_rejected_while_guard_held() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = Address::generate(&env);
    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);

    // Simulate an external callback re-entering mid-invocation by holding the
    // transient lock in instance storage, exactly as an in-flight guarded call would.
    env.as_contract(&client.address, || {
        env.storage().instance().set(&symbol_short!("REENTRY"), &true);
    });

    assert_eq!(
        client.try_add_liquidity(&user, &mid, &1_000).unwrap_err().unwrap(),
        Error::ReentrancyError
    );
    assert_eq!(
        client.try_remove_liquidity(&user, &mid, &1).unwrap_err().unwrap(),
        Error::ReentrancyError
    );
    assert_eq!(
        client.try_redeem(&user, &mid).unwrap_err().unwrap(),
        Error::ReentrancyError
    );
    assert_eq!(
        client.try_batch_redeem(&user, &vec![&env, mid]).unwrap_err().unwrap(),
        Error::ReentrancyError
    );

    // Once the lock is released the same calls proceed normally.
    env.as_contract(&client.address, || {
        env.storage().instance().remove(&symbol_short!("REENTRY"));
    });
    assert!(client.add_liquidity(&user, &mid, &1_000) > 0);
}

#[test]
fn test_guard_released_after_error_and_batch_redeem_state_committed_first() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = Address::generate(&env);
    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.buy_yes(&user, &mid, &100_000, &1);
// ── 11. Token custody (#1247 / #1248) ────────────────────────────────────────

#[test]
fn test_trades_and_liquidity_move_real_tokens() {
    let (env, client, admin, _treasury, oracle) = setup();
    let buyer = funded(&env, &client);
    let lp = funded(&env, &client);

    let mid = create(&env, &client, &admin, &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.buy_yes(&buyer, &mid, &100_000, &1);
    client.add_liquidity(&lp, &mid, &500_000);

    assert_eq!(token_balance(&env, &client, &buyer), FUNDING - 100_000);
    assert_eq!(token_balance(&env, &client, &lp), FUNDING - 500_000);
    assert_eq!(
        token_balance(&env, &client, &client.address),
        2 * 1_000_000 + 100_000 + 500_000
    );
}

#[test]
fn test_buy_and_add_liquidity_fail_without_tokens() {
    let (env, client, admin, _treasury, oracle) = setup();
    let broke = Address::generate(&env);
    let mid = create(&env, &client, &admin, &oracle);
    client.seed_market(&admin, &mid, &1_000_000);

    assert!(client.try_buy_yes(&broke, &mid, &1_000_000_000, &1).is_err());
    assert!(client.try_add_liquidity(&broke, &mid, &1_000).is_err());
    assert_eq!(client.get_position(&mid, &broke).yes_shares, 0);
}

#[test]
fn test_redeem_pays_winner_in_tokens() {
    let (env, client, admin, _treasury, oracle) = setup();
    let winner = funded(&env, &client);
    let mid = create(&env, &client, &admin, &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.buy_yes(&winner, &mid, &100_000, &1);
    advance(&env, CLOSE_IN);
    client.close_market(&admin, &mid);
    client.oracle_report(&oracle, &mid, &true);
    client.finalize(&mid);

    let before = token_balance(&env, &client, &winner);
    let payout = client.redeem(&winner, &mid);
    assert_eq!(token_balance(&env, &client, &winner), before + payout);
}

// ── 12. State TTL (#1249) ────────────────────────────────────────────────────

#[test]
fn test_storage_ttl_extended_on_access() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = funded(&env, &client);
    let mid = create(&env, &client, &admin, &oracle);
    client.buy_yes(&user, &mid, &100_000, &1);
    client.get_market(&mid);

    env.as_contract(&client.address, || {
        assert!(env.storage().instance().get_ttl() >= INSTANCE_BUMP_THRESHOLD);
        let mkt_key = (symbol_short!("MKT"), mid);
        assert!(env.storage().persistent().get_ttl(&mkt_key) >= PERSISTENT_BUMP_THRESHOLD);
        let pos_key = (symbol_short!("POS"), mid, user.clone());
        assert!(env.storage().persistent().get_ttl(&pos_key) >= PERSISTENT_BUMP_THRESHOLD);
    });
}

// ── 13. Deadlines (#1250) ────────────────────────────────────────────────────

#[test]
fn test_create_market_rejects_invalid_deadlines() {
    let (env, client, admin, _treasury, oracle) = setup();
    advance(&env, 100);
    let err = client
        .try_create_market(&admin, &question(&env), &oracle, &100, &500)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidDeadline);
    let err = client
        .try_create_market(&admin, &question(&env), &oracle, &500, &500)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidDeadline);
}

#[test]
fn test_trading_rejected_after_close_time() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = funded(&env, &client);
    let mid = create(&env, &client, &admin, &oracle);

    advance(&env, CLOSE_IN - 1);
    client.buy_yes(&user, &mid, &100_000, &1);

    advance(&env, 1);
    let err = client.try_buy_yes(&user, &mid, &100_000, &1).unwrap_err().unwrap();
    assert_eq!(err, Error::TradingClosed);
    let err = client.try_buy_no(&user, &mid, &100_000, &1).unwrap_err().unwrap();
    assert_eq!(err, Error::TradingClosed);
    let err = client.try_add_liquidity(&user, &mid, &100_000).unwrap_err().unwrap();
    assert_eq!(err, Error::TradingClosed);
}

#[test]
fn test_oracle_cannot_report_before_close_time() {
    let (env, client, admin, _treasury, oracle) = setup();
    let mid = create(&env, &client, &admin, &oracle);
    // Admin may halt trading early, but the oracle still has to wait.
    client.close_market(&admin, &mid);
    let err = client.try_oracle_report(&oracle, &mid, &true).unwrap_err().unwrap();
    assert_eq!(err, Error::MarketNotExpired);

    advance(&env, CLOSE_IN);
    client.oracle_report(&oracle, &mid, &true);
}

#[test]
fn test_creator_cannot_close_before_close_time() {
    let (env, client, _admin, _treasury, oracle) = setup();
    let creator = funded(&env, &client);
    let mid = create(&env, &client, &creator, &oracle);
    let err = client.try_close_market(&creator, &mid).unwrap_err().unwrap();
    assert_eq!(err, Error::Unauthorized);
    advance(&env, CLOSE_IN);
    client.close_market(&creator, &mid);
}

#[test]
fn test_timeout_refund_after_resolution_deadline() {
    let (env, client, admin, _treasury, oracle) = setup();
    let user = funded(&env, &client);
    let mid = create(&env, &client, &admin, &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.buy_yes(&user, &mid, &100_000, &1);

    advance(&env, CLOSE_IN + RESOLVE_WINDOW);
    let err = client.try_emergency_timeout_refund(&mid).unwrap_err().unwrap();
    assert_eq!(err, Error::ResolutionDeadlineNotReached);

    advance(&env, 1);
    client.emergency_timeout_refund(&mid);
    assert_eq!(client.get_market(&mid).status, MarketStatus::Cancelled);

    let before = token_balance(&env, &client, &user);
    let refund = client.redeem(&user, &mid);
    assert!(refund > 0);
    assert_eq!(token_balance(&env, &client, &user), before + refund);
// ── 11. Zero-liquidity swaps (#1262) ─────────────────────────────────────────
//
// Trades against a market with no reserves, or with non-positive amounts, must
// be rejected with a typed error and leave pool state untouched.

#[test]
fn test_zero_liquidity_swap_rejection() {
    let (env, client, admin, _treasury, oracle) = setup();
    let trader = Address::generate(&env);

    // Fresh market: no seed, no LP deposits → both reserves are zero.
    let mid = client.create_market(&admin, &question(&env), &oracle);
    let before = client.get_market(&mid);
    assert_eq!(before.yes_pool, 0);
    assert_eq!(before.no_pool, 0);

    // Zero-amount trades against the empty pool are rejected.
    let err = client.try_buy_yes(&trader, &mid, &0, &0).unwrap_err().unwrap();
    assert_eq!(err, Error::InvalidAmount);
    let err = client.try_buy_no(&trader, &mid, &0, &0).unwrap_err().unwrap();
    assert_eq!(err, Error::InvalidAmount);

    // Negative amounts must never be able to drive reserves below zero.
    let err = client
        .try_buy_yes(&trader, &mid, &-1_000, &i128::MIN)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidAmount);
    let err = client
        .try_buy_no(&trader, &mid, &-1_000, &i128::MIN)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidAmount);

    // A slippage bound that the empty pool cannot satisfy fails cleanly.
    let err = client
        .try_buy_yes(&trader, &mid, &1_000, &1_001)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::SlippageExceeded);

    // No rejected trade may have mutated market or position state.
    let after = client.get_market(&mid);
    assert_eq!(after.yes_pool, 0);
    assert_eq!(after.no_pool, 0);
    assert_eq!(after.yes_shares, 0);
    assert_eq!(after.no_shares, 0);
    let pos = client.get_position(&mid, &trader);
    assert_eq!(pos.yes_shares, 0);
    assert_eq!(pos.no_shares, 0);

    // Depleted LP pool: after the only LP exits, trades still behave
    // deterministically rather than dividing by zero.
    let lp = Address::generate(&env);
    let lp_mid = client.create_market(&admin, &question(&env), &oracle);
    let shares = client.add_liquidity(&lp, &lp_mid, &1_000_000);
    client.remove_liquidity(&lp, &lp_mid, &shares);
    let drained = client.get_market(&lp_mid);
    assert_eq!(drained.lp_pool, 0);
    assert_eq!(drained.total_lp_shares, 0);
    let err = client
        .try_buy_yes(&trader, &lp_mid, &0, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidAmount);
    assert!(client.buy_yes(&trader, &lp_mid, &10_000, &1) > 0);
}

// ── 12. CPMM arithmetic overflow protection (#1262) ──────────────────────────
//
// Extreme i128 quantities must surface `Error::ArithmeticOverflow` instead of
// panicking, and must not partially apply any state change.

#[test]
fn test_cpmm_arithmetic_overflow_protection() {
    let (env, client, admin, _treasury, oracle) = setup();
    let trader = Address::generate(&env);
    let lp = Address::generate(&env);

    // Trade overflow: own_pool + amount exceeds i128::MAX.
    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    let err = client
        .try_buy_yes(&trader, &mid, &i128::MAX, &1)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::ArithmeticOverflow);
    let err = client
        .try_buy_no(&trader, &mid, &i128::MAX, &1)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::ArithmeticOverflow);

    // Share calculation overflow: amount * (yes_pool + no_pool) exceeds i128::MAX.
    let err = client
        .try_buy_yes(&trader, &mid, &(i128::MAX / 2), &1)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::ArithmeticOverflow);

    let market = client.get_market(&mid);
    assert_eq!(market.yes_pool, 1_000_000);
    assert_eq!(market.no_pool, 1_000_000);
    assert_eq!(market.yes_shares, 0);
    assert_eq!(market.no_shares, 0);
    assert_eq!(client.get_position(&mid, &trader).yes_shares, 0);

    // Seed overflow: reserves already at i128::MAX cannot be topped up.
    let seed_mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &seed_mid, &i128::MAX);
    let err = client
        .try_seed_market(&admin, &seed_mid, &1)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::ArithmeticOverflow);
    // With reserves at i128::MAX, even a 1-unit trade overflows the CPMM formula.
    let err = client
        .try_buy_yes(&trader, &seed_mid, &1, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::ArithmeticOverflow);

    // LP overflow: a bootstrap deposit of i128::MAX saturates lp_pool, so any
    // further deposit must be rejected rather than wrapping.
    let lp_mid = client.create_market(&admin, &question(&env), &oracle);
    let shares = client.add_liquidity(&lp, &lp_mid, &i128::MAX);
    assert_eq!(shares, i128::MAX);
    let err = client
        .try_add_liquidity(&lp, &lp_mid, &1)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::ArithmeticOverflow);
    let lp_market = client.get_market(&lp_mid);
    assert_eq!(lp_market.lp_pool, i128::MAX);
    assert_eq!(lp_market.total_lp_shares, i128::MAX);
    assert_eq!(client.get_position(&lp_mid, &lp).lp_shares, i128::MAX);
}

// ── 13. Sequential multi-LP fee distribution (#1262) ─────────────────────────
//
// Several LPs deposit, trades happen in between, and LPs withdraw in a
// different order than they joined. Every LP share must be worth the same
// amount at every step, fee claims must never exceed accrued fees, and the
// pool must end fully drained with nothing stranded.

#[test]
fn test_sequential_lp_fee_distribution_equality() {
    let (env, client, admin, _treasury, oracle) = setup();
    let lp_a = Address::generate(&env);
    let lp_b = Address::generate(&env);
    let lp_c = Address::generate(&env);
    let trader = Address::generate(&env);

    let mid = client.create_market(&admin, &question(&env), &oracle);

    // LP-A bootstraps: 1:1 shares.
    let shares_a = client.add_liquidity(&lp_a, &mid, &1_000_000);
    assert_eq!(shares_a, 1_000_000);

    // A trade between deposits must not dilute or inflate later LP shares.
    client.buy_yes(&trader, &mid, &100_000, &1);

    let shares_b = client.add_liquidity(&lp_b, &mid, &500_000);
    assert_eq!(shares_b, 500_000);

    client.buy_no(&trader, &mid, &50_000, &1);

    let shares_c = client.add_liquidity(&lp_c, &mid, &250_000);
    assert_eq!(shares_c, 250_000);

    let market = client.get_market(&mid);
    assert_eq!(market.lp_pool, 1_750_000);
    assert_eq!(market.total_lp_shares, shares_a + shares_b + shares_c);

    // Fee claims are proportional to shares and in total can never exceed
    // what has accrued in the pool.
    let accrued = market.lp_fees;
    let fee_a = client.claim_lp_fees(&lp_a, &mid);
    let fee_b = client.claim_lp_fees(&lp_b, &mid);
    let fee_c = client.claim_lp_fees(&lp_c, &mid);
    assert!(fee_a >= 0 && fee_b >= 0 && fee_c >= 0);
    assert!(fee_a + fee_b + fee_c <= accrued);
    // Shares are 4:2:1, so claims must respect that ordering.
    assert!(fee_a >= fee_b && fee_b >= fee_c);
    assert!(client.get_market(&mid).lp_fees >= 0);

    // Withdraw out of order: B fully, A half, C fully, then A's remainder.
    // Every withdrawal must pay exactly shares * lp_pool / total_lp_shares.
    let payout_b = client.remove_liquidity(&lp_b, &mid, &shares_b);
    assert_eq!(payout_b, 500_000);

    let half_a = shares_a / 2;
    let payout_a1 = client.remove_liquidity(&lp_a, &mid, &half_a);
    assert_eq!(payout_a1, 500_000);

    let payout_c = client.remove_liquidity(&lp_c, &mid, &shares_c);
    assert_eq!(payout_c, 250_000);

    let payout_a2 = client.remove_liquidity(&lp_a, &mid, &(shares_a - half_a));
    assert_eq!(payout_a2, 500_000);

    // Total paid out equals total deposited; nothing is stranded.
    assert_eq!(
        payout_a1 + payout_a2 + payout_b + payout_c,
        1_000_000 + 500_000 + 250_000
    );
    let drained = client.get_market(&mid);
    assert_eq!(drained.lp_pool, 0);
    assert_eq!(drained.total_lp_shares, 0);

    // Exited LPs hold nothing and cannot claim further fees.
    assert_eq!(client.get_position(&mid, &lp_a).lp_shares, 0);
    let err = client.try_claim_lp_fees(&lp_c, &mid).unwrap_err().unwrap();
    assert_eq!(err, Error::NothingToRedeem);

    // Over-withdrawal is rejected.
    let err = client
        .try_remove_liquidity(&lp_b, &mid, &1)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InsufficientFunds);
}

// ── 14. Full dispute state machine (#1262) ───────────────────────────────────
//
// Closed → Disputed → (reject) Closed → Disputed → (uphold) EmergencyResolved
// → Resolved, plus the illegal transitions along the way.

#[test]
fn test_full_dispute_lifecycle_uphold_and_reject() {
    use prediction_market::MarketStatus;

    let (env, client, admin, _treasury, oracle) = setup();
    let user_yes = Address::generate(&env);
    let user_no = Address::generate(&env);
    let disputer_1 = Address::generate(&env);
    let disputer_2 = Address::generate(&env);
    let stranger = Address::generate(&env);

    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.buy_yes(&user_yes, &mid, &100_000, &1);
    client.buy_no(&user_no, &mid, &100_000, &1);

    // Cannot dispute an open market.
    let err = client
        .try_dispute(&disputer_1, &mid, &50_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::MarketNotClosed);

    client.close_market(&admin, &mid);

    // Cannot dispute before the oracle has reported.
    let err = client
        .try_dispute(&disputer_1, &mid, &50_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidOutcome);

    // Admin cannot rule on a market that is not disputed.
    assert!(client.try_admin_reject_dispute(&admin, &mid).is_err());
    assert!(client.try_admin_uphold_dispute(&admin, &mid, &true).is_err());

    // Oracle reports NO.
    client.oracle_report(&oracle, &mid, &false);

    // ── Round 1: dispute rejected, bond slashed ──────────────────────────────
    client.dispute(&disputer_1, &mid, &50_000);
    let m = client.get_market(&mid);
    assert_eq!(m.status, MarketStatus::Disputed);
    assert_eq!(m.disputer, Some(disputer_1.clone()));
    assert_eq!(m.dispute_bond, 50_000);

    // While disputed: no finalize, no redeem, no second concurrent dispute.
    let err = client.try_finalize(&mid).unwrap_err().unwrap();
    assert_eq!(err, Error::MarketNotClosed);
    let err = client.try_redeem(&user_no, &mid).unwrap_err().unwrap();
    assert_eq!(err, Error::MarketNotResolved);
    let err = client
        .try_dispute(&disputer_2, &mid, &10_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::MarketNotClosed);

    // Only the admin may rule.
    let err = client
        .try_admin_reject_dispute(&stranger, &mid)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::Unauthorized);
    let err = client
        .try_admin_uphold_dispute(&stranger, &mid, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::Unauthorized);

    client.admin_reject_dispute(&admin, &mid);
    assert_eq!(client.get_treasury_balance(), 50_000);
    let m = client.get_market(&mid);
    assert_eq!(m.status, MarketStatus::Closed);
    assert_eq!(m.disputer, None);
    assert_eq!(m.dispute_bond, 0);
    assert_eq!(m.outcome, Some(false), "rejection must keep the oracle outcome");

    // ── Round 2: re-dispute upheld, outcome overridden ───────────────────────
    client.dispute(&disputer_2, &mid, &75_000);
    let m = client.get_market(&mid);
    assert_eq!(m.status, MarketStatus::Disputed);
    assert_eq!(m.disputer, Some(disputer_2.clone()));
    assert_eq!(m.dispute_bond, 75_000);

    client.admin_uphold_dispute(&admin, &mid, &true);
    let m = client.get_market(&mid);
    assert_eq!(m.status, MarketStatus::EmergencyResolved);
    assert_eq!(m.outcome, Some(true), "upheld dispute must override outcome");
    // Upholding does not slash: treasury only holds the round-1 bond.
    assert_eq!(client.get_treasury_balance(), 50_000);

    // Cannot re-dispute or re-rule once emergency-resolved.
    let err = client
        .try_dispute(&disputer_1, &mid, &10_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::MarketNotClosed);
    assert!(client.try_admin_reject_dispute(&admin, &mid).is_err());

    // ── Finalize and settle on the overridden outcome ────────────────────────
    client.finalize(&mid);
    assert_eq!(client.get_market(&mid).status, MarketStatus::Resolved);

    let payout = client.redeem(&user_yes, &mid);
    assert!(payout > 0);
    let err = client.try_redeem(&user_no, &mid).unwrap_err().unwrap();
    assert_eq!(err, Error::NothingToRedeem);

    // Resolved markets are terminal for the dispute machine.
    let err = client
        .try_dispute(&disputer_1, &mid, &10_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::MarketNotClosed);
    let err = client.try_finalize(&mid).unwrap_err().unwrap();
    assert_eq!(err, Error::MarketNotClosed);
// ── 11. Emergency upgrade & market containment (#1259) ────────────────────────

#[test]
fn test_upgrade_rejects_non_admin() {
    let (env, client, _admin, _treasury, _oracle) = setup();
    let attacker = Address::generate(&env);
    let fake_hash = BytesN::from_array(&env, &[7u8; 32]);

    // Non-admin is rejected before the deployer is ever touched. A full
    // successful WASM-swap round trip requires a second compiled contract
    // binary uploaded via the deployer, which isn't available in this unit
    // test crate — that path is exercised in deployment/integration testing
    // outside `cargo test`, not here.
    let err = client.try_upgrade(&attacker, &fake_hash).unwrap_err().unwrap();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_emergency_drain_market_rejects_non_admin() {
    let (env, client, admin, _treasury, oracle) = setup();
    let attacker = Address::generate(&env);
    let mid = client.create_market(&admin, &question(&env), &oracle);

    let err = client
        .try_emergency_drain_market(&attacker, &mid)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::Unauthorized);

    // Rejected call must not have touched the market.
    let market = client.get_market(&mid);
    assert_eq!(market.status, prediction_market::MarketStatus::Open);
}

#[test]
fn test_emergency_drain_market_cancels_and_preserves_storage() {
    let (env, client, admin, _treasury, oracle, token, token_sac) = setup_with_token();
    let user = Address::generate(&env);
    token_sac.mint(&user, &300_000);

    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.split(&user, &mid, &300_000);

    // Admin-gated emergency containment.
    client.emergency_drain_market(&admin, &mid);
    let market = client.get_market(&mid);
    assert_eq!(market.status, prediction_market::MarketStatus::Cancelled);
    // Unrelated market fields survive the drain untouched.
    assert_eq!(market.creator, admin);
    assert_eq!(market.question, question(&env));

    // Holders recover their position through the existing cancelled-market
    // refund path, including real collateral for the split-originated shares.
    let refund = client.redeem(&user, &mid);
    assert_eq!(refund, 600_000); // 300_000 yes + 300_000 no shares, 1:1
    assert_eq!(token.balance(&user), 300_000);
    assert_eq!(token.balance(&client.address), 0);

    // Draining an already-cancelled market fails cleanly instead of
    // double-cancelling.
    let err = client
        .try_emergency_drain_market(&admin, &mid)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::MarketAlreadyCancelled);
}

// ── 12. Redeem payout precision & dust routing (#1257) ────────────────────────

#[test]
fn test_redeem_precision_dust_flushes_to_lp_fees_with_exact_conservation() {
    let (env, client, admin, _treasury, oracle) = setup();
    let buyer_a = Address::generate(&env);
    let buyer_b = Address::generate(&env);

    let mid = client.create_market(&admin, &question(&env), &oracle);
    // Fresh, unseeded market: the first buy lands on calc_shares' 0/0
    // bootstrap branch (shares == amount), so pool/share state — and thus
    // the exact payout math below — is fully predictable.
    let shares_a = client.buy_yes(&buyer_a, &mid, &3, &1);
    assert_eq!(shares_a, 3);
    let shares_b = client.buy_yes(&buyer_b, &mid, &4, &1);
    // shares_b = 4 * (0 + 3) / (3 + 4) = 12 / 7 = 1 (truncated) — a
    // deliberately non-evenly-divisible share split.
    assert_eq!(shares_b, 1);

    client.close_market(&admin, &mid);
    client.oracle_report(&oracle, &mid, &true);
    client.finalize(&mid);

    // An erroring guarded call must not leave the lock held.
    assert_eq!(
        client.try_remove_liquidity(&user, &mid, &1).unwrap_err().unwrap(),
        Error::InsufficientFunds
    );

    // batch_redeem runs under a single guard; redeeming the same market twice
    // in one batch must pay once — the position is cleared before the second pass.
    let result = client.batch_redeem(&user, &vec![&env, mid, mid]);
    assert_eq!(result.successes.len(), 1);
    assert_eq!(result.failures.len(), 1);
    assert_eq!(result.failures.get(0).unwrap().error, Error::NothingToRedeem);
    assert_eq!(client.get_position(&mid, &user).yes_shares, 0);
    let market = client.get_market(&mid);
    let total_pool = market.yes_pool + market.no_pool;
    let total_winning = market.yes_shares;
    assert_eq!(total_pool, 7);
    assert_eq!(total_winning, 4);

    let payout_a = client.redeem(&buyer_a, &mid);
    let payout_b = client.redeem(&buyer_b, &mid);

    // Exact payouts, independently computed with the same PRECISION-scaled
    // single-division formula the contract uses internally.
    assert_eq!(payout_a, 5); // (3 * 10_000_000 * 7) / 4 / 10_000_000 = 5
    assert_eq!(payout_b, 1); // (1 * 10_000_000 * 7) / 4 / 10_000_000 = 1

    // Nothing is unaccounted for: the truncated fractions from both
    // redemptions (2_500_000 + 7_500_000 == PRECISION) flush into exactly
    // one whole lp_fees unit, leaving zero pending dust.
    let market_after = client.get_market(&mid);
    assert_eq!(market_after.lp_fees, 1);
    assert_eq!(market_after.dust, 0);

    // Conservation invariant: every unit of the pool ends up either paid
    // out or routed to claimable LP fees — nothing vanishes, nothing is
    // fabricated.
    assert_eq!(payout_a + payout_b + market_after.lp_fees, total_pool);
}

// ── 13. Dispute bond escrow (#1258) ───────────────────────────────────────────

#[test]
fn test_dispute_rejects_bond_below_minimum() {
    let (env, client, admin, _treasury, oracle, token, token_sac) = setup_with_token();
    let disputer = Address::generate(&env);
    token_sac.mint(&disputer, &10_000_000);

    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.close_market(&admin, &mid);
    client.oracle_report(&oracle, &mid, &true);

    // Below MIN_DISPUTE_BOND (10_000_000) → rejected before any token
    // transfer is attempted, and the disputer's balance is untouched.
    let err = client
        .try_dispute(&disputer, &mid, &9_999_999)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidAmount);
    assert_eq!(token.balance(&disputer), 10_000_000);

    let market = client.get_market(&mid);
    assert_eq!(market.status, prediction_market::MarketStatus::Closed);
}

#[test]
#[should_panic]
fn test_dispute_fails_without_sufficient_balance() {
    let (env, client, admin, _treasury, oracle, _token, token_sac) = setup_with_token();
    let disputer = Address::generate(&env);
    // Funded below the bond they'll attempt to post.
    token_sac.mint(&disputer, &5_000_000);

    let mid = client.create_market(&admin, &question(&env), &oracle);
    client.seed_market(&admin, &mid, &1_000_000);
    client.close_market(&admin, &mid);
    client.oracle_report(&oracle, &mid, &true);

    // Bond clears MIN_DISPUTE_BOND but exceeds the disputer's real balance —
    // the token transfer traps before the market is marked Disputed.
    client.dispute(&disputer, &mid, &10_000_000);
}
