const test = require('node:test');
const assert = require('node:assert/strict');
const { INVITATION_EXPIRY_DAYS, buildInvitationEmail } = require('../src/invitation-email');

test('invitation email includes a branded HTML layout and a readable plain text fallback', () => {
  const email = buildInvitationEmail({
    inviterName: 'Alex Morgan',
    workspaceName: 'Weekend Trip',
    invitationUrl: 'https://groupbuk.example/#invite=preview-token',
  });

  assert.equal(email.subject, "You're invited to join GroupBuk!");
  assert.match(email.html, /<!doctype html>/i);
  assert.match(email.html, /role="presentation"/);
  assert.match(email.html, /You're invited to join GroupBuk!/);
  assert.match(email.html, /Alex Morgan/);
  assert.match(email.html, /Weekend Trip/);
  assert.match(email.html, /href="https:\/\/groupbuk\.example\/#invite=preview-token"/);
  assert.match(email.html, /Accept Invitation/);
  assert.match(email.text, /Use the link below to accept your invitation/);
  assert.ok(email.text.includes('https://groupbuk.example/#invite=preview-token'));
  assert.match(email.text, /not expecting this invitation/);
  assert.match(email.text, new RegExp(`expires ${INVITATION_EXPIRY_DAYS} days`));
});

test('invitation template escapes inviter, workspace, and URL values for HTML', () => {
  const email = buildInvitationEmail({
    inviterName: '<img src=x onerror=alert(1)> & Sam',
    workspaceName: 'R&D <Team>',
    invitationUrl: 'https://groupbuk.example/#invite=abc&next=<script>',
  });

  assert.match(email.html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; Sam/);
  assert.match(email.html, /R&amp;D &lt;Team&gt;/);
  assert.match(email.html, /invite=abc&amp;next=&lt;script&gt;/);
  assert.doesNotMatch(email.html, /<img src=x onerror=alert/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.ok(email.text.includes('https://groupbuk.example/#invite=abc&next=<script>'));
});
