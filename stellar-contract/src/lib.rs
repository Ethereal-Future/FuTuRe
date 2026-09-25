#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, vec, Address, Env, IntoVal, Map,
    Symbol, Val, Vec,
    contract, contractimpl, contracttype, symbol_short, token, vec, Address, BytesN, Env,
    IntoVal, Map, Symbol, Val, Vec,
};

// ── Storage keys ────────────────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");
const PAUSED: Symbol = symbol_short!("PAUSED");
const MKT_CNT: Symbol = symbol_short!("MKT_CNT");
const TREASURY: Symbol = symbol_short!("TREASURY");
/// Transient reentrancy lock held while a state-mutating LP/redeem call runs.
const REENTRY: Symbol = symbol_short!("REENTRY");
const TOKEN: Symbol = symbol_short!("TOKEN");

// ── State TTL (ledgers; ~5s per ledger → 17_280 ledgers per day) ─────────────

const DAY_IN_LEDGERS: u32 = 17_280;
/// Instance storage is extended once its TTL falls below this threshold.
pub const INSTANCE_BUMP_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;
/// Instance storage TTL target after an extension.
pub const INSTANCE_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
/// Market / position entries are extended once their TTL falls below this threshold.
pub const PERSISTENT_BUMP_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
/// Market / position TTL target after an extension.
pub const PERSISTENT_EXTEND_TO: u32 = 120 * DAY_IN_LEDGERS;
/// Collateral token every market is denominated in and escrows into.
const TOKEN: Symbol = symbol_short!("TOKEN");

// ── Fixed-point / bond constants ────────────────────────────────────────────

/// Base fixed-point precision (7 decimals), matching the native stroop
/// granularity of Stellar asset amounts. Used to size `MIN_DISPUTE_BOND`
/// below and as the reference unit scale for payout dust accounting.
const PRECISION: i128 = 10_000_000;

/// Minimum collateral a disputer must escrow to open a dispute (1 whole
/// token at PRECISION's 7-decimal granularity). Prevents zero-cost/dust
/// disputes from stalling market resolution indefinitely.
const MIN_DISPUTE_BOND: i128 = PRECISION;

/// Upper bound on the number of markets `batch_redeem` will process in one
/// call. Each redemption performs several storage reads/writes and emits an
/// event, so an unbounded batch can exhaust the Soroban CPU/memory budget and
/// abort the whole transaction.
pub const MAX_BATCH_REDEEM_SIZE: u32 = 20;

/// Minimum time between `oracle_report` and `finalize`, during which the
/// reported outcome can be disputed.
pub const DISPUTE_WINDOW_SECONDS: u64 = 86_400;
/// Fixed-point scale for `fee_per_share_accumulated`.
const FEE_PRECISION: i128 = 1_000_000_000_000;

