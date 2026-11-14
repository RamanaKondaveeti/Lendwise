const INVITATION_EXPIRY_DAYS = 7;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildInvitationEmail({ inviterName, workspaceName, invitationUrl }) {
  const safeInviter = escapeHtml(inviterName);
  const safeWorkspace = escapeHtml(workspaceName);
  const safeUrl = escapeHtml(invitationUrl);

  return {
    subject: "You're invited to join GroupBuk!",
    text: [
      "You're invited to join GroupBuk!",
      '',
      `${inviterName} invited you to join the ${workspaceName} workspace on GroupBuk.`,
      '',
      'Use the link below to accept your invitation:',
      invitationUrl,
      '',
      `This invitation link expires ${INVITATION_EXPIRY_DAYS} days after it was sent.`,
      '',
      'If you were not expecting this invitation, you can ignore this email.',
      '',
      'Regards,',
      'GroupBuk Team',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>You're invited to join GroupBuk!</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f7f4;font-family:Arial,Helvetica,sans-serif;color:#263b2d;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${safeInviter} invited you to join ${safeWorkspace} on GroupBuk.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#f3f7f4;">
    <tr>
      <td align="center" style="padding:32px 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2ebe4;border-radius:12px;">
          <tr>
            <td align="left" style="padding:24px 32px;background-color:#176b45;border-radius:12px 12px 0 0;">
              <div style="font-size:20px;line-height:26px;font-weight:700;letter-spacing:.2px;color:#ffffff;">GroupBuk</div>
              <div style="padding-top:4px;font-size:11px;line-height:16px;letter-spacing:1.2px;text-transform:uppercase;color:#d7f0df;">Shared expenses, made simple</div>
            </td>
          </tr>
          <tr>
            <td align="left" style="padding:34px 32px 20px;">
              <h1 style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:34px;font-weight:700;color:#203c2c;">You're invited to join GroupBuk!</h1>
              <p style="margin:0 0 14px;font-size:15px;line-height:24px;color:#43564a;"><strong style="color:#263b2d;">${safeInviter}</strong> invited you to join the <strong style="color:#263b2d;">${safeWorkspace}</strong> workspace on GroupBuk.</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#43564a;">Accept the invitation to join the workspace and start sharing expenses with your group.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 22px;border-collapse:separate;">
                <tr>
                  <td align="center" bgcolor="#218653" style="border-radius:7px;background-color:#218653;">
                    <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:15px 27px;border:1px solid #218653;border-radius:7px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;">Accept Invitation</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:12px;line-height:19px;color:#68796d;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="margin:0 0 20px;font-size:12px;line-height:19px;overflow-wrap:anywhere;word-break:break-word;"><a href="${safeUrl}" target="_blank" style="color:#176b45;text-decoration:underline;">${safeUrl}</a></p>
              <p style="margin:0 0 14px;font-size:12px;line-height:19px;color:#68796d;">This invitation link expires ${INVITATION_EXPIRY_DAYS} days after it was sent.</p>
              <p style="margin:0;font-size:12px;line-height:19px;color:#68796d;">If you were not expecting this invitation, you can ignore this email. You will not join the workspace unless you accept it.</p>
            </td>
          </tr>
          <tr>
            <td align="left" style="padding:18px 32px 22px;border-top:1px solid #e8eee9;background-color:#fbfdfb;border-radius:0 0 12px 12px;">
              <p style="margin:0 0 4px;font-size:13px;line-height:19px;font-weight:700;color:#315640;">GroupBuk</p>
              <p style="margin:0;font-size:11px;line-height:17px;color:#7b897f;">Thoughtful tools for sharing group expenses.</p>
            </td>
          </tr>
        </table>
        <p style="margin:14px 0 0;font-size:10px;line-height:16px;color:#8a968d;">This message was sent because someone invited you to a GroupBuk workspace.</p>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

module.exports = { INVITATION_EXPIRY_DAYS, buildInvitationEmail, escapeHtml };
