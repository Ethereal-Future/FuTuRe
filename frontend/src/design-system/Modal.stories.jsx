import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

export default {
  title: 'Design System/Modal',
  component: Modal,
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
};

function ModalDemo({ size }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Modal</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Confirm Transfer" size={size}>
        <p>Send 50 XLM to GXXX…?</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => setOpen(false)}>Confirm</Button>
        </div>
      </Modal>
    </>
  );
}

export const Default = { render: () => <ModalDemo size="md" /> };
export const Small   = { render: () => <ModalDemo size="sm" /> };
export const Large   = { render: () => <ModalDemo size="lg" /> };
