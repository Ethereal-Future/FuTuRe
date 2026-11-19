# Catalog of 110 New Codebase Issues & Improvements

This catalog records the 110 concrete defects, security vulnerabilities, architectural errors, and compliance deficiencies identified and filed on GitHub (Issues #1510 through #1619, tracking IDs `ISSUE-196` to `ISSUE-305`).

## Summary by Domain

| Domain | Issue Count |
| :--- | :--- |
| Frontend & Operations | 11 |
| Frontend & Security | 10 |
| Backend & Stellar Integration | 8 |
| Backend & Routing | 8 |
| Frontend & UX | 8 |
| Frontend & Accessibility | 7 |
| Backend & Security | 6 |
| Backend & Event Sourcing | 6 |
| Frontend & Stellar Integration | 6 |
| Backend & Database | 4 |
| Backend & Notifications | 3 |
| Frontend & Architecture | 3 |
| Backend & Auth | 2 |
| Backend & Compliance | 2 |
| Backend & Architecture | 2 |
| Backend & Analytics | 2 |
| Backend & Performance | 2 |
| Backend & Monitoring | 2 |
| Frontend & Routing | 2 |
| Backend & ESM Architecture | 1 |
| Backend & Configuration | 1 |
| Backend & Webhooks | 1 |
| Backend & Streaming | 1 |
| Backend & MultiSig | 1 |
| Backend & Liquidity Pools | 1 |
| Backend & Concurrency | 1 |
| Backend & Resilience | 1 |
| Backend & Cryptography | 1 |
| Backend & Soroban | 1 |
| Frontend & Performance | 1 |
| Frontend & Mobile | 1 |
| Frontend & Integration | 1 |
| Frontend & i18n | 1 |
| Frontend & Compliance | 1 |
| Infrastructure & Security | 1 |

## Summary by Complexity

| Complexity | Issue Count |
| :--- | :--- |
| `High` | 25 |
| `Low` | 47 |
| `Medium` | 38 |

## Complete Issues Catalog

| Tracking ID | GitHub Issue | Domain | Complexity | Title |
| :--- | :--- | :--- | :--- | :--- |
| `ISSUE-196` | [#1510](https://github.com/Ethereal-Future/FuTuRe/issues/1510) | Backend & ESM Architecture | `Low` | backend/src/services/amm.js: Duplicate export of resetAMMState causes fatal SyntaxError |
| `ISSUE-197` | [#1511](https://github.com/Ethereal-Future/FuTuRe/issues/1511) | Backend & Stellar Integration | `Low` | backend/src/services/stellar.js: Duplicate declaration of variable result in sendPayment |
| `ISSUE-198` | [#1512](https://github.com/Ethereal-Future/FuTuRe/issues/1512) | Backend & Configuration | `Low` | backend/src/config/env.js: SyntaxError due to unclosed email configuration block and duplicate database key |
| `ISSUE-199` | [#1513](https://github.com/Ethereal-Future/FuTuRe/issues/1513) | Backend & Database | `Low` | backend/src/db/client.js: Missing closing brace in disconnectDB nests subsequent module code |
| `ISSUE-200` | [#1514](https://github.com/Ethereal-Future/FuTuRe/issues/1514) | Backend & Routing | `Low` | backend/src/routes/transactions.js: Duplicate import of requireAuth middleware |
| `ISSUE-201` | [#1515](https://github.com/Ethereal-Future/FuTuRe/issues/1515) | Backend & Routing | `Low` | backend/src/routes/events.js: Duplicate imports and router instantiations cause redeclaration errors |
| `ISSUE-202` | [#1516](https://github.com/Ethereal-Future/FuTuRe/issues/1516) | Backend & Routing | `Low` | backend/src/routes/stellar/amm.js: Malformed double handler header (req, res) => { async (req, res) => { |
| `ISSUE-203` | [#1517](https://github.com/Ethereal-Future/FuTuRe/issues/1517) | Backend & Webhooks | `Low` | backend/src/webhooks/dispatcher.js: Duplicate const signature declaration in deliverOnce |
| `ISSUE-204` | [#1518](https://github.com/Ethereal-Future/FuTuRe/issues/1518) | Backend & Streaming | `Low` | backend/src/services/streaming.js: Tool truncation comment and unmatched brace inserted into source |
| `ISSUE-205` | [#1519](https://github.com/Ethereal-Future/FuTuRe/issues/1519) | Backend & Notifications | `Low` | backend/src/notifications/channels/email.js: CommonJS module.exports syntax used in ES module |
| `ISSUE-206` | [#1520](https://github.com/Ethereal-Future/FuTuRe/issues/1520) | Backend & Notifications | `Low` | backend/src/notifications/service.js: Duplicate function declaration header sendNotification |
| `ISSUE-207` | [#1521](https://github.com/Ethereal-Future/FuTuRe/issues/1521) | Backend & Notifications | `Low` | backend/src/notifications/templates.js: Malformed function closing before JSDoc comment in templates |
| `ISSUE-208` | [#1522](https://github.com/Ethereal-Future/FuTuRe/issues/1522) | Backend & Security | `Low` | backend/src/db/encryption.js: Missing closing brace in encryptSearchable causes syntax error |
| `ISSUE-209` | [#1523](https://github.com/Ethereal-Future/FuTuRe/issues/1523) | Backend & Database | `Low` | backend/src/db/softDelete.js: Missing opening comment delimiter /** corrupts AST parsing |
| `ISSUE-210` | [#1524](https://github.com/Ethereal-Future/FuTuRe/issues/1524) | Backend & Auth | `Low` | backend/src/auth/sessionStore.js: Missing closing brace in session cleanup before import statement |
| `ISSUE-211` | [#1525](https://github.com/Ethereal-Future/FuTuRe/issues/1525) | Backend & Auth | `Low` | backend/src/auth/tokens.js: Unclosed function block in verifyRefreshToken causes syntax error |
| `ISSUE-212` | [#1526](https://github.com/Ethereal-Future/FuTuRe/issues/1526) | Backend & Routing | `Low` | backend/src/routes/admin.js: Top-level export ADMIN_STATS_TTL_SECONDS placed inside route handler |
| `ISSUE-213` | [#1527](https://github.com/Ethereal-Future/FuTuRe/issues/1527) | Backend & Routing | `Low` | backend/src/routes/auth.js: Dangling object closing fragment causes SyntaxError |
| `ISSUE-214` | [#1528](https://github.com/Ethereal-Future/FuTuRe/issues/1528) | Backend & MultiSig | `Low` | backend/src/services/multiSig.js: Duplicate function signature for buildMultiSigTransaction |
| `ISSUE-215` | [#1529](https://github.com/Ethereal-Future/FuTuRe/issues/1529) | Backend & Liquidity Pools | `Medium` | backend/src/services/pool.js: Unbalanced parenthesis and undefined networkPassphrase in pool deposit |
| `ISSUE-216` | [#1530](https://github.com/Ethereal-Future/FuTuRe/issues/1530) | Backend & Compliance | `Low` | backend/src/compliance/sanctionsSync.js: Invalid import path ../config/database.js breaks sanctions sync |
| `ISSUE-217` | [#1531](https://github.com/Ethereal-Future/FuTuRe/issues/1531) | Backend & Routing | `Low` | backend/src/routes/clinics.js: Invalid relative path ../../middleware/validate.js prevents route loading |
| `ISSUE-218` | [#1532](https://github.com/Ethereal-Future/FuTuRe/issues/1532) | Backend & Database | `Medium` | backend/prisma/schema.prisma: Duplicate model Session definition breaks Prisma Client generation |
| `ISSUE-219` | [#1533](https://github.com/Ethereal-Future/FuTuRe/issues/1533) | Backend & Event Sourcing | `Low` | backend/src/eventSourcing/eventStore.js: Duplicate logger import causes SyntaxError |
| `ISSUE-220` | [#1534](https://github.com/Ethereal-Future/FuTuRe/issues/1534) | Backend & Event Sourcing | `Low` | backend/src/eventSourcing/eventArchiver.js: Duplicate logger import causes redeclaration SyntaxError |
| `ISSUE-221` | [#1535](https://github.com/Ethereal-Future/FuTuRe/issues/1535) | Backend & Event Sourcing | `Low` | backend/src/eventSourcing/projectionManager.js: Duplicate prisma client import causes SyntaxError |
| `ISSUE-222` | [#1536](https://github.com/Ethereal-Future/FuTuRe/issues/1536) | Backend & Event Sourcing | `Low` | backend/src/eventSourcing/index.js: Duplicate export of eventSerializer breaks index module |
| `ISSUE-223` | [#1537](https://github.com/Ethereal-Future/FuTuRe/issues/1537) | Backend & Event Sourcing | `Low` | backend/src/eventSourcing/eventMonitor.js: Unclosed method body causes SyntaxError on publishEvent |
| `ISSUE-224` | [#1538](https://github.com/Ethereal-Future/FuTuRe/issues/1538) | Backend & Event Sourcing | `Low` | backend/src/eventSourcing/eventReplayer.js: Unclosed method body causes SyntaxError on createSnapshot |
| `ISSUE-225` | [#1539](https://github.com/Ethereal-Future/FuTuRe/issues/1539) | Backend & Architecture | `Medium` | backend/src/services/stellar.ts: Orphaned duplicate TypeScript file in ESM backend cannot be executed by Node |
| `ISSUE-226` | [#1540](https://github.com/Ethereal-Future/FuTuRe/issues/1540) | Backend & Architecture | `Low` | backend/src/utils/errorMessages.ts: TypeScript syntax in Node ESM module causes ERR_UNKNOWN_FILE_EXTENSION |
| `ISSUE-227` | [#1541](https://github.com/Ethereal-Future/FuTuRe/issues/1541) | Backend & Compliance | `High` | backend/src/routes/stellar/payments.js: Unregistered users bypass AML review hold check |
| `ISSUE-228` | [#1542](https://github.com/Ethereal-Future/FuTuRe/issues/1542) | Backend & Stellar Integration | `Medium` | backend/src/routes/stellar/payments.js: Race condition in post-payment balance broadcast and missing recipient webhook |
| `ISSUE-229` | [#1543](https://github.com/Ethereal-Future/FuTuRe/issues/1543) | Backend & Stellar Integration | `High` | backend/src/routes/stellar/convert.js: Strict-send conversion omits asset issuer for non-native assets |
| `ISSUE-230` | [#1544](https://github.com/Ethereal-Future/FuTuRe/issues/1544) | Backend & Routing | `Medium` | backend/src/routes/stellar/offers.js: Asset validation rule requires string, rejecting standard { code, issuer } objects |
| `ISSUE-231` | [#1545](https://github.com/Ethereal-Future/FuTuRe/issues/1545) | Backend & Stellar Integration | `Medium` | backend/src/services/offer.js: Asset.native invoked with new constructor keyword throws TypeError |
| `ISSUE-232` | [#1546](https://github.com/Ethereal-Future/FuTuRe/issues/1546) | Backend & Stellar Integration | `Medium` | backend/src/services/pathPayment.js: Decimal validator formats value with toFixed(7) instead of enforcing precision cap |
| `ISSUE-233` | [#1547](https://github.com/Ethereal-Future/FuTuRe/issues/1547) | Backend & Security | `High` | backend/src/services/sep10.js: hasClientAccountOp allows op.source === undefined, creating auth bypass |
| `ISSUE-234` | [#1548](https://github.com/Ethereal-Future/FuTuRe/issues/1548) | Backend & Concurrency | `High` | backend/src/services/sequenceManager.js: In-process sequence cache lacks distributed locking across multi-task ECS |
| `ISSUE-235` | [#1549](https://github.com/Ethereal-Future/FuTuRe/issues/1549) | Backend & Stellar Integration | `Medium` | backend/src/services/keypairRotation.js: assertMergeable checks balance > 0, ignoring zero-balance trustlines blocking account merge |
| `ISSUE-236` | [#1550](https://github.com/Ethereal-Future/FuTuRe/issues/1550) | Backend & Analytics | `Medium` | backend/src/services/digestGenerator.js: Blends amounts of different asset codes into a single scalar sum |
| `ISSUE-237` | [#1551](https://github.com/Ethereal-Future/FuTuRe/issues/1551) | Backend & Performance | `Low` | backend/src/services/feeSurge.js: Rolling fee samples stored in ephemeral memory array without persistence |
| `ISSUE-238` | [#1552](https://github.com/Ethereal-Future/FuTuRe/issues/1552) | Backend & Database | `High` | backend/src/services/paymentNotificationMonitor.js: Queries non-existent prisma.userSettings model instead of Setting |
| `ISSUE-239` | [#1553](https://github.com/Ethereal-Future/FuTuRe/issues/1553) | Backend & Resilience | `Medium` | backend/src/services/paymentNotificationMonitor.js: Unbounded 5s reconnect loop without exponential backoff on stream errors |
| `ISSUE-240` | [#1554](https://github.com/Ethereal-Future/FuTuRe/issues/1554) | Backend & Monitoring | `Low` | backend/src/services/lowBalanceMonitor.js: Percentage drop calculation causes division by zero (NaN) when baseline is 0 |
| `ISSUE-241` | [#1555](https://github.com/Ethereal-Future/FuTuRe/issues/1555) | Backend & Analytics | `Medium` | backend/src/services/assetPortfolio.js: Native XLM omitted from portfolio calculation |
| `ISSUE-242` | [#1556](https://github.com/Ethereal-Future/FuTuRe/issues/1556) | Backend & Monitoring | `Medium` | backend/src/services/paymentAlerting.js: getFailureRate() divides failure count by hardcoded 100 instead of total requests |
| `ISSUE-243` | [#1557](https://github.com/Ethereal-Future/FuTuRe/issues/1557) | Backend & Cryptography | `High` | backend/src/recovery/recoveryPhrase.js: 256-word list provides only 8 bits entropy per word instead of BIP-39 standard |
| `ISSUE-244` | [#1558](https://github.com/Ethereal-Future/FuTuRe/issues/1558) | Backend & Soroban | `Medium` | backend/src/routes/stellar/contract.js: scValFromJson maps all numbers to i64, breaking u32 contract parameters |
| `ISSUE-245` | [#1559](https://github.com/Ethereal-Future/FuTuRe/issues/1559) | Backend & Security | `High` | backend/src/routes/stellar/sep31.js: Missing requireAuth middleware on cross-border transaction submission |
| `ISSUE-246` | [#1560](https://github.com/Ethereal-Future/FuTuRe/issues/1560) | Backend & Routing | `Medium` | backend/src/routes/stellar/index.js: Duplicate route mounting for /trustline and broken /assets endpoint |
| `ISSUE-247` | [#1561](https://github.com/Ethereal-Future/FuTuRe/issues/1561) | Backend & Security | `High` | backend/src/routes/stellar/trustline-balance.js: /modify-limit accepts cleartext sourceSecret without authentication |
| `ISSUE-248` | [#1562](https://github.com/Ethereal-Future/FuTuRe/issues/1562) | Backend & Stellar Integration | `Medium` | backend/src/services/transactionRetry.js: Sequence errors retried without bumping sequence number, causing repeated failures |
| `ISSUE-249` | [#1563](https://github.com/Ethereal-Future/FuTuRe/issues/1563) | Backend & Performance | `Medium` | backend/src/services/transactionRetry.js: Unbounded memory leak in retryAttempts map on failed transactions |
| `ISSUE-250` | [#1564](https://github.com/Ethereal-Future/FuTuRe/issues/1564) | Backend & Stellar Integration | `Medium` | backend/src/services/federation.js: SEP-0002 resolution queries q with local username instead of full federation address |
| `ISSUE-251` | [#1565](https://github.com/Ethereal-Future/FuTuRe/issues/1565) | Backend & Security | `Medium` | backend/src/services/federation.js: claimFederationAddress throws raw 500 on duplicate claim and lacks auth |
| `ISSUE-252` | [#1566](https://github.com/Ethereal-Future/FuTuRe/issues/1566) | Backend & Security | `Medium` | backend/src/routes/contacts.js: Address validator checks regex without CRC16 checksum or muxed address support |
| `ISSUE-253` | [#1567](https://github.com/Ethereal-Future/FuTuRe/issues/1567) | Frontend & Architecture | `Low` | frontend/src/components/NetworkStatusBanner.jsx: Mid-JSX import statement and duplicate function declaration |
| `ISSUE-254` | [#1568](https://github.com/Ethereal-Future/FuTuRe/issues/1568) | Frontend & Operations | `Medium` | frontend/src/components/operations/PaymentOperationForm.jsx: Missing Stellar public key checksum validation on destination and issuer |
| `ISSUE-255` | [#1569](https://github.com/Ethereal-Future/FuTuRe/issues/1569) | Frontend & Operations | `High` | frontend/src/components/operations/ChangeTrustOperationForm.jsx: limit || '0' fallback deletes trustline on clear |
| `ISSUE-256` | [#1570](https://github.com/Ethereal-Future/FuTuRe/issues/1570) | Frontend & Operations | `Medium` | frontend/src/components/operations/ManageDataOperationForm.jsx: UTF-8 byte length not validated for 64-byte Stellar data limits |
| `ISSUE-257` | [#1571](https://github.com/Ethereal-Future/FuTuRe/issues/1571) | Frontend & Operations | `High` | frontend/src/components/operations/ManageOfferOperationForm.jsx: Offer update hardcodes amount: '0', deleting existing offers |
| `ISSUE-258` | [#1572](https://github.com/Ethereal-Future/FuTuRe/issues/1572) | Frontend & Security | `High` | frontend/src/components/CreateClaimableBalance.jsx: Reads sourceSecret from localStorage over HTTP POST |
| `ISSUE-259` | [#1573](https://github.com/Ethereal-Future/FuTuRe/issues/1573) | Frontend & Stellar Integration | `Medium` | frontend/src/components/ClaimableBalances.jsx: Reads non-existent balance.clawback_claimants_v0 field |
| `ISSUE-260` | [#1574](https://github.com/Ethereal-Future/FuTuRe/issues/1574) | Frontend & Security | `Medium` | frontend/src/components/BumpSequenceOperation.jsx: Exposes sourceSecret in HTTP POST without multi-sig warning |
| `ISSUE-261` | [#1575](https://github.com/Ethereal-Future/FuTuRe/issues/1575) | Frontend & Stellar Integration | `High` | frontend/src/components/SponsorshipOperations.jsx: Sponsored trustline creation omits sponsored account signature |
| `ISSUE-262` | [#1576](https://github.com/Ethereal-Future/FuTuRe/issues/1576) | Frontend & Operations | `Medium` | frontend/src/components/ThresholdSettings.jsx: Omits low <= med <= high ordering validation and uses window.confirm |
| `ISSUE-263` | [#1577](https://github.com/Ethereal-Future/FuTuRe/issues/1577) | Frontend & Operations | `Low` | frontend/src/components/ConvertWidget.jsx: Allows identical source and destination asset conversion |
| `ISSUE-264` | [#1578](https://github.com/Ethereal-Future/FuTuRe/issues/1578) | Frontend & Security | `Medium` | frontend/src/components/WebhookManager.jsx: Lacks deletion confirmation and exposes webhook secret in plaintext |
| `ISSUE-265` | [#1579](https://github.com/Ethereal-Future/FuTuRe/issues/1579) | Frontend & Stellar Integration | `Medium` | frontend/src/components/Sep7UriHandler.jsx: Missing SEP-7 tx operation and callback submission execution |
| `ISSUE-266` | [#1580](https://github.com/Ethereal-Future/FuTuRe/issues/1580) | Frontend & Security | `High` | frontend/src/components/BiometricConfirmation.jsx: Generates WebAuthn challenge client-side with no server verification |
| `ISSUE-267` | [#1581](https://github.com/Ethereal-Future/FuTuRe/issues/1581) | Frontend & UX | `Low` | frontend/src/components/TxLookup.jsx: Requires account public key to look up globally unique transaction hash |
| `ISSUE-268` | [#1582](https://github.com/Ethereal-Future/FuTuRe/issues/1582) | Frontend & UX | `Low` | frontend/src/components/AdvancedSearch.jsx: Uses synchronous browser prompt() and lacks error handling on history parse |
| `ISSUE-269` | [#1583](https://github.com/Ethereal-Future/FuTuRe/issues/1583) | Frontend & Performance | `Medium` | frontend/src/hooks/useFileUpload.js: Compresses images to JPEG while retaining original extension and leaks object URLs |
| `ISSUE-270` | [#1584](https://github.com/Ethereal-Future/FuTuRe/issues/1584) | Frontend & UX | `Low` | frontend/src/components/FormWizard.jsx: Unchecked index calculation causes out-of-bounds crash on step navigation |
| `ISSUE-271` | [#1585](https://github.com/Ethereal-Future/FuTuRe/issues/1585) | Frontend & UX | `Low` | frontend/src/components/DatePicker.jsx: UTC toISOString() prevents users east of UTC from selecting local today |
| `ISSUE-272` | [#1586](https://github.com/Ethereal-Future/FuTuRe/issues/1586) | Frontend & Accessibility | `Low` | frontend/src/components/AutoComplete.jsx: Enter key lacks e.preventDefault(), submitting parent forms unexpectedly |
| `ISSUE-273` | [#1587](https://github.com/Ethereal-Future/FuTuRe/issues/1587) | Frontend & Mobile | `Low` | frontend/src/components/PullToRefresh.jsx: window.scrollY check fails in nested scrollable containers |
| `ISSUE-274` | [#1588](https://github.com/Ethereal-Future/FuTuRe/issues/1588) | Frontend & Accessibility | `Low` | frontend/src/components/InstallBanner.jsx: Invalid role="banner" landmark on dismissible alert container |
| `ISSUE-275` | [#1589](https://github.com/Ethereal-Future/FuTuRe/issues/1589) | Frontend & Security | `Medium` | frontend/src/hooks/usePWA.js: Raw fetch bypasses auth headers and atob fails on unpadded base64url challenge |
| `ISSUE-276` | [#1590](https://github.com/Ethereal-Future/FuTuRe/issues/1590) | Frontend & Security | `High` | frontend/src/store/tabSync.js: BroadcastChannel posts unredacted secretKey to all browser tabs |
| `ISSUE-277` | [#1591](https://github.com/Ethereal-Future/FuTuRe/issues/1591) | Frontend & Stellar Integration | `Medium` | frontend/src/utils/accountMergeSimulation.js: Simulation ignores zero-balance trustline subentries that block merge |
| `ISSUE-278` | [#1592](https://github.com/Ethereal-Future/FuTuRe/issues/1592) | Frontend & Stellar Integration | `Medium` | frontend/src/utils/validateStellarAddress.ts: Rejects valid Stellar Muxed Accounts (M...) |
| `ISSUE-279` | [#1593](https://github.com/Ethereal-Future/FuTuRe/issues/1593) | Frontend & Operations | `Medium` | frontend/src/components/operations/SetOptionsOperationForm.jsx: Missing homeDomain 32-character validation and signer controls |
| `ISSUE-280` | [#1594](https://github.com/Ethereal-Future/FuTuRe/issues/1594) | Frontend & Operations | `High` | frontend/src/components/TransactionBuilder.jsx: Submits to /api/stellar/transaction/multi-op/build which returns 404 |
| `ISSUE-281` | [#1595](https://github.com/Ethereal-Future/FuTuRe/issues/1595) | Frontend & Integration | `Low` | frontend/src/utils/xdrExport.js: Stellar Laboratory URL uses invalid query parameter instead of hash fragment |
| `ISSUE-282` | [#1596](https://github.com/Ethereal-Future/FuTuRe/issues/1596) | Frontend & Operations | `Medium` | frontend/src/components/FeeDisplay.jsx: Adds non-native asset amount to XLM transaction fee and labels sum as XLM |
| `ISSUE-283` | [#1597](https://github.com/Ethereal-Future/FuTuRe/issues/1597) | Frontend & Accessibility | `Low` | frontend/src/components/FeeHistoryChart.jsx: Lacks accessible data table alternative and hardcodes en-US locale |
| `ISSUE-284` | [#1598](https://github.com/Ethereal-Future/FuTuRe/issues/1598) | Frontend & UX | `Low` | frontend/src/components/SlideOver.jsx: Slide animation breaks in RTL layouts and triggerRef overwritten during render |
| `ISSUE-285` | [#1599](https://github.com/Ethereal-Future/FuTuRe/issues/1599) | Frontend & Accessibility | `Low` | frontend/src/components/CopyButton.jsx: Toast notification lacks role="status" and aria-live polite announcement |
| `ISSUE-286` | [#1600](https://github.com/Ethereal-Future/FuTuRe/issues/1600) | Frontend & Accessibility | `Low` | frontend/src/components/XLMInfoIcon.jsx: Double keyboard handlers cause tooltip toggle flicker on Space and Enter |
| `ISSUE-287` | [#1601](https://github.com/Ethereal-Future/FuTuRe/issues/1601) | Frontend & Operations | `High` | frontend/src/components/AssetBalanceWithTrustline.jsx: Submits empty sourceSecret string on limit change |
| `ISSUE-288` | [#1602](https://github.com/Ethereal-Future/FuTuRe/issues/1602) | Frontend & Security | `Medium` | frontend/src/components/ImportAccountForm.jsx: Public key validation regex lacks StrKey CRC16 checksum check |
| `ISSUE-289` | [#1603](https://github.com/Ethereal-Future/FuTuRe/issues/1603) | Frontend & i18n | `Low` | frontend/src/components/AccountSettings.jsx: Unsafe atob on JWT payload and unlocalized settings UI strings |
| `ISSUE-290` | [#1604](https://github.com/Ethereal-Future/FuTuRe/issues/1604) | Frontend & Accessibility | `Low` | frontend/src/components/NotificationBell.jsx: Non-interactive <div> has click handler without button role or tabIndex |
| `ISSUE-291` | [#1605](https://github.com/Ethereal-Future/FuTuRe/issues/1605) | Frontend & UX | `Low` | frontend/src/components/LanguageSelector.jsx: Forcibly resets document title to Dashboard on language switch |
| `ISSUE-292` | [#1606](https://github.com/Ethereal-Future/FuTuRe/issues/1606) | Frontend & Architecture | `High` | frontend/src/components/AccountRecovery.jsx: Conditional useFocusTrap call violates React Rules of Hooks |
| `ISSUE-293` | [#1607](https://github.com/Ethereal-Future/FuTuRe/issues/1607) | Frontend & Security | `Medium` | frontend/src/components/AccountMerge.jsx: Progress indicator claims Step X/4 across 5 steps and transmits secretKey |
| `ISSUE-294` | [#1608](https://github.com/Ethereal-Future/FuTuRe/issues/1608) | Frontend & Security | `High` | frontend/src/components/StreamPayment.jsx: Hardcodes XLM asset and stores plaintext secretKey in localStorage |
| `ISSUE-295` | [#1609](https://github.com/Ethereal-Future/FuTuRe/issues/1609) | Frontend & Compliance | `High` | frontend/src/components/KYCForm.jsx: Subtraction-only age calculation allows underage users to bypass verification |
| `ISSUE-296` | [#1610](https://github.com/Ethereal-Future/FuTuRe/issues/1610) | Frontend & Accessibility | `High` | frontend/src/components/QRCodeModal.jsx: Modal container has aria-hidden="true", hiding dialog from screen readers |
| `ISSUE-297` | [#1611](https://github.com/Ethereal-Future/FuTuRe/issues/1611) | Frontend & Security | `Medium` | frontend/src/components/ConfirmSendDialog.jsx: Computes total XLM by summing token amount with XLM fee and leaks secretKey |
| `ISSUE-298` | [#1612](https://github.com/Ethereal-Future/FuTuRe/issues/1612) | Frontend & Operations | `High` | frontend/src/components/DEXOfferManagement.jsx: Hardcodes empty sourceSecret on create, modify, and cancel offer actions |
| `ISSUE-299` | [#1613](https://github.com/Ethereal-Future/FuTuRe/issues/1613) | Frontend & Routing | `High` | frontend/src/components/MultiSigTransactions.jsx: Calls unaliased /api/multisig endpoints resulting in 404 errors |
| `ISSUE-300` | [#1614](https://github.com/Ethereal-Future/FuTuRe/issues/1614) | Frontend & Routing | `High` | frontend/src/components/ManageDataSettings.jsx: Calls non-existent /api/stellar/account/:publicKey/manage-data endpoint |
| `ISSUE-301` | [#1615](https://github.com/Ethereal-Future/FuTuRe/issues/1615) | Frontend & Stellar Integration | `High` | frontend/src/components/SEP24Flow.jsx: Calls non-existent /api/sep24/authenticate and hardcodes mock anchor domain |
| `ISSUE-302` | [#1616](https://github.com/Ethereal-Future/FuTuRe/issues/1616) | Frontend & UX | `Medium` | frontend/src/components/LargeTransactionWarning.jsx: Static 1000 threshold applies to all asset types and fails to reset |
| `ISSUE-303` | [#1617](https://github.com/Ethereal-Future/FuTuRe/issues/1617) | Frontend & Architecture | `Medium` | frontend/src/components/SecurityKeyWarning.jsx: Unchecked secretKey.length causes crash on nullish values |
| `ISSUE-304` | [#1618](https://github.com/Ethereal-Future/FuTuRe/issues/1618) | Frontend & UX | `Medium` | frontend/src/components/NetworkWarning.jsx: Testnet condition early-return prevents offline warning from ever displaying |
| `ISSUE-305` | [#1619](https://github.com/Ethereal-Future/FuTuRe/issues/1619) | Infrastructure & Security | `High` | infra/secrets_rotation.py: Kebab-case rotation steps cause ValueError on AWS Secrets Manager lifecycle events |
