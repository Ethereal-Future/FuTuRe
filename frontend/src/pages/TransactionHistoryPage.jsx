import { motion } from 'framer-motion';
import { useAppState } from '../store/index.js';
import { makeVariants } from '../utils/animations';
import { useReducedMotion } from 'framer-motion';
import { TransactionHistory } from '../components/TransactionHistory';

export function TransactionHistoryPage() {
  const { account } = useAppState();
  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);

  if (!account) {
    return (
      <motion.section className="section" variants={v.fadeSlide}>
        <p>No account loaded. Create or import an account to view transaction history.</p>
      </motion.section>
    );
  }

  return (
    <motion.section className="section" variants={v.fadeSlide}>
      <h2>Transaction History</h2>
      <TransactionHistory publicKey={account.publicKey} />
    </motion.section>
  );
}
