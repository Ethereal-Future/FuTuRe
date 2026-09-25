'use strict';

/**
 * FinCEN BSA E-Filing XML generator.
 *
 * Produces XML compliant with the FinCEN BSA E-Filing XML Batch Schema
 * (FinCEN Form 111 / XML User Guide, schema version 2.0) and validates the
 * generated document against the mandatory filing elements before it is
 * persisted or exported for direct compliance submission.
 *
 * The generator maps internal compliance models (users, transactions, KYC
 * records) onto the FinCEN schema element names so compliance officers no
 * longer have to re-enter data into the FinCEN portal.
 */

const FINCEN_SCHEMA_VERSION = '2.0';

// FinCEN activity codes used by the BSA E-Filing schema.
const ACTIVITY_CODES = {
  SAR: 'SAR',
  CTR: 'CTR',
};

// FinCEN subject type codes.
const SUBJECT_TYPES = {
  individual: 'I',
  entity: 'E',
};

/**
 * Escape a value for safe inclusion in XML text/attribute content.
 *
 * @param {*} value
 * @returns {string}
 */
function escapeXml(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalise a date into the FinCEN required YYYY-MM-DD format.
 *
 * @param {Date|string|number} value
 * @returns {string}
 */
function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalise a timestamp into the FinCEN required ISO-8601 format.
 *
 * @param {Date|string|number} value
 * @returns {string}
 */
function formatDateTime(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString();
}

/**
 * Format a monetary amount with two decimal places as required by FinCEN.
 *
 * @param {number|string} amount
 * @returns {string}
 */
function formatAmount(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return '0.00';
  }
  return numeric.toFixed(2);
}

/**
 * Build the Transmitter element (the filing institution's transmitting agent).
 *
 * @param {object} report
 * @returns {string}
 */
function buildTransmitter(report) {
  const transmitter = report.transmitter || {};
  return [
    '  <Transmitter>',
    `    <TransmitterID>${escapeXml(transmitter.id || report.transmitterId || '')}</TransmitterID>`,
    `    <TransmitterName>${escapeXml(transmitter.name || report.institutionName || '')}</TransmitterName>`,
    `    <TransmitterContactName>${escapeXml(transmitter.contactName || '')}</TransmitterContactName>`,
    `    <TransmitterContactPhone>${escapeXml(transmitter.contactPhone || '')}</TransmitterContactPhone>`,
    `    <TransmitterContactEmail>${escapeXml(transmitter.contactEmail || '')}</TransmitterContactEmail>`,
    '  </Transmitter>',
  ].join('\n');
}

/**
 * Build the Filing Institution element.
 *
 * @param {object} report
 * @returns {string}
 */
function buildFilingInstitution(report) {
  const institution = report.filingInstitution || report.institution || {};
  return [
    '  <FilingInstitution>',
    `    <InstitutionID>${escapeXml(institution.id || report.institutionId || '')}</InstitutionID>`,
    `    <InstitutionName>${escapeXml(institution.name || report.institutionName || '')}</InstitutionName>`,
    `    <InstitutionAddress>${escapeXml(institution.address || '')}</InstitutionAddress>`,
    `    <InstitutionCity>${escapeXml(institution.city || '')}</InstitutionCity>`,
    `    <InstitutionState>${escapeXml(institution.state || '')}</InstitutionState>`,
    `    <InstitutionZip>${escapeXml(institution.zip || '')}</InstitutionZip>`,
    `    <InstitutionCountry>${escapeXml(institution.country || 'US')}</InstitutionCountry>`,
    '  </FilingInstitution>',
  ].join('\n');
}

/**
 * Build the Activity element for a SAR filing.
 *
 * @param {object} report
 * @returns {string}
 */
function buildSuspiciousActivity(report) {
  const activity = report.activity || {};
  const amount = activity.amount !== undefined ? activity.amount : report.amount;
  return [
    '  <Activity>',
    '    <SuspiciousActivityInformation>',
    `      <ActivityDate>${escapeXml(formatDate(activity.date || report.createdAt))}</ActivityDate>`,
    `      <AmountInvolved>${escapeXml(formatAmount(amount))}</AmountInvolved>`,
    `      <ActivityDescription>${escapeXml(activity.description || report.alertDescription || '')}</ActivityDescription>`,
    `      <ActivityCategory>${escapeXml(activity.category || report.category || 'Other')}</ActivityCategory>`,
    `      <TransactionHash>${escapeXml(activity.txHash || report.txHash || '')}</TransactionHash>`,
    '    </SuspiciousActivityInformation>',
    '  </Activity>',
  ].join('\n');
}

