/**
 * Notification templates for all supported notification types.
 * Templates use {{variable}} syntax for interpolation.
 */

export const TEMPLATES = {
  // Transaction notifications
  transaction_received: {
    email: {
      subject: 'You received {{amount}} {{asset}}',
      body: 'Hi {{recipientName}},\n\nYou received {{amount}} {{asset}} from {{senderPublicKey}}.\n\nTransaction ID: {{txHash}}\n\nView your wallet for details.',
    },
    push: {
      title: 'Payment Received',
      body: 'You received {{amount}} {{asset}}',
    },
    sms: {
      body: 'FutureRemit: You received {{amount}} {{asset}} from {{senderPublicKey}}. Tx: {{txHash}}',
    },
    inApp: {
      title: 'Payment Received',
      body: 'You received {{amount}} {{asset}} from {{senderPublicKey}}',
    },
  },

  transaction_sent: {
    email: {
      subject: 'You sent {{amount}} {{asset}}',
      body: 'Hi {{senderName}},\n\nYou sent {{amount}} {{asset}} to {{recipientPublicKey}}.\n\nTransaction ID: {{txHash}}\n\nView your wallet for details.',
    },
    push: {
      title: 'Payment Sent',
      body: 'You sent {{amount}} {{asset}} to {{recipientPublicKey}}',
    },
    sms: {
      body: 'FutureRemit: You sent {{amount}} {{asset}} to {{recipientPublicKey}}. Tx: {{txHash}}',
    },
    inApp: {
      title: 'Payment Sent',
      body: 'You sent {{amount}} {{asset}} to {{recipientPublicKey}}',
    },
  },

  transaction_failed: {
    email: {
      subject: 'Transaction failed',
      body: 'Hi {{userName}},\n\nYour transaction of {{amount}} {{asset}} failed.\n\nReason: {{reason}}\n\nPlease try again or contact support.',
    },
    push: {
      title: 'Transaction Failed',
      body: 'Your {{amount}} {{asset}} transaction failed: {{reason}}',
    },
    sms: {
      body: 'FutureRemit: Transaction of {{amount}} {{asset}} failed. Reason: {{reason}}',
    },
    inApp: {
      title: 'Transaction Failed',
      body: 'Your transaction of {{amount}} {{asset}} failed: {{reason}}',
    },
  },

  // Security notifications
  login_new_device: {
    email: {
      subject: 'New login detected',
      body: 'Hi {{userName}},\n\nA new login was detected on your account from {{deviceInfo}} at {{loginTime}}.\n\nIf this was not you, please secure your account immediately.',
    },
    push: {
      title: 'New Login Detected',
      body: 'Login from {{deviceInfo}} at {{loginTime}}',
    },
    sms: {
      body: 'FutureRemit: New login from {{deviceInfo}} at {{loginTime}}. Not you? Secure your account now.',
    },
    inApp: {
      title: 'New Login Detected',
      body: 'Login from {{deviceInfo}} at {{loginTime}}',
    },
  },

  // Account notifications
  account_created: {
    email: {
      subject: 'Welcome to FutureRemit',
      body: 'Hi {{userName}},\n\nYour account has been created successfully.\n\nYour public key: {{publicKey}}\n\nStart sending and receiving payments today.',
    },
    push: {
      title: 'Welcome to FutureRemit',
      body: 'Your account is ready. Start sending payments!',
    },
    sms: {
      body: 'FutureRemit: Welcome! Your account is ready. Public key: {{publicKey}}',
    },
    inApp: {
      title: 'Account Created',
      body: 'Welcome to FutureRemit! Your account is ready.',
    },
  },
};

/**
 * Render a template string by replacing {{key}} placeholders with data values.
 * @param {string} template
 * @param {Record<string, string>} data
 * @returns {string}
 */
export function renderTemplate(template, data = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? '');
}

/**
 * Get a rendered template for a given type and channel.
 * @param {string} type - Template key (e.g. 'transaction_received')
 * @param {string} channel - 'email' | 'push' | 'sms' | 'inApp'
 * @param {Record<string, string>} data
 * @returns {{ subject?: string, title?: string, body: string } | null}
 */
export function getRenderedTemplate(type, channel, data = {}) {
  const tmpl = TEMPLATES[type]?.[channel];
  if (!tmpl) return null;

  const rendered = {};
  for (const [k, v] of Object.entries(tmpl)) {
    rendered[k] = renderTemplate(v, data);
  }
  return rendered;
}
