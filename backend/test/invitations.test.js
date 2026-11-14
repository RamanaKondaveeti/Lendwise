const test = require('node:test');
const assert = require('node:assert/strict');
const { cancellationEmail, cancellationRejection, invitationStatus } = require('../src/invitation-lifecycle');

test('invitation history reports pending, accepted, cancelled, and expired states in precedence order', () => {
  assert.equal(invitationStatus({ is_expired: 0 }), 'pending');
  assert.equal(invitationStatus({ is_expired: 1 }), 'expired');
  assert.equal(invitationStatus({ cancelled_at: '2026-11-14 00:00:00', is_expired: 1 }), 'cancelled');
  assert.equal(invitationStatus({ accepted_at: '2026-11-14 00:00:00', cancelled_at: '2026-11-14 00:00:00' }), 'accepted');
});

test('cancellation rejects accepted, cancelled, and expired invitations with distinct errors', () => {
  assert.deepEqual(cancellationRejection({ accepted_at: 'now' }), {
    status: 409, error: 'This invitation has already been accepted.',
  });
  assert.deepEqual(cancellationRejection({ cancelled_at: 'now' }), {
    status: 409, error: 'This invitation has already been cancelled.',
  });
  assert.deepEqual(cancellationRejection({ is_expired: 1 }), {
    status: 409, error: 'This invitation has expired.',
  });
  assert.equal(cancellationRejection({ is_expired: 0 }), null);
});

test('cancellation notification uses the existing email service subject and user facing copy', () => {
  const email = cancellationEmail();
  assert.equal(email.subject, 'GroupBuk invitation cancelled');
  assert.match(email.text, /cancelled by the sender/);
  assert.match(email.text, /can no longer accept this invitation/);
  assert.match(email.text, /GroupBuk Team/);
});
