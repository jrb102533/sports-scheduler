import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LEGAL_VERSIONS } from '@/legal/versions';

export function TermsOfServicePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline mb-6"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-10 space-y-8">
          <header>
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1">First Whistle</p>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
            <p className="text-sm text-gray-500">
              Effective Date: {LEGAL_VERSIONS.effectiveDate} &mdash; Last Updated: {LEGAL_VERSIONS.effectiveDate}
            </p>
          </header>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">Introduction</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              These Terms of Service (&ldquo;Terms&rdquo;) are a binding agreement between you and First Whistle (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;)
              governing your access to and use of the First Whistle web application and related services (collectively, the &ldquo;Service&rdquo;).
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">
              By creating an account, accepting an invitation, or otherwise using the Service, you agree to be bound by these Terms
              and our Privacy Policy, which is incorporated here by reference. <strong>If you do not agree, do not use the Service.</strong>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">1. Acceptance of Terms</h2>
            <p className="text-sm text-gray-700">By using First Whistle, you represent that:</p>
            <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
              <li>You have read and agree to these Terms</li>
              <li>You are at least 18 years old, or are at least 13 years old and have obtained the consent of a parent or legal guardian</li>
              <li>You have the legal authority to enter into this agreement on behalf of yourself or your organization</li>
              <li>Your use of the Service will comply with all applicable laws and regulations</li>
            </ol>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">2. Account Eligibility and Registration</h2>

            <h3 className="text-base font-semibold text-gray-800">2.1 Age Requirements</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              <li><strong>Direct accounts</strong> &mdash; You must be at least <strong>13 years old</strong> to register for your own First Whistle account.</li>
              <li><strong>Players under 13</strong> &mdash; Children under 13 may not hold their own accounts. They may be added as a player profile only by an authorized adult with parental consent.</li>
              <li><strong>Players age 13&ndash;17</strong> &mdash; Requires parental or guardian consent before account activation.</li>
            </ul>

            <h3 className="text-base font-semibold text-gray-800">2.2 Account Registration</h3>
            <p className="text-sm text-gray-700">
              You agree to provide accurate, current, and complete information; keep your password confidential; and notify us
              immediately of unauthorized account access. You take responsibility for all activity under your account.
            </p>

            <h3 className="text-base font-semibold text-gray-800">2.3 One Account Per Person</h3>
            <p className="text-sm text-gray-700">
              Each user is permitted one personal account. You may not create duplicate accounts or impersonate another person or organization.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">3. Permitted Use</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              First Whistle is designed for managing sports teams and leagues. The Service may be used to create and manage rosters,
              build schedules, send notifications, track attendance, communicate with team members, and manage league operations.
              Use of the Service for any other purpose is not permitted without our prior written consent.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">4. Coach and Administrator Responsibilities</h2>

            <h3 className="text-base font-semibold text-gray-800">4.1 Responsibility for Roster Data</h3>
            <p className="text-sm text-gray-700">
              As a Team Admin, you are responsible for the accuracy of all player information you enter and for removing players
              from your roster when they leave your team.
            </p>

            <h3 className="text-base font-semibold text-gray-800">4.2 Data Accuracy</h3>
            <p className="text-sm text-gray-700">
              If you become aware that player data is inaccurate, you are obligated to correct it promptly within the platform
              or by contacting{' '}
              <a href="mailto:privacy@firstwhistle.app" className="text-blue-600 hover:underline">privacy@firstwhistle.app</a>.
            </p>

            <h3 className="text-base font-semibold text-gray-800">4.3 Communications Responsibility</h3>
            <p className="text-sm text-gray-700">
              When you send messages or notifications through First Whistle, you are responsible for their content. You agree not
              to send communications that are harassing, threatening, abusive, unlawful, defamatory, discriminatory, unrelated
              to team activities, or constitute spam.
            </p>

            <h3 className="text-base font-semibold text-gray-800">4.4 Access Controls</h3>
            <p className="text-sm text-gray-700">
              Team Admins are responsible for managing access to their team and league accounts and for revoking access when a
              person&rsquo;s role ends.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">5. Children&rsquo;s Data &mdash; Parental Consent and Coach Attestation</h2>

            <h3 className="text-base font-semibold text-gray-800">5.1 Players Under 13 &mdash; Mandatory Parental Consent</h3>
            <p className="text-sm text-gray-700 leading-relaxed">
              You <strong>may not add a player under the age of 13</strong> to a First Whistle team roster without first obtaining
              verifiable consent from that player&rsquo;s parent or legal guardian. Consent must cover creation of the player&rsquo;s
              profile, collection of their name and attendance records, storage of parent contact information, and receipt of
              team communications.
            </p>

            <h3 className="text-base font-semibold text-gray-800">5.2 Coach/Admin Consent Attestation</h3>
            <p className="text-sm text-gray-700 leading-relaxed">
              When you add a player under 13 to a roster, the platform will present a consent confirmation prompt.{' '}
              <strong>By clicking to confirm and proceeding, you are making a legally meaningful attestation</strong> that you
              have obtained consent from a parent or legal guardian of the minor player to create their profile on First Whistle
              and to use the parent contact information provided for team communications.
            </p>
            <p className="text-sm text-gray-700">
              Making this attestation without having actually obtained parental consent is a material breach of these Terms and
              may constitute a violation of applicable law, including COPPA.
            </p>

            <h3 className="text-base font-semibold text-gray-800">5.3 Players Age 13&ndash;17</h3>
            <p className="text-sm text-gray-700">
              By enabling account access for a player age 13&ndash;17, you represent that the player&rsquo;s parent or guardian
              is aware of and consents to their participation on the platform.
            </p>

            <h3 className="text-base font-semibold text-gray-800">5.4 Parental Requests</h3>
            <p className="text-sm text-gray-700">
              Parents or guardians may contact us at{' '}
              <a href="mailto:privacy@firstwhistle.app" className="text-blue-600 hover:underline">privacy@firstwhistle.app</a>{' '}
              to review, correct, or delete their child&rsquo;s player profile. We will process verified parental requests within 30 days.
            </p>

            <h3 className="text-base font-semibold text-gray-800">5.5 No Circumvention</h3>
            <p className="text-sm text-gray-700">
              You may not structure a minor&rsquo;s account or data entry to avoid the age-based requirements of these Terms or
              applicable law.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">6. Prohibited Uses</h2>
            <p className="text-sm text-gray-700">You agree not to use First Whistle to:</p>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              <li>Violate any applicable law or regulation</li>
              <li>Collect or transmit information about individuals without their knowledge or consent</li>
              <li>Harass, threaten, or abuse other users</li>
              <li>Impersonate any person or organization</li>
              <li>Upload or transmit viruses, malware, or other harmful code</li>
              <li>Attempt to gain unauthorized access to any account, system, or network</li>
              <li>Scrape, crawl, or extract data by automated means</li>
              <li>Reverse engineer or decompile any part of the Service</li>
              <li>Sell, resell, or sublicense access to the Service without our written permission</li>
              <li>Use the Service as part of a competing product or service</li>
              <li>Circumvent any access controls, rate limits, or security measures</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">7. Subscriptions, Payment, and Access</h2>

            <h3 className="text-base font-semibold text-gray-800">7.1 Subscription Plans</h3>
            <p className="text-sm text-gray-700">
              Access to certain features requires a paid subscription. We reserve the right to change pricing with at least{' '}
              <strong>30 days&rsquo; notice</strong> to current subscribers.
            </p>

            <h3 className="text-base font-semibold text-gray-800">7.2 Billing</h3>
            <p className="text-sm text-gray-700">
              By subscribing, you authorize recurring charges to your payment method at the applicable rate. Charges are
              non-refundable except as required by law or stated in our refund policy.
            </p>

            <h3 className="text-base font-semibold text-gray-800">7.3 Cancellation</h3>
            <p className="text-sm text-gray-700">
              You may cancel your subscription at any time. Cancellation takes effect at the end of the current billing period.
              We do not provide prorated refunds for unused time.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">8. Intellectual Property</h2>

            <h3 className="text-base font-semibold text-gray-800">8.1 Our Property</h3>
            <p className="text-sm text-gray-700">
              First Whistle and all content, features, and functionality of the Service are owned by First Whistle or its
              licensors and are protected by intellectual property laws.
            </p>

            <h3 className="text-base font-semibold text-gray-800">8.2 Your Content</h3>
            <p className="text-sm text-gray-700">
              You retain ownership of the data you enter into First Whistle. By entering data into the Service, you grant
              First Whistle a limited, non-exclusive, royalty-free license to store, process, and display that data solely
              as necessary to provide the Service to you. We will not use your data for any purpose outside of providing
              and improving the Service.
            </p>

            <h3 className="text-base font-semibold text-gray-800">8.3 Feedback</h3>
            <p className="text-sm text-gray-700">
              If you provide feedback or suggestions about the Service, we may use that feedback without restriction or
              compensation to you.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">9. Privacy</h2>
            <p className="text-sm text-gray-700">
              Your use of the Service is governed by our{' '}
              <a href="/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                Privacy Policy
              </a>
              , incorporated into these Terms by reference. By using the Service, you consent to the data practices described
              in the Privacy Policy.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">10. Disclaimer of Warranties</h2>
            <p className="text-sm text-gray-700 leading-relaxed uppercase font-medium">
              The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, express or implied.
              To the fullest extent permitted by law, First Whistle disclaims all warranties, including implied warranties
              of merchantability, fitness for a particular purpose, and non-infringement.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">11. Limitation of Liability</h2>
            <p className="text-sm text-gray-700 leading-relaxed uppercase font-medium">
              To the fullest extent permitted by applicable law, First Whistle and its officers, directors, employees, and
              agents will not be liable for any indirect, incidental, special, consequential, punitive, or exemplary damages
              arising from your use of or inability to use the Service.
            </p>
            <p className="text-sm text-gray-700 uppercase font-medium">
              Our total liability to you for any claim will not exceed the greater of (a) the amount you paid us in the
              12 months preceding the claim or (b) $100 USD.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">12. Indemnification</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              You agree to indemnify and hold harmless First Whistle and its officers, directors, employees, and agents from
              and against any claims, liabilities, damages, losses, and expenses arising from your use of the Service in
              violation of these Terms, any consent attestation under Section 5, or any data you enter that is inaccurate,
              unauthorized, or unlawfully obtained.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">13. Termination</h2>

            <h3 className="text-base font-semibold text-gray-800">13.1 By You</h3>
            <p className="text-sm text-gray-700">
              You may terminate your account at any time through account settings or by contacting{' '}
              <a href="mailto:privacy@firstwhistle.app" className="text-blue-600 hover:underline">privacy@firstwhistle.app</a>.
            </p>

            <h3 className="text-base font-semibold text-gray-800">13.2 By Us</h3>
            <p className="text-sm text-gray-700">
              We reserve the right to suspend or terminate your account if you violate these Terms, if we believe your account
              is being used for unlawful purposes, or if we discontinue the Service.
            </p>

            <h3 className="text-base font-semibold text-gray-800">13.3 Effect of Termination</h3>
            <p className="text-sm text-gray-700">
              Upon termination, your right to access the Service ends immediately. Sections 5, 8, 10, 11, 12, 14, and 15
              survive termination.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">14. Governing Law and Dispute Resolution</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              Disputes that cannot be resolved informally will be resolved through binding arbitration, except that either
              party may seek injunctive relief in a court of competent jurisdiction for intellectual property or data privacy
              violations. <strong>By using the Service, you waive any right to a jury trial or class action.</strong>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">15. General Provisions</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              These Terms constitute the entire agreement between you and First Whistle regarding the Service. If any provision
              is found unenforceable, the remaining provisions continue in full force. Our failure to enforce any right or
              provision does not constitute a waiver. You may not assign your rights under these Terms without our prior
              written consent.
            </p>
            <p className="text-sm text-gray-700">
              We may update these Terms from time to time. When we make material changes, we will notify you by email at
              least <strong>14 days</strong> before the changes take effect. Continued use after the effective date constitutes acceptance.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-100 pb-2">16. Contact Us</h2>
            <p className="text-sm text-gray-700">
              Email:{' '}
              <a href="mailto:privacy@firstwhistle.app" className="text-blue-600 hover:underline">privacy@firstwhistle.app</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