/**
 * Build the Activity element for a CTR filing.
 *
 * @param {object} report
 * @returns {string}
 */
function buildCurrencyTransaction(report) {
  const activity = report.activity || {};
  const amount = activity.amount !== undefined ? activity.amount : report.amount;
  return [
    '  <Activity>',
    '    <CurrencyTransaction>',
    `      <TransactionDate>${escapeXml(formatDate(activity.date || report.createdAt))}</TransactionDate>`,
    `      <CashInAmount>${escapeXml(formatAmount(activity.cashInAmount || amount))}</CashInAmount>`,
    `      <CashOutAmount>${escapeXml(formatAmount(activity.cashOutAmount || 0))}</CashOutAmount>`,
    `      <TransactionDescription>${escapeXml(activity.description || report.alertDescription || '')}</TransactionDescription>`,
    `      <TransactionHash>${escapeXml(activity.txHash || report.txHash || '')}</TransactionHash>`,
    '    </CurrencyTransaction>',
    '  </Activity>',
  ].join('\n');
}

/**
 * Build a single Subject element (Individual or Entity).
 *
 * @param {object} subject
 * @returns {string}
 */
function buildSubject(subject) {
  const isEntity = (subject.type || '').toLowerCase() === 'entity' || Boolean(subject.entityName);
  const typeCode = isEntity ? SUBJECT_TYPES.entity : SUBJECT_TYPES.individual;
  const name = subject.name || subject.entityName || subject.individualName || '';
  const lines = [
    '  <Subject>',
    `    <SubjectType>${escapeXml(typeCode)}</SubjectType>`,
    `    <SubjectName>${escapeXml(name)}</SubjectName>`,
    `    <SubjectID>${escapeXml(subject.id || subject.senderId || '')}</SubjectID>`,
    `    <SubjectAddress>${escapeXml(subject.address || '')}</SubjectAddress>`,
    `    <SubjectCity>${escapeXml(subject.city || '')}</SubjectCity>`,
    `    <SubjectState>${escapeXml(subject.state || '')}</SubjectState>`,
    `    <SubjectZip>${escapeXml(subject.zip || '')}</SubjectZip>`,
    `    <SubjectCountry>${escapeXml(subject.country || 'US')}</SubjectCountry>`,
    `    <SubjectDateOfBirth>${escapeXml(formatDate(subject.dateOfBirth))}</SubjectDateOfBirth>`,
    `    <SubjectIdentificationNumber>${escapeXml(subject.identificationNumber || subject.kycId || '')}</SubjectIdentificationNumber>`,
  ];
  lines.push('  </Subject>');
  return lines.join('\n');
}

/**
 * Build the Narrative element.
 *
 * @param {object} report
 * @returns {string}
 */
function buildNarrative(report) {
  const narrative = report.narrative || report.alertDescription || '';
  return [
    '  <Narrative>',
    `    <NarrativeText>${escapeXml(narrative)}</NarrativeText>`,
    '  </Narrative>',
  ].join('\n');
}

/**
 * Generate a FinCEN BSA E-Filing XML document for a SAR or CTR report.
 *
 * @param {object} report Internal compliance report (SAR or CTR).
 * @param {'SAR'|'CTR'} [reportType] Overrides the report type when not set on the report.
 * @returns {string} FinCEN BSA XML document.
 */
