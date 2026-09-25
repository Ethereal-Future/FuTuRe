/**
 * Notification templates for all supported notification types.
 * Templates use {{variable}} syntax for interpolation.
 */
import { escapeHtml } from '../utils/sanitize.js';

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

  // Weekly digest
  weekly_digest: {
    email: {
      subject: 'Your Weekly Transaction Summary ({{weekStartDay}} - {{weekEndDay}})',
      body: 'Hi {{userName}},\n\nHere\'s your weekly transaction summary:\n\nPeriod: {{weekStartDay}} to {{weekEndDay}}\n\nTransactions: {{transactionCount}}\nTotal Sent: {{totalSent}} XLM\nTotal Received: {{totalReceived}} XLM\nCurrent Balance: {{balance}} XLM\n\nTop Transactions:\n{{transactionList}}\n\nView your complete transaction history in your FutureRemit dashboard.\n\nStay secure!',
    },
    inApp: {
      title: 'Weekly Summary',
      body: 'You had {{transactionCount}} transactions this week. Total sent: {{totalSent}} XLM, received: {{totalReceived}} XLM.',
    },
  },

  // Low balance alert
  low_balance_alert: {
    email: {
      subject: 'Balance Alert: {{currentBalance}} {{asset}} is below {{threshold}} {{asset}}',
      body: 'Hi {{userName}},\n\nYour account balance has dropped to {{currentBalance}} {{asset}}, which is below your alert threshold of {{threshold}} {{asset}}.\n\nCurrent Balance: {{currentBalance}} {{asset}}\nThreshold: {{threshold}} {{asset}}\n\nConsider adding funds to your account if needed.\n\nView your account in FutureRemit.',
    },
    push: {
      title: 'Low Balance Alert',
      body: 'Your {{asset}} balance is now {{currentBalance}}',
    },
    inApp: {
      title: 'Low Balance Alert',
      body: 'Your {{asset}} balance ({{currentBalance}}) is below your alert threshold ({{threshold}} {{asset}})',
    },
  },
};

/**
 * Render a template string by replacing {{key}} placeholders with data values.
 * Only own properties of `data` are resolved, so keys such as {{toString}},
 * {{constructor}} or {{__proto__}} never pick up inherited prototype members.
 * @param {string} template
 * @param {Record<string, string>} data
 * @param {{ escape?: (value: string) => string }} [options] - Encoder applied to every interpolated value
 * @returns {string}
 */
export function renderTemplate(template, data = {}, { escape } = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (data == null || !Object.prototype.hasOwnProperty.call(data, key)) return '';
    const value = data[key];
    if (value === undefined || value === null) return '';
    const str = String(value);
    return escape ? escape(str) : str;
  });
}

/**
 * Render a template as an HTML fragment. Static template text and every
 * interpolated value are HTML-entity encoded; newlines become <br>.
 * @param {string} template
 * @param {Record<string, string>} data
 * @returns {string}
 */
export function renderHtmlTemplate(template, data = {}) {
  return renderTemplate(escapeHtml(template), data, { escape: escapeHtml }).replace(/\n/g, '<br>\n');
}

/**
 * Get a rendered template for a given type and channel.
 * Email templates are rendered as both plain text (`body`) and HTML (`html`).
 * The subject is a plain-text header and is never HTML-encoded.
 * @param {string} type - Template key (e.g. 'transaction_received')
 * @param {string} channel - 'email' | 'push' | 'sms' | 'inApp'
 * @param {Record<string, string>} data
 * @returns {{ subject?: string, title?: string, body: string, html?: string } | null}
 */
export function getRenderedTemplate(type, channel, data = {}) {
  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, type)) return null;
  const tmpl = Object.prototype.hasOwnProperty.call(TEMPLATES[type], channel) ? TEMPLATES[type][channel] : null;
  if (!tmpl) return null;

  const rendered = {};
  for (const [k, v] of Object.entries(tmpl)) {
    rendered[k] = renderTemplate(v, data);
  }
  if (channel === 'email' && tmpl.body) {
    rendered.html = renderHtmlTemplate(tmpl.body, data);
  }
  return rendered;
}
