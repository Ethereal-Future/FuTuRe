import { motion } from 'framer-motion';
import { useAppState } from '../store/index.js';
import { makeVariants } from '../utils/animations';
import { useReducedMotion } from 'framer-motion';
import { ComplianceDashboard } from '../components/ComplianceDashboard';
import { Breadcrumb } from '../components/Breadcrumb';

const BREADCRUMB_TRAIL = [
  { label: 'Home', path: '/' },
  { label: 'Compliance', path: null },
];

export function CompliancePage() {
  const { account } = useAppState();
  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);

  if (!account) {
    return (
      <motion.section className="section" variants={v.fadeSlide}>
        <Breadcrumb items={BREADCRUMB_TRAIL} />
        <p>No account loaded. Create or import an account to access compliance features.</p>
      </motion.section>
    );
  }

  return (
    <motion.section className="section" variants={v.fadeSlide}>
      <h2>Compliance</h2>
      <Breadcrumb items={BREADCRUMB_TRAIL} />
      <ComplianceDashboard />
    </motion.section>
  );
}
