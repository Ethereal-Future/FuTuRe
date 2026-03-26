import { body, param, validationResult } from 'express-validator';

// Stellar public key: starts with G, 56 chars, base32
const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;
// Stellar secret key: starts with S, 56 chars, base32
const STELLAR_SECRET_KEY = /^S[A-Z2-7]{55}$/;
// Asset code: 1-12 alphanumeric chars
const ASSET_CODE = /^[A-Z0-9]{1,12}$/;

/** Runs validationResult and returns 422 with errors if any. */
export function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array().map(e => ({ field: e.path, message: e.msg })) });
  }
  next();
}

export const rules = {
  publicKeyParam: param('publicKey')
    .trim()
    .matches(STELLAR_PUBLIC_KEY)
    .withMessage('Invalid Stellar public key'),

  sendPayment: [
    body('sourceSecret')
      .trim()
      .matches(STELLAR_SECRET_KEY)
      .withMessage('Invalid Stellar secret key'),
    body('destination')
      .trim()
      .matches(STELLAR_PUBLIC_KEY)
      .withMessage('Invalid destination public key'),
    body('amount')
      .trim()
      .isFloat({ gt: 0 })
      .withMessage('Amount must be a positive number')
      .isLength({ max: 20 })
      .withMessage('Amount too long'),
    body('assetCode')
      .optional()
      .trim()
      .matches(ASSET_CODE)
      .withMessage('Invalid asset code'),
  ],

  assetCodeParams: [
    param('from').trim().matches(ASSET_CODE).withMessage('Invalid source asset code'),
    param('to').trim().matches(ASSET_CODE).withMessage('Invalid target asset code'),
  ],
};