// ── Types ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum MarketStatus {
    Open,
    Closed,
    Disputed,
    Resolved,
    Cancelled,
    EmergencyResolved,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Market {
    pub creator: Address,
    pub question: soroban_sdk::String,
    pub yes_shares: i128,
    pub no_shares: i128,
    pub yes_pool: i128,
    pub no_pool: i128,
    /// Total asset value (XLM/tokens) deposited into the LP pool.
    pub lp_pool: i128,
    /// Accumulated trading fees claimable by LPs.
    pub lp_fees: i128,
    /// PRECISION-scaled fractional remainder carried forward between
    /// `redeem` calls (see `PRECISION`). This is sub-base-unit dust, not
    /// whole token units — it is flushed into `lp_fees` once enough of it
    /// accumulates to cover one whole base unit.
    pub dust: i128,
    pub status: MarketStatus,
    pub outcome: Option<bool>, // true = YES won
    pub dispute_bond: i128,
    pub disputer: Option<Address>,
    pub oracle: Option<Address>,
    /// Total LP shares outstanding. Tracked separately from `lp_pool`
    /// so that the share/value ratio can diverge as trading changes pool value.
    pub total_lp_shares: i128,
    /// Ledger timestamp at which the oracle reported the outcome.
    pub reported_at: Option<u64>,
    /// Cumulative LP fees per LP share, scaled by `FEE_PRECISION`.
    pub fee_per_share_accumulated: i128,
    /// Ledger timestamp after which trading stops and the oracle may report.
    pub close_time: u64,
    /// Ledger timestamp after which an unreported market can be cancelled by anyone.
    pub resolution_deadline: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Position {
    pub yes_shares: i128,
    pub no_shares: i128,
    pub lp_shares: i128,
    pub split_tokens: i128,
    /// Snapshot of `fee_per_share_accumulated` at the last fee settlement.
    pub last_fee_per_share: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RedeemOutcome {
    pub market_id: u32,
    pub payout: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RedeemFailure {
    pub market_id: u32,
    pub error: Error,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchRedeemResult {
    pub successes: Vec<RedeemOutcome>,
    pub failures: Vec<RedeemFailure>,
    pub total_payout: i128,
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    MarketNotFound = 4,
    MarketNotOpen = 5,
    MarketNotClosed = 6,
    MarketNotResolved = 7,
    MarketAlreadyCancelled = 8,
    SlippageExceeded = 9,
    InsufficientFunds = 10,
    ContractPaused = 11,
    InvalidOutcome = 12,
    DisputeWindowOpen = 13,
    NothingToRedeem = 14,
    InvalidAmount = 15,
    ReentrancyError = 16,
    TradingClosed = 16,
    MarketNotExpired = 17,
    InvalidDeadline = 18,
    ResolutionDeadlineNotReached = 19,
    ArithmeticOverflow = 16,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct PredictionMarket;

#[contractimpl]
impl PredictionMarket {
    // ── Admin ────────────────────────────────────────────────────────────────

    pub fn init(env: Env, admin: Address, treasury: Address, token: Address) -> Result<(), Error> {
    pub fn init(
        env: Env,
        admin: Address,
        treasury: Address,
        token_address: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&ADMIN) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&TREASURY, &treasury);
        env.storage().instance().set(&TOKEN, &token);
        env.storage().instance().set(&PAUSED, &false);
        env.storage().instance().set(&MKT_CNT, &0u32);
        Self::extend_instance(&env);
        Self::emit_admin(&env, symbol_short!("init"), (admin, treasury));
        env.storage().instance().set(&TOKEN, &token_address);
        env.storage().instance().set(&PAUSED, &false);
        env.storage().instance().set(&MKT_CNT, &0u32);
        Self::emit_admin(&env, symbol_short!("init"), (admin, treasury, token_address));
        Ok(())
    }

    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage().instance().set(&PAUSED, &true);
        Self::emit_admin(&env, symbol_short!("paused"), caller);
        Ok(())
    }

    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage().instance().set(&PAUSED, &false);
        Self::emit_admin(&env, symbol_short!("unpaused"), caller);
        Ok(())
    }

    /// Emergency WASM upgrade. Admin-gated: the currently installed contract
    /// code is replaced with `new_wasm_hash`, which must already be uploaded
    /// on-chain via the deployer's `upload_contract_wasm`. Instance and
    /// persistent storage (markets, positions, admin/treasury keys) are
    /// untouched by this call — only the executable code changes.
    pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
        Self::emit_admin(&env, symbol_short!("upgraded"), (caller, new_wasm_hash));
        Ok(())
    }

    /// Emergency containment for a compromised/misbehaving market. Admin-gated:
    /// cancels the market so every holder can recover their position through
    /// the existing `redeem` → cancelled-market refund path (1:1 share refund,
    /// plus real collateral return for `split`-originated positions).
    pub fn emergency_drain_market(env: Env, caller: Address, market_id: u32) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        let mut market = Self::load_market(&env, market_id)?;
        if market.status == MarketStatus::Cancelled {
            return Err(Error::MarketAlreadyCancelled);
        }
        market.status = MarketStatus::Cancelled;
        Self::save_market(&env, market_id, &market);
        Self::emit_admin(&env, symbol_short!("drained"), (market_id, caller));
        Ok(())
    }

    // ── Market lifecycle ─────────────────────────────────────────────────────

    pub fn create_market(
        env: Env,
        creator: Address,
        question: soroban_sdk::String,
        oracle: Address,
        close_time: u64,
        resolution_deadline: u64,
    ) -> Result<u32, Error> {
        creator.require_auth();
        Self::require_not_paused(&env)?;
        if close_time <= env.ledger().timestamp() || resolution_deadline <= close_time {
            return Err(Error::InvalidDeadline);
        }
        let id: u32 = env.storage().instance().get(&MKT_CNT).unwrap_or(0);
        let market = Market {
            creator: creator.clone(),
            question,
            yes_shares: 0,
            no_shares: 0,
            yes_pool: 0,
            no_pool: 0,
            lp_pool: 0,
            lp_fees: 0,
            dust: 0,
            status: MarketStatus::Open,
            outcome: None,
            dispute_bond: 0,
            disputer: None,
            oracle: Some(oracle.clone()),
            total_lp_shares: 0,
            reported_at: None,
            fee_per_share_accumulated: 0,
            close_time,
            resolution_deadline,
        };
        Self::save_market(&env, id, &market);
        env.storage().instance().set(&MKT_CNT, &(id + 1));
        Self::emit(
            &env,
            symbol_short!("created"),
            (id, creator, oracle),
        );
        Ok(id)
    }

    pub fn seed_market(env: Env, caller: Address, market_id: u32, amount: i128) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_positive(amount)?;
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Open)?;
        Self::require_trading_open(&env, &market)?;
        Self::require_positive(amount)?;
        // Seeding credits `amount` to both the YES and NO pools, so the
        // contract must take custody of `2 * amount` to keep the pools backed.
        Self::transfer_in(&env, &caller, amount * 2)?;
        market.yes_pool += amount;
        market.no_pool += amount;
        market.yes_pool = Self::checked_add(market.yes_pool, amount)?;
        market.no_pool = Self::checked_add(market.no_pool, amount)?;
        Self::save_market(&env, market_id, &market);
        Self::emit(&env, symbol_short!("seeded"), (market_id, caller, amount));
        Ok(())
    }

    pub fn close_market(env: Env, caller: Address, market_id: u32) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Open)?;
        Self::require_admin_or_creator(&env, &caller, &market.creator)?;
        // Only the admin may halt trading before the scheduled close time.
        if env.ledger().timestamp() < market.close_time {
            Self::require_admin(&env, &caller)?;
        }
        market.status = MarketStatus::Closed;
        Self::save_market(&env, market_id, &market);
        Self::emit(&env, symbol_short!("closed"), (market_id, caller));
        Ok(())
    }

    pub fn oracle_report(
        env: Env,
        caller: Address,
        market_id: u32,
        outcome: bool,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Closed)?;
        // Verify caller is the oracle
        if market.oracle != Some(caller.clone()) {
            return Err(Error::Unauthorized);
        }
        if env.ledger().timestamp() < market.close_time {
            return Err(Error::MarketNotExpired);
        }
        market.outcome = Some(outcome);
        market.reported_at = Some(env.ledger().timestamp());
        // Status stays Closed; finalize moves it to Resolved after dispute window
        Self::save_market(&env, market_id, &market);
        Self::emit(&env, symbol_short!("reported"), (market_id, caller, outcome));
        Ok(())
    }

    pub fn dispute(
        env: Env,
        disputer: Address,
        market_id: u32,
        bond: i128,
    ) -> Result<(), Error> {
        disputer.require_auth();
        Self::require_not_paused(&env)?;
        if bond < MIN_DISPUTE_BOND {
            return Err(Error::InvalidAmount);
        }
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Closed)?;
        if market.outcome.is_none() {
            return Err(Error::InvalidOutcome);
        }
        Self::require_positive(bond)?;
        // Escrow the bond into the contract before flipping status, so a
        // failed/insufficient transfer aborts the whole call instead of
        // leaving a market marked Disputed with no collateral behind it.
        let token_client = token::Client::new(&env, &Self::token_address(&env)?);
        token_client.transfer(&disputer, &env.current_contract_address(), &bond);
        market.status = MarketStatus::Disputed;
        market.disputer = Some(disputer.clone());
        market.dispute_bond = bond;
        Self::save_market(&env, market_id, &market);
        Self::emit(&env, symbol_short!("disputed"), (market_id, disputer, bond));
        Ok(())
    }

    /// Admin upholds dispute → emergency resolve.
    ///
    /// NOTE: this does not yet return `market.dispute_bond` to the disputer.
    /// Now that `dispute` escrows a real token bond (#1258), an upheld
    /// dispute leaves that collateral stranded in the contract. Tracked as
    /// follow-up work — out of scope for the split/merge/dispute/upgrade
    /// fixes this change makes.
    pub fn admin_uphold_dispute(
        env: Env,
        caller: Address,
        market_id: u32,
        new_outcome: bool,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Disputed)?;
        // The disputer was right: return 100% of their bond.
        let disputer = market.disputer.clone().ok_or(Error::Unauthorized)?;
        let refund = market.dispute_bond;
        let key = Self::bond_refund_key(&disputer);
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + refund));
        market.dispute_bond = 0;
        market.disputer = None;
        market.outcome = Some(new_outcome);
        market.status = MarketStatus::EmergencyResolved;
        Self::save_market(&env, market_id, &market);
        Self::emit(&env, symbol_short!("upheld"), (market_id, caller, new_outcome));
        Self::emit(&env, symbol_short!("bond_ref"), (market_id, disputer, refund));
        Ok(())
    }

    /// Admin rejects dispute → slash bond to treasury
    pub fn admin_reject_dispute(
        env: Env,
        caller: Address,
        market_id: u32,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Disputed)?;
        // Slash bond: add to treasury balance (tracked in market for simplicity)
        let _treasury: Address = env.storage().instance().get(&TREASURY).ok_or(Error::NotInitialized)?;
        let key = Self::treasury_key(&env);
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        let slashed = market.dispute_bond;
        env.storage().persistent().set(&key, &(current + slashed));
        Self::extend_persistent(&env, &key);
        market.dispute_bond = 0;
        market.disputer = None;
        // Revert to Closed so finalize can proceed
        market.status = MarketStatus::Closed;
        Self::save_market(&env, market_id, &market);
        Self::emit(&env, symbol_short!("rejected"), (market_id, caller, slashed));
        Ok(())
    }

    /// Called after dispute window passes (or immediately if no dispute)
    pub fn finalize(env: Env, market_id: u32) -> Result<(), Error> {
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        if market.status != MarketStatus::Closed && market.status != MarketStatus::EmergencyResolved {
            return Err(Error::MarketNotClosed);
        }
        if market.outcome.is_none() {
            return Err(Error::InvalidOutcome);
        }
        // EmergencyResolved markets were already adjudicated by the admin and
        // bypass the remaining dispute window.
        if market.status == MarketStatus::Closed {
            let reported_at = market.reported_at.ok_or(Error::InvalidOutcome)?;
            if env.ledger().timestamp() < reported_at.saturating_add(DISPUTE_WINDOW_SECONDS) {
                return Err(Error::DisputeWindowOpen);
            }
        }
        market.status = MarketStatus::Resolved;
        Self::save_market(&env, market_id, &market);
        Self::emit(&env, symbol_short!("resolved"), (market_id, market.outcome));
        Ok(())
    }

    pub fn cancel_market(env: Env, caller: Address, market_id: u32) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_admin_or_creator(&env, &caller, &market.creator)?;
        if market.status == MarketStatus::Cancelled {
            return Err(Error::MarketAlreadyCancelled);
        }
        market.status = MarketStatus::Cancelled;
        Self::save_market(&env, market_id, &market);
        Self::emit(&env, symbol_short!("cancelled"), (market_id, caller));
        Ok(())
    }

    /// Permissionless escape hatch: if the oracle has not reported by
    /// `resolution_deadline`, anyone may cancel the market so participants can
    /// reclaim their funds through `redeem`.
    pub fn emergency_timeout_refund(env: Env, market_id: u32) -> Result<(), Error> {
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        if market.status != MarketStatus::Open && market.status != MarketStatus::Closed {
            return Err(Error::MarketNotOpen);
        }
        if market.outcome.is_some() {
            return Err(Error::InvalidOutcome);
        }
        if env.ledger().timestamp() <= market.resolution_deadline {
            return Err(Error::ResolutionDeadlineNotReached);
        }
        market.status = MarketStatus::Cancelled;
        Self::save_market(&env, market_id, &market);
        Self::emit(&env, symbol_short!("timeout"), market_id);
        Ok(())
    }

    // ── Trading ──────────────────────────────────────────────────────────────

    pub fn buy_yes(
        env: Env,
        buyer: Address,
        market_id: u32,
        amount: i128,
        min_shares_out: i128,
    ) -> Result<i128, Error> {
        buyer.require_auth();
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Open)?;
        Self::require_positive(amount)?;
        let shares = Self::calc_shares(amount, market.yes_pool, market.no_pool)?;
        Self::require_trading_open(&env, &market)?;
        Self::require_positive(amount)?;
        let shares = Self::calc_shares(amount, market.yes_pool, market.no_pool);
        if shares < min_shares_out {
            return Err(Error::SlippageExceeded);
        }
        Self::transfer_in(&env, &buyer, amount)?;
        market.yes_pool += amount;
        market.yes_shares += shares;
        Self::save_market(&env, market_id, &market);
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let shares = Self::calc_shares(amount, market.yes_pool, market.no_pool)?;
        if shares < min_shares_out {
            return Err(Error::SlippageExceeded);
        }
        market.yes_pool = Self::checked_add(market.yes_pool, amount)?;
        market.yes_shares = Self::checked_add(market.yes_shares, shares)?;
        let mut pos = Self::load_position(&env, market_id, &buyer);
        pos.yes_shares = Self::checked_add(pos.yes_shares, shares)?;
        Self::save_market(&env, market_id, &market);
        Self::save_position(&env, market_id, &buyer, &pos);
        Self::emit(
            &env,
            symbol_short!("traded"),
            (market_id, buyer, true, amount, shares),
        );
        Ok(shares)
    }

    pub fn buy_no(
        env: Env,
        buyer: Address,
        market_id: u32,
        amount: i128,
        min_shares_out: i128,
    ) -> Result<i128, Error> {
        buyer.require_auth();
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Open)?;
        Self::require_positive(amount)?;
        let shares = Self::calc_shares(amount, market.no_pool, market.yes_pool)?;
        Self::require_trading_open(&env, &market)?;
        Self::require_positive(amount)?;
        let shares = Self::calc_shares(amount, market.no_pool, market.yes_pool);
        if shares < min_shares_out {
            return Err(Error::SlippageExceeded);
        }
        Self::transfer_in(&env, &buyer, amount)?;
        market.no_pool += amount;
        market.no_shares += shares;
        Self::save_market(&env, market_id, &market);
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let shares = Self::calc_shares(amount, market.no_pool, market.yes_pool)?;
        if shares < min_shares_out {
            return Err(Error::SlippageExceeded);
        }
        market.no_pool = Self::checked_add(market.no_pool, amount)?;
        market.no_shares = Self::checked_add(market.no_shares, shares)?;
        let mut pos = Self::load_position(&env, market_id, &buyer);
        pos.no_shares = Self::checked_add(pos.no_shares, shares)?;
        Self::save_market(&env, market_id, &market);
        Self::save_position(&env, market_id, &buyer, &pos);
        Self::emit(
            &env,
            symbol_short!("traded"),
            (market_id, buyer, false, amount, shares),
        );
        Ok(shares)
    }

    // ── Redeem ───────────────────────────────────────────────────────────────

    pub fn redeem(env: Env, redeemer: Address, market_id: u32) -> Result<i128, Error> {
        redeemer.require_auth();
        Self::enter_reentrancy_guard(&env)?;
        let result = Self::redeem_inner(&env, &redeemer, market_id);
        Self::exit_reentrancy_guard(&env);
        result
    }

    /// Batch redeem across multiple markets
    /// Returns per-market success/failure information instead of silently skipping failed markets.
    pub fn batch_redeem(env: Env, redeemer: Address, market_ids: Vec<u32>) -> Result<BatchRedeemResult, Error> {
        redeemer.require_auth();
        Self::enter_reentrancy_guard(&env)?;
        let result = Self::batch_redeem_inner(&env, &redeemer, market_ids);
        Self::exit_reentrancy_guard(&env);
        result
    }

    // ── LP ───────────────────────────────────────────────────────────────────

    pub fn add_liquidity(
        env: Env,
        provider: Address,
        market_id: u32,
        amount: i128,
    ) -> Result<i128, Error> {
        provider.require_auth();
        Self::enter_reentrancy_guard(&env)?;
        let result = Self::add_liquidity_inner(&env, &provider, market_id, amount);
        Self::exit_reentrancy_guard(&env);
        result
    }

    pub fn remove_liquidity(
        env: Env,
        provider: Address,
        market_id: u32,
        lp_shares: i128,
    ) -> Result<i128, Error> {
        provider.require_auth();
        Self::enter_reentrancy_guard(&env)?;
        let result = Self::remove_liquidity_inner(&env, &provider, market_id, lp_shares);
        Self::exit_reentrancy_guard(&env);
        result
    }

    pub fn claim_lp_fees(
        env: Env,
        provider: Address,
        market_id: u32,
    ) -> Result<i128, Error> {
        provider.require_auth();
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        let pos = Self::load_position(&env, market_id, &provider);
        if pos.lp_shares == 0 {
            return Err(Error::NothingToRedeem);
        }
        // Fee share = provider_lp_shares / total_lp_shares_outstanding * accumulated_fees.
        // Use total_lp_shares (share units) not lp_pool (asset units) as the denominator
        // so that the fee split is proportional to ownership, not to deposit size.
        let total_lp = market.total_lp_shares.max(1);
        let fee_share = (pos.lp_shares * market.lp_fees) / total_lp;
        market.lp_fees -= fee_share;
        Self::save_market(&env, market_id, &market);
        Self::emit_liquidity(&env, symbol_short!("claimed"), (market_id, provider, fee_share));
        Ok(fee_share)
    }

    // ── Split / Merge ────────────────────────────────────────────────────────

    pub fn split(
        env: Env,
        caller: Address,
        market_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        let market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Open)?;
        let mut pos = Self::load_position(&env, market_id, &caller);
        pos.yes_shares += amount;
        pos.no_shares += amount;
        pos.split_tokens += amount;
        Self::save_position(&env, market_id, &caller, &pos);
        Self::emit(&env, symbol_short!("split"), (market_id, caller, amount));
        Ok(())
    }

    pub fn merge(
        env: Env,
        caller: Address,
        market_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        let market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Open)?;
        let mut pos = Self::load_position(&env, market_id, &caller);
        if pos.yes_shares < amount || pos.no_shares < amount {
            return Err(Error::InsufficientFunds);
        }
        pos.yes_shares -= amount;
        pos.no_shares -= amount;
        pos.split_tokens -= amount.min(pos.split_tokens);
        Self::save_position(&env, market_id, &caller, &pos);
        Self::emit(&env, symbol_short!("merged"), (market_id, caller, amount));
        Ok(())
    }

    // ── Views ────────────────────────────────────────────────────────────────

    pub fn get_market(env: Env, market_id: u32) -> Result<Market, Error> {
        Self::load_market(&env, market_id)
    }

    pub fn get_position(env: Env, market_id: u32, user: Address) -> Position {
        Self::load_position(&env, market_id, &user)
    }

    pub fn get_treasury_balance(env: Env) -> i128 {
        let key = Self::treasury_key(&env);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    // ── Events ───────────────────────────────────────────────────────────────
    //
    // Every state-mutating function above publishes an on-chain event via one
    // of these helpers so off-chain indexers can subscribe to contract
    // activity instead of re-scanning storage. Topics follow a
    // `(category, action)` scheme; see `stellar-contract/README.md` for the
    // full topic/payload table.

    /// Publish an event under the `("market", action)` topic.
    // ── Guarded internals (Checks-Effects-Interactions) ──────────────────────

    fn redeem_inner(env: &Env, redeemer: &Address, market_id: u32) -> Result<i128, Error> {
        Self::require_not_paused(&env)?;
        let market = Self::load_market(env, market_id)?;
        let mut market = Self::load_market(&env, market_id)?;
        if market.status == MarketStatus::Cancelled {
            return Self::refund_cancelled(env, redeemer, market_id, &market);
        }
        if market.status != MarketStatus::Resolved && market.status != MarketStatus::EmergencyResolved {
            return Err(Error::MarketNotResolved);
        }
        let mut pos = Self::load_position(env, market_id, redeemer);
        let winning_shares = match market.outcome {
            Some(true) => pos.yes_shares,
            Some(false) => pos.no_shares,
            None => return Err(Error::InvalidOutcome),
        };
        if winning_shares == 0 {
            return Err(Error::NothingToRedeem);
        }
        let total_pool = market.yes_pool + market.no_pool;
        let total_winning = if market.outcome == Some(true) {
            market.yes_shares
        } else {
            market.no_shares
        };
        let payout = if total_winning > 0 {
            // Single combined multiply-then-divide (not two chained
            // divisions, which would floor twice and lose untracked value)
            // computes the payout at PRECISION's 7-decimal granularity in
            // one step. The only information this loses is a fraction
            // smaller than 1/PRECISION of one base unit (stroop) per
            // redeemer — negligible and, unlike plain
            // `(winning_shares * total_pool) / total_winning`, fully
            // captured below instead of silently discarded.
            let scaled_payout = (winning_shares * PRECISION * total_pool) / total_winning;
            let payout = scaled_payout / PRECISION;
            // `dust_scaled` is a sub-base-unit fraction (always < PRECISION,
            // i.e. < 1 real token unit), never itself a payable whole token
            // amount. Carry it forward in the market's scaled dust
            // accumulator and only flush whole base units into `lp_fees`
            // once enough of it has accumulated, so nothing is ever over-
            // or under-credited.
            let dust_scaled = scaled_payout % PRECISION;
            market.dust += dust_scaled;
            if market.dust >= PRECISION {
                let whole_units = market.dust / PRECISION;
                market.lp_fees += whole_units;
                market.dust -= whole_units * PRECISION;
            }
            payout
        } else {
            0
        };
        // Effects: clear the position and commit it to storage before any
        // interaction (event emission / future token transfer) so that a
        // re-entrant call observes zero winning shares (CEI pattern).
        if market.outcome == Some(true) {
            pos.yes_shares = 0;
        } else {
            pos.no_shares = 0;
        }
        Self::save_position(env, market_id, redeemer, &pos);
        // Interactions
        Self::emit(env, symbol_short!("redeemed"), (market_id, redeemer.clone(), payout));
        Ok(payout)
    }

    fn batch_redeem_inner(env: &Env, redeemer: &Address, market_ids: Vec<u32>) -> Result<BatchRedeemResult, Error> {
        let mut successes: Vec<RedeemOutcome> = Vec::new(env);
        let mut failures: Vec<RedeemFailure> = Vec::new(env);
        Self::save_market(&env, market_id, &market);
        Self::save_position(&env, market_id, &redeemer, &pos);
        Self::transfer_out(&env, &redeemer, payout)?;
        Self::emit(&env, symbol_short!("redeemed"), (market_id, redeemer, payout));
        Ok(payout)
    }

    /// Batch redeem across multiple markets
    /// Returns per-market success/failure information instead of silently skipping failed markets.
    pub fn batch_redeem(env: Env, redeemer: Address, market_ids: Vec<u32>) -> Result<BatchRedeemResult, Error> {
        redeemer.require_auth();
        if market_ids.len() > MAX_BATCH_REDEEM_SIZE {
            return Err(Error::InvalidAmount);
        }
        let mut successes: Vec<RedeemOutcome> = Vec::new();
        let mut failures: Vec<RedeemFailure> = Vec::new();
        let mut total_payout: i128 = 0;

        for id in market_ids.iter() {
            match Self::redeem_inner(env, redeemer, id) {
                Ok(payout) => {
                    total_payout += payout;
                    successes.push_back(RedeemOutcome {
                        market_id: id,
                        payout,
                    });
                }
                Err(error) => {
                    failures.push_back(RedeemFailure {
                        market_id: id,
                        error,
                    });
                }
            }
        }

        Ok(BatchRedeemResult {
            successes,
            failures,
            total_payout,
        })
    }

    fn add_liquidity_inner(
        env: &Env,
        provider: &Address,
        market_id: u32,
        amount: i128,
    ) -> Result<i128, Error> {
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(env, market_id)?;
        Self::require_status(&market, &MarketStatus::Open)?;
        Self::require_positive(amount)?;
        Self::require_trading_open(&env, &market)?;
        Self::require_positive(amount)?;
        Self::transfer_in(&env, &provider, amount)?;

        // Mint LP shares proportional to the provider's share of the pool value.
        // • First provider (empty pool): shares == amount (1:1 bootstrap).
        // • Subsequent providers: shares = amount * total_lp_shares / lp_pool,
        //   so later depositors into a more-valuable pool receive fewer shares
        //   for the same nominal deposit, correctly diluting their claim.
        let lp_shares = if market.lp_pool == 0 || market.total_lp_shares == 0 {
            amount
        } else {
            amount
                .checked_mul(market.total_lp_shares)
                .ok_or(Error::ArithmeticOverflow)?
                / market.lp_pool
        };

        market.lp_pool += amount;
        market.total_lp_shares += lp_shares;
        market.yes_pool += amount / 2;
        market.no_pool += amount / 2;
        Self::save_market(env, market_id, &market);

        if lp_shares <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Settle pending fees on existing shares and checkpoint so the new
        // shares cannot claim historical fees.
        let mut pos = Self::load_position(&env, market_id, &provider);
        Self::settle_lp_fees(&env, market_id, &provider, &market, &mut pos);
        let mut pos = Self::load_position(env, market_id, provider);
        pos.lp_shares += lp_shares;
        Self::save_position(env, market_id, provider, &pos);
        market.lp_pool = Self::checked_add(market.lp_pool, amount)?;
        market.total_lp_shares = Self::checked_add(market.total_lp_shares, lp_shares)?;
        market.yes_pool = Self::checked_add(market.yes_pool, amount / 2)?;
        market.no_pool = Self::checked_add(market.no_pool, amount / 2)?;
        let mut pos = Self::load_position(&env, market_id, &provider);
        pos.lp_shares = Self::checked_add(pos.lp_shares, lp_shares)?;
        Self::save_market(&env, market_id, &market);
        Self::save_position(&env, market_id, &provider, &pos);
        Self::emit_liquidity(
            env,
            symbol_short!("added"),
            (market_id, provider.clone(), amount, lp_shares),
        );
        Ok(lp_shares)
    }

    fn remove_liquidity_inner(
        env: &Env,
        provider: &Address,
        market_id: u32,
        lp_shares: i128,
    ) -> Result<i128, Error> {
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_positive(lp_shares)?;
        let mut pos = Self::load_position(&env, market_id, &provider);
        let mut market = Self::load_market(env, market_id)?;
        let mut pos = Self::load_position(env, market_id, provider);
        if pos.lp_shares < lp_shares {
            return Err(Error::InsufficientFunds);
        }
        Self::settle_lp_fees(&env, market_id, &provider, &market, &mut pos);

        // Payout = redeemed_shares * current_pool_value / total_shares_outstanding.
        // This means an LP that deposited when the pool was large and trading has
        // since shifted yes/no prices will receive a payout reflecting the pool's
        // current total value — not just their original deposit.
        let payout = if market.total_lp_shares > 0 {
            (lp_shares * market.lp_pool) / market.total_lp_shares
        } else {
            lp_shares
        };

        // Mirror `add_liquidity`, which credited half of each deposit to both
        // yes_pool and no_pool: withdraw the same split of the payout so that
        // `redeem` never pays out phantom liquidity. Clamped so the pools
        // cannot underflow below zero.
        let deduct_yes = (payout / 2).min(market.yes_pool).max(0);
        let deduct_no = (payout / 2).min(market.no_pool).max(0);
        market.yes_pool -= deduct_yes;
        market.no_pool -= deduct_no;
        market.lp_pool -= payout;
        market.total_lp_shares -= lp_shares;
        pos.lp_shares -= lp_shares;
        Self::save_market(env, market_id, &market);
        Self::save_position(env, market_id, provider, &pos);
        Self::save_market(&env, market_id, &market);
        Self::save_position(&env, market_id, &provider, &pos);
        Self::transfer_out(&env, &provider, payout)?;
        Self::emit_liquidity(
            env,
            symbol_short!("removed"),
            (market_id, provider.clone(), lp_shares, payout),
        );
        Ok(payout)
    }

    // ── Reentrancy guard ─────────────────────────────────────────────────────

    fn enter_reentrancy_guard(env: &Env) -> Result<(), Error> {
        if env.storage().instance().get::<_, bool>(&REENTRY).unwrap_or(false) {
            return Err(Error::ReentrancyError);
        }
        env.storage().instance().set(&REENTRY, &true);
        Ok(())
    }

    fn exit_reentrancy_guard(env: &Env) {
        env.storage().instance().remove(&REENTRY);
    pub fn claim_lp_fees(
        env: Env,
        provider: Address,
        market_id: u32,
    ) -> Result<i128, Error> {
        provider.require_auth();
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        let mut pos = Self::load_position(&env, market_id, &provider);
        if pos.lp_shares == 0 && Self::pending_lp_fees(&env, market_id, &provider) == 0 {
            return Err(Error::NothingToRedeem);
        }
        // Accumulator accounting: each LP is paid
        // lp_shares * (fee_per_share_accumulated - last_fee_per_share) / PRECISION
        // plus any fees settled on earlier add/remove, so payouts are
        // independent of claim order and cannot be claimed twice.
        Self::settle_lp_fees(&env, market_id, &provider, &market, &mut pos);
        let key = Self::pending_fee_key(market_id, &provider);
        let fee_share: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().remove(&key);
        market.lp_fees -= fee_share;
        Self::save_market(&env, market_id, &market);
        Self::save_position(&env, market_id, &provider, &pos);
        Self::transfer_out(&env, &provider, fee_share)?;
        Self::emit_liquidity(&env, symbol_short!("claimed"), (market_id, provider, fee_share));
        Ok(fee_share)
    }

    /// Credit trading fees to the market's LPs. Admin-only until trading
    /// functions charge fees directly; they should route through `accrue_lp_fees`.
    pub fn add_lp_fees(env: Env, caller: Address, market_id: u32, amount: i128) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        Self::require_positive(amount)?;
        let mut market = Self::load_market(&env, market_id)?;
        if market.total_lp_shares <= 0 {
            return Err(Error::NothingToRedeem);
        }
        Self::accrue_lp_fees(&mut market, amount);
        Self::save_market(&env, market_id, &market);
        Self::emit_liquidity(&env, symbol_short!("fees"), (market_id, amount));
        Ok(())
    }

    // ── Split / Merge ────────────────────────────────────────────────────────

    pub fn split(
        env: Env,
        caller: Address,
        market_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Open)?;
        Self::require_positive(amount)?;
        Self::transfer_in(&env, &caller, amount)?;
        // Pull 1:1 collateral into the contract escrow before minting any
        // shares — a failed/insufficient transfer aborts the whole call, so
        // YES/NO shares can never be minted without backing collateral.
        let token_client = token::Client::new(&env, &Self::token_address(&env)?);
        token_client.transfer(&caller, &env.current_contract_address(), &amount);
        let mut pos = Self::load_position(&env, market_id, &caller);
        pos.yes_shares += amount;
        pos.no_shares += amount;
        pos.split_tokens += amount;
        Self::save_position(&env, market_id, &caller, &pos);
        Self::emit(&env, symbol_short!("split"), (market_id, caller, amount));
        Ok(())
    }

    pub fn merge(
        env: Env,
        caller: Address,
        market_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Open)?;
        Self::require_positive(amount)?;
        let mut pos = Self::load_position(&env, market_id, &caller);
        if pos.yes_shares < amount || pos.no_shares < amount {
            return Err(Error::InsufficientFunds);
        }
        // Burn shares before releasing collateral (checks-effects-interactions).
        pos.yes_shares -= amount;
        pos.no_shares -= amount;
        pos.split_tokens -= amount.min(pos.split_tokens);
        Self::save_position(&env, market_id, &caller, &pos);
        Self::transfer_out(&env, &caller, amount)?;
        let token_client = token::Client::new(&env, &Self::token_address(&env)?);
        token_client.transfer(&env.current_contract_address(), &caller, &amount);
        Self::emit(&env, symbol_short!("merged"), (market_id, caller, amount));
        Ok(())
    }

    // ── Views ────────────────────────────────────────────────────────────────

    pub fn get_market(env: Env, market_id: u32) -> Result<Market, Error> {
        Self::load_market(&env, market_id)
    }

    pub fn get_position(env: Env, market_id: u32, user: Address) -> Position {
        Self::load_position(&env, market_id, &user)
    }

    /// Dispute bond refunded to `disputer` after upheld disputes.
    pub fn get_bond_refund(env: Env, disputer: Address) -> i128 {
        env.storage().persistent().get(&Self::bond_refund_key(&disputer)).unwrap_or(0)
    }

    pub fn get_treasury_balance(env: Env) -> i128 {
        let key = Self::treasury_key(&env);
        let bal = env.storage().persistent().get(&key).unwrap_or(0);
        if bal != 0 {
            Self::extend_persistent(&env, &key);
        }
        bal
    }

    pub fn get_token(env: Env) -> Result<Address, Error> {
        Self::extend_instance(&env);
        env.storage().instance().get(&TOKEN).ok_or(Error::NotInitialized)
    }

    fn emit(env: &Env, action: Symbol, data: impl IntoVal<Env, Val>) {
        env.events().publish((symbol_short!("market"), action), data);
    }

    /// Publish an event under the `("liquidity", action)` topic.
    fn emit_liquidity(env: &Env, action: Symbol, data: impl IntoVal<Env, Val>) {
        env.events().publish((symbol_short!("liquidity"), action), data);
    }

    /// Publish an event under the `("admin", action)` topic.
    fn emit_admin(env: &Env, action: Symbol, data: impl IntoVal<Env, Val>) {
        env.events().publish((symbol_short!("admin"), action), data);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&ADMIN).ok_or(Error::NotInitialized)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn require_admin_or_creator(env: &Env, caller: &Address, creator: &Address) -> Result<(), Error> {
        if Self::require_admin(env, caller).is_ok() || caller == creator {
            return Ok(());
        }
        Err(Error::Unauthorized)
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        Self::extend_instance(env);
        let paused: bool = env.storage().instance().get(&PAUSED).unwrap_or(false);
        if paused {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn require_status(market: &Market, expected: &MarketStatus) -> Result<(), Error> {
        if market.status != *expected {
            return Err(match expected {
                MarketStatus::Open => Error::MarketNotOpen,
                MarketStatus::Closed => Error::MarketNotClosed,
                MarketStatus::Resolved => Error::MarketNotResolved,
                _ => Error::MarketNotOpen,
            });
        }
        Ok(())
    }

    fn require_trading_open(env: &Env, market: &Market) -> Result<(), Error> {
        if env.ledger().timestamp() >= market.close_time {
            return Err(Error::TradingClosed);
        }
        Ok(())
    }

    fn require_positive(amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        Ok(())
    }

    fn token_client(env: &Env) -> Result<token::Client<'_>, Error> {
        let token: Address = env.storage().instance().get(&TOKEN).ok_or(Error::NotInitialized)?;
        Ok(token::Client::new(env, &token))
    }

    /// Move `amount` of the market token from `from` into contract custody.
    /// Panics (reverting the whole invocation) if `from` lacks the balance.
    fn transfer_in(env: &Env, from: &Address, amount: i128) -> Result<(), Error> {
        if amount > 0 {
            Self::token_client(env)?.transfer(from, &env.current_contract_address(), &amount);
        }
        Ok(())
    }

    /// Pay `amount` of the market token out of contract custody to `to`.
    fn transfer_out(env: &Env, to: &Address, amount: i128) -> Result<(), Error> {
        if amount > 0 {
            Self::token_client(env)?.transfer(&env.current_contract_address(), to, &amount);
        }
        Ok(())
    }

    fn extend_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_BUMP_THRESHOLD, INSTANCE_EXTEND_TO);
    }

    fn extend_persistent<K: IntoVal<Env, Val>>(env: &Env, key: &K) {
        env.storage()
            .persistent()
            .extend_ttl(key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_EXTEND_TO);
    }

    fn calc_shares(amount: i128, own_pool: i128, other_pool: i128) -> i128 {
    fn calc_shares(amount: i128, own_pool: i128, other_pool: i128) -> Result<i128, Error> {
        // Simple CPMM: shares = amount * other_pool / (own_pool + amount)
        if amount <= 0 || own_pool < 0 || other_pool < 0 {
            return Err(Error::InvalidAmount);
        }
        if own_pool == 0 && other_pool == 0 {
            return Ok(amount);
        }
        // amount > 0 and own_pool >= 0, so denom is strictly positive.
        let denom = own_pool + amount;
        Ok((amount * (other_pool + own_pool)) / denom)
    }

    fn accrue_lp_fees(market: &mut Market, fee: i128) {
        market.lp_fees += fee;
        market.fee_per_share_accumulated += (fee * FEE_PRECISION) / market.total_lp_shares;
    }

    /// Move fees accrued on `pos.lp_shares` since its last checkpoint into the
    /// provider's pending balance and advance the checkpoint.
    fn settle_lp_fees(env: &Env, market_id: u32, provider: &Address, market: &Market, pos: &mut Position) {
        let delta = market.fee_per_share_accumulated - pos.last_fee_per_share;
        if pos.lp_shares > 0 && delta > 0 {
            let owed = (pos.lp_shares * delta) / FEE_PRECISION;
            if owed > 0 {
                let key = Self::pending_fee_key(market_id, provider);
                let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
                env.storage().persistent().set(&key, &(current + owed));
            }
        }
        pos.last_fee_per_share = market.fee_per_share_accumulated;
    }

    fn pending_lp_fees(env: &Env, market_id: u32, provider: &Address) -> i128 {
        env.storage().persistent().get(&Self::pending_fee_key(market_id, provider)).unwrap_or(0)
    }

    fn pending_fee_key(market_id: u32, provider: &Address) -> (Symbol, u32, Address) {
        (symbol_short!("LPFEE"), market_id, provider.clone())
    }

    fn bond_refund_key(disputer: &Address) -> (Symbol, Address) {
        (symbol_short!("BOND_REF"), disputer.clone())
        let denom = Self::checked_add(own_pool, amount)?;
        if denom == 0 {
            return Ok(0);
        }
        let total_pool = Self::checked_add(other_pool, own_pool)?;
        let numer = amount
            .checked_mul(total_pool)
            .ok_or(Error::ArithmeticOverflow)?;
        Ok(numer / denom)
    }

    fn checked_add(a: i128, b: i128) -> Result<i128, Error> {
        a.checked_add(b).ok_or(Error::ArithmeticOverflow)
    }

    fn market_key(env: &Env, id: u32) -> soroban_sdk::Val {
        let _ = env;
        soroban_sdk::Val::from(id)
    }

    fn load_market(env: &Env, id: u32) -> Result<Market, Error> {
        let key = (symbol_short!("MKT"), id);
        let market = env.storage().persistent().get(&key).ok_or(Error::MarketNotFound)?;
        Self::extend_persistent(env, &key);
        Ok(market)
    }

    fn save_market(env: &Env, id: u32, market: &Market) {
        let key = (symbol_short!("MKT"), id);
        env.storage().persistent().set(&key, market);
        Self::extend_persistent(env, &key);
    }

    fn load_position(env: &Env, market_id: u32, user: &Address) -> Position {
        let key = (symbol_short!("POS"), market_id, user.clone());
        env.storage().persistent().get(&key).unwrap_or(Position {
            yes_shares: 0,
            no_shares: 0,
            lp_shares: 0,
            split_tokens: 0,
            last_fee_per_share: 0,
        })
        match env.storage().persistent().get(&key) {
            Some(pos) => {
                Self::extend_persistent(env, &key);
                pos
            }
            None => Position {
                yes_shares: 0,
                no_shares: 0,
                lp_shares: 0,
                split_tokens: 0,
            },
        }
    }

    fn save_position(env: &Env, market_id: u32, user: &Address, pos: &Position) {
        let key = (symbol_short!("POS"), market_id, user.clone());
        env.storage().persistent().set(&key, pos);
        Self::extend_persistent(env, &key);
    }

    fn treasury_key(env: &Env) -> Symbol {
        let _ = env;
        symbol_short!("TRES_BAL")
    }

    fn token_address(env: &Env) -> Result<Address, Error> {
        env.storage().instance().get(&TOKEN).ok_or(Error::NotInitialized)
    }

    fn refund_cancelled(
        env: &Env,
        redeemer: &Address,
        market_id: u32,
        market: &Market,
    ) -> Result<i128, Error> {
        let mut pos = Self::load_position(env, market_id, redeemer);
        // 1:1 refund; a split YES+NO pair was backed by a single unit of
        // collateral, so count it once.
        let refund = pos.yes_shares + pos.no_shares - pos.split_tokens;
        if refund <= 0 {
            return Err(Error::NothingToRedeem);
        }
        // `split` escrows real collateral 1:1 into the contract; return it
        // here so a market cancellation can't strand split-originated
        // collateral with no way back out. Shares from `buy_yes`/`buy_no`
        // are not collateral-backed in this contract yet (pre-existing,
        // out of scope for this change) so only `split_tokens` moves real
        // funds.
        let collateral = pos.split_tokens.min(refund);
        pos.yes_shares = 0;
        pos.no_shares = 0;
        pos.split_tokens = 0;
        Self::save_position(env, market_id, redeemer, &pos);
        Self::transfer_out(env, redeemer, refund)?;
        pos.split_tokens -= collateral;
        Self::save_position(env, market_id, redeemer, &pos);
        if collateral > 0 {
            let token_client = token::Client::new(env, &Self::token_address(env)?);
            token_client.transfer(&env.current_contract_address(), redeemer, &collateral);
        }
        Self::emit(env, symbol_short!("refunded"), (market_id, redeemer.clone(), refund));
        let _ = market;
        Ok(refund)
    }
}

#[cfg(test)]
mod test;
