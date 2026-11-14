const fs = require('node:fs');
const path = require('node:path');
const { buildInvitationEmail } = require('../src/invitation-email');

const preview = buildInvitationEmail({
  inviterName: 'Alex Morgan',
  workspaceName: 'Weekend Trip',
  invitationUrl: 'https://groupbuk.example/#invite=PREVIEW_ONLY_NOT_A_REAL_TOKEN',
});
const outputBase = path.join(__dirname, '..', 'email-previews', 'sample-invitation');
fs.mkdirSync(path.dirname(outputBase), { recursive: true });
fs.writeFileSync(`${outputBase}.html`, preview.html);
fs.writeFileSync(`${outputBase}.txt`, preview.text);
process.stdout.write(`Generated ${outputBase}.html and ${outputBase}.txt\n`);
