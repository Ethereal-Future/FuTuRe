#![allow(dead_code)]
//! Recurring payment stream escrow contract.
//!
//! Users deposit an allowance into escrow. The backend (or any caller) invokes
//! `tick_stream` to release one interval payment — no user private keys are
//! held by the platform.

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol,
};

const STREAM: Symbol = symbol_short!("STREAM");
const ADMIN: Symbol = symbol_short!("ADMIN");

#[contracttype]
#[derive(Clone, Debug)]
pub struct Stream {
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    /// Amount released per tick (token base units).
    pub rate_amount: i128,
    /// Minimum seconds between ticks.
    pub interval_seconds: u64,
    pub last_paid_at: u64,
    pub remaining: i128,
    pub active: bool,
}

#[contract]
pub struct StreamPaymentContract;

#[contractimpl]
impl StreamPaymentContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&ADMIN) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN, &admin);
    }

    /// Create a stream and deposit `allowance` of `token` from `sender` into escrow.
    pub fn create_stream(
        env: Env,
        stream_id: u64,
        sender: Address,
        recipient: Address,
        token: Address,
        rate_amount: i128,
        interval_seconds: u64,
        allowance: i128,
    ) -> u64 {
        sender.require_auth();
        if rate_amount <= 0 || allowance < rate_amount || interval_seconds == 0 {
            panic!("invalid stream params");
        }
        let key = (STREAM, stream_id);
        if env.storage().persistent().has(&key) {
            panic!("stream exists");
        }

        let client = token::Client::new(&env, &token);
        client.transfer(&sender, &env.current_contract_address(), &allowance);

        let stream = Stream {
            sender,
            recipient,
            token,
            rate_amount,
            interval_seconds,
            last_paid_at: 0,
            remaining: allowance,
            active: true,
        };
        env.storage().persistent().set(&key, &stream);
        stream_id
    }

    /// Permissionless tick: release one interval payment if due. No user secret required.
    pub fn tick_stream(env: Env, stream_id: u64) -> i128 {
        let key = (STREAM, stream_id);
        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&key)
            .expect("stream not found");
        if !stream.active {
            panic!("stream inactive");
        }
        if stream.remaining < stream.rate_amount {
            stream.active = false;
            env.storage().persistent().set(&key, &stream);
            panic!("insufficient escrow");
        }

        let now = env.ledger().timestamp();
        if stream.last_paid_at != 0 && now < stream.last_paid_at + stream.interval_seconds {
            panic!("interval not elapsed");
        }

        let client = token::Client::new(&env, &stream.token);
        client.transfer(
            &env.current_contract_address(),
            &stream.recipient,
            &stream.rate_amount,
        );

        stream.remaining -= stream.rate_amount;
        stream.last_paid_at = now;
        if stream.remaining < stream.rate_amount {
            stream.active = false;
        }
        env.storage().persistent().set(&key, &stream);
        stream.rate_amount
    }

    pub fn cancel_stream(env: Env, stream_id: u64) {
        let key = (STREAM, stream_id);
        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&key)
            .expect("stream not found");
        stream.sender.require_auth();
        if stream.remaining > 0 {
            let client = token::Client::new(&env, &stream.token);
            client.transfer(
                &env.current_contract_address(),
                &stream.sender,
                &stream.remaining,
            );
            stream.remaining = 0;
        }
        stream.active = false;
        env.storage().persistent().set(&key, &stream);
    }

    pub fn get_stream(env: Env, stream_id: u64) -> Stream {
        env.storage()
            .persistent()
            .get(&(STREAM, stream_id))
            .expect("stream not found")
    }
}
