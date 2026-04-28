#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, vec, Address, Env, Map, Symbol, Vec,
};

// ── Storage keys ────────────────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");
const PAUSED: Symbol = symbol_short!("PAUSED");
const MKT_CNT: Symbol = symbol_short!("MKT_CNT");
const TREASURY: Symbol = symbol_short!("TREASURY");

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
    pub lp_pool: i128,
    pub lp_fees: i128,
    pub status: MarketStatus,
    pub outcome: Option<bool>, // true = YES won
    pub dispute_bond: i128,
    pub disputer: Option<Address>,
    pub oracle: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Position {
    pub yes_shares: i128,
    pub no_shares: i128,
    pub lp_shares: i128,
    pub split_tokens: i128,
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
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct PredictionMarket;

#[contractimpl]
impl PredictionMarket {
    // ── Admin ────────────────────────────────────────────────────────────────

    pub fn init(env: Env, admin: Address, treasury: Address) -> Result<(), Error> {
        if env.storage().instance().has(&ADMIN) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&TREASURY, &treasury);
        env.storage().instance().set(&PAUSED, &false);
        env.storage().instance().set(&MKT_CNT, &0u32);
        Ok(())
    }

    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage().instance().set(&PAUSED, &true);
        Ok(())
    }

    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage().instance().set(&PAUSED, &false);
        Ok(())
    }

    // ── Market lifecycle ─────────────────────────────────────────────────────

    pub fn create_market(
        env: Env,
        creator: Address,
        question: soroban_sdk::String,
        oracle: Address,
    ) -> Result<u32, Error> {
        creator.require_auth();
        Self::require_not_paused(&env)?;
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
            status: MarketStatus::Open,
            outcome: None,
            dispute_bond: 0,
            disputer: None,
            oracle: Some(oracle),
        };
        Self::save_market(&env, id, &market);
        env.storage().instance().set(&MKT_CNT, &(id + 1));
        Ok(id)
    }

    pub fn seed_market(env: Env, caller: Address, market_id: u32, amount: i128) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Open)?;
        market.yes_pool += amount;
        market.no_pool += amount;
        Self::save_market(&env, market_id, &market);
        Ok(())
    }

    pub fn close_market(env: Env, caller: Address, market_id: u32) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Open)?;
        Self::require_admin_or_creator(&env, &caller, &market.creator)?;
        market.status = MarketStatus::Closed;
        Self::save_market(&env, market_id, &market);
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
        market.outcome = Some(outcome);
        // Status stays Closed; finalize moves it to Resolved after dispute window
        Self::save_market(&env, market_id, &market);
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
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Closed)?;
        if market.outcome.is_none() {
            return Err(Error::InvalidOutcome);
        }
        market.status = MarketStatus::Disputed;
        market.disputer = Some(disputer);
        market.dispute_bond = bond;
        Self::save_market(&env, market_id, &market);
        Ok(())
    }

    /// Admin upholds dispute → emergency resolve
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
        market.outcome = Some(new_outcome);
        market.status = MarketStatus::EmergencyResolved;
        Self::save_market(&env, market_id, &market);
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
        let treasury: Address = env.storage().instance().get(&TREASURY).unwrap();
        let key = Self::treasury_key(&env);
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + market.dispute_bond));
        market.dispute_bond = 0;
        market.disputer = None;
        // Revert to Closed so finalize can proceed
        market.status = MarketStatus::Closed;
        Self::save_market(&env, market_id, &market);
        let _ = treasury;
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
        market.status = MarketStatus::Resolved;
        Self::save_market(&env, market_id, &market);
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
        let shares = Self::calc_shares(amount, market.yes_pool, market.no_pool);
        if shares < min_shares_out {
            return Err(Error::SlippageExceeded);
        }
        market.yes_pool += amount;
        market.yes_shares += shares;
        Self::save_market(&env, market_id, &market);
        let mut pos = Self::load_position(&env, market_id, &buyer);
        pos.yes_shares += shares;
        Self::save_position(&env, market_id, &buyer, &pos);
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
        let shares = Self::calc_shares(amount, market.no_pool, market.yes_pool);
        if shares < min_shares_out {
            return Err(Error::SlippageExceeded);
        }
        market.no_pool += amount;
        market.no_shares += shares;
        Self::save_market(&env, market_id, &market);
        let mut pos = Self::load_position(&env, market_id, &buyer);
        pos.no_shares += shares;
        Self::save_position(&env, market_id, &buyer, &pos);
        Ok(shares)
    }

    // ── Redeem ───────────────────────────────────────────────────────────────

    pub fn redeem(env: Env, redeemer: Address, market_id: u32) -> Result<i128, Error> {
        redeemer.require_auth();
        Self::require_not_paused(&env)?;
        let market = Self::load_market(&env, market_id)?;
        if market.status == MarketStatus::Cancelled {
            return Self::refund_cancelled(&env, &redeemer, market_id, &market);
        }
        if market.status != MarketStatus::Resolved && market.status != MarketStatus::EmergencyResolved {
            return Err(Error::MarketNotResolved);
        }
        let mut pos = Self::load_position(&env, market_id, &redeemer);
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
            (winning_shares * total_pool) / total_winning
        } else {
            0
        };
        // Clear position
        if market.outcome == Some(true) {
            pos.yes_shares = 0;
        } else {
            pos.no_shares = 0;
        }
        Self::save_position(&env, market_id, &redeemer, &pos);
        Ok(payout)
    }

    /// Batch redeem across multiple markets
    pub fn batch_redeem(env: Env, redeemer: Address, market_ids: Vec<u32>) -> Result<i128, Error> {
        redeemer.require_auth();
        let mut total: i128 = 0;
        for id in market_ids.iter() {
            // Skip markets that fail (already redeemed, etc.)
            if let Ok(payout) = Self::redeem(env.clone(), redeemer.clone(), id) {
                total += payout;
            }
        }
        Ok(total)
    }

    // ── LP ───────────────────────────────────────────────────────────────────

    pub fn add_liquidity(
        env: Env,
        provider: Address,
        market_id: u32,
        amount: i128,
    ) -> Result<i128, Error> {
        provider.require_auth();
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        Self::require_status(&market, &MarketStatus::Open)?;
        let lp_shares = if market.lp_pool == 0 { amount } else { amount };
        market.lp_pool += amount;
        market.yes_pool += amount / 2;
        market.no_pool += amount / 2;
        Self::save_market(&env, market_id, &market);
        let mut pos = Self::load_position(&env, market_id, &provider);
        pos.lp_shares += lp_shares;
        Self::save_position(&env, market_id, &provider, &pos);
        Ok(lp_shares)
    }

    pub fn remove_liquidity(
        env: Env,
        provider: Address,
        market_id: u32,
        lp_shares: i128,
    ) -> Result<i128, Error> {
        provider.require_auth();
        Self::require_not_paused(&env)?;
        let mut market = Self::load_market(&env, market_id)?;
        let mut pos = Self::load_position(&env, market_id, &provider);
        if pos.lp_shares < lp_shares {
            return Err(Error::InsufficientFunds);
        }
        let payout = if market.lp_pool > 0 {
            (lp_shares * market.lp_pool) / market.lp_pool.max(1)
        } else {
            lp_shares
        };
        market.lp_pool -= lp_shares;
        pos.lp_shares -= lp_shares;
        Self::save_market(&env, market_id, &market);
        Self::save_position(&env, market_id, &provider, &pos);
        Ok(payout)
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
        let total_lp = market.lp_pool.max(1);
        let fee_share = (pos.lp_shares * market.lp_fees) / total_lp;
        market.lp_fees -= fee_share;
        Self::save_market(&env, market_id, &market);
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

    fn calc_shares(amount: i128, own_pool: i128, other_pool: i128) -> i128 {
        // Simple CPMM: shares = amount * other_pool / (own_pool + amount)
        if own_pool == 0 && other_pool == 0 {
            return amount;
        }
        let denom = own_pool + amount;
        if denom == 0 {
            return 0;
        }
        (amount * (other_pool + own_pool)) / denom
    }

    fn market_key(env: &Env, id: u32) -> soroban_sdk::Val {
        let _ = env;
        soroban_sdk::Val::from(id)
    }

    fn load_market(env: &Env, id: u32) -> Result<Market, Error> {
        let key = (symbol_short!("MKT"), id);
        env.storage().persistent().get(&key).ok_or(Error::MarketNotFound)
    }

    fn save_market(env: &Env, id: u32, market: &Market) {
        let key = (symbol_short!("MKT"), id);
        env.storage().persistent().set(&key, market);
    }

    fn load_position(env: &Env, market_id: u32, user: &Address) -> Position {
        let key = (symbol_short!("POS"), market_id, user.clone());
        env.storage().persistent().get(&key).unwrap_or(Position {
            yes_shares: 0,
            no_shares: 0,
            lp_shares: 0,
            split_tokens: 0,
        })
    }

    fn save_position(env: &Env, market_id: u32, user: &Address, pos: &Position) {
        let key = (symbol_short!("POS"), market_id, user.clone());
        env.storage().persistent().set(&key, pos);
    }

    fn treasury_key(env: &Env) -> Symbol {
        let _ = env;
        symbol_short!("TRES_BAL")
    }

    fn refund_cancelled(
        env: &Env,
        redeemer: &Address,
        market_id: u32,
        market: &Market,
    ) -> Result<i128, Error> {
        let mut pos = Self::load_position(env, market_id, redeemer);
        let refund = pos.yes_shares + pos.no_shares; // 1:1 refund
        if refund == 0 {
            return Err(Error::NothingToRedeem);
        }
        pos.yes_shares = 0;
        pos.no_shares = 0;
        Self::save_position(env, market_id, redeemer, &pos);
        let _ = market;
        Ok(refund)
    }
}
