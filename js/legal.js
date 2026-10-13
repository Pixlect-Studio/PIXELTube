/* ============================================================
   PIXELTube — legal.js
   Privacy Policy, Terms & Conditions, Community Guidelines.
   ============================================================ */

/* ============================================================
   PRIVACY POLICY — #/privacy
   ============================================================ */
export function viewPrivacy() {
  return `
    <article class="legal">
      <h1>Privacy Policy</h1>
      <p class="updated">Last updated: 13 October 2026</p>

      <p>
        PIXELTube ("we", "us", "our") is a video-sharing platform operated by
        PIXLECT Studios. This Privacy Policy explains what information we
        collect when you use PIXELTube, why we collect it, and how it is
        handled.
      </p>

      <div class="callout">
        <strong>Short version</strong>
        We collect the minimum amount of data needed to run the platform.
        We don't sell your data. We don't run advertising trackers. We use
        Firebase, Supabase, Backblaze, and Cloudflare to store and serve
        content on our behalf.
      </div>

      <h2>1. Information we collect</h2>

      <h3>Account information</h3>
      <p>
        When you sign in, we receive your <b>username</b>, <b>unique user ID (UID)</b>,
        and <b>profile icon</b> from PIXLECT Accounts. We do not receive or store
        your PIXLECT password, email address, or any other credentials.
      </p>

      <h3>Content you upload</h3>
      <p>
        When you upload a video, we store:
      </p>
      <ul>
        <li>The video file (hosted on Backblaze B2 or Supabase Storage)</li>
        <li>A thumbnail image (generated or provided by you)</li>
        <li>The title, description, duration, and type (Long or Mini)</li>
        <li>The channel it belongs to and the upload timestamp</li>
      </ul>

      <h3>Activity data</h3>
      <p>
        We store which videos you like, dislike, and subscribe to. We also
        count total video views. This data is tied to your PIXECT UID.
      </p>

      <h3>Comments</h3>
      <p>
        Comments you post are stored publicly and are visible to anyone who
        views the video. Comments include your username, profile icon, and
        the time you posted them.
      </p>

      <h3>Local storage</h3>
      <p>
        PIXELTube stores a small amount of data in your browser's
        <code>localStorage</code>:
      </p>
      <ul>
        <li>Your PIXLECT user object (so you stay signed in across reloads)</li>
        <li>Your search history (up to 20 recent searches)</li>
        <li>Which channel you had selected last</li>
        <li>Whether you've accepted the Community Guidelines</li>
      </ul>
      <p>
        This data never leaves your device unless you clear it manually. You
        can clear it at any time by visiting the Feed page and clicking
        "Clear search history", or by clearing your browser's site data.
      </p>

      <h2>2. How we use your information</h2>
      <ul>
        <li>To display your videos, likes, comments, and channel to other users</li>
        <li>To personalize your Feed based on your search history</li>
        <li>To enforce our Community Guidelines and Terms &amp; Conditions</li>
        <li>To track views and engagement counts on videos</li>
        <li>To prevent abuse, spam, and illegal activity</li>
      </ul>
      <p>
        We do not sell your personal information. We do not run targeted
        advertising. We do not share your data with third parties except as
        described in Section 4.
      </p>

      <h2>3. Children's privacy</h2>
      <p>
        PIXELTube is not intended for children under 13. If you are under 13,
        do not use the platform. If we learn that we have collected data
        from a child under 13, we will delete it. If you believe a child
        under 13 is using PIXELTube, please contact us using the details in
        Section 8.
      </p>

      <h2>4. Third-party services</h2>
      <p>
        PIXELTube relies on the following third-party services. Each of them
        has its own privacy policy.
      </p>
      <ul>
        <li>
          <b>PIXLECT Accounts</b> — handles sign-in and provides us with your
          username, UID, and profile icon.
        </li>
        <li>
          <b>Google Firebase Realtime Database</b> — stores channel metadata,
          video metadata, comments, subscriptions, likes, dislikes, playlists,
          and moderation records.
        </li>
        <li>
          <b>Supabase</b> — stores video files for Shorts and provides
          fallback storage for Longs.
        </li>
        <li>
          <b>Backblaze B2</b> — stores video files for Longs and serves
          them via signed URLs.
        </li>
        <li>
          <b>Cloudflare Workers</b> — generates temporary signed URLs for
          B2 uploads and playback. Cloudflare does not receive your video
          content; it only signs access requests.
        </li>
      </ul>

      <h2>5. Data security</h2>
      <p>
        We use industry-standard practices to protect your data. Videos
        stored on Backblaze B2 are accessed through short-lived signed URLs
        so they cannot be hot-linked or scraped. Firebase access is restricted
        to specific paths with rules that prevent unauthorized modifications.
      </p>
      <p>
        No online service is completely secure. We cannot guarantee that
        unauthorized access will never occur. If you discover a security
        vulnerability, please report it using the contact details in
        Section 8 rather than disclosing it publicly.
      </p>

      <h2>6. Your rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li><b>Access</b> the data we hold about you</li>
        <li><b>Correct</b> any inaccurate data (via channel editing)</li>
        <li><b>Delete</b> your videos, channels, comments, and account</li>
        <li><b>Export</b> your data in a portable format</li>
        <li><b>Withdraw consent</b> by signing out and clearing local storage</li>
      </ul>
      <p>
        To exercise any of these rights, contact us using the details in
        Section 8. We will respond within 30 days.
      </p>

      <h2>7. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. When we do, we
        will update the "Last updated" date at the top of this page. Material
        changes will be announced on the platform. Continued use of PIXELTube
        after a change constitutes acceptance of the updated policy.
      </p>

      <h2>8. Contact</h2>
      <p>
        For privacy questions, data requests, or to report concerns, contact:
      </p>
      <p>
        <b>PIXLECT Studios</b><br>
        Website: <a href="https://www.pixlect-studios.com">pixlect-studios.com</a><br>
        Email: privacy@pixlect-studios.com
      </p>
    </article>
  `;
}