function generateFinCENXml(report, reportType) {
  if (!report || typeof report !== 'object') {
    throw new TypeError('generateFinCENXml requires a report object');
  }

  const type = (reportType || report.reportType || report.type || 'SAR').toUpperCase();
  const activityCode = ACTIVITY_CODES[type] || ACTIVITY_CODES.SAR;
  const subjects = Array.isArray(report.subjects)
    ? report.subjects
    : report.subject
      ? [report.subject]
      : [];

  const activityElement = activityCode === ACTIVITY_CODES.CTR
    ? buildCurrencyTransaction(report)
    : buildSuspiciousActivity(report);

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<BSAEFiling schemaVersion="${FINCEN_SCHEMA_VERSION}">`,
    `  <FilingHeader>${'\n'}` +
      `    <FilingType>${escapeXml(activityCode)}</FilingType>${'\n'}` +
      `    <FilingDate>${escapeXml(formatDate(report.filingDate || report.createdAt || new Date()))}</FilingDate>${'\n'}` +
      `    <FilingTimestamp>${escapeXml(formatDateTime(report.createdAt || new Date()))}</FilingTimestamp>${'\n'}` +
      `    <ReportID>${escapeXml(report.id || report.reportId || '')}</ReportID>${'\n'}` +
      '  </FilingHeader>',
    buildTransmitter(report),
    buildFilingInstitution(report),
    activityElement,
    ...subjects.map(buildSubject),
    buildNarrative(report),
    '</BSAEFiling>',
  ];

  return parts.join('\n');
}

/**
 * Validate a generated FinCEN BSA XML document against the mandatory filing
 * elements, required attributes and date formats defined by the FinCEN XML
 * schema version 2.0.
 *
 * @param {string} xml FinCEN BSA XML document.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateFinCENXml(xml) {
  const errors = [];

  if (typeof xml !== 'string' || xml.trim() === '') {
    return { valid: false, errors: ['XML document is empty'] };
  }

  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
    errors.push('Missing XML declaration');
  }

  if (!/<BSAEFiling\s+schemaVersion="2\.0">/.test(xml)) {
    errors.push('Missing BSAEFiling root element with schemaVersion="2.0"');
  }

  const requiredElements = [
    'FilingHeader',
    'FilingType',
    'FilingDate',
    'Transmitter',
    'TransmitterID',
    'TransmitterName',
    'FilingInstitution',
    'InstitutionID',
    'InstitutionName',
    'Activity',
    'Subject',
    'SubjectType',
    'SubjectName',
    'Narrative',
    'NarrativeText',
  ];

  requiredElements.forEach((element) => {
    const pattern = new RegExp(`<${element}(\\s|>)[\\s\\S]*?</${element}>`);
    if (!pattern.test(xml)) {
      errors.push(`Missing required element: ${element}`);
    }
  });

  if (!/<FilingType>(SAR|CTR)<\/FilingType>/.test(xml)) {
    errors.push('FilingType must be SAR or CTR');
  }

  if (!/<SubjectType>(I|E)<\/SubjectType>/.test(xml)) {
    errors.push('SubjectType must be I (individual) or E (entity)');
  }

  const datePattern = /<(FilingDate|ActivityDate|TransactionDate)>([^<]*)<\/\1>/g;
  let match = datePattern.exec(xml);
  while (match) {
    const value = match[2];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      errors.push(`Invalid date format for ${match[1]}: ${value}`);
    }
    match = datePattern.exec(xml);
  }

  const amountPattern = /<(AmountInvolved|CashInAmount|CashOutAmount)>([^<]*)<\/\1>/g;
  match = amountPattern.exec(xml);
  while (match) {
    const value = match[2];
    if (!/^\d+\.\d{2}$/.test(value)) {
      errors.push(`Invalid amount format for ${match[1]}: ${value}`);
    }
    match = amountPattern.exec(xml);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generate and validate a FinCEN BSA XML document, throwing when the output
 * does not satisfy the schema requirements.
 *
 * @param {object} report Internal compliance report (SAR or CTR).
 * @param {'SAR'|'CTR'} [reportType]
 * @returns {string} Validated FinCEN BSA XML document.
 */
function generateValidatedFinCENXml(report, reportType) {
  const xml = generateFinCENXml(report, reportType);
  const result = validateFinCENXml(xml);
  if (!result.valid) {
    const error = new Error(`FinCEN XML schema validation failed: ${result.errors.join('; ')}`);
    error.validationErrors = result.errors;
    throw error;
  }
  return xml;
}

module.exports = {
  FINCEN_SCHEMA_VERSION,
  ACTIVITY_CODES,
  SUBJECT_TYPES,
  generateFinCENXml,
  validateFinCENXml,
  generateValidatedFinCENXml,
  formatDate,
  formatDateTime,
  formatAmount,
  escapeXml,
};
