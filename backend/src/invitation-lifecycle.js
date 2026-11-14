function invitationStatus({ accepted_at, cancelled_at, is_expired }) {
  if (accepted_at) return 'accepted';
  if (cancelled_at) return 'cancelled';
  return Number(is_expired) ? 'expired' : 'pending';
}

function cancellationRejection(invitation) {
  if (invitation.accepted_at) return { status: 409, error: 'This invitation has already been accepted.' };
  if (invitation.cancelled_at) return { status: 409, error: 'This invitation has already been cancelled.' };
  if (Number(invitation.is_expired)) return { status: 409, error: 'This invitation has expired.' };
  return null;
}

function cancellationEmail() {
  return {
    subject: 'GroupBuk invitation cancelled',
    text: 'Hi,\n\nThe invitation you received to join GroupBuk has been cancelled by the sender.\n\nYou can no longer accept this invitation using the previous invitation link.\n\nIf you have questions, please contact the person who invited you.\n\nRegards,\nGroupBuk Team',
  };
}

module.exports = { cancellationEmail, cancellationRejection, invitationStatus };
