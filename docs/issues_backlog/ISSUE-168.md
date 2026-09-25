# loadTesting/regressionTester.js: Rigid percentage threshold triggers false-positive CI regression failures on noisy runners

**Domain:** Load Testing & CI/CD  
**Complexity:** Medium  
**Labels:** `enhancement`, `testing`, `ci-cd`  
**Issue ID:** ISSUE-168

---

## Background
In `backend/src/loadTesting/regressionTester.js`:
The regression tester compares current run metrics against baseline values. If `(current - baseline) / baseline > 0.05` (5% regression), it marks the test run as failed.

## Problem
- GitHub Actions runners and shared virtual machines experience significant CPU and I/O noise (noisy neighbors, CPU throttling).
- A 5% threshold on fast endpoints (e.g. 2ms jumping to 2.2ms) triggers frequent CI build failures, causing developer frustration and PR pipeline gridlock.
- The tester ignores statistical significance (standard deviation, p-value, sample size).

## Proposed Solution
1. Implement statistical hypothesis testing (Welch's t-test or Mann-Whitney U test) to evaluate regressions.
2. Require both relative percentage increase (>15%) AND absolute latency difference (>10ms) before flagging regressions.
3. Allow configurable sensitivity per endpoint class.

## Implementation Steps
1. Update `backend/src/loadTesting/regressionTester.js` to calculate standard deviation and confidence intervals.
2. Implement dual thresholding (absolute latency floor + relative percentage).
3. Add unit tests validating noisy runner tolerance.

## Acceptance Criteria
- [ ] Sub-millisecond variances on shared runners do not trigger false positive failures.
- [ ] Genuine regressions (>15% and statistically significant) are consistently caught.
- [ ] Detailed statistical report is output in CI logs.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Greatly stabilizes automated performance regression testing in CI.

**GitHub Issue:** [1415](https://github.com/Ethereal-Future/FuTuRe/issues/1415)
