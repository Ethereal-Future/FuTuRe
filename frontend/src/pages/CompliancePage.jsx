import { motion } from 'framer-motion';
import { useAppState } from '../store/index.js';
import { makeVariants } from '../utils/animations';
import { useReducedMotion } from 'framer-motion';
import { ComplianceDashboard } from '../components/ComplianceDashboard';

export function CompliancePage() {
  const { account } = useAppState();
  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);

  if (!account) {
    return (
      <motion.section className="section" variants={v.fadeSlide}>
        <p>No account loaded. Create or import an account to access compliance features.</p>
      </motion.section>
    );
  }

  return (
    <motion.section className="section" variants={v.fadeSlide}>
      <h2>Compliance</h2>
      <ComplianceDashboard />
    </motion.section>
  );
}
