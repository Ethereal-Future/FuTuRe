# routes/streaming.js: Stream pause, resume, and cancel endpoints lack ownership validation, allowing authenticated users to tamper with others' streams

**Domain:** Payment Streaming  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `backend`  
**Issue ID:** ISSUE-125

---

## Background
In `backend/src/routes/streaming.js`:
```javascript
router.put('/:id/pause', requireAuth, async (req, res) => {
  const stream = await pauseStream(parseInt(req.params.id, 10));
  res.json(stream);
});

router.put('/:id/resume', requireAuth, async (req, res) => {
  const stream = await resumeStream(parseInt(req.params.id, 10));
  res.json(stream);
});

router.delete('/:id', requireAuth, async (req, res) => {
  const stream = await cancelStream(parseInt(req.params.id, 10));
  res.json(stream);
});
```

## Problem
- The routes verify that the caller is authenticated via JWT (`requireAuth`), but do NOT verify whether `stream.senderId` or `stream.sender.publicKey` belongs to the calling user (`req.user.id`).
- Any authenticated user on the platform can call `DELETE /api/streaming/:id` or `PUT /api/streaming/:id/pause` with an arbitrary stream ID and cancel or pause other users' active payment streams (IDOR - Insecure Direct Object Reference).
- Competitors or malicious actors can disrupt payroll or recurring subscriptions across the platform.

## Proposed Solution
1. Load the stream and verify ownership before mutating:
```javascript
const stream = await prisma.paymentStream.findUnique({
  where: { id: streamId },
  include: { sender: true }
});
if (!stream) return res.status(404).json({ error: 'Stream not found' });
if (stream.senderId !== req.user.id && !req.user.isAdmin) {
  return res.status(403).json({ error: 'Forbidden: You do not own this payment stream' });
}
```
2. Apply this ownership check across all stream mutation and query endpoints (`GET /:id`, `PUT /:id`, `PUT /:id/pause`, `PUT /:id/resume`, `DELETE /:id`).

## Implementation Steps
1. Create `requireStreamOwner` middleware in `backend/src/middleware/streamAuth.js`.
2. Apply middleware to all single-stream routes in `routes/streaming.js`.
3. Ensure users can only view and manage streams where they are the sender or recipient.
4. Add security tests verifying that User B receives 403 Forbidden when attempting to pause User A's stream.

## Acceptance Criteria
- [ ] Users can only pause, resume, update, or cancel their own payment streams.
- [ ] IDOR vulnerability on streaming endpoints is eliminated.
- [ ] Security tests verify authorization checks.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1372](https://github.com/Ethereal-Future/FuTuRe/issues/1372)