/* ============================================================
   TERMS & CONDITIONS — #/terms
   ============================================================ */
export function viewTerms() {
  return `
    <article class="legal">
      <h1>Terms &amp; Conditions</h1>
      <p class="updated">Last updated: 13 October 2026</p>

      <p>
        Welcome to PIXELTube. These Terms &amp; Conditions ("Terms") govern
        your use of the PIXELTube platform, operated by PIXLECT Studios. By
        using PIXELTube, you agree to be bound by these Terms.
      </p>

      <div class="callout">
        <strong>Short version</strong>
        Be respectful, don't upload illegal or harmful content, don't try to
        break the platform, and understand that we may remove content or
        suspend accounts that violate these Terms. You own your videos; we
        just host them.
      </div>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 13 years old to use PIXELTube. If you are under
        18, you must have permission from a parent or legal guardian. By
        using the platform, you confirm that you meet these requirements.
      </p>

      <h2>2. Your account</h2>
      <p>
        PIXELTube uses PIXLECT Accounts for authentication. You are
        responsible for anything that happens under your account. Do not
        share your PIXLECT credentials with anyone.
      </p>
      <p>
        You may create up to <b>six channels</b> on your account: one primary
        channel (auto-created with your PIXLECT username) and up to five
        additional channels.
      </p>

      <h2>3. Content you upload</h2>
      <p>
        You retain ownership of videos, thumbnails, descriptions, and
        comments you upload ("Your Content"). By uploading, you grant us a
        worldwide, royalty-free license to host, store, transmit, display,
        and distribute Your Content on PIXELTube.
      </p>
      <p>
        You confirm that:
      </p>
      <ul>
        <li>You own Your Content or have permission to use it</li>
        <li>Your Content does not violate anyone else's rights</li>
        <li>Your Content complies with our Community Guidelines</li>
        <li>Your Content complies with all applicable laws</li>
      </ul>

      <h2>4. Prohibited content</h2>
      <p>
        You may not upload, post, or share content that:
      </p>
      <ul>
        <li>Depicts sexual content, nudity, or sexualized minors</li>
        <li>Depicts graphic violence, gore, or cruelty</li>
        <li>Promotes hate against any group based on race, ethnicity,
            religion, gender, sexual orientation, or disability</li>
        <li>Harasses, threatens, or bullies an individual</li>
        <li>Promotes self-harm, suicide, or eating disorders</li>
        <li>Infringes copyright, trademark, or other intellectual property</li>
        <li>Contains malware, spam, phishing, or deceptive links</li>
        <li>Is illegal in your jurisdiction or ours</li>
      </ul>
      <p>
        See our <a href="#/guidelines">Community Guidelines</a> for the full
        list and consequences.
      </p>

      <h2>5. Content moderation</h2>
      <p>
        We may remove content, suspend channels, or ban accounts that
        violate these Terms or the Community Guidelines. We may do this with
        or without notice, at our sole discretion.
      </p>
      <p>
        Videos may be reported by other users. Reports are reviewed by our
        moderators. If your content is removed and you believe this was a
        mistake, you may appeal by contacting us.
      </p>

      <h2>6. Copyright / DMCA</h2>
      <p>
        If you believe your copyright has been infringed by content on
        PIXELTube, contact us with:
      </p>
      <ul>
        <li>A description of the copyrighted work</li>
        <li>The URL of the allegedly infringing content</li>
        <li>Your contact information</li>
        <li>A statement of good-faith belief that the use is unauthorized</li>
        <li>A statement, under penalty of perjury, that the information is
            accurate and you are the rights holder or authorized to act on
            their behalf</li>
        <li>Your physical or electronic signature</li>
      </ul>
      <p>
        We will remove or disable access to infringing content in accordance
        with applicable law. Repeat infringers will have their accounts
        terminated.
      </p>

      <h2>7. Acceptable use</h2>
      <p>
        You may not:
      </p>
      <ul>
        <li>Attempt to gain unauthorized access to any part of the platform</li>
        <li>Use automated tools to scrape, crawl, or mass-download content</li>
        <li>Interfere with the operation of the platform or other users</li>
        <li>Reverse engineer, decompile, or copy the platform's code</li>
        <li>Use PIXELTube to distribute malware or conduct fraud</li>
        <li>Impersonate another person or entity</li>
      </ul>

      <h2>8. Termination</h2>
      <p>
        You may stop using PIXELTube at any time. You may delete your videos,
        channels, and account from your profile.
      </p>
      <p>
        We may suspend or terminate your access at any time, with or without
        cause. If your account is terminated for a Terms violation, you may
        not create a new account without our written permission.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        PIXELTube is provided "as is" and "as available." We make no
        warranties, express or implied, about the platform's operation,
        availability, or fitness for a particular purpose.
      </p>
      <p>
        We do not endorse, verify, or take responsibility for content
        uploaded by users. Views expressed by users are their own.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, PIXLECT Studios shall not be
        liable for any indirect, incidental, special, consequential, or
        punitive damages arising from your use of PIXELTube, including but
        not limited to lost data, lost profits, or service interruptions.
      </p>

      <h2>11. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. When we do, we will
        update the "Last updated" date at the top. Material changes will be
        announced on the platform. Continued use of PIXELTube after a change
        constitutes acceptance of the updated Terms.
      </p>

      <h2>12. Governing law</h2>
      <p>
        These Terms are governed by the laws of Pakistan, without regard to
        its conflict of law provisions. Any dispute shall be resolved in the
        courts of Pakistan.
      </p>

      <h2>13. Contact</h2>
      <p>
        For questions about these Terms:
      </p>
      <p>
        <b>PIXLECT Studios</b><br>
        Website: <a href="https://www.pixlect-studios.com">pixlect-studios.com</a><br>
        Email: legal@pixlect-studios.com
      </p>
    </article>
  `;
}

/* ============================================================
   COMMUNITY GUIDELINES — #/guidelines
   ============================================================ */
export function viewGuidelines() {
  return `
    <article class="legal">
      <h1>Community Guidelines</h1>
      <p class="updated">Last updated: 13 October 2026</p>

      <p>
        PIXELTube is a place for people to share videos, express themselves,
        and find a community. To keep it that way, we need everyone to follow
        a few rules.
      </p>

      <div class="callout">
        <strong>The rule</strong>
        Treat others the way you want to be treated. Don't upload anything
        you wouldn't want your family, your boss, or a child to see.
      </div>

      <h2>What you may not upload</h2>

      <h3>Sexual content</h3>
      <ul>
        <li>Nudity, sexual acts, or sexualized imagery</li>
        <li>Content that sexualizes minors — this is reported to authorities
            without exception</li>
        <li>Content that promotes or depicts non-consensual sexual activity</li>
      </ul>

      <h3>Violence and harm</h3>
      <ul>
        <li>Graphic violence, gore, or depictions of serious injury</li>
        <li>Content glorifying or promoting violence against people or animals</li>
        <li>Content depicting animal cruelty</li>
        <li>Instructions for making weapons, explosives, or causing harm</li>
      </ul>

      <h3>Hate and harassment</h3>
      <ul>
        <li>Hate speech targeting any group based on race, ethnicity,
            religion, gender, sexual orientation, disability, or nationality</li>
        <li>Harassment, threats, or targeted bullying</li>
        <li>Doxxing — sharing someone's private information without consent</li>
        <li>Content that encourages others to harass an individual</li>
      </ul>

      <h3>Self-harm and dangerous acts</h3>
      <ul>
        <li>Content promoting or glorifying suicide or self-harm</li>
        <li>Content promoting eating disorders</li>
        <li>Content depicting dangerous challenges or stunts likely to
            cause injury</li>
      </ul>

      <h3>Illegal activity</h3>
      <ul>
        <li>Content promoting or facilitating illegal activity</li>
        <li>Content involving drugs, weapons, or contraband</li>
        <li>Content obtained through illegal means</li>
      </ul>

      <h3>Spam and deceptive content</h3>
      <ul>
        <li>Repetitive, misleading, or clickbait-heavy content</li>
        <li>Scams, phishing, or fraudulent schemes</li>
        <li>Malware or links to malicious sites</li>
        <li>Fake engagement (buying views, likes, or subs)</li>
      </ul>

      <h3>Intellectual property</h3>
      <ul>
        <li>Videos you don't own or have permission to use</li>
        <li>Music, footage, or images you don't have a license for</li>
        <li>Content that impersonates another creator</li>
      </ul>

      <h2>What happens if you break the rules</h2>
      <p>
        Depending on the severity and frequency, consequences may include:
      </p>
      <ul>
        <li>Your video being removed</li>
        <li>A warning on your account</li>
        <li>Your channel being suspended</li>
        <li>Your account being permanently banned</li>
        <li>Reporting to law enforcement, where legally required</li>
      </ul>
      <p>
        Serious violations — especially content involving minors — are
        reported to the relevant authorities without exception and without
        prior warning.
      </p>

      <h2>Reporting content</h2>
      <p>
        If you see content that violates these guidelines, click the
        <b>Report</b> button on the video. Reports are reviewed by our
        moderators. Reporting is anonymous to the uploader — they won't know
        who reported them.
      </p>
      <p>
        Misusing the report button to harass other users is itself a
        violation of these guidelines.
      </p>

      <h2>Appeals</h2>
      <p>
        If your content was removed or your account was suspended and you
        believe this was a mistake, you can appeal by contacting us. Include
        your username and a brief explanation.
      </p>

      <h2>Contact</h2>
      <p>
        <b>PIXLECT Studios</b><br>
        Website: <a href="https://www.pixlect-studios.com">pixlect-studios.com</a><br>
        Email: moderation@pixlect-studios.com
      </p>
    </article>
  `;
}